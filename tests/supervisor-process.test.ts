import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../server/app.ts";
import { Supervisor } from "../server/supervisor.ts";

test("a real controlled subprocess recovers the handed-off task, reads project memory and submits through HTTP", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-supervisor-process-"));
  const marker = "RELAYBOARD_MEMORY_RECOVERY_VERIFIED";
  writeFileSync(join(dir, "NOTE.md"), marker);
  const script = join(dir, "worker.mjs");
  writeFileSync(
    script,
    `
import {readFileSync} from 'node:fs';
if(process.argv.includes('--version')){console.log('controlled-memory-worker 1');process.exit(0);}
let prompt='';for await(const chunk of process.stdin)prompt+=chunk;
const url=process.env.RELAYBOARD_URL;
async function request(path,body){const response=await fetch(url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const envelope=await response.json();if(!response.ok)throw Error(JSON.stringify(envelope));return envelope.result;}
const call=(operation,args)=>request('command',{operation,args});
const query=(query,args)=>request('query',{query,args});
const run_id=process.env.RELAYBOARD_RUN_ID,task_id=process.env.RELAYBOARD_TASK_ID;
let guide=await call('work_start',{run_id,task_id});
const memories=await query('memory_search',{project_id:guide.task.project_id,task_id,query:'读取标记'});
const memory=await query('memory_get',{memory_id:memories.items[0].id,version:memories.items[0].version});
const observed=readFileSync('NOTE.md','utf8');
if(!prompt.includes(memory.id)||!memory.content.includes('NOTE.md')||observed!=='${marker}')throw Error('Missing actual memory or fixture');
guide=await call('work_report',{handle:guide.handle,kind:'recover',summary:'核实实际目录与记忆来源',observed:'实际读取 NOTE.md：'+observed+'；使用记忆 '+memory.id+'@'+memory.version,read_decision_ids:[],dependency_receipts:[]});
guide=await call('work_report',{handle:guide.handle,kind:'step',step_id:'read',summary:'按已保存的记忆读取实际文件，标记匹配。'});
guide=await call('work_report',{handle:guide.handle,kind:'verify',summary:'真实读取结果与fixture匹配。',artifacts:[{path:'NOTE.md',note:observed}],verification:[{command:'read NOTE.md',result:observed,passed:true}]});
guide=await call('work_report',{handle:guide.handle,kind:'submit',summary:'受控进程已完成记忆辅助的任务接手，等待独立验收。'});
console.log(JSON.stringify({fixture:true,read_marker:observed,memory_id:memory.id,task_status:guide.task.status}));
`,
  );
  const app = createApp({
    dataDir: join(dir, "data"),
    port: 0,
    runnerProfiles: {
      other: { command: process.execPath, args: [script], stdin: true },
    },
    runnerTimeoutMs: 10000,
  });
  const server = app.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  app.runner.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });
  const s = app.service,
    p = s.execute("project_create", {
      name: "Controlled worker",
      objective: "Read marker using project memory",
      root_path: dir,
    });
  const old = s.execute("agent_register", {
    project_id: p.id,
    name: "Stopped original",
    runtime: "codex",
    workdir: dir,
  }).run;
  const task = s.execute("task_create", {
    project_id: p.id,
    title: "Read marker",
    acceptance: "Actual marker matches, report and submit",
    read_only: true,
    execution: {
      inputs: ["NOTE.md"],
      outputs: [],
      steps: [
        {
          id: "read",
          title: "Read marker",
          instructions: "Use saved memory then inspect actual file",
          done_when: "Marker matches",
          on_failure: "Report failure",
        },
      ],
    },
  });
  s.execute("task_claim", {
    task_id: task.id,
    run_id: old.id,
    expected_version: 1,
  });
  s.execute("task_checkpoint", {
    task_id: task.id,
    run_id: old.id,
    claim_epoch: 1,
    summary: "Stopped before reading",
    next_step: "Read actual NOTE.md",
  });
  s.execute("run_end", {
    run_id: old.id,
    status: "ended",
    note: "fixture process confirmed stopped",
  });
  const memory = s.execute("memory_save", {
    project_id: p.id,
    key: "marker",
    title: "读取标记",
    summary: "读取 NOTE.md 保留实际标记",
    content: "读取 NOTE.md，不要相信旧聊天里的标记。",
    task_ids: [task.id],
    source: { label: "Controlled fixture specification" },
  });
  s.execute("supervisor_configure", {
    project_id: p.id,
    mode: "recover",
    stale_after_seconds: 60,
    grace_seconds: 30,
    cooldown_seconds: 30,
    max_launches: 1,
    max_attempts_per_task: 1,
    runtimes: ["other"],
    note: "Only the controlled Node fixture profile",
  });
  let now = Date.now() + 61000;
  const supervisor = new Supervisor(s, app.runner, () => now);
  await supervisor.tick();
  now += 31000;
  await supervisor.tick();
  for (let i = 0; i < 200 && app.runner.live.size; i++) await delay(10);
  assert.equal(app.runner.live.size, 0);
  const final = s.task(task.id),
    replacement = s.run(final.owner_run_id);
  assert.notEqual(replacement.id, old.id);
  assert.equal(final.status, "review");
  assert.equal(final.claim_epoch, 2);
  assert.equal(final.artifacts[0].note, marker);
  assert.equal(final.verification[0].passed, true);
  assert.equal(replacement.process?.exit_code, 0);
  const log = readFileSync(replacement.process!.log_path!, "utf8");
  assert.ok(log.includes(memory.id));
  assert.ok(log.includes(marker));
  await supervisor.tick();
  assert.equal(
    s.query("supervisor_status", { project_id: p.id }).incidents[0].status,
    "resolved",
  );
});
