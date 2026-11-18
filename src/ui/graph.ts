import { state } from '../state';
import { escapeHtml } from '../lib/markdown';

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  color: string;
  isTopic?: boolean;
  parent?: string;
  links?: string[];
}

let nodes: GraphNode[] = [];
let dragged: GraphNode | null = null;
let frame = 0;

/**
 * Red neuronal: temas como nodos grandes, notas como satélites,
 * enlaces punteados entre notas y temas relacionados. Nodos arrastrables
 * con ratón y táctil (Pointer Events → funciona en Android).
 */
export function initGraph(canvas: HTMLCanvasElement, card: HTMLElement): void {
  stopGraph();
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement?.clientWidth || 800;
  const h = canvas.parentElement?.clientHeight || 600;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const narrow = w < 500;
  // Etiquetas a la derecha del nodo → en móvil se corre el centro a la izquierda
  const cx = narrow ? w * 0.38 : w / 2;
  const cy = h / 2;
  const keys = Object.keys(state.topics);
  // En pantallas angostas (Android) el anillo se achica para que todo quepa
  const scale = Math.min(1, (w - 140) / 300);

  nodes = keys.map((k, i) => {
    const angle = (i / keys.length) * Math.PI * 2 - 0.4;
    return {
      id: k,
      label: state.topics[k].label,
      x: cx + Math.cos(angle) * 145 * scale,
      y: cy + Math.sin(angle) * 115 * Math.max(scale, 0.8),
      r: narrow ? 20 : 26,
      color: state.topics[k].dot,
      isTopic: true
    };
  });

  state.notes.forEach((n, idx) => {
    const parent = nodes.find((x) => x.id === n.topic) || nodes[0];
    if (!parent) return;
    const a = idx * 1.5;
    nodes.push({
      id: `n-${n.id}`,
      label: n.text.replace(/[*`~]/g, '').slice(0, 26) + '...',
      x: parent.x + Math.cos(a) * 85 * Math.max(scale, 0.6),
      y: parent.y + Math.sin(a) * 85 * Math.max(scale, 0.6),
      r: narrow ? 8 : 10,
      color: n.isAI ? '#a78bfa' : '#94a3b8',
      parent: parent.id,
      links: n.links || []
    });
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));

  const loop = () => {
    if (state.activeView !== 'graph') return;
    ctx.clearRect(0, 0, w, h);

    for (const node of nodes) {
      const parent = node.parent ? byId.get(node.parent) : undefined;
      if (parent) drawLine(ctx, node, parent, 'rgba(148, 163, 184, 0.35)');
      for (const l of node.links || []) {
        const target = byId.get(l);
        if (target) drawLine(ctx, node, target, 'rgba(139, 92, 246, 0.25)', true);
      }
    }

    const textColor = getComputedStyle(document.body).getPropertyValue('--text-main');
    for (const node of nodes) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
      ctx.fillStyle = textColor;
      ctx.font = node.isTopic ? '600 13px "Plus Jakarta Sans"' : '11.5px "Plus Jakarta Sans"';
      ctx.fillText(node.label, node.x + node.r + 8, node.y + 4);
    }

    frame = requestAnimationFrame(loop);
  };

  const point = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.onpointerdown = (e) => {
    const p = point(e);
    dragged = nodes.find((n) => Math.hypot(n.x - p.x, n.y - p.y) <= n.r + 6) || null;
    if (!dragged) return;
    canvas.setPointerCapture(e.pointerId);
    card.innerHTML = `
      <strong>${escapeHtml(dragged.label)}</strong>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">
        ${dragged.isTopic ? 'Página destino en Notion.' : 'Entrada conectada por Senda AI.'}
      </p>`;
  };
  canvas.onpointermove = (e) => {
    if (!dragged) return;
    const p = point(e);
    dragged.x = p.x;
    dragged.y = p.y;
  };
  canvas.onpointerup = canvas.onpointercancel = () => {
    dragged = null;
  };

  loop();
}

export function stopGraph(): void {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

function drawLine(ctx: CanvasRenderingContext2D, a: GraphNode, b: GraphNode, color: string, dashed = false): void {
  ctx.save();
  ctx.beginPath();
  if (dashed) ctx.setLineDash([4, 4]);
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}
