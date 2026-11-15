import type { ModelConfig, ModelInfo } from "./types";
import { getSettings } from "./settings";

// Self-hosted LLM access. The default provider is a local Ollama server; the
// model is whatever the user picked in the model settings, falling back to
// OLLAMA_MODEL (llama3.2:3b). `LLM_PROVIDER=openai` points at any
// OpenAI-compatible endpoint (including Ollama's /v1 API or a remote server).
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
const ollamaBase = (
  process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
).replace(/\/+$/, "");
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

function endpoint() {
  return provider === "openai" ? openaiBase : ollamaBase;
}

function unreachable(error: unknown): Error {
  if (error instanceof Error && error.name === "AbortError") return error;
  return new Error(
    `Cannot reach the local model at ${endpoint()} — check the Ollama service.`,
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
    const response = await fetch(`${ollamaBase}/api/tags`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
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
    const response = await fetch(`${ollamaBase}/api/tags`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
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
  if (!/^[\w.\-/:]{1,80}$/.test(wanted)) {
    throw new Error("Use a model name like llama3.2:3b or qwen2.5:3b.");
  }
  if (provider === "openai") {
    throw new Error("Downloading models is only available with the Ollama provider.");
  }
  let response: Response;
  try {
    response = await fetch(`${ollamaBase}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: wanted, stream: false }),
    });
  } catch (error) {
    throw unreachable(error);
  }
  if (!response.ok) {
    throw new Error(`Ollama could not download ${wanted} (${response.status}).`);
  }
  return wanted;
}

function ollamaBody(
  model: string,
  messages: LLMMessage[],
  options: Options,
  stream: boolean,
) {
  return JSON.stringify({
    model,
    messages,
    stream,
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
  stream: boolean,
) {
  return JSON.stringify({
    model,
    messages,
    stream,
    temperature: options.temperature ?? 0.6,
    max_tokens: options.numPredict ?? 512,
  });
}

async function request(
  messages: LLMMessage[],
  options: Options,
  stream: boolean,
): Promise<{ response: Response; model: string }> {
  const model = await selectedModelName();
  if (provider === "openai") {
    const response = await fetch(`${openaiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(openaiKey ? { Authorization: `Bearer ${openaiKey}` } : {}),
      },
      body: openaiBody(model, messages, options, stream),
      signal: options.signal,
    });
    return { response, model };
  }
  const response = await fetch(`${ollamaBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: ollamaBody(model, messages, options, stream),
    signal: options.signal,
  });
  return { response, model };
}

async function* lines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer.trim();
  } finally {
    reader.releaseLock();
  }
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

export async function* streamChat(
  messages: LLMMessage[],
  options: Options = {},
): AsyncGenerator<string> {
  let response: Response;
  let model: string;
  try {
    ({ response, model } = await request(messages, options, true));
  } catch (error) {
    throw unreachable(error);
  }
  if (!response.ok || !response.body) {
    throw new Error(
      response.status === 404
        ? `The model ${model} is not downloaded yet — pick or download it in the model settings.`
        : `The local model returned ${response.status}.`,
    );
  }
  for await (const line of lines(response.body)) {
    const text = chunkText(line);
    if (text) yield text;
  }
}

export async function complete(
  messages: LLMMessage[],
  options: Options = {},
): Promise<string> {
  let response: Response;
  let model: string;
  try {
    ({ response, model } = await request(messages, options, false));
  } catch (error) {
    throw unreachable(error);
  }
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? `The model ${model} is not downloaded yet — pick or download it in the model settings.`
        : `The local model returned ${response.status}.`,
    );
  }
  const data = await response.json();
  const text =
    provider === "openai"
      ? (data.choices?.[0]?.message?.content ?? "")
      : (data.message?.content ?? "");
  if (!text.trim()) throw new Error("The local model returned an empty reply.");
  return text;
}
