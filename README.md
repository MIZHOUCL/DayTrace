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

需要 Node ≥ 22.13（23.x 线则需 ≥ 23.4）—— 内置的 `node:sqlite` 从这两个版本起才不再需要 `--experimental-sqlite`。**没有任何第三方依赖**，`npm i` 不需要编译器、不需要 Rust。

## 它做什么

```text
daytrace today
  → 读 git：当日 commit + diff --stat + 工作树状态
  → 扫文件：--root 下仓库外今天改动过的文件（只记路径与时间）
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

## 模块：一天的活分成几块

一天的原始证据可能上百条，平铺出来没有重点。`daytrace modules` 把它们按「项目 + 时间连续性」聚成模块 —— 同一项目里间隔超过 90 分钟就算两段工作：

```text
2026-09-05 共 6 个模块（按权重排序）

● [代码] 项目可行性与实用性
    AI_log｜21:35-23:17｜7 提问、10 命令、6 文件｜权重 79.8
● [代码] 改动 9 个文件：src/、collect/（.js）
    daytrace｜22:06-23:16｜9 文件｜权重 14.3
● [文档] 改动 6 个文件：decisions/、docs/（.md）
    novel_ide｜21:34-22:26｜6 文件｜权重 10.5
○ [杂项] 零散文件改动 11 个
    杂项｜20:26｜11 文件｜权重 0

● = 默认写进日记，○ = 默认排除
```

标题优先用 commit message，其次会话标题，再退到首条提问，最后才是目录与扩展名概述。权重里**文件数按平方根计**——一个目录被碰了 60 个文件，说明的事情并不比 6 个多十倍。没有提问也没有提交、只有零星文件的项目会并进「杂项」并默认排除。

这是给前端准备的选择单位：你勾掉不想写进日记的模块，剩下的才交给模型去写。

## 为什么还要做一个日报工具

已经有三个 MIT 开源项目在读 AI 会话 + git 生成日报（完整对照见 [docs/PRIOR_ART.md](./docs/PRIOR_ART.md)）。它们的证据归因都停在**会话级**：打一个 `[Claude Code]` 标签、写进 frontmatter、按仓库分组。

DayTrace 只赌一件事：**逐句可追溯** —— 每条要点都带 `source_ids`，指向具体某个 commit 或某个会话的第几条消息，并标注 `confirmed` / `inferred` / `unverified`。生成后有一道强制的引用完整性校验：`source_id` 在证据表里不存在，这句话就被降级，而不是让一条编造的引用混过去。

扫描、聚合、脱敏、本地模型降级这些能力不作为卖点 —— 能借鉴的就借鉴，见 [docs/PRIOR_ART.md](./docs/PRIOR_ART.md)。

## 项目状态

早期。骨架已端到端跑通，v0.1 的 21 条 P0 完成 20 条，34 个单元测试。

CI 已在 GitHub 上跑过：**macOS 与 Windows 在 Node 24 / 25 上全绿**。Node 22.5 曾经全红 —— 原因是 `node:sqlite` 直到 22.13 / 23.4 才不再需要 `--experimental-sqlite`，现已把版本下限改正并在入口加了检查（[ADR-018](./docs/ADR.md)）。

诚实的清单在 [docs/MVP_ISSUES.md](./docs/MVP_ISSUES.md)。欢迎开 issue 告诉我它在你的环境里表现如何。

## 命令

| 命令 | 作用 |
|---|---|
| `daytrace today` | 生成今天的日志 |
| `daytrace date 2026-09-03` | 生成指定日期的日志 |
| `daytrace week [日期]` | 截止到该日的 7 天汇总 |
| `daytrace modules [日期]` | 列出当天的**模块**（写日记的选择单位，按权重排序） |
| `daytrace show commit:1a2b3c4` | 查看某条证据（支持 hash 前缀） |
| `daytrace where` | 打印数据目录、数据库、配置路径 |
| `daytrace init` | 写出默认配置文件 |
| `daytrace purge --yes` | 删除全部本地数据 |

常用选项：`--root <dir>`（可重复）、`--out <dir>`、`--cutoff <小时>`、`--tz <IANA 时区>`、`--author <名字或邮箱>`、`--no-files`、`--json`、`--dry-run`。

**`--root` 是最重要的一个**：它决定去哪里找 git 仓库和文件改动。不给的话默认只看当前目录，如果当前目录不是你的项目目录，日志里就只有 AI 会话。

在公共仓库里工作时建议加 `--author`，否则会把别人的 commit 也算进你的日志。

## 关于「今天」

`--cutoff` 是本地日界，默认 **04:00**：凌晨两点写的代码算前一天。

**时区默认跟随你这台电脑**，不需要配置 —— 在 UTC+8 的机器上 `daytrace today` 就按 UTC+8 判断"今天"。`daytrace where` 会把当前生效的时区和偏移打印出来，日志页脚也会写明。

想固定用某个时区（比如出差换了时区但希望日志仍按公司时区归属），用 `--tz Asia/Shanghai` 或在 `config.json` 里写 `"timezone": "Asia/Shanghai"`。只接受 IANA 名字（`Asia/Shanghai`、`America/New_York`、`UTC`），写 `UTC+8` 这种会直接报错而不是静默按 UTC 跑。

所有时间戳按 UTC 存库，归属日单独折算，所以换时区只影响分组，不改动原始数据。夏令时也是对的：`America/New_York` 在 2026-03-08 只有 23 小时、2026-11-01 有 25 小时，有测试盯着。

## 隐私默认值

- 只读你指定的位置：`--root` 下的目录（git 仓库 + 仓库外的文件改动）、`~/.claude/projects`、`~/.codex/sessions`。不扫全盘。
- 文件扫描只记**路径、修改时间、大小**，不读内容；跳过点文件、`node_modules` 这类体积目录、以及 `.env` / `*.pem` / `id_rsa` 这类疑似敏感文件（连路径都不记）。`--no-files` 可整体关闭。
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
  "timezone": null,
  "roots": ["/Users/me/code"],
  "authorFilter": "me@example.com",
  "out": "/Users/me/Obsidian/daily",
  "fileScan": { "enabled": true, "maxDepth": 6, "maxFiles": 5000, "extraExcludes": [] },
  "managedDevice": false,
  "ai": { "enabled": false }
}
```

`managedDevice: true` 用于公司受管电脑：永久禁用一切外发。

## 开发

```bash
node --test          # 58 个测试，零依赖
node --check src/cli.js
node bin/daytrace.js today --dry-run   # 不写库、不写文件
```

代码组织：`src/time.js` 日界与时区 ｜ `src/db.js` 6 张表与迁移 ｜ `src/collect/git.js` git ｜ `src/collect/files.js` 文件扫描与噪音过滤 ｜ `src/collect/providers/*` 会话适配器 ｜ `src/attribute.js` 项目归因 ｜ `src/modules.js` 模块聚类 ｜ `src/facts.js` 事实与引用校验 ｜ `src/render.js` Markdown。

规划与决策文档在 [docs/](./docs/)：[规划书](./docs/PROJECT_PLAN.md)｜[Roadmap](./docs/ROADMAP.md)｜[任务清单](./docs/MVP_ISSUES.md)｜[决策记录](./docs/ADR.md)｜[竞品与借鉴清单](./docs/PRIOR_ART.md)。

## 借鉴与许可

MIT。会话解析规则借鉴 [temosy/devlog](https://github.com/temosy/devlog)（MIT），归属声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

