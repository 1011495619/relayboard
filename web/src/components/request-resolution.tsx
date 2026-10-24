import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Message, Run, Task } from "../types";

export function RequestResolution({
  message,
  currentRun,
  tasks,
  onResolve,
}: {
  message: Message;
  currentRun?: Run;
  tasks: Task[];
  onResolve: (message: Message) => void;
}) {
  if (!["request", "blocker"].includes(message.kind)) return null;
  if (message.resolved_at)
    return (
      <div className="flex flex-col items-start gap-2">
        <Badge variant="secondary">已处理</Badge>
        <p>{message.resolution}</p>
      </div>
    );
  let canResolve = !currentRun || message.to_run_id === currentRun.id;
  let task = tasks.find((item) => item.id === message.task_id);
  const visited = new Set<string>();
  while (task && !visited.has(task.id)) {
    visited.add(task.id);
    if (currentRun && task.owner_run_id === currentRun.id) canResolve = true;
    task = tasks.find((item) => item.id === task?.parent_id);
  }
  if (currentRun && currentRun.status !== "active") canResolve = false;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">
        {message.acknowledged_at ? "已读，尚未处理" : "等待处理"}
      </Badge>
      {canResolve && (
        <Button variant="outline" size="sm" onClick={() => onResolve(message)}>
          <CheckCircle2 data-icon="inline-start" />
          标记已处理
        </Button>
      )}
    </div>
  );
}
