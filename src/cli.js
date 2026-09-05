/**
 * CLI 入口。默认路径只有一条命令，不问任何问题（PROJECT_PLAN §4.1）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig, saveConfig, dataDir, dbPath, configPath, syncDirWarning } from './config.js';
import { dayRange, multiDayRange, todayLocalDate, localDateOf, applyTimeZone, systemTimeZone, utcOffsetLabel } from './time.js';
import { openDb, upsertEvidence } from './db.js';
import { findRepos, collectRepo, gitAvailable, repoOf } from './collect/git.js';
import { collectSessions } from './collect/sessions.js';
import { scanFiles, projectDirOf } from './collect/files.js';
import { buildProjects, attributeSession, repoContaining, projectIdOf, makeResolver } from './attribute.js';
import { evidenceFromGit, evidenceFromSession, evidenceFromFiles, buildFacts, validateReferences, sourceId } from './facts.js';
import { renderMarkdown } from './render.js';
import { buildModules } from './modules.js';

const USAGE = `daytrace — 把今天的工作痕迹整理成每句话都能点回证据的日志

用法
  daytrace today [选项]            生成今天的日志
  daytrace date <YYYY-MM-DD>       生成指定日期的日志
  daytrace week [YYYY-MM-DD]       生成截止到该日的 7 天汇总
  daytrace modules [YYYY-MM-DD]    列出当天的模块（写日记的选择单位）
  daytrace show <source_id>        查看某条证据（如 commit:a9c7471）
  daytrace where                   打印数据目录与配置路径
  daytrace init                    写出默认配置文件
  daytrace purge                   删除全部本地数据（需 --yes）

选项
  --root <dir>      要扫描的目录，可重复；默认取配置或当前目录
  --out <dir>       把 Markdown 写到该目录（文件名 YYYY-MM-DD.md）
  --cutoff <hour>   本地日界小时，默认 4
  --tz <IANA>       指定时区，如 Asia/Shanghai；默认跟随本机时区
  --author <s>      只统计该作者的 commit
  --no-files        关闭文件系统扫描（只看 git 与 AI 会话）
  --json            输出结构化 JSON 而不是 Markdown
  --dry-run         不写数据库、不写文件
  --yes             purge 的确认标志
  -h, --help        显示本帮助

默认行为：不联网、不需要 API key、不读文件正文、不读 diff 正文。`;

const OPTIONS = {
  root: { type: 'string', multiple: true },
  out: { type: 'string' },
  cutoff: { type: 'string' },
  tz: { type: 'string' },
  author: { type: 'string' },
  json: { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  'no-files': { type: 'boolean', default: false },
  yes: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}\n`);
    return 2;
  }
  const { values: flags, positionals } = parsed;
  const command = positionals[0] ?? 'today';
  if (flags.help || command === 'help') {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const cfg = loadConfig();
  if (flags.tz) cfg.timezone = flags.tz;
  // 时区必须在任何日期计算之前生效
  let effectiveTz;
  try {
    effectiveTz = applyTimeZone(cfg.timezone);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 2;
  }
  cfg.effectiveTimezone = effectiveTz;
  if (flags.root?.length) cfg.roots = flags.root;
  if (flags.out) cfg.out = flags.out;
  if (flags.author) cfg.authorFilter = flags.author;
  if (flags.cutoff !== undefined) {
    const h = Number.parseInt(flags.cutoff, 10);
    if (!Number.isInteger(h) || h < 0 || h > 23) {
      process.stderr.write('--cutoff 必须是 0-23 的整数\n');
      return 2;
    }
    cfg.cutoffHour = h;
  }

  switch (command) {
    case 'today':
      return runReport(cfg, dayRange(todayLocalDate(cfg.cutoffHour), cfg.cutoffHour), flags);
    case 'date': {
      const d = positionals[1];
      if (!d) {
        process.stderr.write('用法：daytrace date <YYYY-MM-DD>\n');
        return 2;
      }
      return runReport(cfg, dayRange(d, cfg.cutoffHour), flags);
    }
    case 'week': {
      const d = positionals[1] ?? todayLocalDate(cfg.cutoffHour);
      return runReport(cfg, multiDayRange(d, 7, cfg.cutoffHour), flags);
    }
    case 'modules': {
      const d = positionals[1] ?? todayLocalDate(cfg.cutoffHour);
      return runModules(cfg, dayRange(d, cfg.cutoffHour), flags);
    }
    case 'show':
      return showEvidence(positionals[1], flags);
    case 'where':
      return where();
    case 'init':
      return init(cfg);
    case 'purge':
      return purge(flags);
    default:
      process.stderr.write(`未知命令：${command}\n\n${USAGE}\n`);
      return 2;
  }
}

/** 采集：git + 会话 + 文件扫描 → 归因分组。runReport 与 runModules 共用。 */
function collectAll(cfg, range, flags) {
  const nowIso = new Date().toISOString();
  const warn = syncDirWarning();
  if (warn && !flags.json) process.stderr.write(`警告：${warn}\n`);
  if (!gitAvailable()) {
    process.stderr.write('未找到 git 命令。Windows 上请安装 Git for Windows 并确保它在 PATH 中。\n');
    process.stderr.write('（仍会继续采集 AI 会话，只是没有 commit 证据。）\n');
  }

  const repos = gitAvailable() ? findRepos(cfg.roots) : [];
  if (!repos.length && !flags.json) {
    process.stderr.write(
      `提示：以下目录里没有找到 git 仓库，所以这份日志不含任何 commit 证据。\n${cfg.roots.map((r) => `  ${r}`).join('\n')}\n` +
        `把 --root 指向你真正写代码的目录（可重复），例如：\n` +
        `  daytrace today --root ~/code --root ~/work\n` +
        `或者跑一次 daytrace init，把目录写进 config.json 的 roots，以后就不用带参数了。\n\n`,
    );
  }
  const { sessions, report } = collectSessions(cfg.sessionDirs, range, cfg.cutoffHour);

  // 文件系统扫描：仓库外的改动由它负责，仓库内的交给 git，避免重复计数（ADR-019）
  const fileScanOn = cfg.fileScan?.enabled !== false && !flags['no-files'];
  const fileScan = fileScanOn
    ? scanFiles(cfg.roots, range, {
        repos,
        maxDepth: cfg.fileScan?.maxDepth ?? 6,
        maxFiles: cfg.fileScan?.maxFiles ?? 5000,
        extraExcludes: cfg.fileScan?.extraExcludes ?? [],
        mode: cfg.fileScan?.mode ?? 'worklike',
        extraExtensions: cfg.fileScan?.extraExtensions ?? [],
      })
    : { hits: [], stats: { scanned: 0, dirs: 0, skippedInRepo: 0, skippedSensitive: 0, skippedNoise: 0, truncated: false } };
  if (!flags.json && fileScanOn) {
    const s = fileScan.stats;
    if (s.truncated) {
      process.stderr.write(`文件扫描达到上限 ${cfg.fileScan?.maxFiles ?? 5000} 个，结果已截断。调大 config.json 的 fileScan.maxFiles 可放宽。\n`);
    }
    if (s.skippedSensitive) process.stderr.write(`已跳过 ${s.skippedSensitive} 个疑似敏感文件（连路径都不记录）。\n`);
    if (s.skippedNoise) process.stderr.write(`已过滤 ${s.skippedNoise} 个非工作产物（应用状态、临时文件、安装包等）。\n`);
  }

  const projects = buildProjects(repos, sessions, {
    rules: cfg.rules,
    extraDirs: [...new Set(fileScan.hits.map((h) => projectDirOf(h.path, cfg.roots)))],
  });

  const gitByProject = new Map();
  const resolveProject = makeResolver(projects);
  const isToday = range.localDate === todayLocalDate(cfg.cutoffHour);
  const gitWarnings = [];
  for (const repo of repos) {
    const result = collectRepo(repo, range, { authorFilter: cfg.authorFilter });
    gitWarnings.push(...(result.warnings ?? []));
    // 未提交改动属于「现在」，生成过去某天的日志时不能算进去
    if (!isToday) result.dirty = [];
    const id = resolveProject(repo) ?? projectIdOf(repo);
    if (!result.commits.length && !result.dirty.length) continue;
    if (!gitByProject.has(id)) gitByProject.set(id, []);
    gitByProject.get(id).push(result);
  }
  if (gitWarnings.length && !flags.json) {
    process.stderr.write(`git 采集有 ${gitWarnings.length} 处失败（证据可能不完整）：\n${gitWarnings.slice(0, 5).map((w) => `  ${w}`).join('\n')}\n\n`);
  }

  const sessionsByProject = new Map();
  for (const s of sessions) {
    let pid = attributeSession(s, projects) ?? resolveProject(s.cwd);
    if (!pid) {
      const owner = repoOf(s.cwd) || s.cwd;
      pid = resolveProject(owner) ?? projectIdOf(owner);
    }
    s.projectId = pid;
    if (!sessionsByProject.has(pid)) sessionsByProject.set(pid, []);
    sessionsByProject.get(pid).push(s);
  }

  const filesByProject = new Map();
  const projectIdForFile = (p) => {
    const dir = projectDirOf(p, cfg.roots);
    return resolveProject(dir) ?? projectIdOf(dir);
  };
  for (const h of fileScan.hits) {
    const pid = projectIdForFile(h.path);
    if (!filesByProject.has(pid)) filesByProject.set(pid, []);
    filesByProject.get(pid).push(h);
  }

  return { nowIso, repos, sessions, report, fileScan, fileScanOn, projects, gitByProject, sessionsByProject, filesByProject, projectIdForFile };
}

/** 落库 → 事实 → 引用校验 → 渲染。 */
function runReport(cfg, range, flags) {
  const { nowIso, repos, sessions, report, fileScan, fileScanOn, projects, gitByProject, sessionsByProject, filesByProject, projectIdForFile } =
    collectAll(cfg, range, flags);

  const db = openDb(flags['dry-run'] ? ':memory:' : dbPath());
  try {
    persistProjects(db, projects, nowIso);
    const evidenceIndex = new Map();
    for (const [pid, results] of gitByProject) {
      for (const r of results) {
        persistCommits(db, r, pid);
        for (const row of evidenceFromGit(r, pid, cfg.cutoffHour, nowIso)) {
          upsertEvidence(db, row);
          evidenceIndex.set(sourceId(row.source_type, row.source_ref), row);
        }
      }
    }
    for (const s of sessions) {
      persistSession(db, s);
      for (const row of evidenceFromSession(s, s.projectId, cfg.cutoffHour)) {
        upsertEvidence(db, row);
        evidenceIndex.set(sourceId(row.source_type, row.source_ref), row);
      }
    }
    for (const row of evidenceFromFiles(fileScan.hits, projectIdForFile, cfg.cutoffHour)) {
      upsertEvidence(db, row);
      evidenceIndex.set(sourceId(row.source_type, row.source_ref), row);
    }

    const localDate = range.localDate;
    const facts = buildFacts({ projects, gitByProject, sessionsByProject, filesByProject }, localDate);
    const { downgraded, missing } = validateReferences(db, facts, localDate);
    if (downgraded && !flags.json) {
      process.stderr.write(`引用校验：${downgraded} 条事实因来源缺失被降级为 unverified\n`);
    }

    const markdown = renderMarkdown({
      localDate,
      projects,
      facts,
      evidenceIndex,
      report,
      cutoffHour: cfg.cutoffHour,
      repoCount: repos.length,
      fileScan: fileScanOn ? fileScan.stats : null,
      timeZone: cfg.effectiveTimezone,
      utcOffset: utcOffsetLabel(),
    });

    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ localDate, range, repos, report, fileScan, projects, facts, downgraded, missing }, null, 2)}\n`);
    } else {
      process.stdout.write(`${markdown}\n`);
    }

    if (!flags['dry-run']) {
      persistJournal(db, localDate, markdown, nowIso, writeOut(cfg, localDate, markdown, flags));
    }
    return 0;
  } finally {
    db.close();
  }
}

/** 只跑到「模块」这一步，给前端和调试用。 */
function runModules(cfg, range, flags) {
  const ctx = collectAll(cfg, range, flags);
  const modules = buildModules(
    {
      projects: ctx.projects,
      gitByProject: ctx.gitByProject,
      sessionsByProject: ctx.sessionsByProject,
      filesByProject: ctx.filesByProject,
      nowIso: ctx.nowIso,
    },
    { gapMinutes: cfg.gapMinutes },
  );

  if (flags.json) {
    process.stdout.write(`${JSON.stringify({ localDate: range.localDate, modules }, null, 2)}\n`);
    return 0;
  }

  const lines = [`${range.localDate} 共 ${modules.length} 个模块（按权重排序）`, ''];
  for (const m of modules) {
    const mark = m.selected ? '●' : '○';
    const time = m.durationMin ? `${hhmm(m.startTs)}-${hhmm(m.endTs)}` : hhmm(m.startTs);
    const bits = [];
    if (m.stats.commits) bits.push(`${m.stats.commits} 提交`);
    if (m.stats.prompts) bits.push(`${m.stats.prompts} 提问`);
    if (m.stats.commands) bits.push(`${m.stats.commands} 命令`);
    if (m.stats.files) bits.push(`${m.stats.files} 文件`);
    lines.push(`${mark} [${m.category}] ${m.title}`);
    lines.push(`    ${m.projectName}｜${time}｜${bits.join('、') || '无'}｜权重 ${m.score}`);
  }
  lines.push('', '● = 默认写进日记，○ = 默认排除。前端里可以逐个切换。');
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

function hhmm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function persistProjects(db, projects, nowIso) {
  const stmt = db.prepare(
    `INSERT INTO projects (id, name, root_path, user_renamed, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, root_path = excluded.root_path`,
  );
  for (const p of projects) stmt.run(p.id, p.name, p.rootPath, p.userRenamed ? 1 : 0, nowIso);
}

function persistCommits(db, result, projectId) {
  const stmt = db.prepare(
    `INSERT INTO commits (hash, project_id, message, author, committed_at, branch, files, additions, deletions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (hash) DO NOTHING`,
  );
  for (const c of result.commits) {
    stmt.run(c.hash, projectId, c.message, c.author ?? null, c.committedAt, result.branch, c.files.length, c.additions, c.deletions);
  }
}

function persistSession(db, s) {
  db.prepare(
    `INSERT INTO sessions (id, provider_id, thread_id, title, cwd, git_branch, project_id, first_ts, last_ts, content_status, schema_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET title = COALESCE(excluded.title, sessions.title),
       last_ts = excluded.last_ts, project_id = excluded.project_id`,
  ).run(
    `${s.providerId}:${s.sessionId}`,
    s.providerId,
    s.threadId ?? s.sessionId,
    s.title ?? null,
    s.cwd ?? null,
    s.gitBranch ?? null,
    s.projectId ?? null,
    s.firstTs ?? null,
    s.lastTs ?? null,
    'summary_imported',
    s.schemaVersion ?? null,
  );
}

function persistJournal(db, localDate, markdown, nowIso, outPath) {
  db.prepare(
    `INSERT INTO journals (id, local_date, markdown, out_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (local_date) DO UPDATE SET markdown = excluded.markdown,
       out_path = excluded.out_path, updated_at = excluded.updated_at`,
  ).run(`journal:${localDate}`, localDate, markdown, outPath ?? null, nowIso, nowIso);
}

function writeOut(cfg, localDate, markdown, flags) {
  const dir = cfg.out;
  if (!dir) return null;
  const target = path.join(dir, `${localDate}.md`);
  fs.mkdirSync(dir, { recursive: true });
  // 重新生成前先做带时间戳的备份，保住用户手写内容
  if (fs.existsSync(target)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(target, `${target}.${stamp}.bak`);
  }
  fs.writeFileSync(target, `${markdown}\n`, 'utf8');
  if (!flags.json) process.stderr.write(`已写入 ${target}\n`);
  return target;
}

function showEvidence(sid, flags) {
  if (!sid) {
    process.stderr.write('用法：daytrace show <source_id>，如 commit:a9c7471 或 session:<sid>#42\n');
    return 2;
  }
  const db = openDb(dbPath());
  try {
    const i = sid.indexOf(':');
    const type = i < 0 ? null : sid.slice(0, i);
    const ref = i < 0 ? sid : sid.slice(i + 1);
    const rows = type
      ? db.prepare('SELECT * FROM evidence WHERE source_type = ? AND source_ref LIKE ? ORDER BY occurred_at').all(type, `${ref}%`)
      : db.prepare('SELECT * FROM evidence WHERE source_ref LIKE ? ORDER BY occurred_at').all(`${ref}%`);
    if (!rows.length) {
      process.stderr.write(`未找到证据：${sid}\n`);
      return 1;
    }
    if (flags.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return 0;
    }
    for (const r of rows) {
      process.stdout.write(
        `${r.source_type}:${r.source_ref}\n  项目 ${r.project_id ?? '-'}｜级别 ${r.level}｜发生于 ${r.occurred_at}｜归属日 ${r.local_date}\n` +
          `  ${r.path ? `路径 ${r.path}\n  ` : ''}${r.excerpt ?? ''}\n\n`,
      );
    }
    return 0;
  } finally {
    db.close();
  }
}

function where() {
  const cfg = loadConfig();
  const tz = applyTimeZone(cfg.timezone);
  process.stdout.write(
    `数据目录：${dataDir()}\n数据库：${dbPath()}\n配置：${configPath()}\n` +
      `时区：${tz ?? '未知'}（UTC${utcOffsetLabel()}）${cfg.timezone ? '，来自 config.timezone' : '，跟随本机'}\n` +
      `日界：每天本地 ${String(cfg.cutoffHour).padStart(2, '0')}:00\n`,
  );
  const warn = syncDirWarning();
  if (warn) process.stdout.write(`\n警告：${warn}\n`);
  process.stdout.write('\n删除全部数据：daytrace purge --yes\n');
  return 0;
}

function init(cfg) {
  const file = saveConfig(cfg);
  process.stdout.write(`已写出配置：${file}\n\n${JSON.stringify(cfg, null, 2)}\n`);
  return 0;
}

function purge(flags) {
  const dir = dataDir();
  if (!flags.yes) {
    process.stderr.write(`这会删除整个数据目录：${dir}\n确认请加 --yes\n`);
    return 2;
  }
  if (!fs.existsSync(dir)) {
    process.stdout.write(`数据目录不存在，无需删除：${dir}\n`);
    return 0;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(`已删除：${dir}\n`);
  return 0;
}
