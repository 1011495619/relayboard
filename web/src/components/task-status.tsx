import {
  AlertCircle,
  ArrowLeftRight,
  Circle,
  CircleDot,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TaskStatus } from "../types";

export const taskStatus = {
  pending: { label: "待领取", variant: "secondary", icon: Circle },
  doing: { label: "进行中", variant: "active", icon: CircleDot },
  blocked: { label: "受阻", variant: "destructive", icon: AlertCircle },
  reconcile: { label: "待核验", variant: "warning", icon: ArrowLeftRight },
  review: { label: "待验收", variant: "review", icon: ShieldCheck },
  done: { label: "已完成", variant: "success", icon: CheckCircle2 },
} as const;

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const { label, variant, icon: Icon } = taskStatus[status];
  return (
    <Badge variant={variant} size="status">
      <Icon data-icon="inline-start" aria-hidden="true" />
      {label}
    </Badge>
  );
}
