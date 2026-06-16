/**
 * OrgManageView.tsx — 组织管理（多端实时协作）
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { cloudSync, OrgMember, Organization } from '../../services/cloudSync';
import { ipc } from '../../utils/ipc';
import { fetchWorkspaces } from '../../store/slices/workspacesSlice';
import { AppDispatch } from '../../store';

type Tab = 'workspaces' | 'members' | 'invitations' | 'audit' | 'settings';

const ROLE_LABELS: Record<string, string> = {
  owner: '所有者', admin: '管理员', member: '成员', guest: '访客',
};
const ROLE_COLORS: Record<string, string> = {
  owner: '#c8a96e', admin: '#52c97a', member: '#5b9cf6', guest: '#8a8a84',
};

interface Props { orgId: string; }

export const OrgManageView: React.FC<Props> = ({ orgId }) => {
  const dispatch = useDispatch<AppDispatch>();
  const [tab, setTab] = useState<Tab>('workspaces');
  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [orgWorkspaces, setOrgWorkspaces] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteLink, setInviteLink] = useState('');
  const [inviting, setInviting] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [newWsIcon, setNewWsIcon] = useState('📂');
  const [creatingWs, setCreatingWs] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [orgs, mems, wss] = await Promise.all([
        cloudSync.getMyOrganizations(),
        cloudSync.getOrgMembers(orgId),
        cloudSync.getOrgWorkspaces(orgId),
      ]);
      setOrg(orgs.find(o => o.id === orgId) || null);
      setMembers(mems);
      setOrgWorkspaces(wss);
    } catch (e: any) {
      showMsg('error',
        e.message?.includes('recursion') ? '权限配置错误，请联系管理员' :
        e.message?.includes('schema cache') ? '数据库字段缺失，请联系管理员' :
        e.message?.includes('relationship') ? '数据表关联错误，请联系管理员' :
        e.message || '操作失败，请重试'
      );
    } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tab === 'audit') cloudSync.getAuditLogs(orgId).then(setAuditLogs).catch(() => {});
  }, [tab, orgId]);

  const handleCreateOrgWorkspace = async () => {
    if (!newWsName.trim()) return;
    setCreatingWs(true);
    try {
      const ws = await cloudSync.createOrgWorkspace(orgId, newWsName.trim(), newWsIcon);
      await ipc.invoke('workspaces:upsert', {
        id: ws.id, name: ws.name, icon: ws.icon || '📂',
        color: ws.color || '#5b9cf6', description: '',
        orgId: ws.org_id, ownerId: ws.owner_id, isShared: true,
        createdAt: new Date(ws.created_at).getTime(),
        updatedAt: new Date(ws.updated_at).getTime(),
      });
      dispatch(fetchWorkspaces());
      setNewWsName('');
      showMsg('success', `工作区「${ws.name}」已创建，组织成员可见`);
      await load();
    } catch (e: any) {
      showMsg('error',
        e.message?.includes('recursion') ? '权限配置错误，请联系管理员' :
        e.message?.includes('schema cache') ? '数据库字段缺失，请联系管理员' :
        e.message?.includes('relationship') ? '数据表关联错误，请联系管理员' :
        e.message || '操作失败，请重试'
      );
    } finally { setCreatingWs(false); }
  };

  const handleDeleteOrgWorkspace = async (wsId: string, wsName: string) => {
    if (!window.confirm(`确认删除「${wsName}」？`)) return;
    try {
      await cloudSync.unshareWorkspace(wsId);
      await ipc.invoke('workspaces:delete', { id: wsId });
      dispatch(fetchWorkspaces());
      showMsg('success', `已删除「${wsName}」`);
      await load();
    } catch (e: any) { showMsg('error',
        e.message?.includes('recursion') ? '权限配置错误，请联系管理员' :
        e.message?.includes('schema cache') ? '数据库字段缺失，请联系管理员' :
        e.message?.includes('relationship') ? '数据表关联错误，请联系管理员' :
        e.message || '操作失败，请重试'
      ); }
  };

  const handleInvite = async () => {
    setInviting(true); setInviteLink('');
    try {
      const token = await cloudSync.inviteMember(orgId, inviteEmail.trim(), inviteRole);
      setInviteLink(`https://bitwool.cn/invite/${token}`);
      setInviteEmail('');
      showMsg('success', '邀请链接已生成');
    } catch (e: any) { showMsg('error',
        e.message?.includes('recursion') ? '权限配置错误，请联系管理员' :
        e.message?.includes('schema cache') ? '数据库字段缺失，请联系管理员' :
        e.message?.includes('relationship') ? '数据表关联错误，请联系管理员' :
        e.message || '操作失败，请重试'
      ); }
    finally { setInviting(false); }
  };

  const handleRemoveMember = async (userId: string, name: string) => {
    if (!window.confirm(`确认移除成员 ${name}？`)) return;
    try {
      await cloudSync.removeMember(orgId, userId);
      showMsg('success', `已移除 ${name}`);
      await load();
    } catch (e: any) { showMsg('error',
        e.message?.includes('recursion') ? '权限配置错误，请联系管理员' :
        e.message?.includes('schema cache') ? '数据库字段缺失，请联系管理员' :
        e.message?.includes('relationship') ? '数据表关联错误，请联系管理员' :
        e.message || '操作失败，请重试'
      ); }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try { await cloudSync.updateMemberRole(orgId, userId, newRole); await load(); }
    catch (e: any) { showMsg('error',
        e.message?.includes('recursion') ? '权限配置错误，请联系管理员' :
        e.message?.includes('schema cache') ? '数据库字段缺失，请联系管理员' :
        e.message?.includes('relationship') ? '数据表关联错误，请联系管理员' :
        e.message || '操作失败，请重试'
      ); }
  };

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'workspaces',  label: '共享工作区', icon: '🗂️' },
    { id: 'members',     label: '成员管理',   icon: '👥' },
    { id: 'invitations', label: '邀请成员',   icon: '✉️' },
    { id: 'audit',       label: '审计日志',   icon: '📋' },
    { id: 'settings',    label: '设置',       icon: '⚙️' },
  ];

  const WS_ICONS = ['📂','📝','💻','🎨','📊','🔬','📚','🚀','🏗️','🎯'];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', width:'100%', background:'var(--bg-editor)', color:'var(--text-primary)', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ padding:'20px 28px 0', borderBottom:'1px solid var(--border)', flexShrink:0, background:'var(--bg-base)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
          <div style={{ width:40, height:40, borderRadius:10, background:'rgba(200,169,110,0.12)', border:'1px solid rgba(200,169,110,0.25)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>🏢</div>
          <div>
            <div style={{ fontSize:16, fontWeight:600 }}>{org?.name || '组织管理'}</div>
            <div style={{ fontSize:11.5, color:'var(--text-tertiary)', marginTop:2 }}>
              {members.length} 名成员 · {orgWorkspaces.length} 个共享工作区
            </div>
          </div>
        </div>
        <div style={{ display:'flex' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding:'7px 16px', background:'none', border:'none',
              borderBottom:`2px solid ${tab===t.id ? 'var(--accent)' : 'transparent'}`,
              color: tab===t.id ? 'var(--accent)' : 'var(--text-tertiary)',
              cursor:'pointer', fontSize:13, fontFamily:'inherit', marginBottom:-1, transition:'color 0.15s',
            }}>
              <span style={{ marginRight:5 }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 消息提示 */}
      {message && (
        <div style={{
          margin:'12px 28px 0', padding:'8px 14px', borderRadius:8, fontSize:13,
          background: message.type==='success' ? 'rgba(82,201,122,0.08)' : 'rgba(232,122,122,0.08)',
          color: message.type==='success' ? '#52c97a' : '#e87a7a',
          border:`1px solid ${message.type==='success' ? 'rgba(82,201,122,0.25)' : 'rgba(232,122,122,0.25)'}`,
          display:'flex', justifyContent:'space-between', alignItems:'center',
        }}>
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} style={{ background:'none', border:'none', color:'inherit', cursor:'pointer', fontSize:16, opacity:0.6 }}>×</button>
        </div>
      )}

      {/* 内容区 */}
      <div style={{ flex:1, overflowY:'auto', padding:'24px 28px 48px' }}>
        {loading ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:200, gap:10, color:'var(--text-tertiary)' }}>
            <div style={{ width:18, height:18, borderRadius:'50%', border:'2px solid var(--border)', borderTopColor:'var(--accent)', animation:'spin 0.7s linear infinite' }} />
            <span style={{ fontSize:13 }}>加载中…</span>
          </div>

        ) : tab === 'workspaces' ? (
          <div style={{ maxWidth:700 }}>
            <div style={{ background:'rgba(91,156,246,0.06)', border:'1px solid rgba(91,156,246,0.2)', borderRadius:10, padding:'12px 16px', marginBottom:20, fontSize:13, color:'var(--text-secondary)', lineHeight:1.7 }}>
              💡 <strong>共享工作区</strong>是组织内所有成员共同可见的工作空间，类似「团队空间」的概念。<br/>
              创建后组织成员登录启文，同步后即可在工作区列表中看到并协作编辑。
            </div>

            {/* 创建 */}
            <div style={{ background:'var(--bg-surface2)', borderRadius:12, padding:20, border:'1px solid var(--border)', marginBottom:20 }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:14 }}>创建共享工作区</div>
              <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
                <div>
                  <div style={{ fontSize:11, color:'var(--text-tertiary)', marginBottom:6 }}>图标</div>
                  <div style={{ display:'flex', gap:4, flexWrap:'wrap', maxWidth:160 }}>
                    {WS_ICONS.map(icon => (
                      <button key={icon} onClick={() => setNewWsIcon(icon)} style={{
                        width:30, height:30, borderRadius:6,
                        border:`1px solid ${newWsIcon===icon ? 'var(--accent)' : 'var(--border)'}`,
                        background: newWsIcon===icon ? 'rgba(200,169,110,0.1)' : 'var(--bg-surface3)',
                        cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center',
                      }}>{icon}</button>
                    ))}
                  </div>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:11, color:'var(--text-tertiary)', marginBottom:6 }}>工作区名称</div>
                  <input value={newWsName} onChange={e => setNewWsName(e.target.value)}
                    onKeyDown={e => e.key==='Enter' && handleCreateOrgWorkspace()}
                    placeholder="例如：产品研发、市场营销…"
                    style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid var(--border-md)', background:'var(--bg-surface3)', color:'var(--text-primary)', fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box' as const }} />
                </div>
                <button onClick={handleCreateOrgWorkspace} disabled={creatingWs || !newWsName.trim()} style={{
                  padding:'9px 20px', borderRadius:8, border:'none',
                  background: creatingWs||!newWsName.trim() ? 'var(--bg-surface3)' : 'var(--accent)',
                  color: creatingWs||!newWsName.trim() ? 'var(--text-tertiary)' : '#fff',
                  cursor: creatingWs||!newWsName.trim() ? 'not-allowed' : 'pointer',
                  fontSize:13, fontWeight:600, fontFamily:'inherit', whiteSpace:'nowrap' as const, transition:'all 0.15s',
                }}>
                  {creatingWs ? '创建中…' : '+ 创建'}
                </button>
              </div>
            </div>

            {/* 列表 */}
            <div style={{ fontSize:12, fontWeight:600, color:'var(--text-tertiary)', marginBottom:12, textTransform:'uppercase' as const, letterSpacing:0.5 }}>
              组织工作区 ({orgWorkspaces.length})
            </div>
            {orgWorkspaces.length === 0 ? (
              <div style={{ padding:'48px 0', textAlign:'center' as const, color:'var(--text-tertiary)', fontSize:13, opacity:0.6 }}>
                还没有共享工作区，创建一个让团队开始协作
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {orgWorkspaces.map(ws => (
                  <div key={ws.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', background:'var(--bg-surface2)', borderRadius:10, border:'1px solid var(--border)' }}>
                    <div style={{ fontSize:22, width:36, height:36, borderRadius:8, background:'rgba(91,156,246,0.1)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {ws.icon || '📂'}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13.5, fontWeight:500 }}>{ws.name}</div>
                      <div style={{ fontSize:11, color:'var(--text-tertiary)', marginTop:2 }}>
                        全员可访问 · 创建于 {new Date(ws.created_at).toLocaleDateString('zh-CN')}
                      </div>
                    </div>
                    <span style={{ fontSize:11, color:'#5b9cf6', background:'rgba(91,156,246,0.1)', padding:'2px 8px', borderRadius:4, border:'1px solid rgba(91,156,246,0.2)', flexShrink:0 }}>
                      🌐 共享
                    </span>
                    <button onClick={() => handleDeleteOrgWorkspace(ws.id, ws.name)} style={{ padding:'4px 10px', borderRadius:6, border:'1px solid rgba(232,122,122,0.3)', background:'rgba(232,122,122,0.06)', color:'#e87a7a', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop:20, padding:'12px 16px', background:'var(--bg-surface2)', borderRadius:10, border:'1px solid var(--border)', fontSize:12.5, color:'var(--text-tertiary)', lineHeight:1.8 }}>
              <strong style={{ color:'var(--text-secondary)' }}>成员如何协作？</strong><br/>
              1. 邀请成员加入组织（「邀请成员」tab）<br/>
              2. 成员接受邀请，用自己的账号登录启文<br/>
              3. 点击「云端同步」，共享工作区自动出现在左侧列表<br/>
              4. 在共享工作区内编辑文档，内容实时同步给所有成员
            </div>
          </div>

        ) : tab === 'members' ? (
          <div style={{ maxWidth:700 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--text-tertiary)', marginBottom:12, textTransform:'uppercase' as const, letterSpacing:0.5 }}>成员列表 ({members.length})</div>
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {members.map(m => (
                <div key={m.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 16px', background:'var(--bg-surface2)', borderRadius:10, border:'1px solid var(--border)' }}>
                  <div style={{ width:34, height:34, borderRadius:8, background:m.avatarColor, display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, color:'#fff', fontWeight:700, flexShrink:0 }}>
                    {m.displayName.slice(0,1).toUpperCase()}
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:500 }}>{m.displayName}</div>
                    <div style={{ fontSize:11, color:'var(--text-tertiary)', marginTop:1 }}>加入于 {new Date(m.joinedAt).toLocaleDateString('zh-CN')}</div>
                  </div>
                  <span style={{ fontSize:11, color:ROLE_COLORS[m.role], background:`${ROLE_COLORS[m.role]}15`, padding:'2px 8px', borderRadius:5, border:`1px solid ${ROLE_COLORS[m.role]}30`, fontWeight:500 }}>
                    {ROLE_LABELS[m.role]}
                  </span>
                  {m.role !== 'owner' && (
                    <>
                      <select value={m.role} onChange={e => handleRoleChange(m.userId, e.target.value)} style={{ padding:'4px 8px', borderRadius:6, border:'1px solid var(--border)', background:'var(--bg-surface3)', color:'var(--text-secondary)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
                        {Object.entries(ROLE_LABELS).filter(([k]) => k !== 'owner').map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <button onClick={() => handleRemoveMember(m.userId, m.displayName)} style={{ padding:'4px 10px', borderRadius:6, border:'1px solid rgba(232,122,122,0.3)', background:'rgba(232,122,122,0.06)', color:'#e87a7a', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>移除</button>
                    </>
                  )}
                </div>
              ))}
              {members.length === 0 && <div style={{ padding:'48px 0', textAlign:'center' as const, color:'var(--text-tertiary)', fontSize:13, opacity:0.6 }}>暂无成员</div>}
            </div>
          </div>

        ) : tab === 'invitations' ? (
          <div style={{ maxWidth:520 }}>
            <div style={{ background:'var(--bg-surface2)', borderRadius:14, padding:24, border:'1px solid var(--border)' }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:16 }}>邀请新成员加入组织</div>
              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:11.5, color:'var(--text-tertiary)', display:'block', marginBottom:6 }}>邮箱（可选，留空生成通用链接）</label>
                <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@company.com"
                  style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:'1px solid var(--border-md)', background:'var(--bg-surface3)', color:'var(--text-primary)', fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box' as const }} />
              </div>
              <div style={{ marginBottom:18 }}>
                <label style={{ fontSize:11.5, color:'var(--text-tertiary)', display:'block', marginBottom:8 }}>角色</label>
                <div style={{ display:'flex', gap:8 }}>
                  {(['member','admin','guest'] as const).map(role => (
                    <button key={role} onClick={() => setInviteRole(role)} style={{
                      flex:1, padding:'7px 0', borderRadius:8,
                      border:`1px solid ${inviteRole===role ? ROLE_COLORS[role] : 'var(--border)'}`,
                      background: inviteRole===role ? `${ROLE_COLORS[role]}12` : 'var(--bg-surface3)',
                      color: inviteRole===role ? ROLE_COLORS[role] : 'var(--text-secondary)',
                      cursor:'pointer', fontSize:12.5, fontFamily:'inherit',
                      fontWeight: inviteRole===role ? 600 : 400, transition:'all 0.15s',
                    }}>{ROLE_LABELS[role]}</button>
                  ))}
                </div>
              </div>
              <button onClick={handleInvite} disabled={inviting} style={{ width:'100%', padding:'10px 0', borderRadius:9, border:'none', background:'var(--accent)', color:'#fff', cursor:inviting?'wait':'pointer', fontSize:13.5, fontWeight:600, fontFamily:'inherit', opacity:inviting?0.7:1 }}>
                {inviting ? '生成中…' : '生成邀请链接'}
              </button>
              {inviteLink && (
                <div style={{ marginTop:14, padding:'12px 14px', background:'var(--bg-surface3)', borderRadius:9, border:'1px solid var(--border)' }}>
                  <div style={{ fontSize:11, color:'var(--text-tertiary)', marginBottom:6 }}>邀请链接（7天有效）</div>
                  <div style={{ fontSize:12, fontFamily:'monospace', color:'#52c97a', wordBreak:'break-all', lineHeight:1.6 }}>{inviteLink}</div>
                  <button onClick={() => navigator.clipboard.writeText(inviteLink)} style={{ marginTop:8, fontSize:12, padding:'4px 12px', background:'none', border:'1px solid var(--border)', borderRadius:6, color:'var(--text-secondary)', cursor:'pointer', fontFamily:'inherit' }}>复制链接</button>
                </div>
              )}
            </div>
          </div>

        ) : tab === 'audit' ? (
          <div style={{ maxWidth:700 }}>
            <div style={{ fontSize:12, fontWeight:600, color:'var(--text-tertiary)', marginBottom:12, textTransform:'uppercase' as const, letterSpacing:0.5 }}>审计日志</div>
            <div style={{ background:'var(--bg-surface2)', borderRadius:12, border:'1px solid var(--border)', overflow:'hidden' }}>
              {auditLogs.length === 0 ? (
                <div style={{ padding:'48px 0', textAlign:'center' as const, color:'var(--text-tertiary)', fontSize:13, opacity:0.6 }}>暂无审计记录</div>
              ) : auditLogs.map((log, idx) => (
                <div key={log.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', fontSize:13, borderBottom: idx<auditLogs.length-1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ width:28, height:28, borderRadius:7, background:log.user_profiles?.avatar_color||'#555', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#fff', fontWeight:700, flexShrink:0 }}>
                    {(log.user_profiles?.display_name||'?').slice(0,1).toUpperCase()}
                  </div>
                  <span style={{ color:'var(--text-secondary)', minWidth:80, fontSize:12 }}>{log.user_profiles?.display_name||'系统'}</span>
                  <span style={{ color:'var(--accent)', fontFamily:'monospace', fontSize:11.5, background:'rgba(200,169,110,0.08)', padding:'1px 7px', borderRadius:4 }}>{log.action}</span>
                  <span style={{ color:'var(--text-tertiary)', fontSize:11, marginLeft:'auto' }}>{new Date(log.created_at).toLocaleString('zh-CN')}</span>
                </div>
              ))}
            </div>
          </div>

        ) : (
          <div style={{ maxWidth:520 }}>
            <div style={{ background:'var(--bg-surface2)', borderRadius:14, padding:24, border:'1px solid var(--border)', color:'var(--text-tertiary)', fontSize:13, textAlign:'center' as const, lineHeight:1.8 }}>
              组织名称、Logo、自定义域名等高级设置<br/>
              <span style={{ color:'var(--accent)', opacity:0.7, fontSize:12 }}>企业版功能，开发中</span>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
