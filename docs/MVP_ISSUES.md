# Daytrace v0.1 开发任务清单

版本：0.2 ｜ 日期：2026-09-03

修订说明：初版有 66 条 P0 任务、37 条 P1（见 `archive/v0.1/MVP_ISSUES.md`），量级是单人 6-12 个月。本版把 v0.1 的 P0 压到 21 条，目标是两周跑通闭环。每条尽量标注可借鉴来源，`[借鉴]` 表示不要从零实现，先去读 [PRIOR_ART](./PRIOR_ART.md) 里对应的项目。

优先级只有两档：**P0 = v0.1 必须完成**，**P1 = 阶段 B 及以后**。取消 P2 —— 想不清楚要不要做的东西不进清单。

## 实现状态（2026-09-03）

骨架已在仓库根目录（[`src/`](../src/)）跑通：零依赖 ESM JavaScript，34 个单元测试全绿，约 2100 行代码。21 条 P0 里 20 条已完成。

已实测通过：`daytrace today` / `date` / `week` / `show` / `where` / `init` / `purge`；同一天连跑两次输出逐字节相同且数据库不增行；全程零网络（代码里没有任何网络 API）；Claude Code 与 Codex 两个适配器都在真实数据上出过东西。

**第一次 GitHub Actions 结果（macOS + Windows × Node 22.5 / 24 / 25）**：两个平台的 Node 24 与 25 全绿，两个平台的 22.5 全红。原因不是平台而是版本 —— `node:sqlite` 直到 22.13 / 23.4 才不再需要 `--experimental-sqlite`，详见 [ADR-018](./ADR.md)。已把版本下限改为 `>=22.13.0 <23.0.0 || >=23.4.0`，并在 CLI 入口加了版本闸门。

因此这两条风险已经解除：**Windows 代码路径在 Node 24/25 上确认可用**（ADR-011 的第一份实证），CI 也已在 GitHub 上真跑过。

尚未验证的部分（诚实标注）：

- 修正后的矩阵（22.13 / 24 / 25）尚未在 GitHub 上跑过，22.13 这一格是按 Node 官方版本历史推断能通，不是实测。
- 用户重命名项目的持久化只做了配置里的 `rules` 规则，没有对应的 CLI 命令（Epic 6 第 2 条仍未完成）。
- 会话注入内容的过滤是按实机观察到的模式做的黑名单，新版本 CLI 可能引入新的注入格式，需要持续补。

## Epic 1：工程基础（3 条 P0）

- [x] P0 初始化零依赖 Node CLI 工程（不引入 Tauri、不引入 Rust、不引入任何第三方包）。选型理由见 [ADR-012](./ADR.md)。
- [x] P0 添加 `LICENSE`（MIT）、`THIRD_PARTY_NOTICES.md`、最简 README（含 60 秒快速开始）。
- [x] P0 GitHub Actions 双平台矩阵：`macos-latest` + `windows-latest`，各跑 `npm test` 与一次真实目录冒烟测试。

不做（延后到阶段 F）：格式化与静态检查门禁、贡献指南、行为准则、Issue 模板、威胁模型、双语文档。

## Epic 2：存储（3 条 P0）

数据表从初版的 20 张压到 6 张：`projects`、`sessions`、`commits`、`evidence`、`facts`、`journals`。理由见 [ADR-017](./ADR.md)。存储驱动用 Node 内置 `node:sqlite`（需 Node ≥ 22.13 或 ≥ 23.4，含 FTS5），不引入原生模块。

- [x] P0 建表 + 迁移机制（版本表 + 顺序迁移脚本）。**迁移必须在第一次发版前就位**，本地 SQLite 应用一旦发版没有迁移就回不了头。
- [x] P0 `evidence` 表唯一约束：`(source_type, source_ref, local_date)`，保证重复扫描幂等。`source_ref` 对 commit 是 hash，对会话是 `sessionId#消息序号`。
- [x] P0 数据目录跨平台规范：macOS `~/Library/Application Support/daytrace`，Windows `%APPDATA%\daytrace`；提供 `daytrace where` 打印路径、`daytrace purge` 彻底删除。

## Epic 3：Git 采集（4 条 P0）

- [x] P0 发现指定根目录下的 git 仓库（默认从配置的项目根 + 会话 `cwd` 反查）。`[借鉴]` devlog `src/gitlog.rs`
- [x] P0 读取当日 commit：hash、message、author、时间、分支。
- [x] P0 读取 `diff --stat`：文件数、增删行数。**默认不读 diff 正文。**
- [x] P0 处理 `git` 不在 PATH 上的情况（Windows 常见）：给出明确的安装提示而不是崩溃。

## Epic 4：AI 会话采集（5 条 P0，本项目的输入核心）

全部 `[借鉴]` devlog `src/transcript.rs` 与 `src/codex.rs`，规则已在 [PRIOR_ART §3.1](./PRIOR_ART.md) 逐条列出，照抄即可。

- [x] P0 读 `~/.claude/projects/*/*.jsonl`：按文件 mtime 预剪枝；每行要求 `sessionId`；只留 `type ∈ {user, assistant}`；`type: ai-title` 取 `aiTitle` 作标题且不受时间窗口限制。
- [x] P0 读 `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<thread_id>.jsonl`：首行 `session_meta.payload` 取 `id`、`timestamp`、`cwd`、`git`、`cli_version`。
- [x] P0 **跳过 `isSidechain: true` 的记录**（子 agent 转录，工作已在主链出现，不跳会重复计数）。
- [x] P0 正文提取只取 `type: text` 块，丢弃所有工具结果与 harness 注入内容；行为提取只看 `tool_use`：`Edit`/`Write`/`MultiEdit`/`NotebookEdit` → `input.file_path`，`Bash` → `input.description` 退化到 `input.command` 截 80 字符。
- [x] P0 跨平台会话路径解析：macOS/Linux `~/.codex`、`~/.claude`；Windows `%USERPROFILE%\.codex`、`%USERPROFILE%\.claude`。解析不到时降级为「无会话证据」而不是报错。

## Epic 5：时间与日界（2 条 P0）

初版全文 0 次出现「时区 / 日界 / 跨天」，对日报工具是硬缺口。

- [x] P0 所有时间戳按 UTC 存储；判定「属于哪一天」时用可配置日界（默认本地 04:00）+ 半开区间 `[start, end)`。`[借鉴]` devlog 的时间窗口处理
- [x] P0 `evidence` 同时存 `occurred_at`（UTC）与 `local_date`（按日界折算），搜索和分组用后者。换时区后重新折算不改动原始时间戳。

## Epic 6：项目归因与聚合（2 条 P0）

- [x] P0 归因优先级：会话 `cwd` / `gitBranch` → git 仓库根 → 用户配置的 glob 规则。冲突时用户规则优先。
- [ ] P0 支持用户重命名项目并持久化，下次扫描沿用。

不做（延后）：目录层级自动分模块、按文件类型聚合、模块合并拆分、依赖关系分析。这些是初版 Epic 5 的内容，在没有真实用户抱怨「项目粒度太粗」之前不做。

## Epic 7：事实、引用与输出（2 条 P0）

- [x] P0 事实对象：`{ text, source_ids[], confidence, project_id, occurred_at }`；`confidence ∈ {confirmed, inferred, unverified}`。
- [x] P0 纯规则生成 Markdown 草稿（零模型调用），每条要点带 `[^evN]` 脚注，项目名写成 `[[项目名]]` wiki-link；`--out` 写入指定目录。

## v0.1 完成定义

同时满足以下 8 条才算完成：

1. macOS 与 Windows 上 `npm i -g` 后直接可用，无需 Rust、无需编译原生模块。
2. `daytrace today` 全程零网络请求、零 API key，仍能产出有内容的日志。
3. 同一天连跑两次，输出逐字节相同，数据库不产生重复证据。
4. 每条输出要点都能通过脚注定位到 commit hash 或 `sessionId#消息序号`。
5. 会话里 `isSidechain: true` 的内容不出现在结果中。
6. 默认不读文件正文、不读 diff 正文，代码里只有一处读取入口且带审计钩子。
7. `daytrace where` 能打印数据位置，`daytrace purge` 能彻底删除。
8. 作者本人连续 5 个工作日用它产出日志（这条不通过，前 7 条都不算数）。

## 阶段 B 之后的 P1（不在 v0.1 范围内，列出以免遗忘）

- [ ] P1 引用完整性校验：`source_id` 不存在则强制降级为 `unverified`。
- [ ] P1 FTS5 全文搜索 + `daytrace show <evidence_id>`。
- [ ] P1 Provider 接口 + Ollama / OpenAI 兼容端点 + `--no-llm`（默认）。
- [ ] P1 脱敏管道与熔断策略。`[借鉴]` obsidian-daily-digest `src/filter/sanitize.ts`、`sensitivity.ts`
- [ ] P1 `--preview` 发送前预览 + 两层预算 + `ai_runs` 账本 + 结果缓存。
- [ ] P1 受管设备模式（永久禁用外发的配置项）。
- [ ] P1 周报 / 月报模板。`[借鉴]` devlog 的 `standup` / `weekly` 模板
- [ ] P1 多工具适配器（Cursor、opencode、VS Code、shell 历史、GitHub）。`[借鉴]` worklog 的 12 源清单
- [ ] P1 空状态处理：今天什么都没干时输出「无可记录活动」而不是空文件。
- [ ] P1 Markdown 输出的注入防护：外链图片默认不渲染 / 转纯文本，防止会话或 diff 里的恶意内容在渲染时外发数据。
- [ ] P1 数据备份与恢复；SQLite 库放在 iCloud / OneDrive 同步目录时的告警。

