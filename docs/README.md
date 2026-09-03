# Daytrace

把今天真实发生过的工作痕迹，整理成一份**每一句话都能点回证据**的日志。

版本：规划 v0.2（2026-09-03 修订，尚无代码）｜ 许可证：MIT ｜ 平台：macOS + Windows

## 为什么还要做一个日报工具

已经有三个 MIT 开源项目在做「读 AI 会话 + git 生成日报」，功能上覆盖了本项目原计划的大部分：

| 项目 | 形态 | stars | commits |
|---|---|---:|---:|
| [temosy/devlog](https://github.com/temosy/devlog) | Rust CLI | 0 | 3 |
| [jvalentini/worklog](https://github.com/jvalentini/worklog) | TS CLI + 仪表盘 | 1 | 184 |
| [brianruggieri/obsidian-daily-digest](https://github.com/brianruggieri/obsidian-daily-digest) | Obsidian 插件 | 2 | 359 |

它们的证据归因都停在**会话级**：打 `[Claude Code]` 标签、写 frontmatter、按仓库分组。

**Daytrace 只赌一件事：日报里的每一句话都带来源，能点回具体 commit、具体会话的具体那一条消息，并标注 `confirmed` / `inferred` / `unverified`。**

其余能力（会话读取、多仓库聚合、脱敏、本地模型降级、写入 vault）一律优先借鉴而不是重造，清单见 [竞品对照与借鉴清单](./PRIOR_ART.md)。

## 一句话产出长什么样

```markdown
## novel-ide

- 把增量扫描器的 hash 缓存换成延迟计算，重复扫描不再读未变化文件。[^ev1][^ev2]
- 疑似顺带修了一个重命名检测的边界问题。[^ev3] `inferred`

[^ev1]: commit `1a2b3c4` — `src/scanner.ts` +180 −35
[^ev2]: Claude Code 会话 `a1b2c3d4` 第 42 条消息（2026-09-03 14:22Z）
[^ev3]: Codex 会话 `019f1234` 第 7 条消息 — 未经确认，点此确认或删除
```

点任意一条脚注，跳到原始证据。没有证据支撑的句子不会以 `confirmed` 出现。

## 最小闭环（两周目标）

```text
daytrace today
  → 读 git：今天的 commit + 工作树状态 + diff --stat
  → 读本地 AI 会话：~/.claude/projects/**、~/.codex/sessions/**
  → 按会话的 cwd / gitBranch 归到项目
  → 本地规则生成带脚注引用的 Markdown 草稿
  → 写入 --out 指定目录（可以是 Obsidian vault）
```

默认状态：**不联网、不需要 API key、不读文件正文。** 装上就能用，AI 摘要是可选增强而不是前提。

## 形态与平台

- **v0.1 是一个 Node CLI**，不是桌面应用。理由：双平台零签名成本（未公证的 macOS 应用会被 Gatekeeper 拦，Apple Developer 账号 99 美元/年；无 EV 证书的 Windows 安装包会弹 SmartScreen 警告），且公司受管电脑通常不允许装未签名应用，而 CLI 不受此限。
- macOS 与 Windows 是**同等一等公民**，从第一个 commit 起双平台 CI。
- 桌面壳 / Obsidian 插件推到 v0.4 之后，按真实用户反馈二选一，见 [ROADMAP](./ROADMAP.md)。

## 隐私默认值

- 只读用户明确指定的目录：git 仓库、`~/.claude/projects`、`~/.codex/sessions`。
- 默认只读**会话的用户消息**与 **git 元数据**，不读文件正文、不读 diff 正文。
- 默认不发送任何内容到网络。启用 AI 摘要需要显式开关 + 发送前预览。
- 检出高危密钥模式时**整块拒发**，不做替换后继续。
- 提供受管设备模式：一个配置项永久禁用一切外发，供公司电脑使用。

## 文档索引

- [项目规划书](./PROJECT_PLAN.md) — 定位、范围、证据模型、数据结构、验收标准
- [Roadmap](./ROADMAP.md) — 阶段划分与可测的退出标准
- [开发任务清单](./MVP_ISSUES.md) — v0.1 的 P0 任务，逐条标注可借鉴来源
- [关键技术决策记录](./ADR.md)
- [竞品对照与借鉴清单](./PRIOR_ART.md) — 抄什么、从哪抄、怎么合法抄
- [第三方归属声明](../THIRD_PARTY_NOTICES.md)
- [archive/v0.1/](./archive/v0.1/) — 修订前的初版规划，保留备查

## 与初版规划的主要差异

初版规划（`archive/v0.1/`）是一份 66 条 P0 任务、含自建 Graph View、20 张数据表、5 层 token 预算体系、Windows-only 的桌面应用计划。修订依据与逐项理由见 [ADR](./ADR.md)，主要变化：

1. 定位从「工作证据图谱 + AI 日志助手」收窄为「逐句可追溯的日志」。
2. 形态从 Tauri 桌面应用改为 Node CLI，平台从 Windows-only 改为 macOS + Windows 双平台。
3. 会话内容获取从「用户手动粘贴」改为「读本地会话文件」——实测 Codex 单个会话中位 229KB、正文中位约 6 万字符，手动粘贴在物理上不成立。
4. 删除自建 Graph View，改为输出 wiki-link 让 Obsidian / Logseq 免费提供图谱。
5. 数据表从 20 张压到 6 张，token 预算从 5 层压到 2 层。
6. 开源工程化交付物（威胁模型、行为准则、双语文档等）延后到出现第 2 个真实用户之后。

