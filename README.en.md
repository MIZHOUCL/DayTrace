# DayTrace

Turn the work you actually did today into a journal where **every sentence links back to its evidence**.

Zero dependencies. Zero network calls. No API key. Works on macOS and Windows.

[中文文档](./README.md)

## Quick start

```bash
git clone https://github.com/MIZHOUCL/DayTrace.git
cd DayTrace
node bin/daytrace.js today --root ~/code
```

Then install it globally if you like it:

```bash
npm link          # or: npm i -g .
daytrace today
```

Requires Node ≥ 22.13 (or ≥ 23.4 on the 23.x line) — that is when `node:sqlite` stopped requiring `--experimental-sqlite`. **No third-party packages** — `npm i` needs no compiler and no Rust toolchain.

## What it does

```text
daytrace today
  → reads git: today's commits, diff --stat, working-tree status
  → scans files: today's changes outside git repos under --root (path and time only)
  → reads local AI sessions: ~/.claude/projects/**, ~/.codex/sessions/**
  → groups them by project using each session's cwd / gitBranch
  → generates footnoted Markdown with pure rules (zero model calls)
  → writes it to --out (an Obsidian vault works fine)
```

Sample output:

```markdown
## [[novel-ide]]

- Replaced the hash cache with lazy evaluation (3 files, +180 −35)[^ev1]
- Claude Code session: refactored the incremental scanner, 6 files touched[^ev2][^ev3]

[^ev1]: commit `1a2b3c4` — replace hash cache with lazy evaluation (2026-09-03T06:22:00Z)
[^ev2]: session `a1b2c3d4` message #42 (2026-09-03T14:22:11Z): make the scanner hash lazy
[^ev3]: session `a1b2c3d4` action — file: src/scanner.ts
```

Run `daytrace show commit:1a2b3c4` to print the raw evidence behind any footnote. Anything that cannot be traced to real evidence is marked `unverified` rather than presented as fact.

## Why another work-log tool

Three MIT projects already read AI sessions and git to write daily logs — see [docs/PRIOR_ART.md](./docs/PRIOR_ART.md) for the full comparison. All of them stop at **session-level** attribution: a `[Claude Code]` tag, a frontmatter field, a per-repo grouping.

DayTrace bets on one thing none of them do: **per-sentence traceability** — every bullet carries `source_ids` pointing at a specific commit or a specific message in a specific session, plus a `confirmed` / `inferred` / `unverified` marker. A reference-integrity pass rejects any `source_id` that does not exist in the evidence table and downgrades the sentence instead of letting a fabricated citation through.

## Commands

| Command | What it does |
|---|---|
| `daytrace today` | Journal for today |
| `daytrace date 2026-09-03` | Journal for a specific day |
| `daytrace week [date]` | 7-day rollup ending on that day |
| `daytrace modules [date]` | List the day's **modules** — the unit you pick from when writing the journal |
| `daytrace show commit:1a2b3c4` | Print one piece of evidence (hash prefixes work) |
| `daytrace where` | Print data dir, database and config paths |
| `daytrace init` | Write a default config file |
| `daytrace purge --yes` | Delete all local data |

Common flags: `--root <dir>` (repeatable), `--out <dir>`, `--cutoff <hour>`, `--tz <IANA zone>`, `--author <name-or-email>`, `--no-files`, `--json`, `--dry-run`.

Pass `--author` when working in shared repositories, otherwise other people's commits end up in your journal.

## About "today"

`--cutoff` is the local day boundary, **04:00** by default: code written at 2am counts as the previous day.

**The time zone follows your machine by default** — no configuration needed. `daytrace where` prints the zone and offset currently in effect, and so does the journal footer. To pin a zone regardless of where the machine is, pass `--tz Asia/Shanghai` or set `"timezone"` in `config.json`; only IANA names are accepted (`UTC+8` is rejected rather than silently treated as UTC).

All timestamps are stored in UTC and the owning date is derived separately, so changing zones only regroups — it never rewrites data. DST is handled: `America/New_York` gets a 23-hour day on 2026-03-08 and a 25-hour day on 2026-11-01, with tests to prove it.

## Privacy defaults

- Reads only what you point it at: directories under `--root` (git repos plus file changes outside them), `~/.claude/projects`, `~/.codex/sessions`. Never scans your whole disk.
- The file scan records **path, mtime and size only** — never contents. It skips dotfiles, heavy directories like `node_modules`, and likely-secret files (`.env`, `*.pem`, `id_rsa`) without even recording their paths. Disable it entirely with `--no-files`.
- Reads git metadata and **your own session prompts** only — never file contents, never diff bodies, never assistant replies.
- **There is no network code in this repository at all** (`grep -rE "fetch\(|node:http" src` comes back empty; CI enforces it).
- Data lives in a local SQLite file. `daytrace where` shows it, `daytrace purge --yes` removes it.
- External images in the generated Markdown are degraded to plain text, so session or diff content cannot exfiltrate data when rendered.

Data directory: `~/Library/Application Support/daytrace` on macOS, `%APPDATA%\daytrace` on Windows. Override with `DAYTRACE_DATA_DIR`. You get a warning if it sits inside iCloud / OneDrive / Dropbox, because SQLite WAL files can corrupt in sync directories.

## Development

```bash
node --test          # 58 tests, zero dependencies
node bin/daytrace.js today --dry-run   # no database writes, no files written
```

Layout: `src/time.js` day boundary ｜ `src/db.js` 6 tables and migrations ｜ `src/collect/git.js` git ｜ `src/collect/providers/*` session adapters ｜ `src/facts.js` facts and reference validation ｜ `src/render.js` Markdown.

## Status

Early. The skeleton runs end-to-end, 20 of the 21 v0.1 P0 tasks are done, 34 unit tests.

CI has run on GitHub: **macOS and Windows are both green on Node 24 and 25.** Node 22.5 failed on both platforms — `node:sqlite` requires `--experimental-sqlite` until 22.13 / 23.4, so the supported range has been corrected and the CLI now checks it at startup ([ADR-018](./docs/ADR.md)).

See [docs/MVP_ISSUES.md](./docs/MVP_ISSUES.md) for the honest list of what is verified and what is not.

## License

MIT. Session-parsing rules are adapted from [temosy/devlog](https://github.com/temosy/devlog) (MIT); attribution in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

