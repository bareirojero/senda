import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import login from '../api/oauth-login';
import callback from '../api/oauth-callback';
import logout from '../api/oauth-logout';
import { readSession, seal, unseal, SESSION_COOKIE, STATE_COOKIE } from '../api/_lib/session';

/** Simula req/res de las funciones Node de Vercel. */
function mockReq(opts: { method?: string; query?: Record<string, string>; cookies?: Record<string, string>; headers?: Record<string, string> } = {}) {
  return {
    method: opts.method || 'GET',
    query: opts.query || {},
    cookies: opts.cookies || {},
    headers: { host: 'senda.test', 'x-forwarded-proto': 'https', ...(opts.headers || {}) },
    body: undefined
  } as any;
}

function mockRes() {
  const headers: Record<string, any> = {};
  const res: any = {
    statusCode: 200,
    location: '',
    body: undefined as unknown,
    getHeader: (k: string) => headers[k.toLowerCase()],
    setHeader: (k: string, v: any) => { headers[k.toLowerCase()] = v; },
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; },
    send(b: unknown) { res.body = b; return res; },
    end() { return res; },
    redirect(code: number, url: string) { res.statusCode = code; res.location = url; return res; },
    headers
  };
  return res;
}

function cookieValue(res: any, name: string): string {
  const list: string[] = res.headers['set-cookie'] || [];
  const c = list.find((x) => x.startsWith(name + '='));
  return c ? c.split(';')[0]!.slice(name.length + 1) : '';
}

beforeEach(() => {
  process.env.NOTION_OAUTH_CLIENT_ID = 'client-id';
  process.env.NOTION_OAUTH_CLIENT_SECRET = 'client-secret';
  process.env.SESSION_SECRET = 'x'.repeat(40);
  delete process.env.APP_URL;
});

afterEach(() => vi.unstubAllGlobals());

describe('sesión cifrada', () => {
  it('seal/unseal es reversible y detecta manipulación', () => {
    const token = seal({ a: 1 });
    expect(unseal(token)).toEqual({ a: 1 });
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    expect(unseal(tampered)).toBeNull();
  });
});

describe('GET /api/oauth-login', () => {
  it('redirige a Notion con state y redirect_uri', () => {
    const res = mockRes();
    login(mockReq(), res);
    expect(res.statusCode).toBe(302);
    const url = new URL(res.location);
    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('owner')).toBe('user');
    expect(url.searchParams.get('redirect_uri')).toBe('https://senda.test/api/oauth-callback');
    expect(url.searchParams.get('state')).toBe(cookieValue(res, STATE_COOKIE));
  });

  it('avisa si OAuth no está configurado', () => {
    delete process.env.NOTION_OAUTH_CLIENT_ID;
    const res = mockRes();
    login(mockReq(), res);
    expect(res.location).toMatch(/^\/\?notion=error/);
  });
});

describe('GET /api/oauth-callback', () => {
  it('rechaza un state que no coincide', async () => {
    const res = mockRes();
    await callback(mockReq({ query: { code: 'c', state: 'malo' }, cookies: { [STATE_COOKIE]: 'bueno' } }), res);
    expect(res.location).toMatch(/notion=error/);
  });

  it('intercambia el código y guarda la sesión', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'ntn_oauth',
        bot_id: 'bot',
        workspace_id: 'ws',
        workspace_name: 'Workspace JB',
        owner: { type: 'user', user: { name: 'Jerónimo Bareiro', avatar_url: null } }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await callback(mockReq({ query: { code: 'abc', state: 'st' }, cookies: { [STATE_COOKIE]: 'st' } }), res);

    expect(res.location).toBe('/?notion=connected');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.notion.com/v1/oauth/token');
    expect(init.headers.Authorization).toBe('Basic ' + Buffer.from('client-id:client-secret').toString('base64'));
    expect(JSON.parse(init.body)).toMatchObject({ grant_type: 'authorization_code', code: 'abc' });

    const session = readSession(mockReq({ cookies: { [SESSION_COOKIE]: cookieValue(res, SESSION_COOKIE) } }));
    expect(session).toMatchObject({ accessToken: 'ntn_oauth', userName: 'Jerónimo Bareiro', workspaceName: 'Workspace JB' });
  });
});

describe('POST /api/oauth-logout', () => {
  it('borra la cookie', () => {
    const res = mockRes();
    logout(mockReq({ method: 'POST' }), res);
    expect(res.headers['set-cookie'][0]).toMatch(/Max-Age=0/);
  });
});
