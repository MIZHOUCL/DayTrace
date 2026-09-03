/**
 * Claude Code 会话适配器。
 * 读 ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl，每行一条记录。
 *
 * 解析与过滤规则整套借鉴 temosy/devlog 的 src/transcript.rs（MIT），
 * 逐条说明见规划文档 PRIOR_ART.md §3.1，归属见 THIRD_PARTY_NOTICES.md。
 */
import fs from 'node:fs';
import path from 'node:path';
import { inRange, localDateOf } from '../../time.js';

export const id = 'claude-code';
export const MAX_PROMPTS_PER_SESSION = 50;
export const MAX_ACTIONS_PER_SESSION = 200;

/** 这些子目录是 workflow / 子 agent 的转录，不是用户会话。 */
const NOT_USER_SESSIONS = ['/subagents/', '/workflows/', '\\subagents\\', '\\workflows\\'];

/** 只从这些工具调用里取「改了什么」。 */
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** harness 注入的内容，不算用户输入。 */
const NOISE_PREFIX = ['<command-name>', '<command-message>', '<local-command', '<system-reminder>', 'Caveat:', '<user-prompt-submit-hook>'];

export function detect(dirs) {
  return dirs.some((d) => fs.existsSync(d));
}

export function cleanPrompt(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (!t) return null;
  if (NOISE_PREFIX.some((p) => t.startsWith(p))) return null;
  const collapsed = t.replace(/\s+/g, ' ');
  return collapsed.length > 400 ? `${collapsed.slice(0, 400)}…` : collapsed;
}

/** message.content 允许是字符串，或数组（只取 type:'text' 块）。 */
export function extractPrompt(message) {
  if (!message) return null;
  const c = message.content;
  if (typeof c === 'string') return cleanPrompt(c);
  if (!Array.isArray(c)) return null;
  const texts = c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  return texts.length ? cleanPrompt(texts.join('\n')) : null;
}

/** 只看 tool_use 块；Read/Grep 这类只读工具忽略。 */
export function extractActions(message) {
  const out = [];
  const c = message?.content;
  if (!Array.isArray(c)) return out;
  for (const b of c) {
    if (!b || b.type !== 'tool_use') continue;
    if (FILE_TOOLS.has(b.name)) {
      const fp = b.input?.file_path;
      if (typeof fp === 'string' && fp) out.push({ kind: 'file', value: fp });
    } else if (b.name === 'Bash') {
      const desc = b.input?.description || b.input?.command;
      if (typeof desc === 'string' && desc) out.push({ kind: 'command', value: desc.slice(0, 80) });
    }
  }
  return out;
}

function listFiles(dirs) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl') && !NOT_USER_SESSIONS.some((s) => p.includes(s))) files.push(p);
    }
  };
  for (const d of dirs) walk(d);
  return files;
}

/**
 * @param {string[]} dirs
 * @param {{startUtc:string,endUtc:string}} range
 * @param {number} cutoffHour
 * @returns {import('../sessions.js').SessionActivity[]}
 */
export function collect(dirs, range, cutoffHour) {
  const start = Date.parse(range.startUtc);
  /** @type {Map<string, any>} */
  const acc = new Map();

  for (const file of listFiles(dirs)) {
    // 文件 mtime 早于窗口起点 => 不可能含范围内记录，整文件跳过。
    try {
      if (fs.statSync(file).mtimeMs < start) continue;
    } catch {
      continue;
    }
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue; // 坏行跳过，不中断整次扫描
      }
      const sid = rec.sessionId;
      if (!sid) continue;

      // ai-title 单独处理：取标题，且故意不受时间窗口限制。
      if (rec.type === 'ai-title') {
        const s = acc.get(sid);
        if (s && typeof rec.aiTitle === 'string' && rec.aiTitle.trim()) s.title = rec.aiTitle.trim();
        continue;
      }
      if (rec.type !== 'user' && rec.type !== 'assistant') continue;
      if (rec.isSidechain === true) continue; // 子 agent 转录，工作已在主链出现
      if (!rec.timestamp || !inRange(rec.timestamp, range.startUtc, range.endUtc)) continue;

      let s = acc.get(sid);
      if (!s) {
        s = {
          providerId: id,
          sessionId: sid,
          threadId: sid,
          title: null,
          cwd: typeof rec.cwd === 'string' && rec.cwd ? rec.cwd : '.',
          gitBranch: typeof rec.gitBranch === 'string' ? rec.gitBranch : null,
          firstTs: rec.timestamp,
          lastTs: rec.timestamp,
          prompts: [],
          actions: [],
          schemaVersion: rec.version ? String(rec.version) : null,
          file,
          msgIndex: 0,
          seen: new Set(),
        };
        acc.set(sid, s);
      }
      s.msgIndex += 1;
      if (rec.timestamp < s.firstTs) s.firstTs = rec.timestamp;
      if (rec.timestamp > s.lastTs) s.lastTs = rec.timestamp;

      if (rec.type === 'user') {
        const text = extractPrompt(rec.message);
        if (text && s.prompts.length < MAX_PROMPTS_PER_SESSION) {
          s.prompts.push({ index: s.msgIndex, text, ts: rec.timestamp, localDate: localDateOf(rec.timestamp, cutoffHour) });
        }
      } else {
        for (const a of extractActions(rec.message)) {
          if (s.actions.length >= MAX_ACTIONS_PER_SESSION) break;
          const key = `${a.kind}:${a.value}`;
          if (s.seen.has(key)) continue; // 同一文件被反复编辑只记一次
          s.seen.add(key);
          s.actions.push({ ...a, index: s.msgIndex, ts: rec.timestamp });
        }
      }
    }
  }

  return [...acc.values()]
    .filter((s) => s.prompts.length > 0 || s.actions.length > 0)
    .sort((a, b) => a.firstTs.localeCompare(b.firstTs));
}

