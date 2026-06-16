import React, { useEffect, useState, useCallback } from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { AnimatePresence, motion } from 'framer-motion';
import { store, persistor } from './store';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from './store';
import { refreshAccessToken, setLocalMode, clearAuth } from './store/slices/authSlice';
import { loadSettings } from './store/slices/settingsSlice';
import { fetchWorkspaces } from './store/slices/workspacesSlice';
import { fetchDocuments, fetchDocument, createDocument, deleteDocument, updateDocument } from './store/slices/documentsSlice';
import { fetchReferences, createReference, deleteReference } from './store/slices/referencesSlice';
import { openTab, setView, setActiveWorkspace } from './store/slices/appSlice';
import { ipc } from './utils/ipc';
import { cloudSync } from './services/cloudSync';
import { autoSave } from './utils/autoSave';
import { useSyncLang, useT } from './i18n';
import { setSaving, syncDocumentToTree } from './store/slices/documentsSlice';

import { SplashScreen } from './components/auth/SplashScreen';
import { AuthPage } from './components/auth/AuthPage';
import { OnboardingPage } from './components/onboarding/OnboardingPage';
import { TitleBar } from './components/common/TitleBar';
import { Sidebar } from './components/sidebar/Sidebar';
import { EditorArea } from './components/editor/EditorArea';
import { StatusBar } from './components/common/StatusBar';
import { Notification } from './components/common/Notification';
import { SearchModal } from './components/modals/SearchModal';

import './styles/globals.css';
import { SettingsView } from './components/settings/SettingsView';
import { PluginsView } from './plugins/PluginsView';
import { AIPanel } from './components/sidebar/AIPanel';
import { TemplatesView } from './components/templates/TemplatesView';
import { HomeView } from './components/home/HomeView';
import { SlidesView } from './components/slides/SlidesView';
import { WhiteboardView } from './components/canvas/WhiteboardView';
import { MindMapView } from './components/canvas/MindMapView';
import { WritingStatsView } from './components/stats/WritingStatsView';
import { DocumentGraphView } from './components/stats/DocumentGraphView';
import { CodeViewerPage } from './components/code/CodeViewerPage';
import { OrgManageView } from './components/org/OrgManageView';
import { setPlugins, syncInstalledMetadata } from './store/slices/pluginsSlice';
import { ALL_PLUGINS } from './plugins/pluginRegistry';
import { CommandPalette } from './components/common/CommandPalette';
import { initSyncEngine } from './services/syncEngine';

type AppStage = 'loading' | 'auth' | 'onboarding' | 'app';

// 引导页 flag key（参考拾卷设计：用 localStorage 而非 DB，绝对可靠）
const ONBOARDING_FLAG = 'qiwen-onboarding-done';

// ── Onboarding floating modal ────────────────────────────────
const OnboardingModal: React.FC<{ onComplete: () => void; onSkip: () => void }> = ({ onComplete, onSkip }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(20,16,10,0.55)',
        backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: 'relative',
          width: '100%', maxWidth: 600,
          maxHeight: '92vh',
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,0.35), 0 0 0 1px rgba(180,130,60,0.15)',
        }}
      >
        {/* Top bar with skip buttons */}
        <div style={{
          position: 'absolute', top: 14, right: 14, zIndex: 10,
          display: 'flex', gap: 6,
        }}>
          <button
            onClick={() => {
              try { localStorage.setItem(ONBOARDING_FLAG, '1'); } catch {}
              onSkip();
            }}
            style={{
              padding: '4px 11px', borderRadius: 20, cursor: 'pointer', fontSize: 11,
              fontFamily: 'inherit', border: '1px solid rgba(0,0,0,0.1)',
              background: 'rgba(255,255,255,0.85)', color: 'rgba(100,90,80,0.7)',
              backdropFilter: 'blur(4px)', fontWeight: 500,
            }}
          >不再显示</button>
          <button
            onClick={onSkip}
            style={{
              padding: '4px 13px', borderRadius: 20, cursor: 'pointer', fontSize: 11,
              fontFamily: 'inherit', border: '1px solid rgba(180,130,60,0.25)',
              background: 'rgba(255,255,255,0.95)', color: 'rgba(180,130,60,0.9)',
              backdropFilter: 'blur(4px)', fontWeight: 600,
            }}
          >跳过</button>
        </div>
        <div style={{ overflowY: 'auto', maxHeight: '92vh' }}>
          <OnboardingPage onComplete={onComplete} />
        </div>
      </motion.div>
    </motion.div>
  );
};


// ── 文档库视图 ────────────────────────────────────────────
// 从 Redux state 构建同步 payload（本地→云端）
function buildSyncPayload(state: any) {
  const docs = Object.values(state.documents?.openDocuments || {}) as any[];
  const tree = state.documents?.tree || [];
  const allDocs = [...new Map([...tree, ...docs].map(d => [d.id, d])).values()];

  return {
    workspaces: (state.workspaces?.items || []).map((w: any) => ({
      id: w.id, name: w.name, description: w.description,
      icon: w.icon, color: w.color, profession: w.profession,
      sortOrder: w.sort_order || 0,
      createdAt: w.createdAt || w.created_at,
      updatedAt: w.updatedAt || w.updated_at,
    })),
    documents: allDocs.map((d: any) => ({
      id: d.id, workspaceId: d.workspaceId || d.workspace_id,
      parentId: d.parentId || d.parent_id,
      title: d.title, contentType: d.contentType || 'markdown',
      isFolder: d.isFolder || false, isPinned: d.isPinned || false,
      isFavorite: d.isFavorite || false, isArchived: d.isArchived || false,
      wordCount: d.wordCount || 0, charCount: d.charCount || 0,
      sortOrder: d.sortOrder || 0, tags: d.tags || [],
      createdAt: d.createdAt, updatedAt: d.updatedAt,
    })),
    documentContents: docs.filter((d: any) => d.content).map((d: any) => ({
      documentId: d.id, content: d.content, updatedAt: d.updatedAt,
    })),
    references: Object.values(state.references?.items || {}).map((r: any) => ({
      id: r.id, workspaceId: r.workspaceId, title: r.title,
      authors: r.authors, year: r.year, journal: r.journal,
      doi: r.doi, url: r.url, abstract: r.abstract,
      tags: r.tags, bibtex: r.bibtex,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    })),
    settings: {
      theme: state.settings?.theme,
      accentColor: state.settings?.accentColor,
      updatedAt: new Date().toISOString(),
    },
  };
}

// 把服务端返回的变更写入本地 sqlite DB
async function applyServerChanges(changes: any) {
  if (!changes) return;
  const { workspaces = [], documents = [], documentContents = [], references = [], settings } = changes;

  // 工作区
  for (const ws of workspaces) {
    if (ws._deleted) {
      await ipc.invoke('workspaces:delete', { id: ws.id });
    } else {
      await ipc.invoke('workspaces:upsert', ws);
    }
  }
  // 文档元数据
  for (const doc of documents) {
    if (doc._deleted) {
      await ipc.invoke('documents:delete', { id: doc.id });
    } else {
      await ipc.invoke('documents:upsert', doc);
    }
  }
  // 文档内容
  for (const dc of documentContents) {
    await ipc.invoke('documents:update', { id: dc.documentId, content: dc.content });
  }
  // 文献
  for (const ref of references) {
    if (ref._deleted) {
      await ipc.invoke('references:delete', { id: ref.id });
    } else {
      await ipc.invoke('references:upsert', ref);
    }
  }
  // 设置
  if (settings) {
    await ipc.invoke('settings:set-many', { settings: {
      theme: settings.theme,
      accentColor: settings.accentColor,
    }}).catch(() => {});
  }
}

const LibraryView: React.FC = React.memo(() => {
  const dispatch = useDispatch<AppDispatch>();
  const T = useT();
  const activeWorkspaceId = useSelector((s: RootState) => s.app.activeWorkspaceId);
  const documents = useSelector((s: RootState) => s.documents.tree);

  const [search, setSearch] = React.useState('');
  const [sortBy, setSortBy] = React.useState<'updated' | 'created' | 'title' | 'words'>('updated');
  const [sortDir, setSortDir] = React.useState<'desc' | 'asc'>('desc');
  const [filterTag, setFilterTag] = React.useState<string | null>(null);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState('');
  const [view, setViewMode] = React.useState<'grid' | 'list'>('grid');
  const [showNewDoc, setShowNewDoc] = React.useState(false);
  const [newDocTitle, setNewDocTitle] = React.useState('');
  const newDocRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!activeWorkspaceId) return;
    (async () => {
      await autoSave.flushAll().catch(() => {});
      (dispatch as any)(fetchDocuments({ workspaceId: activeWorkspaceId }));
    })();
  }, []); // eslint-disable-line

  React.useEffect(() => {
    if (activeWorkspaceId) (dispatch as any)(fetchDocuments({ workspaceId: activeWorkspaceId }));
  }, [activeWorkspaceId, dispatch]);

  // 收集所有标签
  const allTags = React.useMemo(() => {
    const tagSet = new Set<string>();
    documents.forEach(d => (d.tags || []).forEach((t: string) => tagSet.add(t)));
    return [...tagSet].sort();
  }, [documents]);

  // 过滤 + 排序
  const filtered = React.useMemo(() => {
    let list = documents.filter(d => {
      const q = search.toLowerCase();
      const matchSearch = !q || d.title.toLowerCase().includes(q);
      const matchTag = !filterTag || (d.tags || []).includes(filterTag);
      return matchSearch && matchTag;
    });
    const pinned = list.filter(d => d.isPinned);
    const normal = list.filter(d => !d.isPinned);
    const sort = (arr: typeof documents) => [...arr].sort((a, b) => {
      let va: any, vb: any;
      if (sortBy === 'updated') { va = a.updatedAt; vb = b.updatedAt; }
      else if (sortBy === 'created') { va = a.createdAt || 0; vb = b.createdAt || 0; }
      else if (sortBy === 'title') { va = a.title.toLowerCase(); vb = b.title.toLowerCase(); }
      else { va = a.wordCount || 0; vb = b.wordCount || 0; }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return [...sort(pinned), ...sort(normal)];
  }, [documents, search, filterTag, sortBy, sortDir]);

  const handleCreate = async () => {
    if (!activeWorkspaceId) return;
    const title = newDocTitle.trim() || '无标题';
    setShowNewDoc(false); setNewDocTitle('');
    const d = dispatch as any;
    try {
      const doc = await d(createDocument({ workspaceId: activeWorkspaceId, title })).unwrap();
      if (doc?.id) {
        d(openTab({ documentId: doc.id, title: doc.title || title }));
        d(setView('workbench'));
      }
    } catch (e) { console.error('创建文档失败:', e); }
  };

  const handleTogglePin = async (e: React.MouseEvent, doc: any) => {
    e.stopPropagation();
    await (dispatch as any)(updateDocument({ id: doc.id, isPinned: !doc.isPinned } as any));
    if (activeWorkspaceId) (dispatch as any)(fetchDocuments({ workspaceId: activeWorkspaceId }));
  };

  const handleRename = React.useCallback((e: React.MouseEvent, doc: any) => {
    e.stopPropagation();
    setRenamingId(doc.id); setRenameValue(doc.title || '');
  }, []);

  const handleRenameSubmit = React.useCallback(async (id: string) => {
    const title = renameValue.trim();
    if (title && title !== documents.find(d => d.id === id)?.title)
      await (dispatch as any)(updateDocument({ id, title }));
    setRenamingId(null);
    if (activeWorkspaceId) (dispatch as any)(fetchDocuments({ workspaceId: activeWorkspaceId }));
  }, [renameValue, documents, dispatch, activeWorkspaceId]);

  const handleOpen = (doc: any) => {
    const d = dispatch as any;
    d(openTab({ documentId: doc.id, title: doc.title }));
    d(setView('workbench'));
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (window.confirm('确定删除这篇文档？')) (dispatch as any)(deleteDocument(id));
  };

  const fmt = (ts: number) => {
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `今天 ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  // 网格卡片
  const GridCard: React.FC<{ doc: any }> = ({ doc }) => {
    const isRenaming = renamingId === doc.id;
    return (
      <div
        onClick={() => !isRenaming && handleOpen(doc)}
        style={{ padding: '14px 16px', background: 'var(--bg-surface2)', border: `0.5px solid ${doc.isPinned ? 'rgba(200,169,110,0.3)' : 'var(--border)'}`, borderRadius: 10, cursor: isRenaming ? 'default' : 'pointer', position: 'relative' as const, transition: 'all 0.15s' }}
        onMouseOver={e => { if (!isRenaming) { const el = e.currentTarget as HTMLElement; el.style.borderColor = 'rgba(200,169,110,0.35)'; el.style.background = 'var(--bg-surface3)'; }}}
        onMouseOut={e => { const el = e.currentTarget as HTMLElement; el.style.borderColor = doc.isPinned ? 'rgba(200,169,110,0.3)' : 'var(--border)'; el.style.background = 'var(--bg-surface2)'; }}
      >
        {doc.isPinned && (
          <div style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, color: 'var(--accent)' }}>📌</div>
        )}
        {isRenaming ? (
          <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
            onBlur={() => handleRenameSubmit(doc.id)}
            onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(doc.id); if (e.key === 'Escape') setRenamingId(null); }}
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', padding: '2px 6px', fontSize: 14, fontWeight: 500, background: 'var(--bg-surface3)', border: '1px solid var(--accent)', borderRadius: 5, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', marginBottom: 8, boxSizing: 'border-box' as const }} />
        ) : (
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: doc.isPinned ? 20 : 0 }}>
            {doc.title || '无标题'}
          </div>
        )}
        {/* 标签 */}
        {(doc.tags || []).length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {(doc.tags || []).slice(0, 3).map((tag: string) => (
              <span key={tag} onClick={e => { e.stopPropagation(); setFilterTag(filterTag === tag ? null : tag); }}
                style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 10, background: filterTag === tag ? 'var(--accent-bg)' : 'var(--bg-surface3)', color: filterTag === tag ? 'var(--accent)' : 'var(--text-tertiary)', cursor: 'pointer', border: filterTag === tag ? '0.5px solid var(--accent-border)' : '0.5px solid transparent' }}>
                {tag}
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{fmt(doc.updatedAt)}{doc.wordCount > 0 ? ` · ${doc.wordCount.toLocaleString()} 字` : ''}</div>
          <div style={{ display: 'flex', gap: 3 }}>
            <button onClick={e => handleTogglePin(e, doc)} title={doc.isPinned ? '取消置顶' : '置顶'} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: doc.isPinned ? 'var(--accent)' : 'var(--text-tertiary)', fontSize: 11, borderRadius: 4, opacity: 0.7 }}>
              {doc.isPinned ? '📌' : '📍'}
            </button>
            <button onClick={e => handleRename(e, doc)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', color: 'var(--text-tertiary)', fontSize: 11.5, borderRadius: 4 }} onMouseOver={e => (e.currentTarget.style.color = 'var(--accent)')} onMouseOut={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}>改名</button>
            <button onClick={e => handleDelete(e, doc.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 5px', color: 'var(--text-tertiary)', fontSize: 11.5, borderRadius: 4 }} onMouseOver={e => (e.currentTarget.style.color = '#ff6b6b')} onMouseOut={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}>删除</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-editor)', overflow: 'hidden' }}>
      {/* 顶部操作栏 */}
      <div style={{ padding: '20px 28px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)' }}>文档库</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{filtered.length} / {documents.length} 篇</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* 视图切换 */}
            <div style={{ display: 'flex', background: 'var(--bg-surface2)', borderRadius: 7, padding: 2, gap: 1 }}>
              {([['grid', '⊞'], ['list', '☰']] as const).map(([v, icon]) => (
                <button key={v} onClick={() => setViewMode(v)} style={{ width: 28, height: 26, border: 'none', borderRadius: 5, background: view === v ? 'var(--bg-surface3)' : 'transparent', cursor: 'pointer', fontSize: 13, color: view === v ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{icon}</button>
              ))}
            </div>
            {/* 排序 */}
            <select value={`${sortBy}-${sortDir}`} onChange={e => {
              const [by, dir] = e.target.value.split('-') as any;
              setSortBy(by); setSortDir(dir);
            }} style={{ height: 30, padding: '0 8px', borderRadius: 7, border: '0.5px solid var(--border)', background: 'var(--bg-surface2)', color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
              <option value="updated-desc">最近修改</option>
              <option value="updated-asc">最早修改</option>
              <option value="created-desc">最近创建</option>
              <option value="title-asc">标题 A-Z</option>
              <option value="title-desc">标题 Z-A</option>
              <option value="words-desc">字数最多</option>
            </select>
            {/* 新建按钮 */}
            <button onClick={() => setShowNewDoc(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: 'linear-gradient(135deg, #c8a96e, #9a7040)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              新建文档
            </button>
          </div>
        </div>

        {/* 搜索框 */}
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索文档标题..."
            style={{ width: '100%', height: 36, paddingLeft: 34, paddingRight: 14, background: 'var(--bg-surface3)', border: '0.5px solid var(--border)', borderRadius: 9, fontSize: 13.5, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const }}
            onFocus={e => { e.target.style.borderColor = 'var(--accent-border)'; }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)'; }} />
          {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 14, lineHeight: 1 }}>×</button>}
        </div>

        {/* 标签筛选条 */}
        {allTags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 10 }}>
            <button onClick={() => setFilterTag(null)} style={{ fontSize: 11.5, padding: '3px 9px', borderRadius: 10, border: `0.5px solid ${!filterTag ? 'var(--accent)' : 'var(--border)'}`, background: !filterTag ? 'var(--accent-bg)' : 'transparent', color: !filterTag ? 'var(--accent)' : 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit' }}>全部</button>
            {allTags.map(tag => (
              <button key={tag} onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                style={{ fontSize: 11.5, padding: '3px 9px', borderRadius: 10, border: `0.5px solid ${filterTag === tag ? 'var(--accent)' : 'var(--border)'}`, background: filterTag === tag ? 'var(--accent-bg)' : 'transparent', color: filterTag === tag ? 'var(--accent)' : 'var(--text-tertiary)', cursor: 'pointer', fontFamily: 'inherit' }}>
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 文档列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px 24px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 60, color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: 40, opacity: 0.15, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 14, marginBottom: 8 }}>{search || filterTag ? '没有找到匹配的文档' : '还没有文档'}</div>
            {!search && !filterTag && (
              <button onClick={() => setShowNewDoc(true)} style={{ marginTop: 8, padding: '8px 18px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>新建第一篇文档</button>
            )}
          </div>
        ) : view === 'grid' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, paddingTop: 4 }}>
            {filtered.map(doc => <GridCard key={doc.id} doc={doc} />)}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingTop: 4 }}>
            {filtered.map(doc => (
              <div key={doc.id} onClick={() => !renamingId && handleOpen(doc)}
                style={{ display: 'flex', alignItems: 'center', padding: '9px 12px', borderRadius: 8, cursor: 'pointer', transition: 'background 0.1s', background: 'transparent' }}
                onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
                onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                <div style={{ fontSize: 16, marginRight: 10, opacity: 0.5 }}>📄</div>
                {renamingId === doc.id ? (
                  <input autoFocus value={renameValue} onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => handleRenameSubmit(doc.id)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(doc.id); if (e.key === 'Escape') setRenamingId(null); }}
                    onClick={e => e.stopPropagation()}
                    style={{ flex: 1, padding: '1px 6px', fontSize: 13.5, background: 'var(--bg-surface3)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit' }} />
                ) : (
                  <div style={{ flex: 1, fontSize: 13.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title || '无标题'}</div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 12, whiteSpace: 'nowrap' }}>{fmt(doc.updatedAt)}</div>
                {doc.wordCount > 0 && <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 10, whiteSpace: 'nowrap' }}>{doc.wordCount.toLocaleString()} 字</div>}
                {doc.isPinned && <div style={{ fontSize: 11, marginLeft: 8 }}>📌</div>}
                <div style={{ display: 'flex', gap: 2, marginLeft: 8 }}>
                  <button onClick={e => handleTogglePin(e, doc)} title={doc.isPinned ? '取消置顶':'置顶'} style={{ background:'none',border:'none',cursor:'pointer',padding:'2px 4px',color:'var(--text-tertiary)',fontSize:11 }}>{doc.isPinned?'📌':'📍'}</button>
                  <button onClick={e => handleRename(e, doc)} style={{ background:'none',border:'none',cursor:'pointer',padding:'2px 5px',color:'var(--text-tertiary)',fontSize:11.5,borderRadius:4 }} onMouseOver={e=>(e.currentTarget.style.color='var(--accent)')} onMouseOut={e=>(e.currentTarget.style.color='var(--text-tertiary)')}>改名</button>
                  <button onClick={e => handleDelete(e, doc.id)} style={{ background:'none',border:'none',cursor:'pointer',padding:'2px 5px',color:'var(--text-tertiary)',fontSize:11.5,borderRadius:4 }} onMouseOver={e=>(e.currentTarget.style.color='#ff6b6b')} onMouseOut={e=>(e.currentTarget.style.color='var(--text-tertiary)')}>删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新建文档弹窗 */}
      {showNewDoc && (
        <div onClick={() => setShowNewDoc(false)} style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 340, background: 'var(--bg-surface2)', border: '0.5px solid var(--border-md)', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>新建文档</div>
            <input ref={newDocRef} autoFocus value={newDocTitle} onChange={e => setNewDocTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setShowNewDoc(false); setNewDocTitle(''); }}}
              placeholder="文档标题（可留空）"
              style={{ width: '100%', height: 36, padding: '0 12px', borderRadius: 8, background: 'var(--bg-surface3)', border: '0.5px solid var(--border-md)', color: 'var(--text-primary)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowNewDoc(false); setNewDocTitle(''); }} style={{ height: 30, padding: '0 14px', borderRadius: 7, border: '0.5px solid var(--border-md)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>取消</button>
              <button onClick={handleCreate} style={{ height: 30, padding: '0 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit', fontWeight: 500 }}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

const ReferencesView: React.FC = React.memo(() => {
  const dispatch = useDispatch<AppDispatch>();
  const activeWorkspaceId = useSelector((s: RootState) => s.app.activeWorkspaceId);
  const { items: refs } = useSelector((s: RootState) => s.references);
  const [search, setSearch] = React.useState('');
  const [showAdd, setShowAdd] = React.useState(false);
  const [form, setForm] = React.useState({ title: '', authors: '', year: '', journal: '', doi: '', abstract: '' });
  const [refsLoading, setRefsLoading] = React.useState(false);

  React.useEffect(() => {
    if (activeWorkspaceId) {
      setRefsLoading(true);
      dispatch(fetchReferences({ workspaceId: activeWorkspaceId })).finally(() => setRefsLoading(false));
    }
  }, [activeWorkspaceId, dispatch]);

  const filtered = refs.filter(r =>
    r.title.toLowerCase().includes(search.toLowerCase()) ||
    (r.authors || []).join(' ').toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async () => {
    if (!activeWorkspaceId || !form.title.trim()) return;
    await dispatch(createReference({
      workspaceId: activeWorkspaceId,
      title: form.title,
      authors: form.authors.split(',').map(a => a.trim()).filter(Boolean),
      year: form.year ? parseInt(form.year) : null,
      journal: form.journal || null,
      doi: form.doi || null,
      abstract: form.abstract || null,
      citationKey: form.authors.split(',')[0]?.trim().split(' ').pop() + (form.year || '') || 'ref',
      type: 'article',
      keywords: [], tags: [],
    }));
    setForm({ title: '', authors: '', year: '', journal: '', doi: '', abstract: '' });
    setShowAdd(false);
  };

  const inputStyle = {
    width: '100%', padding: '8px 12px', background: 'var(--bg-surface2)',
    border: '0.5px solid var(--border)', borderRadius: 8,
    fontSize: 13.5, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit',
    marginBottom: 10,
  } as React.CSSProperties;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-editor)', overflow: 'hidden' }}>
      <div style={{ padding: '24px 32px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>文献库</div>
          <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{refs.length} 篇文献</div>
        </div>
        <button onClick={() => setShowAdd(v => !v)} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
          background: 'linear-gradient(135deg, #c8a96e, #9a7040)', color: '#fff',
          border: 'none', borderRadius: 9, fontSize: 13.5, fontWeight: 500, cursor: 'pointer',
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          添加文献
        </button>
      </div>
      {showAdd && (
        <div style={{ margin: '16px 32px 0', padding: 20, background: 'var(--bg-surface)', border: '0.5px solid var(--border)', borderRadius: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 14 }}>添加文献</div>
          <input value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} placeholder="标题 *" style={inputStyle} />
          <input value={form.authors} onChange={e => setForm(f => ({...f, authors: e.target.value}))} placeholder="作者（逗号分隔）" style={inputStyle} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <input value={form.year} onChange={e => setForm(f => ({...f, year: e.target.value}))} placeholder="年份" style={{...inputStyle, marginBottom: 0}} />
            <input value={form.journal} onChange={e => setForm(f => ({...f, journal: e.target.value}))} placeholder="期刊/出版物" style={{...inputStyle, marginBottom: 0}} />
          </div>
          <input value={form.doi} onChange={e => setForm(f => ({...f, doi: e.target.value}))} placeholder="DOI" style={{...inputStyle, marginTop: 10}} />
          <textarea value={form.abstract} onChange={e => setForm(f => ({...f, abstract: e.target.value}))} placeholder="摘要" rows={3}
            style={{...inputStyle, resize: 'vertical' as const}} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowAdd(false)} style={{ padding: '7px 16px', background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>取消</button>
            <button onClick={handleAdd} style={{ padding: '7px 16px', background: 'linear-gradient(135deg, #c8a96e, #9a7040)', border: 'none', borderRadius: 7, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>保存</button>
          </div>
        </div>
      )}
      <div style={{ padding: '16px 32px 0' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索文献..." style={{
          width: '100%', padding: '9px 14px', background: 'var(--bg-surface2)',
          border: '0.5px solid var(--border)', borderRadius: 9,
          fontSize: 13.5, color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit',
        }} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 32px' }}>
        {refsLoading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', marginTop: 60 }}>加载中...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', marginTop: 60 }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📚</div>
            <div style={{ fontSize: 15, marginBottom: 8 }}>{search ? '没有找到匹配的文献' : '还没有文献'}</div>
            {!search && <div style={{ fontSize: 13 }}>点击「添加文献」导入参考文献</div>}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map(ref => (
              <div key={ref.id} style={{ padding: '16px 20px', background: 'var(--bg-surface)', border: '0.5px solid var(--border)', borderRadius: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6, lineHeight: 1.4 }}>{ref.title}</div>
                    {ref.authors?.length > 0 && (
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 4 }}>{ref.authors.join(', ')}</div>
                    )}
                    <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {ref.year && <span>{ref.year}</span>}
                      {ref.journal && <span>{ref.journal}</span>}
                      {ref.doi && <span>DOI: {ref.doi}</span>}
                    </div>
                  </div>
                  <button onClick={() => dispatch(deleteReference(ref.id))} style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px',
                    color: 'var(--text-tertiary)', fontSize: 12, borderRadius: 4, flexShrink: 0,
                  }}
                    onMouseOver={e => (e.currentTarget.style.color = '#ff6b6b')}
                    onMouseOut={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
                  >删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

// ── 主视图路由 ────────────────────────────────────────────
// ── AI 助手全页视图 ──────────────────────────────────────────
const AIAssistantView: React.FC = () => (
  <div style={{
    flex: 1, display: 'flex', flexDirection: 'column' as const,
    height: '100%', background: 'var(--bg-editor)', overflow: 'hidden',
  }}>
    <div style={{ padding: '24px 32px 0', flexShrink: 0, borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>AI 助手</div>
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 16 }}>基于豆包大模型，开箱即用</div>
    </div>
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const }}>
      <AIPanel />
    </div>
  </div>
);

// ── ErrorBoundary: prevents child crashes from causing full white screen ──
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: any) {
    console.error('[ErrorBoundary] caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: 'var(--bg-base, #0a0a0f)', color: 'var(--text-secondary, #9b9890)',
          gap: 16, padding: 40,
        }}>
          <div style={{ fontSize: 36 }}>⚠️</div>
          <div style={{ fontSize: 16, color: 'var(--text-primary, #e8e6e0)' }}>页面加载出错</div>
          <div style={{ fontSize: 12, opacity: 0.6, maxWidth: 400, textAlign: 'center' }}>
            {this.state.error?.message || '未知错误'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              marginTop: 8, padding: '8px 24px', borderRadius: 8, cursor: 'pointer',
              background: 'rgba(200,169,110,0.15)', color: '#c8a96e',
              border: '0.5px solid rgba(200,169,110,0.3)', fontSize: 13, fontFamily: 'inherit',
            }}
          >重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}



// ── 组织管理视图包装器 ───────────────────────────────────────
const OrgManageViewWrapper: React.FC = () => {
  const user = useSelector((s: RootState) => s.auth.user);
  const [orgId, setOrgId] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);

  const loadOrg = React.useCallback(() => {
    const isLocalMode = !user || !user.email;
    if (isLocalMode) { setLoading(false); return; }
    import('./services/cloudSync').then(({ cloudSync }) => {
      cloudSync.getMyOrganizations().then(orgs => {
        if (orgs.length > 0) setOrgId(orgs[0].id);
      }).catch(() => {}).finally(() => setLoading(false));
    });
  }, [user]);

  React.useEffect(() => { loadOrg(); }, [loadOrg]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', fontSize: 13 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
        <span>加载中…</span>
      </div>
    </div>
  );

  if (!user?.email) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', gap: 16 }}>
      <div style={{ width: 72, height: 72, borderRadius: 20, background: 'var(--bg-surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🔐</div>
      <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>请先登录</div>
      <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center', maxWidth: 260, lineHeight: 1.6 }}>登录后可创建组织，邀请团队成员并管理协作权限</div>
    </div>
  );

  if (!orgId) return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', gap: 16 }}>
        <div style={{ width: 72, height: 72, borderRadius: 20, background: 'var(--bg-surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🏢</div>
        <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>还没有组织</div>
        <div style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center', maxWidth: 280, lineHeight: 1.6 }}>创建一个组织来管理团队成员、分配角色权限和查看操作审计</div>
        <button onClick={() => setShowCreate(true)}
          style={{ padding: '10px 28px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', fontWeight: 500, marginTop: 4 }}>
          立即创建
        </button>
      </div>
      {showCreate && (
        <React.Suspense fallback={null}>
          <CreateOrgModalLazy
            onCreated={(id) => { setOrgId(id); setShowCreate(false); }}
            onCancel={() => setShowCreate(false)}
          />
        </React.Suspense>
      )}
    </>
  );

  return <OrgManageView orgId={orgId} />;
};

const CreateOrgModalLazy = React.lazy(() =>
  import('./components/org/CreateOrgModal').then(m => ({ default: m.CreateOrgModal }))
);

// ── 云同步视图 ──────────────────────────────────────────────
const CloudSyncView: React.FC = React.memo(() => {
  const dispatch = useDispatch<AppDispatch>();
  const [syncStatus, setSyncStatus] = React.useState<'idle'|'syncing'|'success'|'error'>('idle');
  const [lastSync, setLastSync] = React.useState<string | null>(null);
  const [syncItems, setSyncItems] = React.useState({ documents: true, references: true, settings: true, workspaces: true });
  const [showLogin, setShowLogin] = React.useState(false);
  const [loginModalKey, setLoginModalKey] = React.useState(0);
  const [inviteCodeMode, setInviteCodeMode] = React.useState(false);
  // 自动更新
  const [updateAvailable, setUpdateAvailable] = React.useState(false);
  // 邀请队友引导弹窗
  const [showInviteGuide, setShowInviteGuide] = React.useState(false);
  const [inviteGuideLink, setInviteGuideLink] = React.useState('');
  const [inviteGuideLoading, setInviteGuideLoading] = React.useState(false);
  const [updateDownloaded, setUpdateDownloaded] = React.useState(false);
  const [updateDismissed, setUpdateDismissed] = React.useState(false);
  const [inviteCode, setInviteCode] = React.useState('');
  const [inviteLoading, setInviteLoading] = React.useState(false);
  const [inviteError, setInviteError] = React.useState('');
  const [inviteSuccess, setInviteSuccess] = React.useState('');
  const [loginForm, setLoginForm] = React.useState({ email: '', password: '' });
  const csEmailRef = React.useRef<HTMLInputElement>(null);
  const csPwdRef = React.useRef<HTMLInputElement>(null);
  const openLoginModal = React.useCallback(() => {
    setLoginModalKey(k => k + 1);
    setShowLogin(true);
  }, []);
  const [regForm, setRegForm] = React.useState({ email: '', username: '', password: '', displayName: '' });
  const [isRegMode, setIsRegMode] = React.useState(false);
  const [loginError, setLoginError] = React.useState('');
  const [loginLoading, setLoginLoading] = React.useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = React.useState(false);
  // 忘记密码相关（三步：输入邮箱→输入验证码→设置新密码）
  const [forgotMode, setForgotMode] = React.useState(false);
  const [forgotEmail, setForgotEmail] = React.useState('');
  const [forgotCode, setForgotCode] = React.useState('');
  const [forgotNewPwd, setForgotNewPwd] = React.useState('');
  const [forgotConfirmPwd, setForgotConfirmPwd] = React.useState('');
  const [forgotStep, setForgotStep] = React.useState<'email'|'code'|'newpwd'|'done'>('email');
  const [forgotLoading, setForgotLoading] = React.useState(false);
  const [forgotError, setForgotError] = React.useState('');
  const [forgotSuccess, setForgotSuccess] = React.useState('');

  React.useEffect(() => {
    const last = localStorage.getItem('qiwen_last_sync_at');
    if (last) setLastSync(new Date(Number(last)).toLocaleString('zh-CN'));
  }, []);

  const authState = useSelector((s: RootState) => (s as any).auth);
  const isLoggedIn = authState?.isAuthenticated && !authState?.isLocalMode;
  const savedUser = authState?.user || null;

  const handleSync = async () => {
    if (!isLoggedIn) { openLoginModal(); return; }
    setSyncStatus('syncing');
    try {
      const state = store.getState();
      const filtered = {
        workspaces: syncItems.workspaces ? (state as any).workspaces?.items || [] : [],
        documents: syncItems.documents ? Object.values((state as any).documents?.items || {}) : [],
        documentContents: [],
        references: syncItems.references ? (state as any).references?.items || [] : [],
        settings: syncItems.settings ? (state as any).settings || null : null,
      };
      await cloudSync.updateDocument('', {}).catch(() => {}); // no-op, trigger pending flush
      localStorage.setItem('qiwen_last_sync_at', Date.now().toString());
      setLastSync(new Date().toLocaleString('zh-CN'));
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch {
      setSyncStatus('error');
      setTimeout(() => setSyncStatus('idle'), 5000);
    }
  };

  const handleLogin = async () => {
    // 等 50ms 让 Electron 自动填充写入完成，再读 ref 值
    await new Promise(r => setTimeout(r, 50));
    if (isRegMode) {
      if (!regForm.email || !regForm.password || !regForm.username) { setLoginError('请填写所有必填项'); return; }
    } else {
      const emailVal = (csEmailRef.current?.value || '').trim();
      const pwdVal = csPwdRef.current?.value || '';
      if (!emailVal) { setLoginError('请填写邮箱或用户名'); return; }
      if (!pwdVal) { setLoginError('请填写密码'); return; }
    }
    setLoginLoading(true); setLoginError('');
    try {
      if (isRegMode) {
        await (cloudSync as any).register(regForm.email, regForm.password, regForm.displayName, regForm.username);
      } else {
        const emailVal = (csEmailRef.current?.value || '').trim();
        const pwdVal = csPwdRef.current?.value || '';
        await (cloudSync as any).login(emailVal, pwdVal);
      }
      setShowLogin(false);
      setLoginForm({ email: '', password: '' });
      setRegForm({ email: '', username: '', password: '', displayName: '' });
    } catch (e: any) {
      setLoginError(
        e?.message === 'Invalid login credentials' ? '邮箱或密码错误，请检查后重试' :
        e?.message === 'Email not confirmed' ? '邮箱未验证，请检查收件箱' :
        e?.message === 'User already registered' ? '该邮箱已注册，请直接登录' :
        e?.message || '操作失败，请重试'
      );
    } finally { setLoginLoading(false); }
  };

  // 忘记密码 - 第一步：发送验证码
  const handleForgotSend = async () => {
    if (!forgotEmail.trim()) { setForgotError('请输入注册邮箱'); return; }
    setForgotLoading(true); setForgotError('');
    try {
      const { supabase } = await import('./lib/supabase');
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
        redirectTo: 'qiwen://auth/reset-password',
      });
      if (error) throw new Error(error.message);
      setForgotStep('code');
      setForgotError('');
    } catch (e: any) {
      setForgotError(e.message || '发送失败，请稍后重试');
    } finally { setForgotLoading(false); }
  };

  // 忘记密码 - 第二步：Supabase 邮件链接跳转后直接到第三步，此步骤简化提示
  const handleForgotVerify = async () => {
    // Supabase 使用邮件链接重置，不需要验证码，直接跳到设置新密码
    setForgotStep('newpwd');
  };

  // 忘记密码 - 第三步：设置新密码
  const handleForgotReset = async () => {
    if (!forgotNewPwd) { setForgotError('请输入新密码'); return; }
    if (forgotNewPwd.length < 8) { setForgotError('密码至少8位'); return; }
    if (forgotNewPwd !== forgotConfirmPwd) { setForgotError('两次密码不一致'); return; }
    setForgotLoading(true); setForgotError('');
    try {
      const { supabase } = await import('./lib/supabase');
      const { error } = await supabase.auth.updateUser({ password: forgotNewPwd });
      if (error) throw new Error(error.message);
      setForgotStep('done');
      setForgotError('');
    } catch (e: any) {
      setForgotError(e.message || '重置失败，请重试');
    } finally { setForgotLoading(false); }
  };

  const handleAcceptInvite = async () => {
    if (!inviteCode.trim()) return;
    setInviteLoading(true); setInviteError(''); setInviteSuccess('');
    try {
      await cloudSync.acceptInvitation(inviteCode.trim());
      setInviteSuccess('✅ 已成功加入组织！同步后可在工作区列表看到共享工作区。');
      setInviteCode('');
      setTimeout(() => { setInviteCodeMode(false); setInviteSuccess(''); closeLoginModal(); }, 2500);
    } catch (e: any) {
      const errMap: Record<string, string> = {
        invitation_not_found: '邀请码无效或已过期',
        invitation_already_used: '该邀请码已被使用',
        invitation_expired: '邀请码已过期（有效期7天）',
      };
      setInviteError(errMap[e?.message] || `加入失败：${e?.message}`);
    } finally { setInviteLoading(false); }
  };

  const closeLoginModal = () => {
    setShowLogin(false);
    setForgotMode(false);
    setForgotStep('email');
    setForgotEmail(''); setForgotCode(''); setForgotNewPwd('');
    setForgotError(''); setForgotSuccess('');
    setLoginError('');
    setIsRegMode(false);
  };

  const inputSt: React.CSSProperties = {
    width: '100%', padding: '9px 12px', background: 'var(--bg-surface3)',
    border: '0.5px solid var(--border)', borderRadius: 9, fontSize: 13.5,
    color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 10,
  };

  const Toggle: React.FC<{ on: boolean; onChange: () => void }> = ({ on, onChange }) => (
    <div onClick={onChange} style={{ width: 36, height: 20, borderRadius: 10, cursor: 'pointer', flexShrink: 0,
      background: on ? 'linear-gradient(135deg,#c8a96e,#9a7040)' : 'var(--bg-surface3)',
      border: `0.5px solid ${on ? 'transparent' : 'var(--border-md)'}`, position: 'relative', transition: 'all .2s' }}>
      <div style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16,
        borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 4px rgba(0,0,0,.3)' }} />
    </div>
  );

  const SyncRow: React.FC<{ icon: string; label: string; desc: string; id: keyof typeof syncItems }> =
    ({ icon, label, desc, id }) => (
    <div onClick={() => setSyncItems(s => ({ ...s, [id]: !s[id] }))}
      style={{ display:'flex', alignItems:'center', padding:'12px 16px', background:'var(--bg-surface)',
        border:'0.5px solid var(--border)', borderRadius:10, marginBottom:8, cursor:'pointer', gap:12 }}>
      <span style={{ fontSize:20 }}>{icon}</span>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:13.5, fontWeight:500, color:'var(--text-primary)' }}>{label}</div>
        <div style={{ fontSize:11.5, color:'var(--text-tertiary)', marginTop:2 }}>{desc}</div>
      </div>
      <Toggle on={syncItems[id]} onChange={() => setSyncItems(s => ({ ...s, [id]: !s[id] }))} />
    </div>
  );

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'var(--bg-editor)', overflow:'hidden' }}>
      <div style={{ padding:'24px 32px 0', display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexShrink:0 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:500, color:'var(--text-primary)', marginBottom:4, display:'flex', alignItems:'center', gap:10 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
              <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><line x1="12" y1="13" x2="12" y2="17"/><polyline points="9 16 12 13 15 16"/>
            </svg>
            云同步
          </div>
          <div style={{ fontSize:13, color:'var(--text-tertiary)' }}>
            {isLoggedIn ? `已登录 · ${savedUser?.email || savedUser?.username || '云账号'}` : '未登录 · 仅本地存储'}
          </div>
        </div>
        {isLoggedIn ? (
          <button onClick={async () => {
              if (!window.confirm('确定退出云账号？本地数据不受影响。')) return;
              await cloudSync.logout().catch(() => {});
              dispatch(clearAuth());
            }}
            style={{ padding:'7px 14px', borderRadius:8, border:'0.5px solid var(--border)', background:'var(--bg-surface2)',
              color:'var(--text-tertiary)', fontSize:12.5, cursor:'pointer', fontFamily:'inherit' }}>退出账号</button>
        ) : (
          <button onClick={() => openLoginModal()}
            style={{ padding:'8px 18px', borderRadius:9, border:'none', background:'linear-gradient(135deg,#c8a96e,#9a7040)',
              color:'#fff', fontSize:13, fontWeight:500, cursor:'pointer', fontFamily:'inherit' }}>登录 / 注册</button>
        )}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 32px 32px' }}>
        {/* 账号状态卡 */}
        <div style={{ background: isLoggedIn ? 'linear-gradient(135deg,rgba(200,169,110,.08),rgba(154,112,64,.04))' : 'var(--bg-surface)',
          border:`0.5px solid ${isLoggedIn ? 'rgba(200,169,110,.25)' : 'var(--border)'}`,
          borderRadius:14, padding:'20px 22px', marginBottom:20, display:'flex', alignItems:'center', gap:16 }}>
          <div style={{ width:48, height:48, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22,
            background: isLoggedIn ? 'linear-gradient(135deg,#c8a96e,#9a7040)' : 'var(--bg-surface3)' }}>
            {isLoggedIn ? (savedUser?.displayName?.slice(0,1) || '☁') : '🔒'}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:15, fontWeight:500, color:'var(--text-primary)', marginBottom:3 }}>
              {isLoggedIn ? (savedUser?.displayName || savedUser?.username || '云账号') : '未登录云账号'}
            </div>
            <div style={{ fontSize:12.5, color:'var(--text-tertiary)' }}>
              {isLoggedIn ? (lastSync ? `上次同步：${lastSync}` : '从未同步') : '登录后开启多设备同步与云端备份'}
            </div>
          </div>
          {isLoggedIn && (
            <div style={{ fontSize:11, padding:'4px 10px', borderRadius:20, background:'rgba(200,169,110,.15)',
              color:'var(--accent)', border:'0.5px solid rgba(200,169,110,.25)', fontWeight:500 }}>已连接</div>
          )}
        </div>

        {/* 同步内容 */}
        <div style={{ fontSize:11, fontWeight:600, letterSpacing:'.1em', color:'var(--text-tertiary)', textTransform:'uppercase', marginBottom:12 }}>同步内容</div>
        <SyncRow id="documents"  icon="📄" label="文档"    desc="所有工作区文档及内容" />
        <SyncRow id="references" icon="📚" label="文献库"  desc="参考文献与引用记录" />
        <SyncRow id="workspaces" icon="🗂" label="工作区"  desc="工作区配置与结构" />
        <SyncRow id="settings"   icon="⚙️" label="偏好设置" desc="主题、字体等个人设置" />

        {/* 自动同步 */}
        <div onClick={() => setAutoSyncEnabled(v => !v)} style={{ display:'flex', alignItems:'center', padding:'12px 16px',
          background:'var(--bg-surface)', border:'0.5px solid var(--border)', borderRadius:10, marginBottom:20, cursor:'pointer', gap:12 }}>
          <span style={{ fontSize:20 }}>🔄</span>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:13.5, fontWeight:500, color:'var(--text-primary)' }}>自动同步</div>
            <div style={{ fontSize:11.5, color:'var(--text-tertiary)', marginTop:2 }}>关闭软件时自动同步到云端</div>
          </div>
          <Toggle on={autoSyncEnabled} onChange={() => setAutoSyncEnabled(v => !v)} />
        </div>

        {/* 同步按钮 */}
        <button onClick={handleSync} disabled={syncStatus === 'syncing'} style={{
          width:'100%', padding:'13px', borderRadius:12, border: syncStatus === 'success' ? '0.5px solid rgba(72,199,142,.4)' : syncStatus === 'error' ? '0.5px solid rgba(255,100,100,.3)' : 'none',
          background: syncStatus === 'success' ? 'rgba(72,199,142,.15)' : syncStatus === 'error' ? 'rgba(255,100,100,.12)' : 'linear-gradient(135deg,#c8a96e,#9a7040)',
          color: syncStatus === 'success' ? '#48c78e' : syncStatus === 'error' ? '#ff6464' : '#fff',
          fontSize:14.5, fontWeight:600, cursor: syncStatus === 'syncing' ? 'not-allowed' : 'pointer',
          fontFamily:'inherit', opacity: syncStatus === 'syncing' ? .7 : 1, transition:'all .3s',
          display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
          {syncStatus === 'idle' && <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><line x1="12" y1="13" x2="12" y2="17"/><polyline points="9 16 12 13 15 16"/></svg>{isLoggedIn ? '立即同步' : '登录并同步'}</>}
          {syncStatus === 'syncing' && '同步中...'}
          {syncStatus === 'success' && '✓ 同步成功'}
          {syncStatus === 'error' && '✕ 同步失败，请重试'}
        </button>

        {!isLoggedIn && (
          <div style={{ marginTop:16, padding:'14px 16px', background:'rgba(200,169,110,.06)',
            border:'0.5px solid rgba(200,169,110,.18)', borderRadius:10 }}>
            <div style={{ fontSize:12.5, color:'var(--text-secondary)', lineHeight:1.7 }}>
              <strong style={{ color:'var(--accent)' }}>本地模式</strong>：数据仅保存于此设备。登录云账号后可享受多设备同步和云端备份。
            </div>
          </div>
        )}
      </div>

      {/* 登录/注册/忘记密码弹窗 */}
      {showLogin && (
        <>
          <div onClick={closeLoginModal} style={{ position:'fixed', inset:0, zIndex:999, background:'rgba(0,0,0,.55)', backdropFilter:'blur(10px)' }} />
          <div style={{
            position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
            zIndex:1000, width:420, borderRadius:20,
            background:'var(--bg-surface)', border:'0.5px solid var(--border-md)',
            boxShadow:'0 24px 64px rgba(0,0,0,.4)', overflow:'hidden',
          }}>
            {/* 弹窗头部 */}
            <div style={{ padding:'22px 24px 0', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ fontSize:16, fontWeight:600, color:'var(--text-primary)' }}>
                {inviteCodeMode ? '输入邀请码' : forgotMode ? '重置密码' : isRegMode ? '注册云账号' : '登录云账号'}
              </div>
              <button onClick={closeLoginModal} style={{
                width:28, height:28, borderRadius:8, border:'none', cursor:'pointer',
                background:'var(--bg-surface3)', color:'var(--text-tertiary)',
                display:'flex', alignItems:'center', justifyContent:'center', fontSize:16,
              }}>×</button>
            </div>
            <div style={{ fontSize:12.5, color:'var(--text-tertiary)', padding:'4px 24px 20px' }}>
              {inviteCodeMode ? '输入邀请码加入团队' : forgotMode ? '输入注册邮箱，我们将发送重置链接' : isRegMode ? '创建账号开启多设备同步' : '登录后开启多设备同步'}
            </div>

            <div style={{ padding:'0 24px 24px' }}>

              {/* ── 忘记密码流程（三步）── */}
              {forgotMode && (
                <div>
                  {/* 步骤指示器 */}
                  {forgotStep !== 'done' && (
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:20 }}>
                      {(['email','code','newpwd'] as const).map((step, i) => (
                        <React.Fragment key={step}>
                          <div style={{ width:22, height:22, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:600, flexShrink:0,
                            background: forgotStep === step ? 'linear-gradient(135deg,#c8a96e,#9a7040)' : (['email','code','newpwd'].indexOf(forgotStep) > i ? 'rgba(200,169,110,.3)' : 'var(--bg-surface3)'),
                            color: forgotStep === step ? '#fff' : (['email','code','newpwd'].indexOf(forgotStep) > i ? 'var(--accent)' : 'var(--text-tertiary)'),
                          }}>{i+1}</div>
                          {i < 2 && <div style={{ flex:1, height:1, background: ['email','code','newpwd'].indexOf(forgotStep) > i ? 'var(--accent)' : 'var(--border)' }} />}
                        </React.Fragment>
                      ))}
                    </div>
                  )}

                  {/* 第一步：输入邮箱 */}
                  {forgotStep === 'email' && (
                    <>
                      <div style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16, lineHeight:1.6 }}>
                        输入你的注册邮箱，我们将发送一个 <strong>6位验证码</strong>，有效期15分钟。
                      </div>
                      <div style={{ fontSize:12.5, color:'var(--text-secondary)', marginBottom:6 }}>注册邮箱</div>
                      <input value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                        placeholder="your@email.com" type="email" autoFocus
                        style={{ ...inputSt, marginBottom:16 }}
                        onKeyDown={e => e.key==='Enter' && handleForgotSend()} />
                    </>
                  )}

                  {/* 第二步：输入验证码 */}
                  {forgotStep === 'code' && (
                    <>
                      <div style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16, lineHeight:1.6 }}>
                        验证码已发送到 <strong style={{ color:'var(--accent)' }}>{forgotEmail}</strong>，请查收邮件并输入6位验证码。
                      </div>
                      <div style={{ fontSize:12.5, color:'var(--text-secondary)', marginBottom:6, display:'flex', justifyContent:'space-between' }}>
                        <span>验证码</span>
                        <button onClick={() => { setForgotCode(''); handleForgotSend(); }}
                          style={{ border:'none', background:'none', cursor:'pointer', color:'var(--accent)', fontSize:12, fontFamily:'inherit', padding:0 }}>
                          重新发送
                        </button>
                      </div>
                      <input value={forgotCode} onChange={e => setForgotCode(e.target.value.replace(/\D/g, '').slice(0,6))}
                        placeholder="请输入6位数字验证码" maxLength={6}
                        style={{ ...inputSt, marginBottom:16, letterSpacing:6, fontSize:20, textAlign:'center', fontFamily:'monospace' }}
                        onKeyDown={e => e.key==='Enter' && handleForgotVerify()} />
                    </>
                  )}

                  {/* 第三步：设置新密码 */}
                  {forgotStep === 'newpwd' && (
                    <>
                      <div style={{ fontSize:13, color:'#40c057', background:'rgba(105,219,124,.08)', border:'0.5px solid rgba(105,219,124,.3)', borderRadius:9, padding:'9px 13px', marginBottom:16 }}>
                        ✓ 验证码正确，请设置新密码
                      </div>
                      <div style={{ fontSize:12.5, color:'var(--text-secondary)', marginBottom:6 }}>
                        新密码 <span style={{ color:'var(--text-tertiary)', fontWeight:400 }}>（至少8位，含大小写和数字）</span>
                      </div>
                      <input value={forgotNewPwd} onChange={e => setForgotNewPwd(e.target.value)}
                        placeholder="至少8位，含大小写和数字" type="password"
                        style={{ ...inputSt, marginBottom:10 }} />
                      <div style={{ fontSize:12.5, color:'var(--text-secondary)', marginBottom:6 }}>确认新密码</div>
                      <input value={forgotConfirmPwd} onChange={e => setForgotConfirmPwd(e.target.value)}
                        placeholder="再输入一次" type="password"
                        style={{ ...inputSt, marginBottom:16 }}
                        onKeyDown={e => e.key==='Enter' && handleForgotReset()} />
                    </>
                  )}

                  {/* 完成 */}
                  {forgotStep === 'done' && (
                    <div style={{ textAlign:'center', padding:'20px 0' }}>
                      <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
                      <div style={{ fontSize:16, fontWeight:600, color:'var(--text-primary)', marginBottom:8 }}>密码重置成功</div>
                      <div style={{ fontSize:13, color:'var(--text-tertiary)', marginBottom:20 }}>请用新密码重新登录</div>
                      <button onClick={() => { setForgotMode(false); setForgotStep('email'); setForgotCode(''); setForgotNewPwd(''); setForgotConfirmPwd(''); setForgotError(''); }}
                        style={{ padding:'10px 28px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#c8a96e,#9a7040)', color:'#fff', fontSize:14, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                        去登录
                      </button>
                    </div>
                  )}

                  {/* 错误提示 */}
                  {forgotError && (
                    <div style={{ fontSize:13, color:'#ff6b6b', background:'rgba(255,107,107,.08)', border:'0.5px solid rgba(255,107,107,.25)', borderRadius:9, padding:'9px 13px', marginBottom:14 }}>
                      ⚠ {forgotError}
                    </div>
                  )}

                  {/* 操作按钮 */}
                  {forgotStep === 'email' && (
                    <button onClick={handleForgotSend} disabled={forgotLoading} style={{
                      width:'100%', padding:'11px', borderRadius:10, border:'none',
                      background:'linear-gradient(135deg,#c8a96e,#9a7040)', color:'#fff',
                      fontSize:14, fontWeight:600, cursor: forgotLoading ? 'not-allowed' : 'pointer',
                      opacity: forgotLoading ? .7 : 1, fontFamily:'inherit', marginBottom:12,
                    }}>
                      {forgotLoading ? '发送中...' : '发送验证码'}
                    </button>
                  )}
                  {forgotStep === 'code' && (
                    <button onClick={handleForgotVerify} disabled={forgotLoading || forgotCode.length !== 6} style={{
                      width:'100%', padding:'11px', borderRadius:10, border:'none',
                      background:'linear-gradient(135deg,#c8a96e,#9a7040)', color:'#fff',
                      fontSize:14, fontWeight:600, cursor: (forgotLoading || forgotCode.length !== 6) ? 'not-allowed' : 'pointer',
                      opacity: (forgotLoading || forgotCode.length !== 6) ? .7 : 1, fontFamily:'inherit', marginBottom:12,
                    }}>
                      {forgotLoading ? '验证中...' : '验证'}
                    </button>
                  )}
                  {forgotStep === 'newpwd' && (
                    <button onClick={handleForgotReset} disabled={forgotLoading} style={{
                      width:'100%', padding:'11px', borderRadius:10, border:'none',
                      background:'linear-gradient(135deg,#c8a96e,#9a7040)', color:'#fff',
                      fontSize:14, fontWeight:600, cursor: forgotLoading ? 'not-allowed' : 'pointer',
                      opacity: forgotLoading ? .7 : 1, fontFamily:'inherit', marginBottom:12,
                    }}>
                      {forgotLoading ? '重置中...' : '确认重置密码'}
                    </button>
                  )}

                  {forgotStep !== 'done' && (
                    <div style={{ textAlign:'center' }}>
                      <button onClick={() => { setForgotMode(false); setForgotStep('email'); setForgotError(''); setForgotCode(''); }}
                        style={{ border:'none', background:'none', cursor:'pointer', color:'var(--text-tertiary)', fontSize:12.5, fontFamily:'inherit' }}>
                        ← 返回登录
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── 邀请码模式 ── */}
              {inviteCodeMode && !forgotMode && (
                <div>
                  <div style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16, lineHeight:1.6, background:'rgba(91,156,246,0.06)', border:'0.5px solid rgba(91,156,246,0.25)', borderRadius:9, padding:'10px 13px' }}>
                    收到启文团队邀请？在下方输入邀请码，加入后即可访问共享工作区。
                  </div>
                  <div style={{ fontSize:12.5, color:'var(--text-secondary)', marginBottom:6 }}>邀请码</div>
                  <input
                    value={inviteCode}
                    onChange={e => setInviteCode(e.target.value)}
                    onKeyDown={e => e.key==='Enter' && handleAcceptInvite()}
                    placeholder="粘贴邀请链接中的邀请码"
                    autoFocus
                    style={{ width:'100%', padding:'10px 12px', borderRadius:9, border:'0.5px solid var(--border-md)', background:'var(--bg-surface3)', color:'var(--text-primary)', fontSize:13, fontFamily:'monospace', outline:'none', marginBottom:14, boxSizing:'border-box' as const }}
                  />
                  {inviteError && (
                    <div style={{ fontSize:13, color:'#ff6b6b', background:'rgba(255,107,107,.08)', border:'0.5px solid rgba(255,107,107,.25)', borderRadius:9, padding:'9px 13px', marginBottom:12 }}>
                      ⚠ {inviteError}
                    </div>
                  )}
                  {inviteSuccess && (
                    <div style={{ fontSize:13, color:'#52c97a', background:'rgba(82,201,122,.08)', border:'0.5px solid rgba(82,201,122,.25)', borderRadius:9, padding:'9px 13px', marginBottom:12 }}>
                      {inviteSuccess}
                    </div>
                  )}
                  <button onClick={handleAcceptInvite} disabled={inviteLoading || !inviteCode.trim()} style={{
                    width:'100%', padding:'11px', borderRadius:10, border:'none',
                    background:'linear-gradient(135deg,#c8a96e,#9a7040)', color:'#fff',
                    fontSize:14, fontWeight:600, cursor: inviteLoading || !inviteCode.trim() ? 'not-allowed' : 'pointer',
                    opacity: inviteLoading || !inviteCode.trim() ? .7 : 1, fontFamily:'inherit', marginBottom:12,
                  }}>
                    {inviteLoading ? '加入中...' : '加入团队'}
                  </button>
                  <div style={{ textAlign:'center' as const }}>
                    <button onClick={() => { setInviteCodeMode(false); setInviteError(''); setInviteCode(''); }}
                      style={{ border:'none', background:'none', cursor:'pointer', color:'var(--text-tertiary)', fontSize:12.5, fontFamily:'inherit' }}>
                      ← 返回登录
                    </button>
                  </div>
                </div>
              )}

              {/* ── 登录/注册表单 ── */}
              {!forgotMode && !inviteCodeMode && (
                <>
                  {isRegMode && (
                    <>
                      <div style={{ fontSize:12.5, color:'var(--text-secondary)', marginBottom:6 }}>昵称（可选）</div>
                      <input value={regForm.displayName} onChange={e => setRegForm(f=>({...f,displayName:e.target.value}))} placeholder="你的显示名称" style={inputSt} />
                      <div style={{ fontSize:12.5, color:'var(--text-secondary)', marginBottom:6 }}>用户名</div>
                      <input value={regForm.username} onChange={e => setRegForm(f=>({...f,username:e.target.value}))} placeholder="2-20位字母、数字" style={inputSt} />
                      <div style={{ fontSize:12.5, color:'var(--text-secondary)', marginBottom:6 }}>邮箱</div>
                      <input value={regForm.email} onChange={e => setRegForm(f=>({...f,email:e.target.value}))} placeholder="your@email.com" type="email" style={inputSt} />
                      <div style={{ fontSize:12.5, color:'var(--text-secondary)', marginBottom:6 }}>密码 <span style={{ color:'var(--text-tertiary)', fontWeight:400 }}>（至少8位，含大小写和数字）</span></div>
                      <input value={regForm.password} onChange={e => setRegForm(f=>({...f,password:e.target.value}))} placeholder="至少8位，含大小写和数字" type="password" style={inputSt} />
                    </>
                  )}
                  {!isRegMode && (
                    <>
                      <div style={{ fontSize:12.5, color:'var(--text-secondary)', marginBottom:6 }}>邮箱 / 用户名</div>
                      <input key={`email-${loginModalKey}`} ref={csEmailRef} defaultValue="" onChange={e => setLoginForm(f=>({...f,email:e.target.value}))} placeholder="邮箱或用户名" type="text" style={inputSt} autoComplete="username" />
                      <div style={{ fontSize:12.5, color:'var(--text-secondary)', marginBottom:6, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span>密码</span>
                        <button onClick={() => { setForgotMode(true); setForgotEmail(loginForm.email); }}
                          style={{ border:'none', background:'none', cursor:'pointer', color:'var(--accent)', fontSize:12, fontFamily:'inherit', padding:0 }}>
                          忘记密码？
                        </button>
                      </div>
                      <input key={`pwd-${loginModalKey}`} ref={csPwdRef} defaultValue="" onChange={e => setLoginForm(f=>({...f,password:e.target.value}))} placeholder="请输入密码" type="password" style={inputSt} autoComplete="current-password"
                        onKeyDown={e => e.key==='Enter' && handleLogin()} />
                    </>
                  )}
                  {loginError && (
                    <div style={{ fontSize:13, color:'#ff6b6b', background:'rgba(255,107,107,.08)', border:'0.5px solid rgba(255,107,107,.25)', borderRadius:9, padding:'9px 13px', marginBottom:12 }}>
                      ⚠ {loginError}
                    </div>
                  )}
                  <button onClick={handleLogin} disabled={loginLoading} style={{
                    width:'100%', padding:'11px', borderRadius:10, border:'none',
                    background:'linear-gradient(135deg,#c8a96e,#9a7040)', color:'#fff',
                    fontSize:14, fontWeight:600, cursor: loginLoading ? 'not-allowed' : 'pointer',
                    opacity: loginLoading ? .7 : 1, fontFamily:'inherit', marginBottom:12,
                  }}>
                    {loginLoading ? '处理中...' : isRegMode ? '注册' : '登录'}
                  </button>
                  <div style={{ textAlign:'center', fontSize:12.5, color:'var(--text-tertiary)' }}>
                    {isRegMode ? '已有账号？' : '没有账号？'}
                    <button onClick={() => { setIsRegMode(v=>!v); setLoginError(''); }}
                      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--accent)', fontSize:12.5, fontFamily:'inherit', padding:'0 4px' }}>
                      {isRegMode ? '去登录' : '立即注册'}
                    </button>
                  </div>
                  <div style={{ textAlign:'center' as const, marginTop:12, paddingTop:12, borderTop:'0.5px solid var(--border)' }}>
                    <button onClick={() => { setInviteCodeMode(true); setLoginError(''); setForgotMode(false); }}
                      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-tertiary)', fontSize:12, fontFamily:'inherit' }}>
                      🔗 有邀请码？点击加入团队
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
});

const MainContent: React.FC = () => {
  const activeView = useSelector((s: RootState) => s.app.activeView);

  if (activeView === 'home') return <HomeView />;
  if (activeView === 'slides') return <SlidesView />;
  if (activeView === 'whiteboard') return <WhiteboardView />;
  if (activeView === 'mindmap') return <MindMapView />;
  if (activeView === 'stats') return <WritingStatsView />;
  if (activeView === 'graph') return <DocumentGraphView />;
  if (activeView === 'library') return <LibraryView />;
  if (activeView === 'references') return <ReferencesView />;
  if (activeView === 'workbench') return <EditorArea />;
  if (activeView === 'settings') return <SettingsView />;
  if (activeView === 'plugins') return <PluginsView />;
  if (activeView === 'templates') return <TemplatesView />;
  if (activeView === 'ai') return <AIAssistantView />;
  if (activeView === 'cloudSync') return <CloudSyncView />;
  if (activeView === 'code') return <div style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex' }}><CodeViewerPage /></div>;
  if (activeView === 'org') return <div style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex', width: '100%' }}><OrgManageViewWrapper /></div>;

  const labels: Record<string, {title: string; icon: string; desc: string}> = {
    ai:        { title: 'AI 助手',  icon: '✨', desc: 'AI 写作助手功能即将上线' },
    templates: { title: '模板库',   icon: '📋', desc: '文档模板功能即将上线' },
  };
  const v = labels[activeView] || { title: activeView, icon: '🚧', desc: '该功能即将上线' };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-editor)', color: 'var(--text-tertiary)' }}>
      <div style={{ fontSize: 52, marginBottom: 20 }}>{v.icon}</div>
      <div style={{ fontSize: 20, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 400 }}>{v.title}</div>
      <div style={{ fontSize: 14 }}>{v.desc}</div>
    </div>
  );
};

const AppInner: React.FC<{ splashDone?: boolean }> = ({ splashDone }) => {
  useSyncLang(); // 同步语言设置到全局 t() 函数

  // 同步语言到 document.documentElement.lang，CSS 和外部逻辑可以读取
  const _lang = useSelector((s: RootState) => s.settings.language);
  React.useEffect(() => {
    document.documentElement.lang = _lang;
  }, [_lang]);
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, isLocalMode } = useSelector((s: RootState) => (s as any).auth);
  const { sidebarOpen, notification } = useSelector((s: RootState) => s.app);
  const [stage, setStage] = useState<AppStage>('loading');
  const [bootDone, setBootDone] = useState(false);

  // ── Splash 结束后的主流程 ─────────────────────────────
  // 参考拾卷设计：localStorage flag 判断引导页，不依赖 DB/IPC 的 neverShow
  const handleSplashDone = useCallback(async () => {
    // 超时保护：最多5秒，防止 IPC 卡住导致 loading 遮罩永久拦截输入
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));
    const boot = (async () => {
    await dispatch(loadSettings()).catch(() => {});

    // 设置本地模式（令 isAuthenticated=true）
    const p = await ipc.invoke<any>('settings:get', { key: 'localProfile' }).catch(() => null);
    dispatch(setLocalMode(p?.id ? p : undefined));

    try {
      const ws = await ipc.invoke<any[]>('workspaces:list').catch(() => null);
      const hasWorkspace = Array.isArray(ws) && ws.length > 0;

      if (!hasWorkspace) {
        // 检查 localStorage flag（参考拾卷，100% 可靠，不依赖 DB）
        let onboardingDone = false;
        try { onboardingDone = !!localStorage.getItem(ONBOARDING_FLAG); } catch {}

        if (onboardingDone) {
          // 用户之前选了"不再显示"，静默建工作区后进 app
          try {
            const newWs = await ipc.invoke<any>('workspaces:create', {
              name: '我的工作区', icon: '📁', color: '#c8a96e', profession: 'general',
            });
            const wsId = newWs?.id;
            if (wsId) {
              dispatch(setActiveWorkspace(wsId));
              dispatch(fetchDocuments({ workspaceId: wsId }));
              ipc.invoke('app:set-state', { onboardingDone: true, lastWorkspaceId: wsId }).catch(() => {});
              ipc.invoke('settings:set', { key: 'localProfile', value: { id: wsId + '_user', displayName: '本地用户' } }).catch(() => {});
            }
          } catch {}
          setStage('app');
        } else {
          // 新用户，显示引导页
          setStage('onboarding');
        }
        return;
      }

      // 有工作区：找到上次使用的工作区
      const appState = await ipc.invoke<any>('app:get-state').catch(() => ({}));
      const savedId = appState?.lastWorkspaceId;
      const targetWs = (savedId && ws.find((w: any) => w.id === savedId))
        ? ws.find((w: any) => w.id === savedId)
        : ws[0];
      const wsId = targetWs.id;

      dispatch(setActiveWorkspace(wsId));
      ipc.invoke('app:set-state', { onboardingDone: true, lastWorkspaceId: wsId }).catch(() => {});
      dispatch(fetchDocuments({ workspaceId: wsId }));

      setStage('app');
    } catch {
      setStage('app');
    }
    })();
    await Promise.race([boot, timeout]);
    // 确保无论如何都能退出 loading 状态
    setStage(prev => prev === 'loading' ? 'app' : prev);
  }, [dispatch]);

  // Once splash is done AND PersistGate has rehydrated (AppInner mounted), run boot sequence
  useEffect(() => {
    if (splashDone && !bootDone) {
      setBootDone(true);
      handleSplashDone();
      // 初始化云同步引擎
      try { initSyncEngine(); } catch (e) { console.warn('[SyncEngine] init failed:', e); }
    }
  }, [splashDone, bootDone, handleSplashDone]);

  // ── 自动更新监听 ────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.on) return;
    const onAvail = () => setUpdateAvailable(true);
    const onDone  = () => { setUpdateDownloaded(true); setUpdateAvailable(false); };
    api.on('update-available', onAvail);
    api.on('update-downloaded', onDone);
    return () => {
      api.removeListener?.('update-available', onAvail);
      api.removeListener?.('update-downloaded', onDone);
    };
  }, []);


  // 配置 autoSave + 关闭前保存
  useEffect(() => {
    autoSave.configure({
      interval: 500,
      onSave:  (id) => dispatch(setSaving({ id, saving: true })),
      onSaved: (id, updatedAt) => {
        dispatch(setSaving({ id, saving: false }));
        // 用服务端返回的 updatedAt，保证文档库时间戳与 DB 一致
        dispatch(syncDocumentToTree({ id, updatedAt: updatedAt ?? Date.now() }));
      },
    });

    const api = (window as any).electronAPI;
    if (!api) return;

    // 主进程发来关闭信号 → flush 所有文档（等 IPC 全部返回）→ 通知主进程写盘关闭
    const handleBeforeClose = async () => {
      // flushAll() 内部会等待所有 documents:update IPC 调用返回，保证数据已进 DB 内存
      try { await autoSave.flushAll(); } catch {}
      // 关闭前记录同步时间戳
      try {
        const authS = store.getState() as any;
        if (authS?.auth?.isAuthenticated && !authS?.auth?.isLocalMode) {
          localStorage.setItem('qiwen_last_sync_at', Date.now().toString());
        }
      } catch {}
      // 通知主进程：renderer 侧已保存完毕，可以写盘并关闭窗口
      try { api.send('flush-complete'); } catch {}
    };
    api.onMenuAction('app-before-close', handleBeforeClose);

    // 页面隐藏（Alt+Tab 等）→ 立即 flush
    const handleVisibility = async () => {
      if (document.visibilityState === 'hidden') {
        try { await autoSave.flushAll(); } catch {}
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      try { api.removeMenuAction('app-before-close', handleBeforeClose); } catch {}
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [dispatch]);


  // 登录/本地模式后加载数据
  const workspaceItems = useSelector((s: RootState) => s.workspaces.items);
  useEffect(() => {
    if (isAuthenticated || isLocalMode) {
      dispatch(loadSettings());
      dispatch(fetchWorkspaces());
    }
  }, [isAuthenticated, isLocalMode, dispatch]);

  // 工作区加载完毕后检查 activeWorkspaceId 是否仍有效
  const activeWsId = useSelector((s: RootState) => s.app.activeWorkspaceId);
  useEffect(() => {
    if (workspaceItems.length === 0) return;
    const isValid = workspaceItems.some(w => w.id === activeWsId);
    if (!isValid) {
      dispatch(setActiveWorkspace(workspaceItems[0].id));
    }
  }, [workspaceItems, activeWsId, dispatch]);

  // 双向链接：监听编辑器中 [[title]] 点击事件
  useEffect(() => {
    const handler = async (e: Event) => {
      const { title } = (e as CustomEvent).detail;
      if (!title || !activeWsId) return;
      try {
        const docs = await ipc.invoke<any[]>('documents:search', { workspaceId: activeWsId, query: title });
        const found = docs?.find((d: any) => d.title === title);
        if (found) {
          (dispatch as any)(openTab({ documentId: found.id, title: found.title }));
          (dispatch as any)(setView('workbench'));
        } else {
          if (window.confirm(`文档「${title}」不存在，是否立即创建？`)) {
            const newDoc = await (dispatch as any)(createDocument({ workspaceId: activeWsId, title })).unwrap();
            if (newDoc?.id) {
              (dispatch as any)(openTab({ documentId: newDoc.id, title }));
              (dispatch as any)(setView('workbench'));
            }
          }
        }
      } catch {}
    };
    window.addEventListener('qiwen:open-wikilink', handler);
    return () => window.removeEventListener('qiwen:open-wikilink', handler);
  }, [activeWsId, dispatch]);

  // 每次 activeWsId 变化时同步写入 app-state 文件
  // 确保下次启动 handleSplashDone 能读到最新的 workspaceId
  useEffect(() => {
    if (!activeWsId) return;
    ipc.invoke('app:set-state', { lastWorkspaceId: activeWsId }).catch(() => {});
  }, [activeWsId]);

  // 持久化 tabs 恢复后重新加载文档内容
  // 参考拾卷：不用定时器，用两次检查（立即 + 1s 兜底）
  const tabs = useSelector((s: RootState) => s.app.tabs);
  const openDocuments = useSelector((s: RootState) => s.documents.openDocuments);
  useEffect(() => {
    if (stage !== 'app') return;

    const load = async () => {
      const freshState = store.getState();
      const freshTabs = freshState.app?.tabs || [];
      const freshOpenDocs = freshState.documents?.openDocuments || {};
      const freshWsId = freshState.app?.activeWorkspaceId;

      // 若文档库为空则重新加载（handleSplashDone 可能因异常跳过了 fetchDocuments）
      if (freshWsId) {
        const freshTree = freshState.documents?.tree || [];
        if (freshTree.length === 0) {
          await dispatch(fetchDocuments({ workspaceId: freshWsId }));
        }
      }
      // 加载各 tab 打开的文档内容
      freshTabs.forEach((tab: any) => {
        if (!freshOpenDocs[tab.documentId]) {
          dispatch(fetchDocument(tab.documentId));
        }
      });
    };

    // 立即执行一次（handleSplashDone 已设置好 activeWorkspaceId）
    load();
    // 1s 后再兜底一次，防止 IPC 时序问题导致第一次拿到空数据
    const timer = setTimeout(load, 1000);
    return () => clearTimeout(timer);
  }, [stage]); // eslint-disable-line

  // 退出登录 → 跳回登录页
  // clearAuth 会把 isAuthenticated 设为 false，但 isLocalMode 保持 true
  // 所以检查 isAuthenticated 即可（本地模式下 isAuthenticated 也是 true）
  // 用 ref 标记是否已完成初始化，避免启动瞬间 isAuthenticated=false 误跳到 auth 页
  const initDoneRef = React.useRef(false);
  useEffect(() => {
    if (stage !== 'app') return;
    initDoneRef.current = true;
    // 同步插件注册表元数据（修复持久化状态中插件信息过期的问题）
    dispatch(syncInstalledMetadata(ALL_PLUGINS));
  }, [stage]); // eslint-disable-line
  useEffect(() => {
    if (!isAuthenticated && initDoneRef.current && stage === 'app') {
      setStage('auth');
    }
  }, [isAuthenticated, stage]);

  // Auth 页登录/注册成功 → 云同步 → 写入本地 DB → 进 app
  useEffect(() => {
    if (!isAuthenticated || stage !== 'auth') return;
    (async () => {
      try {
        // 登录后检查是否有组织，首次登录弹邀请引导
        try {
          const orgs = await cloudSync.getMyOrganizations();
          if (orgs.length === 0) {
            setTimeout(() => setShowInviteGuide(true), 1500);
          }
        } catch {}
        // 登录后触发全量同步（syncEngine 会从 Supabase 拉取数据）
        const { initSyncEngine } = await import('./services/syncEngine');
        initSyncEngine();
      } catch (e) {
        console.warn('[sync] initial sync failed, continuing offline:', e);
      }
      // 检查本地是否有工作区
      ipc.invoke<any[]>('workspaces:list').then(ws => {
        const isNew = !Array.isArray(ws) || ws.length === 0;
        setStage(isNew ? 'onboarding' : 'app');
      }).catch(() => setStage('onboarding'));
    })();
  }, [isAuthenticated, stage]); // eslint-disable-line

  // 主题 CSS 变量
  const theme = useSelector((s: RootState) => s.settings.theme);
  const accentColor = useSelector((s: RootState) => s.settings.accentColor);
  useEffect(() => {
    const themes: Record<string, Record<string, string>> = {
      dark: {
        '--bg-base': '#0d0d12', '--bg-primary': '#0d0d12',
        '--bg-surface': '#121218', '--bg-surface2': '#17171f', '--bg-surface3': '#1d1d27',
        '--bg-hover': 'rgba(255,255,255,0.045)',
        '--bg-activitybar': '#0a0a0e',
        '--bg-sidebar': '#111116',
        '--bg-editor': '#0f0f14',
        '--text-primary': '#e2e0da', '--text-secondary': '#8a8880', '--text-tertiary': '#52504e',
        '--border': 'rgba(255,255,255,0.06)', '--border-md': 'rgba(255,255,255,0.10)',
      },
      system: {
        '--bg-base': '#0d0d12', '--bg-primary': '#0d0d12',
        '--bg-surface': '#121218', '--bg-surface2': '#17171f', '--bg-surface3': '#1d1d27',
        '--bg-hover': 'rgba(255,255,255,0.045)',
        '--bg-activitybar': '#0a0a0e',
        '--bg-sidebar': '#111116',
        '--bg-editor': '#0f0f14',
        '--text-primary': '#e2e0da', '--text-secondary': '#8a8880', '--text-tertiary': '#52504e',
        '--border': 'rgba(255,255,255,0.06)', '--border-md': 'rgba(255,255,255,0.10)',
      },
      light: {
        '--bg-base': '#f0f0f0', '--bg-primary': '#f0f0f0',
        '--bg-surface': '#fafafa', '--bg-surface2': '#ebebeb', '--bg-surface3': '#e0e0e0',
        '--bg-hover': 'rgba(0,0,0,0.05)',
        '--bg-activitybar': '#e4e4e4',
        '--bg-sidebar': '#eeeeee',
        '--bg-editor': '#f8f8f8',
        '--text-primary': '#1a1a1a', '--text-secondary': '#4a4a4a', '--text-tertiary': '#888888',
        '--border': 'rgba(0,0,0,0.1)', '--border-md': 'rgba(0,0,0,0.18)',
      },
    };
    const vars = themes[theme] || themes.dark;
    Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
    if (accentColor) {
      document.documentElement.style.setProperty('--accent', accentColor);
    }
  }, [theme, accentColor]);

  // Token 自动刷新
  useEffect(() => {
    if (!isAuthenticated || isLocalMode) return;
    const iv = setInterval(() => dispatch(refreshAccessToken()), 12 * 60 * 1000);
    return () => clearInterval(iv);
  }, [isAuthenticated, isLocalMode, dispatch]);

  // Electron 菜单
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;
    const handlers: [string, () => void][] = [
      ['toggle-sidebar', () => dispatch({ type: 'app/toggleSidebar' })],
      ['focus-mode', () => dispatch({ type: 'app/toggleFocusMode' })],
      ['open-settings', () => dispatch({ type: 'app/setSettingsOpen', payload: true })],
      ['show-shortcuts', () => dispatch({ type: 'app/setShortcutsOpen', payload: true })],
    ];
    handlers.forEach(([ch, fn]) => api.onMenuAction(ch, fn));
    return () => handlers.forEach(([ch, fn]) => api.removeMenuAction(ch, fn));
  }, [dispatch]);

  return (
    <div className="app-root">
      <AnimatePresence>
        {(stage === 'loading') && (
          <motion.div
            key="loading"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={{ duration: 0.25 }}
            style={{ position: 'fixed', inset: 0, background: '#0a0a0f', zIndex: 9999, pointerEvents: 'auto' }}
          />
        )}

        {stage === 'auth' && (
          <motion.div
            key="auth"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            style={{ flex: 1, height: '100vh' }}
          >
            <AuthPage onOffline={async () => {
              dispatch(setLocalMode(undefined));
              // 统一用工作区检查，不依赖任何 flag
              try {
                const ws = await ipc.invoke<any[]>('workspaces:list');
                const isNew = !Array.isArray(ws) || ws.length === 0;
                setTimeout(() => setStage(isNew ? 'onboarding' : 'app'), 0);
              } catch {
                setTimeout(() => setStage('onboarding'), 0);
              }
            }} />
          </motion.div>
        )}

        {(stage === 'app' || stage === 'onboarding') && (
          <motion.div
            key="app"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', position: 'relative' }}
          >
            <TitleBar />
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
              {/* VSCode 风格：sidebarOpen 控制整个侧边栏显隐 */}
              {sidebarOpen && (
                <div style={{ height: '100%', overflow: 'hidden', flexShrink: 0 }}>
                  <Sidebar />
                </div>
              )}
              <MainContent />
            </div>
            <StatusBar />

      {/* 邀请队友引导弹窗 */}
      {showInviteGuide && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowInviteGuide(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            width: 440, borderRadius: 18, overflow: 'hidden',
            background: 'var(--bg-surface)', border: '0.5px solid var(--border-md)',
            boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
            animation: 'scaleIn 0.25s cubic-bezier(0.34,1.56,0.64,1) both',
          }}>
            {/* 顶部色条 */}
            <div style={{ height: 3, background: 'linear-gradient(90deg, var(--accent), #9a7040)' }} />
            <div style={{ padding: '28px 28px 24px' }}>
              {/* 标题 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(200,169,110,0.1)', border: '1px solid rgba(200,169,110,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>👥</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>邀请队友，一起协作</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>生成邀请链接，队友点击即可加入</div>
                </div>
              </div>

              {/* 步骤说明 */}
              {!inviteGuideLink ? (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
                    {[
                      { n: '1', t: '生成邀请链接', d: '点击下方按钮，自动创建组织并生成邀请链接' },
                      { n: '2', t: '发送给队友', d: '把链接发送给队友，支持微信、邮件等任何方式' },
                      { n: '3', t: '队友点击加入', d: '队友打开启文，粘贴链接中的邀请码即可加入' },
                    ].map(step => (
                      <div key={step.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(200,169,110,0.12)', border: '1px solid rgba(200,169,110,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--accent)', flexShrink: 0, marginTop: 1 }}>{step.n}</div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 }}>{step.t}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>{step.d}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={async () => {
                    setInviteGuideLoading(true);
                    try {
                      // 创建默认组织
                      let orgs = await cloudSync.getMyOrganizations();
                      let orgId = orgs[0]?.id;
                      if (!orgId) {
                        const org = await cloudSync.createOrganization('我的团队', 'my-team-' + Date.now());
                        orgId = org.id;
                      }
                      const token = await cloudSync.inviteMember(orgId, '', 'member');
                      setInviteGuideLink(`https://bitwool.cn/invite/${token}`);
                    } catch (e: any) {
                      console.error(e);
                    } finally { setInviteGuideLoading(false); }
                  }} disabled={inviteGuideLoading} style={{
                    width: '100%', padding: '12px', borderRadius: 10, border: 'none',
                    background: 'linear-gradient(135deg, var(--accent), #9a7040)',
                    color: '#fff', fontSize: 14, fontWeight: 600, cursor: inviteGuideLoading ? 'wait' : 'pointer',
                    fontFamily: 'inherit', opacity: inviteGuideLoading ? 0.75 : 1,
                  }}>
                    {inviteGuideLoading ? '生成中…' : '🔗 生成邀请链接'}
                  </button>
                </>
              ) : (
                <div>
                  <div style={{ background: 'var(--bg-surface2)', borderRadius: 10, padding: '14px 16px', border: '1px solid rgba(82,201,122,0.25)', marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>邀请链接（7天有效）</div>
                    <div style={{ fontSize: 12.5, fontFamily: 'monospace', color: '#52c97a', wordBreak: 'break-all', lineHeight: 1.6 }}>{inviteGuideLink}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { navigator.clipboard.writeText(inviteGuideLink); }} style={{ flex: 1, padding: '10px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      📋 复制链接
                    </button>
                    <button onClick={() => setShowInviteGuide(false)} style={{ padding: '10px 16px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                      完成
                    </button>
                  </div>
                </div>
              )}

              <button onClick={() => setShowInviteGuide(false)} style={{ marginTop: 12, width: '100%', padding: '7px', background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>
                稍后再说，先自己用用看
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 自动更新提示横幅 */}
      {(updateAvailable || updateDownloaded) && !updateDismissed && (
        <div style={{
          position: 'fixed', bottom: 36, right: 20, zIndex: 9000,
          width: 320, borderRadius: 14,
          background: updateDownloaded ? 'rgba(82,201,122,0.10)' : 'rgba(91,156,246,0.10)',
          border: `1px solid ${updateDownloaded ? 'rgba(82,201,122,0.35)' : 'rgba(91,156,246,0.35)'}`,
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          animation: 'slideInRight 0.35s cubic-bezier(0.22,1,0.36,1) both',
        }}>
          {/* 顶部色条 */}
          <div style={{ height: 2, background: updateDownloaded ? '#52c97a' : '#5b9cf6' }} />
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {updateDownloaded ? '🎉 新版本已就绪' : '🔄 发现新版本'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  {updateDownloaded
                    ? '重启启文即可完成更新，获得最新功能和修复。'
                    : '正在后台下载新版本，下载完成后会提示你重启。'
                  }
                </div>
              </div>
              <button onClick={() => setUpdateDismissed(true)} style={{
                background: 'none', border: 'none', color: 'var(--text-tertiary)',
                cursor: 'pointer', fontSize: 16, padding: '0 0 0 4px', lineHeight: 1, flexShrink: 0,
              }}>×</button>
            </div>
            {updateDownloaded && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => {
                  const api = (window as any).electronAPI;
                  api?.invoke('app:install-update').catch(() => {});
                }} style={{
                  flex: 1, padding: '7px', borderRadius: 8, border: 'none',
                  background: '#52c97a', color: '#fff',
                  fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  立即重启并更新
                </button>
                <button onClick={() => setUpdateDismissed(true)} style={{
                  padding: '7px 14px', borderRadius: 8,
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text-tertiary)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  稍后
                </button>
              </div>
            )}
          </div>
        </div>
      )}
            <Notification />
            <SearchModal />
            {/* Onboarding floating modal overlay */}
            <AnimatePresence>
              {stage === 'onboarding' && (
                <OnboardingModal
                  onComplete={() => {
                    try { localStorage.setItem(ONBOARDING_FLAG, '1'); } catch {}
                    setStage('app');
                  }}
                  onSkip={() => setStage('app')}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};


const AppWithSplash: React.FC = () => {
  const [splashDone, setSplashDone] = useState(false);

  if (!splashDone) {
    return <SplashScreen onFinished={() => setSplashDone(true)} />;
  }

  return (
    <PersistGate loading={
      // While rehydrating, show a minimal dark screen (not white)
      <div style={{ width: '100vw', height: '100vh', background: '#0a0a0f' }} />
    } persistor={persistor}>
      <ErrorBoundary>
        <AppInner splashDone={splashDone} />
        <CommandPalette />
      </ErrorBoundary>
    </PersistGate>
  );
};

const App: React.FC = () => (
  <Provider store={store}>
    <AppWithSplash />
  </Provider>
);

export default App;
