import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { isGeminiModelId } from "@/app/lib/models";
import { cacheKey, getCached, setCached } from "@/app/lib/responseCache";
import {
  GUARDRAILS_DEFAULT_ON,
  blockedResponseInit,
  checkInput,
  checkOutput,
} from "@/app/lib/guardrails";

export const runtime = "nodejs";
// On Vercel: allow up to 5 minutes (the free plan's maximum) for slow model calls
export const maxDuration = 300;

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

const textHeaders = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" };

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { messages, model, skipCache, guardrails } = body as Record<string, unknown>;
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

    if (!isGeminiModelId(model)) {
      return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 }
      );
    }

    const guarded = typeof guardrails === "boolean" ? guardrails : GUARDRAILS_DEFAULT_ON;
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

    // 1. Input guardrails run BEFORE the cache lookup, so a cached answer can't skip them
    let degraded = false;
    if (guarded) {
      const input = await checkInput(lastUser);
      degraded = input.degraded;
      if (input.block) {
        return NextResponse.json({ blocked: input.block }, blockedResponseInit(input.block, degraded));
      }
    }
    const guardHeader = { "X-Guardrails": guarded ? (degraded ? "degraded" : "on") : "off" };

    // 2. Cache: same model + same conversation already answered? Send the saved answer.
    //    Guarded and unguarded answers are cached separately.
    const key = cacheKey(`${model}|guarded=${guarded}`, messages);
    const cached = skipCache === true ? null : getCached(key);
    if (cached !== null) {
      return new Response(cached, { headers: { ...textHeaders, ...guardHeader, "X-Cache": "HIT" } });
    }

    const ai = new GoogleGenAI({ apiKey });
    const contents = messages.map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    // 3a. Guardrails ON: the whole reply must be checked before anyone sees it,
    //     so it is generated in one piece (no streaming), then checked.
    if (guarded) {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: { abortSignal: request.signal },
      });
      const text = response.text || "No response generated";
      const output = await checkOutput(lastUser, text);
      if (output.block) {
        return NextResponse.json(
          { blocked: output.block },
          blockedResponseInit(output.block, degraded || output.degraded)
        );
      }
      setCached(key, text);
      return new Response(text, {
        headers: {
          ...textHeaders,
          "X-Guardrails": degraded || output.degraded ? "degraded" : "on",
          "X-Cache": "MISS",
        },
      });
    }

    // 3b. Guardrails OFF: stream the answer piece by piece.
    // abortSignal = when the user presses Stop (or closes the tab), Gemini stops too.
    // Errors like the rate limit happen here, before any text is sent, so they can
    // still be returned as a normal JSON error.
    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config: { abortSignal: request.signal },
    });

    const encoder = new TextEncoder();
    const textStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let full = "";
        try {
          for await (const chunk of stream) {
            const text = chunk.text;
            if (text) {
              full += text;
              controller.enqueue(encoder.encode(text));
            }
          }
          // Only cache complete, successful answers
          if (full) setCached(key, full);
        } catch (error) {
          if (!request.signal.aborted) {
            console.error("Chat stream error:", error);
            controller.enqueue(encoder.encode("\n\n[The response was interrupted. Please try again.]"));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(textStream, { headers: { ...textHeaders, ...guardHeader, "X-Cache": "MISS" } });
  } catch (error) {
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Request cancelled" }, { status: 499 });
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number })?.status;
    if (status === 429 || message.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json(
        { error: "Gemini rate limit reached. Wait a minute, or pick another model." },
        { status: 429 }
      );
    }
    if (status === 404 || message.includes("NOT_FOUND")) {
      return NextResponse.json(
        { error: "That Gemini model isn't available for your API key. Pick another model." },
        { status: 400 }
      );
    }
    if (message.includes("API_KEY_INVALID")) {
      return NextResponse.json({ error: "The Gemini API key is not valid" }, { status: 500 });
    }
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 }
    );
  }
}
