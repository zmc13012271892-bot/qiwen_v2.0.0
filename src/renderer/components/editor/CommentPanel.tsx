/**
 * CommentPanel.tsx — 文档评论面板
 * src/renderer/components/editor/CommentPanel.tsx
 *
 * 功能：
 * - 显示当前文档所有评论（实时订阅）
 * - 添加新评论、回复评论
 * - 解决/重新打开评论
 * - 评论定位（点击跳转到文档对应位置）
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { cloudSync } from '../../services/cloudSync';
import { supabase } from '../../lib/supabase';

interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  content: string;
  anchorData: any;
  isResolved: boolean;
  createdAt: string;
  replies: Reply[];
}

interface Reply {
  id: string;
  authorName: string;
  authorColor: string;
  content: string;
  createdAt: string;
}

interface Props {
  documentId: string;
  onHighlightAnchor?: (anchorData: any) => void;
}

export const CommentPanel: React.FC<Props> = ({ documentId, onHighlightAnchor }) => {
  const user = useSelector((s: RootState) => s.auth.user);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('open');
  const newCommentRef = useRef<HTMLTextAreaElement>(null);

  const loadComments = useCallback(async () => {
    try {
      const data = await cloudSync.getComments(documentId);
      setComments(data.map(normalizeComment));
    } catch (e) {
      console.error('[CommentPanel] load failed:', e);
    } finally { setLoading(false); }
  }, [documentId]);

  useEffect(() => { loadComments(); }, [loadComments]);

  // 实时订阅新评论
  useEffect(() => {
    const channel = supabase
      .channel(`comments:${documentId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'comments',
        filter: `document_id=eq.${documentId}`,
      }, () => { loadComments(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [documentId, loadComments]);

  const handleAddComment = async () => {
    if (!newText.trim() || !user) return;
    setSubmitting(true);
    try {
      await cloudSync.addComment(documentId, newText.trim());
      setNewText('');
      await loadComments();
    } catch (e: any) { alert('评论发送失败: ' + e.message); }
    finally { setSubmitting(false); }
  };

  const handleReply = async (commentId: string) => {
    if (!replyText.trim() || !user) return;
    try {
      await cloudSync.addComment(documentId, replyText.trim(), {}, commentId);
      setReplyText('');
      setReplyTo(null);
      await loadComments();
    } catch (e: any) { alert('回复失败: ' + e.message); }
  };

  const handleResolve = async (commentId: string, currentlyResolved: boolean) => {
    try {
      if (!currentlyResolved) {
        await cloudSync.resolveComment(commentId);
      } else {
        await supabase.from('comments').update({ is_resolved: false, resolved_by: null, resolved_at: null }).eq('id', commentId);
      }
      await loadComments();
    } catch (e: any) { alert('操作失败: ' + e.message); }
  };

  const filtered = comments.filter(c => {
    if (filter === 'open') return !c.isResolved;
    if (filter === 'resolved') return c.isResolved;
    return true;
  });

  const openCount = comments.filter(c => !c.isResolved).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', borderLeft: '1px solid var(--border)' }}>
      {/* 头部 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 }}>
          评论 {openCount > 0 && <span style={{ fontSize: 11, background: 'var(--accent)', color: '#fff', borderRadius: 10, padding: '1px 7px', marginLeft: 6 }}>{openCount}</span>}
        </div>
        <div style={{ display: 'flex', gap: 0, background: 'var(--bg-surface2)', borderRadius: 7, padding: 2 }}>
          {(['open', 'all', 'resolved'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              flex: 1, padding: '4px 0', borderRadius: 5, border: 'none',
              background: filter === f ? 'var(--bg-surface3)' : 'transparent',
              color: filter === f ? 'var(--text-primary)' : 'var(--text-tertiary)',
              cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit', transition: 'all 0.15s',
            }}>
              {f === 'open' ? '未解决' : f === 'all' ? '全部' : '已解决'}
            </button>
          ))}
        </div>
      </div>

      {/* 评论列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {loading && <div style={{ padding: 20, color: 'var(--text-tertiary)', fontSize: 12, textAlign: 'center' }}>加载中…</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
            {filter === 'open' ? '暂无未解决的评论' : '暂无评论'}
          </div>
        )}
        {filtered.map(comment => (
          <div key={comment.id} style={{
            margin: '4px 10px', padding: '12px 14px',
            background: 'var(--bg-surface2)', borderRadius: 10,
            border: `1px solid ${comment.isResolved ? 'var(--border)' : 'var(--border-md)'}`,
            opacity: comment.isResolved ? 0.6 : 1,
          }}>
            {/* 作者行 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: comment.authorColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
                {comment.authorName.slice(0, 1).toUpperCase()}
              </div>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{comment.authorName}</span>
              <span style={{ fontSize: 10.5, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{formatTime(comment.createdAt)}</span>
              {comment.isResolved && <span style={{ fontSize: 10, color: '#52c97a', background: '#52c97a18', padding: '1px 6px', borderRadius: 4 }}>已解决</span>}
            </div>

            {/* 内容 */}
            <div
              style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, marginBottom: 8, cursor: comment.anchorData ? 'pointer' : 'default' }}
              onClick={() => comment.anchorData && onHighlightAnchor?.(comment.anchorData)}
            >
              {comment.content}
            </div>

            {/* 回复列表 */}
            {comment.replies.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {comment.replies.map(r => (
                  <div key={r.id} style={{ display: 'flex', gap: 8 }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: r.authorColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#fff', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                      {r.authorName.slice(0, 1).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text-secondary)' }}>{r.authorName} </span>
                      <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{formatTime(r.createdAt)}</span>
                      <div style={{ fontSize: 12.5, color: 'var(--text-primary)', marginTop: 2 }}>{r.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 操作按钮 */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {user && (
                <button onClick={() => { setReplyTo(replyTo === comment.id ? null : comment.id); setReplyText(''); }}
                  style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit' }}>
                  💬 回复
                </button>
              )}
              {user && (
                <button onClick={() => handleResolve(comment.id, comment.isResolved)}
                  style={{ fontSize: 11, color: comment.isResolved ? '#5b9cf6' : '#52c97a', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit', marginLeft: 'auto' }}>
                  {comment.isResolved ? '↩ 重新打开' : '✓ 标记解决'}
                </button>
              )}
            </div>

            {/* 回复输入框 */}
            {replyTo === comment.id && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)} autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply(comment.id); }}
                  placeholder="回复… (Ctrl+Enter 发送)"
                  style={{ width: '100%', height: 60, padding: '7px 10px', background: 'var(--bg-surface3)', border: '1px solid var(--border-md)', borderRadius: 7, color: 'var(--text-primary)', fontSize: 12.5, resize: 'none', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button onClick={() => setReplyTo(null)} style={{ fontSize: 12, padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-tertiary)', fontFamily: 'inherit' }}>取消</button>
                  <button onClick={() => handleReply(comment.id)} disabled={!replyText.trim()}
                    style={{ fontSize: 12, padding: '4px 10px', background: 'var(--accent)', border: 'none', borderRadius: 6, cursor: 'pointer', color: '#fff', fontFamily: 'inherit', opacity: replyText.trim() ? 1 : 0.5 }}>发送</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 新评论输入区 */}
      {user ? (
        <div style={{ padding: '12px 10px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <textarea
            ref={newCommentRef}
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddComment(); }}
            placeholder="添加评论… (Ctrl+Enter 发送)"
            style={{ width: '100%', height: 72, padding: '8px 10px', background: 'var(--bg-surface2)', border: '1px solid var(--border-md)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, resize: 'none', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button onClick={handleAddComment} disabled={submitting || !newText.trim()}
              style={{ padding: '6px 16px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', cursor: submitting || !newText.trim() ? 'not-allowed' : 'pointer', fontSize: 13, fontFamily: 'inherit', opacity: !newText.trim() ? 0.5 : 1 }}>
              {submitting ? '发送中…' : '发送'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: 16, borderTop: '1px solid var(--border)', textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>
          登录后可添加评论
        </div>
      )}
    </div>
  );
};

function normalizeComment(row: any): Comment {
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: row.user_profiles?.display_name || '未知用户',
    authorColor: row.user_profiles?.avatar_color || '#c8a96e',
    content: row.content,
    anchorData: row.anchor_data || {},
    isResolved: row.is_resolved,
    createdAt: row.created_at,
    replies: (row.replies || []).map((r: any) => ({
      id: r.id,
      authorName: r.user_profiles?.display_name || '未知用户',
      authorColor: r.user_profiles?.avatar_color || '#c8a96e',
      content: r.content,
      createdAt: r.created_at,
    })),
  };
}

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}
