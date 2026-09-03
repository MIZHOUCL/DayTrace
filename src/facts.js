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

/** 会话 → 证据行。用户输入是 L1，不含助手回复。 */
export function evidenceFromSession(session, projectId, cutoffHour) {
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
  const push = (projectId, text, ids, confidence, occurredAt) => {
    facts.push({
      id: `fact:${projectId}:${facts.length}`,
      project_id: projectId,
      text,
      source_ids: ids,
      confidence,
      occurred_at: occurredAt ?? null,
      local_date: localDate,
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
      const first = s.prompts[0];
      const label = shortLabel(s.title || first?.text || '（无标题会话）');
      const ids = [];
      if (first) ids.push(sourceId('session', `${s.sessionId}#${first.index}`));
      const files = [...new Set(s.actions.filter((a) => a.kind === 'file').map((a) => a.value))];
      for (const a of s.actions.filter((x) => x.kind === 'file').slice(0, 20)) {
        ids.push(sourceId('session-action', `${s.sessionId}#${a.index}:${a.kind}:${a.value}`));
      }
      const suffix = files.length ? `，改动 ${files.length} 个文件` : '';
      const providerLabel = s.providerId === 'codex' ? 'Codex' : 'Claude Code';
      push(project.id, `${providerLabel} 会话：${label}${suffix}`, ids, ids.length ? 'confirmed' : 'unverified', s.firstTs);
    }
  }

  return facts;
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
