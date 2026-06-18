import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../../store';
import { createWorkspace } from '../../store/slices/workspacesSlice';
import type { ProfessionType } from '@shared/types';
import { setActiveWorkspace } from '../../store/slices/appSlice';
import { setPlugins } from '../../store/slices/pluginsSlice';
import { getPluginsForProfession } from '../../plugins/pluginRegistry';
import { ipc } from '../../utils/ipc';

const PROFESSIONS: { id: ProfessionType; icon: string; label: string; desc: string }[] = [
  { id: 'researcher', icon: '🔬', label: '学术研究', desc: '论文写作、文献管理' },
  { id: 'writer',     icon: '✍️', label: '内容创作', desc: '文章、故事、脚本' },
  { id: 'lawyer',     icon: '⚖️', label: '法律工作', desc: '合同、案例、研究' },
  { id: 'teacher',    icon: '📚', label: '教育培训', desc: '课程、教案、教材' },
  { id: 'doctor',     icon: '🩺', label: '医疗健康', desc: '病历、研究、报告' },
  { id: 'general',    icon: '💡', label: '通用知识', desc: '笔记、思考、规划' },
];

const STEPS = ['欢迎', '职业', '工作区', '主题', '完成'];

const THEMES_ONBOARD = [
  { id: 'dark',    label: '暗金',   bg: '#0a0a0f', ac: '#c8a96e', desc: '温暖的深色，默认推荐' },
  { id: 'minimal', label: '极简',   bg: '#fafaf8', ac: '#3d3d3d', desc: '干净的浅色风格' },
  { id: 'ocean',   label: '海洋',   bg: '#0a1628', ac: '#64ffda', desc: '清冷的蓝色夜间' },
];

// Color palette — warm neutral, matches the app's warm-beige theme
const C = {
  bg: '#faf9f7',
  surface: '#ffffff',
  border: 'rgba(0,0,0,0.08)',
  borderActive: 'rgba(180,130,60,0.45)',
  gold: '#b8853c',
  goldLight: '#d4a050',
  goldBg: 'rgba(180,130,60,0.08)',
  goldBgActive: 'rgba(180,130,60,0.13)',
  text: '#1a1814',
  textSub: '#6b6762',
  textMuted: '#a09c97',
  btnPrimary: 'linear-gradient(135deg, #c8963e, #a0700a)',
  btnSecondary: 'rgba(0,0,0,0.05)',
};

interface OnboardingPageProps {
  onComplete: () => void;
}

export const OnboardingPage: React.FC<OnboardingPageProps> = ({ onComplete }) => {
  const dispatch = useDispatch<AppDispatch>();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [selectedProfession, setSelectedProfession] = useState<ProfessionType>('researcher');
  const [workspaceName, setWorkspaceName] = useState('我的工作区');
  const [loading, setLoading] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState('dark');

  const goNext = () => { setDirection(1); setStep(s => s + 1); };
  const goPrev = () => { setDirection(-1); setStep(s => s - 1); };

  const handleFinish = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const ws = await dispatch(createWorkspace({
        name: workspaceName || '我的工作区',
        profession: selectedProfession,
        icon: PROFESSIONS.find(p => p.id === selectedProfession)?.icon || '📁',
      })).unwrap();
      dispatch(setActiveWorkspace(ws.id));
      ipc.invoke('app:set-state', { onboardingDone: true, lastWorkspaceId: ws.id }).catch(() => {});
      const professionPlugins = getPluginsForProfession(selectedProfession);
      dispatch(setPlugins(professionPlugins));
      try {
        const profileId = ws.id + '_user';
        await ipc.invoke('settings:set', { key: 'localProfile', value: { id: profileId, displayName: '本地用户' } });
      } catch {}
      // 创建示例文档，让用户第一次打开就有内容
      try {
        const { ipc } = await import('../../utils/ipc');
        const { store } = await import('../../store');
        const state = store.getState() as any;
        const wsId = state.app?.activeWorkspaceId;
        if (wsId) {
          const sampleContent = `<h1>欢迎使用启文 👋</h1>
<p>这是一篇示例文档，帮助你快速了解启文的核心功能。</p>
<h2>✍️ 富文本编辑</h2>
<p>启文基于 TipTap 编辑器，支持：</p>
<ul><li><strong>加粗</strong>、<em>斜体</em>、<u>下划线</u>、<s>删除线</s></li><li>表格、代码块、数学公式</li><li>图片、链接、任务清单</li></ul>
<h2>🤖 AI Copilot</h2>
<p>停止输入 1.2 秒后，AI 会自动续写建议。按 <code>Tab</code> 键接受，继续输入忽略。选中文字后还可以一键润色、翻译、扩写。</p>
<h2>👥 实时协作</h2>
<p>右下角绿点亮起时，团队成员可以同时编辑这篇文档，彼此的光标实时可见。</p>
<h2>⌨️ 快捷键</h2>
<ul><li><code>Ctrl+K</code> — 命令面板 / 搜索</li><li><code>Ctrl+B/I/U</code> — 加粗 / 斜体 / 下划线</li><li><code>Ctrl+S</code> — 手动触发保存</li><li><code>/</code> — 插入斜杠命令</li></ul>
<p>删除这篇文档，或者开始写你自己的内容。</p>`;
          await ipc.invoke('documents:create', {
            workspaceId: wsId,
            title: '欢迎使用启文 ✨',
            content: sampleContent,
            contentType: 'richtext',
          });
        }
      } catch {}
      onComplete();
    } catch (err) {
      console.error('Onboarding createWorkspace failed:', err);
      alert('初始化失败，请重试。');
    } finally {
      setLoading(false);
    }
  };

  // ── Step progress dots ──────────────────────────────────
  const ProgressDots = () => (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 32 }}>
      {STEPS.map((_, i) => (
        <div key={i} style={{
          height: 6, borderRadius: 3,
          width: i === step ? 22 : 6,
          background: i <= step ? C.gold : 'rgba(0,0,0,0.1)',
          transition: 'background var(--dur-slow) var(--ease-out-expo), transform var(--dur-slow) var(--ease-out-expo)',
        }} />
      ))}
    </div>
  );

  // ── Slides ──────────────────────────────────────────────
  const slides = [

    // Step 0 — Welcome
    <div key="welcome" style={{ textAlign: 'center' }}>
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          width: 88, height: 88, margin: '0 auto 28px',
          background: 'linear-gradient(145deg, #d4a850, #8b5c0a)',
          borderRadius: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 44, color: '#fff',
          fontFamily: '"Noto Serif SC", "STSong", serif',
          boxShadow: '0 12px 40px rgba(180,130,60,0.25), 0 2px 8px rgba(0,0,0,0.08)',
        }}
      >
        文
      </motion.div>

      <h1 style={{
        fontSize: 26, fontWeight: 600, color: C.text,
        marginBottom: 10, letterSpacing: -0.3,
        fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
      }}>
        欢迎使用启文
      </h1>
      <p style={{ fontSize: 14, color: C.textSub, lineHeight: 1.75, marginBottom: 6 }}>
        一款为深度创作者设计的本地优先知识管理工具
      </p>
      <p style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6 }}>
        接下来用 1 分钟完成个性化设置 →
      </p>

      {/* Feature pills */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 28 }}>
        {['📝 Markdown 编辑', '🔒 本地数据', '🤖 AI 助手', '🔬 科研管理'].map(f => (
          <span key={f} style={{
            padding: '5px 12px', borderRadius: 20, fontSize: 12,
            background: C.goldBg, color: C.gold,
            border: `1px solid rgba(180,130,60,0.2)`,
            fontWeight: 500,
          }}>{f}</span>
        ))}
      </div>
    </div>,

    // Step 1 — Profession
    <div key="profession">
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, color: C.text, marginBottom: 6 }}>您主要从事什么工作？</h2>
        <p style={{ fontSize: 13, color: C.textMuted }}>启文将根据选择优化功能布局</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {PROFESSIONS.map((p) => {
          const active = selectedProfession === p.id;
          return (
            <motion.div
              key={p.id}
              whileHover={{ y: -2, boxShadow: '0 6px 20px rgba(0,0,0,0.08)' }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setSelectedProfession(p.id)}
              style={{
                padding: '14px 10px', borderRadius: 12, cursor: 'pointer', textAlign: 'center',
                border: active ? `1.5px solid ${C.borderActive}` : `1px solid ${C.border}`,
                background: active ? C.goldBgActive : C.surface,
                transition: 'background var(--dur-base) var(--ease-smooth), transform var(--dur-base) var(--ease-smooth)',
                boxShadow: active ? '0 4px 16px rgba(180,130,60,0.12)' : '0 1px 4px rgba(0,0,0,0.04)',
              }}
            >
              <div style={{ fontSize: 26, marginBottom: 7 }}>{p.icon}</div>
              <div style={{
                fontSize: 13, fontWeight: 600, marginBottom: 3,
                color: active ? C.gold : C.text,
              }}>{p.label}</div>
              <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.4 }}>{p.desc}</div>
              {active && (
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', margin: '8px auto 0',
                  background: C.gold, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: '#fff', fontWeight: 700,
                }}>✓</div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>,

    // Step 2 — Workspace name
    <div key="workspace" style={{ textAlign: 'center' }}>
      <div style={{
        width: 64, height: 64, borderRadius: 18, margin: '0 auto 24px',
        background: C.goldBg, border: `1px solid rgba(180,130,60,0.2)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30,
      }}>
        {PROFESSIONS.find(p => p.id === selectedProfession)?.icon}
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 600, color: C.text, marginBottom: 6 }}>
        给工作区起个名字
      </h2>
      <p style={{ fontSize: 13, color: C.textMuted, marginBottom: 28, lineHeight: 1.6 }}>
        工作区是您组织所有文档的顶层空间，随时可以更改
      </p>

      <input
        value={workspaceName}
        onChange={e => setWorkspaceName(e.target.value)}
        placeholder="我的工作区"
        maxLength={50}
        autoFocus
        style={{
          width: '100%', padding: '13px 18px', fontSize: 15,
          background: C.surface,
          border: `1.5px solid rgba(180,130,60,0.35)`,
          borderRadius: 12, color: C.text, outline: 'none',
          fontFamily: 'inherit', textAlign: 'center',
          boxShadow: '0 0 0 3px rgba(180,130,60,0.08)',
          boxSizing: 'border-box',
        }}
      />

      {/* Preview card */}
      <div style={{
        marginTop: 16, padding: '12px 16px', borderRadius: 12,
        background: C.surface, border: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        textAlign: 'left',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: C.goldBg, border: `1px solid rgba(180,130,60,0.2)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
        }}>
          {PROFESSIONS.find(p => p.id === selectedProfession)?.icon}
        </div>
        <div>
          <div style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>
            {workspaceName || '我的工作区'}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            {PROFESSIONS.find(p => p.id === selectedProfession)?.label} · {PROFESSIONS.find(p => p.id === selectedProfession)?.desc}
          </div>
        </div>
      </div>
    </div>,

    // Step 3 — Done
    <div key="done" style={{ textAlign: 'center' }}>
      <motion.div
        initial={{ scale: 0, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        style={{
          width: 72, height: 72, borderRadius: '50%', margin: '0 auto 24px',
          background: 'rgba(60,180,100,0.1)',
          border: '1.5px solid rgba(60,180,100,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 30, color: '#3ab464',
        }}
      >
        ✓
      </motion.div>
      <h2 style={{ fontSize: 22, fontWeight: 600, color: C.text, marginBottom: 10 }}>
        一切就绪！
      </h2>
      <p style={{ fontSize: 14, color: C.textSub, lineHeight: 1.75, marginBottom: 6 }}>
        工作区 <span style={{ color: C.gold, fontWeight: 600 }}>「{workspaceName || '我的工作区'}」</span> 已创建完毕
      </p>
      <p style={{ fontSize: 13, color: C.textMuted }}>
        开始您的第一篇文档吧
      </p>

      {/* Quick tip */}
      <div style={{
        marginTop: 24, padding: '12px 16px', borderRadius: 12,
        background: C.goldBg, border: `1px solid rgba(180,130,60,0.18)`,
        textAlign: 'left',
      }}>
        <div style={{ fontSize: 12, color: C.gold, fontWeight: 600, marginBottom: 6 }}>💡 快速开始</div>
        <div style={{ fontSize: 12, color: C.textSub, lineHeight: 1.7 }}>
          点击左侧「+ 新建文档」开始创作，或使用 <kbd style={{ padding: '1px 5px', borderRadius: 4, background: C.surface, border: `1px solid ${C.border}`, fontSize: 11 }}>Ctrl+N</kbd> 快捷键
        </div>
      </div>
    </div>,
  ];

  return (
    <div style={{
      background: C.bg,
      borderRadius: 20,
      padding: '36px 40px 32px',
      minHeight: 520,
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.gold, letterSpacing: 0.5 }}>
          启文 · 快速设置
        </span>
        <span style={{ fontSize: 12, color: C.textMuted }}>
          第 {step + 1} / {STEPS.length} 步
        </span>
      </div>

      <ProgressDots />

      {/* Slide content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <AnimatePresence custom={direction} exitBeforeEnter>
          <motion.div
            key={step}
            custom={direction}
            initial={{ opacity: 0, x: direction * 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -40 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{ width: '100%' }}
          >
            {slides[step]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation buttons */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 32, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
        {step > 0 && step < 3 && (
          <button
            onClick={goPrev}
            style={{
              padding: '9px 22px', borderRadius: 9, cursor: 'pointer',
              border: `1px solid ${C.border}`,
              background: C.btnSecondary, color: C.textSub,
              fontSize: 13, fontFamily: 'inherit', fontWeight: 500,
              transition: 'background var(--dur-fast) var(--ease-smooth), border-color var(--dur-fast) var(--ease-smooth), color var(--dur-fast) var(--ease-smooth)',
            }}
          >← 上一步</button>
        )}

        {step < 3 && (
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={goNext}
            style={{
              padding: '9px 28px', borderRadius: 9, cursor: 'pointer',
              background: C.btnPrimary,
              color: '#fff', fontSize: 13, fontWeight: 600,
              border: 'none', fontFamily: 'inherit',
              boxShadow: '0 3px 12px rgba(180,130,60,0.28)',
              letterSpacing: 0.2,
            }}
          >
            {step === 0 ? '开始设置 →' : '下一步 →'}
          </motion.button>
        )}

        {step === 3 && (
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={handleFinish}
            disabled={loading}
            style={{
              padding: '11px 36px', borderRadius: 10, cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? 'rgba(180,130,60,0.5)' : C.btnPrimary,
              color: '#fff', fontSize: 14, fontWeight: 600,
              border: 'none', fontFamily: 'inherit',
              boxShadow: loading ? 'none' : '0 4px 16px rgba(180,130,60,0.3)',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'background var(--dur-base) var(--ease-smooth), border-color var(--dur-base) var(--ease-smooth), color var(--dur-base) var(--ease-smooth)',
            }}
          >
            {loading ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
                正在初始化...
              </>
            ) : '进入启文 →'}
          </motion.button>
        )}
      </div>
    </div>
  );
};
