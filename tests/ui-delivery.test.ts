import test from "node:test";
import assert from "node:assert/strict";
import {
  serviceStatusLabel,
  serviceStatusTone,
  freshnessStateLabel,
  freshnessStateTone,
  freshnessReasonLabel,
  diagnosisCategoryLabel,
  diagnosisConfidenceLabel,
  deliveryPhase,
  type Task,
} from "../web/src/types.ts";

test("service execution statuses map to distinct copy and never reuse green for unknowns", () => {
  for (const status of [
    "queued",
    "running",
    "succeeded",
    "failed",
    "timed_out",
    "stopped",
    "start_failed",
    "unknown",
  ] as const) {
    assert.ok(serviceStatusLabel[status].length > 0, `${status} has a label`);
  }
  assert.equal(serviceStatusTone("succeeded"), "success");
  assert.equal(serviceStatusTone("running"), "active");
  assert.equal(serviceStatusTone("queued"), "active");
  assert.equal(serviceStatusTone("failed"), "destructive");
  assert.equal(serviceStatusTone("timed_out"), "destructive");
  assert.equal(serviceStatusTone("start_failed"), "destructive");
  assert.equal(serviceStatusTone("stopped"), "secondary");
  // unknown/held must never look like success.
  assert.equal(serviceStatusTone("unknown"), "warning");
});

test("freshness states map every reason and current never claims acceptance", () => {
  for (const reason of [
    "not_passed",
    "execution_unknown",
    "owner_changed",
    "scope_changed_during_run",
    "scope_changed_after_run",
    "workspace_unobservable",
    "dependency_changed",
    "profile_changed",
    "process_unconfirmed",
  ] as const) {
    assert.ok(freshnessReasonLabel[reason].length > 0, `${reason} has a label`);
  }
  assert.equal(freshnessStateTone("current"), "outline");
  assert.equal(freshnessStateTone("stale"), "warning");
  assert.equal(freshnessStateTone("unknown"), "warning");
  assert.equal(freshnessStateLabel.current, "证据当前有效");
  assert.equal(freshnessStateLabel.stale, "证据已过期");
  assert.equal(freshnessStateLabel.unknown, "证据有效性未知");
});

test("delivery phase separates submission from acceptance", () => {
  const base = { status: "pending" as Task["status"], submitted_at: null };
  assert.deepEqual(deliveryPhase(base), {
    label: "尚未领取",
    tone: "outline",
  });
  assert.deepEqual(
    deliveryPhase({ ...base, status: "doing" }),
    { label: "执行中", tone: "active" },
  );
  assert.deepEqual(
    deliveryPhase({ ...base, status: "blocked" }),
    { label: "已阻塞", tone: "warning" },
  );
  assert.deepEqual(
    deliveryPhase({ ...base, status: "reconcile" }),
    { label: "执行权已转移，待核验", tone: "warning" },
  );
  // Submitted but not accepted is explicitly not 已验收.
  assert.deepEqual(
    deliveryPhase({ ...base, status: "review", submitted_at: "t" }),
    { label: "待验收", tone: "review" },
  );
  assert.deepEqual(
    deliveryPhase({ ...base, status: "done", submitted_at: "t" }),
    { label: "已验收", tone: "success" },
  );
  assert.equal(
    deliveryPhase({ ...base, status: "doing", submitted_at: "t" }).label,
    "已提交，等待独立验收",
  );
});

test("diagnosis categories and confidence cover the six contract kinds", () => {
  for (const category of [
    "authentication",
    "transient",
    "permission",
    "configuration",
    "process_unknown",
    "unknown",
  ] as const) {
    assert.ok(diagnosisCategoryLabel[category].length > 0);
  }
  assert.equal(diagnosisCategoryLabel.process_unknown, "进程状态未知");
  assert.equal(diagnosisCategoryLabel.unknown, "无法分类");
  assert.equal(diagnosisConfidenceLabel.high, "高置信");
  assert.equal(diagnosisConfidenceLabel.medium, "中置信");
  assert.equal(diagnosisConfidenceLabel.low, "低置信");
});
