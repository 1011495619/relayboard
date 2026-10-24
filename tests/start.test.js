import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defaultDataDir, version } from "../server/config.js";
import { startServer } from "../server/start.js";

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/relayboard.js", import.meta.url));
function temporary(t) {
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
    messages = [];
  const first = await startServer({
    port: 0,
    dataDir: dir,
    log: (s) => messages.push(s),
  });
  t.after(() => first.close());
  const port = first.server.address().port;
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
  await new Promise((resolve) => foreign.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => foreign.close(resolve)));
  await assert.rejects(
    startServer({ port: foreign.address().port, dataDir: dir, log: () => {} }),
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
      (e) => e.code === 1 && !!e.stderr.trim(),
    );
  }
});
