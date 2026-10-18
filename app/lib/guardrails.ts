import { GoogleGenAI } from "@google/genai";

// Guardrails: safety checks around every model call.
//
//   INPUT  (before calling Gemini / the RAG server), both run at the same time:
//     1. Prompt Guard 2 (Meta, hosted on Groq): detects jailbreaks and prompt injection
//        ("ignore your instructions and..."). Very fast (~0.1s).
//     2. Gemini safety check: is the request itself unsafe (violence, crime, ...)?
//   OUTPUT (after the answer is generated, before the browser sees it):
//     3. Gemini safety check on the reply, judged together with the question.
//
// Fail-open by default: if a guard can't be reached (no key, service down), the request
// goes through unchecked by that guard and the response is marked "degraded".
// Set GUARDRAILS_FAIL_CLOSED=true in .env.local to block instead.

const PROMPT_GUARD_MODEL = process.env.PROMPT_GUARD_MODEL || "meta-llama/llama-prompt-guard-2-86m";
const PROMPT_GUARD_THRESHOLD = Number(process.env.PROMPT_GUARD_THRESHOLD || "0.5");
const SAFETY_MODEL = process.env.SAFETY_MODEL || "gemini-3.5-flash-lite";
const FAIL_CLOSED = process.env.GUARDRAILS_FAIL_CLOSED === "true";
const TIMEOUT_MS = 8000;

export const GUARDRAILS_DEFAULT_ON = process.env.GUARDRAILS_ENABLED !== "false";

export interface Block {
  stage: "input" | "output";
  guard: "Prompt Guard" | "Safety check";
  reason: string;
}

export interface GuardOutcome {
  block: Block | null;
  degraded: boolean; // true if any guard couldn't run
}

// Same hazard categories as Meta's Llama Guard (S1-S14)
const CATEGORIES = `S1 Violent Crimes, S2 Non-Violent Crimes, S3 Sex-Related Crimes, S4 Child Sexual Exploitation,
S5 Defamation, S6 Specialized Advice (dangerous medical/legal/financial), S7 Privacy (exposing personal data),
S8 Intellectual Property, S9 Indiscriminate Weapons, S10 Hate, S11 Suicide & Self-Harm, S12 Sexual Content,
S13 Elections (misinformation), S14 Code Interpreter Abuse`;

// ---------- 1. Prompt Guard (Groq) ----------
async function promptGuard(text: string): Promise<Block | null | "error"> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return "error";
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: PROMPT_GUARD_MODEL,
        messages: [{ role: "user", content: text.slice(0, 8000) }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("Prompt Guard HTTP", response.status, await response.text().catch(() => ""));
      return "error";
    }
    const data = await response.json();
    const content = String(data?.choices?.[0]?.message?.content ?? "").trim();

    // The model replies with a 0-1 probability that the text is an attack (e.g. "0.9987").
    // Some versions reply with a label instead, so handle both.
    const number = content.match(/\d*\.?\d+(e-?\d+)?/i);
    const score = number ? Number(number[0]) : /malicious|jailbreak|injection/i.test(content) ? 1 : 0;
    if (score >= PROMPT_GUARD_THRESHOLD) {
      return {
        stage: "input",
        guard: "Prompt Guard",
        reason: `Looks like a jailbreak or prompt injection (score ${score.toFixed(2)})`,
      };
    }
    return null;
  } catch (error) {
    console.error("Prompt Guard error:", error);
    return "error";
  }
}

// ---------- 2 & 3. Gemini safety check ----------
async function safetyCheck(
  stage: "input" | "output",
  question: string,
  answer?: string
): Promise<Block | null | "error"> {
  const apiKey = process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) return "error";

  const what =
    stage === "input"
      ? `the USER MESSAGE below`
      : `the ASSISTANT REPLY below (the user message is given only as context)`;
  const prompt = `You are a strict content-safety classifier. Decide whether ${what} is unsafe
in any of these categories:
${CATEGORIES}

Asking about a topic for learning, news, or safety reasons is SAFE. Only mark UNSAFE if the
message seeks or provides real help causing harm. Reply with JSON only:
{"safe": true} or {"safe": false, "category": "S<number> <name>"}

USER MESSAGE:
"""${question.slice(0, 8000)}"""
${answer !== undefined ? `\nASSISTANT REPLY:\n"""${answer.slice(0, 12000)}"""` : ""}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: SAFETY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      },
    });
    const verdict = JSON.parse(response.text || "{}");
    if (verdict.safe === false) {
      return {
        stage,
        guard: "Safety check",
        reason:
          (stage === "input" ? "Unsafe request" : "Unsafe reply") +
          (verdict.category ? ` (${verdict.category})` : ""),
      };
    }
    if (verdict.safe === true) return null;
    return "error";
  } catch (error) {
    console.error(`Safety check (${stage}) error:`, error);
    return "error";
  }
}

function combine(results: (Block | null | "error")[], stage: "input" | "output"): GuardOutcome {
  const block = results.find((r): r is Block => r !== null && r !== "error") ?? null;
  const degraded = results.includes("error");
  if (!block && degraded && FAIL_CLOSED) {
    return {
      block: { stage, guard: "Safety check", reason: "A safety check is unavailable right now" },
      degraded,
    };
  }
  return { block, degraded };
}

export async function checkInput(text: string): Promise<GuardOutcome> {
  const results = await Promise.all([promptGuard(text), safetyCheck("input", text)]);
  return combine(results, "input");
}

export async function checkOutput(question: string, answer: string): Promise<GuardOutcome> {
  return combine([await safetyCheck("output", question, answer)], "output");
}

export function blockedResponseInit(block: Block, degraded: boolean): ResponseInit {
  return {
    status: 200,
    headers: {
      "X-Guardrails-Blocked": block.stage,
      "X-Guardrails": degraded ? "degraded" : "on",
    },
  };
}
