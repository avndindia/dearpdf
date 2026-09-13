import { json, type Env } from "./env";

export const COOKIE_NAME = "dp_admin";
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function b64urlEncode(bytes: Uint8Array) {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function sign(secret: string, payload: string) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload));
  return b64urlEncode(new Uint8Array(sig));
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function passwordsMatch(provided: string, expected: string) {
  const [left, right] = await Promise.all([sha256(provided), sha256(expected)]);
  return timingSafeEqual(left, right);
}

export function readCookie(request: Request, name = COOKIE_NAME) {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

export function cookieHeader(value: string, maxAgeSeconds: number) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  return parts.join("; ");
}

export function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createSessionCookie(secret: string) {
  const payload = b64urlEncode(new TextEncoder().encode(JSON.stringify({ exp: Date.now() + SESSION_MS })));
  const signature = await sign(secret, payload);
  return cookieHeader(`${payload}.${signature}`, SESSION_MS / 1000);
}

export async function verifySession(request: Request, secret: string) {
  const raw = readCookie(request);
  if (!raw) return false;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  let expected: string;
  try {
    expected = await sign(secret, payload);
  } catch {
    return false;
  }
  if (!timingSafeEqual(b64urlDecode(signature), b64urlDecode(expected))) return false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as { exp?: number };
    return typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export function missingPasswordResponse() {
  return json({ error: "Admin password not configured" }, 503);
}

export function missingSecretResponse() {
  return json({ error: "Admin session secret not configured" }, 503);
}

export function requireAdminSecrets(env: Env) {
  if (!env.ADMIN_PASSWORD) return missingPasswordResponse();
  if (!env.ADMIN_SESSION_SECRET) return missingSecretResponse();
  return null;
}

export async function requireAdmin(request: Request, env: Env) {
  const missing = requireAdminSecrets(env);
  if (missing) return missing;
  if (!(await verifySession(request, env.ADMIN_SESSION_SECRET as string))) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}
