import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { AppError } from "./domain.ts";

/**
 * 显式验证配置：<data_dir>/verification-profiles.json。
 * 配置不含环境变量、凭据或任意 MCP 命令参数；command 单可执行文件、args 逐项传递且不经过 shell。
 * 契约版本 evolution-v1。
 */

export interface VerificationProfileConfig {
  command: string;
  args: string[];
  cwd?: string;
  timeout_ms?: number;
  max_output_bytes?: number;
}

export interface VerificationConfigFile {
  version: 1;
  profiles: Record<string, VerificationProfileConfig>;
}

export interface VerificationProfileItem {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  timeout_ms: number;
  max_output_bytes: number;
  profile_sha256: string;
}

export interface VerificationProfilesResult {
  config_path: string;
  config_version: 1 | null;
  config_sha256: string | null;
  valid: boolean;
  error: { code: string; message: string } | null;
  items: VerificationProfileItem[];
  notice: string;
}

export const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
export const DEFAULT_TIMEOUT_MS = 900000;
export const DEFAULT_MAX_OUTPUT_BYTES = 65536;

export function verificationConfigPath(dataDir: string): string {
  return join(dataDir, "verification-profiles.json");
}

function rawConfig(dataDir: string): {
  text: string | null;
  sha256: string | null;
  error: { code: string; message: string } | null;
} {
  const path = verificationConfigPath(dataDir);
  if (!existsSync(path))
    return {
      text: null,
      sha256: null,
      error: {
        code: "VERIFICATION_PROFILE_INVALID",
        message: `验证配置缺失：${path}`,
      },
    };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return {
      text: null,
      sha256: null,
      error: {
        code: "VERIFICATION_PROFILE_INVALID",
        message: `验证配置不可读：${path}（${
          error instanceof Error ? error.message : String(error)
        }）`,
      },
    };
  }
  return {
    text,
    sha256: createHash("sha256").update(text).digest("hex"),
    error: null,
  };
}

/** 解析并校验配置（不依赖 workdir），损坏也返回 valid=false 供 discovery 展示。 */
export function loadVerificationConfig(dataDir: string): {
  raw: VerificationConfigFile | null;
  items: VerificationProfileItem[];
  configVersion: 1 | null;
  configSha256: string | null;
  error: { code: string; message: string } | null;
} {
  const { text, sha256, error } = rawConfig(dataDir);
  if (error || text === null)
    return {
      raw: null,
      items: [],
      configVersion: null,
      configSha256: sha256,
      error,
    };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return {
      raw: null,
      items: [],
      configVersion: null,
      configSha256: sha256,
      error: {
        code: "VERIFICATION_PROFILE_INVALID",
        message: `验证配置 JSON 损坏：${
          e instanceof Error ? e.message : String(e)
        }`,
      },
    };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { profiles?: unknown }).profiles !== "object" ||
    (parsed as { profiles?: unknown }).profiles === null ||
    Array.isArray((parsed as { profiles?: unknown }).profiles)
  )
    return {
      raw: null,
      items: [],
      configVersion: null,
      configSha256: sha256,
      error: {
        code: "VERIFICATION_PROFILE_INVALID",
        message: "验证配置须为 {version:1, profiles:{...}}",
      },
    };
  const config = parsed as VerificationConfigFile;
  const items: VerificationProfileItem[] = [];
  const errorItem = (message: string) => ({
    raw: null,
    items: [] as VerificationProfileItem[],
    configVersion: 1 as const,
    configSha256: sha256,
    error: { code: "VERIFICATION_PROFILE_INVALID", message },
  });
  for (const [id, profile] of Object.entries(config.profiles)) {
    if (!PROFILE_ID.test(id))
      return errorItem(`profile ID 非法：${JSON.stringify(id)}`);
    if (
      typeof profile !== "object" ||
      profile === null ||
      Array.isArray(profile)
    )
      return errorItem(`profile ${id} 须为对象`);
    const command = profile.command;
    if (
      typeof command !== "string" ||
      command.trim() === "" ||
      /[\r\n\0]/.test(command)
    )
      return errorItem(`profile ${id} command 非法`);
    const args = profile.args;
    if (
      !Array.isArray(args) ||
      args.some((arg) => typeof arg !== "string" || /[\r\n\0]/.test(arg))
    )
      return errorItem(`profile ${id} args 须为字符串数组`);
    const cwd = profile.cwd === undefined ? "." : profile.cwd;
    if (typeof cwd !== "string" || cwd.trim() === "" || /[\r\n\0]/.test(cwd))
      return errorItem(`profile ${id} cwd 非法`);
    const timeout = profile.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    if (
      typeof timeout !== "number" ||
      !Number.isInteger(timeout) ||
      timeout < 1000 ||
      timeout > 3600000
    )
      return errorItem(`profile ${id} timeout_ms 须为 1000..3600000`);
    const maxOutput = profile.max_output_bytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (
      typeof maxOutput !== "number" ||
      !Number.isInteger(maxOutput) ||
      maxOutput < 1024 ||
      maxOutput > 1048576
    )
      return errorItem(`profile ${id} max_output_bytes 须为 1024..1048576`);
    items.push({
      id,
      command,
      args: [...args],
      cwd,
      timeout_ms: timeout,
      max_output_bytes: maxOutput,
      profile_sha256: profileItemDigest({
        command,
        args: [...args],
        cwd,
        timeout_ms: timeout,
        max_output_bytes: maxOutput,
      }),
    });
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return {
    raw: config,
    items,
    configVersion: 1,
    configSha256: sha256,
    error: null,
  };
}

export function profileItemDigest(p: {
  command: string;
  args: string[];
  cwd: string;
  timeout_ms: number;
  max_output_bytes: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        p.command,
        p.args,
        p.cwd,
        p.timeout_ms,
        p.max_output_bytes,
      ]),
    )
    .digest("hex");
}

/** 实际执行摘要：resolved command、args 与 cwd 均纳入 profile 摘要。 */
export function effectiveProfileDigest(p: {
  command: string;
  args: string[];
  cwd: string;
  timeout_ms: number;
  max_output_bytes: number;
}): string {
  return profileItemDigest(p);
}

/** 把相对 Run.workdir 的 cwd 解析为绝对路径，并检查存在且不越出。 */
export function resolveProfileCwd(workdir: string, cwd: string): string {
  const base = resolve(workdir);
  const full = isAbsolute(cwd) ? resolve(cwd) : resolve(base, cwd);
  const rel = relative(base, full);
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.includes(`..${sep}`))
    throw new AppError(
      "VERIFICATION_WORKDIR_INVALID",
      "配置 cwd 越出 Run.workdir",
      409,
      { cwd, workdir },
    );
  if (!existsSync(full) || !statSync(full).isDirectory())
    throw new AppError(
      "VERIFICATION_WORKDIR_INVALID",
      "配置 cwd 不存在或不是目录",
      409,
      { cwd, resolved: full },
    );
  return full;
}

/** 尽量把 PATH 名称解析为绝对路径；解析不到保留原值并标记 found=false（spawn 将给出 start_failed）。 */
export function resolveCommandInPath(
  command: string,
  cwd: string,
): { resolved: string; found: boolean } {
  if (command.includes("/") || command.includes("\\") || isAbsolute(command)) {
    const full = isAbsolute(command) ? command : resolve(cwd, command);
    try {
      return { resolved: full, found: statSync(full).isFile() };
    } catch {
      return { resolved: command, found: false };
    }
  }
  const path = process.env.PATH || "";
  for (const dir of path.split(":")) {
    if (!dir) continue;
    const candidate = join(dir, command);
    try {
      if (statSync(candidate).isFile()) return { resolved: candidate, found: true };
    } catch {
      // 继续在下一个 PATH 目录查找
    }
  }
  return { resolved: command, found: false };
}
