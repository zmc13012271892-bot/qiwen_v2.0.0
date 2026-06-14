/**
 * CodeViewerPage.tsx — 代码查看器主页面
 * src/renderer/components/code/CodeViewerPage.tsx
 *
 * 左侧：文件树（支持打开文件夹，展示目录结构）
 * 右侧：CodeViewer（Monaco 只读 + 行级批注）
 */
import React, { useState, useEffect, useCallback } from 'react';
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
  const [openFiles, setOpenFiles] = useState<string[]>([]); // 标签栏
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [leftPanel, setLeftPanel] = useState<'tree' | 'search'>('tree');

  // 打开文件夹
  const openFolder = async () => {
    const result = await ipc.invoke<any>('show-open-dialog', {
      properties: ['openDirectory'],
      title: '选择代码文件夹',
    });
    if (result?.canceled || !result?.filePaths?.[0]) return;
    const folderPath = result.filePaths[0];
    setRootPath(folderPath);
    setLoading(true);
    try {
      const nodes = await scanDirectory(folderPath, 0);
      setTree(nodes);
    } catch (e) {
      console.error('scan failed', e);
    } finally {
      setLoading(false);
    }
  };

  // 打开单个文件
  const openSingleFile = async () => {
    const filePath = await ipc.invoke<string | null>('fs:open-file-dialog');
    if (!filePath) return;
    openFileInTab(filePath);
  };

  // 递归扫描目录（最多3层，跳过 node_modules/.git）
  const scanDirectory = async (dirPath: string, depth: number): Promise<FileNode[]> => {
    if (depth > 3) return [];
    try {
      const entries = await ipc.invoke<{ name: string; isDir: boolean; path: string }[]>('fs:list-dir', { path: dirPath });
      const filtered = (entries || []).filter(e => !['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'target'].includes(e.name));
      const sorted = filtered.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return sorted.map(e => ({ name: e.name, path: e.path, isDir: e.isDir, children: e.isDir ? [] : undefined, expanded: false }));
    } catch { return []; }
  };

  // 展开/折叠目录
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

  const renderTree = (nodes: FileNode[], pathPrefix: number[] = [], depth = 0) =>
    nodes.map((node, i) => {
      const currentPath = [...pathPrefix, i];
      return (
        <div key={node.path}>
          <div
            onClick={() => node.isDir ? toggleDir(node, currentPath) : openFileInTab(node.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: `3px 8px 3px ${12 + depth * 14}px`,
              cursor: 'pointer', fontSize: 12.5, color: openFile === node.path ? 'var(--accent)' : 'var(--text-secondary)',
              background: openFile === node.path ? 'rgba(200,169,110,0.1)' : 'transparent',
              borderLeft: openFile === node.path ? '2px solid var(--accent)' : '2px solid transparent',
              transition: 'background 0.1s', userSelect: 'none',
            }}
            onMouseOver={e => { if (openFile !== node.path) e.currentTarget.style.background = 'var(--bg-surface2)'; }}
            onMouseOut={e => { if (openFile !== node.path) e.currentTarget.style.background = 'transparent'; }}
          >
            {node.isDir && (
              <span style={{ fontSize: 9, opacity: 0.5, width: 10, flexShrink: 0 }}>{node.expanded ? '▼' : '▶'}</span>
            )}
            <span style={{ fontSize: 13, flexShrink: 0 }}>{node.isDir ? (node.expanded ? '📂' : '📁') : getFileIcon(node.name)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
          </div>
          {node.isDir && node.expanded && node.children && renderTree(node.children, currentPath, depth + 1)}
        </div>
      );
    });

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* 左侧文件树 */}
      <div style={{ width: 240, flexShrink: 0, background: '#161616', borderRight: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column' }}>
        {/* 面板切换 */}
        <div style={{ display: 'flex', background: '#1a1a1a', borderBottom: '1px solid #2a2a2a', flexShrink: 0 }}>
          {[{ id: 'tree', label: '📁 文件' }, { id: 'search', label: '🔍 搜索' }].map(p => (
            <button key={p.id} onClick={() => setLeftPanel(p.id as any)}
              style={{ flex: 1, padding: '7px 0', background: 'none', border: 'none', borderBottom: `2px solid ${leftPanel === p.id ? '#c8a96e' : 'transparent'}`, color: leftPanel === p.id ? '#c8a96e' : '#666', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}>
              {p.label}
            </button>
          ))}
        </div>

        {leftPanel === 'tree' && <>
        {/* 工具栏 */}
        <div style={{ padding: '10px 8px', borderBottom: '1px solid #2a2a2a', display: 'flex', gap: 6 }}>
          <button onClick={openFolder} style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: '1px solid #333', background: '#1e1e1e', color: '#c8a96e', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}>
            📁 打开文件夹
          </button>
          <button onClick={openSingleFile} style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #333', background: '#1e1e1e', color: '#888', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }} title="打开单个文件">
            📄
          </button>
          {openFile && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowExport(v => !v)}
                style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #333', background: '#1e1e1e', color: '#888', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}
                title="导出批注"
              >
                ↗
              </button>
              {showExport && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, zIndex: 100, minWidth: 140, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                  {[
                    { label: '导出为 Markdown', ext: 'md', fn: () => { const md = exportAnnotationsToMarkdown([], openFile.split(/[/\]/).pop() || ''); downloadFile(md, 'annotations.md', 'text/markdown'); }},
                    { label: '导出为 HTML', ext: 'html', fn: () => { const html = exportAnnotationsToHTML([], openFile.split(/[/\]/).pop() || ''); downloadFile(html, 'annotations.html', 'text/html'); }},
                    { label: '导出为 JSON', ext: 'json', fn: () => { const json = exportToJSON([], [], openFile.split(/[/\]/).pop() || ''); downloadFile(json, 'annotations.json', 'application/json'); }},
                  ].map(item => (
                    <button key={item.ext} onClick={() => { item.fn(); setShowExport(false); }}
                      style={{ display: 'block', width: '100%', padding: '8px 14px', background: 'none', border: 'none', color: '#c0c0b8', cursor: 'pointer', fontSize: 12, textAlign: 'left', fontFamily: 'inherit' }}
                      onMouseOver={e => (e.currentTarget.style.background = '#2a2a2a')}
                      onMouseOut={e => (e.currentTarget.style.background = 'none')}>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 根目录标题 */}
        {rootPath && (
          <div style={{ padding: '6px 10px', fontSize: 10.5, color: '#555', letterSpacing: '0.5px', textTransform: 'uppercase', borderBottom: '1px solid #1e1e1e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rootPath.split(/[/\\]/).pop()}
          </div>
        )}

        {/* 文件树 */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin' }}>
          {loading && <div style={{ padding: 16, color: '#555', fontSize: 12 }}>扫描目录…</div>}
          {!loading && !rootPath && (
            <div style={{ padding: 24, textAlign: 'center', color: '#444', fontSize: 12, lineHeight: 1.8 }}>
              打开文件夹<br />开始浏览代码
            </div>
          )}
          {!loading && tree.length > 0 && renderTree(tree)}
        </div>
        </>}

        {leftPanel === 'search' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <CodeSearch rootPath={rootPath} onOpenFile={(fp, line) => {
              openFileInTab(fp);
              // 跳转到指定行（Monaco 提供 revealLine 方法）
              if (line) setTimeout(() => (window as any).__codeViewerRevealLine?.(line), 200);
            }} />
          </div>
        )}
      </div>

      {/* 右侧编辑区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 标签栏 */}
        {openFiles.length > 0 && (
          <div style={{ display: 'flex', background: '#0f0f0f', borderBottom: '1px solid #2a2a2a', overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0 }}>
            {openFiles.map(f => {
              const name = f.split(/[/\\]/).pop() || f;
              const isActive = activeTab === f;
              return (
                <div key={f} onClick={() => { setActiveTab(f); setOpenFile(f); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', cursor: 'pointer', flexShrink: 0, fontSize: 12.5,
                    background: isActive ? '#1a1a1a' : 'transparent',
                    color: isActive ? '#e0e0d8' : '#666',
                    borderBottom: isActive ? '1px solid #c8a96e' : '1px solid transparent',
                    borderRight: '1px solid #2a2a2a',
                  }}>
                  <span>{getFileIcon(name)}</span>
                  <span>{name}</span>
                  <span onClick={e => closeTab(f, e)}
                    style={{ fontSize: 14, color: '#555', lineHeight: 1, padding: '0 2px', borderRadius: 3 }}
                    onMouseOver={e => (e.currentTarget.style.color = '#e87a7a')}
                    onMouseOut={e => (e.currentTarget.style.color = '#555')}>
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
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#444' }}>
            <div style={{ fontSize: 48 }}>{'</>'}</div>
            <div style={{ fontSize: 14, color: '#555' }}>打开文件夹或文件开始查看</div>
            <div style={{ fontSize: 12, color: '#3a3a3a' }}>点击行号可添加批注</div>
          </div>
        )}
      </div>
    </div>
  );
};
