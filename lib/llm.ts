import type { ModelConfig, ModelInfo } from "./types";
import { getSettings } from "./settings";
import { readLines } from "./ndjson";
import { MODEL_NAME, ollamaCandidates, ollamaFetch } from "./ollama";

// Self-hosted LLM access. The default provider is a local Ollama server; the
// model is whatever the user picked in the model settings, falling back to
// OLLAMA_MODEL (llama3.2:3b). `LLM_PROVIDER=openai` points at any
// OpenAI-compatible endpoint (including Ollama's /v1 API or a remote server).
// Ollama is reached over the compose network through lib/ollama, which retries
// the configured and network addresses instead of failing on the first refusal.
export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type Options = {
  numPredict?: number;
  temperature?: number;
  signal?: AbortSignal;
};

const provider = process.env.LLM_PROVIDER === "openai" ? "openai" : "ollama";
const openaiBase = (
  process.env.LLM_BASE_URL || "http://127.0.0.1:11434/v1"
).replace(/\/+$/, "");
const openaiKey = process.env.LLM_API_KEY || "";
const numCtx = Number(process.env.LLM_NUM_CTX || 8192) || 8192;

export const defaultModelName =
  process.env.OLLAMA_MODEL || process.env.LLM_MODEL || "llama3.2:3b";

// The model the user selected in the UI, or the configured default.
export async function selectedModelName(): Promise<string> {
  if (provider === "openai") return process.env.LLM_MODEL || defaultModelName;
  const settings = await getSettings();
  return settings.model || defaultModelName;
}

function unreachable(error: unknown): Error {
  if (error instanceof Error && error.name === "AbortError") return error;
  const code = (error as { cause?: { code?: string } })?.cause?.code ?? "";
  if (
    (error instanceof Error && error.name === "TimeoutError") ||
    code.includes("TIMEOUT")
  )
    return new Error(
      "The local model took too long to answer. Try again, or pick a smaller model in the model settings.",
    );
  return new Error(
    provider === "openai"
      ? `Cannot reach the model server at ${openaiBase} — check LLM_BASE_URL.`
      : `Cannot reach the Ollama server — tried ${ollamaCandidates().join(", ")}. It may still be starting; try again in a moment.`,
  );
}

// Ollama reports tags as `name:tag`; treat a bare name as its `:latest` tag.
function sameModel(installed: string, wanted: string): boolean {
  return installed === wanted || installed === `${wanted}:latest`;
}

export async function listModels(): Promise<ModelInfo[]> {
  try {
    if (provider === "openai") {
      const response = await fetch(`${openaiBase}/models`, {
        headers: openaiKey ? { Authorization: `Bearer ${openaiKey}` } : {},
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.data ?? []).map((entry: { id?: string }) => ({
        name: String(entry.id ?? ""),
        size: null,
        modifiedAt: null,
      }));
    }
    const response = await ollamaFetch(
      "/api/tags",
      { cache: "no-store" },
      { retries: 2, connectTimeoutMs: 3000 },
    );
    if (!response.ok) return [];
    const data = await response.json();
    return (data.models ?? []).map(
      (entry: { name?: string; size?: number; modified_at?: string }) => ({
        name: String(entry.name ?? ""),
        size: typeof entry.size === "number" ? entry.size : null,
        modifiedAt: entry.modified_at ?? null,
      }),
    );
  } catch {
    return [];
  }
}

export async function isModelReady(model?: string): Promise<boolean> {
  const wanted = model ?? (await selectedModelName());
  try {
    if (provider === "openai") {
      const response = await fetch(`${openaiBase}/models`, {
        headers: openaiKey ? { Authorization: `Bearer ${openaiKey}` } : {},
        signal: AbortSignal.timeout(3000),
        cache: "no-store",
      });
      if (!response.ok) return false;
      const data = await response.json();
      return (data.data ?? []).some(
        (entry: { id?: string }) => entry.id === wanted,
      );
    }
    const response = await ollamaFetch(
      "/api/tags",
      { cache: "no-store" },
      { retries: 1, connectTimeoutMs: 2500 },
    );
    if (!response.ok) return false;
    const data = await response.json();
    return (data.models ?? []).some((entry: { name?: string }) =>
      sameModel(String(entry.name ?? ""), wanted),
    );
  } catch {
    return false;
  }
}

export async function getModelStatus(): Promise<ModelConfig> {
  const model = await selectedModelName();
  return {
    provider,
    model,
    ready: await isModelReady(model),
    defaultModel: defaultModelName,
  };
}

// Downloads a model into Ollama. Blocks until the download finishes.
export async function pullModel(name: string): Promise<string> {
  const wanted = name.trim();
  if (!MODEL_NAME.test(wanted)) {
    throw new Error("Use a model name like llama3.2:3b or qwen2.5:3b.");
  }
  if (provider === "openai") {
    throw new Error("Downloading models is only available with the Ollama provider.");
  }
  let response: Response;
  try {
    response = await ollamaFetch(
      "/api/pull",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Streamed: a multi-gigabyte download keeps sending progress, so Node's
        // fetch never treats the socket as idle and gives up after five minutes.
        body: JSON.stringify({ name: wanted, stream: true }),
      },
      { retries: 1, connectTimeoutMs: 0 },
    );
  } catch (error) {
    throw unreachable(error);
  }
  if (!response.ok) {
    throw new Error(`Ollama could not download ${wanted} (${response.status}).`);
  }
  if (response.body) {
    for await (const line of readLines(response.body)) {
      let reported = "";
      try {
        reported = String(JSON.parse(line).error ?? "");
      } catch {
        reported = "";
      }
      if (reported)
        throw new Error(`Ollama could not download ${wanted}: ${reported}`);
    }
  }
  return wanted;
}

// Every model call streams: Ollama sends the first token only after the prompt
// is evaluated, so a non-streamed reply can sit silent for minutes and Node's
// fetch aborts it. Callers that need the whole text join the deltas.
function ollamaBody(
  model: string,
  messages: LLMMessage[],
  options: Options,
) {
  return JSON.stringify({
    model,
    messages,
    stream: true,
    options: {
      temperature: options.temperature ?? 0.6,
      num_predict: options.numPredict ?? 512,
      num_ctx: numCtx,
    },
  });
}

function openaiBody(
  model: string,
  messages: LLMMessage[],
  options: Options,
) {
  return JSON.stringify({
    model,
    messages,
    stream: true,
    temperature: options.temperature ?? 0.6,
    max_tokens: options.numPredict ?? 512,
  });
}

async function request(
  messages: LLMMessage[],
  options: Options,
): Promise<{ response: Response; model: string }> {
  const model = await selectedModelName();
  if (provider === "openai") {
    const response = await fetch(`${openaiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(openaiKey ? { Authorization: `Bearer ${openaiKey}` } : {}),
      },
      body: openaiBody(model, messages, options),
      signal: options.signal,
    });
    return { response, model };
  }
  const response = await ollamaFetch(
    "/api/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: ollamaBody(model, messages, options),
      signal: options.signal,
    },
    // No connect deadline: Ollama answers only after the prompt is evaluated.
    { retries: 2, connectTimeoutMs: 0 },
  );
  return { response, model };
}

function chunkText(line: string): string {
  if (provider === "openai") {
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return "";
      try {
        const data = JSON.parse(payload);
        return data.choices?.[0]?.delta?.content ?? "";
      } catch {
        return "";
      }
    }
    return "";
  }
  try {
    return JSON.parse(line).message?.content ?? "";
  } catch {
    return "";
  }
}

// A reply that stops sending tokens is dead, not slow: three silent minutes means
// the generation is wedged, so the request is aborted instead of waiting forever.
const IDLE_TIMEOUT_MS = 180_000;

export async function* streamChat(
  messages: LLMMessage[],
  options: Options = {},
): AsyncGenerator<string> {
  const controller = new AbortController();
  let idle = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      idle = true;
      controller.abort();
    }, IDLE_TIMEOUT_MS);
  };
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener("abort", forwardAbort, { once: true });
  arm();

  const wedged = () =>
    new Error(
      "The local model stopped responding — the request was stopped. Try again, or pick a smaller model in the model settings.",
    );

  try {
    let response: Response;
    let model: string;
    try {
      ({ response, model } = await request(messages, {
        ...options,
        signal: controller.signal,
      }));
    } catch (error) {
      if (idle) throw wedged();
      throw unreachable(error);
    }
    if (!response.ok || !response.body) {
      throw new Error(
        response.status === 404
          ? `The model ${model} is not downloaded yet — pick or download it in the model settings.`
          : `The local model returned ${response.status}.`,
      );
    }
    for await (const line of readLines(response.body)) {
      arm();
      const text = chunkText(line);
      if (text) yield text;
    }
  } catch (error) {
    if (idle) throw wedged();
    if (options.signal?.aborted) throw error;
    // A dropped stream (server restart, closed socket) reads as "terminated";
    // say what happened instead of storing that raw message in the chat.
    if (
      error instanceof Error &&
      /terminated|ECONNRESET|socket hang up|fetch failed/i.test(error.message)
    )
      throw new Error("The connection to the model server dropped — try again.");
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", forwardAbort);
  }
}

// The whole reply as one string, streamed underneath so a long build keeps the
// connection alive instead of timing out.
export async function complete(
  messages: LLMMessage[],
  options: Options = {},
): Promise<string> {
  let text = "";
  for await (const delta of streamChat(messages, options)) text += delta;
  if (!text.trim()) throw new Error("The local model returned an empty reply.");
  return text;
}
