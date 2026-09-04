/**
 * 事实构建与引用完整性校验（ADR-006，本项目唯一的差异点）。
 *
 * 三态：
 *  confirmed  —— 每个 source_id 都指向真实存在的证据行，且文字可由该证据直接支撑
 *  inferred   —— 由规则或模型归纳，来源存在但表述超出原文
 *  unverified —— 无法关联到任何证据
 */
import path from 'node:path';
import { localDateOf } from './time.js';
import { evidenceExists } from './db.js';

/** source_id 形如 "commit:<hash>" / "session:<sid>#<idx>"，只按第一个冒号切分。 */
export function parseSourceId(sourceId) {
  const i = sourceId.indexOf(':');
  if (i < 0) return null;
  return { sourceType: sourceId.slice(0, i), sourceRef: sourceId.slice(i + 1) };
}

export function sourceId(sourceType, sourceRef) {
  return `${sourceType}:${sourceRef}`;
}

/** 会话标题在要点里只显示前 40 字，完整原文留在脚注里。 */
export function shortLabel(text, max = 40) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 单个会话最多逐条列出多少条提问，其余折叠成一行。 */
export const MAX_PROMPTS_SHOWN = 12;

/** 单个项目最多逐个列出多少个改动文件，其余折叠成一行。 */
export const MAX_FILES_SHOWN = 15;

/** git 采集结果 → 证据行。 */
export function evidenceFromGit(repoResult, projectId, cutoffHour, nowIso) {
  const rows = [];
  for (const c of repoResult.commits) {
    rows.push({
      source_type: 'commit',
      source_ref: c.hash,
      project_id: projectId,
      occurred_at: c.committedAt,
      local_date: localDateOf(c.committedAt, cutoffHour),
      level: 'L0',
      excerpt: c.message,
    });
  }
  for (const d of repoResult.dirty) {
    rows.push({
      source_type: 'worktree',
      source_ref: `${projectId}:${d.path}`,
      project_id: projectId,
      path: path.join(repoResult.repo, d.path),
      path_alias: d.path,
      occurred_at: nowIso,
      local_date: localDateOf(nowIso, cutoffHour),
      level: 'L0',
      excerpt: d.status,
    });
  }
  return rows;
}

/** 文件系统扫描结果 → 证据行（只有路径与时间，没有正文）。 */
export function evidenceFromFiles(hits, projectIdFor, cutoffHour) {
  return hits.map((h) => ({
    source_type: 'file',
    source_ref: h.path,
    project_id: projectIdFor(h.path),
    path: h.path,
    path_alias: baseName(h.path),
    occurred_at: h.mtime,
    local_date: localDateOf(h.mtime, cutoffHour),
    level: 'L0',
    excerpt: `${h.size} bytes`,
  }));
}

/** 会话 → 证据行。用户输入是 L1，不含助手回复。 */export function evidenceFromSession(session, projectId, cutoffHour) {
  const rows = [];
  for (const p of session.prompts) {
    rows.push({
      source_type: 'session',
      source_ref: `${session.sessionId}#${p.index}`,
      project_id: projectId,
      occurred_at: p.ts,
      local_date: p.localDate ?? localDateOf(p.ts, cutoffHour),
      level: 'L1',
      excerpt: p.text,
    });
  }
  for (const a of session.actions) {
    rows.push({
      source_type: 'session-action',
      source_ref: `${session.sessionId}#${a.index}:${a.kind}:${a.value}`,
      project_id: projectId,
      path: a.kind === 'file' ? a.value : null,
      path_alias: a.kind === 'file' ? path.basename(a.value) : null,
      occurred_at: a.ts,
      local_date: localDateOf(a.ts, cutoffHour),
      level: 'L1',
      excerpt: `${a.kind}: ${a.value}`,
    });
  }
  return rows;
}

/**
 * 纯规则生成事实（零模型调用）。
 * @param {{projects:any[], gitByProject:Map<string,any[]>, sessionsByProject:Map<string,any[]>}} input
 * @param {string} localDate
 */
export function buildFacts(input, localDate) {
  const facts = [];
  const push = (projectId, text, ids, confidence, occurredAt, depth = 0) => {
    facts.push({
      id: `fact:${projectId}:${facts.length}`,
      project_id: projectId,
      text,
      source_ids: ids,
      confidence,
      occurred_at: occurredAt ?? null,
      local_date: localDate,
      depth,
    });
  };

  for (const project of input.projects) {
    const repoResults = input.gitByProject.get(project.id) ?? [];
    const sessions = input.sessionsByProject.get(project.id) ?? [];

    for (const r of repoResults) {
      for (const c of r.commits) {
        const stat = c.files.length ? `（${c.files.length} 个文件，+${c.additions} −${c.deletions}）` : '';
        push(project.id, `提交「${c.message}」${stat}`, [sourceId('commit', c.hash)], 'confirmed', c.committedAt);
      }
      if (r.dirty.length) {
        const shown = r.dirty.slice(0, 5).map((d) => d.path);
        const more = r.dirty.length > shown.length ? ` 等 ${r.dirty.length} 个` : '';
        push(
          project.id,
          `工作树有未提交改动：${shown.join('、')}${more}`,
          r.dirty.map((d) => sourceId('worktree', `${project.id}:${d.path}`)),
          'confirmed',
          null,
        );
      }
    }

    for (const s of sessions) {
      pushSessionFacts(push, project.id, s);
    }

    const fileHits = input.filesByProject?.get(project.id) ?? [];
    if (fileHits.length) pushFileFacts(push, project, fileHits);
  }

  return facts;
}

/** 文件系统改动 → 事实。概览 + 逐个文件（超出上限折叠）。 */
function pushFileFacts(push, project, hits) {
  const ids = hits.map((h) => sourceId('file', h.path));
  push(
    project.id,
    `改动 ${hits.length} 个文件（不在 git 仓库内，按文件修改时间）`,
    ids.slice(0, 6),
    'confirmed',
    hits[0].mtime,
    0,
  );
  const shown = hits.slice(0, MAX_FILES_SHOWN);
  for (const h of shown) {
    push(project.id, relativeTo(project.rootPath, h.path), [sourceId('file', h.path)], 'confirmed', h.mtime, 1);
  }
  if (hits.length > shown.length) {
    const rest = hits.slice(shown.length);
    push(
      project.id,
      `另有 ${rest.length} 个文件（用 --json 看完整列表）`,
      rest.slice(0, 20).map((h) => sourceId('file', h.path)),
      'confirmed',
      rest[0].mtime,
      1,
    );
  }
}

/** 尽量显示相对路径，读起来短；拿不到相对关系就退回文件名。 */
function relativeTo(rootPath, filePath) {
  if (!rootPath) return baseName(filePath);
  const norm = (p) => String(p).replace(/[/\\]+$/, '');
  const root = norm(rootPath);
  if (filePath.startsWith(`${root}/`) || filePath.startsWith(`${root}\\`)) {
    return filePath.slice(root.length + 1);
  }
  return baseName(filePath);
}

/** 一个会话展开成多条事实：概览 + 每条提问 + 改动文件 + 执行命令。 */
function pushSessionFacts(push, projectId, s) {
  const providerLabel = s.providerId === 'codex' ? 'Codex' : 'Claude Code';
  const shortId = String(s.sessionId).slice(0, 8);
  // 只有 Claude Code 的 ai-title 是真标题；Codex 没有标题，不要拿用户某句话冒充
  const label = s.title ? `「${shortLabel(s.title, 50)}」` : ` \`${shortId}\``;

  const files = [...new Set(s.actions.filter((a) => a.kind === 'file').map((a) => a.value))];
  const commands = s.actions.filter((a) => a.kind === 'command');
  const overviewIds = [];
  if (s.prompts[0]) overviewIds.push(sourceId('session', `${s.sessionId}#${s.prompts[0].index}`));

  const parts = [];
  if (s.prompts.length) parts.push(`提问 ${s.prompts.length} 条`);
  if (files.length) parts.push(`改动 ${files.length} 个文件`);
  if (commands.length) parts.push(`执行 ${commands.length} 条命令`);
  push(
    projectId,
    `${providerLabel} 会话${label}：${parts.join('、') || '无可提取内容'}`,
    overviewIds,
    overviewIds.length ? 'confirmed' : 'unverified',
    s.firstTs,
    0,
  );

  // 逐条列出用户提问 —— 这是日志的正文，不能只留第一条
  const shownPrompts = s.prompts.slice(0, MAX_PROMPTS_SHOWN);
  for (const p of shownPrompts) {
    push(projectId, shortLabel(p.text, 90), [sourceId('session', `${s.sessionId}#${p.index}`)], 'confirmed', p.ts, 1);
  }
  if (s.prompts.length > shownPrompts.length) {
    const rest = s.prompts.slice(shownPrompts.length);
    push(
      projectId,
      `另有 ${rest.length} 条提问（用 daytrace show session:${s.sessionId}#<序号> 查看）`,
      rest.map((p) => sourceId('session', `${s.sessionId}#${p.index}`)),
      'confirmed',
      rest[0].ts,
      1,
    );
  }

  if (files.length) {
    const shown = files.slice(0, 8);
    const more = files.length > shown.length ? ` 等 ${files.length} 个` : '';
    push(
      projectId,
      `改动文件：${shown.map(baseName).join('、')}${more}`,
      s.actions.filter((a) => a.kind === 'file').slice(0, 20).map((a) => sourceId('session-action', `${s.sessionId}#${a.index}:${a.kind}:${a.value}`)),
      'confirmed',
      null,
      1,
    );
  }
  if (commands.length) {
    const shown = commands.slice(0, 5);
    const more = commands.length > shown.length ? ` 等 ${commands.length} 条` : '';
    push(
      projectId,
      `执行命令：${shown.map((c) => `\`${c.value}\``).join('、')}${more}`,
      shown.map((c) => sourceId('session-action', `${s.sessionId}#${c.index}:${c.kind}:${c.value}`)),
      'confirmed',
      null,
      1,
    );
  }
}

/** 展示文件名而不是整条绝对路径，完整路径留在脚注里。 */
function baseName(p) {
  const parts = String(p).split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

/**
 * 引用完整性校验（强制环节）。
 * 每个 source_id 必须真实存在于 evidence 表，否则该条强制降级为 unverified。
 * 没有这一层，模型编造 source_id 会静默通过，整个可追溯承诺失效。
 * @returns {{facts:any[], downgraded:number, missing:string[]}}
 */
export function validateReferences(db, facts, localDate) {
  const missing = [];
  let downgraded = 0;
  for (const f of facts) {
    const bad = [];
    for (const sid of f.source_ids) {
      const parsed = parseSourceId(sid);
      if (!parsed || !evidenceExists(db, parsed.sourceType, parsed.sourceRef, localDate)) bad.push(sid);
    }
    if (bad.length) {
      f.confidence = 'unverified';
      f.missing_source_ids = bad;
      missing.push(...bad);
      downgraded += 1;
    }
  }
  return { facts, downgraded, missing };
}
