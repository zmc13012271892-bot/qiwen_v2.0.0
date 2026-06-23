import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { ipc } from '../../utils/ipc';

// ── 类型 ──────────────────────────────────────────────────────
export type SlideLayout = 'title' | 'content' | 'two-col' | 'image' | 'blank' | 'section';

export interface SlideContent {
  title?: string;
  subtitle?: string;
  body?: string;
  leftBody?: string;
  rightBody?: string;
  imageUrl?: string;
  imageCaption?: string;
  sectionLabel?: string;
  accentColor?: string;
  bgColor?: string;
  bgImage?: string;
  width?: number;
  height?: number;
}

export interface Slide {
  id: string;
  presentationId: string;
  sortOrder: number;
  layout: SlideLayout;
  content: SlideContent;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface Presentation {
  id: string;
  workspaceId: string;
  title: string;
  theme: 'dark' | 'light' | 'minimal' | 'vibrant';
  aspectRatio: '16:9' | '4:3';
  slideCount: number;
  slides: Slide[];
  createdAt: number;
  updatedAt: number;
}

interface PresentationMeta extends Omit<Presentation, 'slides'> {}

interface PresentationsState {
  items: PresentationMeta[];
  openPresentation: Presentation | null;
  activeSlideIndex: number;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

const initialState: PresentationsState = {
  items: [],
  openPresentation: null,
  activeSlideIndex: 0,
  loading: false,
  saving: false,
  error: null,
};

// ── Thunks ────────────────────────────────────────────────────
export const fetchPresentations = createAsyncThunk(
  'presentations/fetchAll',
  async (workspaceId: string) => {
    const result = await ipc.invoke<PresentationMeta[]>('presentations:list', { workspaceId });
    return result || [];
  }
);

export const fetchPresentation = createAsyncThunk(
  'presentations/fetchOne',
  async (id: string) => {
    const result = await ipc.invoke<Presentation>('presentations:get', { id });
    return result;
  }
);

export const createPresentation = createAsyncThunk(
  'presentations/create',
  async ({ workspaceId, title, theme }: { workspaceId: string; title: string; theme: string }) => {
    return ipc.invoke<Presentation>('presentations:create', { workspaceId, title, theme });
  }
);

export const updatePresentationMeta = createAsyncThunk(
  'presentations/updateMeta',
  async ({ id, title, theme, aspectRatio }: { id: string; title?: string; theme?: string; aspectRatio?: string }) => {
    await ipc.invoke('presentations:update-meta', { id, title, theme, aspectRatio });
    return { id, title, theme, aspectRatio };
  }
);

export const deletePresentation = createAsyncThunk(
  'presentations/delete',
  async (id: string) => {
    await ipc.invoke('presentations:delete', { id });
    return id;
  }
);

export const saveAllSlides = createAsyncThunk(
  'presentations/saveAllSlides',
  async ({ presentationId, slides }: { presentationId: string; slides: Slide[] }) => {
    await ipc.invoke('slides:save-all', { presentationId, slides });
    return { presentationId, slides };
  }
);

// ── Slice ─────────────────────────────────────────────────────
const presentationsSlice = createSlice({
  name: 'presentations',
  initialState,
  reducers: {
    setActiveSlideIndex: (state, action: PayloadAction<number>) => {
      state.activeSlideIndex = action.payload;
    },
    closePresentation: (state) => {
      state.openPresentation = null;
      state.activeSlideIndex = 0;
    },
    // 本地更新单张幻灯片内容（不立即写 DB，等 saveAllSlides）
    updateSlideLocal: (state, action: PayloadAction<{ index: number; changes: Partial<Slide> }>) => {
      if (!state.openPresentation) return;
      const { index, changes } = action.payload;
      const slide = state.openPresentation.slides[index];
      if (!slide) return;
      Object.assign(slide, changes);
      slide.updatedAt = Date.now();
    },
    // 添加新幻灯片（本地）
    addSlideLocal: (state, action: PayloadAction<{ afterIndex: number; slide: Slide }>) => {
      if (!state.openPresentation) return;
      const { afterIndex, slide } = action.payload;
      state.openPresentation.slides.splice(afterIndex + 1, 0, slide);
      // 重新计算 sortOrder
      state.openPresentation.slides.forEach((s, i) => { s.sortOrder = i; });
      state.openPresentation.slideCount = state.openPresentation.slides.length;
      state.activeSlideIndex = afterIndex + 1;
    },
    // 删除幻灯片（本地）
    deleteSlideLocal: (state, action: PayloadAction<number>) => {
      if (!state.openPresentation) return;
      const idx = action.payload;
      if (state.openPresentation.slides.length <= 1) return; // 至少保留一张
      state.openPresentation.slides.splice(idx, 1);
      state.openPresentation.slides.forEach((s, i) => { s.sortOrder = i; });
      state.openPresentation.slideCount = state.openPresentation.slides.length;
      state.activeSlideIndex = Math.min(idx, state.openPresentation.slides.length - 1);
    },
    // 移动幻灯片（拖拽重排）
    moveSlideLocal: (state, action: PayloadAction<{ from: number; to: number }>) => {
      if (!state.openPresentation) return;
      const { from, to } = action.payload;
      const slides = state.openPresentation.slides;
      const [moved] = slides.splice(from, 1);
      slides.splice(to, 0, moved);
      slides.forEach((s, i) => { s.sortOrder = i; });
      state.activeSlideIndex = to;
    },
    // 整体替换幻灯片数组（AI 对话式编辑确认应用时用）。
    // 跟 addSlideLocal/deleteSlideLocal 一样只改本地状态，落库仍然走 saveAllSlides，
    // 保持"本地状态先变、autosave 再persist"这个项目里已经established的模式。
    setAllSlidesLocal: (state, action: PayloadAction<Slide[]>) => {
      if (!state.openPresentation) return;
      state.openPresentation.slides = action.payload;
      state.openPresentation.slideCount = action.payload.length;
      state.activeSlideIndex = Math.min(state.activeSlideIndex, Math.max(0, action.payload.length - 1));
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchPresentations.fulfilled, (state, action) => {
        state.items = action.payload;
        state.loading = false;
      })
      .addCase(fetchPresentations.pending, (state) => { state.loading = true; })
      .addCase(fetchPresentations.rejected, (state) => { state.loading = false; })

      .addCase(fetchPresentation.fulfilled, (state, action) => {
        if (action.payload) {
          state.openPresentation = action.payload;
          state.activeSlideIndex = 0;
        }
        state.loading = false;
      })
      .addCase(fetchPresentation.pending, (state) => { state.loading = true; })
      .addCase(fetchPresentation.rejected, (state) => { state.loading = false; })

      .addCase(createPresentation.fulfilled, (state, action) => {
        if (action.payload) {
          const { slides, ...meta } = action.payload;
          state.items.unshift(meta);
          state.openPresentation = action.payload;
          state.activeSlideIndex = 0;
        }
      })

      .addCase(deletePresentation.fulfilled, (state, action) => {
        state.items = state.items.filter(p => p.id !== action.payload);
        if (state.openPresentation?.id === action.payload) {
          state.openPresentation = null;
        }
      })

      .addCase(updatePresentationMeta.fulfilled, (state, action) => {
        const { id, title, theme } = action.payload;
        const item = state.items.find(p => p.id === id);
        if (item) {
          if (title) item.title = title;
          if (theme) item.theme = theme as any;
        }
        if (state.openPresentation?.id === id) {
          if (title) state.openPresentation.title = title;
          if (theme) state.openPresentation.theme = theme as any;
        }
      })

      .addCase(saveAllSlides.pending,   (state) => { state.saving = true; })
      .addCase(saveAllSlides.fulfilled, (state) => { state.saving = false; })
      .addCase(saveAllSlides.rejected,  (state) => { state.saving = false; });
  },
});

export const {
  setActiveSlideIndex, closePresentation,
  updateSlideLocal, addSlideLocal, deleteSlideLocal, moveSlideLocal, setAllSlidesLocal,
} = presentationsSlice.actions;

export default presentationsSlice.reducer;
