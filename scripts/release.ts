import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Local packaging only. Never publishes or overwrites an existing version.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
  version: string;
};
const releaseRoot = resolve(
  process.env.RELAYBOARD_RELEASE_DIR || join(root, "../releases"),
);
const destination = join(releaseRoot, pkg.version);
if (existsSync(destination))
  throw Error(
    `版本目录已存在：${destination}。先更新版本，或用 RELAYBOARD_RELEASE_DIR 指定新的验收目录；历史包保持原样。`,
  );
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
execFileSync(npm, ["run", "build"], { cwd: root, stdio: "inherit" });
mkdirSync(releaseRoot, { recursive: true });
const staging = mkdtempSync(join(releaseRoot, ".pack-"));
try {
  const result = JSON.parse(
    execFileSync(
      npm,
      ["pack", "--json", "--ignore-scripts", "--pack-destination", staging],
      { cwd: root, encoding: "utf8" },
    ),
  ) as { filename: string; integrity: string; files: { path: string }[] }[];
  const pack = result[0];
  const archive = readFileSync(join(staging, pack.filename));
  const sha256 = createHash("sha256").update(archive).digest("hex");
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  let commit: string | null = null;
  let dirty: boolean | null = null;
  try {
    commit = git(["rev-parse", "HEAD"]);
    dirty = !!git(["status", "--porcelain", "--untracked-files=no"]);
  } catch {
    /* Source archives need not contain .git. */
  }
  const metadata = {
    name: pkg.name,
    version: pkg.version,
    filename: pack.filename,
    sha256,
    integrity: pack.integrity,
    files: pack.files.length,
    commit,
    dirty,
    built_at: new Date().toISOString(),
  };
  writeFileSync(
    join(staging, "release.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );
  writeFileSync(join(staging, "SHA256SUMS"), `${sha256}  ${pack.filename}\n`);
  renameSync(staging, destination);
  writeFileSync(
    join(releaseRoot, "latest.json"),
    JSON.stringify(
      { version: pkg.version, directory: pkg.version, filename: pack.filename },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ directory: destination, ...metadata }, null, 2));
} catch (error) {
  console.error(`打包现场保留在 ${staging}，可检查后重试。`);
  throw error;
}
