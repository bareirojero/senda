export interface ParsedNote {
  topic: string;
  blockType: string;
  cleanText: string;
  codeBlock?: string;
  notionBlocks: any[];
}

function buildRichText(text: string) {
  // Convierte **negrita**, *cursiva*, `código` y ~tachado~ en rich_text nativo de Notion
  const tokens = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`|~.*?~)/g).filter(Boolean);
  return tokens.map((token) => {
    if (token.startsWith('**') && token.endsWith('**')) {
      return { type: 'text', text: { content: token.slice(2, -2) }, annotations: { bold: true } };
    }
    if (token.startsWith('*') && token.endsWith('*')) {
      return { type: 'text', text: { content: token.slice(1, -1) }, annotations: { italic: true } };
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      return { type: 'text', text: { content: token.slice(1, -1) }, annotations: { code: true } };
    }
    if (token.startsWith('~') && token.endsWith('~')) {
      return { type: 'text', text: { content: token.slice(1, -1) }, annotations: { strikethrough: true } };
    }
    return { type: 'text', text: { content: token } };
  });
}

export function parseInputToNotion(raw: string, fallbackTopic = 'general'): ParsedNote {
  const matchTopic = raw.match(/@([a-zA-Z0-9_-]+)/);
  const topic = matchTopic ? matchTopic[1].toLowerCase() : fallbackTopic;
  let cleanText = raw.replace(/@[a-zA-Z0-9_-]+/g, '').trim();
  let blockType = 'text';
  let codeBlock: string | undefined;
  let notionBlocks: any[] = [];

  if (/^(\/todo|#tarea)\b/i.test(cleanText)) {
    blockType = 'todo';
    cleanText = cleanText.replace(/^(\/todo|#tarea)\s*/i, '');
    notionBlocks = [{ object: 'block', type: 'to_do', to_do: { rich_text: buildRichText(cleanText), checked: false } }];
  } else if (/^(\/h1|#)\s+/.test(cleanText)) {
    blockType = 'h1';
    cleanText = cleanText.replace(/^(\/h1|#)\s+/, '');
    notionBlocks = [{ object: 'block', type: 'heading_1', heading_1: { rich_text: buildRichText(cleanText) } }];
  } else if (/^(\/h2|##)\s+/.test(cleanText)) {
    blockType = 'h2';
    cleanText = cleanText.replace(/^(\/h2|##)\s+/, '');
    notionBlocks = [{ object: 'block', type: 'heading_2', heading_2: { rich_text: buildRichText(cleanText) } }];
  } else if (/^(\/h3|###)\s+/.test(cleanText)) {
    blockType = 'h3';
    cleanText = cleanText.replace(/^(\/h3|###)\s+/, '');
    notionBlocks = [{ object: 'block', type: 'heading_3', heading_3: { rich_text: buildRichText(cleanText) } }];
  } else if (/^(\/bullet|-|\*)\s+/.test(cleanText)) {
    blockType = 'bullet';
    cleanText = cleanText.replace(/^(\/bullet|-|\*)\s+/, '');
    notionBlocks = [{ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: buildRichText(cleanText) } }];
  } else if (/^(\/num|1\.)\s+/.test(cleanText)) {
    blockType = 'num';
    cleanText = cleanText.replace(/^(\/num|1\.)\s+/, '');
    notionBlocks = [{ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: buildRichText(cleanText) } }];
  } else if (/^(\/toggle|>)\s+/.test(cleanText)) {
    blockType = 'toggle';
    cleanText = cleanText.replace(/^(\/toggle|>)\s+/, '');
    notionBlocks = [{ object: 'block', type: 'toggle', toggle: { rich_text: buildRichText(cleanText) } }];
  } else if (/^(\/quote|")\s+/.test(cleanText)) {
    blockType = 'quote';
    cleanText = cleanText.replace(/^(\/quote|")\s+/, '');
    notionBlocks = [{ object: 'block', type: 'quote', quote: { rich_text: buildRichText(cleanText) } }];
  } else if (/^(\/divider|---)/.test(cleanText)) {
    blockType = 'divider';
    cleanText = '';
    notionBlocks = [{ object: 'block', type: 'divider', divider: {} }];
  } else if (/^\/callout\b/i.test(cleanText)) {
    blockType = 'callout';
    cleanText = cleanText.replace(/^\/callout\s*/i, '');
    notionBlocks = [{ object: 'block', type: 'callout', callout: { rich_text: buildRichText(cleanText), icon: { emoji: '💡' } } }];
  } else if (/^\/latex\b/i.test(cleanText)) {
    blockType = 'latex';
    cleanText = cleanText.replace(/^\/latex\s*/i, '');
    notionBlocks = [{ object: 'block', type: 'equation', equation: { expression: cleanText } }];
  } else if (/^\/code\b/i.test(cleanText) || cleanText.includes('```')) {
    blockType = 'code';
    codeBlock = cleanText.replace(/^\/code\s*/i, '').replace(/```/g, '').trim();
    cleanText = 'Snippet guardado en Notion:';
    notionBlocks = [{
      object: 'block',
      type: 'code',
      code: { rich_text: [{ type: 'text', text: { content: codeBlock } }], language: 'plain text' }
    }];
  } else if (/^\/(image|archivo|web|miniatura|video|audio|pdf)\b/i.test(cleanText)) {
    blockType = 'media';
    const urlMatch = cleanText.match(/https?:\/\/\S+/);
    cleanText = cleanText.replace(/^\//, 'Bloque Notion: ');
    if (urlMatch) {
      notionBlocks = [{ object: 'block', type: 'bookmark', bookmark: { url: urlMatch[0] } }];
    } else {
      notionBlocks = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: buildRichText(cleanText) } }];
    }
  } else {
    cleanText = cleanText.replace(/^\/texto\s*/i, '');
    notionBlocks = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: buildRichText(cleanText) } }];
  }

  return { topic, blockType, cleanText, codeBlock, notionBlocks };
}
