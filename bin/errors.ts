export interface ErrorInfo {
  message: string;
  code?: string;
  details?: unknown;
  type?: string;
  next_action?: unknown;
  retryable?: boolean;
}
export function errorInfo(error: unknown): ErrorInfo {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      message:
        typeof record.message === "string" ? record.message : String(error),
      code: typeof record.code === "string" ? record.code : undefined,
      details: record.details,
      next_action: record.next_action,
      retryable:
        typeof record.retryable === "boolean" ? record.retryable : undefined,
      type: typeof record.type === "string" ? record.type : undefined,
    };
  }
  return { message: String(error) };
}
export class ClientError extends Error {
  constructor(
    message: string,
    public code = "ERROR",
    public details?: unknown,
    public next_action?: unknown,
    public retryable?: boolean,
  ) {
    super(message);
  }
}
