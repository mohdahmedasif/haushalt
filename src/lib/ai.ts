import type { DetectedContract } from "./contracts";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiConfig = { apiKey: string; model: string };
export type GeminiModel = { id: string; name: string };

/** Last Gemini answer, so page reloads with unchanged contracts do not call the API again. */
let lastAnswer: { request: string; text: string } | null = null;

export async function enrichContractsWithAI(
  contracts: DetectedContract[],
  gemini: GeminiConfig | null,
): Promise<{ contracts: DetectedContract[]; provider: string }> {
  if (gemini && contracts.length) {
    try {
      const labeled = await callGemini(gemini, contracts);
      return { contracts: labeled, provider: `gemini:${gemini.model}` };
    } catch (error) {
      console.warn("Gemini enrich failed, using local labels", error);
    }
  }

  return localLabels(contracts);
}

/**
 * For page loads: never waits on Gemini. Uses the last Gemini answer if the
 * contracts have not changed since, otherwise the local labels.
 */
export function labelContractsFromCache(
  contracts: DetectedContract[],
  gemini: GeminiConfig | null,
): { contracts: DetectedContract[]; provider: string } {
  if (gemini && lastAnswer?.request === requestKey(gemini, contracts)) {
    const provider = `gemini:${gemini.model}`;
    return { contracts: mergeAi(contracts, lastAnswer.text, provider), provider };
  }
  return localLabels(contracts);
}

function localLabels(contracts: DetectedContract[]): { contracts: DetectedContract[]; provider: string } {
  return {
    contracts: contracts.map((c) => ({
      ...c,
      ai: { used: true, provider: "local-pattern-model", note: "Labeled from bank mandate patterns in your history" },
    })),
    provider: "local-pattern-model",
  };
}

function requestKey(gemini: GeminiConfig, contracts: DetectedContract[]): string {
  return `${gemini.model}\n${promptFor(contracts)}`;
}

/** Text models this key can use. Throws when Gemini rejects the key. */
export async function listGeminiModels(apiKey: string): Promise<GeminiModel[]> {
  const res = await fetch(`${GEMINI_BASE}/models?pageSize=1000`, {
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(await geminiError(res));
  const body = (await res.json()) as {
    models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  };
  return (body.models ?? [])
    .filter((m) => m.name.startsWith("models/gemini") && m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName || m.name }));
}

export function defaultGeminiModel(models: GeminiModel[]): string | null {
  const pick =
    models.find((m) => m.id === "gemini-flash-latest") ?? models.find((m) => m.id.includes("flash")) ?? models[0];
  return pick?.id ?? null;
}

async function geminiError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message || `Gemini request failed: ${res.status}`;
}

function promptFor(contracts: DetectedContract[]): string {
  return `You classify German household SEPA contracts from bank bookings.
Return {"contracts":[...]} JSON only, same length/order. Each item: {"id":"...","name":"short English name","status":"active|paused|ended","note":"one sentence"}.
Today is ${new Date().toISOString().slice(0, 10)}.
Data:\n${JSON.stringify(
    contracts.map((c) => ({
      id: c.id,
      vendor: c.vendor,
      lastDate: c.lastDate,
      typicalAmount: c.typicalAmount,
      cadence: c.cadence,
      mandateRef: c.mandateRef,
      count: c.count,
    })),
  )}`;
}

async function callGemini(gemini: GeminiConfig, contracts: DetectedContract[]): Promise<DetectedContract[]> {
  const provider = `gemini:${gemini.model}`;
  const prompt = promptFor(contracts);
  const request = requestKey(gemini, contracts);
  if (lastAnswer?.request === request) return mergeAi(contracts, lastAnswer.text, provider);

  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(gemini.model)}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": gemini.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(await geminiError(res));
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("") || "{}";
  const labeled = mergeAi(contracts, text, provider);
  lastAnswer = { request, text };
  return labeled;
}

function mergeAi(contracts: DetectedContract[], raw: string, provider: string): DetectedContract[] {
  const parsed = JSON.parse(raw) as { contracts?: { id: string; name?: string; status?: string; note?: string }[] };
  const byId = new Map((parsed.contracts ?? []).map((c) => [c.id, c]));
  return contracts.map((c) => {
    const ai = byId.get(c.id);
    if (!ai) return { ...c, ai: { used: true, provider } };
    return {
      ...c,
      name: ai.name || c.name,
      status: (["active", "paused", "ended"].includes(ai.status ?? "") ? ai.status : c.status) as DetectedContract["status"],
      evidence: ai.note ? `${c.evidence}. ${ai.note}` : c.evidence,
      confidence: Math.min(0.99, c.confidence + 0.05),
      ai: { used: true, provider, note: ai.note },
    };
  });
}
