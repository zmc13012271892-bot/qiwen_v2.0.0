import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { loadSettings, saveSetting } from '../../store/slices/settingsSlice';
import { AppSettings } from '../../../shared/types';
import { ipc } from '../../utils/ipc';
import { LicenseView } from './LicenseView';
import { UserProfileView } from './UserProfileView';
import { OnboardingPage } from '../onboarding/OnboardingPage';

type SettingSection = 'appearance' | 'editor' | 'ai' | 'shortcuts' | 'data' | 'about' | 'license' | 'profile';

// ── UI 基础组件 ─────────────────────────────────────────────
const Section: React.FC<{ title: string; desc?: string; children: React.ReactNode }> = ({ title, desc, children }) => (
  <div style={{ marginBottom: 28 }}>
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: '1.2px', textTransform: 'uppercase' as const, color: 'var(--text-tertiary)', fontWeight: 600, paddingBottom: 8, borderBottom: '0.5px solid var(--border)' }}>{title}</div>
      {desc && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.6 }}>{desc}</div>}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
  </div>
);

const Row: React.FC<{ label: string; desc?: string; children: React.ReactNode }> = ({ label, desc, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderRadius: 10, background: 'var(--bg-surface2)', border: '0.5px solid var(--border)', gap: 12 }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{label}</div>
      {desc && <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
    </div>
    <div style={{ flexShrink: 0 }}>{children}</div>
  </div>
);

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({ value, onChange, disabled }) => (
  <button onClick={() => !disabled && onChange(!value)} style={{ width: 40, height: 22, borderRadius: 11, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', background: value ? 'linear-gradient(135deg, #c8a96e, #9a7040)' : 'var(--bg-surface3)', position: 'relative', transition: 'background 0.2s', opacity: disabled ? 0.5 : 1 }}>
    <div style={{ position: 'absolute', top: 3, left: value ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
  </button>
);

const Select: React.FC<{ value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }> = ({ value, options, onChange }) => (
  <select value={value} onChange={e => onChange(e.target.value)} style={{ background: 'var(--bg-surface)', border: '0.5px solid var(--border-md)', borderRadius: 8, padding: '5px 10px', fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', outline: 'none', fontFamily: 'inherit', minWidth: 110 }}>
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

const Slider: React.FC<{ value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string }> = ({ value, min, max, step = 1, onChange, unit }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} style={{ width: 100, accentColor: 'var(--accent)', cursor: 'pointer' }} />
    <span style={{ fontSize: 12, color: 'var(--text-tertiary)', minWidth: 38, textAlign: 'right' }}>{value}{unit}</span>
  </div>
);

const SecretInput: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string; onSave: () => void; saved: boolean }> = ({ value, onChange, placeholder, onSave, saved }) => (
  <div style={{ display: 'flex', gap: 6, minWidth: 260 }}>
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type="password"
      onKeyDown={e => { if (e.key === 'Enter') onSave(); }}
      style={{ flex: 1, height: 30, padding: '0 10px', borderRadius: 7, background: 'var(--bg-surface3)', border: '0.5px solid var(--border)', color: 'var(--text-primary)', fontSize: 12.5, outline: 'none', fontFamily: 'inherit' }} />
    <button onClick={onSave} style={{ height: 30, padding: '0 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer', border: 'none', background: saved ? '#52c97a' : 'var(--accent)', color: '#fff', fontFamily: 'inherit', transition: 'background 0.2s', flexShrink: 0 }}>
      {saved ? '✓ 已保存' : '保存'}
    </button>
  </div>
);

// ── 独立 ApiKey 行组件（避免在 map 里调用 Hook）──────────────
const ApiKeyRow: React.FC<{ storeKey: string; label: string; placeholder: string }> = ({ storeKey, label, placeholder }) => {
  const [val, setVal] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('qiwen-api-keys') || '{}')[storeKey] || ''; } catch { return ''; }
  });
  const [saved, setSaved] = React.useState(false);
  const handleSave = () => {
    try {
      const keys = JSON.parse(localStorage.getItem('qiwen-api-keys') || '{}');
      keys[storeKey] = val;
      localStorage.setItem('qiwen-api-keys', JSON.stringify(keys));
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    } catch {}
  };
  return (
    <Row label={label}>
      <SecretInput value={val} onChange={setVal} placeholder={placeholder} saved={saved} onSave={handleSave} />
    </Row>
  );
};

// ── AI 设置组件 ─────────────────────────────────────────────
const AiSettings: React.FC = () => {
  const [apiKey, setApiKey] = useState(() => { try { return localStorage.getItem('qiwen_doubao_apikey') || ''; } catch { return ''; } });
  const [model, setModel] = useState(() => { try { return localStorage.getItem('qiwen_doubao_model') || 'doubao-seed-2-0-pro-260215'; } catch { return 'doubao-seed-2-0-pro-260215'; } });
  const [savedKey, setSavedKey] = useState(false);
  const [savedModel, setSavedModel] = useState(false);
  const [copilotEnabled, setCopilotEnabled] = useState(() => { try { return localStorage.getItem('qiwen_copilot_enabled') !== 'false'; } catch { return true; } });
  const [copilotDelay, setCopilotDelay] = useState(() => { try { return parseInt(localStorage.getItem('qiwen_copilot_delay') || '1200'); } catch { return 1200; } });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');

  const saveKey = () => {
    try { localStorage.setItem('qiwen_doubao_apikey', apiKey); setSavedKey(true); setTimeout(() => setSavedKey(false), 1500); } catch {}
  };
  const saveModel = () => {
    try { localStorage.setItem('qiwen_doubao_model', model); setSavedModel(true); setTimeout(() => setSavedModel(false), 1500); } catch {}
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult('');
    try {
      const res = await (window as any).electronAPI?.invoke('ai:chat-stream', {
        messages: [{ role: 'user', content: '你好，请回复"连接成功"三个字' }],
        apiKey: apiKey || undefined,
        model,
      });
      setTestResult(res?.includes('连接') || res?.includes('成功') ? '✅ 连接成功' : `✅ 响应正常：${res?.slice(0, 30)}...`);
    } catch (e: any) {
      setTestResult(`❌ 连接失败：${e?.message || '未知错误'}`);
    }
    setTesting(false);
  };

  return (
    <>
      <Section title="豆包 API" desc="启文内置 API Key，可直接使用。填入自己的 Key 可提升配额，不影响其他用户。">
        <Row label="API Key" desc="格式：ark-xxxxxxxx-...">
          <SecretInput value={apiKey} onChange={setApiKey} placeholder="留空使用内置 Key" onSave={saveKey} saved={savedKey} />
        </Row>
        <Row label="模型" desc="推荐使用 doubao-seed-2-0-pro">
          <div style={{ display: 'flex', gap: 6 }}>
            <Select value={model} onChange={setModel} options={[
              { value: 'doubao-seed-2-0-pro-260215', label: 'doubao-seed-2-0-pro (推荐)' },
              { value: 'doubao-pro-32k', label: 'doubao-pro-32k' },
              { value: 'doubao-lite-32k', label: 'doubao-lite-32k (快速)' },
            ]} />
            <button onClick={saveModel} style={{ height: 30, padding: '0 10px', borderRadius: 7, fontSize: 12, cursor: 'pointer', border: 'none', background: savedModel ? '#52c97a' : 'var(--bg-surface3)', border2: '0.5px solid var(--border)', color: savedModel ? '#fff' : 'var(--text-secondary)', fontFamily: 'inherit', transition: 'background 0.2s' } as any}>
              {savedModel ? '✓' : '保存'}
            </button>
          </div>
        </Row>
        <Row label="测试连接" desc={testResult || '验证 API Key 和模型是否正常工作'}>
          <button onClick={testConnection} disabled={testing} style={{ height: 30, padding: '0 14px', borderRadius: 7, fontSize: 12.5, cursor: testing ? 'wait' : 'pointer', border: '0.5px solid var(--border-md)', background: 'var(--bg-surface3)', color: 'var(--text-secondary)', fontFamily: 'inherit' }}>
            {testing ? '测试中...' : '测试'}
          </button>
        </Row>
      </Section>

      <Section title="AI Copilot" desc="打字停顿后自动触发 AI 续写建议，按 Tab 接受。">
        <Row label="启用 Copilot 补全">
          <Toggle value={copilotEnabled} onChange={v => { setCopilotEnabled(v); try { localStorage.setItem('qiwen_copilot_enabled', String(v)); } catch {} }} />
        </Row>
        <Row label="触发延迟" desc="停止输入多久后触发，越短越灵敏但越耗费 API">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min={500} max={3000} step={100} value={copilotDelay} onChange={e => { const v = Number(e.target.value); setCopilotDelay(v); try { localStorage.setItem('qiwen_copilot_delay', String(v)); } catch {}; }} style={{ width: 100, accentColor: 'var(--accent)' }} />
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', minWidth: 48 }}>{(copilotDelay/1000).toFixed(1)}s</span>
          </div>
        </Row>
      </Section>

      <Section title="其他插件 API Key" desc="填入后插件可以访问真实数据源，留空使用内置示例数据。">
        <ApiKeyRow storeKey="drugApiKey" label="药品数据库" placeholder="药智数据 API Key" />
        <ApiKeyRow storeKey="icdClientId" label="ICD-11 Client ID" placeholder="WHO ICD API Client ID" />
        <ApiKeyRow storeKey="icdClientSecret" label="ICD-11 Client Secret" placeholder="WHO ICD API Client Secret" />
        <ApiKeyRow storeKey="legalApiKey" label="法律数据库" placeholder="北大法宝 API Key" />
        <ApiKeyRow storeKey="semanticScholarKey" label="Semantic Scholar" placeholder="申请后可提升查询配额" />
      </Section>
    </>
  );
};

// ── 快捷键设置 ──────────────────────────────────────────────
const ShortcutsSettings: React.FC = () => {
  const shortcuts = [
    { label: '保存文档', keys: 'Ctrl+S / ⌘S' },
    { label: '导出文档', keys: 'Ctrl+Shift+S' },
    { label: '全局搜索', keys: 'Ctrl+K / ⌘K' },
    { label: '新建文档', keys: 'Ctrl+N / ⌘N' },
    { label: '查找与替换', keys: 'Ctrl+F / ⌘F' },
    { label: '切换侧边栏', keys: 'Ctrl+\\ / ⌘\\' },
    { label: '加粗', keys: 'Ctrl+B / ⌘B' },
    { label: '斜体', keys: 'Ctrl+I / ⌘I' },
    { label: '下划线', keys: 'Ctrl+U / ⌘U' },
    { label: '接受 AI 补全', keys: 'Tab' },
    { label: '撤销', keys: 'Ctrl+Z / ⌘Z' },
    { label: '重做', keys: 'Ctrl+Y / ⌘Shift+Z' },
    { label: '全屏', keys: 'F11' },
    { label: '斜杠命令菜单', keys: '/ (段落首)' },
    { label: 'PPT 全屏演示', keys: 'Ctrl+Enter' },
    { label: '思维导图 - 添加子节点', keys: 'Tab' },
    { label: '思维导图 - 添加兄弟节点', keys: 'Enter' },
    { label: '思维导图 - 删除节点', keys: 'Delete' },
    { label: '思维导图 - 编辑节点', keys: 'F2' },
  ];
  return (
    <Section title="快捷键参考" desc="所有快捷键均为系统固定值，暂不支持自定义。">
      <div style={{ background: 'var(--bg-surface2)', border: '0.5px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {shortcuts.map(({ label, keys }, i) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: i < shortcuts.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
            <code style={{ fontSize: 12, background: 'var(--bg-surface3)', border: '0.5px solid var(--border-md)', borderRadius: 6, padding: '3px 10px', color: 'var(--accent)', fontFamily: 'var(--font-mono, monospace)' }}>{keys}</code>
          </div>
        ))}
      </div>
    </Section>
  );
};

// ── 数据管理 ────────────────────────────────────────────────
const DataSettings: React.FC = () => {
  const activeWorkspaceId = useSelector((s: RootState) => s.app.activeWorkspaceId);
  const [exporting, setExporting] = useState(false);
  const [dbPath, setDbPath] = useState('');

  useEffect(() => {
    ipc.invoke('app:get-db-path').then(p => { if (p) setDbPath(p); }).catch(() => {});
  }, []);

  const exportAll = async () => {
    if (!activeWorkspaceId) return;
    setExporting(true);
    try {
      const result = await (window as any).electronAPI?.invoke('export:all-markdown', { workspaceId: activeWorkspaceId });
      if (result?.success) {
        alert(`导出完成！共导出 ${result.count} 个文档到：\n${result.folder}`);
      } else {
        alert('导出失败：' + (result?.error || '未知错误'));
      }
    } catch { alert('导出失败'); }
    finally { setExporting(false); }
  };

  const openDbFolder = () => {
    if (dbPath) (window as any).electronAPI?.invoke('open-external', 'file://' + dbPath.replace(/[^/\\]*$/, '')).catch(() => {});
  };

  return (
    <>
      <Section title="数据存储">
        <Row label="数据库位置" desc={dbPath || '加载中...'}>
          <button onClick={openDbFolder} style={{ padding: '5px 12px', background: 'var(--bg-surface3)', border: '0.5px solid var(--border-md)', borderRadius: 7, fontSize: 12.5, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}>
            打开文件夹
          </button>
        </Row>
        <Row label="全量导出" desc="将当前工作区所有文档导出为 Markdown 文件">
          <button onClick={exportAll} disabled={exporting} style={{ padding: '5px 12px', background: 'var(--bg-surface3)', border: '0.5px solid var(--border-md)', borderRadius: 7, fontSize: 12.5, color: 'var(--text-secondary)', cursor: exporting ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            {exporting ? '导出中...' : '导出为 Markdown'}
          </button>
        </Row>
      </Section>
      <Section title="全文索引">
        <Row label="重建搜索索引" desc="若搜索结果不准确，可手动触发全量重建">
          <button onClick={() => {
            ipc.invoke('documents:rebuild-fts', { workspaceId: activeWorkspaceId }).then(() => alert('索引重建完成')).catch(() => alert('重建失败'));
          }} style={{ padding: '5px 12px', background: 'var(--bg-surface3)', border: '0.5px solid var(--border-md)', borderRadius: 7, fontSize: 12.5, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'inherit' }}>
            重建索引
          </button>
        </Row>
      </Section>
    </>
  );
};

// ── 导航项 ──────────────────────────────────────────────────
const NAV: { id: SettingSection; label: string; icon: React.ReactNode }[] = [
  { id: 'appearance', label: '外观', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg> },
  { id: 'editor', label: '编辑器', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"/></svg> },
  { id: 'ai', label: 'AI 设置', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> },
  { id: 'shortcuts', label: '快捷键', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/></svg> },
  { id: 'data', label: '数据管理', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg> },
  { id: 'profile', label: '个人资料', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
  { id: 'about', label: '关于', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
  { id: 'license', label: '授权管理', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> },
];

// ── 主组件 ──────────────────────────────────────────────────
export const SettingsView: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const settings = useSelector((s: RootState) => s.settings);
  const [active, setActive] = useState<SettingSection>('appearance');
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => { dispatch(loadSettings()); }, [dispatch]);
  const save = (key: keyof AppSettings, value: any) => dispatch(saveSetting({ key, value }));

  return (
    <div style={{ flex: 1, display: 'flex', background: 'var(--bg-editor)', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ width: 192, borderRight: '0.5px solid var(--border)', background: 'var(--bg-surface)', padding: '24px 10px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 18, paddingLeft: 10 }}>设置</div>
        <div style={{ flex: 1 }}>
          {NAV.map(n => (
            <button key={n.id} onClick={() => setActive(n.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '9px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13.5, textAlign: 'left', marginBottom: 2, background: active === n.id ? 'rgba(200,169,110,0.1)' : 'transparent', color: active === n.id ? 'var(--accent)' : 'var(--text-secondary)', fontFamily: 'inherit', transition: 'all 0.12s' }}
              onMouseOver={e => { if (active !== n.id) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
              onMouseOut={e => { if (active !== n.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
              <span style={{ opacity: active === n.id ? 1 : 0.7 }}>{n.icon}</span>
              {n.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', padding: '12px 10px 0', borderTop: '0.5px solid var(--border)', lineHeight: 1.6 }}>
          启文 v1.2.0<br />bitwool.cn
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 40px 60px', minWidth: 0 }}>

        {active === 'appearance' && <>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 24 }}>外观</div>
          <Section title="主题">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {(['dark', 'system', 'light'] as AppSettings['theme'][]).map(t => {
                const info = { dark: { label: '深色', bg: '#0a0a0f', ac: '#c8a96e', tc: '#888' }, system: { label: '跟随系统', bg: '#1a1a2e', ac: '#8b7355', tc: '#888' }, light: { label: '浅色', bg: '#f5f5f0', ac: '#9a7040', tc: '#555' } }[t]!;
                return (
                  <button key={t} onClick={() => save('theme', t)} style={{ padding: '16px 12px', borderRadius: 12, cursor: 'pointer', border: 'none', background: info.bg, outline: settings.theme === t ? `2px solid ${info.ac}` : '1px solid rgba(255,255,255,0.08)', outlineOffset: 2, transition: 'outline 0.15s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: '60%', height: 20, borderRadius: 6, background: info.ac, opacity: 0.7 }} />
                    <div style={{ width: '80%', height: 4, borderRadius: 2, background: info.ac, opacity: 0.3 }} />
                    <div style={{ width: '70%', height: 4, borderRadius: 2, background: info.ac, opacity: 0.2 }} />
                    <div style={{ fontSize: 11, color: info.tc, marginTop: 2 }}>{info.label}</div>
                    {settings.theme === t && <div style={{ fontSize: 10, color: info.ac }}>✓ 当前</div>}
                  </button>
                );
              })}
            </div>
          </Section>
          <Section title="强调色">
            <Row label="界面主色" desc="用于高亮、按钮、链接等关键元素">
              <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                {['#c8a96e', '#4a9eff', '#b88af0', '#52c97a', '#ff6b6b', '#f0a742', '#e87abf', '#64b4ff'].map(color => (
                  <button key={color} onClick={() => save('accentColor', color)} style={{ width: 22, height: 22, borderRadius: '50%', background: color, border: settings.accentColor === color ? '3px solid rgba(255,255,255,0.9)' : '2px solid transparent', cursor: 'pointer', outline: 'none', boxShadow: settings.accentColor === color ? `0 0 0 2px ${color}` : 'none', transition: 'all 0.15s' }} />
                ))}
                <input type="color" value={settings.accentColor || '#c8a96e'} onChange={e => save('accentColor', e.target.value)} style={{ width: 22, height: 22, border: 'none', padding: 0, borderRadius: '50%', cursor: 'pointer', background: 'none' }} title="自定义颜色" />
              </div>
            </Row>
          </Section>
          <Section title="语言">
            <Row label="界面语言">
              <Select value={settings.language} onChange={v => save('language', v as AppSettings['language'])} options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }]} />
            </Row>
          </Section>
          <Section title="职业与偏好">
            <Row label="重新选择职业" desc="重新配置适合你职业的插件和功能">
              <button
                onClick={() => setShowOnboarding(true)}
                style={{
                  padding: '5px 14px', background: 'var(--bg-surface3)',
                  border: '0.5px solid var(--border-md)', borderRadius: 7,
                  fontSize: 12.5, color: 'var(--accent)', cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: 500,
                }}
              >
                重新引导 →
              </button>
            </Row>
          </Section>
        </>}

        {/* 职业引导浮层 */}
        {showOnboarding && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} onClick={() => setShowOnboarding(false)}>
            <div onClick={e => e.stopPropagation()} style={{
              width: 640, maxHeight: '85vh', overflowY: 'auto',
              borderRadius: 18, boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
            }}>
              <OnboardingPage onComplete={() => setShowOnboarding(false)} />
            </div>
          </div>
        )}

        {active === 'editor' && <>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 24 }}>编辑器</div>
          <Section title="文字排版">
            <Row label="字体大小"><Slider value={settings.fontSize} min={12} max={24} onChange={v => save('fontSize', v)} unit="px" /></Row>
            <Row label="行高"><Slider value={settings.lineHeight} min={1.4} max={2.4} step={0.1} onChange={v => save('lineHeight', v)} /></Row>
            <Row label="字体风格">
              <Select value={settings.fontFamily} onChange={v => save('fontFamily', v)} options={[{ value: 'default', label: '默认（无衬线）' }, { value: 'serif', label: '宋体/衬线' }, { value: 'mono', label: '等宽字体' }]} />
            </Row>
            <Row label="编辑区域宽度">
              <Select value={settings.editorWidth} onChange={v => save('editorWidth', v as AppSettings['editorWidth'])} options={[{ value: 'narrow', label: '窄 (560px)' }, { value: 'normal', label: '正常 (720px)' }, { value: 'wide', label: '宽 (900px)' }, { value: 'full', label: '全宽' }]} />
            </Row>
          </Section>
          <Section title="行为">
            <Row label="自动保存" desc="停止输入后自动保存到数据库"><Toggle value={settings.autoSave} onChange={v => save('autoSave', v)} /></Row>
            <Row label="自动保存间隔">
              <Select value={String(settings.autoSaveInterval)} onChange={v => save('autoSaveInterval', Number(v))} options={[{ value: '1000', label: '1 秒' }, { value: '3000', label: '3 秒（推荐）' }, { value: '10000', label: '10 秒' }, { value: '30000', label: '30 秒' }]} />
            </Row>
            <Row label="拼写检查" desc="使用系统原生拼写检查"><Toggle value={settings.spellCheck} onChange={v => save('spellCheck', v)} /></Row>
            <Row label="显示字数统计"><Toggle value={settings.showWordCount} onChange={v => save('showWordCount', v)} /></Row>
            <Row label="显示行号"><Toggle value={settings.showLineNumbers} onChange={v => save('showLineNumbers', v)} /></Row>
          </Section>
          <Section title="专注模式">
            <Row label="背景模糊度" desc="专注模式下非活动区域的虚化强度"><Slider value={settings.focusModeBlur} min={0} max={100} onChange={v => save('focusModeBlur', v)} unit="%" /></Row>
          </Section>
          <Section title="布局">
            <Row label="侧边栏宽度"><Slider value={settings.sidebarWidth} min={180} max={320} step={10} onChange={v => save('sidebarWidth', v)} unit="px" /></Row>
            <Row label="右侧面板宽度"><Slider value={settings.rightPanelWidth} min={200} max={400} step={10} onChange={v => save('rightPanelWidth', v)} unit="px" /></Row>
          </Section>
        </>}

        {active === 'ai' && <>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 24 }}>AI 设置</div>
          <AiSettings />
        </>}

        {active === 'shortcuts' && <>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 24 }}>快捷键</div>
          <ShortcutsSettings />
        </>}

        {active === 'data' && <>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 24 }}>数据管理</div>
          <DataSettings />
        </>}

        {active === 'about' && <>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 24 }}>关于</div>
          <div style={{ textAlign: 'center', padding: '24px 0 40px' }}>
            <div style={{ width: 80, height: 80, borderRadius: 22, margin: '0 auto 18px', background: 'linear-gradient(145deg, #c8a96e, #7a4e20)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 38, color: '#fff', fontFamily: 'var(--font-serif)', boxShadow: '0 16px 48px rgba(200,169,110,0.2)' }}>文</div>
            <div style={{ fontSize: 24, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6, fontFamily: 'var(--font-serif)', letterSpacing: 4 }}>启文</div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 4 }}>版本 1.2.0</div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 20 }}>本地优先的知识管理与写作平台</div>
            <div style={{ display: 'inline-flex', gap: 8 }}>
              <a href="https://bitwool.cn/qiwen.html" target="_blank" rel="noreferrer" style={{ padding: '6px 16px', background: 'var(--bg-surface2)', border: '0.5px solid var(--border)', borderRadius: 20, fontSize: 12.5, color: 'var(--text-secondary)', textDecoration: 'none' }}>官方网站</a>
              <a href="https://github.com/qiwen-studio/qiwen" target="_blank" rel="noreferrer" style={{ padding: '6px 16px', background: 'var(--bg-surface2)', border: '0.5px solid var(--border)', borderRadius: 20, fontSize: 12.5, color: 'var(--text-secondary)', textDecoration: 'none' }}>GitHub</a>
              <a href="mailto:bitwool@163.com" style={{ padding: '6px 16px', background: 'var(--bg-surface2)', border: '0.5px solid var(--border)', borderRadius: 20, fontSize: 12.5, color: 'var(--text-secondary)', textDecoration: 'none' }}>反馈</a>
            </div>
          </div>
          <Section title="联系与支持">
            <Row label="官方网站"><a href="https://bitwool.cn" target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)' }}>bitwool.cn</a></Row>
            <Row label="意见反馈"><a href="mailto:bitwool@163.com" style={{ fontSize: 13, color: 'var(--accent)' }}>bitwool@163.com</a></Row>
            <Row label="问题追踪"><a href="https://github.com/qiwen-studio/qiwen/issues" target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)' }}>GitHub Issues</a></Row>
          </Section>
          <Section title="法律">
            <Row label="隐私政策"><a href="https://bitwool.cn/privacy.html" target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>查看 →</a></Row>
            <Row label="用户协议"><a href="https://bitwool.cn/terms.html" target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>查看 →</a></Row>
            <Row label="版权"><span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>© 2026 Bitwool 工作室</span></Row>
          </Section>
        </>}

        {active === 'license' && <>
          <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 24 }}>授权管理</div>
          <LicenseView />
        </>}

        {active === 'profile' && <UserProfileView />}
      </div>
    </div>
  );
};
