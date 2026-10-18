import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// On Vercel: allow up to 5 minutes (the free plan's maximum) for slow model calls
export const maxDuration = 300;

// Text-to-speech: turns an assistant reply into spoken audio (WAV) with a Gemini TTS model.
const TTS_MODEL = process.env.TTS_MODEL || "gemini-3.8-flash-tts";
const DEFAULT_VOICE = process.env.TTS_VOICE || "Kore"; // others: Puck, Zephyr, Charon, Aoede
const MAX_CHARS = 5000;

// Gemini may return raw PCM samples (no file header). Browsers can't play that directly,
// so wrap it in a 44-byte WAV header that says "16-bit mono PCM at <rate> Hz".
function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // bytes per sample
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Remove things that sound bad when read aloud: markdown symbols and page citations
function speakable(text: string): string {
  return text
    .replace(/\(p\. ?\d+(, ?p\. ?\d+)*\)/g, "")
    .replace(/[*_#`>]+/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  let text: unknown;
  try {
    ({ text } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "No text to read" }, { status: 400 });
  }
  const input = speakable(text).slice(0, MAX_CHARS);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ role: "user", parts: [{ text: input }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: DEFAULT_VOICE } } },
        abortSignal: request.signal,
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) {
      return NextResponse.json({ error: "No audio returned" }, { status: 502 });
    }
    let audio: Buffer = Buffer.from(part.inlineData.data, "base64");
    const mime = part.inlineData.mimeType || "";
    const isWav = audio.subarray(0, 4).toString("ascii") === "RIFF";
    if (!isWav) {
      // e.g. "audio/L16;codec=pcm;rate=24000"
      const rate = Number(/rate=(\d+)/.exec(mime)?.[1] || 24000);
      audio = pcmToWav(audio, rate);
    }
    return new Response(new Uint8Array(audio), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Cancelled" }, { status: 499 });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("RESOURCE_EXHAUSTED") || (error as { status?: number })?.status === 429) {
      return NextResponse.json({ error: "Gemini rate limit reached. Try again in a minute." }, { status: 429 });
    }
    console.error("TTS error:", error);
    return NextResponse.json({ error: "Couldn't generate audio" }, { status: 500 });
  }
}
