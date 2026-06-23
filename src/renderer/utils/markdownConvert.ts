import { marked } from 'marked';

/**
 * HTML → Markdown（简单正则转换）。
 *
 * 这个函数原来写在 ExportDialog.tsx 里，只服务于"导出为 .md 文件"这一个场景。
 * 现在 AI 对话式编辑功能也需要同一种转换（把编辑器内容转成 markdown 喂给 AI 当上下文），
 * 所以抽到这个共享文件里，两处都从这里引用，不要再复制一份。
 *
 * 覆盖范围：标题(h1-6)、粗斜体、行内代码、链接、换行/段落、有序/无序列表、引用块。
 * 不支持表格、任务列表、图片、数学公式——这些标签会被当成普通文本剥掉标签，
 * 内容不会丢，但格式会丢。文档里大量用到这些结构的话，AI 编辑这块的还原度会打折扣，
 * 目前先这样，等用上了再针对性地补。
 */
export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
    .replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n')
    .replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<ul[^>]*>/gi, '')
    .replace(/<\/ul>/gi, '\n')
    .replace(/<ol[^>]*>/gi, '')
    .replace(/<\/ol>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) =>
      c.split('\n').map((l: string) => '> ' + l.trim()).join('\n') + '\n\n'
    )
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Markdown → HTML（用于把 AI 返回的修改结果重新写回编辑器）。
 *
 * 用 `marked` 这个成熟的小型库做，不是因为正则转不出来，而是这个方向的可靠性要求更高——
 * htmlToMarkdown 转错了，最多是喂给 AI 的上下文打了折扣；markdownToHtml 转错了，
 * 是直接把错误结构写回用户正在编辑的文档。AI 返回的 markdown 里什么写法都可能出现
 * （嵌套列表、代码块、表格），手写正则去兜所有边界情况风险更高，用经过广泛验证的库更稳。
 */
export function markdownToHtml(markdown: string): string {
  // 部分模型习惯把整段输出包在 ```markdown ... ``` 代码块里，这里做一层兜底剥离
  const cleaned = markdown
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n/i, '')
    .replace(/\n```\s*$/, '');

  return marked.parse(cleaned, { async: false, breaks: true }) as string;
}
