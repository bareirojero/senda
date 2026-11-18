import type { SlashGroup } from '../types';

export const slashCommands: SlashGroup[] = [
  {
    group: 'Asistente IA',
    items: [
      { id: 'gemini', icon: '✦', isAI: true, title: 'Gemini', desc: 'Analiza, resume y conecta notas', shortcut: '/gemini', insert: '/gemini ' },
      { id: 'claude', icon: '✦', isAI: true, title: 'Claude', desc: 'Estructura para Notion', shortcut: '/claude', insert: '/claude ' },
      { id: 'auto', icon: '↗', isAI: true, title: 'Auto-ordenar', desc: 'Clasifica tema y destino', shortcut: '/auto', insert: '/auto ' }
    ]
  },
  {
    group: 'Bloques Básicos',
    items: [
      { id: 'texto', icon: 'T', title: 'Texto', desc: 'Párrafo normal', shortcut: '/texto', insert: '/texto ' },
      { id: 'h1', icon: 'H1', title: 'Encabezado 1', desc: 'Título grande', shortcut: '#', insert: '# ' },
      { id: 'h2', icon: 'H2', title: 'Encabezado 2', desc: 'Subtítulo mediano', shortcut: '##', insert: '## ' },
      { id: 'h3', icon: 'H3', title: 'Encabezado 3', desc: 'Subtítulo pequeño', shortcut: '###', insert: '### ' },
      { id: 'bullet', icon: '•', title: 'Lista con viñetas', desc: 'Lista simple', shortcut: '-', insert: '- ' },
      { id: 'num', icon: '1.', title: 'Lista numerada', desc: 'Lista ordenada', shortcut: '1.', insert: '1. ' },
      { id: 'todo', icon: '✓', title: 'Lista de tareas', desc: 'Casilla de verificación', shortcut: '/todo', insert: '/todo ' },
      { id: 'toggle', icon: '▸', title: 'Lista desplegable', desc: 'Acordeón colapsable', shortcut: '>', insert: '> ' },
      { id: 'quote', icon: '”', title: 'Cita', desc: 'Cita textual', shortcut: '"', insert: '" ' },
      { id: 'divider', icon: '—', title: 'Línea divisoria', desc: 'Separador horizontal', shortcut: '---', insert: '/divider ' }
    ]
  },
  {
    group: 'Multimedia y Archivos',
    items: [
      { id: 'image', icon: 'IMG', title: 'Imagen', desc: 'Insertar imagen', shortcut: '/image', insert: '/image ' },
      { id: 'archivo', icon: 'FILE', title: 'Archivo', desc: 'Subir desde el equipo', shortcut: '/archivo', insert: '/archivo ' },
      { id: 'web', icon: 'URL', title: 'Marcador web', desc: 'Enlace visual / miniatura', shortcut: '/web', insert: '/web ' },
      { id: 'video', icon: 'VID', title: 'Video', desc: 'Incrustar video', shortcut: '/video', insert: '/video ' },
      { id: 'audio', icon: 'AUD', title: 'Audio', desc: 'Pista o nota de voz', shortcut: '/audio', insert: '/audio ' },
      { id: 'pdf', icon: 'PDF', title: 'PDF', desc: 'Documento PDF', shortcut: '/pdf', insert: '/pdf ' }
    ]
  },
  {
    group: 'Avanzados y Bases de Datos',
    items: [
      { id: 'page', icon: 'PG', title: 'Subpágina', desc: 'Crear página temática', shortcut: '/page', insert: '/page @' },
      { id: 'database', icon: 'DB', title: 'Base de datos / Vista', desc: 'Tabla o vista Notion', shortcut: '/database', insert: '/database ' },
      { id: 'code', icon: '</>', title: 'Código', desc: 'Bloque monoespaciado', shortcut: '/code', insert: '/code ' },
      { id: 'callout', icon: '!', title: 'Callout', desc: 'Párrafo destacado', shortcut: '/callout', insert: '/callout ' },
      { id: 'latex', icon: '∑', title: 'LaTeX', desc: 'Ecuación matemática', shortcut: '/latex', insert: '/latex ' },
      { id: 'boton', icon: 'BTN', title: 'Botón', desc: 'Automatización / plantilla', shortcut: '/botón', insert: '/botón ' },
      { id: 'duplicar', icon: 'DUP', title: 'Duplicar', desc: 'Clonar última nota', shortcut: '/duplicar', insert: '/duplicar' },
      { id: 'mover', icon: 'MOV', title: 'Mover', desc: 'Cambiar página destino', shortcut: '/mover', insert: '/mover @' },
      { id: 'eliminar', icon: 'DEL', title: 'Eliminar', desc: 'Borrar última nota', shortcut: '/eliminar', insert: '/eliminar' }
    ]
  }
];
