---
name: git-commit-style
description: "Use when committing code or writing commit messages."
---

# Git Commit Style

## 触发条件
当用户让我提交代码、写 commit message 时激活。

## 行为规则
### Commit Message 格式
- 第一行：类型(范围): 简述（不超过 50 字符）
- 空一行
- 正文：解释为什么改，不要写「修改了 XX 文件」

### 类型枚举
- feat: 新功能
- fix: 修 bug
- refactor: 重构
- docs: 文档

## 约束
- 正文用中文，类型用英文
- 一个 commit 只做一件事

## 示例
feat(auth): 支持微信扫码登录

之前只能用手机号登录，微信用户得先绑定手机号，流程太长。
现在直接扫码就能登录。
