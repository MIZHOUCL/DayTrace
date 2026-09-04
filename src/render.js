/**
 * Markdown 渲染：每条要点带 [^evN] 脚注，项目名写成 [[wiki-link]]（ADR-015）。
 * 输出里不含文件正文，也不含助手回复。
 */

/** 外链图片降级为纯文本，避免会话/diff 里的内容在渲染时外发数据（PROJECT_PLAN §8.5）。 */
export function defuseMarkdown(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[图片: $1 <$2>]')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ');
}

function footnoteLabel(ev) {
  if (!ev) return '（证据缺失）';
  const when = ev.occurred_at ? ev.occurred_at.replace('.000Z', 'Z') : '';
  switch (ev.source_type) {
    case 'commit':
      return `commit \`${ev.source_ref.slice(0, 7)}\` — ${defuseMarkdown(ev.excerpt || '')}${when ? `（${when}）` : ''}`;
    case 'worktree':
      return `工作树 \`${ev.excerpt || '?'}\` ${defuseMarkdown(ev.path_alias || ev.source_ref)}`;
    case 'session': {
      const [sid, idx] = ev.source_ref.split('#');
      return `会话 \`${sid}\` 第 ${idx} 条消息${when ? `（${when}）` : ''}：${defuseMarkdown((ev.excerpt || '').slice(0, 120))}`;
    }
    case 'session-action': {
      const [sid] = ev.source_ref.split('#');
      return `会话 \`${sid}\` 的操作 — ${defuseMarkdown(ev.excerpt || '')}`;
    }
    default:
      return `${ev.source_type} \`${ev.source_ref}\``;
  }
}

/**
 * @param {{localDate:string, projects:any[], facts:any[], evidenceIndex:Map<string,any>,
 *          report:any[], cutoffHour:number, repoCount:number}} input
 */
export function renderMarkdown(input) {
  const { localDate, projects, facts, evidenceIndex, report, cutoffHour, repoCount, fileScan } = input;
  const lines = [];
  lines.push(`# ${localDate}`, '');

  if (!facts.length) {
    lines.push('无可记录活动。', '');
    lines.push('已检查的来源：');
    lines.push(`- git 仓库 ${repoCount} 个`);
    if (fileScan) lines.push(`- 文件扫描：${fileScan.dirs} 个目录、${fileScan.scanned} 个文件，其中 ${fileScan.skippedInRepo} 个在 git 仓库内已交给 git 处理`);
    for (const r of report) {
      const label = r.status === 'ok' ? `${r.count} 个会话` : r.status === 'absent' ? '未安装或无数据' : `降级（${r.error ?? '解析失败'}）`;
      lines.push(`- ${r.id}：${label}`);
    }
    lines.push('', `> 日界为本地时间 ${String(cutoffHour).padStart(2, '0')}:00，跨零点的工作会归到前一天。`, '');
    return lines.join('\n');
  }

  /** source_id -> 脚注编号，按出现顺序分配 */
  const noteNo = new Map();
  const noteOrder = [];
  const refOf = (sid) => {
    if (!noteNo.has(sid)) {
      noteNo.set(sid, noteNo.size + 1);
      noteOrder.push(sid);
    }
    return noteNo.get(sid);
  };

  const byProject = new Map();
  for (const f of facts) {
    if (!byProject.has(f.project_id)) byProject.set(f.project_id, []);
    byProject.get(f.project_id).push(f);
  }

  for (const project of projects) {
    const list = byProject.get(project.id);
    if (!list?.length) continue;
    lines.push(`## [[${project.name}]]`, '');
    for (const f of list) {
      const refs = f.source_ids.slice(0, 6).map((sid) => `[^ev${refOf(sid)}]`).join('');
      const mark = f.confidence === 'confirmed' ? '' : ` \`${f.confidence}\``;
      const hint = f.confidence === 'unverified' ? '（无法关联来源，请确认或删除）' : '';
      const indent = '  '.repeat(f.depth ?? 0);
      lines.push(`${indent}- ${defuseMarkdown(f.text)}${refs}${mark}${hint}`);
    }
    lines.push('');
  }

  lines.push('---', '');
  for (const sid of noteOrder) {
    lines.push(`[^ev${noteNo.get(sid)}]: ${footnoteLabel(evidenceIndex.get(sid))}`);
  }
  lines.push('');

  const counts = facts.reduce((acc, f) => {
    acc[f.confidence] = (acc[f.confidence] ?? 0) + 1;
    return acc;
  }, {});
  const scanned = [`git 仓库 ${repoCount} 个`];
  if (fileScan) {
    scanned.push(`文件扫描 ${fileScan.dirs} 个目录${fileScan.truncated ? '（已截断）' : ''}`);
  } else {
    scanned.push('文件扫描 已关闭');
  }
  for (const r of report) {
    scanned.push(`${r.id} ${r.status === 'ok' ? `${r.count} 个会话` : r.status === 'absent' ? '无数据' : '降级'}`);
  }
  lines.push(
    `> 扫描范围：${scanned.join('｜')}。` +
      `${facts.length} 条事实：confirmed ${counts.confirmed ?? 0}，inferred ${counts.inferred ?? 0}，unverified ${counts.unverified ?? 0}。` +
      `日界 ${String(cutoffHour).padStart(2, '0')}:00，全部时间戳按 UTC 存储。`,
    '',
  );
  return lines.join('\n');
}
