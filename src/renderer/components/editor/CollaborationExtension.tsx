/**
 * CollaborationExtension.tsx — Y.js 实时协作扩展
 * src/renderer/components/editor/CollaborationExtension.tsx
 *
 * 功能：
 * - Y.js CRDT 协作文档（冲突自动解决）
 * - Supabase Realtime 作为 Y.js 传输层
 * - 多光标显示（头像 + 颜色）
 * - 在线成员列表
 *
 * 使用方式：在 MarkdownEditor.tsx 里替换普通 content 为协作模式
 */
import * as Y from 'yjs';
import { supabase } from '../../lib/supabase';

// ── 颜色池（给每个协作者分配唯一颜色）──────────────────────────

const CURSOR_COLORS = [
  '#c8a96e', '#52c97a', '#5b9cf6', '#e87a7a', '#b87aed',
  '#f0a050', '#50c8c8', '#e0c050', '#c850a0', '#50e0a0',
];

let colorIndex = 0;
const userColorMap = new Map<string, string>();

function getUserColor(userId: string): string {
  if (!userColorMap.has(userId)) {
    userColorMap.set(userId, CURSOR_COLORS[colorIndex % CURSOR_COLORS.length]);
    colorIndex++;
  }
  return userColorMap.get(userId)!;
}

// ── SupabaseProvider — 替代 WebSocket 的 Realtime 传输 ───────────

export class SupabaseProvider {
  private ydoc: Y.Doc;
  private documentId: string;
  private channel: any;
  private awareness: Map<number, any> = new Map();
  private onUpdate?: (update: Uint8Array) => void;
  private onAwarenessChange?: (states: Map<number, any>) => void;
  private userId: string = '';
  private userName: string = '';
  private userColor: string = '#c8a96e';
  private connected = false;

  constructor(documentId: string, ydoc: Y.Doc, options?: {
    onUpdate?: (update: Uint8Array) => void;
    onAwarenessChange?: (states: Map<number, any>) => void;
  }) {
    this.documentId = documentId;
    this.ydoc = ydoc;
    this.onUpdate = options?.onUpdate;
    this.onAwarenessChange = options?.onAwarenessChange;
    this.init();
  }

  private async init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      this.userId = user.id;
      this.userName = user.user_metadata?.display_name || user.email?.split('@')[0] || '协作者';
      this.userColor = getUserColor(user.id);
    }

    // 从 Supabase 加载最新的 ydoc 状态
    await this.loadInitialState();

    // 监听本地 Y.js 更新 → 广播给其他人
    this.ydoc.on('update', (update: Uint8Array, origin: any) => {
      if (origin === this) return; // 避免循环
      this.broadcastUpdate(update);
    });

    // 订阅 Supabase Realtime
    this.channel = supabase
      .channel(`ydoc:${this.documentId}`)
      .on('broadcast', { event: 'ydoc_update' }, ({ payload }) => {
        if (payload.userId === this.userId) return;
        try {
          const update = new Uint8Array(payload.update);
          Y.applyUpdate(this.ydoc, update, this);
          this.onUpdate?.(update);
        } catch {}
      })
      .on('broadcast', { event: 'awareness' }, ({ payload }) => {
        if (payload.userId === this.userId) return;
        this.awareness.set(payload.clientId, {
          user: { id: payload.userId, name: payload.userName, color: payload.userColor },
          cursor: payload.cursor,
          lastSeen: Date.now(),
        });
        this.onAwarenessChange?.(this.awareness);
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        for (const p of leftPresences as any[]) {
          this.awareness.delete(p.clientId);
        }
        this.onAwarenessChange?.(this.awareness);
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          this.connected = true;
          // 广播自己的在线状态
          await this.channel.track({ userId: this.userId, userName: this.userName, userColor: this.userColor });
        }
      });
  }

  private async loadInitialState() {
    try {
      const { data } = await supabase
        .from('documents')
        .select('ydoc_state')
        .eq('id', this.documentId)
        .single();
      if (data?.ydoc_state) {
        const state = new Uint8Array(data.ydoc_state);
        Y.applyUpdate(this.ydoc, state, this);
      }
    } catch {}
  }

  private async broadcastUpdate(update: Uint8Array) {
    if (!this.connected) return;
    // 广播给其他客户端
    await this.channel.send({
      type: 'broadcast',
      event: 'ydoc_update',
      payload: { update: Array.from(update), userId: this.userId },
    });
    // 异步保存到 Supabase（防抖 2s）
    this.scheduleSave();
  }

  private saveTimer: any = null;
  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      try {
        const state = Y.encodeStateAsUpdate(this.ydoc);
        await supabase.from('documents').update({
          ydoc_state: Array.from(state),
          updated_at: new Date().toISOString(),
        }).eq('id', this.documentId);
      } catch {}
    }, 2000);
  }

  /** 广播光标位置 */
  async updateCursor(cursor: { anchor: any; head: any } | null) {
    if (!this.connected) return;
    await this.channel.send({
      type: 'broadcast',
      event: 'awareness',
      payload: {
        userId: this.userId, userName: this.userName,
        userColor: this.userColor, cursor,
        clientId: this.ydoc.clientID,
      },
    });
  }

  /** 获取当前所有在线用户 */
  getOnlineUsers(): { id: string; name: string; color: string }[] {
    return Array.from(this.awareness.values())
      .filter(a => Date.now() - a.lastSeen < 30_000)
      .map(a => a.user);
  }

  destroy() {
    clearTimeout(this.saveTimer);
    this.ydoc.off('update', () => {});
    supabase.removeChannel(this.channel);
  }
}

// ── React Hook — 在编辑器里使用协作 ────────────────────────────

import { useEffect, useRef, useState } from 'react';

export interface CollabUser {
  id: string;
  name: string;
  color: string;
}

export function useCollaboration(documentId: string | null, enabled: boolean) {
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<SupabaseProvider | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<CollabUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!documentId || !enabled) return;

    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    const provider = new SupabaseProvider(documentId, ydoc, {
      onAwarenessChange: (states) => {
        const users = Array.from(states.values())
          .filter(s => Date.now() - (s.lastSeen || 0) < 30_000)
          .map(s => s.user)
          .filter(Boolean);
        setOnlineUsers(users);
        setIsConnected(true);
      },
    });
    providerRef.current = provider;

    return () => {
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      setOnlineUsers([]);
      setIsConnected(false);
    };
  }, [documentId, enabled]);

  return { ydoc: ydocRef.current, provider: providerRef.current, onlineUsers, isConnected };
}

// ── OnlineAvatars — 顶部在线用户头像组件 ────────────────────────

import React from 'react';

export const OnlineAvatars: React.FC<{ users: CollabUser[]; maxShow?: number }> = ({ users, maxShow = 5 }) => {
  if (users.length === 0) return null;
  const shown = users.slice(0, maxShow);
  const extra = users.length - maxShow;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {shown.map((u, i) => (
        <div key={u.id} title={u.name} style={{
          width: 28, height: 28, borderRadius: '50%', background: u.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, color: '#fff', fontWeight: 700,
          border: '2px solid var(--bg-base)',
          marginLeft: i > 0 ? -8 : 0, zIndex: maxShow - i,
          position: 'relative', cursor: 'default',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.2)',
        }}>
          {u.name.slice(0, 1).toUpperCase()}
          {/* 在线指示点 */}
          <div style={{ position: 'absolute', bottom: 0, right: 0, width: 8, height: 8, borderRadius: '50%', background: '#52c97a', border: '1.5px solid var(--bg-base)' }} />
        </div>
      ))}
      {extra > 0 && (
        <div style={{
          width: 28, height: 28, borderRadius: '50%', background: '#2a2a2a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, color: '#888', border: '2px solid var(--bg-base)',
          marginLeft: -8, zIndex: 0,
        }}>
          +{extra}
        </div>
      )}
    </div>
  );
};
