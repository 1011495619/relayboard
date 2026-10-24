import { parentPort, workerData } from "node:worker_threads";
import { Store } from "../server/store.js";
import { Service } from "../server/domain.js";
if (!parentPort) throw new Error("Worker requires parent port");
const store = new Store(workerData.db),
  s = new Service(store);
parentPort.postMessage("ready");
Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
try {
  const { barrier, db, ...args } = workerData;
  const task = s.execute("task_claim", args);
  parentPort.postMessage({ ok: true, owner: task.owner_run_id });
} catch (e) {
  parentPort.postMessage({
    ok: false,
    code: e instanceof Error && "code" in e ? e.code : "ERROR",
  });
}
store.close();
