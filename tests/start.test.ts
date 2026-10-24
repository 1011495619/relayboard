import test, { type TestContext } from "node:test";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defaultDataDir, version } from "../server/config.ts";
import { startServer } from "../server/start.ts";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../lib/bin/relayboard.js", import.meta.url));
function temporary(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "relayboard-start-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("data lives outside npm caches and working directories while existing source data is preserved", (t) => {
  const dir = temporary(t),
    home = join(dir, "user");
  const options = { home, env: {}, legacyRoot: join(dir, "package-cache") };
  assert.equal(
    defaultDataDir({ ...options, platform: "darwin" }),
    join(home, "Library", "Application Support", "Relayboard"),
  );
  assert.equal(
    defaultDataDir({ ...options, platform: "linux" }),
    join(home, ".local", "share", "relayboard"),
  );
  assert.equal(
    defaultDataDir({
      ...options,
      platform: "linux",
      env: { XDG_DATA_HOME: join(dir, "xdg") },
    }),
    join(dir, "xdg", "relayboard"),
  );
  assert.equal(
    defaultDataDir({
      ...options,
      platform: "win32",
      env: { LOCALAPPDATA: join(dir, "local") },
    }),
    join(dir, "local", "Relayboard"),
  );
  mkdirSync(join(options.legacyRoot, ".relayboard"), { recursive: true });
  writeFileSync(
    join(options.legacyRoot, ".relayboard", "relayboard.sqlite"),
    "fixture",
  );
  assert.equal(
    defaultDataDir(options),
    join(options.legacyRoot, ".relayboard"),
  );
  assert.equal(
    defaultDataDir({
      ...options,
      env: { RELAYBOARD_DATA_DIR: "relative-data" },
    }),
    resolve("relative-data"),
  );
});

test("launcher serves prebuilt web, reuses its running service and preserves data on restart", async (t) => {
  const dir = temporary(t),
    messages: string[] = [];
  const first = await startServer({
    port: 0,
    dataDir: dir,
    log: (s) => messages.push(s),
  });
  assert.equal(first.reused, false);
  if (first.reused) throw new Error("Expected new fixture server");
  t.after(() => first.close());
  const port = (first.server.address() as AddressInfo).port;
  const project = first.service.execute("project_create", {
    name: "npx board",
    objective: "Persist across package updates",
  });
  const html = await (await fetch(first.url)).text();
  assert.ok(html.includes('<div id="root"></div>'));
  const health = await (await fetch(`${first.url}/api/health`)).json();
  assert.equal(health.service, "relayboard");
  assert.equal(health.version, version);
  const second = await startServer({ port, dataDir: dir, log: () => {} });
  assert.equal(second.reused, true);
  await assert.rejects(
    startServer({ port, dataDir: join(dir, "other"), log: () => {} }),
    /其他数据目录/,
  );
  assert.equal(first.service.query("projects")[0].id, project.id);
  await first.close();
  const restarted = await startServer({ port: 0, dataDir: dir, log: () => {} });
  assert.equal(restarted.reused, false);
  if (restarted.reused) throw new Error("Expected restarted fixture server");
  t.after(() => restarted.close());
  assert.equal(restarted.service.query("projects")[0].id, project.id);
  assert.ok(messages[0].includes(dir));
});

test("a different HTTP service is not mistaken for an existing board", async (t) => {
  const dir = temporary(t);
  const foreign = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => foreign.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => foreign.close(resolve)));
  await assert.rejects(
    startServer({
      port: (foreign.address() as AddressInfo).port,
      dataDir: dir,
      log: () => {},
    }),
    /其他服务占用/,
  );
});

test("CLI reports its version and validates launch arguments before starting", async () => {
  const result = await exec(process.execPath, [cli, "--version"]);
  assert.equal(result.stdout.trim(), version);
  const help = await exec(process.execPath, [cli, "--help"]);
  assert.ok(help.stdout.includes("--no-open"));
  for (const args of [
    ["start", "--port", "0"],
    ["--port", "wrong"],
    ["start", "--data-dir"],
    ["--unknown"],
  ]) {
    await assert.rejects(
      exec(process.execPath, [cli, ...args]),
      (e: unknown) =>
        e instanceof Error &&
        "code" in e &&
        e.code === 1 &&
        "stderr" in e &&
        typeof e.stderr === "string" &&
        !!e.stderr.trim(),
    );
  }
});

test("reusing a disabled running service explains that new environment flags do not replace its execution policy", async (t) => {
  const dir = temporary(t),
    messages: string[] = [];
  const existing = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        service: "relayboard",
        ok: true,
        data_dir: dir,
        runners_enabled: false,
      }),
    );
  });
  await new Promise<void>((resolve) =>
    existing.listen(0, "127.0.0.1", resolve),
  );
  t.after(() => new Promise((resolve) => existing.close(resolve)));
  const result = await startServer({
    port: (existing.address() as AddressInfo).port,
    dataDir: dir,
    log: (s) => messages.push(s),
  });
  assert.equal(result.reused, true);
  assert.match(messages.join("\n"), /RELAYBOARD_RUNNERS=0/);
  assert.match(messages.join("\n"), /先停止原服务/);
});
