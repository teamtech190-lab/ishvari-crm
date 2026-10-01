import { bindings } from "./bindings.server";

const COOKIE = "ishvari_crm_session";
const MAX_AGE = 60 * 60 * 12;

function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(value: string) {
  const s = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const raw = atob(s);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function sign(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
}
async function verify(payload: string, signature: string, secret: string) {
  const expected = fromB64url(await sign(payload, secret));
  const actual = fromB64url(signature);
  if (expected.byteLength !== actual.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
  return diff === 0;
}

export async function makeSessionCookie() {
  const secret = bindings().CRM_PASSWORD;
  if (!secret) throw new Error("CRM_PASSWORD secret is not configured.");
  const exp = Math.floor(Date.now()/1000) + MAX_AGE;
  const payload = `admin.${exp}`;
  const sig = await sign(payload, secret);
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}
export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
export async function isAuthenticated(request: Request) {
  const secret = bindings().CRM_PASSWORD;
  if (!secret) return false;
  const raw = request.headers.get("Cookie")?.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);
  if (!raw) return false;
  const separator = raw.lastIndexOf(".");
  if (separator <= 0 || separator === raw.length - 1) return false;
  const payload = raw.slice(0, separator);
  const sig = raw.slice(separator + 1);
  const [role, expText] = payload.split(".");
  if (role !== "admin" || !/^\d+$/.test(expText) || Number(expText) < Math.floor(Date.now()/1000)) return false;
  return verify(payload, sig, secret);
}
export function requireDb() {
  const db = bindings().DB;
  if (!db) throw new Error("CRM database is not configured.");
  return db;
}
