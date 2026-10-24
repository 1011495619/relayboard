import type { AddressInfo } from "node:net";
import { errorInfo } from "../bin/errors.js";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createApp } from "./app.js";
import { defaultDataDir, packageRoot } from "./config.js";

function openBrowser(url: string) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  execFile(command, args, (error) => {
    if (error) console.error(`请在浏览器打开 ${url}`);
  });
}

export async function startServer({
  port = Number(process.env.PORT || 4317),
  dataDir,
  open = false,
  log = console.log,
}: {
  port?: number;
  dataDir?: string;
  open?: boolean;
  log?: (message: string) => void;
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw Error("端口须为 1–65535 的整数");
  if (!existsSync(join(packageRoot, "dist", "index.html")))
    throw Error(
      "缺少网页构建文件。源码开发请先执行 npm run build；安装包已包含网页。",
    );
  const baseUrl = `http://127.0.0.1:${port}`;
  if (port) {
    let existing:
      { service?: string; ok?: boolean; data_dir?: string } | undefined;
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) existing = await response.json();
    } catch {
      /* The listening socket is checked again by listen(). */
    }
    if (existing?.service === "relayboard" && existing.ok) {
      const requestedDir = dataDir || process.env.RELAYBOARD_DATA_DIR;
      if (
        requestedDir &&
        resolve(requestedDir) !== resolve(existing.data_dir || "")
      )
        throw Error(
          `端口 ${port} 上的 Relayboard 使用其他数据目录。请使用 --port 指定另一端口。`,
        );
      log(`Relayboard 已在运行：${baseUrl}\n数据：${existing.data_dir}`);
      if (open) openBrowser(baseUrl);
      return { reused: true as const, url: baseUrl };
    }
  }
  const actualDataDir = resolve(dataDir || defaultDataDir());
  const instance = createApp({ port, dataDir: actualDataDir });
  const server = instance.app.listen(port, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
  } catch (error) {
    await instance.close();
    if (errorInfo(error).code === "EADDRINUSE")
      throw Error(
        `端口 ${port} 已被其他服务占用，请使用 --port 指定另一端口。`,
      );
    throw error;
  }
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  instance.runner.baseUrl = url;
  instance.runner.recover();
  instance.scheduler.start();
  log(
    `Relayboard ${url}\nMCP ${url}/mcp\n数据：${actualDataDir}\n按 Ctrl+C 停止服务，任务记录会保留。`,
  );
  if (open) openBrowser(url);
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ||= (async () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      await instance.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    })());
  const onSignal = () => {
    void close();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return { ...instance, server, url, reused: false as const, close };
}
