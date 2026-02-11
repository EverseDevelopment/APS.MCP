/**
 * Autodesk Platform Services (APS) 2-legged OAuth and API helpers.
 * Supports all Data Management API endpoints per datamanagement.yaml.
 */

const APS_TOKEN_URL = "https://developer.api.autodesk.com/authentication/v2/token";
const APS_BASE = "https://developer.api.autodesk.com";

/** Structured error thrown by APS API calls. Carries status code + body for rich error context. */
export class ApsApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly method: string,
    public readonly path: string,
    public readonly responseBody: string,
  ) {
    super(`APS API ${method} ${path} failed (${statusCode}): ${responseBody}`);
    this.name = "ApsApiError";
  }
}

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

export type ApsDmMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApsDmRequestOptions {
  /** Query parameters (e.g. page[number], filter[type]). */
  query?: Record<string, string | number | boolean | string[] | undefined>;
  /** Request body for POST/PATCH (JSON). */
  body?: unknown;
  /** Extra headers (e.g. x-user-id, Content-Type). */
  headers?: Record<string, string>;
}

/**
 * Call any Data Management API endpoint (project/v1 or data/v1).
 * Path is relative to APS_BASE, e.g. "project/v1/hubs" or "data/v1/projects/b.xxx/folders/urn:.../contents".
 * Supports GET, POST, PATCH, DELETE per datamanagement.yaml.
 */
export async function apsDmRequest(
  method: ApsDmMethod,
  path: string,
  token: string,
  options: ApsDmRequestOptions = {}
): Promise<unknown> {
  const normalized = path.startsWith("http") ? path : path.replace(/^\//, "");
  const url = new URL(normalized.startsWith("http") ? normalized : `${APS_BASE}/${normalized}`);

  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        v.forEach((val) => url.searchParams.append(k, String(val)));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };
  if ((method === "POST" || method === "PATCH") && options.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/vnd.api+json";
  }

  const init: RequestInit = { method, headers };
  if (options.body !== undefined && (method === "POST" || method === "PATCH")) {
    init.body = JSON.stringify(options.body);
  }

  const res = await fetch(url.toString(), init);
  if (!res.ok) {
    const text = await res.text();
    throw new ApsApiError(res.status, method, url.pathname, text);
  }
  if (res.status === 204) {
    return { ok: true, status: 204 };
  }
  const text = await res.text();
  if (!text) {
    return { ok: true, status: res.status };
  }
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through to return body as text
    }
  }
  return { ok: true, status: res.status, body: text };
}
