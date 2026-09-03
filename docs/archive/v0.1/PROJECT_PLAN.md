# Daytrace 项目总规划书

版本：0.1

日期：2026-09-03

状态：产品与工程规划阶段

## 1. 项目概述

### 1.1 项目名称

暂定名：Daytrace

中文定位：个人工作证据图谱与 AI 日志助手。

一句话描述：把今天真实发生过的工作痕迹，经过用户确认，整理成一份可信、可追溯、可搜索的日志。

### 1.2 要解决的问题

用户每天完成了很多工作，但下班时通常只能凭记忆写日志。文件数量多、项目切换频繁、Codex 等 AI 工具产生的工作过程又分散在不同会话中，导致：

1. 忘记当天完成了什么。
2. 很难把文件改动和实际工作目标对应起来。
3. AI 生成日志可能夸大、编造或泄露隐私。
4. 把整个磁盘交给 AI 会产生高 token 成本和过度读取风险。
5. Codex 会话是重要的工作记录，但不容易归档到项目日志。

### 1.3 产品原则

1. Local-first：证据、配置和日志默认保存在本地。
2. Privacy-first：默认不读文件正文，不上传文件，不扫描全盘。
3. Consent-driven：读取范围和发送范围由用户明确选择。
4. Evidence-grounded：日志中的事实必须能回溯到扫描证据、Git、Codex 导入或用户确认。
5. Incremental：只分析新增变化，不重复处理未变化内容。
6. Progressive disclosure：Graph View 先展示项目和模块，用户点击后再展开文件和内容。
7. Provider-agnostic：AI、Codex、Git 和导出能力都通过适配器实现，避免核心系统绑定单一供应商。

## 2. 用户和使用场景

### 2.1 目标用户

- 独立开发者。
- 使用 Codex、Cursor 或其他 AI 编程工具的开发者。
- 需要写日报、周报的知识工作者。
- 使用 Markdown、Obsidian 或本地笔记的用户。
- 重视隐私、不希望工作内容默认上传云端的用户。

### 2.2 典型场景

#### 场景 A：下班前生成日报

用户打开 Daytrace，选择“今天”。系统显示 3 个项目和 8 个模块，用户勾选两个模块，只读取 Git diff，确认两个问题，生成日报。

#### 场景 B：查询项目全貌

用户搜索项目名，在 Graph View 中看到项目关联的模块、文件变更、Git 提交、Codex 会话、主题、日志和未完成任务。

#### 场景 C：归档 Codex 会话

用户粘贴 `codex://threads/<id>`，系统解析会话 ID 并建立引用。若用户同时提供会话导出文本，系统才生成摘要和关系边；只有链接时，节点明确显示“仅引用，未导入内容”。

#### 场景 D：敏感项目

用户将客户项目设置为“只处理元数据”，系统可以显示项目发生过变化，但不能读取文件正文，也不能把路径和内容发送给 AI。

## 3. 产品范围

### 3.1 MVP 必须包含

- Windows 桌面应用。
- 用户明确选择工作区目录。
- 今日文件变化扫描：新增、修改、删除、重命名。
- Git 状态、commit 元数据和可选 diff。
- 按仓库、目录和规则进行项目/模块聚合。
- 今日证据列表和分层 Graph View。
- 读取权限选择：元数据、结构摘要、Git diff、选中文件正文。
- 敏感文件检测和排除规则。
- AI 发送预览、token 估算、单次/每日预算。
- 用户确认问题和跳过机制。
- 生成、编辑和保存 Markdown 日志。
- 手动导入 `codex://threads/<id>` 会话引用。
- 用户粘贴/导入 Codex 摘要文本。
- SQLite 本地数据存储。
- 基础搜索和日志历史。

### 3.2 MVP 不包含

- 默认全盘扫描。
- 默认后台读取浏览器历史。
- 默认自动读取全部 Codex 历史会话。
- 键盘记录、录音、屏幕截图。
- 团队协作和云端同步。
- 自动发送邮件、IM 或企业系统。
- 依赖 Codex 私有内部文件格式的核心功能。

## 4. 核心用户流程

### 4.1 首次启动

```text
欢迎页
  → 选择数据目录
  → 选择工作区目录
  → 设置隐私模式
  → 设置 AI Provider（可跳过）
  → 运行首次元数据扫描
```

首次启动必须明确说明：

- 哪些目录会被扫描。
- 默认只读取元数据。
- 何时会读取文件内容。
- 何时会向 AI Provider 发送数据。
- 如何删除所有本地数据。

### 4.2 每日工作流

```text
进入今日 → 扫描增量 → 项目聚合 → 模块确认
→ 选择内容级别 → 隐私预览 → token 预算预览
→ 本地/AI 摘要 → 追问 → 生成草稿 → 编辑确认 → 保存
```

### 4.3 搜索和 Graph View

搜索范围：

- 项目名。
- 模块名。
- 文件名和路径别名。
- Git commit message。
- Codex 会话标题、ID 和链接。
- 主题。
- 日志正文。

点击项目后，右侧显示项目详情，中间显示关系图，顶部显示时间范围和隐私/证据过滤器。

## 5. Graph View 设计

### 5.1 节点类型

| 节点 | 含义 | 默认层级 |
|---|---|---|
| Project | 项目或 Git 仓库 | 1 |
| Workspace | 工作区 | 0 |
| Module | 目录、功能模块或用户定义分组 | 2 |
| ChangeSet | 某日的变化集合 | 2 |
| File | 具体文件 | 3 |
| Commit | Git 提交 | 3 |
| CodexThread | Codex 会话引用或已导入会话 | 2/3 |
| Topic | 主题、技术概念或工作目标 | 2/3 |
| Journal | 日志或日志段落 | 2 |
| Task | 后续任务或未完成事项 | 2/3 |

### 5.2 关系类型

```text
Workspace contains Project
Project contains Module
Module contains File
Project has ChangeSet
ChangeSet includes File
Commit changes File
ChangeSet related_to CodexThread
CodexThread discusses Topic
Topic summarized_as Journal
Journal creates Task
```

### 5.3 分层展开规则

1. 默认仅展示 Workspace → Project → Module → ChangeSet/Journal/CodexThread。
2. 点击 Module 才显示 File 和 Commit。
3. 点击 File 才允许显示 diff 或正文摘要。
4. 未经授权的正文永远不进入图谱节点内容。
5. 超过节点阈值时，合并成“其他 37 个文件”节点。
6. 支持按日期、项目、来源、状态、置信度和隐私级别过滤。

### 5.4 Graph View 的可用性指标

- 首屏 2 秒内显示项目级图谱。
- 单个项目默认不超过 80 个可见节点。
- 用户 3 次点击内能从项目定位到模块和日志。
- 节点必须显示来源类型和数据更新时间。
- “仅链接”的 Codex 会话不能显示为“已读取内容”。

## 6. 文件扫描与分组

### 6.1 扫描级别

| 级别 | 内容 | AI token | 默认状态 |
|---|---|---:|---|
| L0 | 路径、大小、时间、类型、hash、Git 状态 | 0 | 开启 |
| L1 | 本地结构分析、diff 行数、commit 元数据 | 0 | 开启 |
| L2 | 用户选择的 Git diff 或变更函数 | 低 | 关闭，需选择 |
| L3 | 用户明确选择的文件正文 | 中/高 | 关闭，需选择 |
| L4 | 用户明确选择的 Codex 会话全文 | 高 | 关闭，需选择 |

### 6.2 增量检测

每个文件保存：

```text
path
size
mtime
content_hash
last_seen_at
last_summarized_hash
```

扫描逻辑：

1. 优先比较 Git 状态。
2. 对未跟踪或非 Git 文件使用 size + mtime 快速判断。
3. 只有需要确认时才计算 hash。
4. 只有用户选择 L2/L3 时才读取内容。
5. hash 未变化时复用本地摘要。

### 6.3 模块聚合策略

聚合顺序：

1. Git 仓库作为项目候选。
2. 一级/二级目录作为模块候选。
3. package、workspace、solution 等工程文件补充模块信息。
4. import/include/依赖关系作为结构参考。
5. commit message、文件名和路径规则辅助命名。
6. 用户可以合并、拆分、重命名模块。
7. AI 只在本地候选分组后负责命名或解释，不负责读取全盘。

### 6.4 文件读取选择器

用户点击模块后显示：

```text
scanner 模块：8 个变化文件

读取方式：
○ 仅元数据
○ 结构摘要
● Git diff
○ 选择文件正文

文件：
[√] src/scanner.ts       +180 -35
[√] src/hash-cache.ts    +60 -0
[ ] tests/scanner.test.ts +20 -10
[ ] config/local.json     疑似敏感，默认锁定
```

## 7. 隐私与安全设计

### 7.1 数据分类

| 数据 | 默认是否本地保存 | 默认是否发 AI |
|---|---:|---:|
| 文件路径 | 是 | 否 |
| 文件大小/时间/hash | 是 | 否 |
| Git commit message | 是 | 否，用户授权后可发 |
| Git diff | 是 | 否，用户授权后可发 |
| 文件正文 | 是 | 否，逐文件授权 |
| Codex 链接 | 是 | 否 |
| Codex 摘要 | 是 | 否，用户授权后可发 |
| Codex 全文 | 是 | 否，单次明确授权 |
| AI 日志 | 是 | 否，除非用户主动导出 |

### 7.2 敏感内容规则

默认排除：

```text
.env*
*.pem
*.key
*.p12
id_rsa*
credentials*
secret*
password*
token*
cookie*
*.sqlite
浏览器用户数据目录
```

内容脱敏至少支持：

- API key 和 token 模式识别。
- 邮箱、手机号和常见身份证号模式识别。
- 路径中的用户名替换为 `[USER_HOME]`。
- 自定义正则脱敏。
- 敏感文件完全禁止读取或仅显示统计。

### 7.3 权限状态机

```text
DISCOVERED
  → GROUPED
  → WAITING_FOR_CONSENT
  → APPROVED_METADATA
  → APPROVED_DIFF
  → APPROVED_FILE_CONTENT
  → REDACTED
  → READY_FOR_AI
  → SUMMARIZED
```

每次扩展读取范围都必须产生审计记录：

```text
谁：本地用户
何时：时间戳
范围：项目/模块/文件
级别：L0-L4
目的：摘要/日志/搜索
```

### 7.4 失败安全

- 无法判断是否敏感时，默认不发送。
- 无法估算 token 时，默认不调用云端模型。
- Codex 链接无法解析时，保留引用，不伪造内容。
- AI 返回的事实无法关联来源时标记为“待确认”。
- 用户取消授权后立即停止读取和发送。

## 8. Token 与成本控制

### 8.1 预算层级

```text
provider_budget
  daily_budget
    workflow_budget
      module_budget
        item_budget
```

建议默认值仅作为初始配置，用户可以修改：

```text
单次工作流：8,000 tokens
每日：30,000 tokens
单模块：3,000 tokens
单文件：1,500 tokens
输出上限：1,000 tokens
```

### 8.2 内容压缩顺序

```text
文件正文 → Git diff → 变更函数 → 结构摘要 → 文件名/统计信息
```

系统必须优先使用：

1. 本地规则和 Git 元数据。
2. 本地代码结构解析。
3. 已缓存摘要。
4. 小范围 diff。
5. 仅在必要时使用文件正文。

### 8.3 调用前预览

```text
本次任务：生成 scanner 模块日志
数据范围：2 个 Git diff、3 个 commit message、1 个用户回答
脱敏：已执行
预计输入：2,400 tokens
预计输出：400-700 tokens
预算余额：5,600 tokens

[生成] [调整内容] [取消]
```

### 8.4 缓存和去重

缓存键建议为：

```text
provider + model + prompt_version + content_hash + policy_version
```

相同 hash、相同提示词版本和相同隐私策略下，直接复用结果，不重复调用。

### 8.5 模型策略

AI Provider 必须抽象为接口，支持：

- OpenAI API。
- 本地模型。
- 仅规则模式。
- 用户自定义 OpenAI-compatible endpoint。

推荐任务路由：

```text
分类：本地规则
结构摘要：本地解析
模块摘要：低成本模型或本地模型
跨模块日志：用户确认后使用指定模型
```

不要在规划中绑定“最新模型名称”，应由 provider 配置和能力探测决定。

## 9. Codex 集成策略

### 9.1 深度链接解析

支持识别：

```text
codex://threads/<thread_id>
```

解析后保存：

```json
{
  "scheme": "codex",
  "resource": "threads",
  "thread_id": "01a04c0e-8316-7fa1-9be4-f9f65ef5ed47",
  "content_status": "link_only"
}
```

重要边界：深度链接通常只是资源定位符，不应被假定为包含会话正文。第三方程序能否根据该链接读取内容，取决于 Codex 是否提供正式的导出、授权或读取接口。官方能力未明确之前，核心功能不得依赖私有接口。

### 9.2 Provider 接口

```typescript
interface CodexSessionProvider {
  canHandle(input: string): boolean;
  parseReference(input: string): CodexSessionReference;
  getCapabilities(): CodexCapabilities;
  importContent(ref: CodexSessionReference): Promise<CodexSessionContent>;
}
```

### 9.3 Provider 优先级

1. LinkReferenceProvider：只保存链接和 ID，MVP 必做。
2. UserImportProvider：用户粘贴或导入会话文本，MVP 必做。
3. BrowserExtensionProvider：用户在页面点击导入，第二阶段。
4. CodexSkillProvider：在会话内生成标准 JSON，第二阶段。
5. OfficialApiProvider：只有正式公开接口可用后加入。
6. LocalCliProvider：实验性，可选，不进入核心依赖。

### 9.4 Codex 图谱状态

```text
link_only       仅有链接
summary_imported 已导入摘要
content_imported 已导入正文
redacted         已脱敏
linked           已关联项目/模块
```

## 10. 技术架构

```text
┌────────────────────────────────────┐
│ Tauri Desktop UI                   │
│ Today / Graph / Review / Journal   │
└──────────────────┬─────────────────┘
                   │ IPC
┌──────────────────▼─────────────────┐
│ Application Core                   │
│ workflow / policy / budget / search│
└──────┬──────────┬──────────┬───────┘
       │          │          │
┌──────▼─────┐ ┌──▼───────┐ ┌▼───────────┐
│ Evidence   │ │ Adapters │ │ AI Provider│
│ SQLite     │ │ FS/Git/  │ │ OpenAI/     │
│ FTS5       │ │ Codex    │ │ Local       │
└────────────┘ └──────────┘ └─────────────┘
```

### 10.1 推荐技术栈

- 桌面：Tauri 2.x。
- 前端：React + TypeScript。
- 图谱：Sigma.js + Graphology；小规模交互可选 React Flow。
- 核心：Rust；产品早期也可将部分 workflow 放在 TypeScript。
- 数据库：SQLite + FTS5。
- 文件监听：Rust `notify`。
- Git：优先调用系统 Git CLI，减少绑定库复杂度。
- 代码结构：Tree-sitter，作为第二阶段能力。
- 测试：Rust 单元测试、Vitest、Playwright/Tauri 集成测试。

### 10.2 模块边界

```text
core/
  evidence/
  grouping/
  consent/
  privacy/
  budget/
  journal/
  search/
adapters/
  filesystem/
  git/
  codex/
  ai/
storage/
ui/
```

## 11. 数据模型

核心表：

```text
workspaces
projects
modules
evidence_events
files
file_snapshots
commits
changesets
codex_sessions
topics
graph_nodes
graph_edges
consent_records
privacy_rules
ai_runs
ai_cache
questions
answers
journal_entries
tasks
```

关键字段建议：

```text
evidence_events
- id
- workspace_id
- source_type
- project_id
- module_id
- path_alias
- event_type
- content_hash
- occurred_at
- sensitivity_level
- read_level

ai_runs
- id
- purpose
- provider
- model
- prompt_version
- input_tokens
- output_tokens
- estimated_cost
- source_evidence_ids
- consent_record_id
- created_at
```

日志必须保存来源引用：

```json
{
  "text": "完成增量扫描器设计",
  "source_ids": ["evidence-1", "codex-2", "answer-4"],
  "confidence": "confirmed"
}
```

## 12. API 草案

本地 Core API 可先设计为内部 IPC，未来再暴露 localhost API。

```text
POST /workspaces
POST /workspaces/:id/scan
GET  /evidence?date=YYYY-MM-DD
POST /review/sessions
POST /consent
POST /summaries/estimate
POST /summaries/generate
POST /codex/references
POST /codex/imports
GET  /graph?project_id=...
GET  /search?q=...
POST /journals/draft
PUT  /journals/:id
POST /journals/:id/export
GET  /usage
```

安全约束：localhost API 默认只绑定 `127.0.0.1`，使用随机会话 token，禁止跨域写入，敏感操作需要 UI 生成的一次性授权票据。

## 13. 质量、测试和验收

### 13.1 功能验收

- 选择一个工作目录后，扫描只发生在该目录内。
- 扫描不读取未授权文件正文。
- Git diff 只在用户选择后被读取。
- 敏感文件默认不可选。
- 取消授权后，不继续读取或发送数据。
- 同一 hash 内容不重复调用 AI。
- 超过预算时不自动发起请求。
- 仅有 Codex 链接时，系统不显示会话正文摘要。
- 日志每个关键事实都能定位来源。
- Graph View 可以从项目定位到模块、证据、会话和日志。

### 13.2 安全验收

- API key 不写入日志和错误信息。
- 敏感文件测试集不会进入 AI request payload。
- 数据库导出不会包含明文密钥。
- 文件路径脱敏规则可测试、可关闭但默认开启。
- 应用卸载前提供数据目录位置和删除选项。

### 13.3 性能目标

- 10 万个文件元数据扫描不阻塞 UI。
- 1 万条证据记录搜索响应小于 300ms（本地基准机）。
- 1000 个图节点仍可缩放、筛选和定位。
- 日常增量扫描不重复读取未变化文件。

## 14. 发布策略

### 14.1 版本规划

```text
v0.1.0  CLI/核心扫描原型
v0.2.0  桌面端 + 今日审阅 + Markdown 日志
v0.3.0  Graph View + 搜索 + 预算面板
v0.4.0  Codex 链接/摘要导入
v0.5.0  浏览器扩展实验版
v0.6.0  插件 API、本地模型适配
v1.0.0  稳定版、迁移策略、完整文档
```

### 14.2 开源仓库应包含

- README。
- 中文和英文快速开始。
- 隐私说明。
- 威胁模型。
- 数据格式文档。
- Provider 开发指南。
- 贡献指南。
- 行为准则。
- Issue 模板。
- 安全漏洞报告流程。
- 发布包校验值。

建议核心采用 MIT 或 Apache-2.0。若未来增加云同步或团队服务，可单独拆分服务端许可和商业条款。

## 15. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 文件变更无法代表真实工作 | 日志失真 | 必须加入用户确认和手动补充 |
| 模块自动分类错误 | 图谱混乱 | 规则优先，允许用户调整 |
| token 成本不可控 | 用户不敢使用 | 预算、预估、缓存、增量和本地摘要 |
| 敏感内容泄露 | 严重 | 默认元数据、脱敏、发送预览、失败安全 |
| Codex 深度链接不可读取 | 功能受限 | 先做引用和用户导入，适配器隔离 |
| 页面/本地格式变化 | 适配器失效 | 版本检测、provider 能力声明 |
| 图节点过多 | 体验差 | 分层展开、聚合节点、阈值限制 |
| 用户每天不愿意回答问题 | 留存低 | 选择题、最多 3-8 个问题、可跳过 |

## 16. 成功指标

早期内测不追求扫描数量，而关注闭环价值：

- 用户从打开应用到保存日志的中位时间不超过 3 分钟。
- 至少 70% 的日志事实可追溯到证据或用户确认。
- 用户主动删除或排除的内容比例低于 20%。
- 日常流程中未经授权的文件正文读取次数为 0。
- 80% 的测试用户能在 Graph View 中找到一个项目的关联日志。
- 生成日志的 AI 请求中，缓存命中率逐步达到 30% 以上。

## 17. 近期执行顺序

1. 创建真正的项目仓库和最小可运行桌面壳。
2. 先完成 L0/L1 元数据扫描，不接 AI。
3. 完成模块聚合和今日审阅 UI。
4. 加入 consent、脱敏和 token budget，再接 AI。
5. 加入 Graph View 和搜索。
6. 加入 Codex 链接引用和用户导入。
7. 做一轮真实用户内测，再决定浏览器扩展方向。

