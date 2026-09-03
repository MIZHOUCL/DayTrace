# Daytrace 竞品对照与借鉴清单

版本：0.1 ｜ 日期：2026-09-03 ｜ 状态：Accepted

这份文档的作用是把「哪些功能已经有人做完了、可以直接借鉴」写死，避免重复实现，也避免把已被别人做完的能力当成卖点宣传。

所有结论都在 2026-09-03 通过抓取各仓库页面核实过。star / commit 数会变化，重新评估时请复核。

## 1. 总表

| 项目 | 形态 / 语言 | 许可证 | commits | stars | 与 Daytrace 重叠的能力 |
|---|---|---|---:|---:|---|
| [temosy/devlog](https://github.com/temosy/devlog) | CLI / Rust | MIT | 3 | 0 | 读 Claude Code + Codex 会话 JSONL；从会话 cwd 与被改文件自动发现 git 仓库；按项目分组出 Markdown；Ollama 本地模型；`--no-llm` 降级；standup / weekly 模板；`--out` 写入 Obsidian vault |
| [jvalentini/worklog](https://github.com/jvalentini/worklog) | CLI / TypeScript + Bun | MIT | 184 | 1 | 12 个数据源适配器（claude、codex、opencode、factory、cursor、vscode、git、github、terminal、filesystem、calendar、slack）；全文搜索；localhost:3000 仪表盘；定时快照；Markdown / JSON / Slack 输出 |
| [brianruggieri/obsidian-daily-digest](https://github.com/brianruggieri/obsidian-daily-digest) | Obsidian 插件 / TypeScript | MIT | 359 | 2 | 浏览器历史（只读副本 + sql.js）、搜索词、Claude Code 提示词、Codex、git commit；密钥/PII 脱敏正则集；419 域名 / 11 类敏感过滤；四级隐私降级 + 自动选最私密档 + 发送前预览弹窗；本地模型默认；无遥测；3-6 秒出结果；Dataview frontmatter |
| [reorproject/reor](https://github.com/reorproject/reor) | 桌面应用 / TS | **AGPL-3.0** | 2130 | 8.6k | local-first AI 个人知识库（Ollama + LanceDB + Transformers.js），Mac/Linux/Windows 安装包 |

两条必须记住的事实：

1. 前三个项目功能上覆盖了 Daytrace v0.1 原计划的大部分，加起来只有 **3 个 star**。在这个品类里功能不是瓶颈，差异化和分发才是。
2. Reor 拿到 8.6k star、527 fork，**2026-03-07 被作者归档**，留下 113 个未处理 issue。个人维护的 local-first AI 工具，天花板不是能力而是维护带宽。

## 2. 唯一没有人做的事

三个项目的证据归因都停在**会话级**：devlog 给每段打 `[Claude Code]` / `[Codex]` 标签，obsidian-daily-digest 写到 frontmatter，worklog 按仓库分组。

**没有任何一个做到「日报里每一句话带 source_ids，能点回具体 commit、具体会话的具体那一条消息，并标注 confirmed / inferred / unverified」。**

这是 Daytrace 唯一的差异点，也是唯一值得自己从零实现的部分。其余能力一律优先借鉴。

## 3. 逐项借鉴清单

### 3.1 devlog — 会话读取与项目归因（借鉴规则，价值最高）

`src/` 共 8 个文件：`main.rs` `activity.rs` `transcript.rs` `codex.rs` `gitlog.rs` `report.rs` `summarize.rs` `config.rs`。

`transcript.rs`（Claude Code 读取器）已经解决的问题，逐条抄进 Daytrace：

- 遍历 `~/.claude/projects/*/*.jsonl`；先用文件 mtime 整体剪枝（文件比时间窗口旧 → 不可能含范围内记录）
- 每行必须有 `sessionId`；只保留 `type ∈ {user, assistant}`
- `type: ai-title` 单独处理，取 `aiTitle` 作为会话标题，且**故意不受时间窗口限制**（只在该会话已在窗口内出现时才应用）
- `timestamp` 按 RFC 3339 解析后转 UTC，用**半开区间 `[start, end)`** 判定归属日
- 首次见到某会话时抓 `cwd`（缺省 `"."`）与 `gitBranch` → 这就是项目归因
- **跳过 `isSidechain: true`**（子 agent 转录，工作已在主链出现）。不抄这条会把同一份工作重复计一遍
- 正文提取：`message.content` 允许是字符串或数组，数组时只取 `type: text` 块并按换行拼接，再过一遍 `clean_prompt`
- 行为提取：只看 `tool_use` 块。`Edit` / `Write` / `MultiEdit` / `NotebookEdit` → `input.file_path`；`Bash` → `input.description`，退化到 `input.command` 截断 80 字符；`Read` / `Grep` 等只读工具忽略
- 丢弃所有非 `text` 内容块 —— 这是剥离工具结果与 harness 注入噪音的方式
- 每会话设 prompt / action 上限；用有序容器保证输出确定、路径去重
- 解析失败静默跳过，不中断整次扫描

`codex.rs` 是 Codex 侧的等价实现，`gitlog.rs` 是 git 侧，`activity.rs` 定义 `SessionActivity` 结构、`clean_prompt` 与上限常量。整个仓库 3 个 commit，可以一次读完。

### 3.2 obsidian-daily-digest — 脱敏与隐私分级（最不该自己造）

`src/` 目录：`collect/` `filter/` `analyze/` `summarize/` `render/` `settings/` `plugin/`，加 `types.ts`、`settings-registry.ts`。

`src/filter/` 下 5 个文件：`categorize.ts` `classify.ts` `dedup.ts` **`sanitize.ts`** **`sensitivity.ts`**。后两个是重点：

- `sanitize.ts` 的模式集覆盖 GitHub / Anthropic / OpenAI / AWS / Slack / npm / Stripe / SendGrid 的 API key、JWT、含密码的数据库连接串、auth header、PEM 私钥块、27 种敏感 URL 参数、邮箱、IP、家目录路径
- `sensitivity.ts` 是 419 个域名 / 11 个分类的敏感过滤表，命中后可选择整条丢弃或降级为分类标签，支持用户自定义规则（含路径级）
- 四级隐私降级链：Tier 1 完整脱敏上下文 → Tier 4 去标识化聚合（零逐事件数据），自动选择当前可用的最私密一档
- 发送前预览弹窗：请求发出之前展示将要发送的内容
- 默认走本地模型（Ollama / LM Studio / 任意 OpenAI 兼容端点），云端默认关闭且需用户自带 key；无遥测
- 读浏览器 SQLite 历史时先复制成只读副本再用 sql.js 解析（避开数据库锁）

这一整套等于 Daytrace 原 §7.2（脱敏）+ §6.1（分级）+ §8.3（发送前预览）。原计划里 §7.2 只列了 `.env*` / `*.pem` / `secret*` 这类**文件名通配**，挡不住 diff 正文里的密钥；这份实现挡得住。

### 3.3 worklog — 适配器架构与源清单

不需要抄实现，抄接口形状和源清单：`claude`、`codex`、`opencode`、`factory`、`cursor`、`vscode`、`git`、`github`、`terminal`、`filesystem`、`calendar`、`slack`。

这直接决定 Daytrace 的 `AgentSessionProvider` 该长什么样，也直接回答「只支持一个 AI 工具会砍掉多少潜在用户」。

### 3.4 Reor — 只能看，不能抄

**AGPL-3.0**。抄一行进 Daytrace，整个项目就必须按 AGPL 开源（含网络服务条款）。它的价值是那个教训，不是代码。

## 4. 怎么合法借鉴

MIT 允许复制、修改、再分发（含商用），唯一义务是保留版权声明与许可证全文。落地动作：

1. 直接复用代码时，vendor 到 `third_party/<repo>/`，保留原文件头，改动处加注释说明。
2. 根目录维护 `THIRD_PARTY_NOTICES.md`，逐条写明 `portions derived from github.com/<owner>/<repo> — MIT © <author>` 并附完整许可证文本。
3. 借鉴前打开各仓库根目录的 LICENSE 文件确认一次（GitHub 侧栏的许可证标签是自动识别的，一般可靠，但确认只要 10 秒）。
4. **Daytrace 采用 MIT。** 要借鉴的三个项目都是 MIT，同许可证合并最省事；Apache-2.0 虽然兼容，但要额外维护 NOTICE 与专利条款，对个人项目没有收益。

**抄规则比抄代码划算。** 三个项目是三种语言 / 形态（Rust、TS + Bun、Obsidian 插件 TS），全部 vendor 等于背三套构建链。正则表、域名表、噪音过滤规则、字段名清单是可移植资产，实现不是。按规则重写同样要保留 attribution（表达本身受版权保护），但只需在 `THIRD_PARTY_NOTICES.md` 里写一行。

## 5. 不作为差异点宣传的能力

以下能力照做、照抄、照用，但**不写进定位句、不当卖点**，因为已经有人做完了：

- 读本地 AI 会话文件生成日报
- 多仓库 git 聚合
- 按项目分组
- 密钥与 PII 脱敏
- 发送前预览
- 本地模型 / 无 LLM 降级
- 写入 Obsidian vault
- 关系图可视化（Obsidian 的 Graph view 是官方核心插件，产出是 Markdown 就已免费获得）

