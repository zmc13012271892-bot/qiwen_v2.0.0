/**
 * CodeViewerPage.tsx — 代码查看器主页面
 */
import React, { useState, useCallback } from 'react';
import { CodeViewer } from './CodeViewer';
import { CodeSearch } from './CodeSearch';
import { exportAnnotationsToMarkdown, exportAnnotationsToHTML, exportToJSON, downloadFile } from '../../utils/exportAnnotations';
import { ipc } from '../../utils/ipc';

interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
  expanded?: boolean;
}

const FILE_ICONS: Record<string, string> = {
  ts: '🔷', tsx: '🔷', js: '🟡', jsx: '🟡', py: '🐍', go: '🐹',
  rs: '🦀', java: '☕', cpp: '⚙️', c: '⚙️', cs: '💜', rb: '💎',
  swift: '🍊', kt: '🟣', php: '🐘', md: '📝', json: '📋',
  yaml: '📋', yml: '📋', sql: '🗄️', sh: '🖥️', html: '🌐',
  css: '🎨', scss: '🎨', vue: '💚', svelte: '🧡',
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || '📄';
}

export const CodeViewerPage: React.FC = () => {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [leftPanel, setLeftPanel] = useState<'tree' | 'search'>('tree');

  const openFolder = async () => {
    const result = await ipc.invoke<any>('show-open-dialog', { properties: ['openDirectory'], title: '选择代码文件夹' });
    if (result?.canceled || !result?.filePaths?.[0]) return;
    const folderPath = result.filePaths[0];
    setRootPath(folderPath);
    setLoading(true);
    try { setTree(await scanDirectory(folderPath, 0)); }
    catch (e) { console.error('scan failed', e); }
    finally { setLoading(false); }
  };

  const openSingleFile = async () => {
    const filePath = await ipc.invoke<string | null>('fs:open-file-dialog');
    if (!filePath) return;
    openFileInTab(filePath);
  };

  const scanDirectory = async (dirPath: string, depth: number): Promise<FileNode[]> => {
    if (depth > 3) return [];
    try {
      const entries = await ipc.invoke<{ name: string; isDir: boolean; path: string }[]>('fs:list-dir', { path: dirPath });
      const filtered = (entries || []).filter(e => !['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'target'].includes(e.name));
      return filtered
        .sort((a, b) => { if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; return a.name.localeCompare(b.name); })
        .map(e => ({ name: e.name, path: e.path, isDir: e.isDir, children: e.isDir ? [] : undefined, expanded: false }));
    } catch { return []; }
  };

  const toggleDir = async (node: FileNode, pathArr: number[]) => {
    if (!node.isDir) return;
    const updateTree = (nodes: FileNode[], path: number[], depth: number): FileNode[] =>
      nodes.map((n, i) => {
        if (i !== path[depth]) return n;
        if (depth === path.length - 1) {
          const expanded = !n.expanded;
          return { ...n, expanded, children: expanded && (!n.children || n.children.length === 0) ? [] : n.children };
        }
        return { ...n, children: updateTree(n.children || [], path, depth + 1) };
      });

    if (!node.expanded && (!node.children || node.children.length === 0)) {
      const children = await scanDirectory(node.path, 1);
      setTree(prev => {
        const update = (nodes: FileNode[], path: number[], depth: number): FileNode[] =>
          nodes.map((n, i) => {
            if (i !== path[depth]) return n;
            if (depth === path.length - 1) return { ...n, expanded: true, children };
            return { ...n, children: update(n.children || [], path, depth + 1) };
          });
        return update(prev, pathArr, 0);
      });
    } else {
      setTree(prev => updateTree(prev, pathArr, 0));
    }
  };

  const openFileInTab = (filePath: string) => {
    setOpenFiles(prev => prev.includes(filePath) ? prev : [...prev, filePath]);
    setActiveTab(filePath);
    setOpenFile(filePath);
  };

  const closeTab = (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTabs = openFiles.filter(f => f !== filePath);
    setOpenFiles(newTabs);
    if (activeTab === filePath) {
      const newActive = newTabs[newTabs.length - 1] || null;
      setActiveTab(newActive);
      setOpenFile(newActive);
    }
  };

  const renderTree = (nodes: FileNode[], pathPrefix: number[] = [], depth = 0): React.ReactNode =>
    nodes.map((node, i) => {
      const currentPath = [...pathPrefix, i];
      const isActive = openFile === node.path;
      return (
        <div key={node.path}>
          <div
            onClick={() => node.isDir ? toggleDir(node, currentPath) : openFileInTab(node.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: `4px 10px 4px ${14 + depth * 14}px`,
              cursor: 'pointer', fontSize: 12.5, userSelect: 'none',
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              background: isActive ? 'var(--accent-dim, rgba(200,169,110,0.1))' : 'transparent',
              borderLeft: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
              borderRadius: '0 6px 6px 0',
              transition: 'background 0.1s',
            }}
            onMouseOver={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-surface2)'; }}
            onMouseOut={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
          >
            {node.isDir && <span style={{ fontSize: 9, opacity: 0.35, width: 10, flexShrink: 0 }}>{node.expanded ? '▼' : '▶'}</span>}
            <span style={{ fontSize: 13, flexShrink: 0 }}>{node.isDir ? (node.expanded ? '📂' : '📁') : getFileIcon(node.name)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
          </div>
          {node.isDir && node.expanded && node.children && renderTree(node.children, currentPath, depth + 1)}
        </div>
      );
    });

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: 'var(--bg-base)', color: 'var(--text-primary)', fontFamily: 'inherit' }}>

      {/* ── 左侧面板 ── */}
      <div style={{ width: 240, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>

        {/* 面板头 */}
        <div style={{ padding: '12px 12px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10, padding: '0 2px' }}>
            CODE
          </div>
          <div style={{ display: 'flex', gap: 2, marginBottom: -1 }}>
            {[{ id: 'tree', label: '文件' }, { id: 'search', label: '搜索' }].map(p => (
              <button key={p.id} onClick={() => setLeftPanel(p.id as any)} style={{
                flex: 1, padding: '6px 0', background: 'none', border: 'none',
                borderBottom: `2px solid ${leftPanel === p.id ? 'var(--accent)' : 'transparent'}`,
                color: leftPanel === p.id ? 'var(--accent)' : 'var(--text-tertiary)',
                cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', transition: 'color 0.15s',
              }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {leftPanel === 'tree' && <>
          {/* 操作栏 */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={openFolder} style={{
              flex: 1, padding: '6px 0', borderRadius: 7, border: '1px solid var(--border-md)',
              background: 'var(--bg-surface2)', color: 'var(--accent)',
              cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', fontWeight: 500,
              transition: 'background 0.15s',
            }}>
              📁 打开文件夹
            </button>
            <button onClick={openSingleFile} style={{
              padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)',
              background: 'var(--bg-surface2)', color: 'var(--text-tertiary)',
              cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
            }} title="打开单个文件">
              📄
            </button>
            {openFile && (
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowExport(v => !v)} title="导出批注" style={{
                  padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)',
                  background: showExport ? 'var(--accent-dim, rgba(200,169,110,0.12))' : 'var(--bg-surface2)',
                  color: showExport ? 'var(--accent)' : 'var(--text-tertiary)',
                  cursor: 'pointer', fontSize: 12, fontFamily: 'inherit',
                }}>↗</button>
                {showExport && (
                  <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4,
                    background: 'var(--bg-surface2)', border: '1px solid var(--border)',
                    borderRadius: 9, zIndex: 100, minWidth: 160, overflow: 'hidden',
                    boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
                  }}>
                    {[
                      { label: '导出为 Markdown', fn: () => { downloadFile(exportAnnotationsToMarkdown([], openFile.replace(/[\\\/\\\\]/g, '/').split('/').pop() || ''), 'annotations.md', 'text/markdown'); } },
                      { label: '导出为 HTML', fn: () => { downloadFile(exportAnnotationsToHTML([], openFile.replace(/[\\\/\\\\]/g, '/').split('/').pop() || ''), 'annotations.html', 'text/html'); } },
                      { label: '导出为 JSON', fn: () => { downloadFile(exportToJSON([], [], openFile.replace(/[\\\/\\\\]/g, '/').split('/').pop() || ''), 'annotations.json', 'application/json'); } },
                    ].map(item => (
                      <button key={item.label} onClick={() => { item.fn(); setShowExport(false); }} style={{
                        display: 'block', width: '100%', padding: '9px 14px', background: 'none',
                        border: 'none', color: 'var(--text-secondary)', cursor: 'pointer',
                        fontSize: 12.5, textAlign: 'left', fontFamily: 'inherit',
                        borderBottom: '1px solid var(--border)',
                      }}
                        onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-surface3)')}
                        onMouseOut={e => (e.currentTarget.style.background = 'none')}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 根目录路径 */}
          {rootPath && (
            <div style={{
              padding: '5px 12px', fontSize: 10.5, color: 'var(--text-tertiary)',
              letterSpacing: '0.5px',
              borderBottom: '1px solid var(--border)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              {rootPath.replace(/\\/g, '/').split('/').pop()}
            </div>
          )}

          {/* 文件树 */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 0' }}>
            {loading && (
              <div style={{ padding: 20, color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center', opacity: 0.6 }}>扫描目录…</div>
            )}
            {!loading && !rootPath && (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12.5, lineHeight: 2.2, opacity: 0.7 }}>
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.5 }}>📁</div>
                点击「打开文件夹」<br />开始浏览代码
              </div>
            )}
            {!loading && tree.length > 0 && renderTree(tree)}
          </div>
        </>}

        {leftPanel === 'search' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <CodeSearch rootPath={rootPath} onOpenFile={(fp, line) => {
              openFileInTab(fp);
              if (line) setTimeout(() => (window as any).__codeViewerRevealLine?.(line), 200);
            }} />
          </div>
        )}
      </div>

      {/* ── 右侧编辑区 ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-editor, #1a1a1a)' }}>
        {/* 标签栏 */}
        {openFiles.length > 0 && (
          <div style={{
            display: 'flex', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
            overflowX: 'auto', flexShrink: 0,
          }}>
            {openFiles.map(f => {
              const name = f.replace(/\\/g, '/').split('/').pop() || f;
              const isActive = activeTab === f;
              return (
                <div key={f} onClick={() => { setActiveTab(f); setOpenFile(f); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '7px 14px', cursor: 'pointer', flexShrink: 0, fontSize: 12.5,
                    background: isActive ? 'var(--bg-editor, #1a1a1a)' : 'transparent',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    borderBottom: `2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                    borderRight: '1px solid var(--border)',
                    transition: 'color 0.1s',
                  }}>
                  <span style={{ fontSize: 12 }}>{getFileIcon(name)}</span>
                  <span>{name}</span>
                  <span
                    onClick={e => closeTab(f, e)}
                    style={{ fontSize: 15, lineHeight: 1, color: 'var(--text-tertiary)', borderRadius: 3, padding: '0 1px' }}
                    onMouseOver={e => (e.currentTarget.style.color = '#e87a7a')}
                    onMouseOut={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}>
                    ×
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* 内容区 */}
        {openFile ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            <CodeViewer filePath={openFile} theme="dark" />
          </div>
        ) : (
          /* ✅ 修复：居中显示 empty state，覆盖整个右侧区域 */
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            gap: 10,
          }}>
            <div style={{
              fontSize: 48, opacity: 0.08,
              fontFamily: 'monospace', fontWeight: 700,
              letterSpacing: -2,
            }}>{'</>'}</div>
            <div style={{ fontSize: 14, color: 'var(--text-tertiary)', fontWeight: 500, opacity: 0.7, marginTop: 4 }}>打开文件夹或文件开始查看</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', opacity: 0.4 }}>点击行号可添加批注和评论</div>
            <button onClick={openFolder} style={{
              marginTop: 16, padding: '8px 20px', borderRadius: 8,
              border: '1px solid var(--border-md)', background: 'var(--bg-surface2)',
              color: 'var(--accent)', cursor: 'pointer', fontSize: 13,
              fontFamily: 'inherit', fontWeight: 500,
            }}>
              📁 打开文件夹
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
