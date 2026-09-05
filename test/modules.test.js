import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModules, splitByGap, toTitle, scoreOf, timelineOf, DEFAULT_GAP_MINUTES } from '../src/modules.js';

const T = (h, m = 0) => `2026-09-05T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

test('toTitle 取第一句并截断', () => {
  assert.equal(toTitle('把周报按 PDCA 重排。然后同步到 OA'), '把周报按 PDCA 重排');
  assert.equal(toTitle('  、，这是我今天上午做的事情'), '这是我今天上午做的事情');
  assert.equal(toTitle('一'.repeat(50)).length, 33, '32 字 + 省略号');
  assert.equal(toTitle(''), '');
  assert.equal(toTitle(null), '');
});

test('splitByGap 按空隙切块', () => {
  const items = [{ ts: T(9) }, { ts: T(9, 30) }, { ts: T(14) }, { ts: T(14, 10) }];
  const blocks = splitByGap(items, 90);
  assert.equal(blocks.length, 2, '上午一块、下午一块');
  assert.deepEqual(blocks.map((b) => b.length), [2, 2]);
  // 间隔放大到 8 小时就并成一块
  assert.equal(splitByGap(items, 8 * 60).length, 1);
});

test('scoreOf：有提交的权重高于纯文件改动，且文件数是饱和的', () => {
  const commitHeavy = scoreOf({ commits: 2, prompts: 0, commands: 0, files: 3 }, 30);
  const fileOnly = scoreOf({ commits: 0, prompts: 0, commands: 0, files: 15 }, 30);
  assert.ok(commitHeavy > fileOnly, `2 提交+3 文件(${commitHeavy}) 应高于 15 文件(${fileOnly})`);

  // 关键：文件数翻十倍，权重不能翻十倍，否则 QQ 那 62 个 .db-shm 会压过真实工作
  const few = scoreOf({ commits: 0, prompts: 0, commands: 0, files: 6 }, 0);
  const many = scoreOf({ commits: 0, prompts: 0, commands: 0, files: 60 }, 0);
  assert.ok(many < few * 4, `60 文件(${many}) 不该接近 6 文件(${few}) 的十倍`);

  // 一条提问的分量要高于一个文件被碰过
  assert.ok(scoreOf({ commits: 0, prompts: 1, commands: 0, files: 0 }, 0) > scoreOf({ commits: 0, prompts: 0, commands: 0, files: 1 }, 0) - 0.1);

  // 持续时间加成最多翻倍
  assert.ok(scoreOf({ commits: 1, prompts: 0, commands: 0, files: 0 }, 600) <= 6 * 2);
});

function makeInput(overrides = {}) {
  return {
    projects: [{ id: 'demo', name: 'demo', rootPath: '/tmp/demo' }],
    gitByProject: new Map(),
    sessionsByProject: new Map(),
    filesByProject: new Map(),
    nowIso: T(23),
    ...overrides,
  };
}

test('同一项目里间隔超过阈值会切成两个模块', () => {
  const input = makeInput({
    sessionsByProject: new Map([
      [
        'demo',
        [
          {
            sessionId: 's1',
            providerId: 'codex',
            title: null,
            prompts: [
              { index: 1, text: '上午核对西南电池的出勤数据', ts: T(9) },
              { index: 2, text: '下午把周报按 PDCA 重排', ts: T(15) },
            ],
            actions: [],
          },
        ],
      ],
    ]),
  });
  const mods = buildModules(input, { gapMinutes: DEFAULT_GAP_MINUTES });
  assert.equal(mods.length, 2);
  assert.deepEqual(mods.map((m) => m.title).sort(), ['上午核对西南电池的出勤数据', '下午把周报按 PDCA 重排'].sort());
  assert.ok(mods.every((m) => m.selected === true));
});

test('commit 优先当标题，类别判为代码', () => {
  const input = makeInput({
    gitByProject: new Map([
      [
        'demo',
        [
          {
            repo: '/tmp/demo',
            commits: [
              { hash: 'h1', message: '修好扫描器的时间窗口', committedAt: T(10), files: ['src/a.ts'], additions: 3, deletions: 1 },
              { hash: 'h2', message: '补测试', committedAt: T(10, 20), files: ['test/a.test.ts'], additions: 9, deletions: 0 },
            ],
            dirty: [],
          },
        ],
      ],
    ]),
  });
  const mods = buildModules(input);
  assert.equal(mods.length, 1);
  assert.equal(mods[0].title, '修好扫描器的时间窗口（等 2 个提交）');
  assert.equal(mods[0].category, '代码');
  assert.equal(mods[0].stats.commits, 2);
});

test('只有零星文件改动的项目并入杂项，且默认不写进日记', () => {
  const input = makeInput({
    projects: [
      { id: 'demo', name: 'demo', rootPath: '/tmp/demo' },
      { id: 'junk', name: 'junk', rootPath: '/tmp/junk' },
    ],
    filesByProject: new Map([
      ['junk', [{ path: '/tmp/junk/setting.json', mtime: T(20) }, { path: '/tmp/junk/config.json', mtime: T(20, 5) }]],
    ]),
  });
  const mods = buildModules(input);
  const misc = mods.find((m) => m.id === 'mod:misc');
  assert.ok(misc, '应该有杂项模块');
  assert.equal(misc.selected, false, '杂项默认排除');
  assert.equal(misc.stats.files, 2);
  assert.ok(misc.why.includes('默认排除'));
});

test('未提交改动用文件真实 mtime，不再全堆在运行那一刻', () => {
  const input = makeInput({
    gitByProject: new Map([
      ['demo', [{ repo: '/tmp/demo', commits: [], dirty: [{ status: 'M', path: 'src/a.ts', mtime: T(9) }, { status: 'M', path: 'src/b.ts', mtime: T(9, 10) }] }]],
    ]),
  });
  const items = timelineOf(input.projects[0], input);
  assert.deepEqual(items.map((i) => i.ts), [T(9), T(9, 10)]);
  assert.ok(items.every((i) => i.ts !== input.nowIso));
});
