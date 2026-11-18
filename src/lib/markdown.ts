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

/**
 * Markdown de varias líneas (respuestas de IA): respeta saltos de línea,
 * listas con -, * o 1. y encabezados #, sin perder el escape de HTML.
 */
export function parseBlockMarkdown(raw: string): string {
  const out: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    out.push(`<${tag} class="md-list">${list.items.map((i) => `<li>${i}</li>`).join('')}</${tag}>`);
    list = null;
  };

  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !!numbered && !bullet;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(parseInlineMarkdown((bullet || numbered)![1]!));
      continue;
    }
    flush();
    if (heading) out.push(`<p class="md-heading">${parseInlineMarkdown(heading[1]!)}</p>`);
    else if (line.trim()) out.push(`<p>${parseInlineMarkdown(line)}</p>`);
  }
  flush();
  return out.join('');
}
