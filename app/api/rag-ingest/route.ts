import { NextRequest, NextResponse } from "next/server";
import { getRagApiUrl, ragErrorMessage } from "@/app/lib/rag";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;

// PDF upload: forwards the file to the RAG server's /ingest endpoint.
export async function POST(request: NextRequest) {
  const ragUrl = getRagApiUrl();
  if (!ragUrl) {
    return NextResponse.json({ error: "RAG_API_URL is not configured" }, { status: 500 });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
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
    const response = await fetch(`${ragUrl}/ingest`, {
      method: "POST",
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
