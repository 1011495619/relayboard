import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "../server/store.ts";
import { Service } from "../server/domain.ts";
import { createApp } from "../server/app.ts";
import { MemoryRemotes } from "../server/memory-remotes.ts";
import type { CommandInput } from "../server/schemas.ts";
import type { AddressInfo } from "node:net";

function fixture() {
  const store = new Store(),
    s = new Service(store);
  const p = s.execute("project_create", {
    name: "Memory",
    objective: "test persistence",
  });
  const other = s.execute("project_create", {
    name: "Other",
    objective: "isolation",
  });
  const save = (fields: Partial<CommandInput<"memory_save">> = {}) =>
    s.execute("memory_save", {
      project_id: p.id,
      key: "sqlite-backup",
      title: "SQLite 备份与恢复",
      summary: "在线使用 SQLite backup 保留一致性。",
      content:
        "不要复制正在写入的数据库文件；使用 SQLite backup API。实测版本详见证据。",
      source: { label: "运行验证", uri: "VALIDATION.md", revision: "abc123" },
      ...fields,
    });
  return { store, s, p, other, save };
}
test("project memory persists immutable revisions and rejects stale edits across independent connections", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-memory-"));
  const a = new Store(join(dir, "db.sqlite")),
    s = new Service(a);
  const p = s.execute("project_create", { name: "P", objective: "remember" });
  const first = s.execute("memory_save", {
    project_id: p.id,
    key: "build",
    title: "Build",
    summary: "npm run check",
    content: "original body",
    source: { label: "test" },
  });
  const b = new Store(join(dir, "db.sqlite")),
    other = new Service(b);
  t.after(() => {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const saved = other.execute("memory_save", {
    project_id: p.id,
    memory_id: first.id,
    expected_version: first.version,
    key: "build",
    title: "Build",
    summary: "npm run check",
    content: "new body",
    source: { label: "test" },
  });
  assert.equal(saved.version, 2);
  assert.throws(
    () =>
      s.execute("memory_save", {
        project_id: p.id,
        memory_id: first.id,
        expected_version: 1,
        key: "build",
        title: "Build",
        summary: "late",
        content: "late",
        source: { label: "test" },
      }),
    /更新/,
  );
  assert.equal(
    s.query("memory_get", { memory_id: first.id, version: 1 }).content,
    "original body",
  );
  assert.equal(
    s.query("memory_get", { memory_id: first.id }).content,
    "new body",
  );
  const history = s.query("memory_history", { memory_id: first.id, limit: 1 });
  assert.equal(history.total, 2);
  assert.equal(history.next_offset, 1);
  assert.equal(history.items[0].version, 2);
  assert.ok(!("content" in history.items[0]));
});
test("memory has unique project keys, valid task/session provenance and explicit update versions", (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  f.save();
  assert.deepEqual(f.s.query("memory_sources", {}), []);
  assert.throws(() =>
    Reflect.apply(f.s.query, f.s, ["memory_sources", { unexpected: true }]),
  );
  assert.throws(() => f.save(), /记忆键/);
  f.save({ project_id: f.other.id });
  assert.throws(() => f.save({ memory_id: "missing" }), /同时/);
  const task = f.s.execute("task_create", {
    project_id: f.other.id,
    title: "Other",
    acceptance: "done",
    read_only: true,
  });
  assert.throws(
    () => f.save({ key: "wrong-task", task_ids: [task.id] }),
    /同一项目/,
  );
  const run = f.s.execute("agent_register", {
    project_id: f.other.id,
    name: "Other",
    runtime: "pi",
  }).run;
  assert.throws(
    () => f.save({ key: "wrong-author", actor_run_id: run.id }),
    /同一项目/,
  );
  const ended = f.s.execute("agent_register", {
    project_id: f.p.id,
    name: "Ended",
    runtime: "codex",
  }).run;
  f.s.execute("run_end", { run_id: ended.id, status: "ended", note: "done" });
  assert.throws(
    () => f.save({ key: "ended", actor_run_id: ended.id }),
    /有效会话/,
  );
});
test("Chinese search ranks relevant memory, excludes expired/archived references and never loads full bodies", (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const first = f.save({ tags: ["项目恢复"] });
  f.save({ key: "expired", expires_at: "2020-01-01T00:00:00.000Z" });
  f.save({ key: "archived", status: "archived" });
  f.save({
    key: "unrelated",
    title: "组件颜色",
    summary: "颜色令牌",
    content: "tokens",
  });
  f.save({
    project_id: f.other.id,
    key: "secret",
    title: "数据库备份",
    content: "other project secret",
  });
  const result = f.s.query("memory_search", {
    project_id: f.p.id,
    query: "数据库备份",
  });
  assert.equal(result.items[0].id, first.id);
  assert.equal(result.total, 1);
  assert.ok(result.items.every((m) => !("content" in m)));
  assert.equal(
    f.s.query("memory_search", { project_id: f.p.id, status: "stale" }).total,
    1,
  );
  assert.equal(
    f.s.query("memory_search", { project_id: f.p.id, status: "all" }).total,
    4,
  );
});
test("search budgets always make pagination progress and context uses only applicable summaries", (t) => {
  const f = fixture();
  t.after(() => f.store.close());
  const task = f.s.execute("task_create", {
    project_id: f.p.id,
    title: "Database",
    acceptance: "done",
    scopes: ["server"],
  });
  const unrelated = f.s.execute("task_create", {
    project_id: f.p.id,
    title: "UI",
    acceptance: "done",
    scopes: ["web"],
  });
  const pin = f.save({
    pinned: true,
    summary: "known summary",
    content: "FULL_BODY_NOT_IN_CONTEXT",
  });
  f.save({ key: "task", task_ids: [task.id], summary: "task reference" });
  f.save({
    key: "different-task",
    task_ids: [unrelated.id],
    pinned: true,
    summary: "UNRELATED_PIN",
  });
  f.save({
    key: "expired-pin",
    pinned: true,
    summary: "EXPIRED_PIN",
    expires_at: "2020-01-01T00:00:00.000Z",
  });
  f.save({
    key: "huge".repeat(50),
    title: "long".repeat(60),
    summary: "x".repeat(1200),
    tags: Array.from({ length: 20 }, () => "t".repeat(80)),
    source: {
      label: "s".repeat(240),
      uri: "x".repeat(2000),
      revision: "v".repeat(240),
    },
  });
  let offset = 0,
    seen: string[] = [];
  for (;;) {
    const page = f.s.query("memory_search", {
      project_id: f.p.id,
      max_chars: 1500,
      offset,
    });
    assert.ok(JSON.stringify(page).length <= 1500);
    assert.ok(page.items.length > 0);
    seen.push(...page.items.map((i) => i.id));
    if (page.next_offset === null) break;
    assert.ok(page.next_offset > offset);
    offset = page.next_offset;
  }
  assert.equal(new Set(seen).size, 4);
  const packet = f.s.query("context", { task_id: task.id });
  assert.ok(packet.markdown.includes(`${pin.id}@1`));
  assert.ok(packet.markdown.includes("task reference"));
  assert.ok(!packet.markdown.includes("FULL_BODY_NOT_IN_CONTEXT"));
  assert.ok(!packet.markdown.includes("UNRELATED_PIN"));
  assert.ok(!packet.markdown.includes("EXPIRED_PIN"));
  assert.ok(packet.markdown.length <= 10000);
});

test("remote memory uses a named authenticated library, preserves provenance and does not upload local context", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-remote-memory-"));
  const remote = createApp({
    dataDir: join(dir, "remote"),
    token: "source-token",
    port: 0,
  });
  const server = remote.app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as AddressInfo).port;
  const p = remote.service.execute("project_create", {
    name: "Library",
    objective: "shared knowledge",
  });
  const m = remote.service.execute("memory_save", {
    project_id: p.id,
    key: "recover",
    title: "恢复说明",
    summary: "恢复工作区",
    content: "FULL_REMOTE_BODY",
    source: { label: "Library evidence" },
  });
  const other = remote.service.execute("project_create", {
    name: "Private",
    objective: "do not leak",
  });
  const privateMemory = remote.service.execute("memory_save", {
    project_id: other.id,
    key: "private",
    title: "Private",
    summary: "private",
    content: "PRIVATE_BODY",
    source: { label: "Other project" },
  });
  const path = join(dir, "memory-remotes.json");
  writeFileSync(
    path,
    JSON.stringify([
      {
        name: "team",
        label: "团队知识库",
        url: `http://127.0.0.1:${port}`,
        project_id: p.id,
        token_env: "RELAY_MEMORY_TEST_TOKEN",
      },
    ]),
  );
  const sources = new MemoryRemotes(path);
  process.env.RELAY_MEMORY_TEST_TOKEN = "source-token";
  t.after(async () => {
    delete process.env.RELAY_MEMORY_TEST_TOKEN;
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await remote.close();
    rmSync(dir, { recursive: true, force: true });
  });
  assert.equal(sources.list()[0].token_configured, true);
  const result = await sources.search({
    source: "team",
    query: "恢复",
    offset: 0,
    limit: 5,
    max_chars: 4000,
  });
  assert.equal(result.error, null);
  assert.equal(result.source, "team");
  assert.equal(result.result?.items[0].id, m.id);
  const full = await sources.get({
    source: "team",
    memory_id: m.id,
    version: 1,
  });
  assert.equal(full.memory?.content, "FULL_REMOTE_BODY");
  assert.equal(full.label, "团队知识库");
  assert.equal(
    (await sources.get({ source: "team", memory_id: privateMemory.id })).memory,
    null,
  );
  process.env.RELAY_MEMORY_TEST_TOKEN = "wrong-token";
  const failure = await sources.search({
    source: "team",
    query: "恢复",
    offset: 0,
    limit: 5,
    max_chars: 4000,
  });
  assert.ok(failure.error?.includes("HTTP 401"));
  assert.equal(failure.result, null);
  assert.ok(!JSON.stringify(failure).includes("wrong-token"));
  assert.equal(remote.store.list("memory", p.id).length, 1);
  delete process.env.RELAY_MEMORY_TEST_TOKEN;
  await assert.rejects(
    () =>
      sources.search({
        source: "team",
        query: "",
        offset: 0,
        limit: 5,
        max_chars: 4000,
      }),
    /环境变量/,
  );
  await assert.rejects(
    () => sources.get({ source: "unconfigured", memory_id: m.id }),
    /命名来源/,
  );
});
