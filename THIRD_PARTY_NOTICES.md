# 第三方归属声明

本文件列出 Daytrace 借鉴或复用的第三方代码与规则集。Daytrace 本身采用 MIT 许可证。

维护规则：

- 直接复用代码时，vendor 到 `third_party/<repo>/`，保留原文件头，改动处加注释说明，并在本文件登记。
- 只借鉴规则（正则表、域名表、过滤规则、字段清单）而按本项目语言重写时，同样在本文件登记 —— 表达本身受版权保护。
- 借鉴前打开对应仓库根目录的 `LICENSE` 文件确认许可证，不要只看 GitHub 侧栏的自动识别标签。
- 登记时写明具体借鉴了什么，便于日后升级时对照上游变更。

---

## temosy/devlog

- 来源：https://github.com/temosy/devlog
- 许可证：MIT
- 借鉴内容：AI 会话 JSONL 的解析与过滤规则（`src/transcript.rs`、`src/codex.rs`），包括时间窗口判定、`isSidechain` 过滤、内容块筛选与工具调用提取规则；从会话 `cwd` 反查 git 仓库的思路（`src/gitlog.rs`）。
- 形式：按 TypeScript 重写，非代码复制。

```text
（此处粘贴 devlog 的 MIT 许可证全文）
```

## brianruggieri/obsidian-daily-digest

- 来源：https://github.com/brianruggieri/obsidian-daily-digest
- 许可证：MIT（© Brian Ruggieri, 2026）
- 借鉴内容：密钥与 PII 脱敏模式集、域名敏感分类表、隐私分级降级链与发送前预览的设计（`src/filter/sanitize.ts`、`src/filter/sensitivity.ts`）。
- 形式：规则集移植 + 设计参考。

```text
（此处粘贴 obsidian-daily-digest 的 MIT 许可证全文）
```

## jvalentini/worklog

- 来源：https://github.com/jvalentini/worklog
- 许可证：MIT
- 借鉴内容：多数据源适配器的接口形状与源清单。
- 形式：设计参考，未复制代码。

```text
（此处粘贴 worklog 的 MIT 许可证全文）
```

---

## 明确未借鉴

- **reorproject/reor** — AGPL-3.0。本项目未复制其任何代码。复制会导致 Daytrace 整体落入 AGPL（含网络服务条款）。仅作为产品层面的参考案例引用。
