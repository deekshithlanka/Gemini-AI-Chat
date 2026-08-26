import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { isGeminiModelId } from "@/app/lib/models";

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

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { messages, model } = body as Record<string, unknown>;
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

    const ai = new GoogleGenAI({ apiKey });

    // Convert chat messages to Gemini format
    const contents = messages.map(
      (msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      })
    );

    const response = await ai.models.generateContent({
      model,
      contents,
    });

    const text =
      response.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response generated";

    return NextResponse.json({ text });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 }
    );
  }
}
