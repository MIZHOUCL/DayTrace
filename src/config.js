/**
 * 配置与跨平台数据目录（ADR-011）。
 * macOS  ~/Library/Application Support/daytrace
 * Windows %APPDATA%\daytrace
 * 其他    $XDG_DATA_HOME/daytrace 或 ~/.local/share/daytrace
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DEFAULT_CUTOFF_HOUR } from './time.js';

/** SQLite WAL 放在这些同步目录里有损坏风险，检测到就告警。 */
const SYNC_DIR_HINTS = ['iCloud', 'OneDrive', 'Dropbox', 'Google Drive', 'Nextcloud', '坚果云'];

export function dataDir() {
  if (process.env.DAYTRACE_DATA_DIR) return process.env.DAYTRACE_DATA_DIR;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'daytrace');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'daytrace');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'daytrace');
}

export function dbPath() {
  return path.join(dataDir(), 'daytrace.db');
}

export function configPath() {
  return path.join(dataDir(), 'config.json');
}

/** 默认的会话目录，跨平台展开。 */
export function defaultSessionDirs() {
  const home = os.homedir();
  return {
    'claude-code': [path.join(home, '.claude', 'projects')],
    codex: [path.join(home, '.codex', 'sessions'), path.join(home, '.codex', 'archived_sessions')],
  };
}

export const DEFAULTS = {
  cutoffHour: DEFAULT_CUTOFF_HOUR,
  /** IANA 时区名。null = 用本机时区（推荐）。填了就固定用这个时区跑。 */
  timezone: null,
  /** 要扫描 git 仓库的根目录，留空则用 cwd。 */
  roots: [],
  /** 只统计这个 author 的 commit（email 或 name 片段），null = 全部。 */
  authorFilter: null,
  /** 生成的 Markdown 写到哪里，null = 只打印。 */
  out: null,
  sessionDirs: null,
  /** true 时永久禁用一切外发（ADR-008 §8.4）。 */
  managedDevice: false,
  /** 文件系统扫描（ADR-019）。只记路径与时间，不读正文。 */
  fileScan: { enabled: true, maxDepth: 6, maxFiles: 5000, extraExcludes: [] },
  ai: { enabled: false, provider: null, model: null },
};

export function ensureDataDir() {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadConfig() {
  const file = configPath();
  let onDisk = {};
  if (fs.existsSync(file)) {
    try {
      onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`配置文件解析失败：${file}\n${err.message}`);
    }
  }
  const cfg = { ...DEFAULTS, ...onDisk };
  cfg.sessionDirs = { ...defaultSessionDirs(), ...(onDisk.sessionDirs || {}) };
  cfg.ai = { ...DEFAULTS.ai, ...(onDisk.ai || {}) };
  cfg.fileScan = { ...DEFAULTS.fileScan, ...(onDisk.fileScan || {}) };
  if (!Array.isArray(cfg.roots) || cfg.roots.length === 0) cfg.roots = [process.cwd()];
  if (!Number.isInteger(cfg.cutoffHour) || cfg.cutoffHour < 0 || cfg.cutoffHour > 23) {
    cfg.cutoffHour = DEFAULT_CUTOFF_HOUR;
  }
  return cfg;
}

export function saveConfig(cfg) {
  ensureDataDir();
  fs.writeFileSync(configPath(), `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
  return configPath();
}

/** 数据目录是否位于云同步目录内。 */
export function syncDirWarning(dir = dataDir()) {
  const hit = SYNC_DIR_HINTS.find((h) => dir.toLowerCase().includes(h.toLowerCase()));
  if (!hit) return null;
  return `数据目录位于「${hit}」同步目录内：${dir}\nSQLite WAL 在同步目录下有损坏风险，建议用 DAYTRACE_DATA_DIR 指到本地目录。`;
}

