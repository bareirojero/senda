import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../api/ai-route';

function call(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; }
  };
  const req: any = { method: 'POST', headers, body, query: {}, cookies: {} };
  return (handler(req, res) as Promise<unknown>).then(() => res);
}

const ok = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });
const fail = (status: number, message: string) => ({ ok: false, status, json: async () => ({ error: { message } }) });
const geminiText = (text: string) => ok({ candidates: [{ content: { parts: [{ text }] } }] });

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.CLAUDE_API_KEY;
});
afterEach(() => vi.unstubAllGlobals());

describe('ai-route con respaldo de modelos', () => {
  it('si el primer modelo de Gemini está saturado, usa el siguiente', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fail(503, 'This model is currently experiencing high demand.'))
      .mockResolvedValueOnce(geminiText('hola desde el respaldo'));
    vi.stubGlobal('fetch', fetchMock);

    const res = await call({ mode: 'gemini', prompt: 'hola' }, { 'x-gemini-key': 'AIza-test' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ model: 'Gemini', text: 'hola desde el respaldo' });
    expect(fetchMock.mock.calls[0]![0]).toContain('gemini-3.8-flash');
    expect(fetchMock.mock.calls[1]![0]).toContain('gemini-3.6-flash');
  });

  it('si todo Gemini está caído y hay llave de Claude, responde Claude (respaldo)', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(url.includes('anthropic') ? ok({ content: [{ type: 'text', text: 'soy Claude' }] }) : fail(503, 'high demand'))
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await call({ mode: 'gemini', prompt: 'hola' }, { 'x-gemini-key': 'AIza', 'x-claude-key': 'sk-ant' });
    expect(res.body).toEqual({ model: 'Claude (respaldo)', text: 'soy Claude' });
  });

  it('saturación sin respaldo → 503 "unavailable", no "falta la llave"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fail(503, 'high demand')));
    const res = await call({ mode: 'gemini', prompt: 'hola' }, { 'x-gemini-key': 'AIza' });
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('unavailable');
  });

  it('llave inválida → "rejected" sin probar otros modelos', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fail(400, 'API key not valid'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await call({ mode: 'gemini', prompt: 'hola' }, { 'x-gemini-key': 'mala' });
    expect(res.body).toMatchObject({ code: 'rejected', error: 'API key not valid' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sin llaves → "missing_key"', async () => {
    const res = await call({ mode: 'claude', prompt: 'hola' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'missing_key', error: 'Falta configurar CLAUDE_API_KEY' });
  });
});
