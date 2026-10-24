import { errorInfo } from "../bin/errors.ts";
import { startServer } from "./start.ts";

try {
  await startServer({ open: process.env.RELAYBOARD_OPEN === "1" });
} catch (error) {
  console.error(errorInfo(error).message);
  process.exitCode = 1;
}
