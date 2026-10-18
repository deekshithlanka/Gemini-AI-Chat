// Where the Python RAG server (rag-backend) is running.
// Set RAG_API_URL in .env.local. Locally: http://localhost:8001
export function getRagApiUrl(): string | null {
  const url = process.env.RAG_API_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

// Password for the RAG server (RAG_API_KEY, the same value as on Render). Sent on every call.
export function ragHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = process.env.RAG_API_KEY;
  return key ? { ...extra, "X-API-Key": key } : extra;
}

export interface RagSource {
  source: string;
  page: number;
  score?: number; // reranker relevance (or search score when rerank is off)
  chunks?: number; // how many of the retrieved chunks came from this page
}

// Turn the RAG server's error into a short message for the user.
export async function ragErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") return data.detail;
  } catch {
    // not JSON
  }
  return `Document service error (${response.status})`;
}
