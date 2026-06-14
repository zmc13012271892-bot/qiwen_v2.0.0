import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { closeTab, setActiveTab, setView } from '../../store/slices/appSlice';
import { fetchDocument, updateDocument } from '../../store/slices/documentsSlice';
import { MarkdownEditor } from './MarkdownEditor';
import { TabBar } from './TabBar';
import { EditorToolbar } from './EditorToolbar';
import { RightPanel } from '../sidebar/RightPanel';
import { DocumentTitle } from './DocumentTitle';
import { FindReplaceBar } from './FindReplaceBar';
import { toggleFocusMode } from '../../store/slices/appSlice';

import { useT } from '../../i18n';

export type EditorMode = 'edit' | 'preview' | 'focus';

export const EditorArea: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const T = useT();
  const { tabs, activeTabId, rightPanelOpen, focusMode } = useSelector((s: RootState) => s.app);
  const openDocuments = useSelector((s: RootState) => s.documents.openDocuments);
  const failedDocIds = useSelector((s: RootState) => s.documents.failedDocIds);
  const saving = useSelector((s: RootState) => s.documents.saving);
  const [mode, setMode] = useState<EditorMode>('edit');
  // 协作模式：登录后默认开启，用户可手动关闭（null = 跟随默认）
  const user = useSelector((s: RootState) => (s as any).auth?.user);
  const isLocalMode = useSelector((s: RootState) => (s as any).auth?.isLocalMode);
  const [collabOverride, setCollabOverride] = useState<boolean | null>(null);
  const isCollabOn = collabOverride !== null ? collabOverride : (!!user && !isLocalMode);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const activeDoc = activeTab ? openDocuments[activeTab.documentId] : null;
  const isSaving = activeTabId ? saving[activeTabId] : false;

  useEffect(() => {
    if (activeTab && !openDocuments[activeTab.documentId]) {
      dispatch(fetchDocument(activeTab.documentId));
    }
  }, [activeTab?.documentId]); // eslint-disable-line

  // 文档加载重试：2秒后若仍未加载成功则再试一次，不自动关闭tab
  useEffect(() => {
    if (!activeTab) return;
    const retryTimer = setTimeout(() => {
      if (!openDocuments[activeTab.documentId]) {
        dispatch(fetchDocument(activeTab.documentId));
      }
    }, 2000);
    return () => clearTimeout(retryTimer);
  }, [activeTab?.id]); // eslint-disable-line

  const handleTitleChange = useCallback(async (title: string) => {
    if (!activeDoc) return;
    await dispatch(updateDocument({ id: activeDoc.id, title }));
  }, [activeDoc, dispatch]);

  const handleModeChange = (newMode: EditorMode) => {
    setMode(newMode);
    // 进入专注模式且当前不在专注模式时触发
    if (newMode === 'focus' && !focusMode) {
      dispatch(toggleFocusMode());
    }
    // 离开专注模式且当前在专注模式时恢复
    else if (newMode !== 'focus' && focusMode) {
      dispatch(toggleFocusMode());
    }
  };

  if (tabs.length === 0) {
    return <EmptyEditor />;
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TabBar />
        <EditorToolbar isSaving={isSaving} mode={mode} onModeChange={handleModeChange} />

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          <AnimatePresence>
            {activeDoc ? (
              <motion.div
                key={activeDoc.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              >
                {/* 预览模式 */}
                {mode === 'preview' ? (
                  <div style={{ flex:1, overflow:'auto', padding:'48px 64px', maxWidth:'calc(660px + 128px)', margin:'0 auto', width:'100%' }}>
                    <h1 style={{ fontSize:'2em', fontWeight:300, marginBottom:32, fontFamily:'var(--font-serif)', color:'var(--text-primary)' }}>
                      {activeDoc.title}
                    </h1>
                    <div
                      className="preview-content"
                      dangerouslySetInnerHTML={{ __html: activeDoc.content || '<p style="color:var(--text-tertiary)"></p>' }}
                      style={{ color:'var(--text-secondary)', lineHeight:1.85, fontSize:15, fontFamily:'var(--font-sans)' }}
                    />
                  </div>
                ) : (
                  <>
                    {/* 查找替换浮层 */}
                    <FindReplaceBar />
                    <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
                    <div style={{
                      padding: '32px 64px 0',
                      maxWidth: 'calc(660px + 128px)',
                      margin: '0 auto', width: '100%',
                    }}>
                      <DocumentTitle
                        title={activeDoc.title}
                        onChange={handleTitleChange}
                        tags={activeDoc.tags}
                        updatedAt={activeDoc.updatedAt}
                      />
                    </div>
                    {/* 协作开关按钮（右下角，仅登录后显示） */}
                    {user && !isLocalMode && (
                      <div style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 30 }}>
                        <button
                          onClick={() => setCollabOverride(v => v === null ? !isCollabOn : !v)}
                          title={isCollabOn ? '点击关闭实时协作' : '点击开启实时协作'}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '5px 11px', borderRadius: 20, fontSize: 11.5,
                            border: `1px solid ${isCollabOn ? 'rgba(82,201,122,0.35)' : 'var(--border)'}`,
                            background: isCollabOn ? 'rgba(82,201,122,0.08)' : 'var(--bg-surface2)',
                            color: isCollabOn ? '#52c97a' : 'var(--text-tertiary)',
                            cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
                          }}
                        >
                          <div style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: isCollabOn ? '#52c97a' : 'var(--text-tertiary)',
                            animation: isCollabOn ? 'pulse 2s infinite' : 'none',
                          }} />
                          {isCollabOn ? '协作中' : '本地模式'}
                        </button>
                      </div>
                    )}
                    <MarkdownEditor
                      documentId={activeDoc.id}
                      collaborationEnabled={isCollabOn}
                    />
                  </>
                )}
              </motion.div>
            ) : activeTab && failedDocIds[activeTab.documentId] ? (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column', gap: 12, color: 'var(--text-tertiary)' }}
              >
                <div style={{ fontSize: 28 }}>⚠️</div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{T('editor.docFailed')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>{T('editor.docNotFound')}</div>
                <button
                  onClick={() => dispatch(fetchDocument(activeTab.documentId))}
                  style={{ marginTop: 8, fontSize: 12, color: 'var(--accent)', background: 'none',
                    border: '1px solid var(--accent)', borderRadius: 8, padding: '5px 14px', cursor: 'pointer' }}
                >
                  {T('common.retry')}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'column', gap: 12, color: 'var(--text-tertiary)' }}
              >
                <div style={{ width: 24, height: 24, borderRadius: '50%',
                  border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
                  animation: 'spin 0.7s linear infinite' }} />
                <div style={{ fontSize: 13 }}>{T('common.loading')}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {rightPanelOpen && !focusMode && mode !== 'focus' && (
          <motion.div
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 20, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <RightPanel documentId={activeDoc?.id} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const EmptyEditor: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const T = useT();

  const shortcuts = [
    { keys: 'Ctrl+N', label: T('sidebar.newDoc') },
    { keys: 'Ctrl+K', label: T('sidebar.search') },
    { keys: 'Ctrl+\\', label: T('editor.toggleSidebar') },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-tertiary)' }}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 0.3 }}
        transition={{ delay: 0.1, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        style={{ width: 64, height: 64,
          background: 'linear-gradient(135deg, #c8a96e, #8b7355)',
          borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32, color: '#fff', fontFamily: 'var(--font-serif)', marginBottom: 24 }}
      >文</motion.div>

      <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        style={{ fontSize: 17, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 300 }}>
        欢迎使用启文
      </motion.div>
      <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.25 }}
        style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 40 }}>
        选择或新建一篇文档开始创作
      </motion.div>

      <motion.div initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        {shortcuts.map((s, i) => (
          <motion.div key={s.keys}
            initial={{ x: -10, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.35 + i * 0.05 }}
            style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <kbd style={{ background: 'var(--bg-surface2)', border: '0.5px solid var(--border)',
              borderRadius: 6, padding: '3px 8px', fontSize: 12,
              fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', minWidth: 52,
              textAlign: 'center' as const }}>
              {s.keys}
            </kbd>
            <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{s.label}</span>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
};
