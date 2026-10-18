import { NextRequest, NextResponse } from "next/server";
import { getRagApiUrl, ragErrorMessage } from "@/app/lib/rag";

export const runtime = "nodejs";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0 &&
    message.content.length <= 10_000
  );
}

// Document Q&A: the browser calls this route, and this route calls the Python RAG server.
// The browser never talks to the RAG server directly.
export async function POST(request: NextRequest) {
  const ragUrl = getRagApiUrl();
  if (!ragUrl) {
    return NextResponse.json({ error: "RAG_API_URL is not configured" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { messages } = (body ?? {}) as Record<string, unknown>;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 100 ||
    !messages.every(isChatMessage)
  ) {
    return NextResponse.json(
      { error: "Messages must be a non-empty array of valid chat messages" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(`${ragUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      // Stop the RAG call too when the user presses Stop, and give up after 2 minutes
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: await ragErrorMessage(response) },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      text: typeof data.text === "string" ? data.text : "No answer returned",
      sources: Array.isArray(data.sources) ? data.sources : [],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }
    console.error("RAG chat error:", error);
    return NextResponse.json(
      { error: "Can't reach the document service. Is the RAG server running?" },
      { status: 502 }
    );
  }
}
