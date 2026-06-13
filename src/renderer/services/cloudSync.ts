/**
 * cloudSync.ts — Supabase 版云同步服务
 * 替换 src/renderer/services/cloudSync.ts
 *
 * 职责：
 * - Auth（登录/注册/登出/会话恢复）
 * - 文档云端 CRUD（与本地 SQLite 双写）
 * - 组织/成员管理
 * - 实时协作订阅
 */
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

// ── 类型 ────────────────────────────────────────────────────────

export interface CloudUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string;
  plan: string;
  isVerified: boolean;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl?: string;
  plan: string;
  maxMembers: number;
}

export interface OrgMember {
  id: string;
  userId: string;
  organizationId: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  displayName: string;
  avatarColor: string;
  joinedAt: string;
  profile?: CloudUser;
}

export interface CloudDocument {
  id: string;
  workspaceId: string;
  parentId?: string;
  creatorId: string;
  title: string;
  contentType: string;
  isFolder: boolean;
  isPinned: boolean;
  isArchived: boolean;
  wordCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ── Auth ────────────────────────────────────────────────────────

async function register(email: string, password: string, displayName: string, username?: string): Promise<CloudUser> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { display_name: displayName, username: username || email.split('@')[0] },
    },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('注册失败');
  return toCloudUser(data.user);
}

async function login(email: string, password: string): Promise<CloudUser> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('登录失败');
  return toCloudUser(data.user);
}

async function loginWithSSO(provider: 'google' | 'github' | 'azure'): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: 'qiwen://auth/callback' },
  });
  if (error) throw new Error(error.message);
}

async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

async function getSession(): Promise<CloudUser | null> {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) return null;
  return toCloudUser(data.session.user);
}

async function getMe(): Promise<CloudUser | null> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  // 合并 user_profiles 里的扩展信息
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', data.user.id)
    .single();
  return toCloudUser(data.user, profile);
}

async function updateProfile(updates: { displayName?: string; avatarColor?: string; username?: string }): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('未登录');
  await supabase.from('user_profiles').update({
    display_name: updates.displayName,
    avatar_color: updates.avatarColor,
    username: updates.username,
    updated_at: new Date().toISOString(),
  }).eq('id', data.user.id);
}

// ── 组织管理 ────────────────────────────────────────────────────

async function createOrganization(name: string, slug: string): Promise<Organization> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('未登录');

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({ name, slug })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // 创建者自动成为 owner
  await supabase.from('organization_members').insert({
    organization_id: org.id,
    user_id: user.user.id,
    role: 'owner',
  });

  return toOrganization(org);
}

async function getMyOrganizations(): Promise<Organization[]> {
  const { data, error } = await supabase
    .from('organizations')
    .select(`*, organization_members!inner(user_id)`)
    .eq('organization_members.user_id', (await supabase.auth.getUser()).data.user?.id);
  if (error) throw new Error(error.message);
  return (data || []).map(toOrganization);
}

async function getOrgMembers(organizationId: string): Promise<OrgMember[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select(`*, user_profiles(*)`)
    .eq('organization_id', organizationId);
  if (error) throw new Error(error.message);
  return (data || []).map(toOrgMember);
}

async function inviteMember(organizationId: string, email: string, role: string): Promise<string> {
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('invitations')
    .insert({ organization_id: organizationId, email, role, invited_by: user.user?.id })
    .select('token')
    .single();
  if (error) throw new Error(error.message);
  return data.token;
}

async function acceptInvitation(token: string): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('请先登录');
  const { data: inv, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .single();
  if (error || !inv) throw new Error('邀请链接无效或已过期');
  // 加入组织
  await supabase.from('organization_members').insert({
    organization_id: inv.organization_id,
    user_id: user.user.id,
    role: inv.role,
    invited_by: inv.invited_by,
  });
  // 标记已接受
  await supabase.from('invitations').update({
    accepted_at: new Date().toISOString(),
    accepted_by: user.user.id,
  }).eq('token', token);
}

async function removeMember(organizationId: string, userId: string): Promise<void> {
  await supabase.from('organization_members')
    .delete()
    .eq('organization_id', organizationId)
    .eq('user_id', userId);
}

async function updateMemberRole(organizationId: string, userId: string, role: string): Promise<void> {
  await supabase.from('organization_members')
    .update({ role })
    .eq('organization_id', organizationId)
    .eq('user_id', userId);
}

// ── 文档云同步 ──────────────────────────────────────────────────

async function listDocuments(workspaceId: string, parentId?: string): Promise<CloudDocument[]> {
  let q = supabase.from('documents').select('*').eq('workspace_id', workspaceId).eq('is_archived', false);
  if (parentId) q = q.eq('parent_id', parentId);
  else q = q.is('parent_id', null);
  const { data, error } = await q.order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(toCloudDocument);
}

async function getDocument(id: string): Promise<CloudDocument & { content: string }> {
  const { data, error } = await supabase
    .from('documents')
    .select('*, document_contents(content)')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return { ...toCloudDocument(data), content: data.document_contents?.content || '' };
}

async function createDocument(doc: Partial<CloudDocument> & { content?: string }): Promise<CloudDocument> {
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('documents')
    .insert({
      workspace_id: doc.workspaceId,
      parent_id: doc.parentId || null,
      creator_id: user.user?.id,
      title: doc.title || '无标题',
      content_type: doc.contentType || 'markdown',
      is_folder: doc.isFolder || false,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  if (!doc.isFolder) {
    await supabase.from('document_contents').insert({ document_id: data.id, content: doc.content || '' });
  }
  return toCloudDocument(data);
}

async function updateDocument(id: string, updates: { title?: string; content?: string; wordCount?: number; isPinned?: boolean }): Promise<void> {
  if (updates.title !== undefined || updates.wordCount !== undefined || updates.isPinned !== undefined) {
    await supabase.from('documents').update({
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.wordCount !== undefined && { word_count: updates.wordCount }),
      ...(updates.isPinned !== undefined && { is_pinned: updates.isPinned }),
      updated_at: new Date().toISOString(),
    }).eq('id', id);
  }
  if (updates.content !== undefined) {
    await supabase.from('document_contents')
      .upsert({ document_id: id, content: updates.content, updated_at: new Date().toISOString() });
  }
}

async function deleteDocument(id: string): Promise<void> {
  await supabase.from('documents').delete().eq('id', id);
}

// ── 评论/批注 ────────────────────────────────────────────────────

async function getComments(documentId: string): Promise<any[]> {
  const { data, error } = await supabase
    .from('comments')
    .select(`*, user_profiles(display_name, avatar_color, avatar_url)`)
    .eq('document_id', documentId)
    .is('parent_id', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function addComment(documentId: string, content: string, anchorData?: object, parentId?: string): Promise<any> {
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('comments').insert({
    document_id: documentId,
    author_id: user.user?.id,
    content,
    anchor_data: anchorData || {},
    parent_id: parentId || null,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function resolveComment(commentId: string): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  await supabase.from('comments').update({
    is_resolved: true,
    resolved_by: user.user?.id,
    resolved_at: new Date().toISOString(),
  }).eq('id', commentId);
}

// ── 代码批注 ────────────────────────────────────────────────────

async function getCodeAnnotations(documentId: string, filePath?: string): Promise<any[]> {
  let q = supabase
    .from('code_annotations')
    .select(`*, user_profiles(display_name, avatar_color), code_annotation_replies(*, user_profiles(display_name, avatar_color))`)
    .eq('document_id', documentId);
  if (filePath) q = q.eq('file_path', filePath);
  const { data, error } = await q.order('line_start');
  if (error) throw new Error(error.message);
  return data || [];
}

async function addCodeAnnotation(documentId: string, filePath: string, lineStart: number, lineEnd: number, content: string): Promise<any> {
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('code_annotations').insert({
    document_id: documentId,
    author_id: user.user?.id,
    file_path: filePath,
    line_start: lineStart,
    line_end: lineEnd,
    content,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

async function replyCodeAnnotation(annotationId: string, content: string): Promise<any> {
  const { data: user } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('code_annotation_replies').insert({
    annotation_id: annotationId,
    author_id: user.user?.id,
    content,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

// ── 实时订阅 ────────────────────────────────────────────────────

function subscribeToDocument(documentId: string, callbacks: {
  onDocumentChange?: (payload: any) => void;
  onCommentChange?: (payload: any) => void;
  onPresenceChange?: (payload: any) => void;
}): () => void {
  const channel = supabase
    .channel(`document:${documentId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'document_contents', filter: `document_id=eq.${documentId}` },
      callbacks.onDocumentChange || (() => {}))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments', filter: `document_id=eq.${documentId}` },
      callbacks.onCommentChange || (() => {}))
    .on('presence', { event: 'sync' }, callbacks.onPresenceChange || (() => {}))
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

async function updatePresence(documentId: string, cursorData: object): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return;
  await supabase.from('document_presence').upsert({
    document_id: documentId,
    user_id: user.user.id,
    cursor_data: cursorData,
    last_seen: new Date().toISOString(),
  });
}

// ── 审计日志 ────────────────────────────────────────────────────

async function getAuditLogs(organizationId: string, limit = 100): Promise<any[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select(`*, user_profiles(display_name, avatar_color)`)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data || [];
}

async function logAuditEvent(organizationId: string, action: string, resourceType?: string, resourceId?: string, metadata?: object): Promise<void> {
  const { data: user } = await supabase.auth.getUser();
  await supabase.from('audit_logs').insert({
    organization_id: organizationId,
    actor_id: user.user?.id,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    metadata: metadata || {},
  }).then(() => {}); // 静默失败
}

// ── 工具函数 ────────────────────────────────────────────────────

function toCloudUser(user: User, profile?: any): CloudUser {
  return {
    id: user.id,
    email: user.email || '',
    username: profile?.username || user.email?.split('@')[0] || '',
    displayName: profile?.display_name || user.user_metadata?.display_name || user.email?.split('@')[0] || '',
    avatarColor: profile?.avatar_color || '#c8a96e',
    avatarUrl: profile?.avatar_url,
    plan: profile?.plan || 'free',
    isVerified: user.email_confirmed_at != null,
  };
}

function toOrganization(row: any): Organization {
  return { id: row.id, name: row.name, slug: row.slug, logoUrl: row.logo_url, plan: row.plan, maxMembers: row.max_members };
}

function toOrgMember(row: any): OrgMember {
  return {
    id: row.id, userId: row.user_id, organizationId: row.organization_id,
    role: row.role, displayName: row.display_name || row.user_profiles?.display_name || '',
    avatarColor: row.avatar_color || row.user_profiles?.avatar_color || '#c8a96e',
    joinedAt: row.joined_at,
    profile: row.user_profiles ? toCloudUser({ id: row.user_id, email: '' } as User, row.user_profiles) : undefined,
  };
}

function toCloudDocument(row: any): CloudDocument {
  return {
    id: row.id, workspaceId: row.workspace_id, parentId: row.parent_id,
    creatorId: row.creator_id, title: row.title, contentType: row.content_type,
    isFolder: row.is_folder, isPinned: row.is_pinned, isArchived: row.is_archived,
    wordCount: row.word_count, sortOrder: row.sort_order,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// ── 导出（保持与旧 cloudSync 接口兼容）─────────────────────────

export const cloudSync = {
  // Auth
  register,
  login,
  loginWithSSO,
  logout,
  getSession,
  getMe,
  updateProfile,
  isLoggedIn: async () => { const s = await supabase.auth.getSession(); return !!s.data.session; },
  getSavedUser: async () => getMe(),

  // 组织
  createOrganization,
  getMyOrganizations,
  getOrgMembers,
  inviteMember,
  acceptInvitation,
  removeMember,
  updateMemberRole,

  // 文档
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,

  // 评论/批注
  getComments,
  addComment,
  resolveComment,

  // 代码批注
  getCodeAnnotations,
  addCodeAnnotation,
  replyCodeAnnotation,

  // 实时
  subscribeToDocument,
  updatePresence,

  // 审计
  getAuditLogs,
  logAuditEvent,
};
