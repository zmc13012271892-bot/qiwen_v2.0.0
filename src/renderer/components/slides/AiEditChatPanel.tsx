import React, { useState, useCallback, useRef } from 'react';
import { diffWords } from 'diff';
import { useDispatch } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';
import { AppDispatch } from '../../store';
import { Slide, SlideContent, SlideLayout, Presentation, setAllSlidesLocal, saveAllSlides } from '../../store/slices/presentationsSlice';

/**
 * AiEditChatPanel —— PPT 编辑器的对话式 AI 编辑面板。
 *
 * 跟文档编辑器那边（AIPanel.tsx 的"AI 编辑"tab）是同一套交互模型：
 * 描述要做的修改 → AI 生成结果 → 先看对比再确认应用，不直接动手改。
 * 但落地机制不同——文档是整段 markdown 文本 diff，PPT 这边幻灯片本身就是结构化数据
 * （layout + content 字段），所以走的是"按 id 比对每张幻灯片"的结构化 diff，
 * 而不是把整个 JSON 当文本比较，这样能清楚说出"第 3 张改了标题"而不是一坨面目全非的文本差异。
 *
 * 复用了 SlidesView.tsx 里 AiGeneratePanel 已经验证过的"JSON schema + 解析"模式，
 * 只是额外要求模型对保留下来的幻灯片原样带上 id，新增的不带 id——这是识别"改了/删了/加了"
 * 哪张幻灯片的关键，所以 prompt 里这条规则写得比较重。
 */

const BUILTIN_KEY = 'ark-0f0fd51c-1395-45bd-9df0-29a195257d96-5ab55';
const BUILTIN_MODEL = 'doubao-seed-2-0-pro-260215';
const getApiKey = () => { try { return localStorage.getItem('qiwen_doubao_apikey') || BUILTIN_KEY; } catch { return BUILTIN_KEY; } };
const getModel = () => { try { return localStorage.getItem('qiwen_doubao_model') || BUILTIN_MODEL; } catch { return BUILTIN_MODEL; } };

const CONTENT_TEXT_FIELDS: (keyof SlideContent)[] = ['title', 'subtitle', 'body', 'leftBody', 'rightBody', 'sectionLabel'];
const FIELD_LABEL: Record<string, string> = {
  title: '标题', subtitle: '副标题', body: '正文', leftBody: '左栏', rightBody: '右栏', sectionLabel: '章节标签',
};

interface DiffEntry {
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  oldSlide?: Slide;
  newContent?: SlideContent;
  newLayout?: SlideLayout;
}

function summarize(content?: SlideContent): string {
  if (!content) return '(空)';
  return content.title || content.sectionLabel || (content.body || '').slice(0, 30) || '(无标题)';
}

const WordDiff: React.FC<{ oldText: string; newText: string }> = ({ oldText, newText }) => {
  const parts = diffWords(oldText || '', newText || '');
  return (
    <span>
      {parts.map((part, i) => {
        if (part.added) return <span key={i} style={{ background: 'rgba(var(--color-success-rgb), 0.18)', color: 'var(--color-success)' }}>{part.value}</span>;
        if (part.removed) return <span key={i} style={{ background: 'rgba(var(--color-danger-rgb), 0.14)', color: 'var(--color-danger)', textDecoration: 'line-through' }}>{part.value}</span>;
        return <span key={i}>{part.value}</span>;
      })}
    </span>
  );
};

const DiffCard: React.FC<{ entry: DiffEntry; index: number }> = ({ entry, index }) => {
  const badge = { added: ['新增', 'var(--color-success)', 'rgba(var(--color-success-rgb), 0.15)'],
    removed: ['删除', 'var(--color-danger)', 'rgba(var(--color-danger-rgb), 0.15)'],
    modified: ['已修改', 'var(--accent)', 'rgba(var(--accent-rgb), 0.15)'],
    unchanged: ['不变', 'var(--text-tertiary)', 'rgba(255,255,255,0.05)'] }[entry.status];

  if (entry.status === 'unchanged') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', fontSize: 11.5, color: 'var(--text-tertiary)' }}>
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: badge[2], color: badge[1], flexShrink: 0 }}>{badge[0]}</span>
        幻灯片 {index + 1} · {summarize(entry.oldSlide?.content)}
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 12px', background: 'var(--bg-surface2)', border: '0.5px solid var(--border)', borderRadius: 9, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: entry.status === 'modified' ? 8 : 0 }}>
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: badge[2], color: badge[1], flexShrink: 0 }}>{badge[0]}</span>
        <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>幻灯片 {index + 1}</span>
      </div>

      {entry.status === 'added' && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{summarize(entry.newContent)}</div>
      )}
      {entry.status === 'removed' && (
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6, textDecoration: 'line-through' }}>{summarize(entry.oldSlide?.content)}</div>
      )}
      {entry.status === 'modified' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {CONTENT_TEXT_FIELDS.map(field => {
            const oldVal = entry.oldSlide?.content?.[field] as string | undefined;
            const newVal = entry.newContent?.[field] as string | undefined;
            if ((oldVal || '') === (newVal || '')) return null;
            return (
              <div key={field} style={{ fontSize: 12, lineHeight: 1.7 }}>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 10.5, marginRight: 4 }}>{FIELD_LABEL[field]}</span>
                <WordDiff oldText={oldVal || ''} newText={newVal || ''} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const AiEditChatPanel: React.FC<{ presentation: Presentation; onClose: () => void }> = ({ presentation, onClose }) => {
  const dispatch = useDispatch<AppDispatch>();
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingDiff, setPendingDiff] = useState<{ instruction: string; entries: DiffEntry[]; finalSlides: Slide[] } | null>(null);
  const [history, setHistory] = useState<{ instruction: string; status: 'applied' | 'discarded' }[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const handleGenerate = useCallback(async () => {
    const text = instruction.trim();
    if (!text || loading) return;
    setLoading(true);
    setError('');
    setPendingDiff(null);

    const currentJson = presentation.slides.map(s => ({ id: s.id, layout: s.layout, content: s.content, notes: s.notes }));

    const systemPrompt = `你是一个演示文稿编辑助手。下面会给你当前的完整幻灯片数据（JSON 数组）和用户希望做的修改。

请输出修改后的完整幻灯片 JSON 数组，规则：
- 对于保留下来的已有幻灯片（不管有没有修改内容），必须原样带上它原来的 "id" 字段，一个字都不要改
- 新增的幻灯片不要包含 "id" 字段
- 不需要修改的幻灯片，内容原样返回，不要无关改写
- 用户要求删除某张幻灯片时，直接不要把它包含在返回结果里
- layout 只能是: title, content, two-col, section, image, blank
- 只返回 JSON 数组本身，不要任何解释文字或代码块包裹符号

当前幻灯片数据：
${JSON.stringify(currentJson, null, 2)}`;

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const api = (window as any).electronAPI;
      if (!api?.invoke) throw new Error('请在桌面应用中使用 AI 功能');

      const result: string = await api.invoke('ai:chat-stream', {
        messages: [{ role: 'user', content: `${systemPrompt}\n\n用户的修改要求：${text}` }],
        apiKey: getApiKey(),
        model: getModel(),
      });

      if (ctrl.signal.aborted) return;
      if (!result) throw new Error('AI 返回了空响应，请重试');

      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('AI 返回格式异常，请重试');
      const raw = JSON.parse(jsonMatch[0]) as any[];

      const oldById = new Map(presentation.slides.map(s => [s.id, s]));
      const usedOldIds = new Set<string>();
      const entries: DiffEntry[] = [];
      const finalSlides: Slide[] = [];
      const now = Date.now();

      raw.forEach((item, i) => {
        const oldSlide = item.id ? oldById.get(item.id) : undefined;
        if (oldSlide) {
          usedOldIds.add(oldSlide.id);
          const changed = JSON.stringify(oldSlide.content) !== JSON.stringify(item.content || {}) || oldSlide.layout !== item.layout;
          entries.push({ status: changed ? 'modified' : 'unchanged', oldSlide, newContent: item.content, newLayout: item.layout });
          finalSlides.push({
            ...oldSlide,
            layout: item.layout || oldSlide.layout,
            content: item.content || oldSlide.content,
            notes: item.notes ?? oldSlide.notes,
            sortOrder: i,
            updatedAt: changed ? now : oldSlide.updatedAt,
          });
        } else {
          entries.push({ status: 'added', newContent: item.content, newLayout: item.layout });
          finalSlides.push({
            id: uuidv4(),
            presentationId: presentation.id,
            sortOrder: i,
            layout: item.layout || 'content',
            content: item.content || {},
            notes: item.notes || '',
            createdAt: now,
            updatedAt: now,
          });
        }
      });

      presentation.slides.forEach(s => {
        if (!usedOldIds.has(s.id)) entries.push({ status: 'removed', oldSlide: s });
      });

      if (finalSlides.length === 0) throw new Error('修改结果不能清空所有幻灯片，请换个说法重试');

      setPendingDiff({ instruction: text, entries, finalSlides });
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || 'AI 生成修改失败，请重试');
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [instruction, loading, presentation]);

  const handleApply = useCallback(() => {
    if (!pendingDiff) return;
    dispatch(setAllSlidesLocal(pendingDiff.finalSlides));
    dispatch(saveAllSlides({ presentationId: presentation.id, slides: pendingDiff.finalSlides }));
    setHistory(h => [...h, { instruction: pendingDiff.instruction, status: 'applied' }]);
    setPendingDiff(null);
    setInstruction('');
  }, [pendingDiff, dispatch, presentation.id]);

  const handleDiscard = useCallback(() => {
    if (!pendingDiff) return;
    setHistory(h => [...h, { instruction: pendingDiff.instruction, status: 'discarded' }]);
    setPendingDiff(null);
  }, [pendingDiff]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 360, zIndex: 200,
      background: 'var(--bg-surface)', borderLeft: '0.5px solid var(--border-md)',
      boxShadow: 'var(--shadow-xl)', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 14px 12px', borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>✎ AI 编辑</div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {!pendingDiff && !loading && history.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-tertiary)', fontSize: 12.5 }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✎</div>
            <div>描述你想对这份演示文稿做的修改</div>
            <div style={{ fontSize: 11, marginTop: 6, opacity: 0.7 }}>比如"把第3张的标题改得更简洁"或"加一张总结页"</div>
          </div>
        )}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-tertiary)', fontSize: 13, padding: '12px 0' }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin .7s linear infinite' }} />
            正在生成修改…
            <button onClick={stop} style={{ marginLeft: 'auto', padding: '3px 10px', borderRadius: 6, border: '0.5px solid rgba(232,122,122,0.4)', background: 'rgba(232,122,122,0.08)', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit' }}>停止</button>
          </div>
        )}

        {error && (
          <div style={{ fontSize: 12.5, color: 'var(--color-danger)', padding: '8px 12px', background: 'rgba(var(--color-danger-rgb), 0.08)', borderRadius: 8, marginBottom: 10 }}>{error}</div>
        )}

        {pendingDiff && !loading && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500, marginBottom: 8 }}>
              「{pendingDiff.instruction}」的修改预览
            </div>
            {pendingDiff.entries.map((entry, i) => <DiffCard key={i} entry={entry} index={i} />)}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={handleApply} style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,var(--accent),#9a7040)', color: '#fff', cursor: 'pointer', fontSize: 12.5, fontWeight: 500, fontFamily: 'inherit' }}>
                ✓ 应用修改
              </button>
              <button onClick={handleGenerate} style={{ padding: '8px 12px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>
                重新生成
              </button>
              <button onClick={handleDiscard} style={{ padding: '8px 12px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 12.5, fontFamily: 'inherit' }}>
                放弃
              </button>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>本次会话的修改记录</div>
            {history.slice().reverse().map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 0', color: 'var(--text-secondary)' }}>
                <span style={{
                  fontSize: 10, padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                  background: h.status === 'applied' ? 'rgba(var(--color-success-rgb), 0.15)' : 'rgba(255,255,255,0.06)',
                  color: h.status === 'applied' ? 'var(--color-success)' : 'var(--text-tertiary)',
                }}>
                  {h.status === 'applied' ? '已应用' : '已放弃'}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.instruction}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '8px 12px 10px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } }}
            disabled={loading}
            placeholder="描述要做的修改... (Enter 发送)"
            rows={2}
            style={{ flex: 1, padding: '8px 10px', borderRadius: 9, background: 'var(--bg-surface3)', border: '0.5px solid var(--border)', color: 'var(--text-primary)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit', resize: 'none', lineHeight: 1.5 }}
          />
          <button onClick={handleGenerate} disabled={!instruction.trim() || loading}
            style={{ width: 34, height: 34, borderRadius: 9, border: 'none', flexShrink: 0, background: instruction.trim() && !loading ? 'linear-gradient(135deg,var(--accent),#9a7040)' : 'var(--bg-surface3)', color: instruction.trim() && !loading ? '#fff' : 'var(--text-tertiary)', cursor: instruction.trim() && !loading ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all var(--dur-fast) var(--ease-smooth)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiEditChatPanel;
