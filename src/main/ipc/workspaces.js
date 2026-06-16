const log = require('electron-log');
const { ipcMain } = require('electron');
const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');

function registerWorkspaceHandlers() {
  ipcMain.handle('workspaces:list', () => {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all();
    // 同时返回 camelCase 字段，方便前端过滤
    const result = rows.map(w => ({
      ...w,
      orgId: w.org_id || null,
      ownerId: w.owner_id || null,
      isShared: w.is_shared === 1 || w.is_shared === true,
      createdAt: w.created_at,
      updatedAt: w.updated_at,
    }));
    log.info('[workspaces:list] returning', result.length, 'workspaces');
    return result;
  });

  ipcMain.handle('workspaces:get', (_, { id }) => {
    return getDb().prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
  });

  ipcMain.handle('workspaces:create', (_, { name, description = '', icon = '📁', color = '#c8a96e', profession = 'general' }) => {
    const id = uuidv4(), now = Date.now();
    getDb().prepare(`
      INSERT INTO workspaces (id, name, description, icon, color, profession, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description, icon, color, profession, now, now);
    log.info('[workspaces:create] id:', id);
    return { id, name, description, icon, color, profession, createdAt: now, updatedAt: now };
  });

  ipcMain.handle('workspaces:update', (_, { id, name, description, icon, color }) => {
    const now = Date.now();
    const parts = [], vals = [];
    if (name !== undefined) { parts.push('name = ?'); vals.push(name); }
    if (description !== undefined) { parts.push('description = ?'); vals.push(description); }
    if (icon !== undefined) { parts.push('icon = ?'); vals.push(icon); }
    if (color !== undefined) { parts.push('color = ?'); vals.push(color); }
    if (!parts.length) return { success: true };
    parts.push('updated_at = ?'); vals.push(now);
    getDb().prepare(`UPDATE workspaces SET ${parts.join(', ')} WHERE id = ?`).run(...vals, id);
    return { success: true };
  });

  ipcMain.handle('workspaces:delete', (_, { id }) => {
    getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    return { success: true };
  });

  // ── 组织工作区 ──────────────────────────────────────────────
  ipcMain.handle('workspaces:list-by-org', (_, { orgId }) => {
    return getDb().prepare('SELECT * FROM workspaces WHERE org_id = ? ORDER BY created_at ASC').all(orgId);
  });

  ipcMain.handle('workspaces:set-org', (_, { id, orgId, ownerId, isShared }) => {
    getDb().prepare(`
      UPDATE workspaces SET org_id = ?, owner_id = ?, is_shared = ?, updated_at = ?
      WHERE id = ?
    `).run(orgId || null, ownerId || null, isShared ? 1 : 0, Date.now(), id);
    return { success: true };
  });

  ipcMain.handle('workspaces:upsert', (_, ws) => {
    const now = ws.updatedAt ? new Date(ws.updatedAt).getTime() : Date.now();
    const created = ws.createdAt ? new Date(ws.createdAt).getTime() : now;
    getDb().prepare(`
      INSERT INTO workspaces (id, name, description, icon, color, profession, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description, icon=excluded.icon,
        color=excluded.color, profession=excluded.profession, updated_at=excluded.updated_at
      WHERE excluded.updated_at > workspaces.updated_at
    `).run(ws.id, ws.name, ws.description || '', ws.icon || '📁', ws.color || '#c8a96e', ws.profession || 'general', created, now);
    return { ok: true };
  });
}

module.exports = { registerWorkspaceHandlers };
