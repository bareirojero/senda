import { errorMessage, header, type ApiRequest, type ApiResponse } from './_lib/http.js';

// Modelos configurables por entorno; los valores por defecto son los vigentes.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

async function callGemini(key: string, prompt: string, json: boolean): Promise<string> {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {})
    })
  });
  const data: any = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Gemini respondió ${r.status}`);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function callClaude(key: string, prompt: string): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
  });
  const data: any = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `Claude respondió ${r.status}`);
  return data.content?.find((c: any) => c.type === 'text')?.text || '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mode, prompt, availableTopics, recentContext, schema, today } = (req.body || {}) as {
    mode?: 'gemini' | 'claude' | 'auto' | 'extract';
    prompt?: string;
    availableTopics?: string[];
    recentContext?: string;
    schema?: unknown;
    today?: string;
  };
  if (!prompt) return res.status(400).json({ error: 'Falta el texto a procesar.' });

  const geminiKey = header(req, 'x-gemini-key') || process.env.GEMINI_API_KEY;
  const claudeKey = header(req, 'x-claude-key') || process.env.CLAUDE_API_KEY;

  const systemInstruction = `Eres el motor de organización de Senda, un hub minimalista conectado a Notion.
Temas disponibles del usuario: ${JSON.stringify(availableTopics || [])}.
Contexto reciente: ${recentContext || 'Ninguno'}.
Si el modo es "auto", devuelve exclusivamente un JSON válido con:
{"topic": "clave_del_tema", "blockType": "text|todo|callout|h2", "cleanText": "texto limpio", "relatedTopics": ["tema1"], "summary": "explicación breve en español"}
Si el modo es "gemini" o "claude", responde en español de forma concisa, estructurada y lista para guardarse en Notion.`;

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
    try {
      const text = claudeKey && !geminiKey ? await callClaude(claudeKey, extractPrompt) : geminiKey ? await callGemini(geminiKey, extractPrompt, true) : null;
      if (text === null) return res.status(401).json({ error: 'Falta configurar GEMINI_API_KEY o CLAUDE_API_KEY' });
      return res.status(200).json({ parsed: JSON.parse(text.replace(/```json|```/g, '').trim()) });
    } catch (err) {
      return res.status(502).json({ error: errorMessage(err) });
    }
  }

  try {
    // Claude (Anthropic)
    if (mode === 'claude') {
      if (!claudeKey) return res.status(401).json({ error: 'Falta configurar CLAUDE_API_KEY' });
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 800,
          system: systemInstruction,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data: any = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Error de Claude' });
      const text = data.content?.find((c: any) => c.type === 'text')?.text || 'Sin respuesta de Claude.';
      return res.status(200).json({ model: 'Claude', text });
    }

    // Gemini (Google AI) — por defecto para /gemini y /auto
    if (!geminiKey) return res.status(401).json({ error: 'Falta configurar GEMINI_API_KEY' });

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ parts: [{ text: prompt }] }],
        ...(mode === 'auto' ? { generationConfig: { responseMimeType: 'application/json' } } : {})
      })
    });

    const data: any = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Error de Gemini' });
    const rawText: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (mode === 'auto') {
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      try {
        return res.status(200).json({ model: 'Gemini Auto', parsed: JSON.parse(cleaned) });
      } catch {
        return res.status(200).json({ model: 'Gemini Auto', text: rawText });
      }
    }

    return res.status(200).json({ model: 'Gemini', text: rawText });
  } catch (err) {
    return res.status(500).json({ error: errorMessage(err) });
  }
}
