import { escapeHtml } from '../lib/markdown';

export interface MentionItem {
  icon: string;
  title: string;
  desc: string;
  /** Texto que reemplaza a "@algo" / "#algo" (sin el espacio final) */
  insert: string;
  group: string;
}

/**
 * Autocompletado de "@destino" y "#etiqueta" mientras se escribe.
 * Usa los mismos estilos que el menú "/".
 */
export class MentionMenu {
  private open = false;
  private selected = 0;
  private items: MentionItem[] = [];
  private start = 0;
  private typed = '';

  constructor(
    private readonly input: HTMLTextAreaElement,
    private readonly menu: HTMLElement,
    private readonly source: (trigger: '@' | '#', query: string, text: string) => MentionItem[]
  ) {
    input.addEventListener('input', () => this.onInput());
    input.addEventListener('blur', () => setTimeout(() => this.close(), 120));
    menu.addEventListener('mousedown', (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-mention-index]');
      if (!opt) return;
      e.preventDefault();
      this.apply(Number(opt.dataset.mentionIndex));
    });
  }

  handleKey(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    const count = this.items.length;
    if (e.key === 'ArrowDown') this.selected = (this.selected + 1) % count;
    else if (e.key === 'ArrowUp') this.selected = (this.selected - 1 + count) % count;
    else if (e.key === 'Enter' || e.key === 'Tab') {
      // Ya escribiste la etiqueta completa: Enter envía en vez de reemplazarla
      if (e.key === 'Enter' && this.items.some((i) => i.insert.toLowerCase() === this.typed.toLowerCase())) {
        this.close();
        return false;
      }
      e.preventDefault();
      this.apply(this.selected);
      return true;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return true;
    } else return false;
    e.preventDefault();
    this.render();
    return true;
  }

  close(): void {
    this.menu.classList.remove('open');
    this.open = false;
  }

  private onInput(): void {
    const caret = this.input.selectionStart ?? this.input.value.length;
    const before = this.input.value.slice(0, caret);
    const m = before.match(/(?:^|\s)([@#])([\p{L}\p{N}_-]*)$/u);
    // "# " al inicio es un encabezado, "#tarea" lo maneja el menú igual
    if (!m) return this.close();
    const trigger = m[1] as '@' | '#';
    this.start = caret - m[2]!.length - 1;
    this.typed = trigger + m[2]!;
    this.items = this.source(trigger, m[2]!, this.input.value).slice(0, 30);
    this.selected = 0;
    if (this.items.length === 0) return this.close();
    this.render();
  }

  private render(): void {
    let html = '';
    let group = '';
    this.items.forEach((item, idx) => {
      if (item.group !== group) {
        if (group) html += '<div class="slash-divider"></div>';
        group = item.group;
        html += `<div class="slash-group-label">${escapeHtml(group)}</div>`;
      }
      html += `
        <div class="slash-option ${idx === this.selected ? 'selected' : ''}" data-mention-index="${idx}">
          <div class="slash-opt-left">
            <div class="slash-icon-box">${escapeHtml(item.icon)}</div>
            <div>
              <div class="slash-opt-title">${escapeHtml(item.title)}</div>
              <div class="slash-opt-desc">${escapeHtml(item.desc)}</div>
            </div>
          </div>
          <span class="slash-shortcut">${escapeHtml(item.insert)}</span>
        </div>`;
    });
    this.menu.innerHTML = html;
    this.menu.classList.add('open');
    this.open = true;
    this.menu.querySelector('.slash-option.selected')?.scrollIntoView({ block: 'nearest' });
  }

  private apply(index: number): void {
    const item = this.items[index];
    if (!item) return;
    const val = this.input.value;
    const caret = this.input.selectionStart ?? val.length;
    const before = val.slice(0, this.start);
    const after = val.slice(caret).replace(/^[\p{L}\p{N}_-]*/u, '');
    const insert = `${item.insert} `;
    this.input.value = before + insert + after.replace(/^\s+/, '');
    const pos = (before + insert).length;
    this.close();
    this.input.focus();
    this.input.setSelectionRange(pos, pos);
    this.input.dispatchEvent(new Event('input'));
  }
}
