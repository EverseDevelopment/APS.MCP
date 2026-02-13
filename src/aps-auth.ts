/**
 * Autodesk Platform Services (APS) OAuth helpers.
 *
 * 2‑legged (client credentials)  – getApsToken()
 * 3‑legged (authorization code)  – performAps3loLogin(), getValid3loToken(), clear3loLogin()
 *
 * Supports all Data Management API endpoints per datamanagement.yaml.
 */

/** Escape special characters for safe HTML embedding. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { exec } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";

const APS_TOKEN_URL = "https://developer.api.autodesk.com/authentication/v2/token";
const APS_AUTHORIZE_URL = "https://developer.api.autodesk.com/authentication/v2/authorize";
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
  const isAbsolute = path.startsWith("http");
  if (isAbsolute) {
    const target = new URL(path);
    const allowed = new URL(APS_BASE);
    if (target.host !== allowed.host) {
      throw new Error(
        `Refusing to send APS token to foreign host '${target.host}'. ` +
        `Only requests to '${allowed.host}' are allowed. Use a relative path instead.`,
      );
    }
  }
  const normalized = isAbsolute ? path : path.replace(/^\//, "");
  const url = new URL(isAbsolute ? normalized : `${APS_BASE}/${normalized}`);

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

// ── 3‑legged OAuth (authorization code + PKCE‑optional) ─────────

/** Shape of the 3LO token data we persist to disk. */
interface Aps3loTokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  scope: string;
}

const TOKEN_DIR = join(homedir(), ".aps-mcp");
const TOKEN_FILE = join(TOKEN_DIR, "3lo-tokens.json");

function read3loCache(): Aps3loTokenData | null {
  try {
    if (!existsSync(TOKEN_FILE)) return null;
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as Aps3loTokenData;
  } catch {
    return null;
  }
}

function write3loCache(data: Aps3loTokenData): void {
  if (!existsSync(TOKEN_DIR)) mkdirSync(TOKEN_DIR, { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
}

function deleteCacheFile(): void {
  try {
    if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
  } catch {
    /* ignore */
  }
}

/** Open a URL in the user's default browser (cross‑platform). */
function openBrowser(url: string): void {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}

/** In‑memory cache so we don't re‑read the file every call. */
let cached3lo: Aps3loTokenData | null = null;

/**
 * Perform the interactive 3‑legged OAuth login.
 *
 * 1. Spins up a temporary HTTP server on `callbackPort`.
 * 2. Opens the user's browser to the APS authorize endpoint.
 * 3. Waits for the redirect callback with the authorization code.
 * 4. Exchanges the code for access + refresh tokens.
 * 5. Persists tokens to `~/.aps-mcp/3lo-tokens.json`.
 *
 * Resolves when the login is complete or rejects on timeout / error.
 */
export async function performAps3loLogin(
  clientId: string,
  clientSecret: string,
  scope: string,
  callbackPort = 8910,
): Promise<{ access_token: string; message: string }> {
  const redirectUri = `http://localhost:${callbackPort}/callback`;

  return new Promise((resolve, reject) => {
    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const reqUrl = new URL(req.url ?? "/", `http://localhost:${callbackPort}`);

        if (reqUrl.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const error = reqUrl.searchParams.get("error");
        if (error) {
          const desc = reqUrl.searchParams.get("error_description") ?? error;
          const safeDesc = escapeHtml(desc);
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            `<html><body><h2>Authorization failed</h2><p>${safeDesc}</p></body></html>`,
          );
          server.close();
          reject(new Error(`APS authorization failed: ${desc}`));
          return;
        }

        const code = reqUrl.searchParams.get("code");
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h2>Missing authorization code</h2></body></html>",
          );
          server.close();
          reject(new Error("No authorization code received in callback."));
          return;
        }

        // Exchange the authorization code for tokens
        try {
          const tokenBody = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret,
          });

          const tokenRes = await fetch(APS_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: tokenBody.toString(),
          });

          if (!tokenRes.ok) {
            const text = await tokenRes.text();
            const safeText = escapeHtml(text);
            res.writeHead(500, { "Content-Type": "text/html" });
            res.end(
              `<html><body><h2>Token exchange failed</h2><pre>${safeText}</pre></body></html>`,
            );
            server.close();
            reject(
              new Error(`Token exchange failed (${tokenRes.status}): ${safeText}`),
            );
            return;
          }

          const data = (await tokenRes.json()) as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
          };

          const cacheData: Aps3loTokenData = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Date.now() + (data.expires_in - 60) * 1000,
            scope,
          };
          write3loCache(cacheData);
          cached3lo = cacheData;

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h2>Logged in to APS</h2>" +
              "<p>You can close this tab and return to Claude Desktop.</p></body></html>",
          );
          server.close();

          resolve({
            access_token: data.access_token,
            message:
              `3-legged login successful. Tokens cached to ${TOKEN_FILE}. ` +
              "The token will auto-refresh when it expires.",
          });
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(
            `<html><body><h2>Error</h2><pre>${String(err)}</pre></body></html>`,
          );
          server.close();
          reject(err);
        }
      },
    );

    server.listen(callbackPort, () => {
      const authUrl = new URL(APS_AUTHORIZE_URL);
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("scope", scope);
      openBrowser(authUrl.toString());
    });

    // Give the user 2 minutes to complete login
    setTimeout(() => {
      server.close();
      reject(new Error("3LO login timed out after 2 minutes. Try again."));
    }, 120_000);
  });
}

/**
 * Return a valid 3LO access token if one exists (from cache or by refreshing).
 * Returns `null` when no 3LO session is active (caller should fall back to 2LO).
 */
export async function getValid3loToken(
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  if (!cached3lo) cached3lo = read3loCache();
  if (!cached3lo) return null;

  // Still valid?
  if (cached3lo.expires_at > Date.now() + 60_000) {
    return cached3lo.access_token;
  }

  // Attempt refresh
  if (cached3lo.refresh_token) {
    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: cached3lo.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        scope: cached3lo.scope,
      });

      const res = await fetch(APS_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (res.ok) {
        const data = (await res.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        };
        cached3lo = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + (data.expires_in - 60) * 1000,
          scope: cached3lo.scope,
        };
        write3loCache(cached3lo);
        return cached3lo.access_token;
      }
    } catch {
      // refresh failed – fall through to clear
    }
  }

  // Expired and refresh failed
  deleteCacheFile();
  cached3lo = null;
  return null;
}

/** Clear any cached 3LO tokens (in‑memory + on disk). */
export function clear3loLogin(): void {
  deleteCacheFile();
  cached3lo = null;
}
