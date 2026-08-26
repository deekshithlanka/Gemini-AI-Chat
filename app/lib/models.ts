export const GEMINI_MODELS = [
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
] as const;

export type GeminiModelId = (typeof GEMINI_MODELS)[number]["id"];

export const DEFAULT_GEMINI_MODEL: GeminiModelId = "gemini-3-flash-preview";

export function isGeminiModelId(value: unknown): value is GeminiModelId {
  return (
    typeof value === "string" &&
    GEMINI_MODELS.some((model) => model.id === value)
  );
}
