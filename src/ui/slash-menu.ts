import { slashCommands } from '../data/commands';
import { escapeHtml } from '../lib/markdown';
import type { SlashGroup } from '../types';

/**
 * Menú flotante `/`: filtro en tiempo real, ↑ ↓ Enter Esc.
 */
export class SlashMenu {
  private open = false;
  private filter = '';
  private selected = 0;

  constructor(
    private readonly input: HTMLTextAreaElement,
    private readonly menu: HTMLElement
  ) {
    input.addEventListener('input', () => this.onInput());
    // mousedown (no click) para no perder el foco del textarea antes de aplicar
    menu.addEventListener('mousedown', (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-slash-index]');
      if (!opt) return;
      e.preventDefault();
      this.apply(Number(opt.dataset.slashIndex));
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Devuelve true si la tecla fue consumida por el menú. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.open) return false;
    const count = this.flatItems().length;
    switch (e.key) {
      case 'ArrowDown':
        this.selected = (this.selected + 1) % count;
        break;
      case 'ArrowUp':
        this.selected = (this.selected - 1 + count) % count;
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        this.apply(this.selected);
        return true;
      case 'Escape':
        e.preventDefault();
        this.close();
        return true;
      default:
        return false;
    }
    e.preventDefault();
    this.render();
    return true;
  }

  close(): void {
    this.menu.classList.remove('open');
    this.open = false;
    this.filter = '';
    this.selected = 0;
  }

  private onInput(): void {
    const before = this.input.value.slice(0, this.input.selectionStart ?? this.input.value.length);
    const match = before.match(/(?:^|\s)\/([a-zA-Z0-9áéíóúÁÉÍÓÚñÑ-]*)$/);
    if (match) {
      this.filter = match[1] ?? '';
      // Preselecciona el comando cuyo id empieza por lo tecleado (/to → /todo, no /auto)
      const q = this.filter.toLowerCase();
      const prefix = q ? this.flatItems().findIndex((i) => i.id.startsWith(q) || i.shortcut.slice(1).startsWith(q)) : -1;
      this.selected = Math.max(prefix, 0);
      this.render();
    } else {
      this.close();
    }
  }

  private groups(): SlashGroup[] {
    const q = this.filter.toLowerCase();
    return slashCommands
      .map((g) => ({
        group: g.group,
        items: g.items.filter(
          (i) => i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q)
        )
      }))
      .filter((g) => g.items.length > 0);
  }

  private flatItems() {
    return this.groups().flatMap((g) => g.items);
  }

  private render(): void {
    const groups = this.groups();
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    if (total === 0) {
      this.close();
      return;
    }
    if (this.selected >= total) this.selected = 0;

    let html = '';
    let idx = 0;
    groups.forEach((g, gIdx) => {
      if (gIdx > 0) html += '<div class="slash-divider"></div>';
      html += `<div class="slash-group-label">${escapeHtml(g.group)}</div>`;
      for (const item of g.items) {
        html += `
          <div class="slash-option ${idx === this.selected ? 'selected' : ''}" data-slash-index="${idx}">
            <div class="slash-opt-left">
              <div class="slash-icon-box ${item.isAI ? 'ai' : ''}">${escapeHtml(item.icon)}</div>
              <div>
                <div class="slash-opt-title">${escapeHtml(item.title)}</div>
                <div class="slash-opt-desc">${escapeHtml(item.desc)}</div>
              </div>
            </div>
            <span class="slash-shortcut">${escapeHtml(item.shortcut)}</span>
          </div>`;
        idx++;
      }
    });

    this.menu.innerHTML = html;
    this.menu.classList.add('open');
    this.open = true;
    this.menu.querySelector('.slash-option.selected')?.scrollIntoView({ block: 'nearest' });
  }

  private apply(index: number): void {
    const chosen = this.flatItems()[index];
    if (!chosen) return;
    const val = this.input.value;
    const cursor = this.input.selectionStart ?? val.length;
    const slashPos = val.lastIndexOf('/', cursor - 1);
    const before = slashPos !== -1 ? val.slice(0, slashPos) : val;
    const after = val.slice(cursor);
    this.input.value = before + chosen.insert + after;
    const caret = (before + chosen.insert).length;
    this.close();
    this.input.focus();
    this.input.setSelectionRange(caret, caret);
  }
}
