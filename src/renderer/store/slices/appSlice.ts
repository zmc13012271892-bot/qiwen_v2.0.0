import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type View = 'home' | 'workbench' | 'library' | 'references' | 'plugins' | 'settings' | 'ai' | 'templates' | 'cloudSync' | 'slides' | 'whiteboard' | 'mindmap' | 'stats' | 'graph' | 'code' | 'org';

interface Tab {
  id: string;
  documentId: string;
  title: string;
  isDirty: boolean;
}

interface AppState {
  activeView: View;
  activeWorkspaceId: string | null;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelTab: 'outline' | 'links' | 'stats' | 'ai' | 'plugins';
  focusMode: boolean;
  tabs: Tab[];
  activeTabId: string | null;
  searchOpen: boolean;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  aiPanelOpen: boolean;
  commandPaletteOpen: boolean;
  isLoading: boolean;
  notification: { type: 'success' | 'error' | 'info' | 'warning'; message: string } | null;
}

const initialState: AppState = {
  activeView: 'home',
  activeWorkspaceId: null,
  sidebarOpen: true,
  rightPanelOpen: true,
  rightPanelTab: 'outline',
  focusMode: false,
  tabs: [],
  activeTabId: null,
  searchOpen: false,
  settingsOpen: false,
  shortcutsOpen: false,
  aiPanelOpen: false,
  commandPaletteOpen: false,
  isLoading: false,
  notification: null,
};

const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setView: (state, action: PayloadAction<View>) => {
      state.activeView = action.payload;
    },
    setActiveWorkspace: (state, action: PayloadAction<string>) => {
      state.activeWorkspaceId = action.payload;
    },
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload;
    },
    toggleRightPanel: (state) => {
      state.rightPanelOpen = !state.rightPanelOpen;
    },
    setRightPanelTab: (state, action: PayloadAction<AppState['rightPanelTab']>) => {
      state.rightPanelTab = action.payload;
      state.rightPanelOpen = true;
    },
    toggleFocusMode: (state) => {
      state.focusMode = !state.focusMode;
      if (state.focusMode) {
        // 进入专注模式：隐藏侧边栏
        state.sidebarOpen = false;
        state.rightPanelOpen = false;
      } else {
        // 退出专注模式：恢复侧边栏
        state.sidebarOpen = true;
      }
    },
    openTab: (state, action: PayloadAction<{ documentId: string; title: string }>) => {
      const { documentId, title } = action.payload;
      const existing = state.tabs.find(t => t.documentId === documentId);
      if (existing) {
        state.activeTabId = existing.id;
        return;
      }
      const tab: Tab = { id: documentId, documentId, title, isDirty: false };
      state.tabs.push(tab);
      state.activeTabId = tab.id;
    },
    closeTab: (state, action: PayloadAction<string>) => {
      const idx = state.tabs.findIndex(t => t.id === action.payload);
      state.tabs = state.tabs.filter(t => t.id !== action.payload);
      if (state.activeTabId === action.payload) {
        if (state.tabs.length > 0) {
          const newIdx = Math.max(0, idx - 1);
          state.activeTabId = state.tabs[newIdx]?.id || null;
        } else {
          state.activeTabId = null;
        }
      }
    },
    setActiveTab: (state, action: PayloadAction<string>) => {
      state.activeTabId = action.payload;
    },
    markTabDirty: (state, action: PayloadAction<{ id: string; dirty: boolean }>) => {
      const tab = state.tabs.find(t => t.id === action.payload.id);
      if (tab) tab.isDirty = action.payload.dirty;
    },
    updateTabTitle: (state, action: PayloadAction<{ id: string; title: string }>) => {
      const tab = state.tabs.find(t => t.id === action.payload.id);
      if (tab) tab.title = action.payload.title;
    },
    setSearchOpen: (state, action: PayloadAction<boolean>) => {
      state.searchOpen = action.payload;
    },
    setSettingsOpen: (state, action: PayloadAction<boolean>) => {
      state.settingsOpen = action.payload;
    },
    setShortcutsOpen: (state, action: PayloadAction<boolean>) => {
      state.shortcutsOpen = action.payload;
    },
    setAIPanelOpen: (state, action: PayloadAction<boolean>) => {
      state.aiPanelOpen = action.payload;
    },
    setCommandPaletteOpen: (state, action: PayloadAction<boolean>) => {
      state.commandPaletteOpen = action.payload;
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    showNotification: (state, action: PayloadAction<AppState['notification']>) => {
      state.notification = action.payload;
    },
    clearNotification: (state) => {
      state.notification = null;
    },
  },
});

export const {
  setView, setActiveWorkspace, toggleSidebar, setSidebarOpen,
  toggleRightPanel, setRightPanelTab, toggleFocusMode,
  openTab, closeTab, setActiveTab, markTabDirty, updateTabTitle,
  setSearchOpen, setSettingsOpen, setShortcutsOpen, setAIPanelOpen, setCommandPaletteOpen,
  setLoading, showNotification, clearNotification,
} = appSlice.actions;

export default appSlice.reducer;
