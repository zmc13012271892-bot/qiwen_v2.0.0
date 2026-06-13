/**
 * OrgManageView.tsx — 组织管理后台
 * src/renderer/components/org/OrgManageView.tsx
 *
 * 功能：
 * - 组织信息/成员列表
 * - 邀请成员（邮件 or 链接）
 * - 角色管理（owner/admin/member/guest）
 * - 移除成员
 * - 审计日志
 */
import React, { useState, useEffect, useCallback } from 'react';
import { cloudSync, OrgMember, Organization } from '../../services/cloudSync';

type Tab = 'members' | 'invitations' | 'audit' | 'settings';

const ROLE_LABELS: Record<string, string> = {
  owner: '所有者', admin: '管理员', member: '成员', guest: '访客',
};
const ROLE_COLORS: Record<string, string> = {
  owner: '#c8a96e', admin: '#52c97a', member: '#5b9cf6', guest: '#8a8a84',
};

interface Props { orgId: string; }

export const OrgManageView: React.FC<Props> = ({ orgId }) => {
  const [tab, setTab] = useState<Tab>('members');
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteLink, setInviteLink] = useState('');
  const [inviting, setInviting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [orgs, mems] = await Promise.all([
        cloudSync.getMyOrganizations(),
        cloudSync.getOrgMembers(orgId),
      ]);
      setOrg(orgs.find(o => o.id === orgId) || null);
      setMembers(mems);
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    } finally { setLoading(false); }
  }, [orgId]);

  const loadAudit = useCallback(async () => {
    try {
      const logs = await cloudSync.getAuditLogs(orgId);
      setAuditLogs(logs);
    } catch {}
  }, [orgId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (tab === 'audit') loadAudit(); }, [tab, loadAudit]);

  const handleInvite = async () => {
    if (!inviteEmail.trim() && !inviteRole) return;
    setInviting(true);
    setMessage(null);
    try {
      const token = await cloudSync.inviteMember(orgId, inviteEmail.trim(), inviteRole);
      const link = `https://bitwool.cn/invite/${token}`;
      setInviteLink(link);
      setMessage({ type: 'success', text: '邀请链接已生成' });
      setInviteEmail('');
      await cloudSync.logAuditEvent(orgId, 'member.invite', 'invitation', token, { email: inviteEmail, role: inviteRole });
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    } finally { setInviting(false); }
  };

  const handleRemoveMember = async (userId: string, name: string) => {
    if (!window.confirm(`确认移除成员 ${name}？`)) return;
    try {
      await cloudSync.removeMember(orgId, userId);
      await cloudSync.logAuditEvent(orgId, 'member.remove', 'user', userId as any, { name });
      await load();
      setMessage({ type: 'success', text: `已移除 ${name}` });
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await cloudSync.updateMemberRole(orgId, userId, newRole);
      await cloudSync.logAuditEvent(orgId, 'member.role_change', 'user', userId as any, { newRole });
      await load();
    } catch (e: any) {
      setMessage({ type: 'error', text: e.message });
    }
  };

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'members', label: '成员管理', icon: '👥' },
    { id: 'invitations', label: '邀请成员', icon: '✉️' },
    { id: 'audit', label: '审计日志', icon: '📋' },
    { id: 'settings', label: '组织设置', icon: '⚙️' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* 头部 */}
      <div style={{ padding: '20px 24px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 28 }}>🏢</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{org?.name || '组织管理'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {members.length} 名成员 · {org?.plan === 'enterprise' ? '企业版' : org?.plan === 'pro' ? '专业版' : '免费版'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 0 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 13, color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              fontFamily: 'inherit', transition: 'color 0.15s',
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 消息提示 */}
      {message && (
        <div style={{ margin: '12px 24px 0', padding: '8px 14px', borderRadius: 6, fontSize: 13,
          background: message.type === 'success' ? '#52c97a18' : '#e87a7a18',
          color: message.type === 'success' ? '#52c97a' : '#e87a7a',
          border: `1px solid ${message.type === 'success' ? '#52c97a30' : '#e87a7a30'}` }}>
          {message.text}
          <button onClick={() => setMessage(null)} style={{ float: 'right', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }}>×</button>
        </div>
      )}

      {/* 内容区 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {loading ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>加载中…</div>
        ) : tab === 'members' ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>成员列表 ({members.length}/{org?.maxMembers ?? '∞'})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {members.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--bg-surface2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: m.avatarColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#fff', fontWeight: 600, flexShrink: 0 }}>
                    {m.displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{m.displayName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>
                      加入于 {new Date(m.joinedAt).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                  <select
                    value={m.role}
                    onChange={e => handleRoleChange(m.userId, e.target.value)}
                    disabled={m.role === 'owner'}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface3)', color: ROLE_COLORS[m.role], fontSize: 12, cursor: m.role === 'owner' ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: ROLE_COLORS[m.role], background: `${ROLE_COLORS[m.role]}18`, padding: '2px 8px', borderRadius: 4, border: `1px solid ${ROLE_COLORS[m.role]}30`, width: 52, textAlign: 'center' }}>
                    {ROLE_LABELS[m.role]}
                  </span>
                  {m.role !== 'owner' && (
                    <button onClick={() => handleRemoveMember(m.userId, m.displayName)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e87a7a44', background: 'none', color: '#e87a7a', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                      移除
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : tab === 'invitations' ? (
          <div style={{ maxWidth: 480 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>邀请新成员</div>
            <div style={{ background: 'var(--bg-surface2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 6 }}>邮箱地址（可选，留空生成通用邀请链接）</label>
                <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                  style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border-md)', background: 'var(--bg-surface3)', color: 'var(--text-primary)', fontSize: 13, fontFamily: 'inherit' }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 6 }}>角色</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['member', 'admin', 'guest'].map(role => (
                    <button key={role} onClick={() => setInviteRole(role)}
                      style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: `1px solid ${inviteRole === role ? ROLE_COLORS[role] : 'var(--border)'}`,
                        background: inviteRole === role ? `${ROLE_COLORS[role]}18` : 'var(--bg-surface3)',
                        color: inviteRole === role ? ROLE_COLORS[role] : 'var(--text-secondary)',
                        cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
                      {ROLE_LABELS[role]}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleInvite} disabled={inviting}
                style={{ width: '100%', padding: '9px 0', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: inviting ? 'wait' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: inviting ? 0.7 : 1 }}>
                {inviting ? '生成中…' : '生成邀请链接'}
              </button>
              {inviteLink && (
                <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--bg-surface3)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}>邀请链接（7天有效）</div>
                  <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#52c97a', wordBreak: 'break-all' }}>{inviteLink}</div>
                  <button onClick={() => navigator.clipboard.writeText(inviteLink)}
                    style={{ marginTop: 8, fontSize: 12, padding: '4px 10px', background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}>
                    复制链接
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : tab === 'audit' ? (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>操作审计日志</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {auditLogs.length === 0 && <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>暂无审计记录</div>}
              {auditLogs.map(log => (
                <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: log.user_profiles?.avatar_color || '#555', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 600, flexShrink: 0 }}>
                    {(log.user_profiles?.display_name || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <span style={{ color: 'var(--text-secondary)', minWidth: 100 }}>{log.user_profiles?.display_name || '系统'}</span>
                  <span style={{ color: 'var(--accent)', fontFamily: 'monospace', fontSize: 12 }}>{log.action}</span>
                  {log.resource_type && <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{log.resource_type}</span>}
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 11, marginLeft: 'auto' }}>
                    {new Date(log.created_at).toLocaleString('zh-CN')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 480 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>组织设置</div>
            <div style={{ background: 'var(--bg-surface2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)', color: 'var(--text-tertiary)', fontSize: 13 }}>
              组织名称、Logo、自定义域名等高级设置（企业版功能，开发中）
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
