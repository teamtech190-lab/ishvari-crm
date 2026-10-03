import { bindings } from "./bindings.server";
import { constantTimeEqual, newAdminAuth, passwordHash, sessionSignature, validSession, type AdminAuth } from "./crm-crypto";
const COOKIE = "ishvari_crm_session";
const MAX_AGE = 60 * 60 * 12;
const OLD_SEED_HASH = "a6710a89c303084ffe954a1ab9fac7052cabd6e7bef0459fcb1e02f6487e2865";
export function requireDb() {
  const db = bindings().DB;
  if (!db) throw new Error("CRM database binding DB is not configured.");
  return db;
}
async function adminAuth(): Promise<AdminAuth | null> {
  const db = requireDb();
  const existing = await db.prepare("SELECT salt,password_hash FROM admin_auth WHERE id=1").first<AdminAuth>();
  if (existing && existing.password_hash !== OLD_SEED_HASH) return existing;
  const password = bindings().CRM_PASSWORD;
  if (!password || password.length < 8 || password.length > 256) throw new Error("Set CRM_PASSWORD to an admin password of 8 to 256 characters in Worker secrets.");
  const next = await newAdminAuth(password);
  if (existing) await db.prepare("UPDATE admin_auth SET salt=?,password_hash=?,updated_at=datetime('now') WHERE id=1 AND password_hash=?").bind(next.salt,next.password_hash,OLD_SEED_HASH).run();
  else await db.prepare("INSERT OR IGNORE INTO admin_auth (id,salt,password_hash) VALUES (1,?,?)").bind(next.salt,next.password_hash).run();
  return db.prepare("SELECT salt,password_hash FROM admin_auth WHERE id=1").first<AdminAuth>();
}
export async function checkAdminPassword(password: string) {
  const auth = await adminAuth();
  return !!auth && constantTimeEqual(await passwordHash(password,auth.salt),auth.password_hash);
}
async function sessionSecret() {
  const auth = await adminAuth();
  if (!auth) throw new Error("CRM authentication is not initialized.");
  // Changing the stored password invalidates all older sessions.
  return `${auth.salt}:${auth.password_hash}`;
}
export async function makeSessionCookie() {
  const payload = `admin.${Math.floor(Date.now()/1000) + MAX_AGE}`;
  return `${COOKIE}=${payload}.${await sessionSignature(payload,await sessionSecret())}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}
export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
export async function isAuthenticated(request: Request) {
  const raw = request.headers.get("Cookie")?.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="))?.slice(COOKIE.length+1);
  if (!raw) return false;
  return validSession(raw,await sessionSecret());
}
export async function changePassword(password: string) {
  const auth = await newAdminAuth(password);
  await requireDb().prepare("UPDATE admin_auth SET salt=?,password_hash=?,updated_at=datetime('now') WHERE id=1").bind(auth.salt,auth.password_hash).run();
}
