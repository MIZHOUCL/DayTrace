import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanFiles, isSensitiveName, insideRepo, projectDirOf } from '../src/collect/files.js';
import { dayRange } from '../src/time.js';

const RANGE = dayRange(new Date().toISOString().slice(0, 10), 0);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daytrace-fs-'));
  const w = (rel, body = 'x') => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    return p;
  };
  return { root, w };
}

test('敏感文件名识别：该拦的拦住，不该误伤的放过', () => {
  for (const n of ['.env', '.env.production', 'server.pem', 'id_rsa', 'credentials.json', 'vault.kdbx', '.npmrc']) {
    assert.equal(isSensitiveName(n), true, `${n} 应被判为敏感`);
  }
  // 这些是正常源码，用 secret*/token* 前缀通配就会误伤
  for (const n of ['tokenizer.ts', 'secrets.example.json', 'password-strength.js', 'keyboard.tsx', 'monkey.py']) {
    assert.equal(isSensitiveName(n), false, `${n} 不该被判为敏感`);
  }
});

test('insideRepo 只匹配真正的子路径', () => {
  assert.equal(insideRepo('/a/repo/src/x.ts', ['/a/repo']), true);
  assert.equal(insideRepo('/a/repo', ['/a/repo']), true);
  assert.equal(insideRepo('/a/repository/x.ts', ['/a/repo']), false, '不能把 repository 当成 repo 的子目录');
  assert.equal(insideRepo('/b/x.ts', ['/a/repo']), false);
});

test('扫描命中窗口内的文件，跳过敏感文件、点文件与体积黑洞', () => {
  const { root, w } = fixture();
  w('proj/src/a.ts');
  w('proj/src/b.py');
  w('proj/.env');
  w('proj/server.pem');
  w('proj/node_modules/junk/index.js');
  w('proj/.idea/workspace.xml');
  w('proj/dist/bundle.js');
  const { hits, stats } = scanFiles([root], RANGE, { repos: [] });
  const names = hits.map((h) => path.basename(h.path)).sort();
  assert.deepEqual(names, ['a.ts', 'b.py']);
  assert.equal(stats.skippedSensitive, 1, 'server.pem 计入敏感；.env 走点文件分支');
  assert.ok(stats.dirs > 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('落在 git 仓库内的文件交给 git，不重复记账', () => {
  const { root, w } = fixture();
  w('repo/src/a.ts');
  w('loose/b.ts');
  const { hits, stats } = scanFiles([root], RANGE, { repos: [path.join(root, 'repo')] });
  assert.deepEqual(hits.map((h) => path.basename(h.path)), ['b.ts']);
  assert.equal(stats.skippedInRepo, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('窗口外的文件不计入', () => {
  const { root, w } = fixture();
  const p = w('proj/old.ts');
  const longAgo = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(p, longAgo, longAgo);
  const { hits } = scanFiles([root], RANGE, { repos: [] });
  assert.equal(hits.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('maxFiles 命中上限时显式标记截断，不静默丢弃', () => {
  const { root, w } = fixture();
  for (let i = 0; i < 12; i += 1) w(`proj/f${i}.ts`);
  const { hits, stats } = scanFiles([root], RANGE, { repos: [], maxFiles: 5 });
  assert.equal(hits.length, 5);
  assert.equal(stats.truncated, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('maxDepth 限制递归深度', () => {
  const { root, w } = fixture();
  w('a/b/c/d/e/f/g/deep.ts');
  assert.equal(scanFiles([root], RANGE, { repos: [], maxDepth: 2 }).hits.length, 0);
  assert.equal(scanFiles([root], RANGE, { repos: [], maxDepth: 9 }).hits.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('projectDirOf 取 root 下第一层目录作为项目', () => {
  const roots = [path.join('/code')];
  assert.equal(projectDirOf(path.join('/code', 'foo', 'src', 'a.ts'), roots), path.join('/code', 'foo'));
  assert.equal(projectDirOf(path.join('/code', 'top.md'), roots), '/code');
  // 不在任何 root 下时退回文件所在目录
  assert.equal(projectDirOf(path.join('/elsewhere', 'x', 'y.ts'), roots), path.join('/elsewhere', 'x'));
});
