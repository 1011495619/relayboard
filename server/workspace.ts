import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { resolve, relative } from "node:path";
import type { WorkspaceEvidence } from "./types.ts";

/** Observe scope contents, never test execution. HEAD is provenance, not content identity. */
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
    const paths = [
      ...new Set(
        git([
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
          "-z",
          "--",
          ...ranges,
        ])
          .split("\0")
          .filter(Boolean),
      ),
    ].sort();
    if (paths.length > 10000) throw new Error("文件数量超过观察预算");
    let bytes = 0;
    const files: Record<string, string> = Object.create(null);
    const hash = createHash("sha256")
      .update("scope-content-v2\0")
      .update(JSON.stringify([...ranges].sort()));
    for (const file of paths) {
      const full = resolve(workdir, file);
      if (relative(resolve(workdir), full).startsWith(".."))
        throw new Error("路径超出工作目录");
      let content: Buffer | string;
      let mode = "missing";
      try {
        const stat = lstatSync(full);
        if (!stat.isFile() && !stat.isSymbolicLink())
          throw new Error("特殊文件或子模块需单独验证");
        bytes += stat.size;
        if (bytes > 32 * 1024 * 1024) throw new Error("文件内容超过观察预算");
        mode = stat.isSymbolicLink()
          ? "symlink"
          : stat.mode & 0o111
            ? "executable"
            : "file";
        if (
          !stat.isSymbolicLink() &&
          relative(realpathSync(workdir), realpathSync(full)).startsWith("..")
        )
          throw new Error("符号链接祖先超出工作目录");
        content = stat.isSymbolicLink()
          ? readlinkSync(full)
          : readFileSync(full);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        continue;
      }
      const digest = createHash("sha256")
        .update(mode)
        .update("\0")
        .update(content)
        .digest("hex");
      files[file] = digest;
      hash.update(JSON.stringify([file, digest]));
    }
    return {
      ...base,
      source: "service_observed_git",
      revision,
      algorithm: "scope-content-v2",
      files,
      fingerprint: hash.digest("hex"),
    };
  } catch {
    return {
      ...base,
      reason:
        "Git 现场未完整观察（非仓库、尚无提交、特殊文件或超过观察预算）；测试仍由执行者报告",
    };
  }
}
