/**
 * ExportAnnotations.ts — 批注导出工具
 * src/renderer/utils/exportAnnotations.ts
 *
 * 支持将代码批注导出为：
 * - Markdown
 * - HTML（可打印）
 * - JSON（供其他工具使用）
 */

interface Annotation {
  id: string;
  filePath: string;
  lineStart: number;
  lineEnd?: number;
  content: string;
  authorName: string;
  createdAt: string;
  isResolved: boolean;
  replies: { authorName: string; content: string; createdAt: string }[];
}

interface Comment {
  id: string;
  authorName: string;
  content: string;
  isResolved: boolean;
  createdAt: string;
  replies: { authorName: string; content: string; createdAt: string }[];
}

// ── Markdown 导出 ─────────────────────────────────────────────────

export function exportAnnotationsToMarkdown(annotations: Annotation[], documentTitle: string): string {
  const lines: string[] = [
    `# ${documentTitle} - 代码批注`,
    ``,
    `> 导出时间：${new Date().toLocaleString('zh-CN')}`,
    `> 批注数量：${annotations.length} 条（${annotations.filter(a => !a.isResolved).length} 未解决）`,
    ``,
  ];

  // 按文件分组
  const byFile = new Map<string, Annotation[]>();
  for (const ann of annotations) {
    const key = ann.filePath;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(ann);
  }

  for (const [filePath, anns] of byFile) {
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    lines.push(`## 📄 ${fileName}`);
    lines.push(`*${filePath}*`);
    lines.push('');

    for (const ann of anns.sort((a, b) => a.lineStart - b.lineStart)) {
      const status = ann.isResolved ? '~~已解决~~' : '**未解决**';
      const lineRef = ann.lineEnd && ann.lineEnd !== ann.lineStart ? `L${ann.lineStart}-${ann.lineEnd}` : `L${ann.lineStart}`;
      lines.push(`### ${lineRef} ${status}`);
      lines.push('');
      lines.push(`**${ann.authorName}** · ${formatDate(ann.createdAt)}`);
      lines.push('');
      lines.push(ann.content);
      lines.push('');
      if (ann.replies.length > 0) {
        for (const reply of ann.replies) {
          lines.push(`> **${reply.authorName}** · ${formatDate(reply.createdAt)}`);
          lines.push(`> ${reply.content}`);
          lines.push('');
        }
      }
      lines.push('---');
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function exportCommentsToMarkdown(comments: Comment[], documentTitle: string): string {
  const lines: string[] = [
    `# ${documentTitle} - 文档评论`,
    ``,
    `> 导出时间：${new Date().toLocaleString('zh-CN')}`,
    `> 评论数量：${comments.length} 条`,
    ``,
  ];

  for (const c of comments) {
    const status = c.isResolved ? ' ~~(已解决)~~' : '';
    lines.push(`### ${c.authorName}${status}`);
    lines.push(`*${formatDate(c.createdAt)}*`);
    lines.push('');
    lines.push(c.content);
    lines.push('');
    if (c.replies.length > 0) {
      for (const r of c.replies) {
        lines.push(`> **${r.authorName}** · ${formatDate(r.createdAt)}`);
        lines.push(`> ${r.content}`);
        lines.push('');
      }
    }
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

// ── HTML 导出（可打印）───────────────────────────────────────────

export function exportAnnotationsToHTML(annotations: Annotation[], documentTitle: string): string {
  const byFile = new Map<string, Annotation[]>();
  for (const ann of annotations) {
    if (!byFile.has(ann.filePath)) byFile.set(ann.filePath, []);
    byFile.get(ann.filePath)!.push(ann);
  }

  const sections = Array.from(byFile.entries()).map(([filePath, anns]) => {
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const items = anns.sort((a, b) => a.lineStart - b.lineStart).map(ann => {
      const lineRef = ann.lineEnd && ann.lineEnd !== ann.lineStart ? `L${ann.lineStart}-${ann.lineEnd}` : `L${ann.lineStart}`;
      const replies = ann.replies.map(r =>
        `<div class="reply"><strong>${esc(r.authorName)}</strong> <span class="time">${formatDate(r.createdAt)}</span><p>${esc(r.content)}</p></div>`
      ).join('');
      return `<div class="annotation ${ann.isResolved ? 'resolved' : ''}">
        <div class="ann-header">
          <span class="line-ref">${lineRef}</span>
          <span class="author">${esc(ann.authorName)}</span>
          <span class="time">${formatDate(ann.createdAt)}</span>
          ${ann.isResolved ? '<span class="badge resolved">已解决</span>' : '<span class="badge open">未解决</span>'}
        </div>
        <p class="ann-content">${esc(ann.content)}</p>
        ${replies ? `<div class="replies">${replies}</div>` : ''}
      </div>`;
    }).join('');
    return `<section><h2>📄 ${esc(fileName)}<small>${esc(filePath)}</small></h2>${items}</section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${esc(documentTitle)} - 代码批注</title>
<style>
  body { font-family: -apple-system, 'PingFang SC', sans-serif; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 22px; border-bottom: 2px solid #c8a96e; padding-bottom: 10px; }
  h2 { font-size: 16px; margin-top: 32px; color: #333; }
  h2 small { font-size: 11px; color: #888; font-weight: 400; margin-left: 10px; }
  .annotation { border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px; margin: 10px 0; }
  .annotation.resolved { opacity: 0.6; border-style: dashed; }
  .ann-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
  .line-ref { background: #1a1a1a; color: #fff; padding: 2px 8px; border-radius: 4px; font-family: monospace; font-size: 11px; }
  .author { font-weight: 600; }
  .time { color: #888; font-size: 12px; margin-left: auto; }
  .badge { font-size: 11px; padding: 2px 8px; border-radius: 10px; }
  .badge.open { background: #52c97a20; color: #2ea55a; }
  .badge.resolved { background: #88888820; color: #666; }
  .ann-content { margin: 0 0 8px; font-size: 13.5px; line-height: 1.6; }
  .replies { border-top: 1px solid #eee; padding-top: 10px; }
  .reply { padding: 6px 0; font-size: 12.5px; }
  .reply p { margin: 4px 0 0; color: #444; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
<h1>${esc(documentTitle)} — 代码批注报告</h1>
<p style="color:#888;font-size:13px">导出时间：${new Date().toLocaleString('zh-CN')} · ${annotations.length} 条批注</p>
${sections}
</body>
</html>`;
}

// ── JSON 导出 ─────────────────────────────────────────────────────

export function exportToJSON(annotations: Annotation[], comments: Comment[], documentTitle: string): string {
  return JSON.stringify({
    documentTitle,
    exportedAt: new Date().toISOString(),
    annotations: annotations.map(a => ({
      filePath: a.filePath, lineStart: a.lineStart, lineEnd: a.lineEnd,
      content: a.content, author: a.authorName, createdAt: a.createdAt,
      isResolved: a.isResolved,
      replies: a.replies.map(r => ({ author: r.authorName, content: r.content, createdAt: r.createdAt })),
    })),
    comments: comments.map(c => ({
      content: c.content, author: c.authorName, createdAt: c.createdAt,
      isResolved: c.isResolved,
      replies: c.replies.map(r => ({ author: r.authorName, content: r.content, createdAt: r.createdAt })),
    })),
  }, null, 2);
}

// ── 下载辅助 ─────────────────────────────────────────────────────

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── 工具函数 ──────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
