import { useEffect, useId, useRef, useState } from "react";
import type { CommandInput } from "../../../server/schemas.ts";
import type { QueryResults } from "../../../server/types.ts";
import { Button } from "./ui/button";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";

type History = QueryResults["evidence_history"];
export function EvidenceHistory({
  taskId,
  version,
  load,
}: {
  taskId: string;
  version: number;
  load: (offset: number, snapshotId?: string) => Promise<History>;
}) {
  const generation = useRef(0);
  const [page, setPage] = useState<History | null>(null),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<History["snapshot"]>(),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    generation.current++;
    setError("");
    setPage(null);
    setSelected(undefined);
    load(offset)
      .then((p) => {
        if (active) setPage(p);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [taskId, version, offset, load]);
  return (
    <section className="detail-section">
      <h3>验证历史</h3>
      <p className="muted">
        提交检查当前完整验证集合；旧失败保留在历史中。替代原因来自检查点说明。
      </p>
      {error && <p role="alert">{error}</p>}
      {page?.items.map((s) => (
        <div className="artifact-item" key={s.id}>
          <div>
            <strong>
              {s.current ? "当前集合" : "已替代"} · {s.checks} 项 / {s.failures}{" "}
              项失败
            </strong>
            <p>{s.reason}</p>
            <small>
              {new Date(s.created_at).toLocaleString()} · {s.actor_run_id}
            </small>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError("");
                (() => {
                  const ticket = generation.current;
                  return load(offset, s.id).then((p) => {
                    if (ticket === generation.current) setSelected(p.snapshot);
                  });
                })().catch((e) => setError(String(e)));
              }}
            >
              查看此快照
            </Button>
          </div>
        </div>
      ))}
      {page?.total === 0 && (
        <p className="muted">
          尚无版本化快照。升级前的历史仍可查活动记录，下一次提交验证时保存旧集合。
        </p>
      )}
      {selected && (
        <div aria-label="验证快照正文">
          <p>{selected.reason}</p>
          {selected.verification.map((v, i) => (
            <div className="artifact-item" key={i}>
              <div>
                <strong>{v.passed ? "通过" : "失败"}</strong>
                <code>{v.command}</code>
                <p>{v.result}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 10))}
        >
          上一页
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={page?.next_offset == null}
          onClick={() => setOffset(page!.next_offset!)}
        >
          下一页
        </Button>
      </div>
    </section>
  );
}

export function RecoveryPanel({
  taskId,
  runId,
  inspect,
  takeover,
}: {
  taskId: string;
  runId: string;
  inspect: () => Promise<QueryResults["work_recovery"]>;
  takeover: (args: CommandInput<"work_takeover">) => Promise<unknown>;
}) {
  const [preview, setPreview] = useState<QueryResults["work_recovery"] | null>(
      null,
    ),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const id = useId();
  useEffect(() => {
    setPreview(null);
    setConfirmed(false);
    setReason("");
    setError("");
  }, [taskId, runId]);
  return (
    <section className="detail-section">
      <h3>以自己的会话接管</h3>
      <p className="muted">
        先检查旧执行者、能力与范围。接管后重新核验现场，不代用旧 Run 身份。
      </p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setPreview(await inspect());
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        检查接管条件
      </Button>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <FieldGroup>
          <p>
            {preview.known_stopped
              ? "已记录旧执行者停止"
              : "尚未确认旧执行者停止"}{" "}
            · 活动后代任务 {preview.active_descendants.length}{" "}
            个（保留继续执行）
          </p>
          <p className="muted">
            所需能力：{preview.required_capabilities.join(", ") || "无"}
            ；当前能力：{preview.target_capabilities.join(", ") || "无"}
            ；当前委派范围：{preview.target_scopes.join(", ")}
          </p>
          <Field>
            <FieldLabel htmlFor={id}>接管理由与已核实的现场</FieldLabel>
            <Textarea
              id={id}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {!preview.known_stopped && (
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-stop`}
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(!!v)}
              />
              <FieldLabel htmlFor={`${id}-stop`}>
                我已实际确认旧执行者停止该任务的写入
              </FieldLabel>
            </Field>
          )}
          <Button
            disabled={
              busy || !reason.trim() || (!preview.known_stopped && !confirmed)
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await takeover({
                  task_id: taskId,
                  run_id: runId,
                  expected_version: preview.expected_version,
                  reason,
                  confirmed_stop: confirmed,
                  descendants: "continue",
                });
                setPreview(null);
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            接管并进入现场核验
          </Button>
          <p className="muted">
            操作时重新检查所有守卫。运行中进程仍会阻断接管，勾选确认也不会跳过。
          </p>
        </FieldGroup>
      )}
    </section>
  );
}
