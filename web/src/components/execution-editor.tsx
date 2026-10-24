import { useState } from "react";
import { ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ExecutionPlan } from "../../../server/types.ts";

const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
function LinesInput({
  value,
  onChange,
  ...props
}: {
  value: string[];
  onChange: (value: string[]) => void;
  id: string;
  placeholder: string;
}) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <Textarea
      {...props}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(lines(event.target.value));
      }}
    />
  );
}
export function ExecutionEditor({
  value,
  onChange,
}: {
  value?: ExecutionPlan;
  onChange: (value: ExecutionPlan | undefined) => void;
}) {
  if (!value)
    return (
      <FieldSet className="execution-editor">
        <FieldLegend variant="label">执行说明（可选）</FieldLegend>
        <FieldDescription>
          把输入、交付物、步骤和停止条件写清楚，换窗口后也能按同一流程接着做。
        </FieldDescription>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange({
              inputs: [],
              outputs: [],
              steps: [
                {
                  id: `step_${crypto.randomUUID()}`,
                  title: "",
                  instructions: "",
                  done_when: "",
                  on_failure: "",
                },
              ],
              stop_when: [],
            })
          }
        >
          <Plus data-icon="inline-start" />
          添加执行说明
        </Button>
      </FieldSet>
    );
  const updateStep = (
    index: number,
    fields: Partial<ExecutionPlan["steps"][number]>,
  ) =>
    onChange({
      ...value,
      steps: value.steps.map((step, i) =>
        i === index ? { ...step, ...fields } : step,
      ),
    });
  const move = (from: number, to: number) => {
    const steps = [...value.steps];
    [steps[from], steps[to]] = [steps[to], steps[from]];
    onChange({ ...value, steps });
  };
  return (
    <FieldSet className="execution-editor">
      <FieldLegend variant="label">执行说明</FieldLegend>
      <div className="execution-editor-heading">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(undefined)}
        >
          移除执行说明
        </Button>
      </div>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="execution-inputs">开始前需要读取</FieldLabel>
          <LinesInput
            id="execution-inputs"
            value={value.inputs}
            onChange={(inputs) => onChange({ ...value, inputs })}
            placeholder="每行一项：输入文件、契约或前置成果"
          />
          <FieldDescription>
            写明位置或记录名称，帮助接手者找到准确资料。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="execution-outputs">需要交付</FieldLabel>
          <LinesInput
            id="execution-outputs"
            value={value.outputs}
            onChange={(outputs) => onChange({ ...value, outputs })}
            placeholder="每行一项：成果及其完成标准"
          />
        </Field>
        {value.steps.map((step, index) => (
          <FieldSet className="execution-editor-step" key={step.id}>
            <FieldLegend variant="label">步骤 {index + 1}</FieldLegend>
            <div className="execution-editor-heading">
              <div className="execution-step-controls">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0}
                  aria-label={`上移步骤 ${index + 1}`}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === value.steps.length - 1}
                  aria-label={`下移步骤 ${index + 1}`}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`删除步骤 ${index + 1}`}
                  disabled={value.steps.length === 1}
                  onClick={() =>
                    onChange({
                      ...value,
                      steps: value.steps.filter((_, i) => i !== index),
                    })
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`step-title-${step.id}`}>
                  要做什么
                </FieldLabel>
                <Input
                  id={`step-title-${step.id}`}
                  value={step.title}
                  required
                  maxLength={240}
                  onChange={(event) =>
                    updateStep(index, { title: event.target.value })
                  }
                  placeholder="例如：实现会话写入"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`step-instructions-${step.id}`}>
                  执行方法与范围
                </FieldLabel>
                <Textarea
                  id={`step-instructions-${step.id}`}
                  value={step.instructions}
                  required
                  onChange={(event) =>
                    updateStep(index, { instructions: event.target.value })
                  }
                  placeholder="需要读取什么，在哪些文件中执行"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`step-done-${step.id}`}>
                  如何确认完成
                </FieldLabel>
                <Textarea
                  id={`step-done-${step.id}`}
                  value={step.done_when}
                  required
                  onChange={(event) =>
                    updateStep(index, { done_when: event.target.value })
                  }
                  placeholder="需要观察到的结果或检查命令"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`step-failure-${step.id}`}>
                  失败后怎么处理
                </FieldLabel>
                <Textarea
                  id={`step-failure-${step.id}`}
                  value={step.on_failure}
                  required
                  onChange={(event) =>
                    updateStep(index, { on_failure: event.target.value })
                  }
                  placeholder="先检查什么，何时报告阻塞或请求帮助"
                />
              </Field>
            </FieldGroup>
          </FieldSet>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            onChange({
              ...value,
              steps: [
                ...value.steps,
                {
                  id: `step_${crypto.randomUUID()}`,
                  title: "",
                  instructions: "",
                  done_when: "",
                  on_failure: "",
                },
              ],
            })
          }
        >
          <Plus data-icon="inline-start" />
          添加下一步
        </Button>
        <Field>
          <FieldLabel htmlFor="execution-stop">遇到什么情况应先报告</FieldLabel>
          <LinesInput
            id="execution-stop"
            value={value.stop_when}
            onChange={(stop_when) => onChange({ ...value, stop_when })}
            placeholder="每行一项，例如：需要修改约定范围以外的文件"
          />
          <FieldDescription>
            执行者遇到这些情况时保存进度、请求协助，等待处理后再继续。
          </FieldDescription>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
}
