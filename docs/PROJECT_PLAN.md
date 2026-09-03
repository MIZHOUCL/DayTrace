# Daytrace 项目规划书

版本：0.2 ｜ 日期：2026-09-03 ｜ 状态：规划（尚无代码）｜ 许可证：MIT

初版（v0.1）保留在 `archive/v0.1/PROJECT_PLAN.md`。本版的修订理由逐条记录在 [ADR](./ADR.md)，竞品与借鉴清单见 [PRIOR_ART](./PRIOR_ART.md)。

## 1. 定位

一句话：**把今天真实发生过的工作痕迹，整理成一份每一句话都能点回证据的日志。**

唯一差异点：日报里每一句话都带 `source_ids`，能点回具体 commit、具体会话的具体那一条消息，并标注 `confirmed` / `inferred` / `unverified`。

已有三个 MIT 开源项目在做「读 AI 会话 + git 生成日报」，它们的归因都停在会话级（打工具标签、写 frontmatter、按仓库分组）。逐句可追溯是没有人做的那一块，也是本项目唯一值得从零实现的部分。其余能力一律优先借鉴。

不作为卖点宣传的能力（因为已经有人做完了）：会话读取、多仓库聚合、按项目分组、脱敏、本地模型降级、写入 Obsidian vault、关系图可视化。

## 2. 目标用户

v0.1 只服务一类人：

- 每天用 AI 编码代理（Claude Code、Codex 及同类）工作、跨多个仓库切换、且需要对外交付可追溯工作记录的开发者。

明确的非目标（初版把它们列为目标用户，但 MVP 证据源根本覆盖不到）：

- 不写代码的知识工作者 —— 证据源是 git 与 AI 会话，这类用户打开后屏幕上没有可确认的内容。
- 需要办公文档（.docx / .xlsx / Notion）正文解析的用户 —— 不在任何阶段的范围内。

**Obsidian / Logseq 用户不是独立的目标人群，而是输出目标**：产出写成带 wiki-link 的 Markdown，放进 vault 即可，不为此单独设计功能。

## 3. 范围

### 3.1 v0.1 包含

- 一个 Node CLI，双平台（macOS + Windows）
- git 采集：工作树状态、当日 commit 元数据、`diff --stat`
- AI 会话采集：`~/.claude/projects/**`、`~/.codex/sessions/**`，只取用户消息与被编辑文件路径
- 项目归因：会话 `cwd` / `gitBranch` → git 仓库根 → 用户 glob 规则
- 可配置日界与时区处理
- 纯规则生成带脚注引用的 Markdown（零模型调用）
- SQLite 存储（6 张表）+ 幂等重复扫描
- `--out` 写入指定目录 + `daytrace where` / `daytrace purge`

### 3.2 v0.1 不包含

- 桌面界面、Obsidian 插件（形态推到阶段 E，见 ROADMAP）
- 文件系统增量扫描（git 已覆盖，成本高收益低，见 ADR-001）
- 自建关系图可视化（见 ADR-015）
- AI 摘要、脱敏管道、token 预算（阶段 C）
- 每日追问、模块自动细分、云端同步、浏览器历史、任何形式的行为监控

## 4. 核心流程

### 4.1 默认路径：一条命令

```text
daytrace today
  → 采集 git + 会话（本地，离线）
  → 项目归因 + 按日界归属
  → 规则生成带脚注的 Markdown 草稿
  → 写入 --out（或打印到 stdout）
```

**默认状态：不联网、不需要 API key、不读文件正文、不读 diff 正文。** 装上就能用。

### 4.2 精修路径（可选，不阻塞默认路径）

```text
daytrace show <evidence_id>      查看某条证据原文位置
daytrace edit                    打开草稿编辑
daytrace today --ai              启用 AI 摘要（需显式开关，先过预览）
daytrace today --level diff      提升某项目的读取级别
```

初版把「模块确认 → 选内容级别 → 隐私预览 → 预算预览 → 追问 → 编辑确认 → 保存」7 道阻塞式确认门全部放进每日必经流程，同时又要求「打开到保存中位 3 分钟」。这两个目标不兼容，而每天 10 次以上的交互换一份日报，竞争对手是「一条命令」和「三行 shell」。本版把所有确认门移出默认路径：读取级别按项目一次性设置并持久化；隐私与预算信息降为草稿顶部一行折叠摘要，只在越过用户设定红线时才打断；追问变成草稿里 `unverified` 段落旁的可选补问，0 题也能保存。

## 5. 证据模型与读取级别

| 级别 | 内容 | 默认 |
|---|---|---|
| L0 | git 元数据（commit hash / message / author / 时间 / 分支）、`diff --stat` 行数 | 开启 |
| L1 | AI 会话的用户消息、会话标题、被编辑文件路径 | 开启 |
| L2 | git diff 正文（按项目授权，持久化） | 关闭 |
| L3 | 文件正文、AI 会话完整对话（含助手回复） | 关闭，逐次授权 |

初版有 L0-L4 五档，但 §3.1 只写 4 档、ROADMAP 写「L0-L3 选择器」、Epic 6 写「定义 L0-L4」，口径不一致且 L4 无人管。本版统一为 4 档，把「会话全文」并入 L3。

读取入口约束：**代码里只允许有一处读取文件正文的函数**，所有正文读取必须经过它，并强制写审计记录。这样「未授权正文读取次数为 0」才是可测试的（用测试替身断言该函数未被调用），否则初版 §13.1 那条验收标准无法证明。

## 6. 会话适配器契约

初版的 `CodexSessionProvider` 只面向一个工具。本版泛化：

```typescript
interface AgentSessionProvider {
  readonly id: string;              // 'claude-code' | 'codex' | 'cursor' | ...
  capabilities(): Capabilities;     // 能读什么、是否支持增量、schema 版本范围
  detect(): Promise<boolean>;       // 本机是否存在该工具的数据
  probeSchema(): Promise<SchemaInfo>;   // 版本探测，未知结构必须显式返回 unknown
  collect(range: DateRange, cursor?: Cursor): Promise<SessionActivity[]>;
  // 解析失败时返回 { status: 'link_only' }，绝不猜测内容
}
```

强制要求：只读白名单目录、增量 offset 续读、schema 未知时降级为「仅引用，未导入内容」、任一适配器失败不影响其他来源。

## 7. 时间与日界

- 所有时间戳按 UTC 存储。
- 「属于哪一天」由可配置日界决定，默认本地时间 04:00，用半开区间 `[start, end)` 判定。
- `evidence` 同时存 `occurred_at`（UTC）与 `local_date`（按日界折算）；分组与搜索用 `local_date`。
- 换时区后只重算 `local_date`，不改动原始时间戳。
- 采集时先按文件 mtime 整体剪枝，再逐行按时间戳过滤。

初版全文没有定义这些，而跨零点工作与差旅换时区会直接造成证据丢失或重复计入。

## 8. 隐私与安全

### 8.1 默认值

- 只读三类位置：用户配置的 git 仓库根、`~/.claude/projects`、`~/.codex/sessions`。
- 默认只读 L0/L1，不读文件正文、不读 diff 正文。
- 默认零网络请求。启用 AI 需显式开关，且必须先过发送预览。
- 数据只存本地 SQLite，不要求账号，不做云同步。

### 8.2 脱敏与熔断

规则集借鉴 `obsidian-daily-digest` 的 `sanitize.ts` 与 `sensitivity.ts`（见 PRIOR_ART §3.2），至少覆盖：GitHub / Anthropic / OpenAI / AWS / Slack / npm / Stripe / SendGrid 的 API key、JWT、PEM 私钥块、含密码的数据库连接串、auth header、敏感 URL 参数、邮箱、IP、家目录路径。

**熔断优先于替换**：命中高危密钥模式时整块内容拒发，而不是替换后继续发送。初版只列了 `.env*` / `*.pem` / `secret*` 这类文件名通配，挡不住 diff 正文里的密钥；同时那种前缀通配会误伤 `tokenizer.ts`、`secrets.example` 这类正常文件，因此排除规则改用 gitignore 语法 + 内容嗅探 + 用户白名单三层。

### 8.3 授权模型

授权 = `{ scope, level, granted_at, expires_at | null, revocable: true }`。级别是枚举属性，不是状态机的一环。流程状态机只管 `DISCOVERED → GROUPED → RENDERED`，授权的 `DENIED` / `REVOKED` / `EXPIRED` 是独立分支。

初版把授权级别和处理阶段混成一条线性链（`DISCOVERED → ... → APPROVED_FILE_CONTENT → REDACTED → READY_FOR_AI → SUMMARIZED`），且缺少拒绝、撤销、过期三个分支，也没写授权的生命周期。

### 8.4 受管设备模式

一个配置项 `managed_device: true`，一旦开启：永久禁用所有外发、隐藏 AI 相关命令、每次运行显式提示当前处于受管模式、审计记录可导出。这是为公司电脑准备的，而不是把产品做成只服务公司场景。

### 8.5 注入防护

会话文本与 diff 正文可能包含针对模型的注入内容，或包含外链图片导致渲染时外发数据。因此：输出的 Markdown 默认把外链图片降级为纯文本链接；发给模型的内容与「指令」在 prompt 里明确分区；模型返回的内容一律当数据处理，不允许触发任何本地动作。初版全文没有提这一层。

## 9. AI 与成本

### 9.1 provider

接口只依赖 `summarize()` / `estimateTokens()` / `capabilities()`。支持 OpenAI 兼容端点、本地模型（Ollama / LM Studio）、以及「不用模型」。**「不用模型」是默认档，不是降级档。**

### 9.2 预算

两层：每日上限 + 单次上限。默认值在阶段 C 用真实数据标定后写入文档，并在文档里注明标定依据；不写一个未经验证的小数字当出厂配置。

估算失败时按保守上界估计并请用户确认，而不是直接拒绝调用；调用后用 provider 返回的 usage 回填校准估算器。

### 9.3 缓存

缓存键：`provider + model + prompt_version + policy_version + content_hash + output_limit + language`。初版的键漏了输出上限与语言，换语言或换输出长度会错误命中。

缓存命中率的正确口径是「未变化项目复用已有摘要」的比例，而不是「日报整体命中率」—— 日报内容每天不同，后者天然接近零，不应作为指标。

## 10. 事实、引用与三态（护城河）

```json
{
  "text": "把增量扫描器的 hash 缓存换成延迟计算",
  "source_ids": ["commit:1a2b3c4", "session:a1b2c3d4#42"],
  "confidence": "confirmed",
  "project_id": "novel-ide",
  "occurred_at": "2026-09-03T06:22:00Z"
}
```

- `confirmed` —— 每个 `source_id` 都指向真实存在的证据行，且文字可由该证据直接支撑。
- `inferred` —— 由规则或模型归纳，来源存在但表述超出原文。
- `unverified` —— 无法关联到任何证据。默认在输出里显式标注并附「确认 / 删除」提示。

**引用完整性校验（强制）**：生成后逐条检查每个 `source_id` 是否存在于 `evidence` 表；不存在则该条强制降级为 `unverified`。没有这一层，模型编造 source_id 会静默通过，整个可追溯承诺失效 —— 这是初版最关键的缺失环节。

## 11. 数据模型

v0.1 只建 6 张表（初版 20 张，删减理由见 ADR-017）：

```text
projects   id, name, root_path, user_renamed, created_at
sessions   id, provider_id, thread_id, title, cwd, git_branch,
           first_ts, last_ts, content_status, schema_version
commits    hash, project_id, message, author, committed_at, files, additions, deletions
evidence   id, source_type, source_ref, project_id, path, path_alias,
           occurred_at, local_date, level, excerpt_ref
facts      id, journal_id, text, source_ids, confidence, project_id, occurred_at
journals   id, local_date, markdown, created_at, updated_at, out_path
```

关键约束：

- `evidence` 对 `(source_type, source_ref, local_date)` 建唯一约束，保证重复扫描幂等。`source_ref` 对 commit 是 hash，对会话是 `sessionId#消息序号`。用 `local_date` 而不是 `occurred_at` 进唯一键：commit 与会话消息的 ref 本身不可变（归属日恒定），而工作树状态的 ref 每天都会重复出现，必须按天区分。
- `evidence.path` 是真实路径（只本地用，永不外发），`path_alias` 是脱敏后的路径（用于发送）。初版 `evidence_events` 只有 `path_alias`，真实路径无处存放也无法反查。
- `sessions.content_status ∈ {link_only, summary_imported, content_imported}`；`schema_version` 记录采集时探测到的格式版本。
- 图关系不建表。需要图谱时由输出的 wiki-link 交给 Obsidian / Logseq（ADR-015）。
- 存储驱动用 Node 内置的 `node:sqlite`（需 Node ≥ 22.13 或 ≥ 23.4，含 FTS5），不引入 better-sqlite3 之类原生模块，保证 `npm i` 在两个平台都不需要编译器。
- 数据库文件位置：macOS `~/Library/Application Support/daytrace`，Windows `%APPDATA%\daytrace`。检测到位于 iCloud / OneDrive / Dropbox 同步目录时告警（SQLite WAL 在同步目录下有损坏风险）。

## 12. 输出与集成

- 主输出：Markdown，每条要点带 `[^evN]` 脚注，项目名写成 `[[项目名]]`。
- `--out <dir>` 写入用户指定目录（可以是 Obsidian vault）；文件名 `YYYY-MM-DD.md`。
- 重新生成时保留用户手写内容与已确认的补充，并先做带时间戳的备份。
- `--json` 输出结构化结果，供编辑器插件或脚本消费。
- 空状态：当天无任何证据时输出「无可记录活动」并说明查了哪些来源，不产生空文件。

## 13. 质量与验收

### 13.1 功能

1. 采集范围严格限于配置的 git 仓库根与两个会话目录。
2. 默认路径零网络请求（离线环境验证）。
3. 同一天重复执行两次，输出逐字节相同，数据库无重复证据行。
4. 每条 `confirmed` 要点都能通过脚注定位到 commit hash 或 `sessionId#消息序号`。
5. `isSidechain: true` 的会话记录不被计入。
6. 人为注入不存在的 `source_id`，校验能拦住并降级。
7. `daytrace where` / `daytrace purge` 可用且有确认提示。

### 13.2 安全

1. API key 不出现在日志与错误信息里。
2. 敏感样本集（PEM 私钥块、JWT、`sk-` / `AKIA` / `ghp_` 前缀、含密码连接串）零条进入 payload。
3. 正文读取只有一处入口，测试可断言其未被调用。
4. `--preview` 输出与实际发送字节一致。
5. 受管设备模式开启后，任何路径都无法发起外部请求。

### 13.3 性能

- 单次 `daytrace today` 在典型工作日数据量下 3 秒内完成（对照：`obsidian-daily-digest` 报 3-6 秒）。
- 1 万条证据搜索响应低于 300ms（本地基准机）。
- 增量运行不重复解析未变化的会话文件（按 mtime + offset 剪枝）。

初版列了「10 万文件元数据扫描不阻塞 UI」等指标，但本版已取消文件系统扫描，该指标随之移除；同时初版缺少「单次运行总耗时」这个用户唯一真正感知的指标，本版补上。

## 14. 平台与交付

- macOS（arm64 + x64）与 Windows 同为一等公民，从第一个 commit 起双平台 CI。
- v0.1 通过 npm 分发（`npm i -g daytrace`），不做安装包 —— 避开 macOS 公证（Apple Developer 99 美元/年）与 Windows SmartScreen 警告，也让受管电脑能用。
- 不使用需要编译的原生模块，保证 `npm i` 在两个平台都不需要工具链。
- 需要显式处理的平台差异：路径分隔符与大小写敏感、应用数据目录、会话文件位置（`~/.codex` vs `%USERPROFILE%\.codex`）、`git` 是否在 PATH 上、SQLite 在同步目录下的风险。
- 桌面壳或 Obsidian 插件推到阶段 E，进入条件是「已有 ≥5 个非作者用户」。

## 15. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 已有三个功能重叠的 MIT 项目 | 做完也没人用 | 定位只押逐句可追溯；其余能力借鉴不重造（PRIOR_ART） |
| AI 会话文件格式无稳定性承诺 | 适配器失效 | schema 版本探测 + 未知结构降级为 link_only + 遍历目录而不依赖索引文件 |
| 逐句引用做不准 | 唯一差异点失效 | 引用完整性校验强制降级；宁可标 unverified 也不假装 confirmed |
| 每日摩擦导致弃用 | 留存归零 | 默认路径只有一条命令；所有确认门移出默认路径 |
| 个人维护带宽耗尽 | 项目归档 | 范围压到两周闭环；开源工程化交付物延后；不自建界面 |
| 会话/diff 内容含注入 | 数据外泄 | 外链图片降级、prompt 分区、模型输出当数据 |
| 公司电脑不允许安装或外发 | 目标用户装不上 | CLI 分发 + 受管设备模式 + 离线默认 |
| 用户在两台机器上工作 | 记录割裂 | 明确不做云同步，文档写清边界，提供导出合并 |

## 16. 执行顺序

1. 建仓库、MIT、双平台 CI（3 条任务，见 MVP_ISSUES Epic 1）
2. 6 张表 + 迁移 + 幂等唯一约束
3. git 采集 → 先让 `daytrace today` 只靠 git 就能出东西
4. 会话采集（照 PRIOR_ART §3.1 的规则逐条实现）
5. 日界与时区
6. 规则生成带脚注的 Markdown
7. 作者连续用 5 个工作日，再决定阶段 B 的优先级

## 17. 与初版的差异索引

| 变更 | 对应 ADR |
|---|---|
| 取消文件系统增量扫描 | ADR-001 |
| `codex://` 拆分为「只作引用」与「本地文件直读」 | ADR-004a / ADR-004b |
| 逐句可追溯提升为唯一差异点，新增引用完整性校验 | ADR-006 |
| 预算从 5 层压到 2 层，修正估算失败即锁死的问题 | ADR-007 |
| 平台从 Windows-only 改为 macOS + Windows | ADR-011 |
| 形态从 Tauri 桌面应用改为 Node CLI，语言选 TypeScript | ADR-012 |
| 借鉴优先，许可证定为 MIT | ADR-013 |
| 新增日界与时区定义 | ADR-014 |
| 删除自建 Graph View，改输出 wiki-link | ADR-015 |
| 开源工程化交付物延后到第 2 个用户 | ADR-016 |
| 数据表从 20 张压到 6 张 | ADR-017 |
| 目标用户收窄，去掉非编码知识工作者 | 见本文档 §2 |
| 7 道确认门移出默认路径 | 见本文档 §4.2 |
| 读取级别统一为 L0-L3，正文读取收敛到单一入口 | 见本文档 §5 |
| 新增受管设备模式与注入防护 | 见本文档 §8.4 / §8.5 |




