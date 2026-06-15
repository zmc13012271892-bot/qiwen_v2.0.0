/**
 * LicenseView.tsx — License 激活界面
 * v1.2.0: 集成到 SettingsView 的授权管理页
 */
import React, { useState, useEffect } from 'react';
import { ipc } from '../../utils/ipc';

interface LicenseStatus {
  plan: string;
  planName: string;
  status: 'active' | 'inactive' | 'expired';
  licenseKey?: string;
  expiresAt?: number;
  features: string[];
  limits: { maxWorkspaces: number; maxDocuments: number; aiTokens: number };
}

const PLAN_COLORS: Record<string, string> = {
  free: '#8a8a84', pro: '#c8a96e', enterprise: '#52c97a',
};

const FEATURE_LABELS: Record<string, string> = {
  version_history: '版本历史（无限制）',
  advanced_export: '高级导出（PDF / Word 模板）',
  command_palette: '全局命令面板',
  priority_support: '优先技术支持',
  custom_branding: '自定义品牌',
  audit_log: '操作审计日志',
  sso: '单点登录（SSO）',
};

export const LicenseView: React.FC = () => {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [inputKey, setInputKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadStatus = async () => {
    try {
      const s = await ipc.invoke<LicenseStatus>('license:status');
      setStatus(s);
    } catch {}
  };

  useEffect(() => { loadStatus(); }, []);

  const handleActivate = async () => {
    if (!inputKey.trim()) return;
    setActivating(true);
    setMessage(null);
    try {
      const result = await ipc.invoke<any>('license:activate', { key: inputKey.trim() });
      if (result.success) {
        setMessage({ type: 'success', text: `🎉 激活成功！当前计划：${result.planName}` });
        setInputKey('');
        await loadStatus();
      } else {
        const errMap: Record<string, string> = {
          license_format_invalid: 'License Key 格式不正确',
          license_plan_unknown: '未知的计划类型',
          license_expired: 'License Key 已过期',
          license_checksum_invalid: 'License Key 无效或已被篡改',
          internal_error: '内部错误，请重试',
        };
        setMessage({ type: 'error', text: errMap[result.error] || `激活失败：${result.error}` });
      }
    } catch (e) {
      setMessage({ type: 'error', text: '激活失败，请检查网络或重试' });
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivate = async () => {
    if (!window.confirm('确认停用 License？将回退到免费版。')) return;
    await ipc.invoke('license:deactivate');
    setMessage({ type: 'success', text: '已停用 License，已回退到免费版' });
    await loadStatus();
  };

  const formatDate = (ts?: number) => ts ? new Date(ts).toLocaleDateString('zh-CN') : '永久有效';
  const formatLimit = (n: number) => n === -1 ? '无限制' : n.toLocaleString();

  if (!status) return <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>加载中…</div>;

  const isActive = status.status === 'active';
  const planColor = PLAN_COLORS[status.plan] || '#8a8a84';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720, width: '100%' }}>
      {/* 当前状态卡片 */}
      <div style={{ background: 'var(--bg-surface2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: planColor }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: `${planColor}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
            {status.plan === 'enterprise' ? '🏢' : status.plan === 'pro' ? '⭐' : '🆓'}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{status.planName}</div>
            <div style={{ fontSize: 12, color: planColor, marginTop: 2 }}>
              {isActive ? `有效期至：${formatDate(status.expiresAt)}` : status.status === 'expired' ? '⚠️ 已过期' : '未激活'}
            </div>
          </div>
          {status.licenseKey && (
            <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
              {status.licenseKey}
            </div>
          )}
        </div>

        {/* 功能限制 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[
            { label: '工作区', value: formatLimit(status.limits.maxWorkspaces) },
            { label: '文档数', value: formatLimit(status.limits.maxDocuments) },
            { label: 'AI Token', value: formatLimit(status.limits.aiTokens) },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--bg-surface3)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: planColor }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{item.label}</div>
            </div>
          ))}
        </div>

        {/* 功能列表 */}
        {status.features.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {status.features.map(f => (
              <span key={f} style={{ fontSize: 11.5, color: '#52c97a', background: '#52c97a18', borderRadius: 4, padding: '2px 8px', border: '1px solid #52c97a30' }}>
                ✓ {FEATURE_LABELS[f] || f}
              </span>
            ))}
          </div>
        )}

        {isActive && (
          <button onClick={handleDeactivate} style={{ marginTop: 14, fontSize: 12, color: 'var(--text-tertiary)', background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
            停用 License
          </button>
        )}
      </div>

      {/* 激活框 */}
      {!isActive && (
        <div style={{ background: 'var(--bg-surface2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: 'var(--text-primary)' }}>激活 License Key</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={inputKey}
              onChange={e => setInputKey(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleActivate()}
              placeholder="QIWEN-XXXX-XXXX-XXXX-XXXX"
              style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border-md)', background: 'var(--bg-surface3)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'monospace', outline: 'none' }}
            />
            <button
              onClick={handleActivate}
              disabled={activating || !inputKey.trim()}
              style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: activating ? 'wait' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: activating || !inputKey.trim() ? 0.6 : 1 }}
            >
              {activating ? '验证中…' : '激活'}
            </button>
          </div>
          {message && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: message.type === 'success' ? '#52c97a' : '#e87a7a', padding: '8px 12px', background: message.type === 'success' ? '#52c97a18' : '#e87a7a18', borderRadius: 6 }}>
              {message.text}
            </div>
          )}
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            购买 License Key 请访问 <a href="https://bitwool.cn" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>bitwool.cn</a>
          </div>
        </div>
      )}

      {/* 计划对比 */}
      <div style={{ background: 'var(--bg-surface2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text-primary)' }}>计划对比</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {[
            { plan: 'free', name: '免费版', price: '¥0', features: ['3个工作区', '100篇文档', '50K AI Token', '基础功能'] },
            { plan: 'pro', name: '专业版', price: '¥198/年', features: ['20个工作区', '10,000篇文档', '500K AI Token', '版本历史', '高级导出', '命令面板', '优先支持'] },
            { plan: 'enterprise', name: '企业版', price: '联系销售', features: ['无限工作区', '无限文档', '无限AI Token', '全部专业版功能', '自定义品牌', '审计日志', 'SSO'] },
          ].map(p => (
            <div key={p.plan} style={{ background: 'var(--bg-surface3)', borderRadius: 10, padding: 16, border: p.plan === status.plan ? `2px solid ${PLAN_COLORS[p.plan]}` : '2px solid transparent' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: PLAN_COLORS[p.plan], marginBottom: 4 }}>{p.name}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>{p.price}</div>
              {p.features.map(f => (
                <div key={f} style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 4 }}>✓ {f}</div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
