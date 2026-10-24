export interface ErrorInfo {
  message: string;
  code?: string;
  details?: unknown;
  type?: string;
}
export function errorInfo(error: unknown): ErrorInfo {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      message:
        typeof record.message === "string" ? record.message : String(error),
      code: typeof record.code === "string" ? record.code : undefined,
      details: record.details,
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
  ) {
    super(message);
  }
}
