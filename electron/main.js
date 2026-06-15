const { app, BrowserWindow, ipcMain, shell, dialog, Menu, nativeTheme } = require('electron');
const path = require('path');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
require('@electron/remote/main').initialize();

const isDev = process.env.NODE_ENV === 'development';
const fs = require('fs');

// ── userData 路径修正 + 旧路径数据迁移 ──────────────────────
// productName "启文" 导致 userData 含中文，fs 在部分 Windows 下无法正确读写
// 强制改为纯英文路径，并自动迁移旧版本的数据库文件
(function fixUserDataPath() {
  const newPath = isDev
    ? path.join(app.getPath('appData'), 'QiWen-dev')
    : path.join(app.getPath('appData'), 'QiWen');
  app.setPath('userData', newPath);

  // 迁移：若新路径没有 DB，但旧路径（启文）有 DB，则复制过来
  try {
    const newDb = path.join(newPath, 'data', 'qiwen.db');
    if (!fs.existsSync(newDb)) {
      // 尝试多个可能的旧路径（productName 可能是 启文 或其他）
      const appData = app.getPath('appData');
      const oldCandidates = [
        path.join(appData, '启文', 'data', 'qiwen.db'),
        path.join(appData, 'qiwen', 'data', 'qiwen.db'),
        path.join(appData, 'Qiwen', 'data', 'qiwen.db'),
      ];
      for (const oldDb of oldCandidates) {
        if (fs.existsSync(oldDb)) {
          const newDir = path.join(newPath, 'data');
          if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
          fs.copyFileSync(oldDb, newDb);
          // 写迁移标记
          fs.writeFileSync(path.join(newPath, 'migrated_from.txt'), oldDb);
          break;
        }
      }
    }
  } catch (e) {
    // 迁移失败不影响启动
  }
})();

log.transports.file.level = 'debug';
log.transports.console.level = 'debug';

// ── 日志文件路径和滚动配置 ──────────────────────────────
// 文件写入 userData/logs/qiwen-YYYY-MM-DD.log，保留最近 14 天
try {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  log.transports.file.resolvePathFn = () => path.join(logsDir, `qiwen-${dateStr}.log`);
  log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB 单文件上限
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

  // 清理 14 天前的旧日志
  try {
    const files = fs.readdirSync(logsDir);
    const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
    files.forEach(f => {
      const fp = path.join(logsDir, f);
      if (f.startsWith('qiwen-') && fs.statSync(fp).mtimeMs < cutoff) {
        fs.unlinkSync(fp);
      }
    });
  } catch {}
} catch (e) {
  // 路径初始化失败时降级为默认路径
}

// ── 主进程全局异常捕获 ──────────────────────────────────
process.on('uncaughtException', (err) => {
  log.error('[CRASH] uncaughtException:', err?.stack || err);
});
process.on('unhandledRejection', (reason) => {
  log.error('[CRASH] unhandledRejection:', reason instanceof Error ? reason.stack : reason);
});
autoUpdater.logger = log;

let mainWindow = null;
let db = null;

// ── 数据库 + IPC 全部注册 ─────────────────────────────────
let _saveDatabase = null;
let _closeDb = null;

async function initDB() {
  try {
    log.info('Starting DB initialization...');
    const dbModule = require('../src/main/database/db');
    db = await dbModule.initDatabase();
    _saveDatabase = dbModule.saveDatabase;
    _closeDb = dbModule.closeDb;
    log.info('Database initialized successfully');
    // 首次启动时异步重建 FTS 索引（不阻塞启动）
    setTimeout(() => {
      try {
        const { rebuildFtsIndex } = require('../src/main/database/db');
        rebuildFtsIndex();
      } catch (e) {
        log.warn('[FTS] initial rebuild failed (non-fatal):', e?.message);
      }
    }, 3000);

    const { registerDocumentHandlers }  = require('../src/main/ipc/documents');
    const { registerWorkspaceHandlers } = require('../src/main/ipc/workspaces');
    const { registerSettingsHandlers }  = require('../src/main/ipc/settings');
    const { registerReferenceHandlers } = require('../src/main/ipc/references');
    const { registerTemplateHandlers } = require('../src/main/ipc/templates');
    const { registerRdmHandlers }      = require('../src/main/ipc/rdm');
    const { registerPresentationHandlers } = require('../src/main/ipc/presentations');
    const { registerCanvasHandlers }       = require('../src/main/ipc/canvases');
    const { registerPomodoroHandlers }     = require('../src/main/ipc/pomodoro');
    const { registerLicenseHandlers }      = require('../src/main/ipc/license');

    registerDocumentHandlers();
    registerWorkspaceHandlers();
    registerSettingsHandlers();
    registerPresentationHandlers();
    registerCanvasHandlers();
    registerPomodoroHandlers();
    registerRdmHandlers(dbModule.getDb, dbModule.saveDatabase);
    registerLicenseHandlers();

    // 崩溃上报
    ipcMain.handle('crash:report', (_, data) => {
      try { dbModule.recordCrash(data); } catch {}
      return { ok: true };
    });

    // ── App State (文件级持久化，不依赖 sqlite) ──────────
    // 用于记录 onboarding 完成状态和最后使用的 workspaceId
    const stateFile = path.join(app.getPath('userData'), 'app-state.json');

    function readAppState() {
      try {
        if (fs.existsSync(stateFile)) {
          return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        }
      } catch {}
      return {};
    }

    function writeAppState(updates) {
      try {
        const current = readAppState();
        const merged = { ...current, ...updates };
        fs.writeFileSync(stateFile, JSON.stringify(merged), 'utf8');
        return true;
      } catch (e) {
        log.error('[app-state] write failed:', e);
        return false;
      }
    }

    ipcMain.handle('app:get-state', () => readAppState());
    ipcMain.handle('app:set-state', (_, updates) => writeAppState(updates));
    registerReferenceHandlers();
    registerTemplateHandlers();
    log.info('All IPC handlers registered successfully');

    // ── 首次运行判断（直接在主进程查DB，最可靠）─────────────
    ipcMain.handle('app:is-first-run', () => {
      try {
        const d = dbModule.getDb();
        // sql.js 用 stmt.step() 检查是否有行（stmt.all 不可靠）
        const stmt = d.prepare('SELECT id FROM workspaces LIMIT 1');
        const hasWorkspace = stmt.step();
        stmt.free();
        log.info('app:is-first-run hasWorkspace:', hasWorkspace);
        return !hasWorkspace; // false=有工作区=老用户，true=新用户显示引导页
      } catch (e) {
        log.error('app:is-first-run error:', e);
        return true;
      }
    });

    // ── AI API 代理（绕过渲染进程 CORS 限制）───────────────
    const https = require('https');
    const http  = require('http');

    ipcMain.handle('ai:chat-stream', async (event, { messages, apiKey, model }) => {
      return new Promise((resolve, reject) => {
        const effectiveModel = model || 'doubao-seed-2-0-pro-260215';
        const effectiveKey = apiKey || 'ark-0f0fd51c-1395-45bd-9df0-29a195257d96-5ab55';
        
        const body = JSON.stringify({
          model: effectiveModel,
          max_tokens: 4096,
          stream: false,
          messages,
        });

        log.info('[ai:chat-stream] Requesting model:', effectiveModel);

        const options = {
          hostname: 'ark.cn-beijing.volces.com',
          path: '/api/v3/chat/completions',
          method: 'POST',
          timeout: 120000, // 120秒超时（生成大量JSON内容需要更长时间）
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${effectiveKey}`,
            'Content-Length': Buffer.byteLength(body),
          },
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            try {
              log.info('[ai:chat-stream] Response status:', res.statusCode);
              const json = JSON.parse(data);
              if (json.error) {
                log.error('[ai:chat-stream] API error:', json.error);
                reject(new Error(json.error.message || `API错误: ${JSON.stringify(json.error)}`));
              } else {
                const content = json.choices?.[0]?.message?.content || '';
                log.info('[ai:chat-stream] Success, content length:', content.length);
                resolve(content);
              }
            } catch(e) {
              log.error('[ai:chat-stream] Parse error:', e, 'Raw data:', data.slice(0, 200));
              reject(new Error('响应解析失败: ' + e.message));
            }
          });
        });
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('请求超时（120秒），请检查网络连接'));
        });
        req.on('error', (err) => {
          log.error('[ai:chat-stream] Request error:', err);
          reject(new Error('网络请求失败: ' + err.message));
        });
        req.write(body);
        req.end();
      });
    });

    return true;
  } catch (err) {
    log.error('DB init failed:', err);
    // 主进程弹窗提示，让用户知道出了问题
    const { dialog } = require('electron');
    dialog.showErrorBox('启文启动失败', 
      `数据库初始化失败，请重新安装应用。\n\n错误：${err.message}`);
    return false;
  }
}

// ── 窗口创建 ──────────────────────────────────────────────
function createWindow() {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    center: true,
    maximizable: true,
    fullscreenable: true,
    // Windows上明确禁止启动时最大化
    ...(isWin ? { resizable: true } : {}),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 12 },
    backgroundColor: '#0a0a0f',
    vibrancy: isMac ? 'sidebar' : undefined,
    frame: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false, // 桌面应用不需要 web 安全限制
    },
  });

  require('@electron/remote/main').enable(mainWindow.webContents);

  const startURL = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../build/index.html')}`;

  mainWindow.loadURL(startURL);

  // 兜底：8秒内若 ready-to-show 未触发，强制显示窗口（防止白屏卡死）
  const showFallbackTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      log.warn('ready-to-show timeout, force showing window');
      mainWindow.show();
      mainWindow.center();
    }
  }, 8000);

  mainWindow.once('ready-to-show', () => {
    clearTimeout(showFallbackTimer);
    // 确保不是最大化状态再显示
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    mainWindow.show();
    mainWindow.center();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  // 捕获渲染进程崩溃，防止白屏无响应
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.error('Renderer process gone:', details.reason, details.exitCode);
    dialog.showErrorBox('启文崩溃', `渲染进程异常退出 (${details.reason})，请重新启动应用。`);
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log.error('Page failed to load:', errorCode, errorDescription, validatedURL);
    if (!isDev) {
      // 生产环境加载失败：尝试重新加载一次
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          log.info('Retrying page load...');
          mainWindow.loadURL(startURL);
        }
      }, 1000);
    }
  });
  // ── 关闭前等待 renderer 把未保存内容写入 DB ──────────────
  let isReallyClosing = false;
  let isWaitingForFlush = false;  // 防止重复注册 flush-complete 监听器

  mainWindow.on('close', (e) => {
    if (isReallyClosing) return;
    e.preventDefault();

    // 避免重复触发（用户快速多次点关闭）
    if (isWaitingForFlush) return;
    isWaitingForFlush = true;

    // 通知 renderer flush 所有未保存内容
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('app-before-close');
    }

    // 超时兜底：5秒后强制写盘关闭
    const forceClose = setTimeout(() => {
      log.warn('Save timeout - force save and close');
      try { if (_saveDatabase) _saveDatabase(); } catch(e) { log.error(e); }
      isReallyClosing = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    }, 5000);

    // renderer 保存完成 → 写磁盘 → 关闭
    // renderer 的 autoSave.flushAll() 会等待所有 documents:update IPC 返回后
    // 才发 flush-complete，所以此时 DB 内存已经是最新的，直接 saveDatabase 写盘即可
    ipcMain.once('flush-complete', () => {
      clearTimeout(forceClose);
      try { if (_saveDatabase) _saveDatabase(); } catch(e) { log.error(e); }
      isReallyClosing = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    });
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  setupMenu();
  setupIPC();
  setupAutoUpdater();
}

// ── 菜单 ──────────────────────────────────────────────────
function setupMenu() {
  const isMac = process.platform === 'darwin';
  const send = (ch) => () => mainWindow?.webContents.send(ch);
  const template = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about', label: '关于启文' }, { type: 'separator' },
      { label: '偏好设置', accelerator: 'Cmd+,', click: send('open-settings') },
      { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit', label: '退出启文' },
    ]}] : []),
    { label: '文件', submenu: [
      { label: '新建文档', accelerator: 'CmdOrCtrl+N', click: send('new-document') },
      { label: '新建窗口', accelerator: 'CmdOrCtrl+Shift+N', click: createWindow },
      { type: 'separator' },
      { label: '保存', accelerator: 'CmdOrCtrl+S', click: send('save-document') },
      { type: 'separator' },
      { label: '导出 PDF', click: send('export-pdf') },
      ...(!isMac ? [{ type: 'separator' }, { role: 'quit', label: '退出' }] : []),
    ]},
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
      { type: 'separator' },
      { label: '查找', accelerator: 'CmdOrCtrl+F', click: send('find-replace') },
    ]},
    { label: '视图', submenu: [
      { label: '切换侧边栏', accelerator: 'CmdOrCtrl+\\', click: send('toggle-sidebar') },
      { label: '专注模式', accelerator: 'CmdOrCtrl+Shift+F', click: send('focus-mode') },
      { type: 'separator' },
      { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'resetZoom', label: '实际大小' },
      { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' },
    ]},
    { label: '帮助', submenu: [
      { label: '键盘快捷键', click: send('show-shortcuts') },
      { label: '官方网站', click: () => shell.openExternal('https://qiwen.studio') },
      ...(!isMac ? [{ label: '关于启文', click: () => dialog.showMessageBox(mainWindow, {
        title: '关于启文', message: '启文 v1.0.0\n启于思，行于文\n\n© 2024 启文团队',
      })}] : []),
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── 系统级 IPC ────────────────────────────────────────────
function setupIPC() {

  // ── 接收渲染进程上报的日志 ────────────────────────────
  ipcMain.handle('logger:write', (_, { level, tag, message, data }) => {
    const prefix = `[RENDERER]${tag ? '[' + tag + ']' : ''}`;
    const dataStr = data ? ' ' + (typeof data === 'string' ? data : JSON.stringify(data)) : '';
    switch (level) {
      case 'error': log.error(prefix, message + dataStr); break;
      case 'warn':  log.warn(prefix,  message + dataStr); break;
      case 'debug': log.debug(prefix, message + dataStr); break;
      default:      log.info(prefix,  message + dataStr);
    }
    return true;
  });

  // ── 获取日志文件路径（用于「在 Finder/Explorer 中显示」）
  ipcMain.handle('logger:get-path', () => {
    try {
      const logsDir = path.join(app.getPath('userData'), 'logs');
      const dateStr = new Date().toISOString().slice(0, 10);
      return path.join(logsDir, `qiwen-${dateStr}.log`);
    } catch { return null; }
  });

  // ── 在文件管理器中打开日志目录 ───────────────────────
  ipcMain.handle('logger:open-dir', () => {
    try {
      const logsDir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      shell.openPath(logsDir);
    } catch {}
  });

  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-app-path',    () => app.getPath('userData'));
  ipcMain.handle('get-platform',    () => process.platform);

  // ── 导出 docx ───────────────────────────────────────────────
  // ── PDF 导出 ───────────────────────────────────────────
  ipcMain.handle('documents:export-pdf', async (event, { id, title, html, theme = 'light', pageSize = 'A4', includeTitle = true, includeMeta = false, meta = {} }) => {
    try {
      const { dialog } = require('electron');
      const path = require('path');
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: '导出 PDF',
        defaultPath: path.join(require('os').homedir(), 'Downloads', `${title}.pdf`),
        filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
      });
      if (!filePath) return { success: false, reason: 'cancelled' };

      // 用 Electron 的 webContents.printToPDF 生成 PDF
      const printWin = new BrowserWindow({
        show: false,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      const metaBlock = includeMeta ? `<div style="margin-bottom:24px;padding:10px 14px;border-radius:6px;font-size:12px;opacity:.6">字数：${meta.wordCount||0} &nbsp;·&nbsp; 导出时间：${meta.exportTime||''}</div>` : '';
      const fullHtml = `<!DOCTYPE html><html lang="zh-CN"><head>
        <meta charset="UTF-8">
        <title>${title}</title>
        <style>
          ${theme === 'dark' ? 'body{background:#141414;color:#e0ddd8}pre,code{background:#1e1e1e}blockquote{border-color:#c8a96e;color:#9a9890}th{background:#1e1e1e}th,td{border-color:#2a2a2a}' : theme === 'elegant' ? 'body{background:#faf7f2;color:#2a2318}pre,code{background:#f0ece3}blockquote{border-color:#c8a96e;color:#7a7060}th{background:#f0ece3}th,td{border-color:#e0d8cc}' : 'body{background:#fff;color:#1a1a1a}pre,code{background:#f5f5f5}blockquote{border-color:#c8a96e;color:#666}th{background:#f9f9f9}th,td{border-color:#ddd}'}
          body { font-family: 'PingFang SC', 'Microsoft YaHei', serif; max-width: 800px; margin: 40px auto; line-height: 1.85; font-size: 14px; }
          h1 { font-size: 2em; font-weight: 300; margin: 0 0 0.6em; border-bottom: 1px solid; padding-bottom: 0.3em; opacity:.85; }
          h2 { font-size: 1.5em; margin: 1.4em 0 0.4em; }
          h3 { font-size: 1.2em; margin: 1.2em 0 0.3em; }
          p { margin: 0 0 0.8em; }
          pre { padding: 12px 16px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
          code { padding: 2px 5px; border-radius: 3px; font-size: 0.9em; font-family: 'Courier New', monospace; }
          blockquote { border-left: 3px solid; padding: 4px 0 4px 16px; margin: 1em 0; }
          table { border-collapse: collapse; width: 100%; margin: 1em 0; }
          th, td { border: 1px solid; padding: 8px 12px; text-align: left; }
          th { font-weight: 500; }
          img { max-width: 100%; }
          @media print { body { margin: 20mm; } }
        </style>
      </head><body>${includeTitle ? `<h1>${title}</h1>` : ''}${metaBlock}${html}</body></html>`;

      await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`);
      await new Promise(r => setTimeout(r, 800)); // 等待渲染

      const pdfData = await printWin.webContents.printToPDF({
        printBackground: true,
        pageSize: pageSize || 'A4',
        margins: { top: 20, bottom: 20, left: 20, right: 20 },
      });
      printWin.close();

      require('fs').writeFileSync(filePath, pdfData);
      log.info('[export-pdf] Saved to:', filePath);
      shell.showItemInFolder(filePath);
      return { success: true, filePath };
    } catch (e) {
      log.error('[export-pdf] Failed:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('documents:export-docx', async (event, { id, title, html }) => {
    // 打开系统"另存为"对话框
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '另存为 Word 文档',
      defaultPath: `${title || '无标题'}.docx`,
      filters: [
        { name: 'Word 文档', extensions: ['docx'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) return { canceled: true };

    const filePath = result.filePath;

    try {
      // 用 htmlDocx 或手动构建最小 docx（Word XML 格式）
      // 这里使用纯 Node.js 内置方式，不依赖额外 npm 包：
      // 将 HTML 转换为 Word XML 并打包成 docx（Open XML 格式）
      const fs = require('fs');
      const path = require('path');
      const JSZip = require('jszip'); // electron-builder 里通常已包含

      // 把 HTML 转成基础 Word XML
      const wordXml = htmlToWordXml(html, title);

      // 构建最小 docx 结构
      const zip = new JSZip();

      zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`);

      zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

      zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

      zip.file('word/styles.xml', getWordStyles());
      zip.file('word/document.xml', wordXml);

      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      fs.writeFileSync(filePath, buf);
      log.info('[export-docx] Saved to:', filePath);
      return { success: true, filePath };
    } catch (err) {
      // JSZip 不可用时，降级写一个 Word XML 格式的 .docx（部分 Word 版本可以打开）
      try {
        const fs = require('fs');
        const wordXml = htmlToWordXml(html, title);
        fs.writeFileSync(filePath, wordXml, 'utf8');
        return { success: true, filePath };
      } catch (e2) {
        log.error('[export-docx] Failed:', e2);
        throw e2;
      }
    }
  });

  // 将 HTML 字符串转为 Word XML 段落
  function htmlToWordXml(html, title) {
    // 去除 HTML 标签，保留文本和基本换行
    const stripTags = (s) => s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"');

    const text = stripTags(html || '');
    const paragraphs = text.split('\n').filter(l => l.trim());

    const xmlEscape = (s) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    const paras = paragraphs.map(line =>
      `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line.trim())}</w:t></w:r></w:p>`
    ).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>${xmlEscape(title || '无标题')}</w:t></w:r>
    </w:p>
    ${paras}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;
  }

  function getWordStyles() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>
  </w:style>
</w:styles>`;
  }

  ipcMain.handle('show-save-dialog', async (_, o) => dialog.showSaveDialog(mainWindow, o));

  // 写文件（供 renderer 导出 md/txt/html 时使用）
  ipcMain.handle('fs:write-file', async (_, { path: filePath, content: fileContent }) => {
    try {
      require('fs').writeFileSync(filePath, fileContent, 'utf8');
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch (err) {
      log.error('[fs:write-file] failed:', err);
      return { success: false, error: String(err) };
    }
  });

  // 读文件（代码查看器使用）
  ipcMain.handle('fs:read-file', async (_, { path: filePath }) => {
    try {
      const content = require('fs').readFileSync(filePath, 'utf-8');
      return { content };
    } catch (err) {
      log.error('[fs:read-file] failed:', err);
      return { content: '', error: String(err) };
    }
  });

  // 列出目录内容（文件树使用）
  ipcMain.handle('fs:list-dir', async (_, { path: dirPath }) => {
    try {
      const fs = require('fs');
      const path = require('path');
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries.map((e) => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        isDir: e.isDirectory(),
      }));
    } catch (err) {
      log.error('[fs:list-dir] failed:', err);
      return [];
    }
  });

  // 打开代码文件选择对话框
  ipcMain.handle('fs:open-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '代码文件', extensions: ['ts','tsx','js','jsx','py','go','rs','java','cpp','c','cs','rb','swift','kt','php','md','json','yaml','yml','toml','sql','sh','bash','html','css','scss','vue','svelte','xml'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('show-open-dialog', async (_, o) => dialog.showOpenDialog(mainWindow, o));

  // ── 图片本地上传 ───────────────────────────────────────
  ipcMain.handle('image:upload-local', async (event) => {
    try {
      const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
        title: '选择图片',
        filters: [{ name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
        properties: ['openFile'],
      });
      if (canceled || !filePaths.length) return { success: false, reason: 'cancelled' };

      const filePath = filePaths[0];
      const fs = require('fs');
      const path = require('path');
      const ext = path.extname(filePath).toLowerCase().slice(1);
      const mimeMap = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp' };
      const mime = mimeMap[ext] || 'image/png';

      const data = fs.readFileSync(filePath);
      const base64 = data.toString('base64');
      const dataUrl = `data:${mime};base64,${base64}`;

      return { success: true, dataUrl, fileName: path.basename(filePath) };
    } catch (e) {
      log.error('[image:upload-local]', e);
      return { success: false, error: String(e) };
    }
  });
  // ── 数据导入 ─────────────────────────────────────────────

  // 选择导入文件夹或文件
  ipcMain.handle('import:pick-folder', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '选择要导入的文件夹（Obsidian vault / Typora 文件夹）',
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths.length) return null;
    return filePaths[0];
  });

  ipcMain.handle('import:pick-files', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '选择要导入的 Markdown / 文本文件',
      filters: [
        { name: 'Markdown & 文本', extensions: ['md', 'markdown', 'txt'] },
        { name: '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile', 'multiSelections'],
    });
    if (canceled || !filePaths.length) return [];
    return filePaths;
  });

  // 扫描文件夹，返回所有 .md/.txt 文件列表（含相对路径）
  ipcMain.handle('import:scan-folder', async (_, { folderPath }) => {
    const fs = require('fs');
    const path = require('path');
    const results = [];

    function walk(dir, base) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        // 跳过隐藏目录和 Obsidian 配置目录
        if (e.name.startsWith('.') || e.name === '_resources' || e.name === 'assets') continue;
        const full = path.join(dir, e.name);
        const rel  = path.join(base, e.name);
        if (e.isDirectory()) {
          walk(full, rel);
        } else if (/\.(md|markdown|txt)$/i.test(e.name)) {
          const stat = fs.statSync(full);
          results.push({
            fullPath: full,
            relativePath: rel,
            name: e.name,
            title: e.name.replace(/\.(md|markdown|txt)$/i, ''),
            sizeBytes: stat.size,
            modifiedAt: stat.mtimeMs,
          });
        }
      }
    }
    walk(folderPath, '');
    return results;
  });

  // 读取单个文件内容，转为 HTML（Markdown → HTML）
  ipcMain.handle('import:read-file', async (_, { filePath }) => {
    const fs = require('fs');
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      // 简单 Markdown → HTML（服务端转换，避免渲染器依赖）
      const html = markdownToHtml(raw);
      return { success: true, content: html, raw };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  // ── 简单 Markdown → HTML 转换（在主进程执行，支持所有平台）
  function markdownToHtml(md) {
    let html = md
      // 提取 front matter
      .replace(/^---[\s\S]*?---\n?/, '')
      // 标题
      .replace(/^#{6}\s+(.+)$/gm, '<h6>$1</h6>')
      .replace(/^#{5}\s+(.+)$/gm, '<h5>$1</h5>')
      .replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>')
      .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
      .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
      .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
      // 代码块（先处理，防止内容被其他规则替换）
      .replace(/```([\w]*)\n([\s\S]*?)```/gm, '<pre><code class="language-$1">$2</code></pre>')
      // 行内代码
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // 加粗斜体
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      // 删除线
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      // 链接和图片
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // wikilink → 保留为 [[title]] 格式（启文会识别）
      .replace(/\[\[([^\]]+)\]\]/g, '[[$1]]')
      // 引用块
      .replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')
      // 任务列表
      .replace(/^- \[x\]\s+(.+)$/gim, '<li data-checked="true">$1</li>')
      .replace(/^- \[ \]\s+(.+)$/gim, '<li data-checked="false">$1</li>')
      // 无序列表
      .replace(/^[\*\-]\s+(.+)$/gm, '<li>$1</li>')
      // 有序列表
      .replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>')
      // 分割线
      .replace(/^[-*_]{3,}$/gm, '<hr>')
      // 段落（连续空行分段）
      .split(/\n{2,}/)
      .map(block => {
        block = block.trim();
        if (!block) return '';
        if (/^<(h[1-6]|blockquote|pre|hr|ul|ol|li)/.test(block)) return block;
        if (block.includes('<li>')) return '<ul>' + block + '</ul>';
        return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
      })
      .join('\n');
    return html;
  }

  // 全量导出为 Markdown
  ipcMain.handle('export:all-markdown', async (_, { workspaceId }) => {
    const fs = require('fs');
    const path = require('path');
    const { filePaths: [folder], canceled } = await dialog.showOpenDialog(mainWindow, {
      title: '选择导出文件夹', properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !folder) return { success: false };
    try {
      const db = getDb();
      // 获取所有文档
      const docStmt = db.prepare('SELECT d.id, d.title, dc.content FROM documents d LEFT JOIN document_contents dc ON dc.document_id = d.id WHERE d.workspace_id = ? AND d.is_folder = 0 AND d.is_archived = 0');
      docStmt.bind([workspaceId]);
      const docs = [];
      while (docStmt.step()) docs.push(docStmt.getAsObject());
      docStmt.reset(); docStmt.free();

      let count = 0;
      for (const doc of docs) {
        const title = (doc.title || 'untitled').toString().replace(/[/\\:*?"<>|]/g, '_');
        const content = (doc.content || '').toString().replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        const filePath = path.join(folder, title + '.md');
        fs.writeFileSync(filePath, `# ${doc.title}\n\n${content}`, 'utf-8');
        count++;
      }
      return { success: true, count, folder };
    } catch (e) {
      log.error('[export:all-markdown]', e);
      return { success: false, error: String(e) };
    }
  });

  // 获取数据库路径（供设置页显示）
  ipcMain.handle('app:get-db-path', () => {
    try { return getDbPath(); } catch { return ''; }
  });

  ipcMain.handle('show-message-box', async (_, o) => dialog.showMessageBox(mainWindow, o));
  ipcMain.handle('open-external',    async (_, url) => shell.openExternal(url));
  ipcMain.handle('get-theme',        () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

  ipcMain.on('set-title',           (_, t) => mainWindow?.setTitle(t));
  ipcMain.on('window-minimize',     () => mainWindow?.minimize());
  ipcMain.on('window-maximize',     () => mainWindow?.isMaximized() ? mainWindow.restore() : mainWindow?.maximize());
  ipcMain.on('window-close',        () => mainWindow?.close());
  ipcMain.on('toggle-always-on-top',() => mainWindow?.setAlwaysOnTop(!mainWindow?.isAlwaysOnTop()));

  nativeTheme.on('updated', () =>
    mainWindow?.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  );
}

// ── 自动更新 ──────────────────────────────────────────────
function setupAutoUpdater() {
  if (isDev) return;
  // 用 try-catch 防止 app-update.yml 缺失时抛出 unhandledRejection 崩溃
  try {
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      log.warn('[updater] checkForUpdatesAndNotify failed (non-fatal):', err?.message || err);
    });
    autoUpdater.on('update-available', () => mainWindow?.webContents.send('update-available'));
    autoUpdater.on('update-downloaded', () => mainWindow?.webContents.send('update-downloaded'));
    autoUpdater.on('error', (err) => {
      log.warn('[updater] error (non-fatal):', err?.message || err);
    });
    // 渲染层触发立即安装
    ipcMain.handle('app:install-update', () => {
      autoUpdater.quitAndInstall(false, true);
    });
  } catch (err) {
    log.warn('[updater] setup failed (non-fatal):', err?.message || err);
  }
}

// ── 启动 ──────────────────────────────────────────────────
// ── 性能优化：限制 V8 堆大小，避免内存无限增长 ──────────────────
// 对桌面写作应用，512MB 堆内存足够，防止内存泄漏时吃满物理内存
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
// 禁用不必要的 GPU 特性（写作应用不需要 WebGL/硬件加速）
app.commandLine.appendSwitch('disable-features', 'UseOzonePlatform,WebRtcHideLocalIpsWithMdns');
// 减少渲染进程内存占用
app.commandLine.appendSwitch('renderer-process-limit', '1');

app.whenReady().then(async () => {
  const dbOk = await initDB();
  if (!dbOk) {
    // DB 初始化失败已在 initDB 里弹出错误框，直接退出
    log.error('DB init failed, quitting');
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  try {
    if (_saveDatabase) _saveDatabase(); // 先写磁盘
    if (_closeDb) _closeDb();           // 再关闭
    else if (db) db.close();
  } catch (e) { log.error('Error on quit:', e); }
});
process.on('uncaughtException', (err) => log.error('Uncaught:', err));
process.on('unhandledRejection', (r) => log.error('Rejection:', r));
