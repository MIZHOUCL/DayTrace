/**
 * 存储层：node:sqlite（Node 内置，无原生依赖，含 FTS5）。
 * 6 张表，理由见规划文档 ADR-017。
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { dbPath, ensureDataDir } from './config.js';

export const SCHEMA_VERSION = 1;

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE projects (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        root_path     TEXT UNIQUE,
        user_renamed  INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id             TEXT PRIMARY KEY,
        provider_id    TEXT NOT NULL,
        thread_id      TEXT NOT NULL,
        title          TEXT,
        cwd            TEXT,
        git_branch     TEXT,
        project_id     TEXT,
        first_ts       TEXT,
        last_ts        TEXT,
        content_status TEXT NOT NULL DEFAULT 'summary_imported',
        schema_version TEXT
      );
      CREATE TABLE commits (
        hash         TEXT PRIMARY KEY,
        project_id   TEXT,
        message      TEXT,
        author       TEXT,
        committed_at TEXT,
        branch       TEXT,
        files        INTEGER DEFAULT 0,
        additions    INTEGER DEFAULT 0,
        deletions    INTEGER DEFAULT 0
      );
      CREATE TABLE evidence (
        id          TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_ref  TEXT NOT NULL,
        project_id  TEXT,
        path        TEXT,
        path_alias  TEXT,
        occurred_at TEXT NOT NULL,
        local_date  TEXT NOT NULL,
        level       TEXT NOT NULL DEFAULT 'L0',
        excerpt     TEXT,
        UNIQUE (source_type, source_ref, local_date)
      );
      CREATE INDEX idx_evidence_date ON evidence (local_date, project_id);
      CREATE TABLE facts (
        id          TEXT PRIMARY KEY,
        journal_id  TEXT,
        project_id  TEXT,
        text        TEXT NOT NULL,
        source_ids  TEXT NOT NULL DEFAULT '[]',
        confidence  TEXT NOT NULL DEFAULT 'unverified',
        occurred_at TEXT,
        local_date  TEXT
      );
      CREATE TABLE journals (
        id         TEXT PRIMARY KEY,
        local_date TEXT UNIQUE NOT NULL,
        markdown   TEXT,
        out_path   TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

/**
 * 打开数据库并执行迁移。
 * @param {string} [file] 传 ':memory:' 用于测试
 * @returns {DatabaseSync}
 */
export function openDb(file) {
  const target = file || dbPath();
  if (target !== ':memory:') {
    ensureDataDir();
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}

/** 顺序迁移，幂等。 */
export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`迁移 ${m.version} 失败：${err.message}`);
    }
  }
  return currentVersion(db);
}

export function currentVersion(db) {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  return row?.v ?? 0;
}

/**
 * 幂等写入证据。同 (source_type, source_ref, local_date) 重复插入不会产生新行。
 * @returns {{id:string, inserted:boolean}}
 */
export function upsertEvidence(db, ev) {
  const id = ev.id || `${ev.source_type}:${ev.source_ref}:${ev.local_date}`;
  const info = db
    .prepare(
      `INSERT INTO evidence (id, source_type, source_ref, project_id, path, path_alias, occurred_at, local_date, level, excerpt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_type, source_ref, local_date) DO NOTHING`,
    )
    .run(id, ev.source_type, ev.source_ref, ev.project_id ?? null, ev.path ?? null, ev.path_alias ?? null, ev.occurred_at, ev.local_date, ev.level ?? 'L0', ev.excerpt ?? null);
  return { id, inserted: info.changes > 0 };
}

/** 证据引用是否真实存在（供 facts.js 的引用完整性校验使用）。 */
export function evidenceExists(db, sourceType, sourceRef, localDate) {
  const row = db
    .prepare('SELECT 1 AS ok FROM evidence WHERE source_type = ? AND source_ref = ? AND local_date = ?')
    .get(sourceType, sourceRef, localDate);
  return Boolean(row);
}

