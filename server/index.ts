import { errorInfo } from "../bin/errors.js";
import { startServer } from "./start.js";

try {
  await startServer({ open: process.env.RELAYBOARD_OPEN === "1" });
} catch (error) {
  console.error(errorInfo(error).message);
  process.exitCode = 1;
}
