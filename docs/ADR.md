# Daytrace 关键技术决策记录

版本：0.2 ｜ 日期：2026-09-03

修订说明：ADR-001 至 ADR-010 来自初版（`archive/v0.1/ADR.md`）。本次修订对其中 4 条做了状态变更，并新增 ADR-011 至 ADR-017。

## ADR-001：只读用户明确指定的范围

状态：Accepted（措辞更新）

决策：只读三类位置 —— 用户配置的 git 仓库根、`~/.claude/projects`、`~/.codex/sessions`。不支持全盘扫描，也不默认做文件系统遍历。

原因：初版把「文件系统增量扫描」当作核心能力，但 git 已经免费提供了变更信息，自建文件扫描要额外处理 mtime 精度、编辑器原子保存造成的假新增删除、非 git 目录的重命名检测、`node_modules` / `target` / `.venv` 这类体积黑洞（初版 §7.2 只列了敏感文件通配，没列体积黑洞，首次扫描会炸）。这些成本换来的增量信息很有限。

## ADR-002：扫描与读取分离

状态：Accepted

决策：元数据、结构信息、diff 正文、文件正文分属独立权限级别。文件发生变化不等于获得读取正文的授权。

## ADR-003：Graph View 默认按模块聚合

状态：**Superseded by ADR-015**

## ADR-004a：`codex://` 深链只作为引用

状态：Accepted

决策：`codex://threads/<id>` 在核心系统中只解析为引用，不假定其包含可读正文，不依赖任何未公开的网络接口。

## ADR-004b：本地会话文件直读，且为 v0.1 P0

状态：Accepted（新增，取代初版「内容必须靠用户手动粘贴」的产品结论）

决策：从本地文件系统读取 AI 会话记录，作为 v0.1 的一等输入源：`~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` 与 `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<thread_id>.jsonl`。用户授权目录 + schema 版本探测 + 解析失败降级为「仅引用」+ 增量 offset 续读。

原因：三条。

1. ADR-004a 的理由（深链不等于可读接口）只对 `codex://` URL 成立，对用户自己机器上的本地文件不成立 —— 那是用户的自有数据，不涉及任何私有接口。
2. 初版的替代方案是用户手动粘贴会话文本（初版 Epic 12 六条 P0 全部围绕粘贴导入），但实测 Codex 单个会话文件中位 229KB、P90 8.1MB、最大 28.8MB，抽最大的 20 个会话统计其正文字符中位约 6 万、最大约 170 万。手动粘贴在物理上不成立，且一次粘贴就撞穿初版 §8.1「单次工作流 8,000 tokens」的预算。
3. 这些文件自带归因信息：Claude Code 每行有 `cwd`、`gitBranch`、`sessionId`、`timestamp`，且目录名本身编码了项目路径；Codex 首行 `session_meta.payload` 有 `id`、`cwd`、`git`。实测 `~/.codex/session_index.jsonl` 的 `id` 与 rollout 文件名中的 uuid 一一对应，因此深链 ID 可在本机直接定位到文件。

风险与对策：这些格式没有公开稳定性承诺。对策是每个适配器声明支持的 schema 版本，遇到未知结构时降级为「仅引用，未导入内容」，绝不猜测内容；不要把 `session_index.jsonl` 当权威来源（本机索引行数与 rollout 文件数不一致），直接遍历目录。

## ADR-005：AI Provider 采用适配器接口

状态：Accepted

决策：核心只依赖 `summarize()`、`estimateTokens()`、`capabilities()`，不绑定具体模型名称。支持 OpenAI 兼容端点、本地模型、以及「不用模型」。

## ADR-006：事实与表达分离，且这是本项目唯一的差异点

状态：Accepted（提升为核心定位）

决策：先生成带来源的事实对象 `{ text, source_ids[], confidence, project_id, occurred_at }`，再生成可编辑的日志文字。`confidence ∈ {confirmed, inferred, unverified}`。

新增的强制环节（初版缺失）：**引用完整性校验**。生成后逐条检查每个 `source_id` 是否真实存在于证据表；不存在则该句强制降级为 `unverified` 并在输出中标注。没有这一层，模型编造一个不存在的 `source_id` 就会静默通过，整个「可追溯」的承诺失效。

原因：已有的三个同类 MIT 项目（见 [PRIOR_ART](./PRIOR_ART.md)）的归因都停在会话级 —— 打 `[Claude Code]` 标签、写 frontmatter、按仓库分组。没有一个做到逐句可追溯。这是唯一值得自己从零实现的部分，其余能力一律借鉴。

## ADR-007：预算失败安全，但层级压到两层

状态：Accepted（修订）

决策：保留失败安全语义（脱敏失败、provider 能力不明时不发起云端请求），但做两处修改：

1. 预算层级从初版的 5 层（provider / daily / workflow / module / item）压到 2 层：每日上限 + 单次上限。
2. 初版 §7.4 写「无法估算 token 时默认不调用云端模型」—— 这会在估算器不可靠时把产品锁死。改为：估算失败时按保守上界估计并提示用户确认，而不是直接拒绝；调用后用 provider 返回的 usage 回填校准估算器。

原因：初版为 5 层预算排了 11 条任务（8 条 P0），而这套机器保护的金额在真实用量下是每天几分钱量级。更严重的是初版默认值（单次 8,000 / 每日 30,000 tokens）对一天的真实证据量偏小一个数量级，按出厂配置会天天撞上「预算不足不发请求」，用户会理解成「这软件坏了」。同时，真实风险是内容外发而不是花钱，篇幅应该给脱敏而不是预算。

## ADR-008：本地 SQLite 作为存储

状态：Accepted（表数收缩，见 ADR-017）

## ADR-009：不加入行为监控功能

状态：Accepted

决策：不做键盘记录、全量浏览器历史、后台截图、录音、隐蔽进程采集。

## ADR-010：官方能力不明确时保留不确定性

状态：Accepted（限定范围）

决策：不把未验证的**网络接口**能力描述成已支持功能。本地文件读取不在此列（见 ADR-004b），但同样要用 capability 声明与降级路径表达格式不确定性。

## ADR-011：macOS 与 Windows 同为一等公民

状态：Accepted（新增，取代初版 Windows-only）

决策：从第一个 commit 起双平台 CI（`macos-latest` + `windows-latest`），不允许平台特定的核心逻辑。需要处理的差异写死在文档里：路径分隔符与大小写敏感、应用数据目录（`~/Library/Application Support` vs `%APPDATA%`）、会话文件位置（`~/.codex` vs `%USERPROFILE%\.codex`）、`git` 是否在 PATH 上（Windows 常常没有）、SQLite 数据库放在 iCloud / OneDrive 同步目录的风险。

原因：初版三处把目标平台定为 Windows（`§3.1`、`§14.1`、「MVP 完成定义」第 1 条），全文 0 次出现 macOS/Linux。但需求是「公司电脑能用、个人电脑也能用」，且开发机是 macOS —— Windows-only 意味着作者自己无法日常使用，而在这个品类里作者是唯一有保证的日活用户，没有 dogfooding 就没有人会在第 3 天喊停一个 9 步流程。

## ADR-012：v0.1 形态是 Node CLI，语言用零依赖 JavaScript

状态：Accepted（新增，取代初版 Tauri + Rust；语言部分已按实现结果修订）

决策：v0.1 是一个 Node CLI，**零第三方依赖**，不引入 Tauri，不引入 Rust。界面形态推到阶段 E，届时按用户反馈在 Obsidian 插件与 Tauri 桌面壳之间二选一。

原因：

1. **分发摩擦**。未公证的 macOS 应用会被 Gatekeeper 拦截（需 Apple Developer 账号 99 美元/年 + notarization），无 EV 证书的 Windows 安装包会弹 SmartScreen 警告。公司受管电脑通常不允许安装未签名应用。CLI 不受这两条限制，`npm i -g` 即可。初版 ROADMAP 阶段 8 只写了「Windows 安装包」和「可复现发布构建」，完全没有提签名与公证。
2. **工具链现状**。开发机已有 node、npm、git、sqlite3、python3；`cargo` 与 `rustc` 未安装。Tauri 强依赖 Rust，还需要 macOS 的 Xcode CLT 与 Windows 的 MSVC + WebView2 —— 初版 ROADMAP 阶段 0 的退出标准「新开发者 15 分钟内启动开发环境」在这个栈下不现实。
3. **借鉴收益**。三个可借鉴项目里两个是 TypeScript（worklog 的适配器架构、obsidian-daily-digest 的脱敏规则集），选 TS 能直接复用的量最大。devlog 是 Rust，但它的价值主要在规则而非代码，规则已在 [PRIOR_ART §3.1](./PRIOR_ART.md) 逐条摘出。
4. **与初版自身一致**。初版 §14.1 本来就写 `v0.1.0 = CLI/核心扫描原型`，但 §3.1 的 MVP 又要求桌面应用 —— 本决策消除这个矛盾。

实现回执（2026-09-03，骨架已跑通）：原计划写 TypeScript，落地时改成**零依赖 ESM JavaScript + JSDoc 类型注释**。原因是 TypeScript 编译器本身就是一个需要安装的依赖，而「`npm i` 不需要任何工具链」是本决策第 1 条理由的核心；同时 Node 内置的 `node:sqlite`（本机为 SQLite 3.53.3，含 FTS5）让存储层也不需要原生模块 —— 但要注意版本下限是 **22.13 / 23.4**，不是模块刚加入的 22.5，见下段。实测结果：`dependencies` 与 `devDependencies` 均为 0，运行时只 import `node:fs` / `node:os` / `node:path` / `node:util` / `node:sqlite` / `node:child_process`，测试用 `node --test`。想要类型检查时可以随时加一层 `tsc --checkJs`，不影响运行。

## ADR-013：借鉴优先，许可证选 MIT

状态：Accepted（新增）

决策：凡是已有 MIT 开源实现的能力，优先借鉴而不是重造，清单见 [PRIOR_ART](./PRIOR_ART.md)。Daytrace 本身采用 MIT。借鉴时 vendor 到 `third_party/<repo>/` 并在 `THIRD_PARTY_NOTICES.md` 逐条声明归属；只借鉴规则（正则表、域名表、过滤规则、字段清单）时同样保留归属。

原因：三个要借鉴的项目都是 MIT，同许可证合并最省事。Apache-2.0 虽然兼容，但要额外维护 NOTICE 与专利条款，对个人项目没有收益。这也解决了初版 §14.2 「MIT 或 Apache-2.0」二选一未决的问题。

红线：**Reor 是 AGPL-3.0，不得复制其代码**。抄一行就会让整个项目落入 AGPL（含网络服务条款）。

## ADR-014：日界可配置，时间统一 UTC 存储

状态：Accepted（新增，初版完全缺失）

决策：所有时间戳按 UTC 存储；判定证据属于哪一天时，用可配置日界（默认本地时间 04:00）与半开区间 `[start, end)`。`evidence` 表同时存 `occurred_at`（UTC）与 `local_date`（按日界折算），分组与搜索用后者。换时区后只重算 `local_date`，不改动原始时间戳。

原因：初版全文 0 次出现「时区 / timezone / 日界 / 零点 / 跨天」，而这是日报工具的核心语义 —— 跨零点加班算哪天、出差换时区怎么办，没有定义就会出现证据丢失或重复。devlog 的做法（RFC 3339 → UTC，半开区间）可直接借鉴。

## ADR-015：不自建 Graph View，改为输出 wiki-link

状态：Accepted（新增，supersedes ADR-003）

决策：删除自建关系图可视化（初版 §5 整章 + Epic 10 的 9 条任务 + Sigma.js/Graphology 选型）。改为在输出的 Markdown 里写 `[[项目名]]`、`[[会话 <id>]]` 形式的 wiki-link，让 Obsidian / Logseq 提供图谱。

原因：Obsidian 的 Graph view 是官方核心插件，Logseq 自带图谱，而 Daytrace 的产出本来就是 Markdown —— 只要写成 wiki-link 就免费获得初版 §5 想要的关系可视化。同时图谱是低频检索动作，不在每日闭环里；初版把 Epic 10 全标 P1，却在「MVP 完成定义」第 8 条把它当作发布硬门槛，本身自相矛盾。

保留的替代能力：FTS5 全文搜索 + 从日志句子跳到来源证据（阶段 B）。

## ADR-016：开源工程化交付物延后到出现第 2 个用户

状态：Accepted（新增）

决策：阶段 0 只做 3 件事 —— `LICENSE`（MIT）、数据与配置目录规范、「不扫描什么」清单。威胁模型、贡献指南、行为准则、Issue 模板、安全漏洞报告流程、中英双语快速开始、Provider 开发指南、发布包校验值、可复现构建，全部延后到出现第 2 个真实日活用户之后。CI 只保留双平台测试，不设格式与静态检查门禁。

原因：初版 ROADMAP 阶段 0 加 §14.2 合计要求 11 项开源工程交付物，全部不产出日报闭环代码。经验证据表明其边际回报在拿到用户之前接近零：三个功能等价的 MIT 项目分别只有 0 / 1 / 2 个 star，其中 commit 最多的（359 个，配齐 CI 与截图基线测试）仍然只有 2 star。初版退出标准「新开发者 15 分钟内启动开发环境」预设了不会到来的贡献者，改为「作者换一台机器能 15 分钟跑起来」。

## ADR-017：数据表从 20 张压到 6 张

状态：Accepted（新增）

决策：v0.1 只建 6 张表 —— `projects`、`sessions`、`commits`、`evidence`、`facts`、`journals`。

删掉或合并：`workspaces`（合进配置文件）、`modules`（延后，见 MVP_ISSUES Epic 6）、`files` / `file_snapshots` / `changesets`（ADR-001 已取消文件系统扫描）、`graph_nodes` / `graph_edges`（ADR-015 已取消自建图谱，且与业务表并存会造成双写不一致）、`topics`（初版没写清由谁产生）、`consent_records` / `privacy_rules` / `ai_cache` / `ai_runs`（随阶段 C 一起加）、`questions` / `answers`（追问延后）、`tasks`（延后）。

补充：初版 `evidence_events` 只有 `path_alias` 没有 `path`，真实路径无处可存也无法反查。新表 `evidence` 同时存 `path`（本地，不外发）与 `path_alias`（脱敏后用于发送），并对 `(source_type, source_ref, local_date)` 建唯一约束保证幂等。

## ADR-018：Node 版本下限定为 22.13 / 23.4，并在入口处设闸门

状态：Accepted（新增，由第一次 CI 结果驱动）

决策：`engines.node` 写成 `>=22.13.0 <23.0.0 || >=23.4.0`；CI 矩阵的下限格从 22.5 改为 22.13；`bin/daytrace.js` 在 import 存储层**之前**先做版本检查，不达标时打印可读提示并退出，而不是抛 `ERR_UNKNOWN_BUILTIN_MODULE` 堆栈。

原因：第一次 CI（macOS + Windows × Node 22.5 / 24 / 25）的结果是 **两个平台的 24、25 全绿，两个平台的 22.5 全红**，且都在 10-20 秒内快速失败。同一版本在两个平台同时失败说明这不是平台问题而是版本问题。Node 官方文档的版本历史确认了原因：

> Added in: v22.5.0
> v23.4.0, v22.13.0 — SQLite is no longer behind `--experimental-sqlite` but still experimental.
> v25.7.0 — SQLite is now a release candidate.

即 `node:sqlite` 虽然 22.5.0 就存在，但在 22.5–22.12 与 23.0–23.3 上必须加 `--experimental-sqlite`，直接 import 会抛 `ERR_UNKNOWN_BUILTIN_MODULE`。原先 `engines` 写 `>=22.5.0` 是错的。注意这个范围不能简写成 `>=22.13.0` —— 那样会错误地放进 23.0–23.3。

顺带的收获：**Windows 代码路径在 Node 24 与 25 上都是通的**，这是 ADR-011「双平台一等公民」的第一份实证，此前文档里「Windows 从未在 Windows 上执行过」这条风险已经解除。

实现细节：版本闸门放在 `src/env.js`，该文件不 import 任何可能失败的模块；`bin/daytrace.js` 先跑闸门，再用动态 `import()` 加载 CLI，并对 `ERR_UNKNOWN_BUILTIN_MODULE` 兜底。边界版本判定有单元测试覆盖。


