import type { BlockType } from '../types';

/**
 * Traductor de Senda: comandos `/` + Markdown en línea → bloques JSON de la API de Notion.
 * Es la única fuente de verdad para clasificar una entrada; lo usan tanto la UI
 * (para pintar la tarjeta) como el envío a /api/notion-sync.
 */

export interface ParsedNote {
  topic: string;
  blockType: BlockType;
  cleanText: string;
  codeBlock?: string;
  notionBlocks: NotionBlock[];
}

// Tipado mínimo y laxo de un bloque de Notion (el SDK completo vive en el backend).
export type NotionBlock = { object: 'block'; type: string } & Record<string, unknown>;

export interface RichText {
  type: 'text';
  text: { content: string };
  annotations?: Partial<Record<'bold' | 'italic' | 'code' | 'strikethrough', boolean>>;
}

/** Notion limita cada objeto rich_text a 2000 caracteres. */
const NOTION_TEXT_LIMIT = 2000;

function chunk(content: string, annotations?: RichText['annotations']): RichText[] {
  const out: RichText[] = [];
  for (let i = 0; i < content.length; i += NOTION_TEXT_LIMIT) {
    const piece: RichText = { type: 'text', text: { content: content.slice(i, i + NOTION_TEXT_LIMIT) } };
    if (annotations) piece.annotations = annotations;
    out.push(piece);
  }
  return out;
}

export function buildRichText(text: string): RichText[] {
  // **negrita**, *cursiva*, `código` y ~tachado~ → rich_text nativo de Notion
  const tokens = text.split(/(\*\*.+?\*\*|\*.+?\*|`.+?`|~.+?~)/g).filter(Boolean);
  return tokens.flatMap((token) => {
    if (token.length > 4 && token.startsWith('**') && token.endsWith('**')) return chunk(token.slice(2, -2), { bold: true });
    if (token.length > 2 && token.startsWith('*') && token.endsWith('*')) return chunk(token.slice(1, -1), { italic: true });
    if (token.length > 2 && token.startsWith('`') && token.endsWith('`')) return chunk(token.slice(1, -1), { code: true });
    if (token.length > 2 && token.startsWith('~') && token.endsWith('~')) return chunk(token.slice(1, -1), { strikethrough: true });
    return chunk(token);
  });
}

function block(type: string, payload: Record<string, unknown>): NotionBlock {
  return { object: 'block', type, [type]: payload };
}

// `\b` no funciona tras caracteres acentuados (p. ej. "/botón"), así que usamos un lookahead.
const END = '(?=\\s|$)';
const MEDIA_RE = new RegExp(`^\\/(image|archivo|web|miniatura|video|audio|pdf|database|vista|botón|boton|page)${END}`, 'i');

/** Bloques de archivo externos soportados por Notion para cada comando multimedia. */
const EXTERNAL_MEDIA: Record<string, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  pdf: 'pdf',
  archivo: 'file'
};

export function parseInputToNotion(raw: string, fallbackTopic = 'general'): ParsedNote {
  const matchTopic = raw.match(/@([a-zA-Z0-9_-]+)/);
  const topic = matchTopic ? matchTopic[1].toLowerCase() : fallbackTopic;
  let cleanText = raw.replace(/@[a-zA-Z0-9_-]+/g, '').trim();
  let blockType: BlockType = 'text';
  let codeBlock: string | undefined;
  let notionBlocks: NotionBlock[];

  const strip = (re: RegExp) => { cleanText = cleanText.replace(re, ''); };

  if (new RegExp(`^(\\/todo|#tarea)${END}`, 'i').test(cleanText)) {
    blockType = 'todo';
    strip(/^(\/todo|#tarea)\s*/i);
    notionBlocks = [block('to_do', { rich_text: buildRichText(cleanText), checked: false })];
  } else if (/^(\/h1|#)\s+/.test(cleanText)) {
    blockType = 'h1';
    strip(/^(\/h1|#)\s+/);
    notionBlocks = [block('heading_1', { rich_text: buildRichText(cleanText) })];
  } else if (/^(\/h2|##)\s+/.test(cleanText)) {
    blockType = 'h2';
    strip(/^(\/h2|##)\s+/);
    notionBlocks = [block('heading_2', { rich_text: buildRichText(cleanText) })];
  } else if (/^(\/h3|###)\s+/.test(cleanText)) {
    blockType = 'h3';
    strip(/^(\/h3|###)\s+/);
    notionBlocks = [block('heading_3', { rich_text: buildRichText(cleanText) })];
  } else if (/^(\/bullet|-|\*)\s+/.test(cleanText)) {
    blockType = 'bullet';
    strip(/^(\/bullet|-|\*)\s+/);
    notionBlocks = [block('bulleted_list_item', { rich_text: buildRichText(cleanText) })];
  } else if (/^(\/num|1\.)\s+/.test(cleanText)) {
    blockType = 'num';
    strip(/^(\/num|1\.)\s+/);
    notionBlocks = [block('numbered_list_item', { rich_text: buildRichText(cleanText) })];
  } else if (/^(\/toggle|>)\s+/.test(cleanText)) {
    blockType = 'toggle';
    strip(/^(\/toggle|>)\s+/);
    notionBlocks = [block('toggle', { rich_text: buildRichText(cleanText) })];
  } else if (/^(\/quote|")\s+/.test(cleanText)) {
    blockType = 'quote';
    strip(/^(\/quote|")\s+/);
    notionBlocks = [block('quote', { rich_text: buildRichText(cleanText) })];
  } else if (/^(\/divider|---)/.test(cleanText)) {
    blockType = 'divider';
    cleanText = '';
    notionBlocks = [block('divider', {})];
  } else if (new RegExp(`^\\/callout${END}`, 'i').test(cleanText)) {
    blockType = 'callout';
    strip(/^\/callout\s*/i);
    notionBlocks = [block('callout', { rich_text: buildRichText(cleanText), icon: { type: 'emoji', emoji: '💡' } })];
  } else if (new RegExp(`^\\/latex${END}`, 'i').test(cleanText)) {
    blockType = 'latex';
    strip(/^\/latex\s*/i);
    notionBlocks = [block('equation', { expression: cleanText })];
  } else if (new RegExp(`^\\/code${END}`, 'i').test(cleanText) || cleanText.includes('```')) {
    blockType = 'code';
    codeBlock = cleanText.replace(/^\/code\s*/i, '').replace(/```/g, '').trim();
    cleanText = 'Snippet guardado en Notion:';
    notionBlocks = [block('code', { rich_text: chunk(codeBlock), language: 'plain text' })];
  } else if (MEDIA_RE.test(cleanText)) {
    blockType = 'media';
    const kind = (cleanText.match(MEDIA_RE)?.[1] || '').toLowerCase();
    const url = cleanText.match(/https?:\/\/\S+/)?.[0];
    cleanText = cleanText.replace(/^\//, 'Bloque Notion: ');
    if (url && EXTERNAL_MEDIA[kind]) {
      notionBlocks = [block(EXTERNAL_MEDIA[kind], { type: 'external', external: { url } })];
    } else if (url) {
      notionBlocks = [block('bookmark', { url })];
    } else {
      notionBlocks = [block('paragraph', { rich_text: buildRichText(cleanText) })];
    }
  } else {
    strip(/^\/texto\s*/i);
    notionBlocks = [block('paragraph', { rich_text: buildRichText(cleanText) })];
  }

  return { topic, blockType, cleanText, codeBlock, notionBlocks };
}
