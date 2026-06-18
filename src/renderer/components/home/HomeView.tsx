import React, { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { motion } from 'framer-motion';
import { RootState, AppDispatch } from '../../store';
import { openTab, setView } from '../../store/slices/appSlice';
import { createDocument } from '../../store/slices/documentsSlice';

const Ico = ({ d, size = 18, sw = 1.5 }: { d: string; size?: number; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function fmt(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return '今天';
  if (diff < 172_800_000) return '昨天';
  const d = new Date(ts);
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 6)  return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

interface CreateBtnProps {
  icon: React.ReactNode;
  label: string;
  desc: string;
  accent?: boolean;
  onClick: () => void;
}

const CreateBtn: React.FC<CreateBtnProps> = ({ icon, label, desc, accent, onClick }) => {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
        gap: 10, padding: '18px 20px', borderRadius: 14,
        background: accent
          ? (hovered ? 'rgba(200,169,110,0.18)' : 'rgba(200,169,110,0.1)')
          : (hovered ? 'var(--bg-surface3)' : 'var(--bg-surface2)'),
        border: `0.5px solid ${accent
          ? (hovered ? 'rgba(200,169,110,0.55)' : 'rgba(200,169,110,0.3)')
          : (hovered ? 'rgba(255,255,255,0.12)' : 'var(--border)')}`,
        cursor: 'pointer', textAlign: 'left', transition: 'background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth)',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered ? '0 6px 20px rgba(0,0,0,0.2)' : 'none',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: accent ? 'rgba(200,169,110,0.2)' : 'var(--bg-surface3)',
        color: accent ? 'var(--accent)' : 'var(--text-secondary)',
        flexShrink: 0,
      }}>{icon}</div>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: accent ? 'var(--accent)' : 'var(--text-primary)', marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{desc}</div>
      </div>
    </button>
  );
};

const RecentRow: React.FC<{ doc: any; onClick: () => void }> = ({ doc, onClick }) => {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
        background: hovered ? 'var(--bg-surface2)' : 'transparent',
        border: `0.5px solid ${hovered ? 'var(--border)' : 'transparent'}`,
        textAlign: 'left', transition: 'background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth)', fontFamily: 'inherit',
      }}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 8, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-surface3)', color: 'var(--text-tertiary)',
      }}>
        <Ico d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
          {doc.title || '无标题'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {doc.wordCount > 0 ? `${doc.wordCount.toLocaleString()} 字 · ` : ''}{fmt(doc.updatedAt)}
        </div>
      </div>
      {doc.isPinned && <div style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>置顶</div>}
    </button>
  );
};

const StatCard: React.FC<{ label: string; value: string | number; icon: React.ReactNode }> =
  ({ label, value, icon }) => (
  <div style={{
    padding: '14px 16px', background: 'var(--bg-surface2)',
    border: '0.5px solid var(--border)', borderRadius: 12,
    display: 'flex', alignItems: 'center', gap: 12,
  }}>
    <div style={{
      width: 34, height: 34, borderRadius: 9, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(200,169,110,0.1)', color: 'var(--accent)',
    }}>{icon}</div>
    <div>
      <div style={{ fontSize: 18, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{label}</div>
    </div>
  </div>
);

// ── 工作区清理组件 ─────────────────────────────────────────
const WorkspaceCleanup: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const workspaces = useSelector((s: RootState) => s.workspaces.items);
  const [show, setShow] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const handleDelete = async () => {
    if (!window.confirm(`确定删除选中的 ${selected.size} 个工作区？其中的文档将一并删除。`)) return;
    for (const id of selected) {
      await (window as any).electronAPI?.invoke('workspaces:delete', { id }).catch(() => {});
    }
    setSelected(new Set());
    setShow(false);
    dispatch({ type: 'workspaces/fetchWorkspaces/pending' });
    const ws = await (window as any).electronAPI?.invoke('workspaces:list').catch(() => []);
    dispatch({ type: 'workspaces/fetchWorkspaces/fulfilled', payload: ws || [] });
  };

  if (workspaces.length <= 3) return null;

  return (
    <>
      <button onClick={() => setShow(true)} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', marginTop: 8,
        background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 8,
        color: 'var(--text-tertiary)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', width: '100%',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,100,100,0.4)'; (e.currentTarget as HTMLElement).style.color = '#ff9a9a'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-tertiary)'; }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
        清理工作区 ({workspaces.length} 个)
      </button>

      {show && (
        <div onClick={() => setShow(false)} style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 440, maxHeight: '70vh', background: 'var(--bg-surface)', border: '0.5px solid var(--border-md)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px', borderBottom: '0.5px solid var(--border)' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>工作区管理</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3 }}>选择要删除的工作区（勾选后删除）</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {workspaces.map(ws => (
                <div key={ws.id} onClick={() => toggle(ws.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px', cursor: 'pointer', background: selected.has(ws.id) ? 'rgba(255,100,100,0.06)' : 'transparent' }}
                  onMouseOver={e => { if (!selected.has(ws.id)) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
                  onMouseOut={e => { if (!selected.has(ws.id)) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                  <div style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${selected.has(ws.id) ? '#ff6b6b' : 'var(--border-md)'}`, background: selected.has(ws.id) ? 'rgba(255,107,107,0.15)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {selected.has(ws.id) && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                  </div>
                  <div style={{ fontSize: 16, flexShrink: 0 }}>{ws.icon || '📁'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: selected.has(ws.id) ? '#ff9a9a' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws.name}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '14px 20px', borderTop: '0.5px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShow(false)} style={{ height: 32, padding: '0 16px', borderRadius: 8, border: '0.5px solid var(--border-md)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>取消</button>
              <button onClick={handleDelete} disabled={selected.size === 0} style={{ height: 32, padding: '0 16px', borderRadius: 8, border: 'none', background: selected.size > 0 ? 'rgba(255,107,107,0.85)' : 'var(--bg-surface3)', color: selected.size > 0 ? '#fff' : 'var(--text-tertiary)', cursor: selected.size > 0 ? 'pointer' : 'default', fontSize: 13, fontFamily: 'inherit', fontWeight: 500 }}>
                删除 {selected.size > 0 ? `(${selected.size})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const HomeView: React.FC = React.memo(() => {
  const dispatch = useDispatch<AppDispatch>();
  const activeWorkspaceId = useSelector((s: RootState) => s.app.activeWorkspaceId);
  const workspaces = useSelector((s: RootState) => s.workspaces.items);
  const docs = useSelector((s: RootState) => s.documents.tree) as any[];

  const greeting = useMemo(() => getGreeting(), []);
  const wsName = workspaces.find(w => w.id === activeWorkspaceId)?.name || '我的工作区';

  const recentDocs = useMemo(() =>
    [...docs].filter(d => !d.isFolder && !d.isArchived)
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8),
    [docs]
  );
  const pinnedDocs = useMemo(() => docs.filter(d => d.isPinned && !d.isFolder), [docs]);
  const totalWords = useMemo(() => docs.reduce((s, d) => s + (d.wordCount || 0), 0), [docs]);
  const todayDocs = useMemo(() => {
    const start = new Date(); start.setHours(0,0,0,0);
    return docs.filter(d => d.updatedAt >= start.getTime()).length;
  }, [docs]);

  const openDoc = (doc: any) => {
    dispatch(openTab({ documentId: doc.id, title: doc.title }));
    dispatch(setView('workbench'));
  };

  const handleCreateDoc = async () => {
    if (!activeWorkspaceId) return;
    try {
      const doc = await (dispatch as any)(createDocument({ workspaceId: activeWorkspaceId, title: '无标题' })).unwrap();
      if (doc?.id) {
        dispatch(openTab({ documentId: doc.id, title: doc.title || '无标题' }));
        dispatch(setView('workbench'));
      }
    } catch {}
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-editor)', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* 顶部英雄区 */}
        <div style={{
          padding: '52px 56px 40px',
          background: 'linear-gradient(180deg, rgba(200,169,110,0.04) 0%, transparent 100%)',
          borderBottom: '0.5px solid var(--border)',
        }}>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22,1,0.36,1] }}>
            <div style={{ fontSize: 28, fontWeight: 300, color: 'var(--text-primary)', marginBottom: 6 }}>{greeting}</div>
            <div style={{ fontSize: 13.5, color: 'var(--text-tertiary)', marginBottom: 36 }}>
              {wsName} &nbsp;·&nbsp; {docs.filter(d => !d.isFolder).length} 篇文档
            </div>
            <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-tertiary)', marginBottom: 14 }}>开始创作</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: 10, maxWidth: 720 }}>
              <CreateBtn accent
                icon={<Ico d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />}
                label="新建文档" desc="空白文档开始写作" onClick={handleCreateDoc} />
              <CreateBtn
                icon={<Ico d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />}
                label="从模板创建" desc="套用专业模板" onClick={() => dispatch(setView('templates'))} />
              <CreateBtn
                icon={<Ico d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 0 3-3h7z" />}
                label="文献库" desc="管理参考文献" onClick={() => dispatch(setView('references'))} />
              <CreateBtn
                icon={<Ico d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />}
                label="AI 助手" desc="智能写作辅助" onClick={() => dispatch(setView('ai'))} />
              <CreateBtn
                icon={<Ico d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />}
                label="演示文稿" desc="制作幻灯片" onClick={() => dispatch(setView('slides'))} />
              <CreateBtn
                icon={<Ico d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM17 13v8M13 17h8" />}
                label="白板" desc="自由绘制创意" onClick={() => dispatch(setView('whiteboard'))} />
              <CreateBtn
                icon={<Ico d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 3v6M12 15v6M3 12h6M15 12h6" />}
                label="思维导图" desc="梳理思路结构" onClick={() => dispatch(setView('mindmap'))} />
              <CreateBtn
                icon={<Ico d="M18 20V10M12 20V4M6 20v-6M3 20h18" />}
                label="写作统计" desc="查看创作数据" onClick={() => dispatch(setView('stats'))} />
              <CreateBtn
                icon={<Ico d="M6 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 11l8-4M8 13l8 4" />}
                label="关系图谱" desc="文档链接网络" onClick={() => dispatch(setView('graph'))} />
            </div>
          </motion.div>
        </div>

        {/* 内容区：左列文档，右列统计 */}
        <div style={{ padding: '32px 56px 48px', display: 'flex', gap: 40 }}>

          {/* 左列：最近文档 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.1, ease: [0.22,1,0.36,1] }}>
              {pinnedDocs.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-tertiary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span>📌</span> 置顶
                  </div>
                  {pinnedDocs.slice(0, 3).map(doc => <RecentRow key={doc.id} doc={doc} onClick={() => openDoc(doc)} />)}
                </div>
              )}
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-tertiary)', marginBottom: 8 }}>最近打开</div>
                {recentDocs.length === 0 ? (
                  <div style={{ padding: '40px 0', textAlign: 'center' as const, color: 'var(--text-tertiary)' }}>
                    <div style={{ fontSize: 36, marginBottom: 10, opacity: 0.2 }}>📄</div>
                    <div style={{ fontSize: 13.5, marginBottom: 6 }}>还没有文档</div>
                    <div style={{ fontSize: 12 }}>点击上方「新建文档」开始第一篇</div>
                  </div>
                ) : (
                  recentDocs.map(doc => <RecentRow key={doc.id} doc={doc} onClick={() => openDoc(doc)} />)
                )}
                {docs.filter(d => !d.isFolder).length > 8 && (
                  <button onClick={() => dispatch(setView('library'))}
                    style={{ marginTop: 8, padding: '8px 14px', background: 'transparent', border: '0.5px solid var(--border)', borderRadius: 8, color: 'var(--text-tertiary)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit', transition: 'background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth)' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor='rgba(200,169,110,0.35)'; (e.currentTarget as HTMLElement).style.color='var(--accent)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor='var(--border)'; (e.currentTarget as HTMLElement).style.color='var(--text-tertiary)'; }}
                  >查看全部文档库 →</button>
                )}
              </div>
            </motion.div>
          </div>

          {/* 右列：统计 + 快捷导航 */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.18, ease: [0.22,1,0.36,1] }}
            style={{ width: 210, flexShrink: 0 }}>
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-tertiary)', marginBottom: 10 }}>概览</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <StatCard icon={<Ico d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" size={15} />} label="文档总数" value={docs.filter(d => !d.isFolder).length} />
                <StatCard icon={<Ico d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" size={15} />} label="累计字数" value={totalWords >= 10000 ? `${(totalWords/10000).toFixed(1)} 万` : totalWords.toLocaleString()} />
                <StatCard icon={<Ico d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" size={15} />} label="今日更新" value={`${todayDocs} 篇`} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--text-tertiary)', marginBottom: 10 }}>导航</div>
              {[
                { d: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', label: '工作台', view: 'workbench' as const },
                { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z', label: '文档库', view: 'library' as const },
                { d: 'M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5zM16 8L2 22M17.5 15H9', label: '插件', view: 'plugins' as const },
                { d: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z', label: '云同步', view: 'cloudSync' as const },
              ].map(({ d, label, view }) => (
                <button key={view} onClick={() => dispatch(setView(view))}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 13, fontFamily: 'inherit', textAlign: 'left' as const, transition: 'background var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth)' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='var(--bg-surface2)'; (e.currentTarget as HTMLElement).style.color='var(--text-primary)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent'; (e.currentTarget as HTMLElement).style.color='var(--text-secondary)'; }}
                ><Ico d={d} size={14} />{label}</button>
              ))}
            </div>
            <WorkspaceCleanup />
          </motion.div>
        </div>
      </div>
    </div>
  );
});
