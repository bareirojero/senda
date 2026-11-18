export type BlockType =
  | 'text'
  | 'todo'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'num'
  | 'toggle'
  | 'quote'
  | 'divider'
  | 'callout'
  | 'latex'
  | 'media'
  | 'code';

export interface Note {
  id: number;
  time: string;
  topic: string;
  blockType?: BlockType;
  done?: boolean;
  text: string;
  code?: string | null;
  links?: string[];
  isAI?: boolean;
  model?: string;
}

export interface TopicMeta {
  label: string;
  notionDest: string;
  bg: string;
  fg: string;
  dot: string;
  /** ID de la página de Notion a la que va el tema (si viene de Notion). */
  pageId?: string;
}

export type View = 'stream' | 'graph' | 'config' | 'topic';

export interface SlashItem {
  id: string;
  icon: string;
  title: string;
  desc: string;
  shortcut: string;
  insert: string;
  isAI?: boolean;
}

export interface SlashGroup {
  group: string;
  items: SlashItem[];
}

/** Respuesta de GET /api/notion-sync */
export interface NotionSession {
  source: 'oauth' | 'token' | 'env';
  user: { name: string; avatar: string | null };
  workspace: string | null;
  pages: { id: string; title: string }[];
}
