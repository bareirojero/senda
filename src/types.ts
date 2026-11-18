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
  /** IDs de los bloques creados en Notion (para borrar o marcar después). */
  notionBlockIds?: string[];
  /** Si la nota es una fila de base: nombre de la casilla "Hecho" para sincronizarla. */
  notionDoneProp?: string;
  /** Propiedades completadas (fecha, categoría, obra…) para mostrar en la tarjeta. */
  chips?: string[];
}

export interface TopicMeta {
  label: string;
  notionDest: string;
  bg: string;
  fg: string;
  dot: string;
  /** ID de la página de Notion a la que va el tema (si viene de Notion). */
  pageId?: string;
  /** ID de la base de Notion: @tema crea una fila en ella. */
  databaseId?: string;
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
  databases?: NotionDatabase[];
}

export interface RelationTarget {
  id: string;
  title: string;
  keywords: string[];
}

export interface DbProperty {
  name: string;
  type: string;
  options?: string[];
  targets?: RelationTarget[];
}

export interface NotionDatabase {
  id: string;
  title: string;
  properties: DbProperty[];
}
