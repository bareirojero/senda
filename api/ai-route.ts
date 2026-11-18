export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mode, prompt, availableTopics, recentContext } = req.body;
  const geminiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
  const claudeKey = req.headers['x-claude-key'] || process.env.CLAUDE_API_KEY;

  const systemInstruction = `Eres el motor de organización de Senda, un hub minimalista conectado a Notion.
Temas disponibles del usuario: ${JSON.stringify(availableTopics)}.
Contexto reciente: ${recentContext || 'Ninguno'}.
Si el modo es "auto", devuelve exclusivamente un JSON válido con:
{"topic": "clave_del_tema", "blockType": "text|todo|callout|h2", "cleanText": "texto limpio", "relatedTopics": ["tema1"], "summary": "explicación breve en español"}
Si el modo es "gemini" o "claude", responde en español de forma concisa, estructurada y lista para guardarse en Notion.`;

  try {
    // Llamada a Claude (Anthropic)
    if (mode === 'claude' && claudeKey) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-7-sonnet-latest',
          max_tokens: 800,
          system: systemInstruction,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await r.json();
      const text = data.content?.[0]?.text || 'Sin respuesta de Claude.';
      return res.status(200).json({ model: 'Claude', text });
    }

    // Llamada a Gemini (Google AI) - por defecto para /gemini y /auto
    if (!geminiKey) {
      return res.status(401).json({ error: 'Falta configurar GEMINI_API_KEY' });
    }

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    const data = await r.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (mode === 'auto') {
      const cleanedJson = rawText.replace(/```json|```/g, '').trim();
      return res.status(200).json({ model: 'Gemini Auto', parsed: JSON.parse(cleanedJson) });
    }

    return res.status(200).json({ model: 'Gemini', text: rawText });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
