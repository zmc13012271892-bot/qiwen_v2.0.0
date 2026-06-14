import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { Workspace } from '../../../shared/types';
import { ipc } from '../../utils/ipc';

interface WorkspacesState {
  items: Workspace[];
  loading: boolean;
}

const initialState: WorkspacesState = { items: [], loading: false };

export const fetchWorkspaces = createAsyncThunk('workspaces/fetchAll', async () => {
  return ipc.invoke<Workspace[]>('workspaces:list');
});

export const createWorkspace = createAsyncThunk(
  'workspaces/create',
  async (payload: Partial<Workspace>) => {
    return ipc.invoke<Workspace>('workspaces:create', payload);
  }
);

export const deleteWorkspace = createAsyncThunk(
  'workspaces/delete',
  async (id: string) => {
    await ipc.invoke('workspaces:delete', { id });
    return id;
  }
);

const workspacesSlice = createSlice({
  name: 'workspaces',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchWorkspaces.pending, (state) => { state.loading = true; })
      .addCase(fetchWorkspaces.fulfilled, (state, action) => {
        state.loading = false;
        // ✅ 修复1: payload 为 null/undefined 时不覆盖，防止 .length 崩溃
        if (!Array.isArray(action.payload)) return;
        // ✅ 修复2: 按 id 去重，防止重复工作区堆积
        const seen = new Set<string>();
        state.items = action.payload.filter(w => {
          if (!w?.id || seen.has(w.id)) return false;
          seen.add(w.id);
          return true;
        });
      })
      .addCase(fetchWorkspaces.rejected, (state) => { state.loading = false; })
      .addCase(createWorkspace.fulfilled, (state, action) => {
        if (action.payload && !state.items.find(w => w.id === action.payload.id)) {
          state.items.push(action.payload);
        }
      })
      .addCase(deleteWorkspace.fulfilled, (state, action) => {
        state.items = state.items.filter(w => w.id !== action.payload);
      });
  },
});

export default workspacesSlice.reducer;
