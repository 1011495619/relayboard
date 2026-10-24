import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { WorkspaceEvidence } from "./types.js";

/** Observes files, not whether a reported test command really ran. Never invokes a shell. */
export function observeWorkspace(
  workdir: string,
  scopes: string[],
): WorkspaceEvidence {
  const base: WorkspaceEvidence = {
    source: "unavailable",
    workdir,
    revision: null,
    fingerprint: null,
    observed_at: new Date().toISOString(),
    verification_source: "agent_reported",
  };
  if (!workdir) return { ...base, reason: "未登记工作目录；验证由执行者报告" };
  const git = (args: string[]) =>
    execFileSync("git", ["-C", workdir, ...args], {
      timeout: 3000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    const revision = git(["rev-parse", "HEAD"]).trim();
    const ranges = scopes.length ? scopes : ["."];
    const hash = createHash("sha256")
      .update(revision)
      .update(
        git([
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--binary",
          "HEAD",
          "--",
          ...ranges,
        ]),
      );
    const files = git([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ...ranges,
    ])
      .split("\0")
      .filter(Boolean)
      .sort();
    if (files.length > 200) throw new Error("未跟踪文件超过观察预算");
    let bytes = 0;
    for (const file of files) {
      const full = resolve(workdir, file);
      if (relative(resolve(workdir), full).startsWith(".."))
        throw new Error("文件路径超出目录");
      const stat = lstatSync(full);
      if (!stat.isFile()) throw new Error("未跟踪文件含符号链接或特殊文件");
      bytes += stat.size;
      if (bytes > 4 * 1024 * 1024) throw new Error("未跟踪文件超过观察预算");
      hash.update(file).update(readFileSync(full));
    }
    return {
      ...base,
      source: "service_observed_git",
      revision,
      fingerprint: hash.digest("hex"),
    };
  } catch {
    return {
      ...base,
      reason:
        "Git 现场未完整观察（非仓库、尚无提交或超过观察预算）；测试结果仍由执行者报告",
    };
  }
}
