/**
 * LicenseView.tsx — 授权管理（企业级重设计）
 */
import React, { useState, useEffect } from 'react';
import { ipc } from '../../utils/ipc';

interface LicenseStatus {
  plan: 'free' | 'pro' | 'enterprise';
  planName: string;
  status: 'active' | 'inactive' | 'expired';
  licenseKey?: string;
  expiresAt?: number;
  features: string[];
  limits: { maxWorkspaces: number; maxDocuments: number; aiTokens: number };
}

const fmt = (n: number) => n === -1 ? '无限制' : n.toLocaleString();
const fmtDate = (ts?: number) => ts ? new Date(ts).toLocaleDateString('zh-CN') : '永久有效';

const PLANS = [
  {
    id: 'free', name: '免费版', priceLabel: '¥0', period: '永久免费', color: '#8a8a84',
    monthlyNote: '',
    features: [
      { label: '3 个工作区', ok: true }, { label: '100 篇文档', ok: true },
      { label: '50K AI Token/月', ok: true }, { label: '基础编辑功能', ok: true },
      { label: '版本历史', ok: false }, { label: '高级导出', ok: false },
      { label: '实时协作', ok: false }, { label: '优先支持', ok: false },
    ],
    cta: null,
  },
  {
    id: 'pro', name: '专业版', priceLabel: '¥198', period: '/年', color: '#c8a96e', highlight: true,
    monthlyNote: '折合 ¥16.5/月',
    features: [
      { label: '20 个工作区', ok: true }, { label: '10,000 篇文档', ok: true },
      { label: '500K AI Token/月', ok: true }, { label: '全部编辑功能', ok: true },
      { label: '版本历史（无限制）', ok: true }, { label: 'PDF / Word 导出', ok: true },
      { label: '实时协作（5人）', ok: true }, { label: '优先邮件支持', ok: true },
    ],
    cta: 'https://bitwool.cn/pricing',
  },
  {
    id: 'enterprise', name: '企业版', priceLabel: '联系销售', period: '', color: '#52c97a',
    monthlyNote: '支持发票 / 批量授权',
    features: [
      { label: '无限工作区', ok: true }, { label: '无限文档', ok: true },
      { label: '无限 AI Token', ok: true }, { label: '全部专业版功能', ok: true },
      { label: '版本历史（无限制）', ok: true }, { label: '全格式导出+自定义模板', ok: true },
      { label: '实时协作（无限人数）', ok: true }, { label: '专属客服 + SLA 保障', ok: true },
    ],
    cta: 'mailto:bitwool@163.com?subject=启文企业版咨询',
  },
] as const;

export const LicenseView: React.FC = () => {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [inputKey, setInputKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);

  const load = async () => { try { setStatus(await ipc.invoke<LicenseStatus>('license:status')); } catch {} };
  useEffect(() => { load(); }, []);

  const activate = async () => {
    if (!inputKey.trim()) return;
    setActivating(true); setMsg(null);
    try {
      const r = await ipc.invoke<any>('license:activate', { key: inputKey.trim() });
      if (r.success) {
        setMsg({ t: 'ok', s: `🎉 激活成功！欢迎使用 ${r.planName}` });
        setInputKey(''); setShowKey(false); await load();
      } else {
        const m: Record<string, string> = {
          license_format_invalid: 'Key 格式不正确，请确认完整复制',
          license_expired: 'Key 已过期，请联系客服续期',
          license_checksum_invalid: 'Key 无效或已被使用',
          internal_error: '内部错误，请重试',
        };
        setMsg({ t: 'err', s: m[r.error] || `激活失败：${r.error}` });
      }
    } catch { setMsg({ t: 'err', s: '网络错误，请检查连接后重试' }); }
    finally { setActivating(false); }
  };

  const deactivate = async () => {
    if (!window.confirm('确认停用？将回退到免费版，数据不丢失。')) return;
    await ipc.invoke('license:deactivate');
    setMsg({ t: 'ok', s: '已停用，已回退到免费版' });
    await load();
  };

  if (!status) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-tertiary)', padding: '40px 0' }}>
      <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin .7s linear infinite' }} />
      <span style={{ fontSize: 13 }}>加载授权信息…</span>
    </div>
  );

  const pColor = { free: '#8a8a84', pro: '#c8a96e', enterprise: '#52c97a' }[status.plan];
  const pEmoji = { free: '🆓', pro: '⭐', enterprise: '🏢' }[status.plan];
  const isActive = status.status === 'active';

  return (
    <div style={{ maxWidth: 780, width: '100%' }}>

      {/* 当前计划卡片 */}
      <div style={{ borderRadius: 14, overflow: 'hidden', border: `1px solid ${pColor}30`, background: `${pColor}06`, marginBottom: 24 }}>
        <div style={{ height: 3, background: pColor }} />
        <div style={{ padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: `${pColor}18`, border: `1px solid ${pColor}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{pEmoji}</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }}>{status.planName}</div>
                <div style={{ fontSize: 12, marginTop: 3 }}>
                  {isActive ? <span style={{ color: '#52c97a' }}>● 有效期至 {fmtDate(status.expiresAt)}</span>
                    : status.status === 'expired' ? <span style={{ color: '#e87a7a' }}>⚠ 已过期</span>
                      : <span style={{ color: 'var(--text-tertiary)' }}>免费版 · 可升级</span>}
                </div>
              </div>
            </div>
            {status.plan !== 'free' && isActive && (
              <button onClick={deactivate} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>停用授权</button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 18 }}>
            {[{ l: '工作区', v: fmt(status.limits.maxWorkspaces) }, { l: '文档数', v: fmt(status.limits.maxDocuments) }, { l: 'AI Token', v: fmt(status.limits.aiTokens) }].map(i => (
              <div key={i.l} style={{ background: 'var(--bg-surface3)', borderRadius: 9, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: pColor, marginBottom: 3 }}>{i.v}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{i.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 消息条 */}
      {msg && (
        <div style={{ padding: '10px 16px', borderRadius: 10, fontSize: 13, marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: msg.t === 'ok' ? 'rgba(82,201,122,.08)' : 'rgba(232,122,122,.08)', color: msg.t === 'ok' ? '#52c97a' : '#e87a7a', border: `1px solid ${msg.t === 'ok' ? 'rgba(82,201,122,.25)' : 'rgba(232,122,122,.25)'}` }}>
          <span>{msg.s}</span>
          <button onClick={() => setMsg(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, opacity: .6, padding: 0 }}>×</button>
        </div>
      )}

      {/* Key 激活入口（折叠式，不突兀） */}
      {status.plan === 'free' && (
        <div style={{ marginBottom: 24 }}>
          {!showKey ? (
            <button onClick={() => setShowKey(true)} style={{ width: '100%', padding: '11px', borderRadius: 10, border: '1px dashed rgba(200,169,110,.3)', background: 'rgba(200,169,110,.03)', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', transition: 'background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,169,110,.55)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
              onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,169,110,.3)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-tertiary)'; }}>
              🔑 已有 License Key？点击激活
            </button>
          ) : (
            <div style={{ padding: '18px 20px', borderRadius: 12, border: '1px solid rgba(200,169,110,.25)', background: 'rgba(200,169,110,.04)' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 12 }}>输入 License Key</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={inputKey} onChange={e => setInputKey(e.target.value)} onKeyDown={e => e.key === 'Enter' && activate()}
                  placeholder="QIWEN-XXXX-XXXX-XXXX-XXXX" autoFocus
                  style={{ flex: 1, padding: '9px 13px', borderRadius: 9, border: '1px solid var(--border-md)', background: 'var(--bg-surface3)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'monospace', outline: 'none' }} />
                <button onClick={activate} disabled={activating || !inputKey.trim()} style={{ padding: '9px 20px', borderRadius: 9, border: 'none', background: activating || !inputKey.trim() ? 'var(--bg-surface3)' : 'var(--accent)', color: activating || !inputKey.trim() ? 'var(--text-tertiary)' : '#fff', cursor: activating || !inputKey.trim() ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
                  {activating ? '验证中…' : '激活'}
                </button>
                <button onClick={() => { setShowKey(false); setInputKey(''); setMsg(null); }} style={{ padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>取消</button>
              </div>
              <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                在 <a href="https://bitwool.cn/pricing" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>bitwool.cn/pricing</a> 购买后，Key 将发送至注册邮箱
              </div>
            </div>
          )}
        </div>
      )}

      {/* 计划对比 */}
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 14 }}>
        {status.plan === 'free' ? '升级解锁更多功能' : '计划详情'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
        {PLANS.map(p => {
          const isCur = p.id === status.plan;
          const isHL = (p as any).highlight && status.plan === 'free';
          return (
            <div key={p.id} style={{ borderRadius: 14, padding: '20px 18px', border: isCur ? `2px solid ${p.color}` : isHL ? `1.5px solid ${p.color}50` : '1px solid var(--border)', background: isCur ? `${p.color}08` : isHL ? `${p.color}04` : 'var(--bg-surface2)', position: 'relative', overflow: 'hidden' }}>
              {isHL && !isCur && <div style={{ position: 'absolute', top: 12, right: 12, fontSize: 10, fontWeight: 700, color: p.color, background: `${p.color}18`, border: `1px solid ${p.color}35`, borderRadius: 4, padding: '2px 7px' }}>推荐</div>}
              {isCur && <div style={{ position: 'absolute', top: 12, right: 12, fontSize: 10, fontWeight: 700, color: p.color, background: `${p.color}18`, border: `1px solid ${p.color}35`, borderRadius: 4, padding: '2px 7px' }}>当前</div>}
              <div style={{ fontSize: 11, fontWeight: 700, color: p.color, letterSpacing: .5, textTransform: 'uppercase', marginBottom: 8 }}>{p.name}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 2 }}>
                <span style={{ fontSize: p.priceLabel.length < 6 ? 24 : 17, fontWeight: p.priceLabel.length < 6 ? 500 : 400, color: 'var(--text-primary)', letterSpacing: -.5 }}>{p.priceLabel}</span>
                {p.period && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{p.period}</span>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 16, minHeight: 16 }}>{(p as any).monthlyNote || ''}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 18 }}>
                {p.features.map(f => (
                  <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                    <span style={{ color: f.ok ? '#52c97a' : 'var(--text-tertiary)', flexShrink: 0, fontSize: 11 }}>{f.ok ? '✓' : '–'}</span>
                    <span style={{ color: f.ok ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>{f.label}</span>
                  </div>
                ))}
              </div>
              {p.cta && !isCur ? (
                <button onClick={() => {
                  const url = p.cta!;
                  const api = (window as any).electronAPI;
                  if (api?.invoke) { api.invoke('shell:open-external', { url }).catch(() => window.open(url,'_blank')); }
                  else { window.open(url, '_blank'); }
                }} style={{ width:'100%', textAlign:'center', padding:'9px', borderRadius:9, border: p.id==='pro' ? 'none' : `1px solid ${p.color}50`, fontSize:13, fontWeight:600, background: p.id==='pro' ? 'linear-gradient(135deg,#c8a96e,#9a7040)' : 'transparent', color: p.id==='pro' ? '#fff' : p.color, cursor:'pointer', fontFamily:'inherit' }}>
                  {p.id === 'pro' ? '立即升级' : '联系销售'}
                </button>
              ) : isCur ? (
                <div style={{ textAlign: 'center', padding: '9px', borderRadius: 9, fontSize: 13, color: 'var(--text-tertiary)', background: 'var(--bg-surface3)', border: '1px solid var(--border)' }}>当前计划</div>
              ) : (
                <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)', padding: '9px 0' }}>使用 Key 激活 ↑</div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部说明 */}
      <div style={{ padding: '14px 18px', borderRadius: 10, background: 'var(--bg-surface2)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.9 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>授权说明</strong><br />
        • License Key 购买后发送至注册邮箱，有效期 1 年，到期可续费<br />
        • 同一 Key 支持 3 台设备同时使用<br />
        • 所有数据本地优先存储，停止订阅后数据不丢失<br />
        • 企业批量授权 / 发票请联系 <a href="mailto:bitwool@163.com" style={{ color: 'var(--accent)', textDecoration: 'none' }}>bitwool@163.com</a>
      </div>
    </div>
  );
};
