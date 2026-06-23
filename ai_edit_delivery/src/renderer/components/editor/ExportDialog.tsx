import React, { useState, useEffect, useRef } from 'react';
import { autoSave } from '../../utils/autoSave';
import { htmlToMarkdown } from '../../utils/markdownConvert';

// ── 类型 ──────────────────────────────────────────────────────
export type ExportFormat = 'docx' | 'pdf' | 'md' | 'txt' | 'html';

interface ExportOptions {
  format: ExportFormat;
  path: string;           // 仅作展示用（实际路径由主进程 dialog 决定）
  includeTitle: boolean;
  includeMeta: boolean;   // 包含字数/日期等元信息
  pageSize: 'A4' | 'A3' | 'Letter';
  theme: 'light' | 'dark' | 'elegant'; // PDF 主题
}

interface ExportDialogProps {
  docId: string;
  docTitle: string;
  docContent: string;
  wordCount?: number;
  onClose: () => void;
}

// ── 格式配置 ──────────────────────────────────────────────────
const FORMATS: { id: ExportFormat; label: string; ext: string; desc: string; icon: React.ReactNode }[] = [
  {
    id: 'docx',
    label: 'Word',
    ext: '.docx',
    desc: '兼容 Microsoft Word',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <path d="M9 13l2 4 2-4"/>
      </svg>
    ),
  },
  {
    id: 'pdf',
    label: 'PDF',
    ext: '.pdf',
    desc: '高保真排版输出',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="9" y1="13" x2="15" y2="13"/>
        <line x1="9" y1="17" x2="13" y2="17"/>
      </svg>
    ),
  },
  {
    id: 'md',
    label: 'Markdown',
    ext: '.md',
    desc: '纯文本标记格式',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="5" width="18" height="14" rx="2"/>
        <path d="M7 15V9l2 2 2-2v6"/>
        <path d="M17 11l-2 2-2-2"/>
        <path d="M15 13v2"/>
      </svg>
    ),
  },
  {
    id: 'txt',
    label: '纯文本',
    ext: '.txt',
    desc: '无格式纯文本',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="8" y1="13" x2="16" y2="13"/>
        <line x1="8" y1="17" x2="16" y2="17"/>
        <line x1="10" y1="9" x2="14" y2="9"/>
      </svg>
    ),
  },
  {
    id: 'html',
    label: 'HTML',
    ext: '.html',
    desc: '网页格式，可直接打开',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
  },
];

// ── HTML → Markdown 转换已抽到 ../../utils/markdownConvert.ts，两处共用 ──

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── 主组件 ───────────────────────────────────────────────────
export const ExportDialog: React.FC<ExportDialogProps> = ({
  docId, docTitle, docContent, wordCount = 0, onClose,
}) => {
  const [format, setFormat] = useState<ExportFormat>('docx');
  const [includeTitle, setIncludeTitle] = useState(true);
  const [includeMeta, setIncludeMeta] = useState(false);
  const [pageSize, setPageSize] = useState<'A4' | 'A3' | 'Letter'>('A4');
  const [pdfTheme, setPdfTheme] = useState<'light' | 'dark' | 'elegant'>('light');
  const [status, setStatus] = useState<'idle' | 'saving' | 'exporting' | 'done' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // 入场动画
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleClose = () => {
    setMounted(false);
    setTimeout(onClose, 240);
  };

  const selectedFmt = FORMATS.find(f => f.id === format)!;
  const api = (window as any).electronAPI;

  const handleExport = async () => {
    setStatus('saving');
    setErrorMsg('');

    try {
      // 先把编辑器内容 flush 到 DB
      await autoSave.flush(docId);
      setStatus('exporting');

      const title = docTitle || '无标题';
      const html = docContent || '';
      const now = new Date().toLocaleString('zh-CN');

      if (format === 'docx') {
        if (!api?.invoke) throw new Error('请在桌面客户端使用导出功能');
        const result = await api.invoke('documents:export-docx', {
          id: docId, title, html,
          includeTitle, includeMeta, meta: { wordCount, exportTime: now },
        });
        if (result?.canceled) { setStatus('idle'); return; }
        if (!result?.success) throw new Error(result?.error || '导出失败');

      } else if (format === 'pdf') {
        if (!api?.invoke) throw new Error('请在桌面客户端使用导出功能');
        const result = await api.invoke('documents:export-pdf', {
          id: docId, title, html,
          includeTitle, includeMeta,
          pageSize, theme: pdfTheme,
          meta: { wordCount, exportTime: now },
        });
        if (result?.canceled) { setStatus('idle'); return; }
        if (!result?.success) throw new Error(result?.error || '导出失败');

      } else if (format === 'md') {
        const md = (includeTitle ? `# ${title}\n\n` : '') +
          (includeMeta ? `> 字数：${wordCount}　导出时间：${now}\n\n` : '') +
          htmlToMarkdown(html);
        await triggerBrowserDownload(`${title}.md`, md, 'text/markdown;charset=utf-8');

      } else if (format === 'txt') {
        const txt = (includeTitle ? `${title}\n${'='.repeat(title.length * 2)}\n\n` : '') +
          (includeMeta ? `字数：${wordCount}　导出时间：${now}\n\n` : '') +
          htmlToPlainText(html);
        await triggerBrowserDownload(`${title}.txt`, txt, 'text/plain;charset=utf-8');

      } else if (format === 'html') {
        const metaBlock = includeMeta
          ? `<div style="margin-bottom:24px;padding:12px 16px;background:#f9f6f1;border-radius:8px;font-size:13px;color:#888">字数：${wordCount} &nbsp;·&nbsp; 导出时间：${now}</div>`
          : '';
        const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  body{font-family:'Noto Serif SC','Georgia',serif;max-width:760px;margin:48px auto;line-height:1.85;color:#1a1a1a;font-size:15px;padding:0 24px}
  h1{font-size:2em;font-weight:300;margin:0 0 .5em;border-bottom:1px solid #e8e0d0;padding-bottom:.4em}
  h2{font-size:1.5em;font-weight:400;margin:1.6em 0 .4em}
  h3{font-size:1.2em;margin:1.3em 0 .3em}
  p{margin:0 0 .8em}
  blockquote{border-left:3px solid #c8a96e;padding:4px 0 4px 16px;color:#666;margin:1em 0}
  code{background:#f4f2ee;padding:2px 6px;border-radius:4px;font-size:.88em;font-family:'Courier New',monospace}
  pre{background:#f4f2ee;padding:14px 18px;border-radius:8px;overflow-x:auto}
  table{border-collapse:collapse;width:100%;margin:1em 0}
  th,td{border:1px solid #e0d8cc;padding:8px 12px;text-align:left}
  th{background:#faf7f3;font-weight:500}
  img{max-width:100%;border-radius:4px}
  a{color:#c8a96e;text-decoration:none}
  a:hover{text-decoration:underline}
</style>
</head>
<body>
${includeTitle ? `<h1>${title}</h1>` : ''}
${metaBlock}
${html}
</body>
</html>`;
        await triggerBrowserDownload(`${title}.html`, fullHtml, 'text/html;charset=utf-8');
      }

      setStatus('done');
      setTimeout(() => handleClose(), 1200);

    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e?.message || '导出失败，请重试');
    }
  };

  const triggerBrowserDownload = async (filename: string, content: string, mimeType: string) => {
    // 优先用 Electron 主进程系统对话框
    if (api?.invoke) {
      const result = await api.invoke('show-save-dialog', {
        title: '保存文件',
        defaultPath: filename,
        filters: [{ name: '文件', extensions: [filename.split('.').pop() || '*'] }],
      });
      if (result?.canceled || !result?.filePath) { setStatus('idle'); return; }
      await api.invoke('fs:write-file', { path: result.filePath, content });
    } else {
      // 浏览器降级
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  const isPdfFormat = format === 'pdf';
  const busy = status === 'saving' || status === 'exporting';

  // ── Toggle 组件 ────────────────────────────────────────────
  const Toggle: React.FC<{ on: boolean; onChange: () => void; disabled?: boolean }> = ({ on, onChange, disabled }) => (
    <div
      onClick={() => !disabled && onChange()}
      style={{
        width: 36, height: 20, borderRadius: 10, cursor: disabled ? 'default' : 'pointer',
        background: on ? 'linear-gradient(135deg, #c8a96e, #9a7040)' : 'var(--bg-surface3)',
        border: `0.5px solid ${on ? 'transparent' : 'var(--border-md)'}`,
        position: 'relative', transition: 'all .22s', flexShrink: 0,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: on ? 18 : 2, width: 16, height: 16,
        borderRadius: '50%', background: '#fff',
        transition: 'left .22s cubic-bezier(.4,0,.2,1)',
        boxShadow: '0 1px 4px rgba(0,0,0,.25)',
      }} />
    </div>
  );

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) handleClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(10,10,18,0.65)',
        backdropFilter: 'blur(14px)',
        transition: 'opacity .24s',
        opacity: mounted ? 1 : 0,
      }}
    >
      <div style={{
        width: 520, maxHeight: '88vh',
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-md)',
        borderRadius: 20,
        boxShadow: '0 32px 80px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(200,169,110,0.08)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transform: mounted ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(12px)',
        transition: 'transform .28s cubic-bezier(.22,1,.36,1), opacity .24s',
        opacity: mounted ? 1 : 0,
      }}>

        {/* ── 头部 ──────────────────────────────────────────── */}
        <div style={{
          padding: '22px 24px 18px',
          borderBottom: '0.5px solid var(--border)',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
              {/* 导出图标 */}
              <div style={{
                width: 32, height: 32, borderRadius: 9,
                background: 'linear-gradient(135deg, rgba(200,169,110,0.18), rgba(154,112,64,0.10))',
                border: '0.5px solid rgba(200,169,110,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#c8a96e', flexShrink: 0,
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: -.2 }}>
                  导出文档
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 1 }}>
                  {docTitle || '无标题'}
                  {wordCount > 0 && <span style={{ marginLeft: 8, opacity: 0.7 }}>· {wordCount.toLocaleString()} 字</span>}
                </div>
              </div>
            </div>
          </div>
          <button onClick={handleClose} style={{
            width: 28, height: 28, borderRadius: 8, border: 'none',
            background: 'var(--bg-surface3)', cursor: 'pointer',
            color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .15s, color .15s', flexShrink: 0,
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface3)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-tertiary)'; }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── 内容区 ───────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* 格式选择 */}
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>
              导出格式
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
              {FORMATS.map(fmt => {
                const active = format === fmt.id;
                return (
                  <button key={fmt.id} onClick={() => setFormat(fmt.id)} style={{
                    padding: '12px 8px 10px',
                    background: active ? 'linear-gradient(135deg, rgba(200,169,110,0.14), rgba(154,112,64,0.08))' : 'var(--bg-surface2)',
                    border: `1px solid ${active ? 'rgba(200,169,110,0.45)' : 'var(--border)'}`,
                    borderRadius: 11, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    transition: 'all .16s',
                    color: active ? '#c8a96e' : 'var(--text-secondary)',
                    boxShadow: active ? '0 2px 12px rgba(200,169,110,0.12)' : 'none',
                  }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,169,110,0.25)'; }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
                  >
                    <div style={{ color: active ? '#c8a96e' : 'var(--text-tertiary)', transition: 'color .16s' }}>{fmt.icon}</div>
                    <div style={{ fontSize: 12, fontWeight: active ? 600 : 400, letterSpacing: .2 }}>{fmt.label}</div>
                    <div style={{ fontSize: 9.5, color: active ? 'rgba(200,169,110,0.7)' : 'var(--text-tertiary)', textAlign: 'center', lineHeight: 1.3, letterSpacing: .1 }}>
                      {fmt.ext}
                    </div>
                  </button>
                );
              })}
            </div>
            {/* 格式描述 */}
            <div style={{
              marginTop: 8, padding: '8px 12px',
              background: 'rgba(200,169,110,0.05)',
              border: '0.5px solid rgba(200,169,110,0.15)',
              borderRadius: 8, fontSize: 12, color: 'var(--text-tertiary)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ color: 'rgba(200,169,110,0.6)' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </span>
              {selectedFmt.desc}
            </div>
          </div>

          {/* 分割线 */}
          <div style={{ height: '0.5px', background: 'var(--border)', marginBottom: 20 }} />

          {/* 导出选项 */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>
              内容选项
            </div>

            {/* 包含标题 */}
            <div onClick={() => setIncludeTitle(v => !v)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '11px 14px', borderRadius: 10, cursor: 'pointer',
              background: 'var(--bg-surface2)', border: '0.5px solid var(--border)',
              marginBottom: 8, transition: 'background .12s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface3)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface2)'; }}
            >
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>包含文档标题</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 2 }}>在文档开头插入大标题</div>
              </div>
              <Toggle on={includeTitle} onChange={() => setIncludeTitle(v => !v)} />
            </div>

            {/* 包含元信息 */}
            <div onClick={() => setIncludeMeta(v => !v)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '11px 14px', borderRadius: 10, cursor: 'pointer',
              background: 'var(--bg-surface2)', border: '0.5px solid var(--border)',
              marginBottom: 8, transition: 'background .12s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface3)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface2)'; }}
            >
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>包含文档信息</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 2 }}>附加字数统计和导出时间</div>
              </div>
              <Toggle on={includeMeta} onChange={() => setIncludeMeta(v => !v)} />
            </div>
          </div>

          {/* PDF 专属选项 */}
          {isPdfFormat && (
            <>
              <div style={{ height: '0.5px', background: 'var(--border)', marginBottom: 20 }} />
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>
                  PDF 选项
                </div>

                {/* 页面尺寸 */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 7, fontWeight: 500 }}>页面尺寸</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {(['A4', 'A3', 'Letter'] as const).map(size => (
                      <button key={size} onClick={() => setPageSize(size)} style={{
                        flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${pageSize === size ? 'rgba(200,169,110,0.5)' : 'var(--border)'}`,
                        background: pageSize === size ? 'rgba(200,169,110,0.1)' : 'var(--bg-surface2)',
                        color: pageSize === size ? '#c8a96e' : 'var(--text-secondary)',
                        fontSize: 12.5, fontWeight: pageSize === size ? 600 : 400,
                        fontFamily: 'inherit', transition: 'all .15s',
                      }}>
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                {/* PDF 主题 */}
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 7, fontWeight: 500 }}>排版主题</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {([
                      { id: 'light',   label: '明亮',   desc: '白底黑字' },
                      { id: 'elegant', label: '典雅',   desc: '米白背景' },
                      { id: 'dark',    label: '暗黑',   desc: '深色背景' },
                    ] as const).map(t => (
                      <button key={t.id} onClick={() => setPdfTheme(t.id)} style={{
                        flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer',
                        border: `1px solid ${pdfTheme === t.id ? 'rgba(200,169,110,0.5)' : 'var(--border)'}`,
                        background: pdfTheme === t.id ? 'rgba(200,169,110,0.1)' : 'var(--bg-surface2)',
                        color: pdfTheme === t.id ? '#c8a96e' : 'var(--text-secondary)',
                        fontFamily: 'inherit', transition: 'all .15s', display: 'flex',
                        flexDirection: 'column', alignItems: 'center', gap: 2,
                      }}>
                        <span style={{ fontSize: 12.5, fontWeight: pdfTheme === t.id ? 600 : 400 }}>{t.label}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{t.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 错误提示 */}
          {status === 'error' && (
            <div style={{
              padding: '10px 14px', borderRadius: 10, marginBottom: 16,
              background: 'rgba(232,122,122,0.08)',
              border: '0.5px solid rgba(232,122,122,0.3)',
              fontSize: 12.5, color: '#e87a7a',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              {errorMsg}
            </div>
          )}
        </div>

        {/* ── 底部操作栏 ──────────────────────────────────── */}
        <div style={{
          padding: '16px 24px',
          borderTop: '0.5px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, background: 'var(--bg-surface)',
        }}>
          {/* 左侧提示 */}
          <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            {status === 'saving'   && <span style={{ color: '#7ab8e8' }}>正在保存…</span>}
            {status === 'exporting' && <span style={{ color: '#c8a96e' }}>正在导出…</span>}
            {status === 'done'     && <span style={{ color: '#48c78e' }}>✓ 导出成功</span>}
            {status === 'idle'     && `选择路径后导出为 ${selectedFmt.ext}`}
            {status === 'error'    && <span style={{ color: '#e87a7a' }}>导出失败</span>}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleClose} disabled={busy} style={{
              height: 36, padding: '0 18px', borderRadius: 10,
              border: '0.5px solid var(--border-md)',
              background: 'transparent', color: 'var(--text-secondary)',
              cursor: busy ? 'not-allowed' : 'pointer', fontSize: 13,
              fontFamily: 'inherit', transition: 'background .12s',
              opacity: busy ? 0.5 : 1,
            }}
              onMouseEnter={e => { if (!busy) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >取消</button>

            <button onClick={handleExport} disabled={busy || status === 'done'} style={{
              height: 36, padding: '0 22px', borderRadius: 10,
              border: 'none',
              background: busy || status === 'done'
                ? 'rgba(200,169,110,0.35)'
                : 'linear-gradient(135deg, #c8a96e, #9a7040)',
              color: '#fff', cursor: busy || status === 'done' ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'opacity .15s, transform .1s',
              boxShadow: busy || status === 'done' ? 'none' : '0 2px 12px rgba(200,169,110,0.3)',
            }}
              onMouseEnter={e => { if (!busy && status !== 'done') (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; }}
            >
              {busy ? (
                <>
                  <div style={{
                    width: 13, height: 13, borderRadius: '50%',
                    border: '2px solid rgba(255,255,255,0.35)',
                    borderTopColor: '#fff',
                    animation: 'spin .7s linear infinite',
                  }} />
                  {status === 'saving' ? '准备中…' : '导出中…'}
                </>
              ) : status === 'done' ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  完成
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  选择路径并导出
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};
