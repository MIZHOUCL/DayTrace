# DayTrace

把今天真实发生过的工作痕迹，整理成一份**每一句话都能点回证据**的日志。

零依赖、零网络、不需要 API key。macOS 与 Windows 通用。

[English](./README.en.md)

## 60 秒上手

```bash
git clone https://github.com/MIZHOUCL/DayTrace.git
cd DayTrace
node bin/daytrace.js today --root ~/code
```

看着顺眼的话再装成全局命令：

```bash
npm link          # 或 npm i -g .
daytrace today
```

需要 Node ≥ 22.5（用到内置的 `node:sqlite`）。**没有任何第三方依赖**，`npm i` 不需要编译器、不需要 Rust。

## 它做什么

```text
daytrace today
  → 读 git：当日 commit + diff --stat + 工作树状态
  → 读本地 AI 会话：~/.claude/projects/**、~/.codex/sessions/**
  → 按会话的 cwd / gitBranch 归到项目
  → 纯规则生成带脚注引用的 Markdown（零模型调用）
  → 写入 --out 指定目录（可以是 Obsidian vault）
```

输出长这样：

```markdown
## [[novel-ide]]

- 提交「把 hash 缓存换成延迟计算」（3 个文件，+180 −35）[^ev1]
- Claude Code 会话：重构增量扫描器，改动 6 个文件[^ev2][^ev3]

[^ev1]: commit `1a2b3c4` — 把 hash 缓存换成延迟计算（2026-09-03T06:22:00Z）
[^ev2]: 会话 `a1b2c3d4` 第 42 条消息（2026-09-03T14:22:11Z）：帮我把扫描器的 hash 改成延迟计算
[^ev3]: 会话 `a1b2c3d4` 的操作 — file: src/scanner.ts
```

每条要点都带脚注，`daytrace show commit:1a2b3c4` 能把原始证据打出来。无法关联到证据的句子会被标成 `unverified`，不会假装成事实。

## 为什么还要做一个日报工具

已经有三个 MIT 开源项目在读 AI 会话 + git 生成日报（完整对照见 [docs/PRIOR_ART.md](./docs/PRIOR_ART.md)）。它们的证据归因都停在**会话级**：打一个 `[Claude Code]` 标签、写进 frontmatter、按仓库分组。

DayTrace 只赌一件事：**逐句可追溯** —— 每条要点都带 `source_ids`，指向具体某个 commit 或某个会话的第几条消息，并标注 `confirmed` / `inferred` / `unverified`。生成后有一道强制的引用完整性校验：`source_id` 在证据表里不存在，这句话就被降级，而不是让一条编造的引用混过去。

扫描、聚合、脱敏、本地模型降级这些能力不作为卖点 —— 能借鉴的就借鉴，见 [docs/PRIOR_ART.md](./docs/PRIOR_ART.md)。

## 项目状态

早期。骨架已端到端跑通，v0.1 的 21 条 P0 完成 20 条。诚实的清单在 [docs/MVP_ISSUES.md](./docs/MVP_ISSUES.md)，其中两条要特别说明：**Windows 代码路径从未在 Windows 上执行过**，CI 也还没在 GitHub 上真跑过。欢迎在 Windows 上跑一次 `node --test` 然后开 issue 告诉我结果。

## 命令

| 命令 | 作用 |
|---|---|
| `daytrace today` | 生成今天的日志 |
| `daytrace date 2026-09-03` | 生成指定日期的日志 |
| `daytrace week [日期]` | 截止到该日的 7 天汇总 |
| `daytrace show commit:1a2b3c4` | 查看某条证据（支持 hash 前缀） |
| `daytrace where` | 打印数据目录、数据库、配置路径 |
| `daytrace init` | 写出默认配置文件 |
| `daytrace purge --yes` | 删除全部本地数据 |

常用选项：`--root <dir>`（可重复）、`--out <dir>`、`--cutoff <小时>`、`--author <名字或邮箱>`、`--json`、`--dry-run`。

在公共仓库里工作时建议加 `--author`，否则会把别人的 commit 也算进你的日志。

## 关于「今天」

`--cutoff` 是本地日界，默认 **04:00**：凌晨两点写的代码算前一天。所有时间戳按 UTC 存储，归属日单独折算，换时区不会改动原始数据。

## 隐私默认值

- 只读三类位置：你指定的 git 仓库、`~/.claude/projects`、`~/.codex/sessions`。
- 只读 git 元数据与**会话里的用户输入**；不读文件正文、不读 diff 正文、不读助手回复。
- **代码里没有任何网络调用**（可自行 `grep -rE "fetch\(|node:http" src`）。
- 数据只存本地 SQLite。`daytrace where` 看位置，`daytrace purge --yes` 彻底删除。
- 输出里的外链图片会降级为纯文本，避免会话或 diff 内容在渲染时外发。

数据目录：macOS `~/Library/Application Support/daytrace`，Windows `%APPDATA%\daytrace`。可用 `DAYTRACE_DATA_DIR` 覆盖。放在 iCloud / OneDrive 同步目录里会告警（SQLite WAL 在同步目录下有损坏风险）。

## 配置

`daytrace init` 会在数据目录写出 `config.json`：

```json
{
  "cutoffHour": 4,
  "roots": ["/Users/me/code"],
  "authorFilter": "me@example.com",
  "out": "/Users/me/Obsidian/daily",
  "managedDevice": false,
  "ai": { "enabled": false }
}
```

`managedDevice: true` 用于公司受管电脑：永久禁用一切外发。

## 开发

```bash
node --test          # 28 个测试，零依赖
node --check src/cli.js
node bin/daytrace.js today --dry-run   # 不写库、不写文件
```

代码组织：`src/time.js` 日界 ｜ `src/db.js` 6 张表与迁移 ｜ `src/collect/git.js` git 采集 ｜ `src/collect/providers/*` 会话适配器 ｜ `src/facts.js` 事实与引用校验 ｜ `src/render.js` Markdown。

规划与决策文档在 [docs/](./docs/)：[规划书](./docs/PROJECT_PLAN.md)｜[Roadmap](./docs/ROADMAP.md)｜[任务清单](./docs/MVP_ISSUES.md)｜[决策记录](./docs/ADR.md)｜[竞品与借鉴清单](./docs/PRIOR_ART.md)。

## 借鉴与许可

MIT。会话解析规则借鉴 [temosy/devlog](https://github.com/temosy/devlog)（MIT），归属声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

