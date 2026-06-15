/**
 * UserProfileView.tsx — 用户个人资料页
 * src/renderer/components/settings/UserProfileView.tsx
 */
import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../store';
import { cloudSync } from '../../services/cloudSync';
import { supabase } from '../../lib/supabase';

const AVATAR_COLORS = ['#c8a96e','#52c97a','#5b9cf6','#e87a7a','#b87aed','#f0a050','#50c8c8','#e0c050'];

export const UserProfileView: React.FC = () => {
  const user = useSelector((s: RootState) => s.auth.user);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [selectedColor, setSelectedColor] = useState(user?.avatar || '#c8a96e');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [pwdForm, setPwdForm] = useState({ current: '', next: '', confirm: '' });
  const [pwdError, setPwdError] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  const handleSaveProfile = async () => {
    setSaving(true); setMessage('');
    try {
      await cloudSync.updateProfile({ displayName, avatarColor: selectedColor });
      setMessage('✓ 保存成功');
      setTimeout(() => setMessage(''), 3000);
    } catch (e: any) { setMessage('保存失败: ' + e.message); }
    finally { setSaving(false); }
  };

  const handleChangePassword = async () => {
    if (!pwdForm.next || pwdForm.next.length < 8) { setPwdError('新密码至少8位'); return; }
    if (pwdForm.next !== pwdForm.confirm) { setPwdError('两次密码不一致'); return; }
    setPwdSaving(true); setPwdError('');
    try {
      const { error } = await supabase.auth.updateUser({ password: pwdForm.next });
      if (error) throw new Error(error.message);
      setPwdForm({ current: '', next: '', confirm: '' });
      setMessage('✓ 密码已更新');
      setTimeout(() => setMessage(''), 3000);
    } catch (e: any) { setPwdError(e.message); }
    finally { setPwdSaving(false); }
  };

  const inputSt: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border-md)',
    background: 'var(--bg-surface3)', color: 'var(--text-primary)', fontSize: 13,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 680, width: '100%' }}>
      <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>个人资料</div>

      {message && (
        <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 13,
          background: message.startsWith('✓') ? '#52c97a18' : '#e87a7a18',
          color: message.startsWith('✓') ? '#52c97a' : '#e87a7a' }}>
          {message}
        </div>
      )}

      {/* 头像 */}
      <div style={{ background: 'var(--bg-surface2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>头像颜色</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: selectedColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#fff', fontWeight: 700, flexShrink: 0 }}>
            {(displayName || user?.displayName || '?').slice(0, 1).toUpperCase()}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {AVATAR_COLORS.map(c => (
              <div key={c} onClick={() => setSelectedColor(c)} style={{
                width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer',
                border: selectedColor === c ? '3px solid var(--text-primary)' : '3px solid transparent',
                transition: 'border 0.15s',
              }} />
            ))}
          </div>
        </div>
      </div>

      {/* 基本信息 */}
      <div style={{ background: 'var(--bg-surface2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>基本信息</div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 6 }}>显示名称</label>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} style={inputSt} placeholder="你的名字" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 6 }}>邮箱</label>
          <input value={user?.email || ''} disabled style={{ ...inputSt, opacity: 0.5, cursor: 'not-allowed' }} />
        </div>
        <button onClick={handleSaveProfile} disabled={saving}
          style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: saving ? 'wait' : 'pointer', fontSize: 13, fontFamily: 'inherit', opacity: saving ? 0.7 : 1 }}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {/* 修改密码 */}
      <div style={{ background: 'var(--bg-surface2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>修改密码</div>
        {pwdError && <div style={{ fontSize: 12.5, color: '#e87a7a', marginBottom: 10 }}>{pwdError}</div>}
        <div style={{ marginBottom: 10 }}>
          <input type="password" value={pwdForm.next} onChange={e => setPwdForm(f => ({ ...f, next: e.target.value }))} style={inputSt} placeholder="新密码（至少8位）" />
        </div>
        <div style={{ marginBottom: 16 }}>
          <input type="password" value={pwdForm.confirm} onChange={e => setPwdForm(f => ({ ...f, confirm: e.target.value }))} style={inputSt} placeholder="确认新密码" />
        </div>
        <button onClick={handleChangePassword} disabled={pwdSaving}
          style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-primary)', cursor: pwdSaving ? 'wait' : 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
          {pwdSaving ? '更新中…' : '更新密码'}
        </button>
      </div>

      {/* 账号信息 */}
      <div style={{ background: 'var(--bg-surface2)', borderRadius: 12, padding: 20, border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>账号信息</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>用户 ID</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{user?.id?.slice(0, 16)}…</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>当前计划</span>
            <span style={{ color: 'var(--accent)' }}>{user?.plan === 'pro' ? '专业版' : user?.plan === 'enterprise' ? '企业版' : '免费版'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
