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

`main` 保存已集成的代码。每轮改动先从最新 `main` 建立 `feat/<主题>`、`fix/<主题>` 或 `chore/<主题>` 分支，完成检查后提交并推送该分支，再通过 PR 合并。执行中的并行 Agent 使用独立实际 worktree；分支名称本身不隔离磁盘写入。

```bash
git switch main
git pull --ff-only
git switch -c feat/example
# 实现并检查
npm run check
git push -u origin HEAD
```

遵循 `skills/git-commit-style/SKILL.md`。旧迁移分支和本机未提交现场先保留，确认成果已集成后再归档。禁止用强推替代正常整合。

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
