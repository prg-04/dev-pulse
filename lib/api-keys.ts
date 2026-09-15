import { createHash, randomBytes } from "crypto";

// Server-only helpers per §12e — never import in client components.
// Hash = sha256(raw + API_KEY_PEPPER) hex.

function getPepper(): string {
  const p = process.env.API_KEY_PEPPER;
  if (!p) throw new Error("Missing API_KEY_PEPPER");
  return p;
}

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const random = randomBytes(16).toString("hex");
  const raw = `dp_live_${random}`;
  const prefix = raw.slice(0, 12);
  const hash = hashKey(raw);
  return { raw, prefix, hash };
}

export function hashKey(raw: string): string {
  const pepper = getPepper();
  return createHash("sha256").update(raw + pepper).digest("hex");
}

export function verifyHashMatches(raw: string, storedHash: string): boolean {
  const h = hashKey(raw);
  if (h.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}
