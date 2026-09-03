import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as cc from '../src/collect/providers/claude-code.js';
import * as codex from '../src/collect/providers/codex.js';
import { dayRange } from '../src/time.js';

const RANGE = dayRange('2026-09-03', 4);
const TS = '2026-09-03T10:00:00.000Z'; // 落在窗口内
const OLD = '2026-08-01T10:00:00.000Z'; // 窗口外

function tmpdir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `daytrace-${name}-`));
  return dir;
}

function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
}

test('claude-code: extractPrompt 只取 text 块，丢弃工具结果', () => {
  assert.equal(cc.extractPrompt({ content: '  纯字符串  ' }), '纯字符串');
  assert.equal(
    cc.extractPrompt({ content: [{ type: 'text', text: '要点' }, { type: 'tool_result', content: '一大堆输出' }] }),
    '要点',
  );
  assert.equal(cc.extractPrompt({ content: [{ type: 'tool_result', content: 'x' }] }), null);
});

test('claude-code: harness 注入的内容不算用户输入', () => {
  assert.equal(cc.cleanPrompt('<command-name>foo</command-name>'), null);
  assert.equal(cc.cleanPrompt('<system-reminder>提醒</system-reminder>'), null);
  assert.equal(cc.cleanPrompt('Caveat: 一些说明'), null);
  assert.equal(cc.cleanPrompt('   '), null);
  assert.equal(cc.cleanPrompt('真实输入'), '真实输入');
});

test('claude-code: 只从写类工具取文件，Read/Grep 忽略', () => {
  const actions = cc.extractActions({
    content: [
      { type: 'tool_use', name: 'Edit', input: { file_path: '/a/b.ts' } },
      { type: 'tool_use', name: 'Read', input: { file_path: '/a/ignored.ts' } },
      { type: 'tool_use', name: 'Grep', input: { pattern: 'x' } },
      { type: 'tool_use', name: 'Bash', input: { description: '跑测试' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'x'.repeat(200) } },
    ],
  });
  assert.deepEqual(actions[0], { kind: 'file', value: '/a/b.ts' });
  assert.deepEqual(actions[1], { kind: 'command', value: '跑测试' });
  assert.equal(actions[2].value.length, 80);
  assert.equal(actions.length, 3);
});

test('claude-code: 跳过 isSidechain、应用 ai-title、按窗口过滤、同文件只记一次', () => {
  const dir = tmpdir('cc');
  writeJsonl(path.join(dir, '-Users-me-proj', 's1.jsonl'), [
    { type: 'user', sessionId: 's1', timestamp: TS, cwd: '/Users/me/proj', gitBranch: 'main', message: { content: '主链输入' } },
    // 子 agent 转录：工作已在主链出现，必须跳过
    { type: 'user', sessionId: 's1', timestamp: TS, isSidechain: true, message: { content: '子 agent 输入' } },
    // 窗口外
    { type: 'user', sessionId: 's1', timestamp: OLD, message: { content: '上个月的输入' } },
    { type: 'assistant', sessionId: 's1', timestamp: TS, message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts' } }] } },
    { type: 'assistant', sessionId: 's1', timestamp: TS, message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/a.ts' } }] } },
    // ai-title 不受窗口限制
    { type: 'ai-title', sessionId: 's1', timestamp: OLD, aiTitle: '正式标题' },
    // 没有 sessionId 的行
    { type: 'user', timestamp: TS, message: { content: '没有 sessionId' } },
  ]);
  const sessions = cc.collect([dir], RANGE, 4);
  assert.equal(sessions.length, 1);
  const s = sessions[0];
  assert.equal(s.title, '正式标题');
  assert.equal(s.cwd, '/Users/me/proj');
  assert.equal(s.gitBranch, 'main');
  assert.deepEqual(s.prompts.map((p) => p.text), ['主链输入']);
  assert.equal(s.actions.length, 1, '同一文件被 Edit 又 Write 只记一次');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('claude-code: subagents / workflows 目录不算用户会话', () => {
  const dir = tmpdir('cc2');
  const rec = [{ type: 'user', sessionId: 'x', timestamp: TS, message: { content: '子 agent 的活' } }];
  writeJsonl(path.join(dir, '-proj', 'subagents', 'a.jsonl'), rec);
  writeJsonl(path.join(dir, '-proj', 'workflows', 'b.jsonl'), rec);
  assert.equal(cc.collect([dir], RANGE, 4).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('claude-code: 坏行跳过但不中断整个文件', () => {
  const dir = tmpdir('cc3');
  const file = path.join(dir, '-proj', 's.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `{坏 JSON\n${JSON.stringify({ type: 'user', sessionId: 's', timestamp: TS, message: { content: '好行' } })}\n`,
    'utf8',
  );
  const sessions = cc.collect([dir], RANGE, 4);
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].prompts.map((p) => p.text), ['好行']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('codex: 只取 role=user 的 message，developer 忽略', () => {
  assert.equal(codex.extractPrompt({ role: 'user', content: [{ type: 'input_text', text: '用户输入' }] }), '用户输入');
  assert.equal(codex.extractPrompt({ role: 'developer', content: [{ type: 'input_text', text: '系统指令' }] }), null);
  assert.equal(codex.extractPrompt({ role: 'user', content: [{ type: 'image', url: 'x' }] }), null);
});

test('codex: exec_command 取 cmd，apply_patch 取文件路径', () => {
  const exec = codex.extractActions({ name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test', login: true }) });
  assert.deepEqual(exec, [{ kind: 'command', value: 'npm test' }]);
  // arguments 不是合法 JSON 时不应抛错
  assert.deepEqual(codex.extractActions({ name: 'exec_command', arguments: '{坏' }), []);
  const patch = ['*** Begin Patch', '*** Update File: src/a.ts', '*** Add File: src/b.ts', '*** End Patch'].join('\n');
  assert.deepEqual(codex.extractActions({ name: 'apply_patch', input: patch }), [
    { kind: 'file', value: 'src/a.ts' },
    { kind: 'file', value: 'src/b.ts' },
  ]);
  assert.deepEqual(codex.extractActions({ name: 'write_stdin', arguments: '{}' }), []);
});

test('codex: event_msg/user_message 不重复计数', () => {
  const session = { prompts: [], actions: [], msgIndex: 0, seen: new Set(), firstTs: null, lastTs: null, title: null, cwd: '.' };
  const userItem = { timestamp: TS, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '同一句话' }] } };
  const eventDup = { timestamp: TS, type: 'event_msg', payload: { type: 'user_message', message: '同一句话' } };
  codex.ingest(session, userItem, RANGE, 4);
  codex.ingest(session, eventDup, RANGE, 4);
  codex.ingest(session, { timestamp: TS, type: 'turn_context', payload: {} }, RANGE, 4);
  assert.equal(session.prompts.length, 1);
});

test('codex: session_meta 提供 cwd 与 cli_version', () => {
  const session = { prompts: [], actions: [], msgIndex: 0, seen: new Set(), firstTs: null, lastTs: null, title: null, cwd: '.' };
  codex.ingest(
    session,
    { timestamp: TS, type: 'session_meta', payload: { id: 'thread-1', cwd: '/Users/me/proj', cli_version: '1.2.3', git: { branch: 'dev' } } },
    RANGE,
    4,
  );
  assert.equal(session.cwd, '/Users/me/proj');
  assert.equal(session.threadId, 'thread-1');
  assert.equal(session.schemaVersion, '1.2.3');
  assert.equal(session.gitBranch, 'dev');
});

test('codex: threadIdFromName 解析 rollout 文件名', () => {
  assert.equal(
    codex.threadIdFromName('/x/rollout-2026-06-26T19-00-20-019f0396-76f2-7e30-98ef-35bf5f3aa9cc.jsonl'),
    '019f0396-76f2-7e30-98ef-35bf5f3aa9cc',
  );
  assert.equal(codex.threadIdFromName('/x/other.jsonl'), null);
});

test('codex: 注入的环境上下文不算用户输入', () => {
  // Codex 会把这些以 role=user 注入首条消息，实机上核实过
  assert.equal(codex.cleanPrompt('<environment_context>\n  <cwd>/Users/me</cwd>\n</environment_context>'), null);
  assert.equal(codex.cleanPrompt('<user_instructions>照这个做</user_instructions>'), null);
  assert.equal(codex.cleanPrompt('# Files mentioned by the user\n## 某个文件'), null);
  assert.equal(codex.cleanPrompt('# AGENTS.md 内容'), null);
  assert.equal(codex.cleanPrompt('2026 年世界杯战绩如何？'), '2026 年世界杯战绩如何？');
  assert.equal(codex.cleanPrompt('   '), null);
});

test('displayName：太短或纯数字的目录名带上父目录', async () => {
  const { displayName, projectIdOf } = await import('../src/attribute.js');
  assert.equal(displayName('/Users/me/code/novel_ide'), 'novel_ide');
  assert.equal(displayName('/Users/me/2026-06-29/20'), '2026-06-29/20');
  assert.equal(displayName('/Users/me/code/a'), 'code/a');
  assert.equal(displayName(`/Users/me/${'x'.repeat(60)}`).length, 41);
  assert.equal(projectIdOf('/Users/me/code/Novel_IDE'), 'novel_ide');
});



