/** Claves de localStorage (se mantienen las de v1.0 para no perder datos). */
export const KEYS = {
  notes: 'senda_notes',
  notionToken: 'senda_notion_token',
  notionPage: 'senda_notion_page',
  gemini: 'senda_gemini_key',
  claude: 'senda_claude_key',
  theme: 'senda_theme',
  fontSize: 'senda_font_size',
  sidebarCollapsed: 'senda_sidebar_collapsed',
  tasksDb: 'senda_tasks_db',
  aiFill: 'senda_ai_fill',
  notionSectionOpen: 'senda_notion_section_open',
  synced: 'senda_synced',
  accessKey: 'senda_access_key',
  todayGroupProp: 'senda_today_group_prop',
  todayGroup: 'senda_today_group',
  todayCollapsed: 'senda_today_collapsed',
  todayOverdueOpen: 'senda_today_overdue_open',
  todayFutureOpen: 'senda_today_future_open',
  todayOrder: 'senda_today_order',
  todayDoing: 'senda_today_doing',
  settingsDirty: 'senda_settings_dirty',
  sessionCache: 'senda_session_cache'
} as const;

type Key = (typeof KEYS)[keyof typeof KEYS];

// localStorage puede lanzar (modo privado, cuota, webviews); nunca debe romper la app.
export function getItem(key: Key): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function setItem(key: Key, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* sin persistencia disponible */
  }
}

export function getJSON<T>(key: Key, fallback: T): T {
  const raw = getItem(key);
  if (!raw) return fallback;
  try {
    return (JSON.parse(raw) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function setJSON(key: Key, value: unknown): void {
  setItem(key, JSON.stringify(value));
}
