/**
 * 会话适配器注册与调度（PROJECT_PLAN §6 的 AgentSessionProvider 契约）。
 *
 * 约束：
 * - 只读白名单目录；
 * - schema 未知时降级为 link_only，绝不猜测内容；
 * - 任一适配器失败不影响其他来源。
 *
 * @typedef {Object} SessionActivity
 * @property {string} providerId
 * @property {string} sessionId
 * @property {string|null} threadId
 * @property {string|null} title
 * @property {string} cwd
 * @property {string|null} gitBranch
 * @property {string|null} firstTs
 * @property {string|null} lastTs
 * @property {{index:number,text:string,ts:string,localDate:string}[]} prompts
 * @property {{index:number,kind:string,value:string,ts:string}[]} actions
 * @property {string|null} schemaVersion
 * @property {string} file
 */
import * as claudeCode from './providers/claude-code.js';
import * as codex from './providers/codex.js';

export const PROVIDERS = [claudeCode, codex];

/**
 * 跑所有可用的适配器。
 * @param {Record<string,string[]>} sessionDirs provider id -> 目录列表
 * @param {{startUtc:string,endUtc:string}} range
 * @param {number} cutoffHour
 * @returns {{sessions:SessionActivity[], report:{id:string,status:string,count:number,error?:string}[]}}
 */
export function collectSessions(sessionDirs, range, cutoffHour) {
  const sessions = [];
  const report = [];
  for (const p of PROVIDERS) {
    const dirs = sessionDirs?.[p.id] ?? [];
    if (!dirs.length || !p.detect(dirs)) {
      report.push({ id: p.id, status: 'absent', count: 0 });
      continue;
    }
    try {
      const found = p.collect(dirs, range, cutoffHour);
      sessions.push(...found);
      report.push({ id: p.id, status: 'ok', count: found.length });
    } catch (err) {
      // 单个适配器失败降级，不影响其他来源
      report.push({ id: p.id, status: 'link_only', count: 0, error: err.message });
    }
  }
  return { sessions, report };
}
