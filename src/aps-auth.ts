/**
 * Autodesk Platform Services (APS) 2-legged OAuth and API helpers.
 */

const APS_TOKEN_URL = "https://developer.api.autodesk.com/authentication/v2/token";
const APS_PROJECT_BASE = "https://developer.api.autodesk.com/project/v1";

export interface ApsTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

const DEFAULT_SCOPE = "data:read";

let cachedToken: {
  token: string;
  expiresAt: number;
  scope: string;
} | null = null;

/**
 * Get a 2-legged access token. Uses in-memory cache until near expiry.
 * @param scope - APS OAuth scope(s), space-separated (e.g. "data:read" or "data:read data:write"). Defaults to "data:read".
 */
export async function getApsToken(
  clientId: string,
  clientSecret: string,
  scope?: string
): Promise<string> {
  const effectiveScope = (scope?.trim() || DEFAULT_SCOPE);
  const now = Date.now();
  if (
    cachedToken &&
    cachedToken.expiresAt > now + 60_000 &&
    cachedToken.scope === effectiveScope
  ) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: effectiveScope,
  });

  const res = await fetch(APS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`APS token failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as ApsTokenResponse;
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in - 60) * 1000,
    scope: effectiveScope,
  };
  return data.access_token;
}

/**
 * Call APS Project (Data Management) API with 2-legged auth.
 */
export async function apsProjectGet(
  path: string,
  token: string
): Promise<unknown> {
  const url = path.startsWith("http") ? path : `${APS_PROJECT_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`APS API failed (${res.status}): ${text}`);
  }
  return res.json();
}
