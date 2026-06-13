/**
 * CodeViewer.tsx — 代码文件查看器 + 行级批注
 * src/renderer/components/code/CodeViewer.tsx
 *
 * 功能：
 * - 用 Monaco Editor 只读显示本地代码文件
 * - 支持 100+ 语言语法高亮（Monaco 自动检测）
 * - 行级批注：点击行号区域 → 添加批注
 * - 批注侧边栏：显示当前文件所有批注+回复
 * - 批注同步到 Supabase（需登录）或本地 SQLite（离线）
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { Monaco } from '@monaco-editor/react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { cloudSync } from '../../services/cloudSync';
import { ipc } from '../../utils/ipc';

// ── 类型 ─────────────────────────────────────────────────────────

interface Annotation {
  id: string;
  filePath: string;
  lineStart: number;
  lineEnd?: number;
  content: string;
  authorName: string;
  authorColor: string;
  createdAt: string;
  isResolved: boolean;
  replies: AnnotationReply[];
}

interface AnnotationReply {
  id: string;
  content: string;
  authorName: string;
  authorColor: string;
  createdAt: string;
}

interface Props {
  filePath: string;       // 本地文件路径
  documentId?: string;    // 关联的启文文档 ID（用于云端批注）
  theme?: 'dark' | 'light';
}

const SUPPORTED_LANGUAGES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', cpp: 'cpp', c: 'c',
  cs: 'csharp', php: 'php', rb: 'ruby', swift: 'swift', kt: 'kotlin',
  md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  html: 'html', css: 'css', scss: 'scss', less: 'less', sql: 'sql',
  sh: 'shell', bash: 'shell', zsh: 'shell', dockerfile: 'dockerfile',
  xml: 'xml', vue: 'javascript', svelte: 'javascript',
};

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const base = filePath.split('/').pop()?.toLowerCase() || '';
  if (base === 'dockerfile') return 'dockerfile';
  return SUPPORTED_LANGUAGES[ext] || 'plaintext';
}

export const CodeViewer: React.FC<Props> = ({ filePath, documentId, theme = 'dark' }) => {
  const user = useSelector((s: RootState) => s.auth.user);

  const [code, setCode] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<Annotation | null>(null);
  const [addingLine, setAddingLine] = useState<number | null>(null);
  const [newAnnotationText, setNewAnnotationText] = useState('');
  const [newReplyText, setNewReplyText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const language = detectLanguage(filePath);
  const fileName = filePath.split('/').pop() || filePath.split('\\').pop() || '';

  // 读取文件内容
  useEffect(() => {
    setLoading(true);
    setError('');
    ipc.invoke<{ content: string; error?: string }>('fs:read-file', { path: filePath })
      .then(res => {
        if (res.error) setError(res.error);
        else setCode(res.content);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [filePath]);

  // 加载批注
  const loadAnnotations = useCallback(async () => {
    if (!documentId) return;
    try {
      const data = await cloudSync.getCodeAnnotations(documentId, filePath);
      setAnnotations(data.map(normalizeAnnotation));
    } catch {}
  }, [documentId, filePath]);

  useEffect(() => { loadAnnotations(); }, [loadAnnotations]);

  // Monaco 装饰器（高亮有批注的行）
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const newDecorations = annotations
      .filter(a => !a.isResolved)
      .map(a => ({
        range: new monaco.Range(a.lineStart, 1, a.lineEnd || a.lineStart, 1),
        options: {
          isWholeLine: true,
          className: 'annotation-line',
          glyphMarginClassName: 'annotation-glyph',
          glyphMarginHoverMessage: { value: `💬 ${a.content.slice(0, 60)}${a.content.length > 60 ? '...' : ''}` },
        },
      }));

    decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
  }, [annotations]);

  // 点击行号区域 → 添加批注
  const handleEditorMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // 注入批注行样式
    monaco.editor.defineTheme('qiwen-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#1a1a1a',
        'editor.lineHighlightBackground': '#ffffff08',
        'editorGutter.background': '#161616',
      },
    });
    monaco.editor.setTheme('qiwen-dark');

    editor.onMouseDown((e: any) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
          e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS) {
        const line = e.target.position?.lineNumber;
        if (line) {
          // 检查是否点击了已有批注的行
          const existing = annotations.find(a => a.lineStart === line || a.lineEnd === line);
          if (existing) {
            setSelectedAnnotation(existing);
            setSidebarOpen(true);
          } else {
            setAddingLine(line);
            setNewAnnotationText('');
          }
        }
      }
    });
  };

  // 提交批注
  const submitAnnotation = async () => {
    if (!newAnnotationText.trim() || addingLine === null || !documentId) return;
    try {
      await cloudSync.addCodeAnnotation(documentId, filePath, addingLine, addingLine, newAnnotationText.trim());
      setAddingLine(null);
      setNewAnnotationText('');
      await loadAnnotations();
    } catch (e: any) {
      alert('批注提交失败: ' + e.message);
    }
  };

  // 提交回复
  const submitReply = async (annotationId: string) => {
    if (!newReplyText.trim()) return;
    try {
      await cloudSync.replyCodeAnnotation(annotationId, newReplyText.trim());
      setNewReplyText('');
      await loadAnnotations();
    } catch (e: any) {
      alert('回复失败: ' + e.message);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', background: '#1a1a1a', color: '#e0e0d8', fontFamily: 'inherit' }}>
      {/* 主编辑区 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* 文件头 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: '#161616', borderBottom: '1px solid #2a2a2a', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#c8a96e' }}>{fileName}</span>
          <span style={{ fontSize: 11, color: '#666', background: '#2a2a2a', padding: '1px 6px', borderRadius: 4 }}>{language}</span>
          <span style={{ fontSize: 11, color: '#555', marginLeft: 'auto' }}>{filePath}</span>
          <button onClick={() => setSidebarOpen(o => !o)} style={{ fontSize: 11, color: '#888', background: 'none', border: '1px solid #333', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>
            {sidebarOpen ? '隐藏批注' : `批注 (${annotations.filter(a => !a.isResolved).length})`}
          </button>
        </div>

        {/* 新增批注浮层 */}
        {addingLine !== null && (
          <div style={{ position: 'absolute', zIndex: 100, left: 60, background: '#252525', border: '1px solid #c8a96e44', borderRadius: 8, padding: 14, width: 360, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 12, color: '#c8a96e', marginBottom: 8 }}>第 {addingLine} 行批注</div>
            <textarea
              value={newAnnotationText}
              onChange={e => setNewAnnotationText(e.target.value)}
              autoFocus
              placeholder="写下你的批注..."
              style={{ width: '100%', height: 80, background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#e0e0d8', padding: 8, resize: 'none', fontFamily: 'inherit', fontSize: 13 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setAddingLine(null)} style={{ fontSize: 12, padding: '4px 12px', background: 'none', border: '1px solid #333', borderRadius: 6, color: '#888', cursor: 'pointer' }}>取消</button>
              <button onClick={submitAnnotation} style={{ fontSize: 12, padding: '4px 12px', background: '#c8a96e', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer' }}>添加批注</button>
            </div>
          </div>
        )}

        {/* Monaco Editor */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>加载中…</div>
        ) : error ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e87a7a' }}>{error}</div>
        ) : (
          <Editor
            value={code}
            language={language}
            theme="qiwen-dark"
            options={{
              readOnly: true,
              fontSize: 13.5,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              fontLigatures: true,
              lineNumbers: 'on',
              glyphMargin: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'off',
              renderLineHighlight: 'all',
              smoothScrolling: true,
              cursorStyle: 'line',
              renderWhitespace: 'none',
              contextmenu: false,
            }}
            onMount={handleEditorMount}
          />
        )}
      </div>

      {/* 批注侧边栏 */}
      {sidebarOpen && (
        <div style={{ width: 320, background: '#161616', borderLeft: '1px solid #2a2a2a', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a', fontSize: 13, fontWeight: 600, color: '#e0e0d8' }}>
            批注 ({annotations.filter(a => !a.isResolved).length})
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {annotations.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: '#555', fontSize: 12 }}>
                点击行号添加批注
              </div>
            )}
            {annotations.map(ann => (
              <div key={ann.id}
                onClick={() => { setSelectedAnnotation(ann === selectedAnnotation ? null : ann); editorRef.current?.revealLineInCenter(ann.lineStart); }}
                style={{ padding: '12px 16px', borderBottom: '1px solid #1e1e1e', cursor: 'pointer', background: selectedAnnotation?.id === ann.id ? '#252525' : 'transparent', opacity: ann.isResolved ? 0.45 : 1, transition: 'background 0.1s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: ann.authorColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 600, flexShrink: 0 }}>
                    {ann.authorName.slice(0, 1).toUpperCase()}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#c0c0b8' }}>{ann.authorName}</span>
                  <span style={{ fontSize: 10, color: '#555', marginLeft: 'auto' }}>L{ann.lineStart}</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#b0b0a8', lineHeight: 1.5, marginBottom: ann.replies.length > 0 ? 6 : 0 }}>{ann.content}</div>
                {ann.replies.length > 0 && (
                  <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>💬 {ann.replies.length} 条回复</div>
                )}
                {/* 展开详情 */}
                {selectedAnnotation?.id === ann.id && (
                  <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
                    {ann.replies.map(reply => (
                      <div key={reply.id} style={{ padding: '8px 0', borderTop: '1px solid #2a2a2a' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                          <div style={{ width: 18, height: 18, borderRadius: '50%', background: reply.authorColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 600 }}>
                            {reply.authorName.slice(0, 1).toUpperCase()}
                          </div>
                          <span style={{ fontSize: 11, color: '#888' }}>{reply.authorName}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: '#9a9a92', lineHeight: 1.4 }}>{reply.content}</div>
                      </div>
                    ))}
                    {user && (
                      <div style={{ marginTop: 8 }}>
                        <input
                          value={newReplyText}
                          onChange={e => setNewReplyText(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && submitReply(ann.id)}
                          placeholder="回复…"
                          style={{ width: '100%', padding: '6px 8px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 5, color: '#e0e0d8', fontSize: 12, fontFamily: 'inherit' }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        .annotation-line { background: rgba(200,169,110,0.07) !important; }
        .annotation-glyph { background: #c8a96e; border-radius: 50%; width: 8px !important; height: 8px !important; margin: 6px 4px !important; cursor: pointer; }
      `}</style>
    </div>
  );
};

function normalizeAnnotation(row: any): Annotation {
  return {
    id: row.id, filePath: row.file_path, lineStart: row.line_start, lineEnd: row.line_end,
    content: row.content, isResolved: row.is_resolved,
    authorName: row.user_profiles?.display_name || '未知',
    authorColor: row.user_profiles?.avatar_color || '#c8a96e',
    createdAt: row.created_at,
    replies: (row.code_annotation_replies || []).map((r: any) => ({
      id: r.id, content: r.content, createdAt: r.created_at,
      authorName: r.user_profiles?.display_name || '未知',
      authorColor: r.user_profiles?.avatar_color || '#c8a96e',
    })),
  };
}
