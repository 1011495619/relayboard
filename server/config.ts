import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = fileURLToPath(new URL("../", import.meta.url));
export const packageRoot = existsSync(join(moduleRoot, "package.json"))
  ? moduleRoot
  : resolve(moduleRoot, "..");
export const runtimeRoot = moduleRoot;
export const runtimeExtension = import.meta.url.endsWith(".ts") ? "ts" : "js";
// Resolve the source loader here, independently of the agent work directory.
// Published JavaScript never resolves this development-only dependency.
export const runtimeNodeArgs =
  runtimeExtension === "ts" ? ["--import", import.meta.resolve("tsx")] : [];
export const version = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
).version as string;

export function defaultDataDir({
  platform = process.platform,
  env = process.env,
  home = homedir(),
  legacyRoot = packageRoot,
}: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  legacyRoot?: string;
} = {}) {
  if (env.RELAYBOARD_DATA_DIR) return resolve(env.RELAYBOARD_DATA_DIR);
  // Preserve a source checkout's existing board. npm packages never contain it.
  const legacy = join(legacyRoot, ".relayboard");
  if (existsSync(join(legacy, "relayboard.sqlite"))) return legacy;
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "Relayboard");
  if (platform === "win32")
    return join(
      env.LOCALAPPDATA || join(home, "AppData", "Local"),
      "Relayboard",
    );
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "relayboard");
}
