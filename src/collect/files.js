/**
 * 文件系统扫描（L0：只记路径、时间、大小，绝不读正文）。
 *
 * 为什么加回来：ADR-001 原本砍掉了这一层，理由是「git 已经覆盖文件变更」。
 * 实际使用证明这个判断是错的 —— 大量工作发生在没进 git 的目录里，
 * 只看 git + AI 会话会漏掉用户当天的大部分动作。详见 ADR-019。
 *
 * 与 git 的分工：**落在 git 仓库内的文件一律跳过**，交给 git 采集器处理，
 * 避免同一份改动被记两遍。仓库外的文件才由这里负责。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SKIP_DIRS } from './git.js';

/** 目录黑洞：体积大、变动频繁、对日志没有意义。 */
export const EXTRA_SKIP_DIRS = new Set([
  'Library', 'AppData', 'Applications', 'System', 'Windows', 'Program Files',
  'Program Files (x86)', 'ProgramData', '$RECYCLE.BIN', 'System Volume Information',
  'Trash', '.Trash', 'Downloads.localized', 'Music', 'Movies', 'Pictures', 'Photos',
  'site-packages', 'Cellar', 'pkg', 'obj', 'tmp', 'temp', 'logs',
]);

/**
 * 疑似敏感文件：默认连路径都不记。
 * 故意用精确一点的规则而不是 `secret*` / `token*` 这类前缀通配 ——
 * 后者会把 tokenizer.ts、secrets.example.json 这种正常文件一起误伤。
 */
const SENSITIVE_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx|keystore|jks|asc|gpg)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^credentials?\.(json|ya?ml|ini|toml)$/i,
  /^\.?(npmrc|netrc|pgpass|htpasswd)$/i,
  /^(service-account|gcp-key|aws-credentials).*\.json$/i,
  /\.kdbx$/i,
];

export function isSensitiveName(name) {
  return SENSITIVE_PATTERNS.some((re) => re.test(name));
}

/** 是否落在任意一个 git 仓库内。 */
export function insideRepo(filePath, repos) {
  const target = path.resolve(filePath);
  return repos.some((r) => {
    const root = path.resolve(r);
    return target === root || target.startsWith(`${root}${path.sep}`);
  });
}

/**
 * 扫描 roots 下在时间窗口内被改动过的文件。
 * @param {string[]} roots
 * @param {{startUtc:string,endUtc:string}} range
 * @param {{repos?:string[], maxDepth?:number, maxFiles?:number, extraExcludes?:string[]}} [opts]
 */
export function scanFiles(roots, range, opts = {}) {
  const { repos = [], maxDepth = 6, maxFiles = 5000, extraExcludes = [] } = opts;
  const start = Date.parse(range.startUtc);
  const end = Date.parse(range.endUtc);
  const extra = new Set(extraExcludes);
  const hits = [];
  const stats = { scanned: 0, dirs: 0, skippedInRepo: 0, skippedSensitive: 0, truncated: false };

  const skipDir = (name) => SKIP_DIRS.has(name) || EXTRA_SKIP_DIRS.has(name) || extra.has(name) || name.startsWith('.');

  const walk = (dir, depth) => {
    if (stats.truncated || depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 没权限或已删除，跳过而不是中断
    }
    stats.dirs += 1;
    for (const e of entries) {
      if (stats.truncated) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skipDir(e.name)) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!e.isFile() || e.name.startsWith('.')) continue;
      stats.scanned += 1;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      const m = st.mtimeMs;
      if (m < start || m >= end) continue; // 半开区间，与 time.js 一致
      if (insideRepo(full, repos)) {
        stats.skippedInRepo += 1;
        continue;
      }
      if (isSensitiveName(e.name)) {
        stats.skippedSensitive += 1;
        continue;
      }
      hits.push({ path: full, mtime: new Date(m).toISOString(), size: st.size });
      if (hits.length >= maxFiles) stats.truncated = true;
    }
  };

  for (const r of roots) walk(path.resolve(r), 0);
  hits.sort((a, b) => a.mtime.localeCompare(b.mtime));
  return { hits, stats };
}

/**
 * 给一个文件找它该归到哪个「项目」：root 下的第一层目录。
 * 例如 root=D:\code、file=D:\code\foo\src\a.ts => D:\code\foo
 */
export function projectDirOf(filePath, roots) {
  const target = path.resolve(filePath);
  let best = null;
  for (const r of roots) {
    const root = path.resolve(r);
    if (target === root || target.startsWith(`${root}${path.sep}`)) {
      if (!best || root.length > best.length) best = root;
    }
  }
  if (!best) return path.dirname(target);
  const rel = path.relative(best, target);
  const first = rel.split(path.sep)[0];
  // 文件直接躺在 root 里，就把 root 本身当项目
  return rel.includes(path.sep) ? path.join(best, first) : best;
}
