import type {
  AppDetail,
  AppSummary,
  ChatEvent,
  ModelCatalog,
  ModelConfig,
  SettingsView,
  TerminalEvent,
} from "./types";

async function failure(response: Response): Promise<Error> {
  const data = await response.json().catch(() => null);
  return new Error(data?.error || `Request failed (${response.status}).`);
}

// Reads one of our newline-delimited JSON streams.
async function* readEvents<T>(response: Response): AsyncGenerator<T> {
  if (!response.ok || !response.body) throw await failure(response);

  const reader = response.body.getReader();
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
        if (line) yield JSON.parse(line) as T;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield JSON.parse(buffer) as T;
  } finally {
    reader.releaseLock();
  }
}

export async function listApps(): Promise<AppSummary[]> {
  const response = await fetch("/api/apps", { cache: "no-store" });
  if (!response.ok) throw await failure(response);
  return (await response.json()).apps;
}

export async function createApp(prompt: string): Promise<AppSummary> {
  const response = await fetch("/api/apps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()).app;
}

export async function getApp(id: string): Promise<AppDetail> {
  const response = await fetch(`/api/apps/${id}`, { cache: "no-store" });
  if (!response.ok) throw await failure(response);
  return (await response.json()).app;
}

export async function getModelConfig(): Promise<ModelConfig> {
  const response = await fetch("/api/config", { cache: "no-store" });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function getModelCatalog(): Promise<ModelCatalog> {
  const response = await fetch("/api/models", { cache: "no-store" });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function pullModel(name: string): Promise<void> {
  const response = await fetch("/api/models/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw await failure(response);
}

export async function getSettings(): Promise<SettingsView> {
  const response = await fetch("/api/settings", { cache: "no-store" });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function saveSettings(patch: {
  model?: string | null;
  githubToken?: string | null;
}): Promise<SettingsView> {
  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw await failure(response);
  return response.json();
}

export async function importRepo(input: {
  url: string;
  branch?: string;
  token?: string;
}): Promise<AppSummary> {
  const response = await fetch("/api/github/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()).app;
}

// Streams one chat turn as newline-delimited JSON events.
export async function* streamChat(
  appId: string,
  content: string,
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const response = await fetch(`/api/apps/${appId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    cache: "no-store",
    signal,
  });
  yield* readEvents<ChatEvent>(response);
}

// Runs one command in the Radix64 terminal, streamed as NDJSON events.
export async function* streamTerminal(
  command: string,
  signal: AbortSignal,
): AsyncGenerator<TerminalEvent> {
  const response = await fetch("/api/terminal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
    cache: "no-store",
    signal,
  });
  yield* readEvents<TerminalEvent>(response);
}
