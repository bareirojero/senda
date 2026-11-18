export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Markdown en línea para pintar tarjetas: **negrita**, *cursiva*, `código`, ~tachado~. */
export function parseInlineMarkdown(raw: string): string {
  let safe = escapeHtml(raw);
  safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  safe = safe.replace(/\*(.+?)\*/g, '<em>$1</em>');
  safe = safe.replace(/`(.+?)`/g, '<code>$1</code>');
  safe = safe.replace(/~(.+?)~/g, '<del>$1</del>');
  return safe;
}
