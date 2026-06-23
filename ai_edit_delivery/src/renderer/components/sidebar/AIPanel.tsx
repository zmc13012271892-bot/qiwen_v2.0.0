import React, { useState, useRef, useEffect, useCallback } from 'react';
import { diffWords } from 'diff';
import { htmlToMarkdown, markdownToHtml } from '../../utils/markdownConvert';

// ── 类型 ─────────────────────────────────────────────────────
interface Message {
  role: 'user' | 'assistant';
  content: string;
  thinking?: boolean; // 思考中占位
}

// ── 快捷操作配置 ──────────────────────────────────────────────
const QUICK_ACTIONS = [
  { id: 'continue', icon: '✦', title: '继续写作', desc: '从当前位置延伸内容',
    prompt: (doc: string) => `请根据以下文档内容，自然地继续写作，保持相同的风格和语气，续写150-300字：\n\n${doc.slice(-800)}` },
  { id: 'polish', icon: '✧', title: '改写润色', desc: '提升语言表达质量',
    prompt: (doc: string) => `请对以下文本进行改写润色，保留核心意思，提升语言表达质量、逻辑清晰度和可读性：\n\n${doc.slice(0, 1200)}` },
  { id: 'summary', icon: '◎', title: '提炼摘要', desc: '生成结构化摘要',
    prompt: (doc: string) => `请为以下文档生成一份简洁的结构化摘要（200字以内），包含核心观点和主要内容：\n\n${doc.slice(0, 2000)}` },
  { id: 'outline', icon: '≡', title: '生成大纲', desc: '提取文档结构大纲',
    prompt: (doc: string) => `请分析以下文档内容，生成一份清晰的层级大纲：\n\n${doc.slice(0, 2000)}` },
  { id: 'polish_zh', icon: '文', title: '中文优化', desc: '优化中文表达和用词',
    prompt: (doc: string) => `请优化以下中文文本的表达，改正不自然的用词，使语言更流畅地道：\n\n${doc.slice(0, 1200)}` },
  { id: 'expand', icon: '⊕', title: '扩展内容', desc: '详细展开补充内容',
    prompt: (doc: string) => `请对以下内容进行详细扩展，增加具体细节、例子或论据，使内容更充实：\n\n${doc.slice(0, 1200)}` },
  { id: 'gen_outline', icon: '📋', title: '生成大纲', desc: '输入主题，生成写作大纲',
    prompt: (_doc: string, topic?: string) => `请为主题「${topic || '未命名'}」生成一份详细的写作大纲，使用Markdown层级结构（# ## ### 等），包含主要章节和子要点，便于直接插入文档：` },
  { id: 'doc_qa', icon: '❓', title: '文档问答', desc: '基于当前文档内容提问',
    prompt: (doc: string, question?: string) => `请仅根据以下文档内容回答问题，如文档中没有相关信息请明确说明：\n\n文档内容：\n${doc.slice(0, 3000)}\n\n问题：${question || '请总结文档的主要内容'}` },
];

// ── 工具函数 ──────────────────────────────────────────────────
function getEditor(): any { return (window as any).__activeEditor || null; }

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function getDocContent(): string {
  const ed = getEditor();
  if (ed) {
    try { const t = ed.getText(); if (t?.trim()) return t.slice(0, 3000); } catch {}
    try { const h = ed.getHTML(); if (h && h !== '<p></p>') return stripHtml(h).slice(0, 3000); } catch {}
  }
  return '';
}

function insertToEditor(text: string) {
  const ed = getEditor();
  if (!ed) return false;
  try { ed.chain().focus().insertContent(text).run(); return true; } catch { return false; }
}

// AI 编辑功能专用：取完整 HTML（不是 quick action 用的纯文本），用于和 markdown 互转
function getEditorHtml(): string {
  const ed = getEditor();
  if (!ed) return '';
  try { return ed.getHTML() || ''; } catch { return ''; }
}

// AI 编辑功能专用：把修改后的 markdown 转回 HTML，整体替换文档内容。
// 用 selectAll + insertContent（走正常的事务流程）而不是 setContent，
// 这样改动会进入 TipTap 自己的撤销历史，用户不满意可以直接 Ctrl+Z 撤回，
// 跟"先看 diff 再确认"这道保险叠在一起，双重兜底。
function replaceEditorContent(html: string): boolean {
  const ed = getEditor();
  if (!ed) return false;
  try { ed.chain().focus().selectAll().insertContent(html).run(); return true; } catch { return false; }
}

// ── 存储：优先 localStorage（持久化） ────────────────────────
const KEY_STORAGE = 'qiwen_doubao_apikey';
const MODEL_STORAGE = 'qiwen_doubao_model';
// 对话历史用 sessionStorage：重启应用自动清空（不跨会话保留）
// 如需永久保存，用户可手动导出
const CHAT_HISTORY_KEY = 'qiwen_chat_history_session';
const BUILTIN_API_KEY = 'ark-0f0fd51c-1395-45bd-9df0-29a195257d96-5ab55';
const BUILTIN_MODEL = 'doubao-seed-2-0-pro-260215';

function safeGet(key: string): string | null {
  try { const v = localStorage.getItem(key); if (v !== null) return v; } catch {}
  try { return sessionStorage.getItem(key); } catch {}
  return null;
}
function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); return; } catch {}
  try { sessionStorage.setItem(key, value); } catch {}
}

function getApiKey() { return safeGet(KEY_STORAGE) || BUILTIN_API_KEY; }
function saveApiKey(k: string) { safeSet(KEY_STORAGE, k); }
function getModel() { return safeGet(MODEL_STORAGE) || BUILTIN_MODEL; }
function saveModel(m: string) { safeSet(MODEL_STORAGE, m); }

// 对话历史仅在本次会话内保留（sessionStorage），重启应用自动清空
function loadChatHistory(): Message[] {
  try {
    const raw = sessionStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw).filter((m: any) => m.role && m.content && !m.thinking);
  } catch { return []; }
}
function saveChatHistory(msgs: Message[]) {
  try {
    const toSave = msgs.filter(m => !m.thinking).slice(-50);
    sessionStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(toSave));
  } catch {}
}

// ── AI 请求（通过主进程代理） ────────────────────────────────
async function streamChat(
  messages: { role: string; content: string }[],
  apiKey: string,
  model: string,
  onChunk: (text: string) => void,
  signal: AbortSignal
): Promise<void> {
  const api = (window as any).electronAPI;
  if (!api?.invoke) throw new Error('请在桌面应用中使用 AI 功能');

  let result: string;
  try {
    result = await api.invoke('ai:chat-stream', { messages, apiKey, model });
  } catch (err: any) {
    throw new Error(err?.message || '网络请求失败，请检查网络连接');
  }

  if (!result) throw new Error('AI 返回了空响应，请重试');
  if (signal.aborted) return;

  // 模拟流式输出（逐字推送）
  const chunkSize = 4;
  for (let i = 0; i < result.length; i += chunkSize) {
    if (signal.aborted) return;
    onChunk(result.slice(i, i + chunkSize));
    await new Promise(r => setTimeout(r, 12));
  }
}

// ── 思考动画组件 ─────────────────────────────────────────────
const ThinkingAnimation: React.FC = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
    background: 'var(--bg-surface2)', border: '0.5px solid var(--border)',
    borderRadius: '3px 12px 12px 12px', marginBottom: 8 }}>
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 7, height: 7, borderRadius: '50%',
          background: 'var(--accent)', opacity: 0.7,
          animation: `thinkDot 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>AI 正在思考...</span>
    <style>{`
      @keyframes thinkDot {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1); opacity: 1; }
      }
      @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
    `}</style>
  </div>
);

// ── 设置面板 ─────────────────────────────────────────────────
const SettingsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [key, setKey] = useState(() => safeGet(KEY_STORAGE) || '');
  const [model, setModel] = useState(getModel);
  const [show, setShow] = useState(false);

  const handleSave = () => {
    if (key.trim()) saveApiKey(key.trim());
    else { try { localStorage.removeItem(KEY_STORAGE); } catch {} try { sessionStorage.removeItem(KEY_STORAGE); } catch {} }
    saveModel(model);
    onClose();
  };

  const inputS: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    background: 'var(--bg-surface3)', border: '0.5px solid var(--border)',
    color: 'var(--text-primary)', fontSize: 12.5, outline: 'none',
    fontFamily: 'inherit', boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ padding: '14px 14px 10px', borderBottom: '0.5px solid var(--border)', background: 'var(--bg-surface2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>豆包 API 设置</span>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>API Key</div>
        <div style={{ position: 'relative' as const }}>
          <input type={show ? 'text' : 'password'} value={key} onChange={e => setKey(e.target.value)}
            placeholder="留空使用内置 Key，或填入自己的 Key" style={{ ...inputS, paddingRight: 32 }} />
          <button onClick={() => setShow(v => !v)} style={{ position: 'absolute' as const, right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 12, padding: 0 }}>
            {show ? '🙈' : '👁'}
          </button>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4 }}>模型</div>
        <select value={model} onChange={e => { saveModel(e.target.value); setModel(e.target.value); }} style={{ ...inputS, appearance: 'none' as const }}>
          <option value="doubao-seed-2-0-pro-260215">Doubao Seed 2.0 Pro（推荐）</option>
          <option value="doubao-seed-1-6-flash-250615">豆包 Seed 1.6 Flash（快速）</option>
          <option value="doubao-seed-1-6-thinking-250615">豆包 Seed 1.6 Thinking（推理）</option>
          <option value="doubao-1-5-pro-32k-250115">豆包 1.5 Pro 32K（均衡）</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onClose} style={{ flex: 1, padding: '7px', borderRadius: 7, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>取消</button>
        <button onClick={handleSave} style={{ flex: 2, padding: '7px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#c8a96e,#9a7040)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit' }}>保存</button>
      </div>
      <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        内置 Key 开箱即用。填写自己的 Key 优先使用，清空则恢复内置。
        <a href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', marginLeft: 4 }}>获取 API Key →</a>
      </div>
    </div>
  );
};

// ── 主 AI 面板 ────────────────────────────────────────────────
export const AIPanel: React.FC<{ documentContent?: string }> = ({ documentContent = '' }) => {
  const [tab, setTab] = useState<'quick' | 'chat' | 'edit'>('quick');
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => loadChatHistory());
  const [quickResult, setQuickResult] = useState<{ action: string; content: string } | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false); // 等待 AI 响应的思考阶段
  const [streamText, setStreamText] = useState('');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── "编辑" tab 专用状态 ──────────────────────────────────────
  // editInstruction: 当前正在输入的修改指令
  // pendingDiff: 生成出来、等待用户确认的改动（还没写回编辑器）
  // editHistory: 这个编辑会话里发生过的指令记录（应用过的/放弃的），只是给用户一个"刚才做了什么"的回顾，不持久化
  const [editInstruction, setEditInstruction] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [pendingDiff, setPendingDiff] = useState<{
    instruction: string;
    oldMarkdown: string;
    newMarkdown: string;
    parts: { value: string; added?: boolean; removed?: boolean }[];
  } | null>(null);
  const [editHistory, setEditHistory] = useState<{ instruction: string; status: 'applied' | 'discarded' }[]>([]);
  const editAbortRef = useRef<AbortController | null>(null);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText, thinking]);

  // 对话历史持久化
  useEffect(() => {
    saveChatHistory(messages);
  }, [messages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
    setThinking(false);
    setActiveAction(null);
  }, []);

  // 用 ref 追踪 thinking，避免 useCallback 闭包捕获旧值
  const thinkingRef = useRef(false);

  const callAI = useCallback(async (
    msgs: Message[],
    onDone: (full: string) => void,
    onChunkUpdate?: (text: string) => void
  ) => {
    const key = getApiKey();
    setError('');
    thinkingRef.current = true;
    setThinking(true);
    setStreaming(false);
    setStreamText('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let full = '';

    try {
      await streamChat(
        msgs.map(m => ({ role: m.role, content: m.content })),
        key,
        getModel(),
        (chunk) => {
          if (thinkingRef.current) {
            thinkingRef.current = false;
            setThinking(false);
          }
          setStreaming(true);
          full += chunk;
          setStreamText(full);
          onChunkUpdate?.(full);
        },
        ctrl.signal
      );
      thinkingRef.current = false;
      setThinking(false);
      onDone(full);
    } catch (e: any) {
      thinkingRef.current = false;
      setThinking(false);
      if (e?.name === 'AbortError') return;
      const msg = e?.message || '请求失败';
      if (msg.includes('401') || msg.includes('invalid') || msg.includes('Unauthorized')) {
        setError('API Key 无效，请在设置中更换');
        setShowSettings(true);
      } else if (msg.includes('timeout') || msg.includes('超时')) {
        setError('请求超时，请检查网络后重试');
      } else {
        setError('AI 请求失败：' + msg);
      }
    } finally {
      setStreaming(false);
      thinkingRef.current = false;
      setThinking(false);
      setStreamText('');
      setActiveAction(null);
      abortRef.current = null;
    }
  }, []);

  // ── 快捷操作 ───────────────────────────────────────────────
  const [quickInput, setQuickInput] = React.useState('');
  const [quickInputFor, setQuickInputFor] = React.useState<typeof QUICK_ACTIONS[0] | null>(null);

  const handleQuickAction = useCallback(async (action: typeof QUICK_ACTIONS[0]) => {
    if (streaming || thinking) return;
    // 大纲生成和文档问答需要额外输入
    if (action.id === 'gen_outline' || action.id === 'doc_qa') {
      setQuickInputFor(action);
      setQuickInput('');
      return;
    }
    const docText = stripHtml(documentContent || '') || getDocContent();
    if (!docText.trim()) {
      setError('文档内容为空，请先在编辑器中写一些内容再使用 AI 功能');
      return;
    }
    setActiveAction(action.id);
    setQuickResult(null);
    const prompt = action.prompt(docText);

    await callAI([{ role: 'user', content: prompt }], (full) => {
      setQuickResult({ action: action.title, content: full });
    });
  }, [documentContent, callAI, streaming, thinking]);

  const handleQuickInputSubmit = useCallback(async () => {
    if (!quickInputFor || !quickInput.trim()) return;
    const action = quickInputFor;
    setQuickInputFor(null);
    const docText = stripHtml(documentContent || '') || getDocContent();
    setActiveAction(action.id);
    setQuickResult(null);
    const prompt = action.prompt(docText, quickInput.trim());
    await callAI([{ role: 'user', content: prompt }], (full) => {
      setQuickResult({ action: action.title, content: full });
    });
    setQuickInput('');
  }, [quickInputFor, quickInput, documentContent, callAI]);

  // ── 对话发送 ───────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming || thinking) return;
    setInput('');
    const userMsg: Message = { role: 'user', content: text };
    const updatedMsgs = [...messages, userMsg];
    setMessages(updatedMsgs);
    setTab('chat');

    const docText = stripHtml(documentContent || '') || getDocContent();
    const contextPrefix = docText
      ? `你是一位写作助手。用户正在编写以下文档内容：\n\n${docText.slice(0, 1500)}\n\n---\n\n`
      : '';

    // 构建 API 消息：历史上下文 + 当前消息（context prefix 放 system 位置）
    const historyMsgs = updatedMsgs.slice(0, -1).slice(-9); // 最多9条历史
    const apiMsgs: Message[] = contextPrefix
      ? [
          { role: 'user', content: contextPrefix + '（以上是文档背景，请基于此回答后续问题）' },
          { role: 'assistant', content: '好的，我已了解文档内容，请继续。' },
          ...historyMsgs,
          userMsg,
        ]
      : [...historyMsgs, userMsg];

    await callAI(apiMsgs, (full) => {
      setMessages(prev => [...prev.filter(m => !m.thinking), { role: 'assistant', content: full }]);
    });
  }, [input, streaming, thinking, messages, documentContent, callAI]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── AI 编辑：生成修改建议（不直接应用） ─────────────────────
  const handleGenerateEdit = useCallback(async () => {
    const instruction = editInstruction.trim();
    if (!instruction || editLoading) return;

    const currentHtml = getEditorHtml();
    if (!currentHtml || currentHtml === '<p></p>') {
      setEditError('文档内容为空，请先在编辑器中写一些内容');
      return;
    }
    const oldMarkdown = htmlToMarkdown(currentHtml);

    setEditLoading(true);
    setEditError('');
    setPendingDiff(null);

    const systemPrompt =
      '你是一个文档编辑助手。下面会给你完整的文档内容（Markdown 格式）和用户希望做的修改。' +
      '请直接输出修改后的完整文档全文（Markdown 格式），不要输出任何解释、说明或代码块包裹符号，' +
      '只输出文档本身。没有要求修改的部分要原样保留，不要无关改写。';

    const ctrl = new AbortController();
    editAbortRef.current = ctrl;

    try {
      const api = (window as any).electronAPI;
      if (!api?.invoke) throw new Error('请在桌面应用中使用 AI 功能');

      // 编辑场景需要完整文档参与，不像快捷操作那样只截取片段——
      // 这里只做一个很宽松的上限（约 12000 字），避免极端长文档把请求撑爆，
      // 正常长度的文章/报告都不会碰到这个上限。
      const docForPrompt = oldMarkdown.length > 12000 ? oldMarkdown.slice(0, 12000) + '\n\n...(文档过长，已截断)' : oldMarkdown;

      const result: string = await api.invoke('ai:chat-stream', {
        messages: [
          { role: 'user', content: `${systemPrompt}\n\n文档内容：\n${docForPrompt}\n\n用户的修改要求：${instruction}` },
        ],
        apiKey: getApiKey(),
        model: getModel(),
      });

      if (ctrl.signal.aborted) return;
      if (!result) throw new Error('AI 返回了空响应，请重试');

      const newMarkdown = result
        .trim()
        .replace(/^```(?:markdown|md)?\s*\n/i, '')
        .replace(/\n```\s*$/, '');

      const parts = diffWords(oldMarkdown, newMarkdown);
      setPendingDiff({ instruction, oldMarkdown, newMarkdown, parts });
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setEditError(e?.message || 'AI 生成修改失败，请重试');
    } finally {
      setEditLoading(false);
      editAbortRef.current = null;
    }
  }, [editInstruction, editLoading]);

  const handleApplyEdit = useCallback(() => {
    if (!pendingDiff) return;
    const html = markdownToHtml(pendingDiff.newMarkdown);
    const ok = replaceEditorContent(html);
    setEditHistory(h => [...h, { instruction: pendingDiff.instruction, status: ok ? 'applied' : 'discarded' }]);
    if (!ok) setEditError('应用失败：没有检测到打开的文档编辑器');
    setPendingDiff(null);
    setEditInstruction('');
  }, [pendingDiff]);

  const handleDiscardEdit = useCallback(() => {
    if (!pendingDiff) return;
    setEditHistory(h => [...h, { instruction: pendingDiff.instruction, status: 'discarded' }]);
    setPendingDiff(null);
  }, [pendingDiff]);

  const stopEdit = useCallback(() => {
    editAbortRef.current?.abort();
    setEditLoading(false);
  }, []);

  const handleInsert = useCallback((content: string) => {
    if (!insertToEditor(content)) {
      navigator.clipboard.writeText(content).catch(() => {});
      setError('已复制到剪贴板');
      setTimeout(() => setError(''), 2500);
    }
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setQuickResult(null);
    try { sessionStorage.removeItem(CHAT_HISTORY_KEY); } catch {}
  }, []);

  const tabBtnS = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '7px 0', fontSize: 12, fontFamily: 'inherit',
    background: 'transparent', border: 'none', cursor: 'pointer',
    color: active ? 'var(--accent)' : 'var(--text-tertiary)',
    borderBottom: `1.5px solid ${active ? 'var(--accent)' : 'transparent'}`,
    transition: 'all 0.15s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, height: '100%', overflow: 'hidden' }}>
      <style>{`
        @keyframes thinkDot { 0%,80%,100%{transform:scale(0.6);opacity:0.4} 40%{transform:scale(1);opacity:1} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes spin { to{transform:rotate(360deg)} }
      `}</style>

      {/* 设置面板 */}
      {showSettings && <SettingsPanel onClose={() => { setShowSettings(false); }} />}

      {/* 顶部标签栏 */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}>
        <button style={tabBtnS(tab === 'quick')} onClick={() => setTab('quick')}>快捷操作</button>
        <button style={tabBtnS(tab === 'edit')} onClick={() => setTab('edit')}>AI 编辑</button>
        <button style={tabBtnS(tab === 'chat')} onClick={() => setTab('chat')}>
          对话 {messages.length > 0 && <span style={{ fontSize: 10, background: 'rgba(200,169,110,0.2)', color: 'var(--accent)', borderRadius: 10, padding: '0 5px', marginLeft: 3 }}>{messages.length}</span>}
        </button>
        <button onClick={() => setShowSettings(v => !v)} title="API 设置"
          style={{ width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', flexShrink: 0, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          ⚙
        </button>
      </div>

      {/* 错误提示 */}
      {error && (
        <div style={{ padding: '7px 12px', background: 'rgba(232,122,122,0.1)', borderBottom: '0.5px solid rgba(232,122,122,0.2)', fontSize: 11.5, color: '#e87a7a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          {error}
          <button onClick={() => setError('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#e87a7a', fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* 思考状态提示条（两个 tab 通用） */}
      {thinking && (
        <div style={{ padding: '6px 12px', background: 'rgba(200,169,110,0.06)', borderBottom: '0.5px solid rgba(200,169,110,0.15)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)',
                animation: `thinkDot 1.2s ease-in-out ${i*0.2}s infinite` }} />
            ))}
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--accent)' }}>AI 正在思考...</span>
          <button onClick={stop} style={{ marginLeft: 'auto', padding: '2px 8px', borderRadius: 5, border: '0.5px solid rgba(200,169,110,0.3)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>停止</button>
        </div>
      )}

      {/* ── 快捷操作 tab ─────────────────────────────────────── */}
      {tab === 'quick' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px 6px', flexShrink: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.8px', color: 'var(--text-tertiary)', textTransform: 'uppercase' as const, marginBottom: 8 }}>选择操作</div>
            {QUICK_ACTIONS.map(action => (
              <div key={action.id}
                onClick={() => !(streaming || thinking) && handleQuickAction(action)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 10px', borderRadius: 8, marginBottom: 5,
                  cursor: (streaming || thinking) ? 'not-allowed' : 'pointer',
                  border: `0.5px solid ${activeAction === action.id ? 'rgba(200,169,110,0.5)' : 'var(--border)'}`,
                  background: activeAction === action.id ? 'rgba(200,169,110,0.1)' : 'var(--bg-surface2)',
                  opacity: (streaming || thinking) && activeAction !== action.id ? 0.5 : 1,
                  transition: 'all 0.15s',
                }}
                onMouseOver={e => { if (!(streaming || thinking)) { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,169,110,0.3)'; (e.currentTarget as HTMLElement).style.background = 'rgba(200,169,110,0.06)'; }}}
                onMouseOut={e => { if (activeAction !== action.id) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.background = 'var(--bg-surface2)'; }}}
              >
                <div style={{ width: 24, height: 24, borderRadius: 6, background: activeAction === action.id ? 'rgba(200,169,110,0.2)' : 'var(--bg-surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, color: 'var(--accent)' }}>
                  {activeAction === action.id && (streaming || thinking) ? (
                    <div style={{ width: 10, height: 10, border: '1.5px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                  ) : action.icon}
                </div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)' }}>{action.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{action.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' as const, padding: '0 12px 12px' }}>
            {/* 思考中动画 */}
            {thinking && activeAction && <ThinkingAnimation />}

            {/* 流式输出 */}
            {streaming && streamText && (
              <div style={{ background: 'var(--bg-surface2)', borderRadius: 10, border: '0.5px solid var(--border)', padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ fontSize: 10.5, color: 'var(--accent)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: 'blink 0.8s step-end infinite' }} />
                  正在生成
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' as const }}>{streamText}</div>
              </div>
            )}

            {/* 结果 */}
            {/* 大纲/问答输入弹窗 */}
            {quickInputFor && (
              <div style={{ padding: '12px 14px', background: 'rgba(200,169,110,0.06)', border: '0.5px solid rgba(200,169,110,0.25)', borderRadius: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 500, marginBottom: 8 }}>
                  {quickInputFor.id === 'gen_outline' ? '📋 请输入写作主题' : '❓ 请输入你的问题'}
                </div>
                <input autoFocus value={quickInput} onChange={e => setQuickInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleQuickInputSubmit(); if (e.key === 'Escape') setQuickInputFor(null); }}
                  placeholder={quickInputFor.id === 'gen_outline' ? '例如：人工智能对教育的影响' : '例如：这篇文章的主要论点是什么？'}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 7, background: 'var(--bg-surface3)', border: '0.5px solid var(--border-md)', color: 'var(--text-primary)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' as const, marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleQuickInputSubmit} disabled={!quickInput.trim()} style={{ flex: 1, padding: '5px', borderRadius: 6, border: 'none', background: quickInput.trim() ? 'linear-gradient(135deg,#c8a96e,#9a7040)' : 'var(--bg-surface3)', color: quickInput.trim() ? '#fff' : 'var(--text-tertiary)', cursor: quickInput.trim() ? 'pointer' : 'default', fontSize: 12, fontFamily: 'inherit', fontWeight: 500 }}>生成</button>
                  <button onClick={() => setQuickInputFor(null)} style={{ padding: '5px 10px', borderRadius: 6, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>取消</button>
                </div>
              </div>
            )}

            {!streaming && !thinking && quickResult && (
              <div style={{ background: 'var(--bg-surface2)', borderRadius: 10, border: '0.5px solid rgba(200,169,110,0.25)', padding: '10px 12px' }}>
                <div style={{ fontSize: 10.5, color: 'var(--accent)', marginBottom: 8, fontWeight: 500 }}>{quickResult.action} 结果</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' as const, marginBottom: 10 }}>
                  {quickResult.content}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => handleInsert(quickResult.content)} style={{ flex: 1, padding: '6px', borderRadius: 6, border: 'none', background: 'linear-gradient(135deg,#c8a96e,#9a7040)', color: '#fff', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit', fontWeight: 500 }}>
                    插入文档
                  </button>
                  <button onClick={() => navigator.clipboard.writeText(quickResult.content)} style={{ padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}>
                    复制
                  </button>
                  <button onClick={() => setQuickResult(null)} style={{ padding: '6px 10px', borderRadius: 6, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}>
                    清除
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── AI 编辑 tab ──────────────────────────────────────── */}
      {tab === 'edit' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto' as const, padding: '10px 12px' }}>
            {!pendingDiff && !editLoading && editHistory.length === 0 && (
              <div style={{ textAlign: 'center' as const, padding: '32px 0', color: 'var(--text-tertiary)', fontSize: 12.5 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✎</div>
                <div>描述你想对文档做的修改</div>
                <div style={{ fontSize: 11, marginTop: 6, opacity: 0.7 }}>AI 会先给出修改前后对比，确认无误再应用</div>
              </div>
            )}

            {editLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-tertiary)', fontSize: 13, padding: '12px 0' }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin .7s linear infinite' }} />
                正在生成修改…
                <button onClick={stopEdit} style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 6, border: '0.5px solid rgba(232,122,122,0.4)', background: 'rgba(232,122,122,0.08)', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}>停止</button>
              </div>
            )}

            {editError && (
              <div style={{ fontSize: 12.5, color: 'var(--color-danger)', padding: '8px 12px', background: 'rgba(var(--color-danger-rgb), 0.08)', borderRadius: 8, marginBottom: 10 }}>{editError}</div>
            )}

            {/* 修改前后对比 */}
            {pendingDiff && !editLoading && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500, marginBottom: 8 }}>
                  「{pendingDiff.instruction}」的修改预览
                </div>
                <div style={{
                  maxHeight: 320, overflowY: 'auto' as const, padding: '12px 14px',
                  background: 'var(--bg-surface2)', border: '0.5px solid var(--border)', borderRadius: 10,
                  fontSize: 12.5, lineHeight: 1.8, whiteSpace: 'pre-wrap' as const, marginBottom: 10,
                }}>
                  {pendingDiff.parts.map((part, i) => {
                    if (part.added) {
                      return <span key={i} style={{ background: 'rgba(var(--color-success-rgb), 0.18)', color: 'var(--color-success)' }}>{part.value}</span>;
                    }
                    if (part.removed) {
                      return <span key={i} style={{ background: 'rgba(var(--color-danger-rgb), 0.14)', color: 'var(--color-danger)', textDecoration: 'line-through' }}>{part.value}</span>;
                    }
                    return <span key={i} style={{ color: 'var(--text-secondary)' }}>{part.value}</span>;
                  })}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleApplyEdit} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,var(--accent),#9a7040)', color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit' }}>
                    ✓ 应用修改
                  </button>
                  <button onClick={() => handleGenerateEdit()} style={{ padding: '8px 12px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>
                    重新生成
                  </button>
                  <button onClick={handleDiscardEdit} style={{ padding: '8px 12px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>
                    放弃
                  </button>
                </div>
              </div>
            )}

            {/* 本次会话的修改记录 */}
            {editHistory.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>本次会话的修改记录</div>
                {editHistory.slice().reverse().map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 0', color: 'var(--text-secondary)' }}>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                      background: h.status === 'applied' ? 'rgba(var(--color-success-rgb), 0.15)' : 'rgba(255,255,255,0.06)',
                      color: h.status === 'applied' ? 'var(--color-success)' : 'var(--text-tertiary)',
                    }}>
                      {h.status === 'applied' ? '已应用' : '已放弃'}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{h.instruction}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ padding: '8px 12px 10px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <textarea
                value={editInstruction}
                onChange={e => setEditInstruction(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerateEdit(); } }}
                disabled={editLoading}
                placeholder="描述要做的修改，例如「把第二段改得更正式」"
                rows={2}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 9, background: 'var(--bg-surface3)', border: '0.5px solid var(--border)', color: 'var(--text-primary)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', resize: 'none' as const, lineHeight: 1.5 }}
              />
              <button onClick={handleGenerateEdit} disabled={!editInstruction.trim() || editLoading}
                style={{ width: 34, height: 34, borderRadius: 9, border: 'none', flexShrink: 0, background: editInstruction.trim() && !editLoading ? 'linear-gradient(135deg,var(--accent),#9a7040)' : 'var(--bg-surface3)', color: editInstruction.trim() && !editLoading ? '#fff' : 'var(--text-tertiary)', cursor: editInstruction.trim() && !editLoading ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all var(--dur-fast) var(--ease-smooth)' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 对话 tab ─────────────────────────────────────────── */}
      {tab === 'chat' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto' as const, padding: '10px 12px' }}>
            {messages.length === 0 && !streaming && !thinking && (
              <div style={{ textAlign: 'center' as const, padding: '32px 0', color: 'var(--text-tertiary)', fontSize: 12.5 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✦</div>
                <div>向 AI 提问或描述你的需求</div>
                <div style={{ fontSize: 11, marginTop: 6, color: 'var(--text-tertiary)', opacity: 0.7 }}>对话历史会自动保存</div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                {msg.role === 'user' ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' as const }}>
                    <div style={{ maxWidth: '85%', padding: '8px 11px', borderRadius: '12px 12px 3px 12px', background: 'linear-gradient(135deg,#c8a96e,#9a7040)', color: '#fff', fontSize: 12.5, lineHeight: 1.6 }}>
                      {msg.content}
                    </div>
                  </div>
                ) : (
                  <div style={{ maxWidth: '95%' }}>
                    <div style={{ padding: '8px 11px', borderRadius: '3px 12px 12px 12px', background: 'var(--bg-surface2)', border: '0.5px solid var(--border)', fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' as const }}>
                      {msg.content}
                    </div>
                    <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
                      <button onClick={() => handleInsert(msg.content)} style={{ padding: '3px 8px', borderRadius: 5, border: 'none', background: 'rgba(200,169,110,0.15)', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>插入</button>
                      <button onClick={() => navigator.clipboard.writeText(msg.content)} style={{ padding: '3px 8px', borderRadius: 5, border: 'none', background: 'var(--bg-surface3)', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' }}>复制</button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* 思考中动画（对话 tab） */}
            {thinking && <ThinkingAnimation />}

            {/* 流式输出 */}
            {streaming && streamText && (
              <div style={{ maxWidth: '95%', padding: '8px 11px', borderRadius: '3px 12px 12px 12px', background: 'var(--bg-surface2)', border: '0.5px solid var(--border)', fontSize: 12.5, lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' as const, marginBottom: 8 }}>
                {streamText}<span style={{ display: 'inline-block', width: 6, height: 13, background: 'var(--accent)', marginLeft: 2, verticalAlign: 'middle', borderRadius: 1, animation: 'blink 0.8s step-end infinite' }} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div style={{ padding: '8px 12px 10px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
            {messages.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>共 {messages.length} 条对话</span>
                <button onClick={clearHistory} style={{ padding: '0', border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-tertiary)', fontFamily: 'inherit' }}>
                  清空历史
                </button>
              </div>
            )}
            {(streaming || thinking) && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
                <button onClick={stop} style={{ padding: '4px 14px', borderRadius: 6, border: '0.5px solid rgba(232,122,122,0.4)', background: 'rgba(232,122,122,0.08)', color: '#e87a7a', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}>停止</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={streaming || thinking}
                placeholder="提问或描述需求... (Enter 发送, Shift+Enter 换行)"
                rows={2}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 9, background: 'var(--bg-surface3)', border: '0.5px solid var(--border)', color: 'var(--text-primary)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', resize: 'none' as const, lineHeight: 1.5 }}
              />
              <button onClick={handleSend} disabled={!input.trim() || streaming || thinking}
                style={{ width: 34, height: 34, borderRadius: 9, border: 'none', flexShrink: 0, background: input.trim() && !(streaming || thinking) ? 'linear-gradient(135deg,#c8a96e,#9a7040)' : 'var(--bg-surface3)', color: input.trim() && !(streaming || thinking) ? '#fff' : 'var(--text-tertiary)', cursor: input.trim() && !(streaming || thinking) ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
