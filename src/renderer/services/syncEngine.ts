/**
 * syncEngine.ts — 本地 SQLite ↔ Supabase 双写同步引擎
 * src/renderer/services/syncEngine.ts
 *
 * 策略：
 * - 写操作：先写本地（立即返回），再异步写云端
 * - 读操作：优先本地，启动时拉取云端增量
 * - 离线：写操作进 pendingQueue，联网后批量同步
 * - 冲突：updated_at 较新的胜出
 */
import { supabase } from '../lib/supabase';
import { ipc } from '../utils/ipc';

// ── 类型 ─────────────────────────────────────────────────────────

interface PendingOp {
  id: string;
  type: 'upsert_document' | 'upsert_workspace' | 'delete_document' | 'update_content';
  payload: any;
  createdAt: number;
  retries: number;
}

// ── 状态 ─────────────────────────────────────────────────────────

let isOnline = navigator.onLine;
let syncInProgress = false;
const pendingQueue: PendingOp[] = [];
const STORAGE_KEY = 'qiwen_pending_sync_ops';
let statusListeners: ((status: SyncStatus) => void)[] = [];

export interface SyncStatus {
  isOnline: boolean;
  pendingCount: number;
  lastSyncAt: number | null;
  syncing: boolean;
}

// ── 初始化 ────────────────────────────────────────────────────────

export function initSyncEngine() {
  // 恢复未完成的操作队列
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) pendingQueue.push(...JSON.parse(saved));
  } catch {}

  // 网络状态监听
  window.addEventListener('online', () => {
    isOnline = true;
    notifyStatus();
    flushQueue();
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    notifyStatus();
  });

  // 登录状态监听 → 登录后立即全量同步
  supabase.auth.onAuthStateChange(async (event) => {
    if (event === 'SIGNED_IN') {
      await fullSync();
      flushQueue();
    }
  });

  // 每60秒增量同步一次
  setInterval(() => { if (isOnline) incrementalSync(); }, 60_000);

  console.log('[SyncEngine] initialized, pending ops:', pendingQueue.length);
}

// ── 公开 API ──────────────────────────────────────────────────────

/** 文档写操作：先写本地，再异步写云端 */
export async function syncWriteDocument(doc: {
  id: string; workspaceId: string; title: string; content?: string;
  contentType?: string; parentId?: string | null; isFolder?: boolean;
  isPinned?: boolean; isArchived?: boolean; wordCount?: number; updatedAt?: number;
}) {
  // 1. 写本地（已由 IPC handler 完成，这里只做云端部分）
  const op: PendingOp = {
    id: `doc_${doc.id}_${Date.now()}`,
    type: doc.content !== undefined ? 'update_content' : 'upsert_document',
    payload: doc,
    createdAt: Date.now(),
    retries: 0,
  };
  enqueue(op);
  if (isOnline) flushQueue();
}

/** 工作区写操作 */
export async function syncWriteWorkspace(ws: { id: string; name: string; icon?: string; color?: string; updatedAt?: number }) {
  enqueue({ id: `ws_${ws.id}_${Date.now()}`, type: 'upsert_workspace', payload: ws, createdAt: Date.now(), retries: 0 });
  if (isOnline) flushQueue();
}

/** 文档删除 */
export async function syncDeleteDocument(docId: string) {
  enqueue({ id: `del_${docId}_${Date.now()}`, type: 'delete_document', payload: { id: docId }, createdAt: Date.now(), retries: 0 });
  if (isOnline) flushQueue();
}

/** 订阅同步状态 */
export function onSyncStatus(cb: (status: SyncStatus) => void): () => void {
  statusListeners.push(cb);
  cb(getStatus());
  return () => { statusListeners = statusListeners.filter(l => l !== cb); };
}

export function getStatus(): SyncStatus {
  return {
    isOnline,
    pendingCount: pendingQueue.length,
    lastSyncAt: Number(localStorage.getItem('qiwen_last_sync_at')) || null,
    syncing: syncInProgress,
  };
}

// ── 全量同步（登录后首次）────────────────────────────────────────

async function fullSync() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  console.log('[SyncEngine] full sync start');
  syncInProgress = true; notifyStatus();

  try {
    // 拉取云端工作区
    const { data: cloudWs } = await supabase
      .from('workspaces')
      .select('*')
      .order('updated_at', { ascending: false });

    if (cloudWs) {
      for (const ws of cloudWs) {
        await ipc.invoke('workspaces:upsert', {
          id: ws.id, name: ws.name, description: ws.description,
          icon: ws.icon, color: ws.color, profession: ws.profession || 'general',
          createdAt: new Date(ws.created_at).getTime(),
          updatedAt: new Date(ws.updated_at).getTime(),
        });
      }
    }

    // 拉取云端文档列表（不含内容，按需加载）
    const { data: cloudDocs } = await supabase
      .from('documents')
      .select('id, workspace_id, parent_id, creator_id, title, content_type, is_folder, is_pinned, is_archived, word_count, sort_order, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(500);

    if (cloudDocs) {
      for (const doc of cloudDocs) {
        await ipc.invoke('documents:upsert', {
          id: doc.id, workspaceId: doc.workspace_id, parentId: doc.parent_id,
          title: doc.title, contentType: doc.content_type, isFolder: doc.is_folder,
          isPinned: doc.is_pinned, isArchived: doc.is_archived,
          wordCount: doc.word_count, sortOrder: doc.sort_order,
          createdAt: new Date(doc.created_at).getTime(),
          updatedAt: new Date(doc.updated_at).getTime(),
        });
      }
    }

    localStorage.setItem('qiwen_last_sync_at', Date.now().toString());
    console.log('[SyncEngine] full sync done, docs:', cloudDocs?.length || 0);
  } catch (e) {
    console.error('[SyncEngine] full sync failed:', e);
  } finally {
    syncInProgress = false; notifyStatus();
  }
}

// ── 增量同步（定时）──────────────────────────────────────────────

async function incrementalSync() {
  const lastSync = localStorage.getItem('qiwen_last_sync_at');
  if (!lastSync) { fullSync(); return; }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const since = new Date(Number(lastSync)).toISOString();
  const { data: updated } = await supabase
    .from('documents')
    .select('id, workspace_id, title, updated_at, is_archived')
    .gt('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (updated?.length) {
    for (const doc of updated) {
      await ipc.invoke('documents:upsert', {
        id: doc.id, workspaceId: doc.workspace_id, title: doc.title,
        isArchived: doc.is_archived,
        updatedAt: new Date(doc.updated_at).getTime(),
      });
    }
    console.log('[SyncEngine] incremental sync:', updated.length, 'docs');
  }
  localStorage.setItem('qiwen_last_sync_at', Date.now().toString());
}

// ── 队列处理 ──────────────────────────────────────────────────────

function enqueue(op: PendingOp) {
  pendingQueue.push(op);
  savePending();
  notifyStatus();
}

async function flushQueue() {
  if (syncInProgress || !isOnline || pendingQueue.length === 0) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  syncInProgress = true; notifyStatus();
  const toProcess = [...pendingQueue];

  for (const op of toProcess) {
    try {
      await executeOp(op, user.id);
      const idx = pendingQueue.indexOf(op);
      if (idx !== -1) pendingQueue.splice(idx, 1);
    } catch (e) {
      op.retries++;
      if (op.retries >= 5) {
        const idx = pendingQueue.indexOf(op);
        if (idx !== -1) pendingQueue.splice(idx, 1);
        console.error('[SyncEngine] op dropped after 5 retries:', op.type);
      }
    }
  }
  savePending();
  syncInProgress = false; notifyStatus();
}

async function executeOp(op: PendingOp, userId: string) {
  const p = op.payload;
  switch (op.type) {
    case 'upsert_document': {
      await supabase.from('documents').upsert({
        id: p.id, workspace_id: p.workspaceId, parent_id: p.parentId || null,
        creator_id: userId, title: p.title || '无标题',
        content_type: p.contentType || 'markdown', is_folder: p.isFolder || false,
        is_pinned: p.isPinned || false, is_archived: p.isArchived || false,
        word_count: p.wordCount || 0, sort_order: p.sortOrder || 0,
        updated_at: p.updatedAt ? new Date(p.updatedAt).toISOString() : new Date().toISOString(),
      }, { onConflict: 'id', ignoreDuplicates: false });
      break;
    }
    case 'update_content': {
      await supabase.from('documents').upsert({
        id: p.id, workspace_id: p.workspaceId, creator_id: userId,
        title: p.title || '无标题', word_count: p.wordCount || 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      await supabase.from('document_contents').upsert({
        document_id: p.id, content: p.content || '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'document_id' });
      break;
    }
    case 'upsert_workspace': {
      await supabase.from('workspaces').upsert({
        id: p.id, name: p.name, owner_id: userId,
        icon: p.icon || '📁', color: p.color || '#c8a96e',
        updated_at: p.updatedAt ? new Date(p.updatedAt).toISOString() : new Date().toISOString(),
      }, { onConflict: 'id' });
      break;
    }
    case 'delete_document': {
      await supabase.from('documents').delete().eq('id', p.id);
      break;
    }
  }
}

function savePending() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingQueue.slice(-200))); } catch {}
}

function notifyStatus() {
  const s = getStatus();
  statusListeners.forEach(cb => cb(s));
}
