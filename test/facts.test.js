import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, upsertEvidence } from '../src/db.js';
import { buildFacts, validateReferences, parseSourceId, sourceId, shortLabel, evidenceFromGit, evidenceFromSession } from '../src/facts.js';

test('parseSourceId 只按第一个冒号切分，保留 ref 里的 # 与 :', () => {
  assert.deepEqual(parseSourceId('commit:a9c7471'), { sourceType: 'commit', sourceRef: 'a9c7471' });
  assert.deepEqual(parseSourceId('session:abc-123#42'), { sourceType: 'session', sourceRef: 'abc-123#42' });
  assert.deepEqual(parseSourceId('session-action:s#7:file:/a/b.ts'), {
    sourceType: 'session-action',
    sourceRef: 's#7:file:/a/b.ts',
  });
  assert.equal(parseSourceId('没有冒号'), null);
});

test('shortLabel 截断长文本', () => {
  assert.equal(shortLabel('短标题'), '短标题');
  assert.equal(shortLabel('x'.repeat(50)).length, 41);
  assert.equal(shortLabel('多  个   空白'), '多 个 空白');
});

test('引用完整性校验：来源不存在则强制降级为 unverified', () => {
  const db = openDb(':memory:');
  upsertEvidence(db, {
    source_type: 'commit',
    source_ref: 'real-hash',
    project_id: 'demo',
    occurred_at: '2026-09-03T06:00:00.000Z',
    local_date: '2026-09-03',
  });
  const facts = [
    { text: '真的', source_ids: [sourceId('commit', 'real-hash')], confidence: 'confirmed' },
    { text: '编造的', source_ids: [sourceId('commit', 'fabricated-hash')], confidence: 'confirmed' },
    { text: '一半编造', source_ids: [sourceId('commit', 'real-hash'), sourceId('commit', 'nope')], confidence: 'confirmed' },
  ];
  const res = validateReferences(db, facts, '2026-09-03');
  assert.equal(facts[0].confidence, 'confirmed');
  assert.equal(facts[1].confidence, 'unverified');
  assert.equal(facts[2].confidence, 'unverified');
  assert.equal(res.downgraded, 2);
  assert.deepEqual(res.missing, ['commit:fabricated-hash', 'commit:nope']);
  db.close();
});

test('归属日不同也算来源缺失（不会跨天误判为有效）', () => {
  const db = openDb(':memory:');
  upsertEvidence(db, {
    source_type: 'commit',
    source_ref: 'h1',
    occurred_at: '2026-09-02T06:00:00.000Z',
    local_date: '2026-09-02',
  });
  const facts = [{ text: 'x', source_ids: ['commit:h1'], confidence: 'confirmed' }];
  validateReferences(db, facts, '2026-09-03');
  assert.equal(facts[0].confidence, 'unverified');
  db.close();
});

test('buildFacts 产出的 source_id 与证据行严格对得上（端到端）', () => {
  const db = openDb(':memory:');
  const cutoff = 4;
  const localDate = '2026-09-03';
  const repoResult = {
    repo: '/tmp/demo',
    branch: 'main',
    commits: [
      {
        hash: 'deadbeef',
        author: 'me',
        email: 'me@example.com',
        committedAt: '2026-09-03T06:00:00.000Z',
        message: '修好了扫描器',
        additions: 10,
        deletions: 2,
        files: ['src/a.ts'],
      },
    ],
    dirty: [{ status: 'M', path: 'src/b.ts' }],
  };
  const session = {
    providerId: 'claude-code',
    sessionId: 'sess-1',
    title: null,
    cwd: '/tmp/demo',
    prompts: [{ index: 3, text: '帮我改扫描器', ts: '2026-09-03T07:00:00.000Z', localDate }],
    actions: [{ index: 4, kind: 'file', value: '/tmp/demo/src/a.ts', ts: '2026-09-03T07:01:00.000Z' }],
    firstTs: '2026-09-03T07:00:00.000Z',
  };
  const nowIso = '2026-09-03T08:00:00.000Z';
  for (const row of evidenceFromGit(repoResult, 'demo', cutoff, nowIso)) upsertEvidence(db, row);
  for (const row of evidenceFromSession(session, 'demo', cutoff)) upsertEvidence(db, row);

  const facts = buildFacts(
    {
      projects: [{ id: 'demo', name: 'demo', rootPath: '/tmp/demo' }],
      gitByProject: new Map([['demo', [repoResult]]]),
      sessionsByProject: new Map([['demo', [session]]]),
    },
    localDate,
  );
  const res = validateReferences(db, facts, localDate);
  assert.equal(res.downgraded, 0, `不应有降级，missing=${JSON.stringify(res.missing)}`);
  assert.equal(facts.length, 3); // 1 commit + 1 工作树 + 1 会话
  assert.ok(facts.every((f) => f.confidence === 'confirmed'));
  db.close();
});

