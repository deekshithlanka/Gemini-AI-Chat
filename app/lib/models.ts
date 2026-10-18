// Current stable Gemini models (checked against ai.google.dev/gemini-api/docs/models, Oct 2026).
// The API route only accepts IDs in this list, so browsers can't request other models.
export const GEMINI_MODELS = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
] as const;

export type GeminiModelId = (typeof GEMINI_MODELS)[number]["id"];

export const DEFAULT_GEMINI_MODEL: GeminiModelId = "gemini-3.8-flash";

export function isGeminiModelId(value: unknown): value is GeminiModelId {
  return (
    typeof value === "string" &&
    GEMINI_MODELS.some((model) => model.id === value)
  );
}
