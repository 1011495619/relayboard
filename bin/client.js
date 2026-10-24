export const baseUrl = () =>
  process.env.RELAYBOARD_URL || "http://127.0.0.1:4317";
export async function request(path, body, method = "POST") {
  const response = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(process.env.RELAYBOARD_TOKEN
        ? { Authorization: `Bearer ${process.env.RELAYBOARD_TOKEN}` }
        : {}),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error?.message || `HTTP ${response.status}`);
    error.code = value.error?.code;
    error.details = value.error?.details;
    throw error;
  }
  return value.result ?? value;
}
