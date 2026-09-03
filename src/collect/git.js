/**
 * Git 采集（L0：只读元数据，默认不读 diff 正文）。
 * 一律用 execFile 数组参数调用系统 git，不经 shell，避免注入。
 * 从会话 cwd 反查仓库的思路借鉴 temosy/devlog（MIT）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const US = '\x1f'; // 字段分隔
const RS = '\x1e'; // 记录分隔

/** 遍历时跳过的目录：体积黑洞与无意义目录。 */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build', 'out',
  'target', '.next', '.nuxt', '.cache', 'vendor', 'Pods', '.gradle', '.idea',
  'DerivedData', '.terraform', 'coverage', '.pnpm-store', '.turbo',
]);

export function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function git(repo, args) {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitSafe(repo, args, fallback = '') {
  try {
    return git(repo, args);
  } catch {
    return fallback;
  }
}

/**
 * 在给定根目录下查找 git 仓库。
 * @param {string[]} roots
 * @param {number} maxDepth
 * @returns {string[]} 仓库根路径
 */
export function findRepos(roots, maxDepth = 4) {
  const found = new Set();
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === '.git')) {
      found.add(dir);
      return; // 不进入子仓库，避免重复统计
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  for (const r of roots) walk(path.resolve(r), 0);
  return [...found].sort();
}

/** 找出包含某路径的仓库根（用于按会话 cwd 反查）。 */
export function repoOf(somePath) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: somePath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * 采集一个仓库在区间内的 commit 与工作树状态。
 * @param {string} repo
 * @param {{startUtc:string,endUtc:string}} range
 * @param {{authorFilter?:string|null}} [opts]
 */
export function collectRepo(repo, range, opts = {}) {
  const branch = gitSafe(repo, ['rev-parse', '--abbrev-ref', 'HEAD'], '').trim() || null;
  const args = [
    'log',
    `--since=${range.startUtc}`,
    `--until=${range.endUtc}`,
    '--numstat',
    '--no-color',
    `--pretty=format:${RS}%H${US}%an${US}%ae${US}%aI${US}%s`,
  ];
  if (opts.authorFilter) args.push(`--author=${opts.authorFilter}`);
  const raw = gitSafe(repo, args, '');
  const commits = parseLog(raw);
  const dirty = parseStatus(gitSafe(repo, ['status', '--porcelain=v1', '--no-color'], ''));
  return { repo, branch, commits, dirty };
}

/** 解析 `git log --numstat` 的输出。 */
export function parseLog(raw) {
  const out = [];
  for (const record of raw.split(RS)) {
    if (!record.trim()) continue;
    const lines = record.split('\n');
    const [hash, author, email, committedAt, ...rest] = lines[0].split(US);
    if (!hash) continue;
    const message = rest.join(US);
    let additions = 0;
    let deletions = 0;
    const files = [];
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const [a, d, file] = line.split('\t');
      if (file === undefined) continue;
      additions += Number.parseInt(a, 10) || 0;
      deletions += Number.parseInt(d, 10) || 0;
      files.push(file);
    }
    out.push({ hash, author, email, committedAt, message, additions, deletions, files });
  }
  return out;
}

/** 解析 `git status --porcelain=v1`。只取状态与路径，不读内容。 */
export function parseStatus(raw) {
  const out = [];
  for (const line of raw.split('\n')) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2).trim();
    let file = line.slice(3);
    if (status === 'R' || status.startsWith('R')) {
      const parts = file.split(' -> ');
      file = parts[parts.length - 1];
    }
    out.push({ status, path: file.replace(/^"|"$/g, '') });
  }
  return out;
}

