import { NextRequest, NextResponse } from "next/server";
import { getRagApiUrl, ragErrorMessage, ragHeaders } from "@/app/lib/rag";

export const runtime = "nodejs";
// On Vercel: allow up to 5 minutes (the free plan's maximum) for slow model calls
export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;

// PDF upload: forwards the file to the RAG server's /ingest endpoint.
export async function POST(request: NextRequest) {
  const ragUrl = getRagApiUrl();
  if (!ragUrl) {
    return NextResponse.json({ error: "RAG_API_URL is not configured" }, { status: 500 });
  }

  let file: FormDataEntryValue | null;
  let useGraph = false;
  try {
    const form = await request.formData();
    file = form.get("file");
    useGraph = form.get("retrieval") === "graph";
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "PDF must be 25 MB or smaller" }, { status: 413 });
  }

  try {
    const forward = new FormData();
    forward.append("file", file, file.name);
    // Knowledge graph builds run in the background on the RAG server and return at once
    const response = await fetch(`${ragUrl}${useGraph ? "/kg/ingest" : "/ingest"}`, {
      method: "POST",
      headers: ragHeaders(),
      body: forward,
      signal: AbortSignal.timeout(300_000), // embedding a long PDF can take a while
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: await ragErrorMessage(response) },
        { status: response.status }
      );
    }
    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("RAG ingest error:", error);
    return NextResponse.json(
      { error: "Can't reach the document service. Is the RAG server running?" },
      { status: 502 }
    );
  }
}

// Progress of a knowledge graph build (the page asks every few seconds)
export async function GET() {
  const ragUrl = getRagApiUrl();
  if (!ragUrl) {
    return NextResponse.json({ error: "RAG_API_URL is not configured" }, { status: 500 });
  }
  try {
    const response = await fetch(`${ragUrl}/kg/status`, {
      headers: ragHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return NextResponse.json({ error: await ragErrorMessage(response) }, { status: response.status });
    }
    return NextResponse.json(await response.json());
  } catch {
    return NextResponse.json({ error: "Can't reach the document service" }, { status: 502 });
  }
}
