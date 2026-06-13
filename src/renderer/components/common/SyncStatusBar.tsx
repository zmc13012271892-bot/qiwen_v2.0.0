/**
 * SyncStatusBar.tsx — 同步状态指示器
 * src/renderer/components/common/SyncStatusBar.tsx
 *
 * 显示在 TitleBar 或 StatusBar 里，实时反映同步状态
 */
import React, { useState, useEffect } from 'react';
import { onSyncStatus, SyncStatus } from '../../services/syncEngine';

export const SyncStatusBar: React.FC = () => {
  const [status, setStatus] = useState<SyncStatus>({ isOnline: navigator.onLine, pendingCount: 0, lastSyncAt: null, syncing: false });

  useEffect(() => {
    const unsub = onSyncStatus(setStatus);
    return unsub;
  }, []);

  const formatTime = (ts: number | null) => {
    if (!ts) return '';
    const diff = Date.now() - ts;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  if (!status.isOnline) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#e87a7a' }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#e87a7a' }} />
      离线
      {status.pendingCount > 0 && <span style={{ color: '#888' }}>({status.pendingCount} 待同步)</span>}
    </div>
  );

  if (status.syncing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#c8a96e' }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#c8a96e', animation: 'pulse 1s infinite' }} />
      同步中…
    </div>
  );

  if (status.pendingCount > 0) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#5b9cf6' }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#5b9cf6' }} />
      待同步 {status.pendingCount} 项
    </div>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#52c97a' }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#52c97a' }} />
      已同步 {formatTime(status.lastSyncAt)}
    </div>
  );
};
