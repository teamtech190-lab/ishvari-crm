export type AdminAuth = { salt: string; password_hash: string };
const encoder = new TextEncoder();
export function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function passwordHash(password: string, salt: string) {
  if (salt.startsWith("pbkdf2:")) {
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt:encoder.encode(salt), iterations:100000}, key, 256);
    return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2,"0")).join("");
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(salt + password));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
}
export async function newAdminAuth(password: string): Promise<AdminAuth> {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const salt = "pbkdf2:" + Array.from(bytes, b => b.toString(16).padStart(2,"0")).join("");
  return {salt, password_hash:await passwordHash(password, salt)};
}
export async function sessionSignature(payload: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
export async function validSession(raw: string, secret: string, now = Math.floor(Date.now()/1000)) {
  const parts = raw.split(".");
  if (parts.length !== 3) return false;
  const [role, expiration, signature] = parts;
  if (role !== "admin" || !/^\d+$/.test(expiration) || Number(expiration) <= now || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
  return constantTimeEqual(signature, await sessionSignature(`${role}.${expiration}`, secret));
}
