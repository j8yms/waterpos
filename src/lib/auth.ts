import crypto from "crypto";
import { getUsersFromSheet } from "./sheets";
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

export async function authenticatePin(pin: string): Promise<User | null> {
  const normalized = String(pin || "").trim();
  if (!/^\d{4}$/.test(normalized)) return null;

  const users = await getUsersFromSheet();
  const match = users.find((u) => u.pin === normalized);
  if (!match) return null;

  return { id: match.id, name: match.name, role: match.role as Role };
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
    return {
      id: String(data.sub),
      name: String(data.name),
      role: String(data.role) === "rider" ? "rider" : "management",
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

export function requireRole(request: Request, role: Role): User | null {
  const user = requireUser(request);
  if (!user) return null;
  if (role === "rider" && user.role === "rider") return user;
  if (role === "management" && user.role === "management") return user;
  return null;
}

export function toSafeUser(user: User) {
  return { id: user.id, name: user.name, role: user.role };
}