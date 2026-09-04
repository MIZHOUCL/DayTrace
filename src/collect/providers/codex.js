/**
 * Codex CLI 会话适配器。
 * 读 ~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<thread_id>.jsonl 与 ~/.codex/archived_sessions/。
 *
 * 每行是 {timestamp, type, payload}；首行 type=session_meta，payload 带 id / cwd / git / cli_version。
 * 结构在实机上核实过（2026-09-03）：response_item.payload.type ∈
 * {message, reasoning, function_call, function_call_output, custom_tool_call, custom_tool_call_output}。
 * 用户输入同时出现在 response_item/message(role=user) 与 event_msg/user_message，只取前者以免重复计数。
 */
import fs from 'node:fs';
import path from 'node:path';
import { inRange, localDateOf } from '../../time.js';

export const id = 'codex';
export const MAX_PROMPTS_PER_SESSION = 50;
export const MAX_ACTIONS_PER_SESSION = 200;

export function detect(dirs) {
  return dirs.some((d) => fs.existsSync(d));
}

/**
 * Codex 会把环境上下文、用户指令等以 role=user 的形式注入首条消息，
 * 这些不是用户真正打的字，必须剔除，否则会话标题会变成 <environment_context>。
 */
const NOISE_PREFIX = [
  '<environment_context>',
  '<user_instructions>',
  '<system_context>',
  '<EXPERIMENTAL',
  '<vscode_context>',
  '<ide_context>',
  '# AGENTS.md',
  '# Files mentioned by the user',
  '## My request for Codex',
];

export function cleanPrompt(text) {
  if (typeof text !== 'string') return null;
  const raw = text.trim();
  if (!raw) return null;
  if (NOISE_PREFIX.some((p) => raw.startsWith(p))) return null;
  // 整条内容就是一个 XML 块 => 注入内容
  if (/^<[a-z_]+>[\s\S]*<\/[a-z_]+>$/i.test(raw)) return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > 400 ? `${t.slice(0, 400)}…` : t;
}

/** message.content 是块数组，文本块的 type 形如 input_text / output_text。 */
export function extractPrompt(payload) {
  if (!payload || payload.role !== 'user') return null;
  const c = payload.content;
  if (typeof c === 'string') return cleanPrompt(c);
  if (!Array.isArray(c)) return null;
  const texts = c.filter((b) => b && typeof b.text === 'string' && String(b.type || '').endsWith('text')).map((b) => b.text);
  return texts.length ? cleanPrompt(texts.join('\n')) : null;
}

/** 从 apply_patch 的补丁文本里取出被改的文件路径。 */
export function filesFromPatch(patch) {
  if (typeof patch !== 'string') return [];
  const out = [];
  const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
  let m;
  while ((m = re.exec(patch)) !== null) out.push(m[1].trim());
  return out;
}

/** function_call / custom_tool_call → 行为列表。 */
export function extractActions(payload) {
  const out = [];
  const name = payload?.name;
  if (!name) return out;
  const rawArgs = typeof payload.arguments === 'string' ? payload.arguments : null;
  const rawInput = typeof payload.input === 'string' ? payload.input : null;
  if (name === 'exec_command') {
    let cmd = null;
    if (rawArgs) {
      try {
        cmd = JSON.parse(rawArgs)?.cmd ?? null;
      } catch {
        cmd = null;
      }
    }
    if (typeof cmd === 'string' && cmd) out.push({ kind: 'command', value: cmd.slice(0, 80) });
  } else if (name === 'apply_patch') {
    const text = rawInput || rawArgs || '';
    for (const f of filesFromPatch(text)) out.push({ kind: 'file', value: f });
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
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) files.push(p);
    }
  };
  for (const d of dirs) walk(d);
  return files;
}

/** 从文件名取 thread_id：rollout-<ISO>-<uuid>.jsonl */
export function threadIdFromName(file) {
  const m = path.basename(file).match(/^rollout-\d{4}-\d{2}-\d{2}T[\d-]+-([0-9a-f-]{36})\.jsonl$/i);
  return m ? m[1] : null;
}

export function collect(dirs, range, cutoffHour) {
  const start = Date.parse(range.startUtc);
  const out = [];

  for (const file of listFiles(dirs)) {
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
    const session = newSession(file);
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      ingest(session, rec, range, cutoffHour);
    }
    if (session.prompts.length || session.actions.length) out.push(session);
  }

  return out.sort((a, b) => String(a.firstTs).localeCompare(String(b.firstTs)));
}

function newSession(file) {
  return {
    providerId: id,
    sessionId: threadIdFromName(file) || path.basename(file, '.jsonl'),
    threadId: threadIdFromName(file),
    title: null,
    cwd: '.',
    gitBranch: null,
    firstTs: null,
    lastTs: null,
    prompts: [],
    actions: [],
    schemaVersion: null,
    file,
    msgIndex: 0,
    seen: new Set(),
  };
}

/** 把一行记录并入会话。导出以便单测。 */
export function ingest(session, rec, range, cutoffHour) {
  const payload = rec.payload || {};

  if (rec.type === 'session_meta') {
    if (typeof payload.cwd === 'string' && payload.cwd) session.cwd = payload.cwd;
    if (payload.id) session.threadId = String(payload.id);
    if (payload.cli_version) session.schemaVersion = String(payload.cli_version);
    const branch = payload.git && typeof payload.git === 'object' ? payload.git.branch : null;
    if (typeof branch === 'string') session.gitBranch = branch;
    return;
  }
  // event_msg（含 user_message）与 turn_context 一律跳过，避免与 response_item 重复计数
  if (rec.type !== 'response_item') return;
  if (!rec.timestamp || !inRange(rec.timestamp, range.startUtc, range.endUtc)) return;

  session.msgIndex += 1;
  if (!session.firstTs || rec.timestamp < session.firstTs) session.firstTs = rec.timestamp;
  if (!session.lastTs || rec.timestamp > session.lastTs) session.lastTs = rec.timestamp;

  if (payload.type === 'message') {
    const text = extractPrompt(payload);
    if (text && session.prompts.length < MAX_PROMPTS_PER_SESSION) {
      session.prompts.push({ index: session.msgIndex, text, ts: rec.timestamp, localDate: localDateOf(rec.timestamp, cutoffHour) });
      // 不给 Codex 会话伪造标题：它没有 ai-title 之类的正式标题字段，
      // 拿用户随便一句话当标题会让日志出现「那几行呢？」这种毫无信息量的条目。
    }
  } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
    for (const a of extractActions(payload)) {
      if (session.actions.length >= MAX_ACTIONS_PER_SESSION) break;
      const key = `${a.kind}:${a.value}`;
      if (session.seen.has(key)) continue; // 同一文件被反复 patch 只记一次
      session.seen.add(key);
      session.actions.push({ ...a, index: session.msgIndex, ts: rec.timestamp });
    }
  }
}

/** 会话没有正式标题时，用首条输入的前 40 字当标题。 */
export function shortTitle(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}
