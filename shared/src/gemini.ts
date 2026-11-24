/** לקוח מינימלי ל-Gemini API (REST), בלי SDK. משותף לצינור ול-Worker. */

export interface LlmCall {
  model: string;
  system: string;
  prompt: string;
  /** JSON schema (תת-קבוצה של OpenAPI) לפלט מובנה. אם חסר מוחזר טקסט חופשי */
  schema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type LlmFn = (call: LlmCall) => Promise<LlmResult>;

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export class LlmError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
  }
}

export function makeGemini(apiKey: string, fetchImpl: typeof fetch = fetch, maxRetries = 3): LlmFn {
  return async (call) => {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: call.system }] },
      contents: [{ role: "user", parts: [{ text: call.prompt }] }],
      generationConfig: {
        temperature: call.temperature ?? 0.4,
        maxOutputTokens: call.maxOutputTokens ?? 8192,
        ...(call.schema ? { responseMimeType: "application/json", responseSchema: call.schema } : {}),
      },
    };
    let lastErr: LlmError | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)));
      const res = await fetchImpl(`${BASE}/models/${encodeURIComponent(call.model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 500);
        lastErr = new LlmError(`Gemini ${res.status}: ${detail}`, res.status, res.status === 429 || res.status >= 500);
        if (!lastErr.retryable) throw lastErr;
        continue;
      }
      const data = (await res.json()) as any;
      const cand = data.candidates?.[0];
      const text: string = (cand?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
      if (!text) {
        lastErr = new LlmError(`Gemini החזיר תשובה ריקה (finishReason=${cand?.finishReason ?? "?"})`, 200, true);
        continue;
      }
      return {
        text,
        model: data.modelVersion ?? call.model,
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      };
    }
    throw lastErr ?? new LlmError("Gemini נכשל");
  };
}

/** מפרק JSON מתשובת מודל, כולל מקרה של ```json ... ``` */
export function parseJsonLoose<T = unknown>(text: string): T {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(t) as T;
}

/**
 * עוטף LlmFn ברשימת מודלים לפי סדר עדיפות: אם מודל עמוס (503) או שנגמרה המכסה (429),
 * עוברים לבא בתור. call.model מתעלמים ממנו.
 */
export function withFallback(llm: LlmFn, models: string[]): (call: Omit<LlmCall, "model">) => Promise<LlmResult> {
  if (!models.length) throw new Error("רשימת מודלים ריקה");
  return async (call) => {
    let last: unknown;
    for (const model of models) {
      try {
        return await llm({ ...call, model });
      } catch (e) {
        last = e;
        if (!(e instanceof LlmError) || !e.retryable) throw e;
      }
    }
    throw last;
  };
}

export function modelList(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v];
}
