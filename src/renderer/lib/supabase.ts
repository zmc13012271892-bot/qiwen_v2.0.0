/**
 * supabase.ts — Supabase 客户端单例
 * src/renderer/lib/supabase.ts
 *
 * 使用前在 .env 里设置：
 * REACT_APP_SUPABASE_URL=https://xxxx.supabase.co
 * REACT_APP_SUPABASE_ANON_KEY=eyJxxx...
 */
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.REACT_APP_SUPABASE_URL  || '';
const SUPABASE_KEY  = process.env.REACT_APP_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('[Supabase] 环境变量未配置，云端功能不可用');
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // Electron 里关闭，避免 URL scheme 问题
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});

// 活跃的 Realtime channel 集合（便于清理）
const activeChannels = new Map<string, RealtimeChannel>();

export function getOrCreateChannel(name: string): RealtimeChannel {
  if (!activeChannels.has(name)) {
    activeChannels.set(name, supabase.channel(name));
  }
  return activeChannels.get(name)!;
}

export function removeChannel(name: string) {
  const ch = activeChannels.get(name);
  if (ch) { supabase.removeChannel(ch); activeChannels.delete(name); }
}

export function removeAllChannels() {
  activeChannels.forEach((_, name) => removeChannel(name));
}
