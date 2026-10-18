import { createHash } from "crypto";

// In-memory cache of Chat-mode answers, kept in the Next.js server process.
// Asking exactly the same thing again (same model + same conversation) returns the saved
// answer instantly instead of calling Gemini again (faster, and saves your rate limit).
//
// Notes:
// - The key is the WHOLE conversation, not just the last question, because Gemini's answer
//   depends on earlier messages ("show me an example" means different things in different chats).
// - Cleared when the server restarts. On Vercel each server instance has its own cache.
// - Document Q&A is not cached: uploading a PDF would make old answers out of date.

const MAX_ENTRIES = 500; // oldest-used entries are dropped beyond this
const TTL_MS = 60 * 60 * 1000; // each entry lives 1 hour

interface Entry {
  text: string;
  createdAt: number;
}

// A Map remembers insertion order, so the first key is always the least recently used.
const cache = new Map<string, Entry>();

export function cacheKey(model: string, messages: { role: string; content: string }[]): string {
  const normalized = messages.map(({ role, content }) => ({ role, content }));
  return createHash("sha256").update(JSON.stringify({ model, messages: normalized })).digest("hex");
}

export function getCached(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Move to the end = mark as recently used
  cache.delete(key);
  cache.set(key, entry);
  return entry.text;
}

export function setCached(key: string, text: string): void {
  cache.delete(key);
  cache.set(key, { text, createdAt: Date.now() });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
