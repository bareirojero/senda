import { describe, expect, it } from 'vitest';
import { buildRichText, parseInputToNotion } from '../src/lib/parser';

describe('buildRichText', () => {
  it('convierte markdown en línea en anotaciones de Notion', () => {
    const rt = buildRichText('hola **negrita** *cursiva* `code` ~tachado~');
    expect(rt.map((t) => [t.text.content, t.annotations])).toEqual([
      ['hola ', undefined],
      ['negrita', { bold: true }],
      [' ', undefined],
      ['cursiva', { italic: true }],
      [' ', undefined],
      ['code', { code: true }],
      [' ', undefined],
      ['tachado', { strikethrough: true }]
    ]);
  });

  it('parte textos largos en trozos de 2000 caracteres', () => {
    const rt = buildRichText('a'.repeat(4500));
    expect(rt.map((t) => t.text.content.length)).toEqual([2000, 2000, 500]);
  });
});

describe('parseInputToNotion', () => {
  const cases: [string, string, string][] = [
    ['/todo revisar losa', 'todo', 'to_do'],
    ['#tarea revisar losa', 'todo', 'to_do'],
    ['# Título', 'h1', 'heading_1'],
    ['## Subtítulo', 'h2', 'heading_2'],
    ['### Pequeño', 'h3', 'heading_3'],
    ['- item', 'bullet', 'bulleted_list_item'],
    ['* item', 'bullet', 'bulleted_list_item'],
    ['1. paso', 'num', 'numbered_list_item'],
    ['> desplegable', 'toggle', 'toggle'],
    ['" cita', 'quote', 'quote'],
    ['---', 'divider', 'divider'],
    ['/divider', 'divider', 'divider'],
    ['/callout ojo', 'callout', 'callout'],
    ['/latex E = mc^2', 'latex', 'equation'],
    ['/code let x = 1', 'code', 'code'],
    ['/texto hola', 'text', 'paragraph'],
    ['texto libre', 'text', 'paragraph']
  ];

  it.each(cases)('%s → %s', (input, blockType, notionType) => {
    const p = parseInputToNotion(input);
    expect(p.blockType).toBe(blockType);
    expect(p.notionBlocks[0]!.type).toBe(notionType);
  });

  it('extrae el tema con @ y lo quita del texto', () => {
    const p = parseInputToNotion('revisar armadura @Obra', 'general');
    expect(p.topic).toBe('obra');
    expect(p.cleanText).toBe('revisar armadura');
  });

  it('usa el tema por defecto si no hay @', () => {
    expect(parseInputToNotion('nota', 'estructura').topic).toBe('estructura');
  });

  it('crea bloques externos para multimedia con URL', () => {
    expect(parseInputToNotion('/image https://x.com/a.png').notionBlocks[0]).toMatchObject({
      type: 'image',
      image: { type: 'external', external: { url: 'https://x.com/a.png' } }
    });
    expect(parseInputToNotion('/web https://notion.so').notionBlocks[0]!.type).toBe('bookmark');
    expect(parseInputToNotion('/pdf https://x.com/a.pdf').notionBlocks[0]!.type).toBe('pdf');
  });

  it('reconoce /botón con tilde', () => {
    expect(parseInputToNotion('/botón plantilla diaria').blockType).toBe('media');
  });

  it('no confunde /todos con /todo', () => {
    expect(parseInputToNotion('/todos los días').blockType).toBe('text');
  });
});

import { parseBlockMarkdown } from '../src/lib/markdown';

describe('parseBlockMarkdown (respuestas de IA)', () => {
  it('convierte listas y párrafos, escapando HTML', () => {
    const html = parseBlockMarkdown('Temas:\n* **mis-tareas**\n* obras\n\nDime <qué> anotar');
    expect(html).toBe('<p>Temas:</p><ul class="md-list"><li><strong>mis-tareas</strong></li><li>obras</li></ul><p>Dime &lt;qué&gt; anotar</p>');
  });

  it('listas numeradas y encabezados', () => {
    expect(parseBlockMarkdown('## Plan\n1. uno\n2. dos')).toBe('<p class="md-heading">Plan</p><ol class="md-list"><li>uno</li><li>dos</li></ol>');
  });
});
