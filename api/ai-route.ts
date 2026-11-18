import { errorMessage, header, type ApiRequest, type ApiResponse } from './_lib/http.js';

// Modelos configurables por entorno; los valores por defecto son los vigentes.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mode, prompt, availableTopics, recentContext } = (req.body || {}) as {
    mode?: 'gemini' | 'claude' | 'auto';
    prompt?: string;
    availableTopics?: string[];
    recentContext?: string;
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
