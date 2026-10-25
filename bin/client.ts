import { ClientError } from "./errors.ts";
export const baseUrl = () =>
  (process.env.RELAYBOARD_URL || "http://127.0.0.1:4317")
    .replace(/\/mcp\/?$/, "")
    .replace(/\/$/, "");
export async function request<T = unknown>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      ...(process.env.RELAYBOARD_TOKEN
        ? { Authorization: `Bearer ${process.env.RELAYBOARD_TOKEN}` }
        : {}),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  const value = (await response.json()) as {
    result?: T;
    error?: {
      message?: string;
      code?: string;
      details?: unknown;
      next_action?: unknown;
      retryable?: boolean;
    };
  };
  if (!response.ok)
    throw new ClientError(
      value.error?.message || `HTTP ${response.status}`,
      value.error?.code,
      value.error?.details,
      value.error?.next_action,
      value.error?.retryable,
    );
  return (value.result ?? value) as T;
}
