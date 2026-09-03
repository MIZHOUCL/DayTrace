/**
 * 项目归因（PROJECT_PLAN §6）。
 * 优先级：会话 cwd / gitBranch → git 仓库根 → 用户 glob 规则（用户规则最终优先）。
 */
import path from 'node:path';

/** 由路径生成稳定的项目 id。 */
export function projectIdOf(rootPath) {
  return slug(displayName(rootPath));
}

/**
 * 项目显示名。basename 太短或纯数字时带上父目录，避免出现名叫「20」的项目。
 * 过长的目录名（例如以 URL 命名的目录）截断。
 */
export function displayName(rootPath) {
  const resolved = path.resolve(rootPath);
  const base = path.basename(resolved) || 'unknown';
  const parent = path.basename(path.dirname(resolved));
  const needsParent = base.length <= 2 || /^\d+$/.test(base);
  const name = needsParent && parent ? `${parent}/${base}` : base;
  return name.length > 40 ? `${name.slice(0, 40)}…` : name;
}

function slug(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9一-龥._/-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  );
}

/**
 * 建立项目表：仓库根 + 会话 cwd。
 * @param {string[]} repos
 * @param {import('./collect/sessions.js').SessionActivity[]} sessions
 * @param {{rules?:{match:string,project:string}[]}} [opts] 用户规则，match 为路径子串
 */
export function buildProjects(repos, sessions, opts = {}) {
  /** @type {Map<string,{id:string,name:string,rootPath:string}>} */
  const byRoot = new Map();
  const add = (rootPath) => {
    const resolved = path.resolve(rootPath);
    if (byRoot.has(resolved)) return byRoot.get(resolved);
    const entry = { id: projectIdOf(resolved), name: displayName(resolved), rootPath: resolved };
    byRoot.set(resolved, entry);
    return entry;
  };
  for (const r of repos) add(r);
  // 会话 cwd 若不在已知仓库内，自己也算一个项目
  for (const s of sessions) {
    if (!s.cwd || s.cwd === '.') continue;
    const owner = repoContaining(s.cwd, [...byRoot.keys()]);
    if (!owner) add(s.cwd);
  }
  const projects = [...byRoot.values()];
  // 用户规则最后应用，覆盖自动结果
  for (const rule of opts.rules ?? []) {
    for (const p of projects) {
      if (p.rootPath.includes(rule.match)) {
        p.name = rule.project;
        p.id = projectIdOf(rule.project);
        p.userRenamed = true;
      }
    }
  }
  return projects;
}

/** 找出包含 somePath 的最长仓库根。 */
export function repoContaining(somePath, roots) {
  const target = path.resolve(somePath);
  let best = null;
  for (const r of roots) {
    const root = path.resolve(r);
    if (target === root || target.startsWith(`${root}${path.sep}`)) {
      if (!best || root.length > best.length) best = root;
    }
  }
  return best;
}

/** 把一条会话归到项目 id。 */
export function attributeSession(session, projects) {
  const roots = projects.map((p) => p.rootPath);
  const owner = repoContaining(session.cwd ?? '.', roots);
  if (owner) return projects.find((p) => path.resolve(p.rootPath) === owner)?.id ?? null;
  return null;
}
