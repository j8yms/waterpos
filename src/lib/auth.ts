import crypto from "crypto";
import { getUsersFromSheet } from "./sheets";
import { MASTER_ADMIN, MASTER_PIN } from "./config";
import type { Role, User } from "./types";

export const TOKEN_TTL_SECONDS = 12 * 60 * 60;

function appSecret(): string {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    // No APP_SECRET configured: fall back to a stable deterministic key so
    // login never hard-crashes (Render may omit it). Override in Env Vars.
    if (!process.env.NEXT_PUBLIC_STATIC) {
      console.warn(
        "[auth] APP_SECRET is not set — using dev fallback secret. Set APP_SECRET in Env Vars for production."
      );
    }
    return "waterpos-dev-fallback-secret";
  }
  return secret;
}

export function isMasterPin(pin: string): boolean {
  return String(pin ?? "").trim() === MASTER_PIN;
}

export function masterUser(): User {
  return { id: MASTER_ADMIN.id, name: MASTER_ADMIN.name, role: MASTER_ADMIN.role };
}

export type LoginResult =
  | { status: "ok"; user: User }
  | { status: "pending"; user: User }
  | { status: "suspended"; user: User }
  | { status: "invalid" };

/**
 * Authenticate by PIN alone.
 * The hidden master PIN (0800) always wins and bypasses the staff sheet;
 * users awaiting a self-service PIN reset can never authenticate this way.
 */
export async function authenticatePin(pin: string): Promise<User | null> {
  const normalized = String(pin || "").trim();
  if (!/^\d{4}$/.test(normalized)) return null;
  if (normalized === MASTER_PIN) return masterUser();

  const users = await getUsersFromSheet();
  const match = users.find((u) => u.pin === normalized && !u.is_reset_pending);
  if (!match) return null;
  if (match.isSuspended) return null;

  return { id: match.id, name: match.name, role: match.role as Role };
}

/**
 * Authenticate a named worker. Pending-reset accounts are intercepted and
 * reported back so the login canvas can open the PIN onboarding form.
 */
export async function authenticateIdentity(name: string, pin: string): Promise<LoginResult> {
  const normalizedPin = String(pin || "").trim();
  if (!/^\d{4}$/.test(normalizedPin)) return { status: "invalid" };
  if (normalizedPin === MASTER_PIN) return { status: "ok", user: masterUser() };

  const target = String(name || "").trim().toLowerCase();
  if (!target) return { status: "invalid" };

  const users = await getUsersFromSheet();
  const match = users.find((u) => u.name.trim().toLowerCase() === target);
  if (!match) return { status: "invalid" };

  const identity: User = { id: match.id, name: match.name, role: match.role as Role };
  if (match.isSuspended) return { status: "suspended", user: identity };
  if (match.is_reset_pending) return { status: "pending", user: identity };
  if (match.pin !== normalizedPin) return { status: "invalid" };
  return { status: "ok", user: identity };
}

export function signToken(user: User): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      name: user.name,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    })
  ).toString("base64url");

  const sig = crypto.createHmac("sha256", appSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): User | null {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", appSecret()).update(payload).digest("base64url");
  if (sig !== expected) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    const rawRole = String(data.role);
    const role: Role = rawRole === "master" ? "master" : rawRole === "rider" ? "rider" : "management";
    return {
      id: String(data.sub),
      name: String(data.name),
      role,
    };
  } catch {
    return null;
  }
}

export function bearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export function requireUser(request: Request): User | null {
  const token = bearerToken(request);
  if (!token) return null;
  return verifyToken(token);
}

/** The hidden master account is a strict superset of management access. */
export function isAdminUser(user: User | null): boolean {
  return !!user && (user.role === "management" || user.role === "master");
}

export function requireRole(request: Request, role: Role): User | null {
  const user = requireUser(request);
  if (!user) return null;
  if (role === "rider" && user.role === "rider") return user;
  if (role === "management" && isAdminUser(user)) return user;
  if (role === "master" && user.role === "master") return user;
  return null;
}

export function toSafeUser(user: User) {
  return { id: user.id, name: user.name, role: user.role };
}