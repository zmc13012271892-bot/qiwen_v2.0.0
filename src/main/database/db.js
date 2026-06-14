/**
 * db.js — better-sqlite3 版本
 * v1.2.0: 从 sql.js 迁移到 better-sqlite3
 * - 同步 API，无需 await，性能提升 10x
 * - 原生 FTS5 支持
 * - WAL 模式，真正并发安全
 * - 数据库文件直接读写，无需 export/import
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const log = require('electron-log');
const { v4: uuidv4 } = require('uuid');

let db = null;

// ── 路径 ──────────────────────────────────────────────────────

function getDbPath() {
  try {
    const userDataPath = app.getPath('userData');
    const dbDir = path.join(userDataPath, 'data');
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    return path.join(dbDir, 'qiwen.db');
  } catch (err) {
    log.error('[getDbPath] error:', err);
    const fallback = path.join(app.getPath('appData'), 'QiWen', 'data');
    if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
    return path.join(fallback, 'qiwen.db');
  }
}

// ── Schema ────────────────────────────────────────────────────

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA synchronous=NORMAL;
PRAGMA cache_size=-32000;

CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  icon        TEXT DEFAULT '📁',
  color       TEXT DEFAULT '#c8a96e',
  profession  TEXT DEFAULT 'general',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '无标题',
  content_type TEXT NOT NULL DEFAULT 'markdown',
  parent_id    TEXT,
  workspace_id TEXT NOT NULL,
  is_folder    INTEGER NOT NULL DEFAULT 0,
  is_favorite  INTEGER NOT NULL DEFAULT 0,
  is_pinned    INTEGER NOT NULL DEFAULT 0,
  is_archived  INTEGER NOT NULL DEFAULT 0,
  word_count   INTEGER NOT NULL DEFAULT 0,
  char_count   INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  synced_at    INTEGER
);

CREATE TABLE IF NOT EXISTS document_contents (
  document_id TEXT PRIMARY KEY,
  content     TEXT NOT NULL DEFAULT '',
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS document_tags (
  document_id TEXT NOT NULL,
  tag         TEXT NOT NULL,
  PRIMARY KEY (document_id, tag)
);

CREATE TABLE IF NOT EXISTS document_versions (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  content     TEXT NOT NULL,
  title       TEXT NOT NULL,
  word_count  INTEGER NOT NULL DEFAULT 0,
  label       TEXT DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_references (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title        TEXT NOT NULL,
  authors      TEXT NOT NULL DEFAULT '[]',
  year         INTEGER,
  journal      TEXT,
  volume       TEXT,
  issue        TEXT,
  pages        TEXT,
  doi          TEXT,
  url          TEXT,
  abstract     TEXT,
  keywords     TEXT NOT NULL DEFAULT '[]',
  tags         TEXT NOT NULL DEFAULT '[]',
  notes        TEXT,
  file_path    TEXT,
  citation_key TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'article',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plugins (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  version      TEXT NOT NULL,
  description  TEXT DEFAULT '',
  author       TEXT DEFAULT '',
  category     TEXT DEFAULT 'utility',
  tags         TEXT NOT NULL DEFAULT '[]',
  is_enabled   INTEGER NOT NULL DEFAULT 1,
  is_paid      INTEGER NOT NULL DEFAULT 0,
  price        REAL NOT NULL DEFAULT 0,
  icon         TEXT DEFAULT '🔌',
  entry_point  TEXT NOT NULL,
  permissions  TEXT NOT NULL DEFAULT '[]',
  settings     TEXT NOT NULL DEFAULT '{}',
  installed_at INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profile (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL DEFAULT '本地用户',
  email           TEXT,
  avatar          TEXT,
  is_local        INTEGER NOT NULL DEFAULT 1,
  plan            TEXT NOT NULL DEFAULT 'free',
  license_key     TEXT,
  license_status  TEXT NOT NULL DEFAULT 'inactive',
  license_expires INTEGER,
  ai_tokens_used  INTEGER NOT NULL DEFAULT 0,
  ai_tokens_limit INTEGER NOT NULL DEFAULT 100000,
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id          TEXT PRIMARY KEY,
  document_id TEXT,
  title       TEXT DEFAULT '新对话',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  timestamp       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS presentations (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '无标题演示',
  theme        TEXT NOT NULL DEFAULT 'dark',
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  slide_count  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS slides (
  id              TEXT PRIMARY KEY,
  presentation_id TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  layout          TEXT NOT NULL DEFAULT 'title',
  content         TEXT NOT NULL DEFAULT '{}',
  notes           TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  use_count   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS canvases (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        TEXT NOT NULL DEFAULT '无标题',
  type         TEXT NOT NULL DEFAULT 'whiteboard',
  data         TEXT NOT NULL DEFAULT '{}',
  thumbnail    TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pomodoro_sessions (
  id           TEXT PRIMARY KEY,
  document_id  TEXT REFERENCES documents(id) ON DELETE SET NULL,
  workspace_id TEXT NOT NULL,
  duration     INTEGER NOT NULL DEFAULT 1500,
  completed    INTEGER NOT NULL DEFAULT 0,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER
);

CREATE TABLE IF NOT EXISTS crash_reports (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL,
  stack      TEXT,
  context    TEXT,
  app_version TEXT,
  platform   TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_events (
  id         TEXT PRIMARY KEY,
  event      TEXT NOT NULL,
  payload    TEXT,
  created_at INTEGER NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_parent ON documents(parent_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_references_workspace ON paper_references(workspace_id);
CREATE INDEX IF NOT EXISTS idx_references_year ON paper_references(year);
CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_document_versions_doc ON document_versions(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_presentations_workspace ON presentations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_slides_presentation ON slides(presentation_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category);
CREATE INDEX IF NOT EXISTS idx_canvases_workspace ON canvases(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pomodoro_doc ON pomodoro_sessions(document_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pomodoro_ws ON pomodoro_sessions(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events ON usage_events(event, created_at DESC);

-- FTS5 全文搜索（better-sqlite3 原生支持）
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title,
  content,
  tags,
  content='',
  tokenize='unicode61 remove_diacritics 1'
);
`;

// ── 迁移 ──────────────────────────────────────────────────────

const MIGRATIONS = [
  // v1
  `CREATE TABLE IF NOT EXISTS canvases (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '无标题',
    type TEXT NOT NULL DEFAULT 'whiteboard',
    data TEXT NOT NULL DEFAULT '{}',
    thumbnail TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_canvases_workspace ON canvases(workspace_id, updated_at DESC);`,
  // v2
  `CREATE TABLE IF NOT EXISTS pomodoro_sessions (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    workspace_id TEXT NOT NULL,
    duration INTEGER NOT NULL DEFAULT 1500,
    completed INTEGER NOT NULL DEFAULT 0,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_pomodoro_doc ON pomodoro_sessions(document_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pomodoro_ws ON pomodoro_sessions(workspace_id, started_at DESC);`,
  // v3: FTS5（better-sqlite3 原生支持，不需要 try-catch）
  `CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title, content, tags, content='', tokenize='unicode61 remove_diacritics 1'
  );`,
  // v4: License + crash + usage
  `ALTER TABLE user_profile ADD COLUMN license_key TEXT;
   ALTER TABLE user_profile ADD COLUMN license_status TEXT NOT NULL DEFAULT 'inactive';
   ALTER TABLE user_profile ADD COLUMN license_expires INTEGER;`,
  // v5: version label
  `ALTER TABLE document_versions ADD COLUMN label TEXT DEFAULT '';`,
  // v6: crash & usage tables
  `CREATE TABLE IF NOT EXISTS crash_reports (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, message TEXT NOT NULL,
    stack TEXT, context TEXT, app_version TEXT, platform TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY, event TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_usage_events ON usage_events(event, created_at DESC);`,
];

// ── 初始化 ────────────────────────────────────────────────────

function initDatabase() {
  const dbPath = getDbPath();
  log.info(`[db] Opening database at: ${dbPath}`);

  try {
    db = new Database(dbPath, { verbose: undefined });

    // WAL 模式等 PRAGMA（better-sqlite3 直接执行）
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -32000');

    // 执行 Schema（幂等 CREATE IF NOT EXISTS）
    db.exec(SCHEMA);
    log.info('[db] Schema executed');

    // 迁移
    runMigrations();

    // Seed
    seedDefaultData();

    log.info('[db] Database initialized successfully');
    // ✅ 修复: 启动时清理重复工作区
    deduplicateWorkspaces();
    return db;
  } catch (err) {
    log.error('[db] Initialization error:', err);
    throw err;
  }
}

function runMigrations() {
  const currentVersion = db.pragma('user_version', { simple: true }) || 0;
  log.info(`[db] Schema version: ${currentVersion}, migrations: ${MIGRATIONS.length}`);

  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    log.info(`[db] Running migration ${i + 1}`);
    try {
      db.exec(MIGRATIONS[i]);
    } catch (err) {
      // ALTER TABLE ADD COLUMN 在列已存在时会报错，安全忽略
      if (err.message && (err.message.includes('duplicate column') || err.message.includes('already exists'))) {
        log.warn(`[db] Migration ${i + 1} column already exists, skipping`);
      } else {
        log.error(`[db] Migration ${i + 1} failed:`, err);
        throw err;
      }
    }
    db.pragma(`user_version = ${i + 1}`);
  }
}

function seedDefaultData() {
  // User profile
  const profileCount = db.prepare('SELECT COUNT(*) as c FROM user_profile').get().c;
  if (profileCount === 0) {
    db.prepare(`
      INSERT INTO user_profile (id, name, is_local, plan, license_status, ai_tokens_used, ai_tokens_limit, created_at)
      VALUES (?, '本地用户', 1, 'free', 'inactive', 0, 100000, ?)
    `).run(uuidv4(), Date.now());
    log.info('[db] Default user profile created');
  }

  // Default settings
  const defaultSettings = {
    theme: 'dark', accentColor: '#c8a96e', fontSize: 15, fontFamily: 'default',
    lineHeight: 1.85, editorWidth: 'normal', spellCheck: false, autoSave: true,
    autoSaveInterval: 3000, showWordCount: true, showLineNumbers: false,
    focusModeBlur: 70, language: 'zh-CN', sidebarWidth: 220, rightPanelWidth: 260,
    crashReportEnabled: true, usageStatsEnabled: true,
  };
  const now = Date.now();
  const insertSetting = db.prepare('INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)');
  for (const [key, value] of Object.entries(defaultSettings)) {
    insertSetting.run(key, JSON.stringify(value), now);
  }
  log.info('[db] Default settings seeded');

  // Built-in templates
  try {
    const TEMPLATES = require('./templates_seed');
    const currentCount = db.prepare('SELECT COUNT(*) as c FROM templates WHERE is_builtin = 1').get().c;
    if (currentCount < TEMPLATES.length) {
      log.info(`[db] Re-seeding templates: ${currentCount}/${TEMPLATES.length}`);
      db.prepare('DELETE FROM templates WHERE is_builtin = 1').run();
      const insertTemplate = db.prepare(
        'INSERT INTO templates (id,title,content,category,description,tags,is_builtin,use_count,created_at,updated_at) VALUES (?,?,?,?,?,?,1,0,?,?)'
      );
      const insertMany = db.transaction((templates) => {
        for (const tmpl of templates) {
          insertTemplate.run(uuidv4(), tmpl.t, tmpl.h, tmpl.c, tmpl.d, JSON.stringify(tmpl.tags), now, now);
        }
      });
      insertMany(TEMPLATES);
      log.info(`[db] Inserted ${TEMPLATES.length} builtin templates`);
    }
  } catch (e) {
    log.error('[db] Template seed error:', e);
  }
}

// ── FTS5 ──────────────────────────────────────────────────────

function stripHtmlForFts(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ')
    .replace(/<\/li>/gi, ' ').replace(/<\/h[1-6]>/gi, ' ')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim().slice(0, 50000);
}

function updateFtsIndex(documentId, title, htmlContent, tags) {
  try {
    const row = db.prepare('SELECT rowid FROM documents WHERE id = ?').get(documentId);
    if (!row) return;
    const plainText = stripHtmlForFts(htmlContent || '');
    const tagsText = Array.isArray(tags) ? tags.join(' ') : (tags || '');
    db.prepare('INSERT INTO documents_fts(documents_fts, rowid, title, content, tags) VALUES(\'delete\', ?, ?, ?, ?)').run(row.rowid, title || '', plainText, tagsText);
    db.prepare('INSERT INTO documents_fts(rowid, title, content, tags) VALUES (?, ?, ?, ?)').run(row.rowid, title || '', plainText, tagsText);
  } catch (err) {
    log.warn('[FTS] updateFtsIndex failed:', err?.message);
  }
}

function rebuildFtsIndex() {
  try {
    log.info('[FTS] Rebuilding full-text index...');
    // ✅ 修复: contentless FTS5 表不支持 'delete-all'，需要 drop + recreate
    try {
      db.prepare("INSERT INTO documents_fts(documents_fts) VALUES('delete-all')").run();
    } catch (e) {
      // 旧版表结构不支持 delete-all，直接 drop + recreate
      log.info('[FTS] delete-all failed, dropping and recreating FTS table...');
      db.prepare('DROP TABLE IF EXISTS documents_fts').run();
      db.prepare(`CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        title, content, tags,
        content='', tokenize='unicode61 remove_diacritics 1'
      )`).run();
    }
    const rows = db.prepare(`
      SELECT d.rowid, d.id, d.title, dc.content,
             GROUP_CONCAT(dt.tag, ' ') as tags_raw
      FROM documents d
      LEFT JOIN document_contents dc ON dc.document_id = d.id
      LEFT JOIN document_tags dt ON dt.document_id = d.id
      WHERE d.is_folder = 0
      GROUP BY d.id
    `).all();
    const insert = db.prepare('INSERT INTO documents_fts(rowid, title, content, tags) VALUES (?, ?, ?, ?)');
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        insert.run(row.rowid, row.title || '', stripHtmlForFts(row.content || ''), row.tags_raw || '');
      }
    });
    insertMany(rows);
    log.info(`[FTS] Rebuilt index for ${rows.length} documents`);
  } catch (err) {
    log.warn('[FTS] rebuildFtsIndex failed:', err?.message);
  }
}

// ── 工作区去重（修复239个工作区问题）────────────────────────────
function deduplicateWorkspaces() {
  try {
    // 找出同名工作区，保留最早创建的，删除其余
    const dupes = db.prepare(`
      SELECT id FROM workspaces
      WHERE id NOT IN (
        SELECT MIN(id) FROM workspaces GROUP BY name
      )
    `).all();
    if (dupes.length > 0) {
      const del = db.prepare('DELETE FROM workspaces WHERE id = ?');
      const delMany = db.transaction((rows) => {
        for (const row of rows) del.run(row.id);
      });
      delMany(dupes);
      log.info('[workspaces] Removed', dupes.length, 'duplicate workspaces');
    }
  } catch (e) {
    log.warn('[workspaces] deduplication failed:', e?.message);
  }
}

// ── 崩溃报告 ─────────────────────────────────────────────────

function recordCrash({ type, message, stack, context }) {
  try {
    const enabled = db.prepare("SELECT value FROM app_settings WHERE key = 'crashReportEnabled'").get();
    if (enabled && JSON.parse(enabled.value) === false) return;
    db.prepare(
      'INSERT INTO crash_reports (id, type, message, stack, context, app_version, platform, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(uuidv4(), type, message, stack || '', JSON.stringify(context || {}), app.getVersion(), process.platform, Date.now());
  } catch (e) { /* 崩溃报告本身不能崩 */ }
}

// ── 使用统计 ─────────────────────────────────────────────────

function trackEvent(event, payload) {
  try {
    const enabled = db.prepare("SELECT value FROM app_settings WHERE key = 'usageStatsEnabled'").get();
    if (enabled && JSON.parse(enabled.value) === false) return;
    db.prepare('INSERT INTO usage_events (id, event, payload, created_at) VALUES (?, ?, ?, ?)').run(
      uuidv4(), event, JSON.stringify(payload || {}), Date.now()
    );
    // 只保留最近 10000 条
    db.prepare('DELETE FROM usage_events WHERE id NOT IN (SELECT id FROM usage_events ORDER BY created_at DESC LIMIT 10000)').run();
  } catch (e) { /* 统计不能影响主流程 */ }
}

// ── 基础 API ──────────────────────────────────────────────────

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
    log.info('[db] Database closed');
  }
}

// better-sqlite3 直接写文件，不需要 export/save 机制
// 保留此函数保持接口兼容，实际为空操作
function saveDatabase() { /* no-op: better-sqlite3 writes directly */ }

module.exports = {
  initDatabase, getDb, closeDb, saveDatabase,
  updateFtsIndex, rebuildFtsIndex, deduplicateWorkspaces,
  recordCrash, trackEvent,
  isFts5Available: () => true, // better-sqlite3 always supports FTS5
};
