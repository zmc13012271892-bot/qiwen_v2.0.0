/**
 * CreateOrgModal.tsx — 创建组织引导弹窗
 * src/renderer/components/org/CreateOrgModal.tsx
 *
 * 首次进入 Org 视图时，如果没有组织则弹出此引导
 * 三步：基本信息 → 邀请成员 → 完成
 */
import React, { useState } from 'react';
import { cloudSync } from '../../services/cloudSync';

interface Props {
  onCreated: (orgId: string) => void;
  onCancel: () => void;
}

type Step = 'info' | 'invite' | 'done';

export const CreateOrgModal: React.FC<Props> = ({ onCreated, onCancel }) => {
  const [step, setStep] = useState<Step>('info');
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [slugError, setSlugError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdOrgId, setCreatedOrgId] = useState('');
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [inviteResults, setInviteResults] = useState<{ email: string; link: string }[]>([]);
  const [error, setError] = useState('');

  const handleNameChange = (name: string) => {
    setOrgName(name);
    const slug = name.toLowerCase()
      .replace(/[\u4e00-\u9fa5]/g, s => s)
      .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-')
      .replace(/-+/g, '-').replace(/^-|-$/g, '');
    setOrgSlug(slug);
    setSlugError('');
  };

  const handleCreate = async () => {
    if (!orgName.trim()) { setError('请输入组织名称'); return; }
    if (!orgSlug.trim()) { setError('请输入组织标识'); return; }
    if (!/^[a-z0-9\u4e00-\u9fa5-]+$/.test(orgSlug)) {
      setSlugError('只能包含小写字母、数字、中文和横线');
      return;
    }
    setCreating(true); setError('');
    try {
      const org = await cloudSync.createOrganization(orgName.trim(), orgSlug.trim());
      setCreatedOrgId(org.id);
      setStep('invite');
    } catch (e: any) {
      setError(e.message?.includes('duplicate') ? '组织标识已被占用，请换一个' : e.message || '创建失败');
    } finally { setCreating(false); }
  };

  const handleInvite = async () => {
    const emails = inviteEmails.split(/[,\n]/).map(e => e.trim()).filter(Boolean);
    if (emails.length === 0) { setStep('done'); return; }
    setInviting(true); setError('');
    const results: { email: string; link: string }[] = [];
    for (const email of emails) {
      try {
        const token = await cloudSync.inviteMember(createdOrgId, email, inviteRole);
        results.push({ email, link: `https://bitwool.cn/invite/${token}` });
      } catch { results.push({ email, link: '发送失败' }); }
    }
    setInviteResults(results);
    setInviting(false);
    setStep('done');
  };

  const inputSt: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border-md)',
    background: 'var(--bg-surface3)', color: 'var(--text-primary)', fontSize: 13.5,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div style={{ width: 480, background: 'var(--bg-surface)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
        {/* 进度条 */}
        <div style={{ height: 3, background: 'var(--bg-surface2)' }}>
          <div style={{ height: '100%', background: 'var(--accent)', width: step === 'info' ? '33%' : step === 'invite' ? '66%' : '100%', transition: 'width 0.3s ease' }} />
        </div>

        <div style={{ padding: 32 }}>
          {step === 'info' && (
            <>
              <div style={{ fontSize: 22, marginBottom: 6 }}>🏢</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>创建你的组织</div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 24 }}>组织是团队协作的基础单元，可邀请成员、管理工作区和权限。</div>

              {error && <div style={{ fontSize: 12.5, color: '#e87a7a', marginBottom: 14, padding: '8px 12px', background: '#e87a7a18', borderRadius: 6 }}>{error}</div>}

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 6 }}>组织名称 *</label>
                <input value={orgName} onChange={e => handleNameChange(e.target.value)} style={inputSt} placeholder="例如：BitWool Studio" autoFocus />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 6 }}>组织标识（URL）*</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-tertiary)' }}>bitwool.cn/org/</span>
                  <input value={orgSlug} onChange={e => { setOrgSlug(e.target.value); setSlugError(''); }}
                    style={{ ...inputSt, paddingLeft: 116 }} placeholder="my-org" />
                </div>
                {slugError && <div style={{ fontSize: 11.5, color: '#e87a7a', marginTop: 4 }}>{slugError}</div>}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={onCancel} style={{ padding: '9px 20px', borderRadius: 9, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>取消</button>
                <button onClick={handleCreate} disabled={creating || !orgName.trim()}
                  style={{ padding: '9px 24px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', cursor: creating || !orgName.trim() ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', opacity: !orgName.trim() ? 0.6 : 1 }}>
                  {creating ? '创建中…' : '下一步 →'}
                </button>
              </div>
            </>
          )}

          {step === 'invite' && (
            <>
              <div style={{ fontSize: 22, marginBottom: 6 }}>✉️</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>邀请团队成员</div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 24 }}>输入邮箱地址，每行一个，或用逗号分隔。也可以跳过，后续在组织管理里邀请。</div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 6 }}>邮箱地址</label>
                <textarea value={inviteEmails} onChange={e => setInviteEmails(e.target.value)}
                  placeholder={'colleague1@company.com\ncolleague2@company.com'}
                  style={{ ...inputSt, height: 100, resize: 'none' }} />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>角色</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[{ id: 'member', label: '成员' }, { id: 'admin', label: '管理员' }, { id: 'guest', label: '访客' }].map(r => (
                    <button key={r.id} onClick={() => setInviteRole(r.id)}
                      style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1px solid ${inviteRole === r.id ? 'var(--accent)' : 'var(--border)'}`, background: inviteRole === r.id ? 'rgba(200,169,110,0.1)' : 'var(--bg-surface2)', color: inviteRole === r.id ? 'var(--accent)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button onClick={() => setStep('done')} style={{ padding: '9px 20px', borderRadius: 9, border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>跳过</button>
                <button onClick={handleInvite} disabled={inviting}
                  style={{ padding: '9px 24px', borderRadius: 9, border: 'none', background: 'var(--accent)', color: '#fff', cursor: inviting ? 'wait' : 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit' }}>
                  {inviting ? '发送中…' : '发送邀请'}
                </button>
              </div>
            </>
          )}

          {step === 'done' && (
            <>
              <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>组织创建成功！</div>
                <div style={{ fontSize: 13.5, color: 'var(--text-tertiary)', marginBottom: 24 }}>「{orgName}」已准备就绪，开始邀请团队协作吧。</div>
                {inviteResults.length > 0 && (
                  <div style={{ textAlign: 'left', background: 'var(--bg-surface2)', borderRadius: 10, padding: 14, marginBottom: 20 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 8 }}>邀请链接（7天有效）</div>
                    {inviteResults.map(r => (
                      <div key={r.email} style={{ fontSize: 12, marginBottom: 6 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{r.email}</span>
                        {r.link !== '发送失败' ? (
                          <button onClick={() => navigator.clipboard.writeText(r.link)}
                            style={{ marginLeft: 8, fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>复制链接</button>
                        ) : (
                          <span style={{ marginLeft: 8, color: '#e87a7a', fontSize: 11 }}>发送失败</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => onCreated(createdOrgId)}
                  style={{ padding: '10px 32px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 500, fontFamily: 'inherit' }}>
                  进入组织管理
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
