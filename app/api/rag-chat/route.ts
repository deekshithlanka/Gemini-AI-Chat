import { NextRequest, NextResponse } from "next/server";
import { getRagApiUrl, ragErrorMessage } from "@/app/lib/rag";
import {
  GUARDRAILS_DEFAULT_ON,
  blockedResponseInit,
  checkInput,
  checkOutput,
} from "@/app/lib/guardrails";

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

  const { messages, rerank, guardrails } = (body ?? {}) as Record<string, unknown>;
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

  // Input guardrails before anything reaches the RAG server
  const guarded = typeof guardrails === "boolean" ? guardrails : GUARDRAILS_DEFAULT_ON;
  const lastUser =
    [...(messages as { role: string; content: string }[])].reverse().find((m) => m.role === "user")
      ?.content ?? "";
  let degraded = false;
  if (guarded) {
    const input = await checkInput(lastUser);
    degraded = input.degraded;
    if (input.block) {
      return NextResponse.json({ blocked: input.block }, blockedResponseInit(input.block, degraded));
    }
  }

  try {
    const response = await fetch(`${ragUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // rerank defaults to true; anything that isn't a boolean is ignored
      body: JSON.stringify({ messages, rerank: typeof rerank === "boolean" ? rerank : true }),
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
    const text = typeof data.text === "string" ? data.text : "No answer returned";

    // Output guardrail: check the answer before the browser sees it
    if (guarded) {
      const output = await checkOutput(lastUser, text);
      degraded = degraded || output.degraded;
      if (output.block) {
        return NextResponse.json({ blocked: output.block }, blockedResponseInit(output.block, degraded));
      }
    }

    return NextResponse.json(
      {
        text,
        sources: Array.isArray(data.sources) ? data.sources : [],
        reranked: data.reranked === true,
      },
      { headers: { "X-Guardrails": guarded ? (degraded ? "degraded" : "on") : "off" } }
    );
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
