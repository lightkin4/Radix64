import type { ModelConfig } from "./types";

// Self-hosted LLM access. The default provider is a local Ollama server running
// llama3.2:3b; `LLM_PROVIDER=openai` points at any OpenAI-compatible endpoint
// (including Ollama's /v1 API or a remote server).
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
const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2:3b";
const openaiBase = (
  process.env.LLM_BASE_URL || "http://127.0.0.1:11434/v1"
).replace(/\/+$/, "");
const openaiModel = process.env.LLM_MODEL || ollamaModel;
const openaiKey = process.env.LLM_API_KEY || "";
const numCtx = Number(process.env.LLM_NUM_CTX || 8192) || 8192;

function endpoint() {
  return provider === "openai" ? openaiBase : ollamaBase;
}

function model() {
  return provider === "openai" ? openaiModel : ollamaModel;
}

function unreachable(error: unknown): Error {
  if (error instanceof Error && error.name === "AbortError") return error;
  return new Error(
    `Cannot reach the local model at ${endpoint()} — check the Ollama service.`,
  );
}

export function getModelConfig(): ModelConfig {
  return { provider, model: model(), ready: false };
}

export async function isModelReady(): Promise<boolean> {
  try {
    if (provider === "openai") {
      const response = await fetch(`${openaiBase}/models`, {
        headers: openaiKey ? { Authorization: `Bearer ${openaiKey}` } : {},
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) return false;
      const data = await response.json();
      return (data.data ?? []).some(
        (entry: { id?: string }) => entry.id === openaiModel,
      );
    }
    const response = await fetch(`${ollamaBase}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return (data.models ?? []).some(
      (entry: { name?: string }) => entry.name === ollamaModel,
    );
  } catch {
    return false;
  }
}

export async function getModelStatus(): Promise<ModelConfig> {
  return { ...getModelConfig(), ready: await isModelReady() };
}

function ollamaBody(messages: LLMMessage[], options: Options, stream: boolean) {
  return JSON.stringify({
    model: ollamaModel,
    messages,
    stream,
    options: {
      temperature: options.temperature ?? 0.6,
      num_predict: options.numPredict ?? 512,
      num_ctx: numCtx,
    },
  });
}

function openaiBody(messages: LLMMessage[], options: Options, stream: boolean) {
  return JSON.stringify({
    model: openaiModel,
    messages,
    stream,
    temperature: options.temperature ?? 0.6,
    max_tokens: options.numPredict ?? 512,
  });
}

function request(messages: LLMMessage[], options: Options, stream: boolean) {
  if (provider === "openai") {
    return fetch(`${openaiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(openaiKey ? { Authorization: `Bearer ${openaiKey}` } : {}),
      },
      body: openaiBody(messages, options, stream),
      signal: options.signal,
    });
  }
  return fetch(`${ollamaBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: ollamaBody(messages, options, stream),
    signal: options.signal,
  });
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
  try {
    response = await request(messages, options, true);
  } catch (error) {
    throw unreachable(error);
  }
  if (!response.ok || !response.body) {
    throw new Error(`The local model returned ${response.status}.`);
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
  try {
    response = await request(messages, options, false);
  } catch (error) {
    throw unreachable(error);
  }
  if (!response.ok) {
    throw new Error(`The local model returned ${response.status}.`);
  }
  const data = await response.json();
  const text =
    provider === "openai"
      ? (data.choices?.[0]?.message?.content ?? "")
      : (data.message?.content ?? "");
  if (!text.trim()) throw new Error("The local model returned an empty reply.");
  return text;
}
