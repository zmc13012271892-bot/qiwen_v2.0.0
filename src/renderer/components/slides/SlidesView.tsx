import React, { useState, useCallback, useRef, useEffect, useReducer } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';
import { RootState, AppDispatch } from '../../store';
import {
  fetchPresentations, fetchPresentation, createPresentation, deletePresentation,
  updatePresentationMeta, saveAllSlides,
  setActiveSlideIndex, closePresentation,
  updateSlideLocal, addSlideLocal, deleteSlideLocal, moveSlideLocal,
  Slide, SlideLayout, SlideContent, Presentation,
} from '../../store/slices/presentationsSlice';
import { createDocument, updateDocument } from '../../store/slices/documentsSlice';
import { setView, openTab } from '../../store/slices/appSlice';

// ─────────────────────────────────────────────────────────────
// 主题系统
// ─────────────────────────────────────────────────────────────
const THEMES = {
  dark:      { bg: '#0d1117', surface: '#161b22', accent: '#c8a96e', text: '#e6edf3', sub: '#8b949e', border: 'rgba(255,255,255,0.1)',  card: '#1c2128' },
  light:     { bg: '#ffffff', surface: '#f6f8fa', accent: '#0969da', text: '#24292f', sub: '#57606a', border: 'rgba(0,0,0,0.12)',      card: '#f0f2f5' },
  minimal:   { bg: '#fafaf8', surface: '#f0efea', accent: '#3d3d3d', text: '#1a1a1a', sub: '#666666', border: 'rgba(0,0,0,0.08)',      card: '#f0efea' },
  corporate: { bg: '#1a2035', surface: '#222d45', accent: '#4488ff', text: '#e8eaf0', sub: '#8892a4', border: 'rgba(255,255,255,0.1)', card: '#2a3550' },
  nature:    { bg: '#1a2d1a', surface: '#223322', accent: '#52c97a', text: '#e0f0e0', sub: '#7a9e7a', border: 'rgba(255,255,255,0.1)', card: '#2a3f2a' },
  rose:      { bg: '#2a1520', surface: '#3d1f2a', accent: '#e87abf', text: '#f0e0e8', sub: '#a87890', border: 'rgba(255,255,255,0.1)', card: '#4a2535' },
} as const;
type ThemeKey = keyof typeof THEMES;
const THEME_LABELS: Record<ThemeKey, string> = { dark:'暗黑', light:'明亮', minimal:'极简', corporate:'商务', nature:'自然', rose:'玫瑰' };

const LAYOUTS: { id: SlideLayout; label: string; icon: React.ReactNode }[] = [
  { id:'title',   label:'标题页', icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="8" width="18" height="4" rx="1"/><rect x="7" y="14" width="10" height="2" rx="1" opacity=".4"/></svg> },
  { id:'content', label:'内容',   icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="10" x2="17" y2="10" opacity=".7"/><line x1="3" y1="14" x2="14" y2="14" opacity=".5"/><line x1="3" y1="18" x2="11" y2="18" opacity=".3"/></svg> },
  { id:'two-col', label:'两栏',   icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="8" height="16" rx="1"/><rect x="13" y="4" width="8" height="16" rx="1"/></svg> },
  { id:'section', label:'章节',   icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="7" x2="12" y2="7" opacity=".5"/></svg> },
  { id:'image',   label:'图文',   icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="14" rx="2"/><polyline points="3 14 8 9 13 13"/><circle cx="15" cy="8" r="1.5"/></svg> },
  { id:'blank',   label:'空白',   icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/></svg> },
];

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

// HTML → 纯文本段落数组
function htmlToTextBlocks(html: string): { type: string; text: string; level?: number }[] {
  const div = document.createElement('div');
  div.innerHTML = html;
  const blocks: { type: string; text: string; level?: number }[] = [];
  div.childNodes.forEach((node: any) => {
    const tag = node.tagName?.toLowerCase();
    const text = node.textContent?.trim() || '';
    if (!text) return;
    if (tag?.match(/^h([1-6])$/)) blocks.push({ type: 'heading', text, level: parseInt(tag[1]) });
    else if (tag === 'p') blocks.push({ type: 'paragraph', text });
    else if (tag === 'ul' || tag === 'ol') {
      node.querySelectorAll('li').forEach((li: any) => {
        const t = li.textContent?.trim();
        if (t) blocks.push({ type: 'listitem', text: t });
      });
    }
  });
  return blocks;
}

// 文档块 → 幻灯片数组
function docBlocksToSlides(blocks: { type: string; text: string; level?: number }[], presentationId: string): Slide[] {
  const slides: Slide[] = [];
  let currentSlide: Partial<Slide> | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (!currentSlide) return;
    const now = Date.now();
    slides.push({
      id: uuidv4(), presentationId,
      sortOrder: slides.length, layout: currentSlide.layout || 'content',
      content: { ...currentSlide.content, body: bodyLines.join('\n') },
      notes: '', createdAt: now, updatedAt: now,
    } as Slide);
    currentSlide = null;
    bodyLines = [];
  };

  blocks.forEach((b, i) => {
    if (b.type === 'heading' && (b.level === 1 || b.level === 2)) {
      flush();
      currentSlide = {
        layout: i === 0 ? 'title' : 'content',
        content: i === 0
          ? { title: b.text, subtitle: '' }
          : { title: b.text, body: '' },
      };
    } else if (b.type === 'heading' && b.level === 3) {
      flush();
      currentSlide = { layout: 'section', content: { sectionLabel: 'SECTION', title: b.text } };
    } else if (currentSlide) {
      if (b.type === 'listitem') bodyLines.push('• ' + b.text);
      else if (b.type === 'paragraph') bodyLines.push(b.text);
    }
  });
  flush();

  // 如果没有任何幻灯片，创建一个默认的
  if (slides.length === 0) {
    const now = Date.now();
    slides.push({ id: uuidv4(), presentationId, sortOrder: 0, layout: 'title', content: { title: '演示文稿', subtitle: '' }, notes: '', createdAt: now, updatedAt: now });
  }
  return slides;
}

// 幻灯片 → 文档 HTML
function slidesToHtml(slides: Slide[], title: string): string {
  let html = `<h1>${title}</h1>`;
  slides.forEach((s, i) => {
    const c = s.content;
    if (s.layout === 'title') {
      if (i === 0) {
        if (c.subtitle) html += `<p>${c.subtitle}</p>`;
      } else {
        html += `<h2>${c.title || '幻灯片 ' + (i + 1)}</h2>`;
        if (c.subtitle) html += `<p>${c.subtitle}</p>`;
      }
    } else if (s.layout === 'section') {
      html += `<h2>${c.title || ''}</h2>`;
      if (c.body) html += `<p>${c.body}</p>`;
    } else if (s.layout === 'two-col') {
      if (c.title) html += `<h3>${c.title}</h3>`;
      if (c.leftBody || c.rightBody) html += `<p>${[c.leftBody, c.rightBody].filter(Boolean).join(' ')}</p>`;
    } else {
      if (c.title) html += `<h3>${c.title}</h3>`;
      if (c.body) {
        const lines = c.body.split('\n').filter(Boolean);
        if (lines.some((l: string) => l.startsWith('• '))) {
          html += '<ul>' + lines.map((l: string) => `<li>${l.replace(/^•\s*/, '')}</li>`).join('') + '</ul>';
        } else {
          html += `<p>${c.body}</p>`;
        }
      }
    }
  });
  return html;
}

// ─────────────────────────────────────────────────────────────
// 撤销/重做 Hook
// ─────────────────────────────────────────────────────────────
function useHistory<T>(initial: T) {
  const [idx, setIdx] = useState(0);
  const history = useRef<T[]>([initial]);

  const push = useCallback((val: T) => {
    history.current = history.current.slice(0, idx + 1);
    history.current.push(val);
    setIdx(history.current.length - 1);
  }, [idx]);

  const undo = useCallback(() => {
    if (idx > 0) { setIdx(i => i - 1); return history.current[idx - 1]; }
    return history.current[0];
  }, [idx]);

  const redo = useCallback(() => {
    if (idx < history.current.length - 1) { setIdx(i => i + 1); return history.current[idx + 1]; }
    return history.current[idx];
  }, [idx]);

  return { current: history.current[idx], push, undo, redo, canUndo: idx > 0, canRedo: idx < history.current.length - 1 };
}

// ─────────────────────────────────────────────────────────────
// 幻灯片渲染器
// ─────────────────────────────────────────────────────────────
const SlideRenderer: React.FC<{
  slide: Slide; theme: ThemeKey; scale?: number;
  isEditing?: boolean; onContentChange?: (c: Partial<SlideContent>) => void;
  fontSize?: number;
}> = ({ slide, theme: tk, scale = 1, isEditing = false, onContentChange, fontSize = 1 }) => {
  const t = THEMES[tk] || THEMES.dark;
  const { content: c, layout } = slide;
  const fs = fontSize;

  // 幻灯片级别颜色覆盖
  const effectiveAccent = (c as any)?.accentColor || t.accent;
  const bgOverride = (c as any)?.bgColor && (c as any).bgColor !== 'transparent' ? (c as any).bgColor : undefined;

  const base: React.CSSProperties = {
    width: '100%', height: '100%', background: bgOverride || t.bg,
    display: 'flex', flexDirection: 'column',
    padding: 48 * scale, boxSizing: 'border-box',
    position: 'relative', overflow: 'hidden',
    fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 36 * scale * fs, fontWeight: 300, color: t.text,
    lineHeight: 1.25, marginBottom: 14 * scale,
    outline: 'none', width: '100%',
    background: 'transparent', border: 'none',
    fontFamily: 'inherit', resize: 'none', overflow: 'hidden',
  };
  const bodyStyle: React.CSSProperties = {
    fontSize: 17 * scale * fs, color: t.sub, lineHeight: 1.8,
    outline: 'none', width: '100%',
    background: 'transparent', border: 'none',
    fontFamily: 'inherit', resize: 'none', flex: 1,
  };

  const ET: React.FC<{
    value: string; placeholder: string; style: React.CSSProperties;
    field: keyof SlideContent; multiline?: boolean;
  }> = ({ value, placeholder, style, field, multiline }) => {
    const ref = useRef<any>(null);
    const autoH = () => { if (ref.current && multiline) { ref.current.style.height = 'auto'; ref.current.style.height = ref.current.scrollHeight + 'px'; } };
    useEffect(() => { autoH(); });
    if (!isEditing) return (
      <div style={{ ...style, whiteSpace: 'pre-wrap', minHeight: (style.fontSize as number) * 1.4 }}>
        {value || <span style={{ opacity: 0.2 }}>{placeholder}</span>}
      </div>
    );
    if (multiline) return <textarea ref={ref} value={value || ''} placeholder={placeholder} onChange={e => { onContentChange?.({ [field]: e.target.value }); autoH(); }} style={{ ...style, minHeight: (style.fontSize as number) * 2 }} rows={1} />;
    return <input ref={ref} value={value || ''} placeholder={placeholder} onChange={e => onContentChange?.({ [field]: e.target.value })} style={style} />;
  };

  const AccentBar = () => <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 * scale, background: effectiveAccent }} />;

  if (layout === 'title') return (
    <div style={{ ...base, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      <div style={{ position: 'absolute', right: -50*scale, top: -50*scale, width: 220*scale, height: 220*scale, borderRadius: '50%', background: t.accent, opacity: 0.07 }} />
      <div style={{ position: 'absolute', left: -30*scale, bottom: -30*scale, width: 140*scale, height: 140*scale, borderRadius: '50%', background: t.accent, opacity: 0.04 }} />
      <ET field="title" value={c.title||''} placeholder="演示标题" multiline style={{ ...titleStyle, fontSize: 44*scale*fs, textAlign:'center', fontWeight:200, letterSpacing:'-0.01em' }} />
      <div style={{ width:36*scale, height:2*scale, background:effectiveAccent, borderRadius:1, margin:`${6*scale}px auto ${18*scale}px` }} />
      <ET field="subtitle" value={c.subtitle||''} placeholder="副标题 / 日期 / 姓名" multiline style={{ ...bodyStyle, fontSize:19*scale*fs, textAlign:'center' }} />
    </div>
  );

  if (layout === 'section') return (
    <div style={{ ...base, justifyContent:'center' }}>
      <AccentBar />
      <div style={{ paddingLeft:20*scale }}>
        <ET field="sectionLabel" value={c.sectionLabel||''} placeholder="CHAPTER 01" style={{ fontSize:11*scale, letterSpacing:'0.18em', color:t.accent, fontWeight:600, textTransform:'uppercase', marginBottom:18*scale, outline:'none', background:'transparent', border:'none', fontFamily:'inherit', width:'100%' }} />
        <ET field="title" value={c.title||''} placeholder="章节标题" multiline style={{ ...titleStyle, fontSize:50*scale*fs, letterSpacing:'-0.015em' }} />
        <ET field="body" value={c.body||''} placeholder="章节说明（可选）" multiline style={{ ...bodyStyle, fontSize:15*scale*fs }} />
      </div>
    </div>
  );

  if (layout === 'two-col') return (
    <div style={{ ...base }}>
      <AccentBar />
      <ET field="title" value={c.title||''} placeholder="幻灯片标题" multiline style={{ ...titleStyle, fontSize:28*scale*fs, paddingLeft:16*scale, marginBottom:22*scale }} />
      <div style={{ display:'flex', gap:24*scale, flex:1 }}>
        <div style={{ flex:1, paddingLeft:16*scale }}>
          <div style={{ fontSize:10*scale, fontWeight:600, letterSpacing:'0.12em', color:t.accent, textTransform:'uppercase' as const, marginBottom:8*scale }}>LEFT</div>
          <ET field="leftBody" value={c.leftBody||''} placeholder="左栏内容..." multiline style={{ ...bodyStyle, fontSize:15*scale*fs }} />
        </div>
        <div style={{ width:1, background:t.border, flexShrink:0 }} />
        <div style={{ flex:1 }}>
          <div style={{ fontSize:10*scale, fontWeight:600, letterSpacing:'0.12em', color:t.accent, textTransform:'uppercase' as const, marginBottom:8*scale }}>RIGHT</div>
          <ET field="rightBody" value={c.rightBody||''} placeholder="右栏内容..." multiline style={{ ...bodyStyle, fontSize:15*scale*fs }} />
        </div>
      </div>
    </div>
  );

  if (layout === 'image') return (
    <div style={{ ...base }}>
      <AccentBar />
      <ET field="title" value={c.title||''} placeholder="图片标题" multiline style={{ ...titleStyle, paddingLeft:16*scale, fontSize:26*scale*fs, marginBottom:16*scale }} />
      <div style={{ flex:1, paddingLeft:16*scale, display:'flex', gap:20*scale }}>
        <div style={{ flex:1, display:'flex', flexDirection:'column' }}>
          <ET field="body" value={c.body||''} placeholder="说明文字..." multiline style={{ ...bodyStyle, fontSize:15*scale*fs }} />
        </div>
        <div style={{ flex:1.2, borderRadius:8*scale, overflow:'hidden', background:t.surface, border:`1px dashed ${t.border}`, display:'flex', alignItems:'center', justifyContent:'center', cursor:isEditing?'pointer':'default', minHeight:100*scale }}
          onClick={() => { if (!isEditing) return; const url = window.prompt('输入图片 URL：'); if (url) onContentChange?.({ imageUrl: url }); }}>
          {c.imageUrl
            ? <img src={c.imageUrl} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
            : <div style={{ textAlign:'center', color:t.sub, fontSize:12*scale, padding:12*scale }}>
                <div style={{ fontSize:28*scale, opacity:0.3, marginBottom:6*scale }}>🖼</div>
                {isEditing ? '点击插入图片 URL' : ''}
              </div>
          }
        </div>
      </div>
    </div>
  );

  if (layout === 'blank') return <div style={{ ...base }} />;

  // content (default)
  return (
    <div style={{ ...base }}>
      <AccentBar />
      <ET field="title" value={c.title||''} placeholder="幻灯片标题" multiline style={{ ...titleStyle, paddingLeft:16*scale, fontSize:28*scale*fs }} />
      <div style={{ flex:1, paddingLeft:16*scale }}>
        <ET field="body" value={c.body||''} placeholder={'内容...\n\n• 要点一\n• 要点二\n• 要点三'} multiline style={{ ...bodyStyle, fontSize:16*scale*fs }} />
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 缩略图
// ─────────────────────────────────────────────────────────────
const SlideThumbnail: React.FC<{
  slide: Slide; theme: ThemeKey; index: number; active: boolean;
  onClick: () => void; onDelete: () => void;
  onDragStart: () => void; onDragOver: () => void; onDrop: () => void;
}> = ({ slide, theme, index, active, onClick, onDelete, onDragStart, onDragOver, onDrop }) => {
  const [hov, setHov] = useState(false);
  const t = THEMES[theme] || THEMES.dark;
  return (
    <div draggable onDragStart={onDragStart} onDragOver={e => { e.preventDefault(); onDragOver(); }} onDrop={onDrop}
      onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ position:'relative', cursor:'pointer', borderRadius:6, flexShrink:0, background:t.bg,
        border:`${active?2:1}px solid ${active?'var(--accent)':'rgba(255,255,255,0.08)'}`,
        overflow:'hidden', transition:'border-color 0.12s',
        boxShadow: active?'0 0 0 2px rgba(200,169,110,0.18)':'none' }}>
      <div style={{ width:152, height:85.5, overflow:'hidden', position:'relative', pointerEvents:'none' }}>
        <div style={{ width:800, height:450, transform:'scale(0.19)', transformOrigin:'0 0', position:'absolute' }}>
          <SlideRenderer slide={slide} theme={theme} scale={1} />
        </div>
      </div>
      <div style={{ position:'absolute', bottom:4, left:6, fontSize:9.5, color:active?'var(--accent)':'rgba(255,255,255,0.3)', fontWeight:active?600:400 }}>{index+1}</div>
      {hov && <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ position:'absolute', top:3, right:3, width:16, height:16, borderRadius:4, background:'rgba(220,53,69,0.9)', border:'none', cursor:'pointer', color:'#fff', fontSize:9, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// AI 生成 PPT 面板
// ─────────────────────────────────────────────────────────────
const AiGeneratePanel: React.FC<{
  workspaceId: string;
  theme: ThemeKey;
  onGenerated: (slides: Slide[], presentationId: string) => void;
  onClose: () => void;
}> = ({ workspaceId, theme, onGenerated, onClose }) => {
  // 与 AIPanel.tsx 共用同一套 key/model 存储
  const BUILTIN_KEY   = 'ark-0f0fd51c-1395-45bd-9df0-29a195257d96-5ab55';
  const BUILTIN_MODEL = 'doubao-seed-2-0-pro-260215';
  const getApiKey  = () => { try { return localStorage.getItem('qiwen_doubao_apikey')  || BUILTIN_KEY;   } catch { return BUILTIN_KEY;   } };
  const getModel   = () => { try { return localStorage.getItem('qiwen_doubao_model')   || BUILTIN_MODEL; } catch { return BUILTIN_MODEL; } };

  const [prompt, setPrompt] = useState('');
  const [slideCount, setSlideCount] = useState(8);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const presets = [
    '量子计算的现状与未来',
    '创业公司的产品发展路线',
    '人工智能对就业市场的影响',
    '可持续能源的技术突破',
    '远程工作的效率与挑战',
  ];

  const generate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    setProgress('正在规划结构...');

    try {
      const systemPrompt = `你是一个专业的演示文稿设计师。用户给你一个主题，你需要生成 ${slideCount} 张幻灯片的内容。

严格返回 JSON 数组，不要任何其他文字，格式如下：
[
  {
    "layout": "title",
    "content": { "title": "...", "subtitle": "..." }
  },
  {
    "layout": "content",
    "content": { "title": "...", "body": "• 要点一\n• 要点二\n• 要点三" }
  },
  {
    "layout": "two-col",
    "content": { "title": "...", "leftBody": "...", "rightBody": "..." }
  },
  {
    "layout": "section",
    "content": { "sectionLabel": "CHAPTER 01", "title": "...", "body": "..." }
  }
]

layout 只能是: title, content, two-col, section, image, blank
第一张必须是 title 布局。合理安排布局多样性。内容要专业、有深度，不要空话。`;

      // 通过主进程代理调用豆包 API（与 AIPanel 共用同一套机制）
      const api = (window as any).electronAPI;
      if (!api?.invoke) throw new Error('请在桌面应用中使用 AI 功能');

      setProgress('正在生成内容...');
      const text: string = await api.invoke('ai:chat-stream', {
        messages: [
          { role: 'user', content: `${systemPrompt}\n\n主题：${prompt}` },
        ],
        apiKey: getApiKey(),
        model: getModel(),
      });

      if (!text) throw new Error('AI 返回了空响应，请重试');

      // 解析 JSON
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('AI 返回格式异常');
      const raw = JSON.parse(jsonMatch[0]) as any[];

      setProgress('正在组装幻灯片...');
      const presId = uuidv4();
      const now = Date.now();
      const slides: Slide[] = raw.map((item: any, i: number) => ({
        id: uuidv4(),
        presentationId: presId,
        sortOrder: i,
        layout: item.layout || 'content',
        content: item.content || {},
        notes: item.notes || '',
        createdAt: now,
        updatedAt: now,
      }));

      onGenerated(slides, presId);
    } catch (e: any) {
      setError(e?.message || 'AI 生成失败，请检查网络后重试');
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:600, background:'rgba(0,0,0,0.65)', backdropFilter:'blur(10px)', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width:520, background:'var(--bg-surface)', border:'0.5px solid var(--border-md)', borderRadius:18, padding:28, boxShadow:'0 32px 80px rgba(0,0,0,0.55)', maxHeight:'90vh', overflowY:'auto' }}>

        {/* 标题 */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:22 }}>
          <div style={{ width:32, height:32, borderRadius:10, background:'linear-gradient(135deg,#c8a96e,#9a7040)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
          </div>
          <div>
            <div style={{ fontSize:16, fontWeight:600, color:'var(--text-primary)' }}>AI 生成演示文稿</div>
            <div style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:2 }}>输入主题，自动生成专业幻灯片</div>
          </div>
        </div>

        {/* 主题输入 */}
        <label style={{ fontSize:12, color:'var(--text-tertiary)', display:'block', marginBottom:7 }}>演示主题</label>
        <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="例如：量子计算的原理与应用前景..."
          style={{ width:'100%', height:88, padding:'10px 12px', background:'var(--bg-surface3)', border:'0.5px solid var(--border-md)', borderRadius:10, color:'var(--text-primary)', fontSize:13.5, outline:'none', fontFamily:'inherit', resize:'none', boxSizing:'border-box', lineHeight:1.6 }}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); }}
        />

        {/* 预设主题 */}
        <div style={{ marginTop:10, marginBottom:16 }}>
          <div style={{ fontSize:11, color:'var(--text-tertiary)', marginBottom:7 }}>快速选择</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {presets.map(p => (
              <button key={p} onClick={() => setPrompt(p)}
                style={{ padding:'4px 10px', background:'var(--bg-surface3)', border:`0.5px solid ${prompt===p?'var(--accent)':'var(--border)'}`, borderRadius:20, fontSize:11.5, color:prompt===p?'var(--accent)':'var(--text-secondary)', cursor:'pointer', fontFamily:'inherit', transition:'all 0.12s' }}>
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* 张数 */}
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:22, padding:'12px 14px', background:'var(--bg-surface3)', borderRadius:10 }}>
          <label style={{ fontSize:12.5, color:'var(--text-secondary)', flex:1 }}>幻灯片数量</label>
          <input type="range" min="4" max="20" value={slideCount} onChange={e => setSlideCount(Number(e.target.value))} style={{ width:100 }} />
          <span style={{ fontSize:14, fontWeight:600, color:'var(--accent)', minWidth:32, textAlign:'right' }}>{slideCount}</span>
        </div>

        {/* 错误提示 */}
        {error && <div style={{ padding:'10px 12px', background:'rgba(220,53,69,0.1)', border:'0.5px solid rgba(220,53,69,0.3)', borderRadius:8, color:'#ff6b6b', fontSize:12.5, marginBottom:16 }}>{error}</div>}

        {/* 进度 */}
        {loading && (
          <div style={{ textAlign:'center', padding:'12px 0', marginBottom:12 }}>
            <div style={{ fontSize:13, color:'var(--accent)', marginBottom:8 }}>{progress}</div>
            <div style={{ height:3, background:'var(--bg-surface3)', borderRadius:2, overflow:'hidden' }}>
              <div style={{ height:'100%', background:'linear-gradient(90deg,#c8a96e,#9a7040)', borderRadius:2, width:'60%', animation:'pulse 1.5s ease-in-out infinite' }} />
            </div>
          </div>
        )}

        {/* 按钮 */}
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
          <button onClick={onClose} disabled={loading} style={{ padding:'8px 18px', background:'transparent', border:'0.5px solid var(--border-md)', borderRadius:9, color:'var(--text-secondary)', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>取消</button>
          <button onClick={generate} disabled={loading || !prompt.trim()}
            style={{ padding:'8px 22px', background:loading||!prompt.trim()?'var(--bg-surface3)':'linear-gradient(135deg,#c8a96e,#9a7040)', border:'none', borderRadius:9, color:loading||!prompt.trim()?'var(--text-tertiary)':'#fff', cursor:loading||!prompt.trim()?'default':'pointer', fontSize:13.5, fontWeight:500, fontFamily:'inherit', display:'flex', alignItems:'center', gap:7 }}>
            {loading
              ? <><div style={{ width:12, height:12, border:'1.5px solid rgba(255,255,255,0.4)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />生成中...</>
              : <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>开始生成</>
            }
          </button>
        </div>

        <div style={{ marginTop:14, fontSize:11, color:'var(--text-tertiary)', textAlign:'center' }}>Ctrl+Enter 快捷生成</div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:0.6; transform:translateX(-20%); } 50% { opacity:1; transform:translateX(20%); } }
      `}</style>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 全屏演示
// ─────────────────────────────────────────────────────────────
const FullscreenPresenter: React.FC<{
  pres: Presentation; startIndex: number; theme: ThemeKey; onExit: () => void;
}> = ({ pres, startIndex, theme, onExit }) => {
  const [cur, setCur] = useState(startIndex);
  const [direction, setDirection] = useState<'next'|'prev'>('next');
  const [animating, setAnimating] = useState(false);
  const total = pres.slides.length;

  const goTo = (idx: number, dir: 'next'|'prev') => {
    if (idx < 0 || idx >= total || animating) return;
    setDirection(dir);
    setAnimating(true);
    setTimeout(() => { setCur(idx); setAnimating(false); }, 280);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key==='ArrowRight'||e.key===' '||e.key==='ArrowDown') { e.preventDefault(); setCur(c=>Math.min(total-1,c+1)); }
      if (e.key==='ArrowLeft'||e.key==='ArrowUp') { e.preventDefault(); setCur(c=>Math.max(0,c-1)); }
      if (e.key==='Escape') onExit();
      if (e.key==='Home') { e.preventDefault(); setCur(0); }
      if (e.key==='End') { e.preventDefault(); setCur(total-1); }
      if (e.key==='f'||e.key==='F') { if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{}); else document.exitFullscreen().catch(()=>{}); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [total, onExit]);

  return (
    <div style={{ position:'fixed', inset:0, background:'#000', zIndex:9999, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}
      onClick={() => setCur(c=>c<total-1?c+1:c)}>
      <div style={{ width:'90vw', maxWidth:'calc(90vh * 16 / 9)', aspectRatio:'16/9', position:'relative', borderRadius:4, overflow:'hidden', boxShadow:'0 40px 100px rgba(0,0,0,0.8)' }}>
        {/* 左右导航按钮 */}
        {cur > 0 && (
          <button onClick={() => goTo(cur-1,'prev')} style={{ position:'absolute', left:20, top:'50%', transform:'translateY(-50%)', zIndex:10, width:44, height:44, borderRadius:'50%', background:'rgba(255,255,255,0.12)', border:'none', cursor:'pointer', color:'#fff', fontSize:20, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)', transition:'background 0.15s' }}
            onMouseOver={e=>(e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.22)'}
            onMouseOut={e=>(e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.12)'}>‹</button>
        )}
        {cur < total-1 && (
          <button onClick={() => goTo(cur+1,'next')} style={{ position:'absolute', right:20, top:'50%', transform:'translateY(-50%)', zIndex:10, width:44, height:44, borderRadius:'50%', background:'rgba(255,255,255,0.12)', border:'none', cursor:'pointer', color:'#fff', fontSize:20, display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(4px)', transition:'background 0.15s' }}
            onMouseOver={e=>(e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.22)'}
            onMouseOut={e=>(e.currentTarget as HTMLElement).style.background='rgba(255,255,255,0.12)'}>›</button>
        )}
        <div style={{ opacity: animating ? 0 : 1, transition:'opacity 0.25s', width:'100%', display:'flex', justifyContent:'center' }}>
          <SlideRenderer slide={pres.slides[cur]} theme={theme} scale={window.innerWidth*0.9/800} />
        </div>
      </div>
      {/* 进度条 */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0, height:3, background:'rgba(255,255,255,0.08)' }}>
        <div style={{ height:'100%', background:THEMES[theme].accent, width:`${((cur+1)/total)*100}%`, transition:'width 0.4s cubic-bezier(0.22,1,0.36,1)', boxShadow:`0 0 8px ${THEMES[theme].accent}80` }} />
      </div>
      {/* 控制条 */}
      <div style={{ position:'fixed', bottom:18, display:'flex', alignItems:'center', gap:12, background:'rgba(0,0,0,0.8)', padding:'7px 20px', borderRadius:24, backdropFilter:'blur(12px)', border:'0.5px solid rgba(255,255,255,0.1)' }}
        onClick={e=>e.stopPropagation()}>
        <button onClick={()=>setCur(c=>Math.max(0,c-1))} disabled={cur===0} style={{ background:'none', border:'none', color:cur===0?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.7)', cursor:cur===0?'default':'pointer', fontSize:22, lineHeight:1, padding:'0 4px' }}>‹</button>
        <span style={{ color:'rgba(255,255,255,0.5)', fontSize:12, minWidth:52, textAlign:'center' }}>{cur+1} / {total}</span>
        <button onClick={()=>setCur(c=>Math.min(total-1,c+1))} disabled={cur===total-1} style={{ background:'none', border:'none', color:cur===total-1?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.7)', cursor:cur===total-1?'default':'pointer', fontSize:22, lineHeight:1, padding:'0 4px' }}>›</button>
        <div style={{ width:1, height:14, background:'rgba(255,255,255,0.15)' }} />
        <button onClick={onExit} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.4)', cursor:'pointer', fontSize:11 }}>ESC 退出</button>
      </div>
      <div style={{ position:'fixed', top:18, left:22, fontSize:11, color:'rgba(255,255,255,0.3)', background:'rgba(0,0,0,0.5)', padding:'4px 10px', borderRadius:6, backdropFilter:'blur(4px)' }}>
        {cur===0 && <span style={{color:'rgba(255,255,255,0.5)'}}>首张幻灯片</span>}
        {cur===total-1 && <span style={{color:'rgba(255,255,255,0.5)'}}>最后一张</span>}
      </div>
      <div style={{ position:'fixed', top:18, right:22, fontSize:11, color:'rgba(255,255,255,0.3)', background:'rgba(0,0,0,0.5)', padding:'4px 10px', borderRadius:6, backdropFilter:'blur(4px)' }}>
        ← → 切换 &nbsp;·&nbsp; Home/End 首尾 &nbsp;·&nbsp; F 全屏
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 演示文稿列表
// ─────────────────────────────────────────────────────────────
const PresentationList: React.FC<{
  onOpen: (id: string) => void;
  onAiCreate: () => void;
}> = ({ onOpen, onAiCreate }) => {
  const dispatch = useDispatch<AppDispatch>();
  const activeWorkspaceId = useSelector((s: RootState) => s.app.activeWorkspaceId);
  const { items, loading } = useSelector((s: RootState) => (s as any).presentations);
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTheme, setNewTheme] = useState<ThemeKey>('dark');

  useEffect(() => {
    if (activeWorkspaceId) dispatch(fetchPresentations(activeWorkspaceId));
  }, [activeWorkspaceId, dispatch]);

  const handleCreate = async () => {
    if (!activeWorkspaceId) return;
    const title = newTitle.trim() || '无标题演示';
    const res = await (dispatch as any)(createPresentation({ workspaceId: activeWorkspaceId, title, theme: newTheme })).unwrap();
    setShowCreate(false); setNewTitle('');
    if (res?.id) onOpen(res.id);
  };

  const fmt = (ts: number) => {
    const d = Date.now() - ts;
    if (d < 60000) return '刚刚';
    if (d < 3600000) return `${Math.floor(d/60000)} 分钟前`;
    if (d < 86400000) return '今天';
    return new Date(ts).toLocaleDateString('zh-CN', { month:'short', day:'numeric' });
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'var(--bg-editor)', overflow:'hidden' }}>
      <div style={{ padding:'28px 36px 0', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:500, color:'var(--text-primary)' }}>演示文稿</div>
          <div style={{ fontSize:12, color:'var(--text-tertiary)', marginTop:3 }}>{items.length} 个文稿</div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {/* AI 生成按钮 */}
          <button onClick={onAiCreate}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', background:'rgba(200,169,110,0.1)', border:'0.5px solid rgba(200,169,110,0.35)', borderRadius:9, fontSize:13, fontWeight:500, cursor:'pointer', color:'var(--accent)', fontFamily:'inherit' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            AI 生成
          </button>
          <button onClick={() => setShowCreate(true)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', background:'linear-gradient(135deg,#c8a96e,#9a7040)', color:'#fff', border:'none', borderRadius:9, fontSize:13, fontWeight:500, cursor:'pointer' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            新建演示
          </button>
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:'20px 36px' }}>
        {items.length === 0 ? (
          <div style={{ textAlign:'center', padding:'100px 0', color:'var(--text-tertiary)' }}>
            <div style={{ fontSize:52, opacity:loading?0:0.15, marginBottom:16 }}>🎞</div>
            <div style={{ fontSize:15 }}>{loading?'加载中...':'还没有演示文稿'}</div>
            {!loading && <div style={{ fontSize:13, marginTop:6, opacity:0.7 }}>点击「新建演示」或「AI 生成」开始创作</div>}
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:16 }}>
            {(items as any[]).map((p: any) => {
              const th = THEMES[(p.theme as ThemeKey)] || THEMES.dark;
              return (
                <div key={p.id} onClick={() => onOpen(p.id)}
                  style={{ cursor:'pointer', borderRadius:12, overflow:'hidden', border:'0.5px solid var(--border)', background:'var(--bg-surface2)', transition:'all 0.15s' }}
                  onMouseEnter={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor='rgba(200,169,110,0.4)'; el.style.transform='translateY(-2px)'; el.style.boxShadow='0 8px 24px rgba(0,0,0,0.15)'; }}
                  onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor='var(--border)'; el.style.transform='none'; el.style.boxShadow='none'; }}>
                  <div style={{ height:116, background:th.bg, display:'flex', alignItems:'center', justifyContent:'center', borderBottom:'0.5px solid var(--border)', padding:18, flexDirection:'column', gap:8 }}>
                    <div style={{ fontSize:13.5, fontWeight:300, color:th.text, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'100%' }}>{p.title}</div>
                    <div style={{ width:22, height:1.5, background:th.accent, borderRadius:1 }} />
                  </div>
                  <div style={{ padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div>
                      <div style={{ fontSize:12.5, fontWeight:500, color:'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:140 }}>{p.title}</div>
                      <div style={{ fontSize:11, color:'var(--text-tertiary)', marginTop:2 }}>{p.slideCount} 张 · {fmt(p.updatedAt)}</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); if (window.confirm('确定删除？')) dispatch(deletePresentation(p.id)); }}
                      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-tertiary)', fontSize:15, padding:'3px 6px', borderRadius:4 }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color='#ff6b6b'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color='var(--text-tertiary)'}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 新建弹窗 */}
      {showCreate && (
        <div onClick={() => setShowCreate(false)} style={{ position:'fixed', inset:0, zIndex:500, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(8px)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ width:440, background:'var(--bg-surface)', border:'0.5px solid var(--border-md)', borderRadius:16, padding:26, boxShadow:'0 28px 80px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize:16, fontWeight:600, color:'var(--text-primary)', marginBottom:20 }}>新建演示文稿</div>
            <label style={{ fontSize:12, color:'var(--text-tertiary)', display:'block', marginBottom:6 }}>标题</label>
            <input autoFocus value={newTitle} onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key==='Enter') handleCreate(); if (e.key==='Escape') setShowCreate(false); }}
              placeholder="演示文稿标题"
              style={{ width:'100%', height:38, padding:'0 12px', background:'var(--bg-surface3)', border:'0.5px solid var(--border-md)', borderRadius:9, color:'var(--text-primary)', fontSize:13.5, outline:'none', fontFamily:'inherit', boxSizing:'border-box', marginBottom:16 }} />
            <label style={{ fontSize:12, color:'var(--text-tertiary)', display:'block', marginBottom:10 }}>主题风格</label>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:7, marginBottom:22 }}>
              {(Object.keys(THEMES) as ThemeKey[]).map(tk => {
                const th = THEMES[tk];
                return (
                  <button key={tk} onClick={() => setNewTheme(tk)}
                    style={{ height:52, borderRadius:9, border:`${newTheme===tk?2:1}px solid ${newTheme===tk?'var(--accent)':'var(--border)'}`, background:th.bg, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4, transition:'all 0.12s' }}>
                    <div style={{ width:18, height:2, background:th.accent, borderRadius:1 }} />
                    <div style={{ fontSize:9, color:th.sub }}>{THEME_LABELS[tk]}</div>
                  </button>
                );
              })}
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button onClick={() => setShowCreate(false)} style={{ padding:'7px 16px', background:'transparent', border:'0.5px solid var(--border-md)', borderRadius:8, color:'var(--text-secondary)', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>取消</button>
              <button onClick={handleCreate} style={{ padding:'7px 20px', background:'linear-gradient(135deg,#c8a96e,#9a7040)', border:'none', borderRadius:8, color:'#fff', cursor:'pointer', fontSize:13, fontWeight:500, fontFamily:'inherit' }}>创建</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 主编辑器
// ─────────────────────────────────────────────────────────────
const PresentationEditor: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const dispatch = useDispatch<AppDispatch>();
  const { openPresentation: pres, activeSlideIndex, saving } = useSelector((s: RootState) => (s as any).presentations);
  const activeWorkspaceId = useSelector((s: RootState) => s.app.activeWorkspaceId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const [showLayoutPicker, setShowLayoutPicker] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showNotesPanel, setShowNotesPanel] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fontSize, setFontSize] = useState(1);
  const [showFontSize, setShowFontSize] = useState(false);
  const [exportingDoc, setExportingDoc] = useState(false);
  const [exportSuccess, setExportSuccess] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFormatPanel, setShowFormatPanel] = useState(false);
  const [slideAccentColor, setSlideAccentColor] = useState('');
  const [slideBgColor, setSlideBgColor] = useState('');

  const dragRef = useRef(-1);
  const saveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  const activeSlide: Slide|null = pres?.slides?.[activeSlideIndex] ?? null;
  const theme: ThemeKey = (pres?.theme as ThemeKey) || 'dark';

  const scheduleAutoSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (pres) dispatch(saveAllSlides({ presentationId: pres.id, slides: pres.slides }));
    }, 1500);
  }, [pres, dispatch]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (pres) dispatch(saveAllSlides({ presentationId: pres.id, slides: pres.slides }));
    };
  }, [pres?.id]); // eslint-disable-line

  // 键盘快捷键
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag==='INPUT'||tag==='TEXTAREA') return;
      if ((e.metaKey||e.ctrlKey)&&e.key==='Enter') { e.preventDefault(); setIsFullscreen(true); }
      if ((e.metaKey||e.ctrlKey)&&e.key==='z'&&!e.shiftKey) { e.preventDefault(); /* undo handled in reducer */ }
      if (e.key==='ArrowDown'||e.key==='ArrowRight') { e.preventDefault(); if (pres&&activeSlideIndex<pres.slides.length-1) dispatch(setActiveSlideIndex(activeSlideIndex+1)); }
      if (e.key==='ArrowUp'&&e.shiftKey&&e.ctrlKey) { e.preventDefault(); if (pres&&activeSlideIndex>0) { const s=[...pres.slides]; const t=s[activeSlideIndex]; s.splice(activeSlideIndex,1); s.splice(activeSlideIndex-1,0,t); dispatch(saveAllSlides({presentationId:pres.id,slides:s.map((sl,i)=>({...sl,sortOrder:i}))})); dispatch(setActiveSlideIndex(activeSlideIndex-1)); } }
      if (e.key==='ArrowDown'&&e.shiftKey&&e.ctrlKey) { e.preventDefault(); if (pres&&activeSlideIndex<pres.slides.length-1) { const s=[...pres.slides]; const t=s[activeSlideIndex]; s.splice(activeSlideIndex,1); s.splice(activeSlideIndex+1,0,t); dispatch(saveAllSlides({presentationId:pres.id,slides:s.map((sl,i)=>({...sl,sortOrder:i}))})); dispatch(setActiveSlideIndex(activeSlideIndex+1)); } }
      if (e.key==='ArrowUp'||e.key==='ArrowLeft') { e.preventDefault(); if (activeSlideIndex>0) dispatch(setActiveSlideIndex(activeSlideIndex-1)); }
      if ((e.key==='Delete'||e.key==='Backspace')&&e.shiftKey) { e.preventDefault(); if (pres&&pres.slides.length>1) { dispatch(deleteSlideLocal(activeSlideIndex)); scheduleAutoSave(); } }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [pres, activeSlideIndex, dispatch, scheduleAutoSave]);

  const handleContentChange = useCallback((changes: Partial<SlideContent>) => {
    dispatch(updateSlideLocal({ index: activeSlideIndex, changes: { content: { ...activeSlide?.content, ...changes } } }));
    scheduleAutoSave();
  }, [activeSlideIndex, activeSlide, dispatch, scheduleAutoSave]);

  const handleAddSlide = (layout: SlideLayout = 'content') => {
    if (!pres) return;
    const now = Date.now();
    dispatch(addSlideLocal({ afterIndex: activeSlideIndex, slide: { id:uuidv4(), presentationId:pres.id, sortOrder:activeSlideIndex+1, layout, content:{ title:'', body:'' }, notes:'', createdAt:now, updatedAt:now } }));
    setShowLayoutPicker(false);
    scheduleAutoSave();
  };

  const handleDuplicate = () => {
    if (!pres||!activeSlide) return;
    const now = Date.now();
    dispatch(addSlideLocal({ afterIndex: activeSlideIndex, slide: { ...activeSlide, id:uuidv4(), createdAt:now, updatedAt:now } }));
    scheduleAutoSave();
  };

  const handleDeleteSlide = (idx: number) => {
    if (!pres||pres.slides.length<=1) return;
    dispatch(deleteSlideLocal(idx));
    scheduleAutoSave();
  };

  // PPT → 文档转换
  const handleExportToDoc = async () => {
    if (!pres||!activeWorkspaceId) return;
    setExportingDoc(true);
    try {
      const html = slidesToHtml(pres.slides, pres.title);
      // createDocument 不接受 content，需先创建再 updateDocument 写入内容
      const doc = await (dispatch as any)(createDocument({ workspaceId: activeWorkspaceId, title: pres.title + ' - 文档版' })).unwrap();
      await (dispatch as any)(updateDocument({ id: doc.id, content: html }));
      dispatch(openTab({ documentId: doc.id, title: doc.title }));
      dispatch(setView('workbench'));
      setExportSuccess('已在文档编辑器中打开');
      setTimeout(() => setExportSuccess(''), 3000);
    } catch { setExportSuccess('转换失败'); setTimeout(() => setExportSuccess(''), 3000); }
    finally { setExportingDoc(false); }
  };

  // 导出 PDF（通过打印窗口）
  const handleExportPdf = async () => {
    if (!pres) return;
    setExportingPdf(true);
    try {
      // 构建打印用 HTML
      const t = THEMES[theme] || THEMES.dark;
      const slidesHtml = pres.slides.map((slide: Slide, i: number) => {
        const c = slide.content || {};
        return `<div class="slide-page" style="background:${t.bg};color:${t.text};">
          <div style="font-size:28pt;font-weight:300;margin-bottom:12pt;color:${t.text}">${c.title || ''}</div>
          <div style="width:36pt;height:2pt;background:${t.accent};margin-bottom:20pt;"></div>
          <div style="font-size:14pt;color:${t.sub};white-space:pre-wrap;line-height:1.7">${c.body || c.subtitle || ''}</div>
          <div style="position:absolute;bottom:16pt;right:20pt;font-size:9pt;opacity:0.4">${i+1} / ${pres.slides.length}</div>
        </div>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
        <style>
          @page { size: 16in 9in; margin: 0; }
          body { margin: 0; font-family: 'Noto Sans SC', sans-serif; }
          .slide-page { width:16in; height:9in; padding:1.2in; box-sizing:border-box; page-break-after:always; position:relative; overflow:hidden; }
          .slide-page:last-child { page-break-after:avoid; }
        </style></head><body>${slidesHtml}</body></html>`;
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (win) {
        win.onload = () => {
          win.print();
          setTimeout(() => URL.revokeObjectURL(url), 3000);
        };
      }
    } catch { }
    finally { setExportingPdf(false); }
  };

  // 上传本地图片到当前幻灯片
  const handleUploadImage = async () => {
    try {
      const result = await (window as any).electronAPI?.invoke('image:upload-local');
      if (result?.success && result.dataUrl) {
        dispatch(updateSlideLocal({ index: activeSlideIndex, changes: { layout: 'image', content: { ...activeSlide?.content, imageUrl: result.dataUrl } } }));
        scheduleAutoSave();
      }
    } catch {}
  };

  const handleTitleSave = async () => {
    if (!pres) return;
    setEditingTitle(false);
    if (titleValue.trim() && titleValue !== pres.title)
      await dispatch(updatePresentationMeta({ id:pres.id, title:titleValue.trim() }));
  };

  const handleChangeTheme = async (nk: ThemeKey) => {
    if (!pres) return;
    setShowThemePicker(false);
    await dispatch(updatePresentationMeta({ id:pres.id, theme:nk }));
  };

  const handleBack = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    dispatch(saveAllSlides({ presentationId:pres.id, slides:pres.slides }));
    setTimeout(onBack, 150);
  };

  if (isFullscreen && pres) return <FullscreenPresenter pres={pres} startIndex={activeSlideIndex} theme={theme} onExit={() => setIsFullscreen(false)} />;
  if (!pres) return null;

  const Btn: React.FC<{ onClick: () => void; title?: string; disabled?: boolean; children: React.ReactNode; danger?: boolean; active?: boolean }> = ({ onClick, title, disabled, children, danger, active }) => (
    <button onClick={onClick} title={title} disabled={disabled}
      style={{ display:'flex', alignItems:'center', gap:4, padding:'5px 9px', background:active?'rgba(200,169,110,0.12)':'none', border:active?'0.5px solid rgba(200,169,110,0.3)':'0.5px solid transparent', borderRadius:7, color:disabled?'var(--text-quaternary)':active?'var(--accent)':'var(--text-secondary)', cursor:disabled?'default':'pointer', fontFamily:'inherit', fontSize:12.5, transition:'all 0.1s' }}
      onMouseEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = danger?'rgba(220,53,69,0.1)':active?'rgba(200,169,110,0.18)':'var(--bg-hover)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active?'rgba(200,169,110,0.12)':'transparent'; }}
    >{children}</button>
  );

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', background:'var(--bg-primary)', overflow:'hidden', height:'100%' }}>

      {/* ── 工具栏 ── */}
      <div style={{ height:48, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 10px', borderBottom:'0.5px solid var(--border)', flexShrink:0, background:'var(--bg-surface)', gap:4 }}>

        {/* 左区 */}
        <div style={{ display:'flex', alignItems:'center', gap:2 }}>
          <Btn onClick={handleBack}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            所有演示
          </Btn>

          <div style={{ width:1, height:18, background:'var(--border)', margin:'0 4px' }} />

          {/* 添加幻灯片 */}
          <div style={{ position:'relative' }}>
            <Btn onClick={() => setShowLayoutPicker(v=>!v)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              新幻灯片
            </Btn>
            {showLayoutPicker && (
              <>
                <div onClick={() => setShowLayoutPicker(false)} style={{ position:'fixed', inset:0, zIndex:90 }} />
                <div style={{ position:'absolute', top:38, left:0, background:'var(--bg-surface)', border:'0.5px solid var(--border-md)', borderRadius:12, padding:10, zIndex:91, display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, width:200, boxShadow:'0 10px 32px rgba(0,0,0,0.4)' }}>
                  {LAYOUTS.map(l => (
                    <button key={l.id} onClick={() => handleAddSlide(l.id)}
                      style={{ padding:'9px 4px', borderRadius:8, background:'var(--bg-surface2)', border:'0.5px solid var(--border)', cursor:'pointer', fontFamily:'inherit', display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}
                      onMouseEnter={e => { const el=e.currentTarget as HTMLElement; el.style.background='var(--bg-surface3)'; el.style.borderColor='rgba(200,169,110,0.35)'; }}
                      onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.background='var(--bg-surface2)'; el.style.borderColor='var(--border)'; }}>
                      <div style={{ color:'var(--text-secondary)' }}>{l.icon}</div>
                      <div style={{ fontSize:9.5, color:'var(--text-tertiary)' }}>{l.label}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <Btn onClick={handleDuplicate} title="复制当前幻灯片">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            复制
          </Btn>

          <Btn onClick={() => handleDeleteSlide(activeSlideIndex)} title="删除（Shift+Del）" disabled={pres.slides.length<=1} danger>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </Btn>

          <div style={{ width:1, height:18, background:'var(--border)', margin:'0 4px' }} />

          {/* 字号调节 */}
          <div style={{ position:'relative' }}>
            <Btn onClick={() => setShowFontSize(v=>!v)} title="字体大小">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
              {Math.round(fontSize*100)}%
            </Btn>
            {showFontSize && (
              <>
                <div onClick={() => setShowFontSize(false)} style={{ position:'fixed', inset:0, zIndex:90 }} />
                <div style={{ position:'absolute', top:38, left:0, background:'var(--bg-surface)', border:'0.5px solid var(--border-md)', borderRadius:10, padding:'10px 14px', zIndex:91, width:180, boxShadow:'0 8px 24px rgba(0,0,0,0.35)' }}>
                  <div style={{ fontSize:11, color:'var(--text-tertiary)', marginBottom:8 }}>字体大小</div>
                  <input type="range" min="0.7" max="1.5" step="0.05" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} style={{ width:'100%', marginBottom:8 }} />
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    {[0.8, 1.0, 1.2, 1.4].map(v => (
                      <button key={v} onClick={() => { setFontSize(v); setShowFontSize(false); }}
                        style={{ padding:'3px 8px', borderRadius:6, background:Math.abs(fontSize-v)<0.03?'rgba(200,169,110,0.15)':'var(--bg-surface2)', border:`0.5px solid ${Math.abs(fontSize-v)<0.03?'var(--accent)':'var(--border)'}`, color:Math.abs(fontSize-v)<0.03?'var(--accent)':'var(--text-secondary)', cursor:'pointer', fontSize:11, fontFamily:'inherit' }}>
                        {Math.round(v*100)}%
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* PPT → 文档 */}
          <Btn onClick={handleExportToDoc} disabled={exportingDoc} title="导出为文档">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            {exportingDoc ? '转换中...' : exportSuccess || '转为文档'}
          </Btn>
        </div>

        {/* 中：标题 */}
        <div style={{ flex:1, display:'flex', justifyContent:'center' }}>
          {editingTitle
            ? <input autoFocus value={titleValue} onChange={e => setTitleValue(e.target.value)} onBlur={handleTitleSave} onKeyDown={e => { if (e.key==='Enter') handleTitleSave(); if (e.key==='Escape') setEditingTitle(false); }} style={{ fontSize:14, fontWeight:500, background:'var(--bg-surface3)', border:'0.5px solid var(--accent)', borderRadius:7, padding:'4px 12px', color:'var(--text-primary)', outline:'none', fontFamily:'inherit', textAlign:'center', minWidth:180 }} />
            : <button onClick={() => { setTitleValue(pres.title); setEditingTitle(true); }} style={{ fontSize:14, fontWeight:500, color:'var(--text-primary)', background:'none', border:'none', cursor:'pointer', padding:'4px 12px', borderRadius:7, fontFamily:'inherit' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'none'}>
                {pres.title}
              </button>
          }
        </div>

        {/* 右区 */}
        <div style={{ display:'flex', alignItems:'center', gap:4 }}>
          <div style={{ fontSize:11, color:saving?'var(--accent)':'var(--text-tertiary)', minWidth:40, textAlign:'right', flexShrink:0 }}>{saving?'保存中…':'已保存'}</div>

          {/* 主题 */}
          <div style={{ position:'relative' }}>
            <button onClick={() => setShowThemePicker(v=>!v)}
              style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 10px', background:'var(--bg-surface2)', border:'0.5px solid var(--border)', borderRadius:7, color:'var(--text-secondary)', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
              <div style={{ width:10, height:10, borderRadius:'50%', background:THEMES[theme].accent }} />
              {THEME_LABELS[theme]}
            </button>
            {showThemePicker && (
              <>
                <div onClick={() => setShowThemePicker(false)} style={{ position:'fixed', inset:0, zIndex:90 }} />
                <div style={{ position:'absolute', top:38, right:0, background:'var(--bg-surface)', border:'0.5px solid var(--border-md)', borderRadius:12, padding:10, zIndex:91, display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, width:192, boxShadow:'0 10px 36px rgba(0,0,0,0.45)' }}>
                  {(Object.keys(THEMES) as ThemeKey[]).map(tk => {
                    const th = THEMES[tk];
                    return (
                      <button key={tk} onClick={() => handleChangeTheme(tk)}
                        style={{ height:48, borderRadius:9, border:`${pres.theme===tk?2:0.5}px solid ${pres.theme===tk?'var(--accent)':'var(--border)'}`, background:th.bg, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4 }}>
                        <div style={{ width:18, height:2, background:th.accent, borderRadius:1 }} />
                        <div style={{ fontSize:10, color:th.sub }}>{THEME_LABELS[tk]}</div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* 备注开关 */}
          <Btn onClick={() => setShowNotesPanel(v=>!v)} title="演讲者备注" active={showNotesPanel}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </Btn>

          {/* 快捷键 */}
          <Btn onClick={() => setShowShortcuts(v=>!v)} title="键盘快捷键">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h12"/></svg>
          </Btn>

          {/* 导出 PDF */}
          <Btn onClick={handleExportPdf} disabled={exportingPdf} title="导出为 PDF（打印）">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {exportingPdf ? '生成中...' : '导出 PDF'}
          </Btn>

          {/* 导出 HTML（可在浏览器中演示）*/}
          <Btn onClick={() => {
            if (!pres) return;
            const t = THEMES[theme] || THEMES.dark;
            const slides = pres.slides || [];
            let slidesHtml = '';
            slides.forEach((s, i) => {
              const c = s.content || {};
              let body = '';
              if (s.layout === 'title') {
                body = `<h1 style="font-size:3.8vw;font-weight:300;letter-spacing:-0.03em;color:${t.text};margin-bottom:1.5vw">${c.title||''}</h1><div style="width:4vw;height:4px;background:${t.accent};border-radius:2px;margin-bottom:1.5vw"></div><h2 style="font-size:1.8vw;font-weight:300;color:${t.sub}">${c.subtitle||''}</h2>`;
              } else if (s.layout === 'section') {
                body = `<div style="font-size:1vw;letter-spacing:0.2em;text-transform:uppercase;color:${t.accent};margin-bottom:1.5vw">${c.sectionLabel||'SECTION'}</div><h1 style="font-size:3vw;font-weight:300;color:${t.text}">${c.title||''}</h1>`;
              } else if (s.layout === 'two-col') {
                body = `<h2 style="font-size:2.4vw;font-weight:400;color:${t.text};margin-bottom:2vw;width:100%;text-align:left">${c.title||''}</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:3vw;width:100%;text-align:left"><div style="color:${t.sub};font-size:1.4vw;line-height:1.8;white-space:pre-wrap">${c.leftBody||''}</div><div style="color:${t.sub};font-size:1.4vw;line-height:1.8;white-space:pre-wrap">${c.rightBody||''}</div></div>`;
              } else {
                const lines = (c.body||'').split('\n').filter(Boolean);
                const bodyContent = lines.some((l: string) => l.startsWith('• '))
                  ? '<ul style="padding-left:2vw">'+lines.map((l: string) => `<li style="font-size:1.5vw;line-height:2;color:${t.sub};margin-bottom:0.3vw">${l.replace(/^•\s*/,'')}</li>`).join('')+'</ul>'
                  : `<p style="font-size:1.5vw;line-height:1.85;color:${t.sub};white-space:pre-wrap">${c.body||''}</p>`;
                body = `<h2 style="font-size:2.4vw;font-weight:400;color:${t.text};margin-bottom:1vw;width:100%;text-align:left">${c.title||''}</h2><div style="width:3vw;height:3px;background:${t.accent};border-radius:2px;margin-bottom:1.5vw;align-self:flex-start"></div>${bodyContent}`;
              }
              slidesHtml += `<div class="slide${i===0?' active':''}">${body}</div>`;
            });
            const fullHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>${pres.title||'演示'}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:${t.bg};font-family:'PingFang SC','Helvetica Neue',sans-serif;overflow:hidden;user-select:none}.slide{position:fixed;inset:0;display:none;padding:7% 9%;align-items:center;justify-content:center;flex-direction:column;background:${t.bg};color:${t.text};opacity:0;transition:opacity .3s}.slide.active{display:flex;opacity:1}.progress{position:fixed;bottom:0;left:0;height:3px;background:${t.accent};transition:width .4s}.page-num{position:fixed;bottom:16px;right:20px;font-size:.8vw;opacity:.3;color:${t.text};font-family:monospace}.hint{position:fixed;top:14px;right:18px;font-size:.7vw;opacity:.2;color:${t.text}}.dot{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.2);cursor:pointer;transition:all .2s}.dot.active{background:${t.accent};transform:scale(1.4)}.dots{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:6px}.nav{position:fixed;top:50%;transform:translateY(-50%);background:rgba(255,255,255,.1);border:none;border-radius:50%;width:42px;height:42px;cursor:pointer;font-size:18px;color:#fff;opacity:0;transition:opacity .2s}.nav:hover{background:rgba(255,255,255,.2)}body:hover .nav{opacity:1}.prev{left:14px}.next{right:14px}</style></head><body>${slidesHtml}<div class="progress" id="p"></div><div class="page-num" id="pn"></div><div class="hint">← → 切换 · F 全屏 · Esc 退出</div><button class="nav prev" onclick="go(cur-1)">‹</button><button class="nav next" onclick="go(cur+1)">›</button><div class="dots" id="d"></div><script>let cur=0;const s=document.querySelectorAll('.slide'),n=s.length;const d=document.getElementById('d');for(let i=0;i<Math.min(n,15);i++){const el=document.createElement('div');el.className='dot';el.onclick=(i=>(()=>go(i)))(i);d.appendChild(el);}function go(i){if(i<0||i>=n)return;s[cur].style.display='none';cur=i;s[cur].style.display='flex';setTimeout(()=>s[cur].style.opacity='1',10);document.getElementById('p').style.width=((cur+1)/n*100)+'%';document.getElementById('pn').textContent=(cur+1)+' / '+n;document.querySelectorAll('.dot').forEach((el,j)=>el.classList.toggle('active',j===cur));}go(0);document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' ')go(cur+1);if(e.key==='ArrowLeft')go(cur-1);if(e.key==='Home')go(0);if(e.key==='End')go(n-1);if(e.key==='f')document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();if(e.key==='Escape'&&document.fullscreenElement)document.exitFullscreen();});</' + 'script></body></html>`;
            const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `${pres.title||'演示文稿'}.html`;
            document.body.appendChild(a); a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }} title="导出为独立 HTML（浏览器可直接演示）">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            导出 HTML
          </Btn>

          {/* 图片上传 */}
          <Btn onClick={handleUploadImage} title="上传图片到当前幻灯片">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            图片
          </Btn>

          <div style={{ width:1, height:18, background:'var(--border)', margin:'0 4px' }} />

          {/* 演示 */}
          <button onClick={() => setIsFullscreen(true)} title="全屏演示 (Ctrl+Enter)"
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 14px', background:'linear-gradient(135deg,#c8a96e,#9a7040)', color:'#fff', border:'none', borderRadius:8, fontSize:12.5, fontWeight:500, cursor:'pointer', fontFamily:'inherit', marginLeft:4 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            演示
          </button>
        </div>
      </div>

      {/* ── 主体 ── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* 左：缩略图 */}
        <div style={{ width:168, flexShrink:0, borderRight:'0.5px solid var(--border)', display:'flex', flexDirection:'column', background:'var(--bg-sidebar)', overflow:'hidden' }}>
          <div style={{ padding:'8px 12px 6px', borderBottom:'0.5px solid var(--border)', fontSize:10.5, color:'var(--text-tertiary)', flexShrink:0 }}>{pres.slides.length} 张幻灯片</div>
          <div style={{ flex:1, overflowY:'auto', padding:'8px 8px 16px', display:'flex', flexDirection:'column', gap:7 }}>
            {pres.slides.map((slide: Slide, i: number) => (
              <SlideThumbnail key={slide.id} slide={slide} theme={theme} index={i} active={i===activeSlideIndex}
                onClick={() => dispatch(setActiveSlideIndex(i))}
                onDelete={() => handleDeleteSlide(i)}
                onDragStart={() => { dragRef.current = i; }}
                onDragOver={() => { if (dragRef.current!==-1&&dragRef.current!==i) { dispatch(moveSlideLocal({ from:dragRef.current, to:i })); dragRef.current=i; scheduleAutoSave(); } }}
                onDrop={() => { dragRef.current = -1; }}
              />
            ))}
            <button onClick={() => handleAddSlide('content')}
              style={{ width:'100%', height:28, border:'1px dashed rgba(200,169,110,0.2)', borderRadius:6, background:'none', color:'rgba(200,169,110,0.35)', cursor:'pointer', fontSize:18, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}
              onMouseEnter={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor='rgba(200,169,110,0.55)'; el.style.color='rgba(200,169,110,0.65)'; }}
              onMouseLeave={e => { const el=e.currentTarget as HTMLElement; el.style.borderColor='rgba(200,169,110,0.2)'; el.style.color='rgba(200,169,110,0.35)'; }}>+</button>
          </div>
        </div>

        {/* 中：画布 */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#181820', overflow:'hidden', position:'relative' }}>
          {activeSlide ? (
            <div style={{ position:'relative' }}>
              <div style={{ width:760, height:427.5, borderRadius:4, overflow:'hidden', boxShadow:'0 16px 64px rgba(0,0,0,0.65)' }}>
                <SlideRenderer slide={activeSlide} theme={theme} scale={0.95} isEditing onContentChange={handleContentChange} fontSize={fontSize} />
              </div>
              <div style={{ position:'absolute', bottom:-22, right:0, fontSize:11, color:'rgba(255,255,255,0.22)' }}>{activeSlideIndex+1} / {pres.slides.length}</div>
            </div>
          ) : (
            <div style={{ color:'rgba(255,255,255,0.2)', fontSize:14 }}>没有幻灯片</div>
          )}

          {/* 快捷键弹窗 */}
          {showShortcuts && (
            <>
              <div onClick={() => setShowShortcuts(false)} style={{ position:'fixed', inset:0, zIndex:200 }} />
              <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', background:'var(--bg-surface)', border:'0.5px solid var(--border-md)', borderRadius:14, padding:'22px 26px', zIndex:201, boxShadow:'0 20px 60px rgba(0,0,0,0.5)', minWidth:300 }}>
                <div style={{ fontSize:14, fontWeight:600, color:'var(--text-primary)', marginBottom:16 }}>键盘快捷键</div>
                {[
                  ['↑ / ↓', '切换幻灯片'],
                  ['Ctrl + Enter', '开始全屏演示'],
                  ['Shift + Delete', '删除当前幻灯片'],
                  ['← → / 空格（演示中）', '切换幻灯片'],
                  ['ESC（演示中）', '退出全屏'],
                ].map(([k, d]) => (
                  <div key={k} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'0.5px solid var(--border)' }}>
                    <code style={{ fontSize:11.5, background:'var(--bg-surface3)', padding:'2px 8px', borderRadius:5, color:'var(--accent)', fontFamily:'monospace' }}>{k}</code>
                    <span style={{ fontSize:12, color:'var(--text-secondary)', marginLeft:16 }}>{d}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 右：属性面板 */}
        <div style={{ width:showNotesPanel?206:0, flexShrink:0, borderLeft:'0.5px solid var(--border)', background:'var(--bg-sidebar)', overflow:'hidden', display:'flex', flexDirection:'column', transition:'width 0.2s' }}>
          {/* 布局选择 */}
          <div style={{ padding:'12px 12px 8px', borderBottom:'0.5px solid var(--border)', fontSize:10.5, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' as const, color:'var(--text-tertiary)', flexShrink:0 }}>布局</div>
          <div style={{ padding:'8px', display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:5, flexShrink:0 }}>
            {LAYOUTS.map(l => (
              <button key={l.id} onClick={() => { dispatch(updateSlideLocal({ index:activeSlideIndex, changes:{ layout:l.id } })); scheduleAutoSave(); }}
                style={{ padding:'7px 4px', borderRadius:7, background:activeSlide?.layout===l.id?'rgba(200,169,110,0.12)':'var(--bg-surface2)', border:`0.5px solid ${activeSlide?.layout===l.id?'rgba(200,169,110,0.4)':'var(--border)'}`, cursor:'pointer', fontFamily:'inherit', display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                <div style={{ color:activeSlide?.layout===l.id?'var(--accent)':'var(--text-secondary)' }}>{l.icon}</div>
                <div style={{ fontSize:9, color:activeSlide?.layout===l.id?'var(--accent)':'var(--text-tertiary)' }}>{l.label}</div>
              </button>
            ))}
          </div>

          {/* 演讲者备注 */}
          <div style={{ padding:'0 12px', borderTop:'0.5px solid var(--border)', marginTop:4, flex:1, display:'flex', flexDirection:'column', minHeight:0 }}>
            <div style={{ fontSize:10.5, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' as const, color:'var(--text-tertiary)', padding:'10px 0 7px', flexShrink:0 }}>演讲者备注</div>
            <textarea value={activeSlide?.notes||''}
              onChange={e => { dispatch(updateSlideLocal({ index:activeSlideIndex, changes:{ notes:e.target.value } })); scheduleAutoSave(); }}
              placeholder="输入演讲要点..."
              style={{ flex:1, minHeight:100, background:'var(--bg-surface3)', border:'0.5px solid var(--border)', borderRadius:8, padding:'8px 10px', fontSize:12, color:'var(--text-secondary)', outline:'none', fontFamily:'inherit', resize:'none', lineHeight:1.65, boxSizing:'border-box' }} />
          </div>

          {/* 颜色控制 */}
          <div style={{ padding:'8px 12px', borderTop:'0.5px solid var(--border)', flexShrink:0 }}>
            <div style={{ fontSize:10.5, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' as const, color:'var(--text-tertiary)', marginBottom:8 }}>强调色</div>
            <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
              {['#c8a96e','#64ffda','#a78bfa','#ff6b35','#e8c87a','#7ae8a0','#7ab8e8','#e87a7a','#f5f5f7'].map(color => (
                <div key={color} onClick={() => { handleContentChange({ accentColor: color }); }} style={{ width:18, height:18, borderRadius:4, background:color, cursor:'pointer', border:activeSlide?.content?.accentColor===color?'2px solid #fff':'2px solid transparent', boxSizing:'border-box' }} />
              ))}
              <input type="color" defaultValue="#c8a96e" onChange={e => handleContentChange({ accentColor: e.target.value })} style={{ width:18, height:18, border:'none', padding:0, borderRadius:4, cursor:'pointer', background:'none' }} title="自定义颜色" />
            </div>
          </div>

          {/* 背景色 */}
          <div style={{ padding:'8px 12px', borderTop:'0.5px solid var(--border)', flexShrink:0 }}>
            <div style={{ fontSize:10.5, fontWeight:600, letterSpacing:'0.08em', textTransform:'uppercase' as const, color:'var(--text-tertiary)', marginBottom:8 }}>幻灯片背景</div>
            <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
              {['transparent','#0d1117','#ffffff','#1a0533','#0a1628','#1a0a00','#f5f5f0','#1c1c2e','#0f2027'].map(color => (
                <div key={color} onClick={() => handleContentChange({ bgColor: color })} style={{ width:18, height:18, borderRadius:4, background:color||'var(--bg-surface3)', cursor:'pointer', border:activeSlide?.content?.bgColor===color?'2px solid var(--accent)':'1px solid var(--border)', boxSizing:'border-box' }} title={color==='transparent'?'跟随主题':color} />
              ))}
              <input type="color" defaultValue="#0d1117" onChange={e => handleContentChange({ bgColor: e.target.value })} style={{ width:18, height:18, border:'none', padding:0, borderRadius:4, cursor:'pointer', background:'none' }} title="自定义背景" />
            </div>
          </div>

          {/* 幻灯片信息 */}
          <div style={{ padding:'10px 12px 14px', borderTop:'0.5px solid var(--border)', fontSize:10.5, color:'var(--text-tertiary)', lineHeight:1.9, flexShrink:0 }}>
            <div>第 {activeSlideIndex+1} 张 · 共 {pres.slides.length} 张</div>
            <div>布局：{LAYOUTS.find(l=>l.id===activeSlide?.layout)?.label || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// 根组件
// ─────────────────────────────────────────────────────────────
export const SlidesView: React.FC = React.memo(() => {
  const dispatch = useDispatch<AppDispatch>();
  const openPresentation = useSelector((s: RootState) => (s as any).presentations?.openPresentation);
  const activeWorkspaceId = useSelector((s: RootState) => s.app.activeWorkspaceId);
  const [showAiPanel, setShowAiPanel] = useState(false);

  const handleOpen = (id: string) => { dispatch(fetchPresentation(id)); };

  // AI 生成后直接创建演示并打开
  const handleAiGenerated = async (slides: Slide[], presId: string) => {
    if (!activeWorkspaceId) return;
    setShowAiPanel(false);
    // 先从 AI 结果里抽取标题
    const titleSlide = slides.find(s => s.layout === 'title');
    const title = titleSlide?.content?.title || 'AI 生成演示';

    // 创建演示文稿记录
    const pres = await (dispatch as any)(createPresentation({ workspaceId: activeWorkspaceId, title, theme: 'dark' })).unwrap();
    if (!pres?.id) return;

    // 用 AI 生成的幻灯片替换默认的第一张，通过 saveAllSlides 写入 DB
    const finalSlides = slides.map((s, i) => ({ ...s, id: uuidv4(), presentationId: pres.id, sortOrder: i }));
    await (dispatch as any)(saveAllSlides({ presentationId: pres.id, slides: finalSlides }));

    // 打开编辑器
    dispatch(fetchPresentation(pres.id));
  };

  if (openPresentation) return <PresentationEditor onBack={() => dispatch(closePresentation())} />;

  return (
    <>
      <PresentationList onOpen={handleOpen} onAiCreate={() => setShowAiPanel(true)} />
      {showAiPanel && activeWorkspaceId && (
        <AiGeneratePanel
          workspaceId={activeWorkspaceId}
          theme="dark"
          onGenerated={handleAiGenerated}
          onClose={() => setShowAiPanel(false)}
        />
      )}
    </>
  );
});
