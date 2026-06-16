/**
 * documents.js — better-sqlite3 版本
 * v1.2.0: 全面迁移，使用同步 API
 */
const log = require('electron-log');
const { ipcMain } = require('electron');
const { getDb, saveDatabase, updateFtsIndex, rebuildFtsIndex, trackEvent } = require('../database/db');
const { v4: uuidv4 } = require('uuid');

function registerDocumentHandlers() {

  ipcMain.handle('documents:list', (_, { workspaceId, parentId = null, all = false }) => {
    const db = getDb();
    if (all) {
      // 返回工作区全部文档（含子文档），用于构建文件树
      return db.prepare(`
        SELECT d.*, GROUP_CONCAT(dt.tag) as tags_raw
        FROM documents d
        LEFT JOIN document_tags dt ON dt.document_id = d.id
        WHERE d.workspace_id = ? AND d.is_archived = 0
        GROUP BY d.id
        ORDER BY d.is_folder DESC, d.sort_order ASC, d.updated_at DESC
      `).all(workspaceId).map(normalizeDocument);
    }
    return db.prepare(`
      SELECT d.*, GROUP_CONCAT(dt.tag) as tags_raw
      FROM documents d
      LEFT JOIN document_tags dt ON dt.document_id = d.id
      WHERE d.workspace_id = ? AND d.parent_id IS ? AND d.is_archived = 0
      GROUP BY d.id
      ORDER BY d.is_pinned DESC, d.sort_order ASC, d.updated_at DESC
    `).all(workspaceId, parentId).map(normalizeDocument);
  });

  ipcMain.handle('documents:get', (_, { id }) => {
    const db = getDb();
    const doc = db.prepare(`
      SELECT d.*, dc.content, GROUP_CONCAT(dt.tag) as tags_raw
      FROM documents d
      LEFT JOIN document_contents dc ON dc.document_id = d.id
      LEFT JOIN document_tags dt ON dt.document_id = d.id
      WHERE d.id = ?
      GROUP BY d.id
    `).get(id);
    return doc ? normalizeDocument(doc) : null;
  });

  ipcMain.handle('documents:create', (_, { workspaceId, parentId = null, title = '无标题', content = '', contentType = 'markdown', isFolder = false }) => {
    const db = getDb();
    const id = uuidv4();
    const now = Date.now();
    const createDoc = db.transaction(() => {
      db.prepare(`
        INSERT INTO documents (id, title, content_type, parent_id, workspace_id, is_folder, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, title, contentType, parentId, workspaceId, isFolder ? 1 : 0, now, now);
      if (!isFolder) {
        db.prepare('INSERT INTO document_contents (document_id, content, updated_at) VALUES (?, ?, ?)').run(id, content, now);
      }
    });
    createDoc();
    trackEvent('document_created', { contentType, isFolder });
    return { id, title, content, contentType, parentId, workspaceId, isFolder, tags: [], isFavorite: false, isPinned: false, isArchived: false, wordCount: 0, charCount: 0, createdAt: now, updatedAt: now };
  });

  ipcMain.handle('documents:update', (_, { id, title, content, tags }) => {
    const db = getDb();
    const now = Date.now();
    const wordCount = content ? countWords(content) : undefined;
    const charCount = content ? content.length : undefined;

    const updateDoc = db.transaction(() => {
      if (title !== undefined || wordCount !== undefined) {
        const parts = [];
        const vals = [];
        if (title !== undefined) { parts.push('title = ?'); vals.push(title); }
        if (wordCount !== undefined) { parts.push('word_count = ?'); vals.push(wordCount); }
        if (charCount !== undefined) { parts.push('char_count = ?'); vals.push(charCount); }
        parts.push('updated_at = ?');
        vals.push(now);
        db.prepare(`UPDATE documents SET ${parts.join(', ')} WHERE id = ?`).run(...vals, id);
      } else if (content !== undefined) {
        db.prepare('UPDATE documents SET updated_at = ? WHERE id = ?').run(now, id);
      }

      if (content !== undefined) {
        db.prepare('DELETE FROM document_contents WHERE document_id = ?').run(id);
        db.prepare('INSERT INTO document_contents (document_id, content, updated_at) VALUES (?, ?, ?)').run(id, content, now);

        // 版本快照：每5分钟一个
        const lastVer = db.prepare('SELECT created_at FROM document_versions WHERE document_id = ? ORDER BY created_at DESC LIMIT 1').get(id);
        if (!lastVer || (now - lastVer.created_at) > 5 * 60 * 1000) {
          const docRow = db.prepare('SELECT title FROM documents WHERE id = ?').get(id);
          db.prepare('INSERT INTO document_versions (id, document_id, content, title, word_count, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            uuidv4(), id, content, docRow?.title || '', wordCount || 0, '', now
          );
          // 每个文档只保留最近 50 个版本
          db.prepare(`DELETE FROM document_versions WHERE document_id = ? AND id NOT IN (
            SELECT id FROM document_versions WHERE document_id = ? ORDER BY created_at DESC LIMIT 50
          )`).run(id, id);
        }
      }

      if (tags !== undefined) {
        db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(id);
        const insertTag = db.prepare('INSERT INTO document_tags (document_id, tag) VALUES (?, ?)');
        for (const tag of tags) insertTag.run(id, tag);
      }
    });
    updateDoc();

    // 异步更新 FTS（不阻塞响应）
    setImmediate(() => {
      try {
        const doc = db.prepare('SELECT title FROM documents WHERE id = ?').get(id);
        const tags = db.prepare("SELECT GROUP_CONCAT(tag, ' ') as t FROM document_tags WHERE document_id = ?").get(id);
        const c = db.prepare('SELECT content FROM document_contents WHERE document_id = ?').get(id);
        updateFtsIndex(id, doc?.title || '', c?.content || '', tags?.t || '');
      } catch (e) { log.warn('[FTS] update failed:', e?.message); }
    });

    log.info('[documents:update] OK, id:', id);
    return { success: true, updatedAt: now };
  });

  ipcMain.handle('documents:delete', (_, { id }) => {
    const db = getDb();
    db.transaction(() => {
      db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(id);
      db.prepare('DELETE FROM document_contents WHERE document_id = ?').run(id);
      db.prepare('DELETE FROM document_versions WHERE document_id = ?').run(id);
      db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    })();
    trackEvent('document_deleted', {});
    return { success: true };
  });

  ipcMain.handle('documents:toggle-favorite', (_, { id }) => {
    const db = getDb();
    const doc = db.prepare('SELECT is_favorite FROM documents WHERE id = ?').get(id);
    if (!doc) return { isFavorite: false };
    const newVal = doc.is_favorite ? 0 : 1;
    db.prepare('UPDATE documents SET is_favorite = ?, updated_at = ? WHERE id = ?').run(newVal, Date.now(), id);
    return { isFavorite: Boolean(newVal) };
  });

  ipcMain.handle('documents:toggle-pin', (_, { id }) => {
    const db = getDb();
    const doc = db.prepare('SELECT is_pinned FROM documents WHERE id = ?').get(id);
    if (!doc) return { isPinned: false };
    const newVal = doc.is_pinned ? 0 : 1;
    db.prepare('UPDATE documents SET is_pinned = ?, updated_at = ? WHERE id = ?').run(newVal, Date.now(), id);
    return { isPinned: Boolean(newVal) };
  });

  ipcMain.handle('documents:archive', (_, { id, archived }) => {
    const db = getDb();
    db.prepare('UPDATE documents SET is_archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, Date.now(), id);
    return { success: true };
  });

  ipcMain.handle('documents:move', (_, { id, parentId }) => {
    const db = getDb();
    db.prepare('UPDATE documents SET parent_id = ?, updated_at = ? WHERE id = ?').run(parentId || null, Date.now(), id);
    return { success: true };
  });

  ipcMain.handle('documents:search', (_, { workspaceId, query, mode = 'fts' }) => {
    const db = getDb();
    if (!query?.trim()) return [];

    if (mode === 'fts') {
      try {
        const terms = query.trim().split(/\s+/).filter(Boolean);
        const ftsQuery = terms.map(t => t.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '') + '*').filter(Boolean).join(' AND ');
        if (!ftsQuery) return [];
        return db.prepare(`
          SELECT d.id, d.title, d.word_count, d.updated_at, d.is_pinned, d.workspace_id, d.content_type,
                 snippet(documents_fts, 1, '<mark>', '</mark>', '...', 24) AS snippet,
                 bm25(documents_fts) AS rank
          FROM documents_fts
          JOIN documents d ON d.rowid = documents_fts.rowid
          WHERE documents_fts MATCH ?
            AND d.workspace_id = ? AND d.is_archived = 0 AND d.is_folder = 0
          ORDER BY rank LIMIT 40
        `).all(ftsQuery, workspaceId).map(r => ({
          id: r.id, title: r.title || '无标题', snippet: r.snippet || '',
          wordCount: r.word_count || 0, updatedAt: r.updated_at,
          isPinned: !!r.is_pinned, workspaceId: r.workspace_id,
          contentType: r.content_type || 'markdown', score: r.rank,
        }));
      } catch (ftsErr) {
        log.warn('[search] FTS failed, fallback:', ftsErr?.message);
      }
    }

    // LIKE fallback
    const q = `%${query}%`;
    return db.prepare(`
      SELECT d.id, d.title, d.word_count, d.updated_at, d.is_pinned, d.workspace_id, d.content_type,
             SUBSTR(dc.content, MAX(1, INSTR(LOWER(dc.content), LOWER(?)) - 60), 160) as snippet
      FROM documents d
      LEFT JOIN document_contents dc ON dc.document_id = d.id
      WHERE d.workspace_id = ? AND d.is_archived = 0 AND d.is_folder = 0
        AND (d.title LIKE ? OR dc.content LIKE ?)
      ORDER BY d.updated_at DESC LIMIT 40
    `).all(query, workspaceId, q, q).map(r => ({
      id: r.id, title: r.title || '无标题',
      snippet: r.snippet ? '...' + r.snippet.replace(/<[^>]+>/g, '') + '...' : '',
      wordCount: r.word_count || 0, updatedAt: r.updated_at,
      isPinned: !!r.is_pinned, workspaceId: r.workspace_id,
      contentType: r.content_type || 'markdown',
    }));
  });

  ipcMain.handle('documents:rebuild-fts', () => {
    try { rebuildFtsIndex(); return { ok: true }; }
    catch (err) { log.error('[rebuild-fts]', err); return { ok: false, error: err?.message }; }
  });

  ipcMain.handle('documents:versions', (_, { id }) => {
    const db = getDb();
    return db.prepare('SELECT * FROM document_versions WHERE document_id = ? ORDER BY created_at DESC LIMIT 50').all(id);
  });

  ipcMain.handle('documents:version-label', (_, { versionId, label }) => {
    const db = getDb();
    db.prepare('UPDATE document_versions SET label = ? WHERE id = ?').run(label, versionId);
    return { success: true };
  });

  ipcMain.handle('documents:backlinks', (_, { documentId, workspaceId }) => {
    const db = getDb();
    const doc = db.prepare('SELECT title FROM documents WHERE id = ? LIMIT 1').get(documentId);
    if (!doc) return [];
    return db.prepare(`
      SELECT d.id, d.title, d.updated_at, d.word_count
      FROM documents d
      JOIN document_contents dc ON dc.document_id = d.id
      WHERE d.workspace_id = ? AND d.id != ?
        AND (dc.content LIKE ? OR dc.content LIKE ?)
      ORDER BY d.updated_at DESC LIMIT 50
    `).all(workspaceId, documentId, `%[[${doc.title}]]%`, `%[[${documentId}]]%`)
      .map(r => ({ id: r.id, title: r.title, updatedAt: r.updated_at, wordCount: r.word_count }));
  });

  ipcMain.handle('documents:outlinks', (_, { documentId, workspaceId }) => {
    const db = getDb();
    const c = db.prepare('SELECT content FROM document_contents WHERE document_id = ?').get(documentId);
    if (!c?.content) return [];
    const matches = [...c.content.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1]);
    if (!matches.length) return [];
    const results = [];
    for (const ref of [...new Set(matches)]) {
      const row = db.prepare('SELECT id, title, updated_at, word_count FROM documents WHERE workspace_id = ? AND title = ? AND is_folder = 0 LIMIT 1').get(workspaceId, ref);
      if (row) results.push({ id: row.id, title: row.title, updatedAt: row.updated_at, wordCount: row.word_count });
    }
    return results;
  });

  ipcMain.handle('documents:upsert', (_, doc) => {
    const db = getDb();
    const now = doc.updatedAt ? new Date(doc.updatedAt).getTime() : Date.now();
    const created = doc.createdAt ? new Date(doc.createdAt).getTime() : now;
    try {
      db.prepare(`
        INSERT INTO documents (id, workspace_id, parent_id, title, content_type,
          is_folder, is_pinned, is_favorite, is_archived, word_count, char_count,
          sort_order, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          title=excluded.title, parent_id=excluded.parent_id,
          is_pinned=excluded.is_pinned, is_favorite=excluded.is_favorite,
          is_archived=excluded.is_archived, word_count=excluded.word_count,
          char_count=excluded.char_count, sort_order=excluded.sort_order,
          updated_at=excluded.updated_at
        WHERE excluded.updated_at > documents.updated_at
      `).run(
        doc.id, doc.workspaceId, doc.parentId || null, doc.title || '无标题',
        doc.contentType || 'markdown', doc.isFolder ? 1 : 0, doc.isPinned ? 1 : 0,
        doc.isFavorite ? 1 : 0, doc.isArchived ? 1 : 0, doc.wordCount || 0, doc.charCount || 0,
        doc.sortOrder || 0, created, now
      );
    } catch (err) { log.error('[documents:upsert]', err); }
    return { ok: true };
  });

  // 全局搜索（跨工作区）
  ipcMain.handle('documents:search-global', (_, { query }) => {
    const db = getDb();
    if (!query?.trim()) return [];
    try {
      const terms = query.trim().split(/\s+/).filter(Boolean);
      const ftsQuery = terms.map(t => t.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '') + '*').filter(Boolean).join(' AND ');
      if (!ftsQuery) return [];
      return db.prepare(`
        SELECT d.id, d.title, d.workspace_id, d.content_type, d.updated_at, d.word_count,
               snippet(documents_fts, 1, '<mark>', '</mark>', '...', 24) AS snippet,
               bm25(documents_fts) AS rank
        FROM documents_fts
        JOIN documents d ON d.rowid = documents_fts.rowid
        WHERE documents_fts MATCH ? AND d.is_archived = 0 AND d.is_folder = 0
        ORDER BY rank LIMIT 20
      `).all(ftsQuery).map(r => ({
        id: r.id, title: r.title || '无标题', snippet: r.snippet || '',
        workspaceId: r.workspace_id, contentType: r.content_type,
        updatedAt: r.updated_at, wordCount: r.word_count || 0,
      }));
    } catch (err) {
      log.warn('[search-global] FTS failed:', err?.message);
      return [];
    }
  });
}

function normalizeDocument(row) {
  return {
    id: row.id, title: row.title || '无标题', content: row.content || '',
    contentType: row.content_type || 'markdown', parentId: row.parent_id || null,
    workspaceId: row.workspace_id, isFolder: Boolean(row.is_folder),
    tags: row.tags_raw ? row.tags_raw.split(',').filter(Boolean) : [],
    isFavorite: Boolean(row.is_favorite), isPinned: Boolean(row.is_pinned),
    isArchived: Boolean(row.is_archived), wordCount: row.word_count || 0,
    charCount: row.char_count || 0, createdAt: row.created_at, updatedAt: row.updated_at,
    syncedAt: row.synced_at || null,
  };
}

function countWords(text) {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const cn = (plain.match(/[\u4e00-\u9fa5]/g) || []).length;
  const en = (plain.match(/\b[a-zA-Z]+\b/g) || []).length;
  return cn + en;
}

module.exports = { registerDocumentHandlers };
