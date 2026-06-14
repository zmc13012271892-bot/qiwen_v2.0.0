import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { cloudSync } from '../../services/cloudSync';

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatar: string;
  plan: string;
  isVerified: boolean;
}

interface AuthState {
  user: AuthUser | null;
  isLocalMode: boolean;
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  isLocalMode: true,
  isAuthenticated: false,
  loading: false,
  error: null,
};

// ── 云端注册 ──────────────────────────────────────────────
export const registerUser = createAsyncThunk(
  'auth/register',
  async (payload: { email: string; username: string; password: string; displayName: string }) => {
    const raw = await cloudSync.register(
      payload.email, payload.username, payload.password, payload.displayName
    );
    return {
      accessToken: 'cloud',
      user: {
        id: raw.id,
        email: raw.email,
        username: raw.username,
        displayName: raw.displayName || raw.username,
        avatar: raw.avatarColor || '#c8a96e',
        plan: raw.plan || 'free',
        isVerified: raw.isVerified ?? true,
      } as AuthUser,
    };
  }
);

// ── 云端登录 ──────────────────────────────────────────────
export const loginUser = createAsyncThunk(
  'auth/login',
  async (payload: { emailOrUsername: string; password: string; rememberMe: boolean }) => {
    const user = await cloudSync.login(payload.emailOrUsername, payload.password);
    return {
      accessToken: 'cloud',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatarColor || '#c8a96e',
        plan: user.plan,
        isVerified: user.isVerified ?? true,
      } as AuthUser,
    };
  }
);

// ── 自动恢复云端会话 ──────────────────────────────────────
export const refreshAccessToken = createAsyncThunk('auth/refresh', async () => {
  // 用 Supabase 获取当前会话（异步）
  const loggedIn = await cloudSync.isLoggedIn();
  if (!loggedIn) throw new Error('no session');
  const saved = await cloudSync.getSavedUser();
  if (!saved) throw new Error('no session');
  return {
    accessToken: 'cloud',
    user: {
      id: saved.id,
      email: saved.email,
      username: saved.username,
      displayName: saved.displayName,
      avatar: saved.avatarColor || '#c8a96e',
      plan: saved.plan,
      isVerified: true,
    } as AuthUser,
  };
});

// ── 登出 ──────────────────────────────────────────────────
export const logoutUser = createAsyncThunk('auth/logout', async () => {
  await cloudSync.logout();
});

// 兼容占位
export const fetchMe = createAsyncThunk('auth/me', async () => null);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    // 本地模式（不登录直接用）
    setLocalMode: (state, action: PayloadAction<{ id?: string; username?: string; displayName?: string; avatarColor?: string } | undefined>) => {
      state.isLocalMode = true;
      state.isAuthenticated = true;
      const adjectives = ['勤奋的','好奇的','安静的','快乐的','认真的','睿智的'];
      const nouns = ['作家','学者','研究者','创作者','思考者','探索者'];
      const rnd = (a: string[]) => a[Math.floor(Math.random() * a.length)];
      if (action?.payload?.id) {
        state.user = {
          id: action.payload.id,
          email: '',
          username: action.payload.username || '本地用户',
          displayName: action.payload.displayName || '本地用户',
          avatar: action.payload.avatarColor || '#c8a96e',
          plan: 'free',
          isVerified: false,
        };
      } else {
        state.user = {
          id: 'local_' + Date.now(),
          email: '',
          username: 'local',
          displayName: rnd(adjectives) + rnd(nouns),
          avatar: '#c8a96e',
          plan: 'free',
          isVerified: false,
        };
      }
    },
    clearAuth: (state) => {
      state.user = null;
      state.isAuthenticated = false;
      state.isLocalMode = false;
      state.error = null;
    },
  },
  extraReducers: (b) => {
    const handle = (thunk: any) => {
      b.addCase(thunk.pending, (s) => { s.loading = true; s.error = null; });
      b.addCase(thunk.fulfilled, (s, a) => {
        s.loading = false;
        if (a.payload?.user) {
          s.user = a.payload.user;
          s.isAuthenticated = true;
          s.isLocalMode = false;
        }
      });
      b.addCase(thunk.rejected, (s, a) => {
        s.loading = false;
        s.error = a.error.message || '操作失败';
      });
    };
    handle(loginUser);
    handle(registerUser);
    handle(refreshAccessToken);
    b.addCase(logoutUser.fulfilled, (s) => {
      s.user = null;
      s.isAuthenticated = false;
      s.isLocalMode = false;
      s.error = null;
    });
  },
});

export const { setLocalMode, clearAuth } = authSlice.actions;
export default authSlice.reducer;
