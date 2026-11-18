import { errorMessage, header, type ApiRequest, type ApiResponse } from './_lib/http.js';

/**
 * Modelos con respaldo: si uno está saturado (429/5xx) se prueba el siguiente.
 * Flash-Lite va primero: en el nivel gratuito permite ~500 solicitudes/día,
 * frente a ~20/día de 3.8 Flash. GEMINI_MODEL / CLAUDE_MODEL fuerzan otros (separar con comas).
 */
const GEMINI_MODELS = (process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite,gemini-3.8-flash,gemini-3.6-flash')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';

type ErrorCode = 'missing_key' | 'unavailable' | 'rejected';

/** Error de proveedor con el código que ve la UI. */
class ProviderError extends Error {
  constructor(message: string, readonly code: ErrorCode, readonly status: number) {
    super(message);
  }
}

/** Saturación o límites: vale la pena probar otro modelo. */
const isTransient = (status: number) => status === 429 || status >= 500;

async function callGemini(key: string, prompt: string, opts: { json?: boolean; system?: string } = {}): Promise<{ text: string; model: string }> {
  let last: ProviderError | undefined;
  for (const model of GEMINI_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
        contents: [{ parts: [{ text: prompt }] }],
        ...(opts.json ? { generationConfig: { responseMimeType: 'application/json' } } : {})
      })
    });
    const data: any = await r.json().catch(() => ({}));
    if (r.ok) {
      const text = (data.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
      return { text, model };
    }
    const message = data?.error?.message || `Gemini respondió ${r.status}`;
    // 404 = modelo inexistente para esta llave → también se prueba el siguiente
    if (isTransient(r.status) || r.status === 404) {
      last = new ProviderError(message, 'unavailable', r.status);
      continue;
    }
    throw new ProviderError(message, 'rejected', r.status);
  }
  throw last || new ProviderError('Gemini no respondió', 'unavailable', 503);
}

async function callClaude(key: string, prompt: string, system?: string): Promise<{ text: string; model: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data: any = await r.json().catch(() => ({}));
    if (r.ok) return { text: data.content?.find((c: any) => c.type === 'text')?.text || '', model: CLAUDE_MODEL };
    const message = data?.error?.message || `Claude respondió ${r.status}`;
    if (!isTransient(r.status) && r.status !== 529) throw new ProviderError(message, 'rejected', r.status);
    if (attempt === 0) await new Promise((ok) => setTimeout(ok, 1200));
    else throw new ProviderError(message, 'unavailable', r.status);
  }
  throw new ProviderError('Claude no respondió', 'unavailable', 503);
}

/**
 * Ejecuta con el proveedor preferido y, si está caído o saturado, con el otro.
 * Devuelve también qué proveedor respondió para mostrarlo en la tarjeta.
 */
async function withFallback(
  prefer: 'gemini' | 'claude',
  keys: { gemini?: string; claude?: string },
  run: { gemini: (k: string) => Promise<{ text: string; model: string }>; claude: (k: string) => Promise<{ text: string; model: string }> }
): Promise<{ text: string; model: string; provider: 'Gemini' | 'Claude'; fallback: boolean }> {
  const order: ('gemini' | 'claude')[] = prefer === 'gemini' ? ['gemini', 'claude'] : ['claude', 'gemini'];
  const available = order.filter((p) => keys[p]);
  if (available.length === 0) {
    throw new ProviderError(`Falta configurar ${prefer === 'gemini' ? 'GEMINI_API_KEY' : 'CLAUDE_API_KEY'}`, 'missing_key', 401);
  }
  let last: unknown;
  for (const p of available) {
    try {
      const r = await run[p](keys[p]!);
      return { ...r, provider: p === 'gemini' ? 'Gemini' : 'Claude', fallback: p !== prefer };
    } catch (err) {
      last = err;
      // Una llave rechazada (inválida, sin crédito) no se tapa con el otro proveedor si era el pedido explícito
      if (err instanceof ProviderError && err.code === 'rejected' && p === prefer && available.length === 1) throw err;
    }
  }
  throw last;
}

function parseJson(text: string): any {
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mode, prompt, availableTopics, recentContext, schema, today, history } = (req.body || {}) as {
    mode?: 'gemini' | 'claude' | 'auto' | 'extract';
    prompt?: string;
    availableTopics?: string[];
    recentContext?: string;
    schema?: unknown;
    today?: string;
    /** Últimos mensajes del chat de Senda, del más viejo al más nuevo */
    history?: { role: 'user' | 'assistant'; text: string }[];
  };
  if (!prompt) return res.status(400).json({ error: 'Falta el texto a procesar.' });

  const keys = {
    gemini: header(req, 'x-gemini-key') || process.env.GEMINI_API_KEY,
    claude: header(req, 'x-claude-key') || process.env.CLAUDE_API_KEY
  };

  const transcript = (Array.isArray(history) ? history : [])
    .slice(-12)
    .map((h) => `${h.role === 'assistant' ? 'Asistente' : 'Usuario'}: ${String(h.text).slice(0, 1500)}`)
    .join('\n');

  const systemInstruction = `Eres el asistente de Senda, la bandeja de entrada rápida del usuario hacia su Notion.
El usuario anota ideas, tareas y notas de obra (es ingeniero civil) y a veces te hace preguntas: respóndelas en español, breve y directo, como en un chat.
Si conviene, sugiere cómo anotarlo en Senda (p. ej. "#tarea mañana 8h …").
Temas/páginas disponibles: ${JSON.stringify(availableTopics || [])}.
${transcript ? `Conversación reciente (para contexto):\n${transcript}` : `Contexto reciente: ${recentContext || 'Ninguno'}.`}
${
    // El formato JSON SOLO para /auto: si va en el chat normal, el modelo responde JSON crudo
    mode === 'auto'
      ? `Devuelve exclusivamente un JSON válido con:
{"topic": "clave_del_tema", "blockType": "text|todo|callout|h2", "cleanText": "texto limpio", "relatedTopics": ["tema1"], "summary": "explicación breve en español"}`
      : 'Responde en texto natural (puedes usar listas con guiones). Nunca respondas con JSON ni bloques de código salvo que te lo pidan.'
  }`;

  try {
    // extract: completar propiedades de una base de Notion a partir del texto
    if (mode === 'extract') {
      const extractPrompt = `Convierte la nota en propiedades para una base de Notion.
Hoy es ${today || new Date().toISOString()} (usa esa zona horaria).
Esquema (usa SOLO estas propiedades y, en select/relation, SOLO estas opciones):
${JSON.stringify(schema || [])}
Devuelve exclusivamente JSON válido:
{"title": "título breve en infinitivo, sin la fecha", "date": "ISO 8601 con zona horaria, o null", "selects": {"Propiedad": "Opción"}, "relations": {"Propiedad": ["Título de la fila, sin lo que va entre paréntesis"]}}
Omite lo que no puedas deducir con seguridad.
Nota: ${prompt}`;
      const r = await withFallback('gemini', keys, {
        gemini: (k) => callGemini(k, extractPrompt, { json: true }),
        claude: (k) => callClaude(k, extractPrompt)
      });
      return res.status(200).json({ model: r.provider, parsed: parseJson(r.text) });
    }

    const prefer = mode === 'claude' ? 'claude' : 'gemini';
    const r = await withFallback(prefer, keys, {
      gemini: (k) => callGemini(k, prompt, { json: mode === 'auto', system: systemInstruction }),
      claude: (k) => callClaude(k, prompt, systemInstruction)
    });
    const label = `${r.provider}${mode === 'auto' ? ' Auto' : ''}${r.fallback ? ' (respaldo)' : ''}`;

    if (mode === 'auto') {
      try {
        return res.status(200).json({ model: label, parsed: parseJson(r.text) });
      } catch {
        return res.status(200).json({ model: label, text: r.text });
      }
    }
    return res.status(200).json({ model: label, text: r.text || 'Sin respuesta.' });
  } catch (err) {
    if (err instanceof ProviderError) {
      return res.status(err.code === 'missing_key' ? 401 : err.code === 'unavailable' ? 503 : 502).json({ error: err.message, code: err.code });
    }
    return res.status(500).json({ error: errorMessage(err), code: 'unavailable' });
  }
}
