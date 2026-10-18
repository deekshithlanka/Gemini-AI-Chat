import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// On Vercel: allow up to 5 minutes (the free plan's maximum) for slow model calls
export const maxDuration = 300;

// Speech-to-text: the browser records your voice and sends it here; Gemini writes it out.
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || "gemini-3.5-flash-lite";
const MAX_BYTES = 10 * 1024 * 1024; // ~10 minutes of compressed audio

export async function POST(request: NextRequest) {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  let audio: FormDataEntryValue | null;
  try {
    audio = (await request.formData()).get("audio");
  } catch {
    return NextResponse.json({ error: "Expected an audio upload" }, { status: 400 });
  }
  if (!(audio instanceof File) || audio.size === 0) {
    return NextResponse.json({ error: "No audio received" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: "Recording is too long" }, { status: 413 });
  }
  // Browsers report e.g. "audio/webm;codecs=opus"; Gemini wants just "audio/webm"
  const mimeType = (audio.type || "audio/webm").split(";")[0];
  if (!mimeType.startsWith("audio/")) {
    return NextResponse.json({ error: "Not an audio file" }, { status: 400 });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const data = Buffer.from(await audio.arrayBuffer()).toString("base64");
    const response = await ai.models.generateContent({
      model: TRANSCRIBE_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Transcribe this speech verbatim. Reply with ONLY the transcript text, " +
                "no labels or commentary. If there is no speech, reply with nothing.",
            },
            { inlineData: { mimeType, data } },
          ],
        },
      ],
      config: { temperature: 0, abortSignal: request.signal },
    });
    return NextResponse.json({ text: (response.text || "").trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("RESOURCE_EXHAUSTED") || (error as { status?: number })?.status === 429) {
      return NextResponse.json({ error: "Gemini rate limit reached. Try again in a minute." }, { status: 429 });
    }
    console.error("Transcribe error:", error);
    return NextResponse.json({ error: "Couldn't transcribe the recording" }, { status: 500 });
  }
}
