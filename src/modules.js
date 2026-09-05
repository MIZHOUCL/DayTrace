/**
 * 把一天的证据聚成「模块」—— 用户在前端勾选/戳破的单位，也是喂给模型写日记的单位。
 *
 * 为什么需要这一层：一天的原始证据可能有一两百条（实测 175 条），
 * 直接列出来没有重点，直接喂给模型也是垃圾进垃圾出。
 * 模块 = 同一个项目里、时间上连续的一段工作，带标题、时间段、证据量和权重。
 */
import path from 'node:path';
import { sourceId } from './facts.js';
import { extensionOf } from './collect/files.js';

/** 同一项目内间隔超过这么久，算两段工作。 */
export const DEFAULT_GAP_MINUTES = 90;

const CODE_EXT = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'py', 'java', 'kt', 'go', 'rs', 'rb', 'php', 'cs', 'cpp', 'c', 'h', 'swift', 'scala', 'sh', 'ps1', 'lua', 'dart']);
const DOC_EXT = new Set(['md', 'markdown', 'txt', 'rst', 'adoc', 'docx', 'doc', 'pdf', 'pptx', 'ppt', 'rtf', 'odt', 'tex']);
const DATA_EXT = new Set(['sql', 'csv', 'tsv', 'xlsx', 'xls', 'ods', 'json', 'jsonl', 'yaml', 'yml', 'xml']);

/** 一段文字压成标题。中文没有空格，靠标点断句比分词靠得住。 */
export function toTitle(text, max = 32) {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s、，。：:,.\-—]+/, '')
    .trim();
  if (!t) return '';
  const cut = t.split(/[。！？\n?!]/)[0].trim() || t;
  return cut.length > max ? `${cut.slice(0, max)}…` : cut;
}

function categoryOf(items) {
  let code = 0;
  let doc = 0;
  let data = 0;
  for (const it of items) {
    if (it.kind === 'commit') code += 2;
    if (it.kind !== 'file' && it.kind !== 'action-file' && it.kind !== 'worktree') continue;
    const ext = extensionOf(path.basename(it.label || ''));
    if (CODE_EXT.has(ext)) code += 1;
    else if (DOC_EXT.has(ext)) doc += 1;
    else if (DATA_EXT.has(ext)) data += 1;
  }
  if (code === 0 && doc === 0 && data === 0) return '其他';
  if (code >= doc && code >= data) return '代码';
  if (doc >= data) return '文档';
  return '数据';
}

/**
 * 把一个项目里的所有证据摊平成带时间戳的条目，供后面按时间切块。
 * @returns {{ts:string, kind:string, label:string, sourceId:string}[]}
 */
export function timelineOf(project, input) {
  const items = [];
  for (const r of input.gitByProject.get(project.id) ?? []) {
    for (const c of r.commits) {
      items.push({ ts: c.committedAt, kind: 'commit', label: c.message, sourceId: sourceId('commit', c.hash), files: c.files.length });
    }
    for (const d of r.dirty) {
      // 有真实 mtime 就用它，拿不到（文件已删）才退回「现在」
      items.push({ ts: d.mtime ?? input.nowIso, kind: 'worktree', label: d.path, sourceId: sourceId('worktree', `${project.id}:${d.path}`) });
    }
  }
  for (const s of input.sessionsByProject.get(project.id) ?? []) {
    for (const p of s.prompts) {
      items.push({ ts: p.ts, kind: 'prompt', label: p.text, sourceId: sourceId('session', `${s.sessionId}#${p.index}`), sessionTitle: s.title, provider: s.providerId });
    }
    for (const a of s.actions) {
      items.push({
        ts: a.ts,
        kind: a.kind === 'file' ? 'action-file' : 'action-command',
        label: a.value,
        sourceId: sourceId('session-action', `${s.sessionId}#${a.index}:${a.kind}:${a.value}`),
      });
    }
  }
  for (const h of input.filesByProject.get(project.id) ?? []) {
    items.push({ ts: h.mtime, kind: 'file', label: h.path, sourceId: sourceId('file', h.path) });
  }
  return items.filter((i) => i.ts).sort((a, b) => a.ts.localeCompare(b.ts));
}

/** 按时间空隙切块。 */
export function splitByGap(items, gapMinutes = DEFAULT_GAP_MINUTES) {
  const blocks = [];
  const gapMs = gapMinutes * 60_000;
  for (const it of items) {
    const last = blocks[blocks.length - 1];
    if (last && Date.parse(it.ts) - Date.parse(last[last.length - 1].ts) <= gapMs) last.push(it);
    else blocks.push([it]);
  }
  return blocks;
}

function statsOf(items) {
  const s = { commits: 0, prompts: 0, files: 0, commands: 0 };
  const files = new Set();
  for (const it of items) {
    if (it.kind === 'commit') s.commits += 1;
    else if (it.kind === 'prompt') s.prompts += 1;
    else if (it.kind === 'action-command') s.commands += 1;
    else if (it.kind === 'file' || it.kind === 'action-file' || it.kind === 'worktree') files.add(path.basename(it.label));
  }
  s.files = files.size;
  return s;
}

/** 起标题：commit message > 会话标题 > 首条提问 > 文件概述。 */
function titleOf(items, stats) {
  const commit = items.find((i) => i.kind === 'commit');
  if (commit) {
    const more = stats.commits > 1 ? `（等 ${stats.commits} 个提交）` : '';
    return `${toTitle(commit.label)}${more}`;
  }
  const withTitle = items.find((i) => i.kind === 'prompt' && i.sessionTitle);
  if (withTitle) return toTitle(withTitle.sessionTitle);
  const prompt = items.find((i) => i.kind === 'prompt');
  if (prompt) return toTitle(prompt.label);
  const fileItems = items.filter((i) => i.kind === 'file' || i.kind === 'action-file' || i.kind === 'worktree');
  if (fileItems.length) return fileSummary(fileItems, stats);
  return '零散活动';
}

/** 纯文件改动的标题：按最常见的目录和扩展名概述，比「改动 N 个文件（./）」有信息量。 */
function fileSummary(fileItems, stats) {
  const dirs = new Map();
  const exts = new Map();
  for (const it of fileItems) {
    const dir = path.basename(path.dirname(it.label));
    if (dir && dir !== '.') dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
    const ext = extensionOf(path.basename(it.label));
    if (ext) exts.set(ext, (exts.get(ext) ?? 0) + 1);
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  const dirPart = top(dirs, 2).map((d) => `${d}/`).join('、');
  const extPart = top(exts, 3).map((e) => `.${e}`).join('、');
  if (dirPart) return `改动 ${stats.files} 个文件：${dirPart}${extPart ? `（${extPart}）` : ''}`;
  if (extPart) return `改动 ${stats.files} 个文件（${extPart}）`;
  return `改动 ${stats.files} 个文件`;
}

/**
 * 权重：有 commit 最实，其次有提问，纯文件改动最虚。
 *
 * 文件数用平方根而不是线性 —— 一个目录里 60 个文件被碰过，说明的事情
 * 并不比 6 个多十倍（多半是某个程序在写状态）。实测那份 175 条的输出里，
 * QQ 的 62 个 .db-shm 如果按线性计权会直接压过当天真正的周报工作。
 */
export function scoreOf(stats, durationMin) {
  const base = stats.commits * 6 + stats.prompts * 3 + stats.commands * 1.5 + 3 * Math.sqrt(stats.files);
  const durationBoost = Math.min(1 + durationMin / 120, 2); // 持续越久权重越高，最多翻倍
  return Math.round(base * durationBoost * 10) / 10;
}

/** 低信号：没有提问也没有 commit，只有零星几个文件 —— 这种不该占日记的篇幅。 */
function isLowSignal(stats) {
  return stats.commits === 0 && stats.prompts === 0 && stats.commands === 0 && stats.files <= 2;
}

/**
 * 聚成模块。
 * @param {{projects:any[], gitByProject:Map, sessionsByProject:Map, filesByProject:Map, nowIso:string}} input
 * @param {{gapMinutes?:number, localDate?:string}} [opts]
 */
export function buildModules(input, opts = {}) {
  const gap = opts.gapMinutes ?? DEFAULT_GAP_MINUTES;
  const modules = [];
  const leftovers = [];

  for (const project of input.projects) {
    const items = timelineOf(project, input);
    if (!items.length) continue;
    for (const block of splitByGap(items, gap)) {
      const stats = statsOf(block);
      const startTs = block[0].ts;
      const endTs = block[block.length - 1].ts;
      const durationMin = Math.max(0, Math.round((Date.parse(endTs) - Date.parse(startTs)) / 60_000));
      if (isLowSignal(stats)) {
        leftovers.push(...block);
        continue;
      }
      modules.push({
        id: `mod:${project.id}:${modules.length}`,
        title: titleOf(block, stats),
        category: categoryOf(block),
        projectId: project.id,
        projectName: project.name,
        startTs,
        endTs,
        durationMin,
        stats,
        sourceIds: [...new Set(block.map((i) => i.sourceId))],
        score: scoreOf(stats, durationMin),
        selected: true,
        why: `${project.name} 内一段连续 ${durationMin} 分钟的工作（间隔 > ${gap} 分钟即切块）`,
      });
    }
  }

  modules.sort((a, b) => b.score - a.score);

  if (leftovers.length) {
    const stats = statsOf(leftovers);
    modules.push({
      id: 'mod:misc',
      title: `零散文件改动 ${stats.files} 个`,
      category: '杂项',
      projectId: null,
      projectName: '杂项',
      startTs: leftovers[0].ts,
      endTs: leftovers[leftovers.length - 1].ts,
      durationMin: 0,
      stats,
      sourceIds: [...new Set(leftovers.map((i) => i.sourceId))],
      score: 0,
      // 默认不进日记：没有提问也没有提交的零星文件，写进日记只会稀释重点
      selected: false,
      why: '没有提问也没有提交、只有零星几个文件改动的项目，已合并到杂项并默认排除',
    });
  }

  return modules;
}
