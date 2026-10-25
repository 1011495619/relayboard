# 开发与目录约定

源码仓库只有一份，不按版本复制整个项目。日常从仓库目录运行 `npm ci`、`npm run check`、`npm start`。

| 目录                       | 用途                                 |
| -------------------------- | ------------------------------------ |
| `server/`、`bin/`          | 严格 TypeScript 服务与命令入口       |
| `web/`                     | 网页与 Base UI 组件                  |
| `integrations/`、`skills/` | 客户端扩展与协作规范                 |
| `tests/`、`scripts/`       | 回归检查与本地发布工具               |
| `docs/`                    | 项目维护文档                         |
| `lib/`、`dist/`            | 自动生成的服务和网页，不提交 Git     |
| `.relayboard/`             | 源码工作台原有的本机数据，不提交 Git |

## 分支与推送

只保留 `main` 和 `dev` 两个本地及远程分支。`main` 保存验证后的稳定代码；日常开发、修复和文档更新统一在 `dev`，通过检查后将 `dev` 合入 `main`。不再建立 feat、fix、chore 或迁移分支。

```bash
git switch dev
git pull --ff-only origin dev
# 实现并检查
npm run check
git push -u origin dev
# 通过 dev → main 的 PR 集成；main 合并后将 dev 快进到 main 并推送
```

遵循 `skills/git-commit-style/SKILL.md`。同时运行多个写入 Agent 时使用临时 detached HEAD worktree 和明确范围，避免创建额外命名分支；完成后串行集成到 dev，并移除临时工作区。分支名称本身不隔离磁盘写入。

旧工作区先保存全分支 Git bundle、暂存/未暂存补丁及文件快照，压缩后实际解压并核对哈希，再移除展开副本。旧版本、调试资料、数据库备份保存在本机单份历史压缩包中；可重新下载的安装缓存直接清理。当前源码、运行数据库及必要的 node_modules、lib、dist 保留。不要用强推替代正常整合。

## 本地版本产物

先更新 `package.json` 和锁文件的版本，执行检查，再运行：

```bash
npm run check
npm run release:local
```

默认在仓库的同级 `releases/<版本>/` 生成 npm 包、`release.json` 和 `SHA256SUMS`，发布根目录的 `latest.json` 指向最近生成版本。版本目录已存在时停止，历史包不覆盖。自定义目录：

```bash
RELAYBOARD_RELEASE_DIR=/absolute/path/to/releases npm run release:local
```

该命令只构建和打包；Git 推送、GitHub Release 及 npm 发布是独立操作。包内白名单保持 `package.json` 的 `files` 配置，数据库、缓存、测试现场及原始使用日志留在本机。验收输出按 `evidence/<版本>/` 保存，临时缓存和旧会话材料统一进工作区归档，避免放在源码根目录。

本机整理时保留源码和数据库的原绝对路径；旧产物位置可通过工作区的迁移清单查到新位置。原始 Agent 使用报告完整留在本机 `evidence/feedback/`，公开仓库以 README、VALIDATION 和维护文档描述已验证行为。
