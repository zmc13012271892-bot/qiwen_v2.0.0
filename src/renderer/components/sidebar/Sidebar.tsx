import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { setView, View, openTab, setActiveWorkspace } from '../../store/slices/appSlice';
import { clearAuth } from '../../store/slices/authSlice';
import { createDocument, fetchDocuments, searchDocuments } from '../../store/slices/documentsSlice';
import { DocumentMeta } from '../../../shared/types';
import { useT } from '../../i18n';

/* ─── Icons ──────────────────────────────────────── */
const Ico = ({ d, size = 16, sw = 1.5 }: { d: string; size?: number; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IcoHome      = () => <Ico d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10" />;
const IcoWorkbench = () => <Ico d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />;
const IcoSlides    = () => <Ico d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />;
const IcoLibrary   = () => <Ico d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />;
const IcoSearch    = () => <Ico d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />;
const IcoRef       = () => <Ico d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />;
const IcoPlugins   = () => <Ico d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5zM16 8L2 22M17.5 15H9" />;
const IcoCloud     = () => <Ico d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />;
const IcoWhiteboard = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <rect x="3" y="3" width="18" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
    <path d="M7 10l3 3 6-6"/>
  </svg>
);
const IcoMindmap = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/>
    <line x1="9.5" y1="10.5" x2="5.5" y2="7.5"/><line x1="14.5" y1="10.5" x2="18.5" y2="7.5"/>
    <line x1="9.5" y1="13.5" x2="5.5" y2="16.5"/><line x1="14.5" y1="13.5" x2="18.5" y2="16.5"/>
  </svg>
);
const IcoStats = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    <line x1="3" y1="20" x2="21" y2="20"/>
  </svg>
);
const IcoGraph = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><circle cx="12" cy="4" r="2"/>
    <line x1="8.2" y1="11" x2="15.8" y2="7"/><line x1="8.2" y1="13" x2="15.8" y2="17"/>
  </svg>
);
const IcoSettings  = () => <Ico sw={1.4} d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />;
const IcoChevron = ({ open }: { open: boolean }) => (
  <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
    style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.18s ease', flexShrink: 0 }}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
const IcoPlus = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/* ─── Nav items ────────────────────────────────────── */
const IcoCode = () => <Ico d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />;
const IcoOrg  = () => <Ico d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />;

const NAV = [
  { id: 'workbench',  Icon: IcoWorkbench,  tip: 'Explorer'   },
  { id: 'library',    Icon: IcoLibrary,    tip: 'Library'    },
  { id: 'code',       Icon: IcoCode,       tip: 'Code'       },
  { id: 'slides',     Icon: IcoSlides,     tip: 'Slides'     },
  { id: 'whiteboard', Icon: IcoWhiteboard, tip: 'Whiteboard' },
  { id: 'mindmap',    Icon: IcoMindmap,    tip: 'Mind Map'   },
  { id: 'stats',      Icon: IcoStats,      tip: 'Stats'      },
  { id: 'graph',      Icon: IcoGraph,      tip: 'Doc Graph'  },
  { id: 'search',     Icon: IcoSearch,     tip: 'Search'     },
  { id: 'references', Icon: IcoRef,        tip: 'References' },
  { id: 'plugins',    Icon: IcoPlugins,    tip: 'Plugins'    },
  { id: 'org',        Icon: IcoOrg,        tip: 'Organization'},
  { id: 'cloudSync',  Icon: IcoCloud,      tip: 'Cloud Sync' },
] as const;

/* ─── New doc modal ────────────────────────────────── */
const NewDocModal: React.FC<{ onConfirm: (t: string) => void; onCancel: () => void }> = ({ onConfirm, onCancel }) => {
  const T = useT();
  const [title, setTitle] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 50); }, []);
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 320, background: 'var(--bg-surface2)', border: '0.5px solid var(--border-md)', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 14 }}>{T('sidebar.newDoc')}</div>
        <input ref={ref} value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(title.trim() || T('common.untitled')); if (e.key === 'Escape') onCancel(); }}
          placeholder={T('common.untitled')}
          style={{ width: '100%', height: 36, padding: '0 12px', borderRadius: 8, background: 'var(--bg-surface3)', border: '0.5px solid var(--border-md)', color: 'var(--text-primary)', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ height: 30, padding: '0 14px', borderRadius: 7, border: '0.5px solid var(--border-md)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>{T('common.cancel')}</button>
          <button onClick={() => onConfirm(title.trim() || T('common.untitled'))} style={{ height: 30, padding: '0 14px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit', fontWeight: 500 }}>{T('common.create')}</button>
        </div>
      </div>
    </div>
  );
};

/* ─── User menu ────────────────────────────────────── */
const UserMenu: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const T = useT();
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector((s: RootState) => (s as any).auth?.user);
  const isLocal = useSelector((s: RootState) => (s as any).auth?.isLocalMode);

  const Item = ({ icon, label, onClick, danger = false }: { icon: string; label: string; onClick: () => void; danger?: boolean }) => (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12.5, color: danger ? 'var(--color-danger)' : 'var(--text-primary)', fontFamily: 'inherit', textAlign: 'left' as const, transition: 'background 0.1s' }}
      onMouseOver={e => { e.currentTarget.style.background = danger ? 'rgba(224,92,92,0.08)' : 'var(--bg-hover)'; }}
      onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}>
      <span style={{ fontSize: 14, width: 18, textAlign: 'center' as const, flexShrink: 0 }}>{icon}</span>{label}
    </button>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 299 }} />
      <div style={{ position: 'fixed', bottom: 58, left: 'calc(var(--activitybar-width) + 6px)', width: 210, background: 'var(--bg-surface2)', border: '0.5px solid var(--border-md)', borderRadius: 10, zIndex: 300, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.45)' }}>
        <div style={{ padding: '12px 14px 10px', borderBottom: '0.5px solid var(--border)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{user?.displayName || '本地用户'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{isLocal ? '本地模式 · 未登录' : (user?.email || '')}</div>
        </div>
        <div style={{ padding: '4px 0' }}>
          <Item icon="☁️" label={T('sidebar.cloudSync')} onClick={() => { (dispatch as any)(setView('cloudSync')); onClose(); }} />
          <Item icon="⚙️" label={T('common.settings')} onClick={() => { (dispatch as any)(setView('settings')); onClose(); }} />
          <div style={{ height: '0.5px', background: 'var(--border)', margin: '4px 0' }} />
          <Item icon="🚪" label={T('auth.logout')} onClick={() => { dispatch(clearAuth()); onClose(); }} danger />
        </div>
      </div>
    </>
  );
};

/* ─── Shared doc row ───────────────────────────────── */
const DocRow: React.FC<{ doc: DocumentMeta; onClick: () => void; pl?: number }> = ({ doc, onClick, pl = 22 }) => (
  <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: `5px 10px 5px ${pl}px`, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12.5, color: 'var(--text-secondary)', fontFamily: 'inherit', textAlign: 'left' as const, whiteSpace: 'nowrap', overflow: 'hidden', transition: 'background 0.1s, color 0.1s' }}
    onMouseOver={e => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
    onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ opacity: 0.35, flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" />
    </svg>
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{doc.title || '无标题'}</span>
  </button>
);

/* ─── Section header ───────────────────────────────── */
const SecHead: React.FC<{ label: string; open: boolean; onToggle: () => void; onAdd?: () => void }> = ({ label, open, onToggle, onAdd }) => (
  <div style={{ display: 'flex', alignItems: 'center' }}>
    <button onClick={onToggle} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 5, padding: '6px 4px 6px 10px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase' as const, color: 'var(--text-tertiary)', fontFamily: 'inherit' }}>
      <IcoChevron open={open} />{label}
    </button>
    {onAdd && (
      <button onClick={onAdd} style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-tertiary)', borderRadius: 4, marginRight: 6, transition: 'color 0.15s, background 0.15s' }}
        onMouseOver={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseOut={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}>
        <IcoPlus />
      </button>
    )}
  </div>
);

/* ─── Panel: Explorer ──────────────────────────────── */
/* ─── Doc Tree (层级文件树) ─────────────────────────── */
const DocTreeNode: React.FC<{
  doc: any;
  docs: any[];
  depth: number;
  onOpen: (d: DocumentMeta) => void;
  onNew?: (parentId: string) => void;
}> = ({ doc, docs, depth, onOpen, onNew }) => {
  const [expanded, setExpanded] = useState(true);
  const children = docs.filter((d: any) => d.parentId === doc.id);
  const pl = 10 + depth * 14;

  if (doc.isFolder) {
    return (
      <div>
        <div onClick={() => setExpanded(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: `4px 8px 4px ${pl}px`, cursor: 'pointer', fontSize: 12.5, color: 'var(--text-secondary)', borderRadius: 5, transition: 'background 0.1s' }}
          onMouseOver={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
          onMouseOut={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)', width: 10, flexShrink: 0 }}>{expanded ? '▾' : '▸'}</span>
          <span style={{ fontSize: 13, flexShrink: 0 }}>📁</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{doc.title || '未命名文件夹'}</span>
          {onNew && (
            <button onClick={e => { e.stopPropagation(); onNew(doc.id); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 14, padding: '0 2px', lineHeight: 1, flexShrink: 0, opacity: 0 }}
              className="tree-add-btn">+</button>
          )}
        </div>
        {expanded && children.map(child => (
          <DocTreeNode key={child.id} doc={child} docs={docs} depth={depth + 1} onOpen={onOpen} onNew={onNew} />
        ))}
      </div>
    );
  }
  return (
    <div onClick={() => onOpen(doc)}
      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: `4px 8px 4px ${pl}px`, cursor: 'pointer', fontSize: 12.5, color: 'var(--text-secondary)', borderRadius: 5, transition: 'background 0.1s' }}
      onMouseOver={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
      onMouseOut={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      <span style={{ width: 10, flexShrink: 0 }} />
      <span style={{ fontSize: 12, flexShrink: 0, opacity: 0.5 }}>📄</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{doc.title || '无标题'}</span>
    </div>
  );
};

const DocTree: React.FC<{ docs: any[]; onOpen: (d: DocumentMeta) => void; onNew: () => void; onNewFolder?: () => void }> = ({ docs, onOpen, onNew, onNewFolder }) => {
  const roots = docs.filter((d: any) => !d.parentId && !d.isArchived);
  if (roots.length === 0) return (
    <div style={{ padding: '16px 14px', textAlign: 'center' as const }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 8 }}>暂无文档</div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
        <button onClick={onNew} style={{ padding: '5px 12px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>📄 新建</button>
        {onNewFolder && <button onClick={onNewFolder} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>📁 文件夹</button>}
      </div>
    </div>
  );
  return (
    <div style={{ padding: '4px 4px' }}>
      {roots.map(d => <DocTreeNode key={d.id} doc={d} docs={docs} depth={0} onOpen={onOpen} />)}
    </div>
  );
};

const PanelExplorer: React.FC<{ recent: DocumentMeta[]; onOpen: (d: DocumentMeta) => void; onNew: () => void }> = ({ recent, onOpen, onNew }) => {
  const T = useT();
  const [showTree, setShowTree] = useState(true);
  const allDocs = useSelector((s: RootState) => s.documents.tree);
  const activeWsId = useSelector((s: RootState) => s.app.activeWorkspaceId);
  const dispatch2 = useDispatch<AppDispatch>();
  const handleNewFolder = async () => {
    if (!activeWsId) return;
    const name = window.prompt('文件夹名称：', '新文件夹');
    if (!name?.trim()) return;
    await (dispatch2 as any)(createDocument({ workspaceId: activeWsId, title: name.trim(), isFolder: true }));
  };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', borderBottom: '0.5px solid var(--border)' }}>
        <button onClick={() => setShowTree(false)}
          style={{ flex: 1, padding: '4px 0', borderRadius: 5, border: 'none', background: !showTree ? 'var(--bg-surface3)' : 'transparent', color: !showTree ? 'var(--text-primary)' : 'var(--text-tertiary)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
          最近
        </button>
        <button onClick={() => setShowTree(true)}
          style={{ flex: 1, padding: '4px 0', borderRadius: 5, border: 'none', background: showTree ? 'var(--bg-surface3)' : 'transparent', color: showTree ? 'var(--text-primary)' : 'var(--text-tertiary)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>
          文件树
        </button>
        <button onClick={onNew} title="新建" style={{ width: 22, height: 22, borderRadius: 5, border: 'none', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
      </div>
      {showTree
        ? <DocTree docs={allDocs} onOpen={onOpen} onNew={onNew} onNewFolder={handleNewFolder} />
        : (recent.length > 0
            ? recent.map(d => <DocRow key={d.id} doc={d} onClick={() => onOpen(d)} />)
            : <div style={{ padding: '8px 22px', fontSize: 12, color: 'var(--text-tertiary)' }}>{T('sidebar.noDocs')}</div>
          )
      }
    </div>
  );
};

/* ─── Panel: Library ───────────────────────────────── */
const PanelLibrary: React.FC<{ docs: DocumentMeta[]; onOpen: (d: DocumentMeta) => void; onNew: () => void }> = ({ docs, onOpen, onNew }) => {
  const T = useT();
  const [allOpen, setAllOpen] = useState(true);
  const [pinOpen, setPinOpen] = useState(true);
  const pinned = docs.filter(d => d.isPinned);
  const normal = docs.filter(d => !d.isPinned).sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div>
      {pinned.length > 0 && (
        <>
          <SecHead label={T('library.pin')} open={pinOpen} onToggle={() => setPinOpen(v => !v)} />
          {pinOpen && pinned.map(d => <DocRow key={d.id} doc={d} onClick={() => onOpen(d)} />)}
        </>
      )}
      <SecHead label={T('library.title')} open={allOpen} onToggle={() => setAllOpen(v => !v)} onAdd={onNew} />
      {allOpen && (
        docs.length === 0
          ? (
            <div style={{ padding: '20px 14px', textAlign: 'center' as const }}>
              <div style={{ fontSize: 24, opacity: 0.18, marginBottom: 6 }}>📄</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10 }}>{T('library.noDoc')}</div>
              <button onClick={onNew} style={{ height: 26, padding: '0 12px', borderRadius: 6, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>{T('library.newDoc')}</button>
            </div>
          )
          : normal.map(d => <DocRow key={d.id} doc={d} onClick={() => onOpen(d)} />)
      )}
    </div>
  );
};

/* ─── Panel: Search ────────────────────────────────── */
const PanelSearch: React.FC<{ wsId: string | null; recent: DocumentMeta[]; onOpen: (d: DocumentMeta) => void }> = ({ wsId, recent, onOpen }) => {
  const T = useT();
  const dispatch = useDispatch<AppDispatch>();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (val: string) => {
    if (!val.trim() || !wsId) { setResults([]); return; }
    setLoading(true);
    try { setResults((await dispatch(searchDocuments({ workspaceId: wsId, query: val })).unwrap()) || []); }
    catch { setResults([]); }
    finally { setLoading(false); }
  }, [wsId, dispatch]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value; setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => doSearch(v), 300);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const showing = q ? results : recent;

  return (
    <div style={{ padding: '10px 10px 0' }}>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
          style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }}>
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input value={q} onChange={onChange} placeholder={T('sidebar.search') + '...'}
          style={{ width: '100%', height: 30, paddingLeft: 28, paddingRight: 8, background: 'var(--bg-surface3)', border: '0.5px solid var(--border)', borderRadius: 7, color: 'var(--text-primary)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }}
          onFocus={e => { e.target.style.borderColor = 'var(--accent-border)'; }}
          onBlur={e => { e.target.style.borderColor = 'var(--border)'; }} />
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase' as const, color: 'var(--text-tertiary)', padding: '0 2px 5px', marginBottom: 2 }}>
        {q ? '搜索结果' : '最近文档'}
      </div>
      {loading && <div style={{ padding: '10px 0', fontSize: 11.5, color: 'var(--text-tertiary)', textAlign: 'center' as const }}>搜索中...</div>}
      {!loading && q && results.length === 0 && <div style={{ padding: '12px 0', fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' as const }}>{T('common.noResult')}</div>}
      {!loading && !q && recent.length === 0 && <div style={{ padding: '8px 4px', fontSize: 12, color: 'var(--text-tertiary)' }}>{T('sidebar.noDocs')}</div>}
      {showing.map(d => <DocRow key={d.id} doc={d} onClick={() => onOpen(d)} pl={4} />)}
    </div>
  );
};

/* ─── Info panel (References / Plugins / CloudSync) ── */
const PanelInfo: React.FC<{ title: string; desc: string; btnLabel: string; onOpen: () => void }> = ({ title, desc, btnLabel, onOpen }) => (
  <div style={{ padding: '12px 14px' }}>
    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.7, marginBottom: 12 }}>{desc}</div>
    <button onClick={onOpen} style={{ width: '100%', height: 30, borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit', fontWeight: 500 }}>{btnLabel}</button>
  </div>
);

/* ─── Main Sidebar ─────────────────────────────────── */
export const Sidebar: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const activeView = useSelector((s: RootState) => s.app.activeView);
  const activeWorkspaceId = useSelector((s: RootState) => s.app.activeWorkspaceId);
  const allWorkspaces = useSelector((s: RootState) => (s as any).workspaces?.items || []);
  const isLoggedIn = useSelector((s: RootState) => (s as any).auth?.isAuthenticated && !(s as any).auth?.isLocalMode);
  const [wsTab, setWsTab] = React.useState<'mine' | 'team'>('mine');
  const user = useSelector((s: RootState) => (s as any).auth?.user);

  const allDocs = useSelector((s: RootState) => s.documents.tree);
  const recentDocs = useSelector((s: RootState) => {
    const tree = s.documents.tree;
    if (!tree.length) return [] as DocumentMeta[];
    return [...tree].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  });

  const [panelOpen, setPanelOpen] = useState(true);
  const [activePanel, setActivePanel] = useState<string>(activeView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNewDoc, setShowNewDoc] = useState(false);

  const T = useT();
  const initials = (user?.displayName || 'U').slice(0, 1).toUpperCase();
  const avatarColor = user?.avatar || '#5b6ee1';

  useEffect(() => {
    if (activeWorkspaceId) dispatch(fetchDocuments({ workspaceId: activeWorkspaceId }));
  }, [activeWorkspaceId, dispatch]);

  // 外部切换视图时同步侧边栏高亮
  useEffect(() => {
    if (NAV.some(n => n.id === activeView)) {
      setActivePanel(activeView);
      // 外部切换视图时重新打开侧边面板（如果被用户手动关闭过）
      setPanelOpen(true);
    }
  }, [activeView]);

  const handleNav = (id: string) => {
    // home / slides / whiteboard / mindmap 没有侧边面板，直接切视图并收起面板
    if (id === 'home' || id === 'slides' || id === 'whiteboard' || id === 'mindmap' || id === 'stats' || id === 'graph') {
      setActivePanel(id);
      setPanelOpen(false);
      (dispatch as any)(setView(id as View));
      return;
    }
    // 再次点击已激活项：切换侧边面板展开/收起
    if (id === activePanel && panelOpen) {
      setPanelOpen(false);
      return;
    }
    setActivePanel(id);
    setPanelOpen(true);
    // search 面板内嵌在侧边栏，不切换主视图；其余均切换主视图
    if (id !== 'search') {
      (dispatch as any)(setView(id as View));
    }
  };

  const openDoc = (doc: DocumentMeta) => {
    const d = dispatch as any;
    d(openTab({ documentId: doc.id, title: doc.title }));
    d(setView('workbench'));
  };

  const confirmNew = async (title: string) => {
    setShowNewDoc(false);
    if (!activeWorkspaceId) return;
    try {
      const d = dispatch as any;
      const doc = await d(createDocument({ workspaceId: activeWorkspaceId, title })).unwrap();
      if (doc?.id) {
        d(openTab({ documentId: doc.id, title: doc.title || title }));
        d(setView('workbench'));
      }
    } catch {}
  };

  const panelLabel = NAV.find(n => n.id === activePanel)?.tip || 'Explorer';
  const showFooterNew = panelOpen && !['search', 'references', 'plugins', 'cloudSync'].includes(activePanel);

  /* ── Activity bar ── */
  const actBar = (
    <div style={{ width: 'var(--activitybar-width)', flexShrink: 0, background: 'var(--bg-activitybar)', borderRight: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 8, paddingBottom: 8, gap: 1, zIndex: 10, position: 'relative' as const }}>
      {/* Logo */}
      <div style={{ width: 28, height: 28, borderRadius: 7, background: 'linear-gradient(135deg, #c8a96e, #8b6e3f)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#fff', fontFamily: 'var(--font-serif)', fontWeight: 500, marginBottom: 8, flexShrink: 0, boxShadow: '0 2px 8px rgba(200,169,110,0.3)' }}>文</div>

      {NAV.map(({ id, Icon, tip }) => {
        const active = activePanel === id && panelOpen;
        return (
          <div key={id} style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
            {active && <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 2.5, height: 18, background: 'var(--accent)', borderRadius: '0 2px 2px 0' }} />}
            <button onClick={() => handleNav(id)} title={tip}
              style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: active ? 'rgba(200,169,110,0.1)' : 'transparent', borderRadius: 7, cursor: 'pointer', color: active ? 'var(--accent)' : 'var(--text-tertiary)', transition: 'all 0.15s' }}
              onMouseOver={e => { if (!active) { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}}
              onMouseOut={e => { if (!active) { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}}>
              <Icon />
            </button>
          </div>
        );
      })}

      <div style={{ flex: 1 }} />

      {/* Settings btn */}
      <button onClick={() => { setActivePanel('settings'); setPanelOpen(false); (dispatch as any)(setView('settings')); }} title="Settings"
        style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', borderRadius: 7, cursor: 'pointer', color: 'var(--text-tertiary)', transition: 'all 0.15s' }}
        onMouseOver={e => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseOut={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}>
        <IcoSettings />
      </button>

      {/* Avatar */}
      <button onClick={() => setMenuOpen(v => !v)}
        style={{ width: 27, height: 27, borderRadius: '50%', background: avatarColor, border: `2px solid ${menuOpen ? 'var(--accent)' : 'transparent'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', cursor: 'pointer', transition: 'border-color 0.15s', marginTop: 4, flexShrink: 0 }}>
        {initials}
      </button>

      {menuOpen && <UserMenu onClose={() => setMenuOpen(false)} />}
    </div>
  );

  /* ── Side panel ── */
  const sidePanel = panelOpen && (
    <div style={{ width: 'var(--sidebar-width)', flexShrink: 0, background: 'var(--bg-sidebar)', borderRight: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ height: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px 0 12px', flexShrink: 0, borderBottom: '0.5px solid var(--border)' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.9px', textTransform: 'uppercase' as const, color: 'var(--text-tertiary)' }}>{panelLabel}</span>
        {!['search', 'references', 'plugins', 'cloudSync'].includes(activePanel) && (
          <button onClick={() => setShowNewDoc(true)} title={T('sidebar.newDoc')}
            style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-tertiary)', borderRadius: 4, transition: 'color 0.15s, background 0.15s' }}
            onMouseOver={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseOut={e => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.background = 'transparent'; }}>
            <IcoPlus />
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'none' as const }}>
        {activePanel === 'workbench' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* 个人 / 团队 tab */}
            {isLoggedIn && (
              <div style={{ display: 'flex', padding: '6px 8px 0', gap: 2, flexShrink: 0 }}>
                {(['mine', 'team'] as const).map(tab => (
                  <button key={tab} onClick={() => setWsTab(tab)} style={{
                    flex: 1, padding: '5px 0', borderRadius: 7, border: 'none',
                    background: wsTab === tab ? 'var(--bg-surface3)' : 'transparent',
                    color: wsTab === tab ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit', fontWeight: wsTab === tab ? 600 : 400,
                    transition: 'all 0.15s',
                  }}>
                    {tab === 'mine' ? '👤 个人' : '👥 团队'}
                  </button>
                ))}
              </div>
            )}

            {/* 团队工作区列表 */}
            {wsTab === 'team' && isLoggedIn ? (
              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
                {allWorkspaces.filter((w: any) => w.isShared || w.is_shared || w.org_id || w.orgId).length === 0 ? (
                  <div style={{ padding: '12px 8px', textAlign: 'center' as const }}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>👥</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.7, marginBottom: 10 }}>
                      还没有团队工作区<br />邀请队友一起协作
                    </div>
                    <button onClick={() => (dispatch as any)(setView('org'))} style={{
                      width: '100%', padding: '7px', borderRadius: 8, border: '1px solid rgba(200,169,110,0.3)',
                      background: 'rgba(200,169,110,0.07)', color: 'var(--accent)',
                      cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', marginBottom: 8,
                    }}>+ 创建团队工作区</button>

                  </div>
                ) : (
                  allWorkspaces.filter((w: any) => w.isShared || w.org_id).map((ws: any) => (
                    <div key={ws.id} onClick={() => {
                      (dispatch as any)(setActiveWorkspace(ws.id));
                      (dispatch as any)(fetchDocuments({ workspaceId: ws.id }));
                      (dispatch as any)(setView('workbench'));
                    }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
                        borderRadius: 7, cursor: 'pointer', marginBottom: 2,
                        background: activeWorkspaceId === ws.id ? 'var(--bg-active)' : 'transparent',
                        color: activeWorkspaceId === ws.id ? 'var(--accent)' : 'var(--text-secondary)',
                        transition: 'background 0.12s',
                      }}
                      onMouseOver={e => { if (activeWorkspaceId !== ws.id) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
                      onMouseOut={e => { if (activeWorkspaceId !== ws.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                      <span style={{ fontSize: 14, flexShrink: 0 }}>{ws.icon || '📂'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{ws.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>🌐 共享</div>
                      </div>
                    </div>
                  ))
                )}
                {/* 激活的团队工作区文档列表 */}
                {activeWorkspaceId && allWorkspaces.find((w:any) => w.id === activeWorkspaceId && (w.isShared||w.is_shared||w.org_id||w.orgId)) && (
                  <div style={{ borderTop: '0.5px solid var(--border)', marginTop: 8, paddingTop: 4 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', padding: '4px 10px 2px', letterSpacing: 0.5, textTransform: 'uppercase' as const }}>
                      文档
                    </div>
                    {recentDocs.length === 0 ? (
                      <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-tertiary)' }}>暂无文档</div>
                    ) : (
                      recentDocs.map(d => <DocRow key={d.id} doc={d} onClick={() => openDoc(d)} />)
                    )}
                    <div style={{ padding: '4px 8px' }}>
                      <button onClick={() => setShowNewDoc(true)} style={{ width: '100%', padding: '5px', borderRadius: 6, border: '1px dashed var(--border-md)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}>
                        + 新建文档
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <PanelExplorer recent={recentDocs} onOpen={openDoc} onNew={() => setShowNewDoc(true)} />
              </div>
            )}
          </div>
        )}
        {activePanel === 'library'    && <PanelLibrary  docs={allDocs} onOpen={openDoc} onNew={() => setShowNewDoc(true)} />}
        {activePanel === 'search'     && <PanelSearch   wsId={activeWorkspaceId} recent={recentDocs} onOpen={openDoc} />}
        {activePanel === 'code'       && <PanelInfo title="Code Viewer" desc="打开本地代码文件，支持 100+ 语言语法高亮，可添加行级批注和团队评论。" btnLabel="打开代码文件" onOpen={() => (dispatch as any)(setView('code'))} />}
        {activePanel === 'org'        && <PanelInfo title="Organization" desc="管理团队成员、角色权限、邀请链接和操作审计日志。" btnLabel="打开组织管理" onOpen={() => (dispatch as any)(setView('org'))} />}
        {activePanel === 'references' && <PanelInfo title="References" desc="管理参考文献，支持 DOI / URL / BibTeX 导入，一键生成 APA / MLA / GB/T 引用格式。" btnLabel="打开文献库" onOpen={() => (dispatch as any)(setView('references'))} />}
        {activePanel === 'plugins'    && <PanelInfo title="Plugins" desc="17+ 内置插件全部离线可用，按职业自动激活，可在市场随时管理。" btnLabel="管理插件" onOpen={() => (dispatch as any)(setView('plugins'))} />}
        {activePanel === 'cloudSync'  && <PanelInfo title="Cloud Sync" desc="注册账户后可跨设备同步，TLS 加密传输，服务器不可读取内容。本地模式无需注册。" btnLabel="打开云同步" onOpen={() => (dispatch as any)(setView('cloudSync'))} />}
      </div>

      {/* Footer new doc */}
      {showFooterNew && (
        <div style={{ padding: '8px 10px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
          <button onClick={() => setShowNewDoc(true)}
            style={{ width: '100%', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, border: '0.5px dashed var(--border-md)', borderRadius: 7, background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'inherit', transition: 'all 0.15s' }}
            onMouseOver={e => { e.currentTarget.style.background = 'rgba(200,169,110,0.06)'; e.currentTarget.style.borderColor = 'rgba(200,169,110,0.3)'; e.currentTarget.style.color = 'var(--accent)'; }}
            onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'var(--border-md)'; e.currentTarget.style.color = 'var(--text-tertiary)'; }}>
            <IcoPlus />新建文档
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div style={{ display: 'flex', height: '100%', flexShrink: 0 }}>
        {actBar}
        {sidePanel}
      </div>
      {showNewDoc && <NewDocModal onConfirm={confirmNew} onCancel={() => setShowNewDoc(false)} />}
    </>
  );
};
