import { appOrigin, errorMessage, queryParam, type ApiRequest, type ApiResponse } from './_lib/http.js';
import { consumeState, writeSession } from './_lib/session.js';

interface NotionTokenResponse {
  access_token: string;
  refresh_token?: string;
  bot_id: string;
  workspace_id: string;
  workspace_name?: string | null;
  owner?: { type: 'user'; user?: { name?: string | null; avatar_url?: string | null } } | { type: 'workspace' };
  error?: string;
  error_description?: string;
}

function fail(res: ApiResponse, reason: string) {
  return res.redirect(302, '/?notion=error&reason=' + encodeURIComponent(reason));
}

/**
 * GET /api/oauth-callback?code=…&state=…
 * Intercambia el código por un access_token y lo guarda en la cookie cifrada.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const error = queryParam(req, 'error');
  if (error) return fail(res, error === 'access_denied' ? 'Autorización cancelada' : error);

  if (!consumeState(req, res, queryParam(req, 'state'))) {
    return fail(res, 'Estado OAuth inválido o vencido; vuelve a intentarlo');
  }

  const code = queryParam(req, 'code');
  if (!code) return fail(res, 'Notion no devolvió código de autorización');

  const clientId = process.env.NOTION_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET || '';

  try {
    const r = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${appOrigin(req)}/api/oauth-callback`
      })
    });
    const data = (await r.json()) as NotionTokenResponse;
    if (!r.ok || !data.access_token) {
      return fail(res, data.error_description || data.error || `Notion respondió ${r.status}`);
    }

    const user = data.owner?.type === 'user' ? data.owner.user : undefined;
    writeSession(res, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      botId: data.bot_id,
      workspaceId: data.workspace_id,
      workspaceName: data.workspace_name ?? null,
      userName: user?.name ?? null,
      userAvatar: user?.avatar_url ?? null
    });

    return res.redirect(302, '/?notion=connected');
  } catch (err) {
    return fail(res, errorMessage(err));
  }
}
