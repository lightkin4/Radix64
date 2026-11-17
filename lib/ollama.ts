// Access to the local Ollama server.
//
// The web container and the model server run on the same Docker network, so the
// server is reached by its compose service name (http://ollama:11434) rather
// than through the sandbox host. OLLAMA_BASE_URL may name one or more addresses
// (comma separated); every candidate is tried in order and the first one that
// answers is cached. A stale address, a server that is still starting or a
// container restart therefore never becomes a permanent "cannot reach Ollama".

const DEFAULT_ENDPOINTS = [
  "http://ollama:11434",
  "http://127.0.0.1:11434",
  "http://localhost:11434",
];

function normalize(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

// Every address Radix64 will try, configured ones first.
export function ollamaCandidates(): string[] {
  const configured = (process.env.OLLAMA_BASE_URL ?? "")
    .split(/[,\s]+/)
    .map(normalize)
    .filter((value) => value.startsWith("http"));
  return [...new Set([...configured, ...DEFAULT_ENDPOINTS.map(normalize)])];
}

// The address that last answered, for status output and error messages.
let reachable: { url: string; checkedAt: number } | null = null;
const CACHE_MS = 30_000;

export function reachableEndpoint(): string {
  if (reachable && Date.now() - reachable.checkedAt < CACHE_MS) {
    return reachable.url;
  }
  return ollamaCandidates()[0];
}

function orderedBases(): string[] {
  const candidates = ollamaCandidates();
  const preferred = reachableEndpoint();
  return [preferred, ...candidates.filter((url) => url !== preferred)];
}

function isCallerAbort(error: unknown, signal?: AbortSignal | null): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && error.name === "AbortError";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Deadline for connecting only: once the server has answered with headers, a
// long streamed reply (a chat turn or a model download) may take minutes.
// `timeoutMs <= 0` waits indefinitely — Ollama sends no headers until the
// prompt is evaluated, which can take minutes while a model loads.
async function connect(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (timeoutMs <= 0) return fetch(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  (timer as unknown as { unref?: () => void }).unref?.();
  const signal = init.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  try {
    return await fetch(url, { ...init, signal });
  } finally {
    clearTimeout(timer);
  }
}

export type OllamaRequestOptions = {
  retries?: number;
  connectTimeoutMs?: number;
};

// fetch() against whichever candidate answers, retrying connection failures
// (server booting, container restart) before giving up. Only the connection is
// retried, so a half-streamed reply is never replayed.
export async function ollamaFetch(
  path: string,
  init: RequestInit = {},
  options: OllamaRequestOptions = {},
): Promise<Response> {
  const retries = options.retries ?? 3;
  const timeoutMs = options.connectTimeoutMs ?? 4000;
  const callerSignal = init.signal ?? null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    for (const base of orderedBases()) {
      try {
        const response = await connect(`${base}${path}`, init, timeoutMs);
        reachable = { url: base, checkedAt: Date.now() };
        return response;
      } catch (error) {
        if (isCallerAbort(error, callerSignal)) throw error;
        lastError = error;
      }
    }
    if (attempt < retries) await sleep(250 * (attempt + 1));
  }

  const failure = new Error(
    `Cannot reach the Ollama server (tried ${ollamaCandidates().join(", ")}).`,
  );
  (failure as Error & { cause?: unknown }).cause = lastError;
  throw failure;
}

export type OllamaStatus = {
  reachable: boolean;
  endpoint: string;
  version: string | null;
};

// Cheap reachability probe used by the terminal's `status` command.
export async function ollamaStatus(): Promise<OllamaStatus> {
  try {
    const response = await ollamaFetch(
      "/api/version",
      { cache: "no-store" },
      { retries: 1, connectTimeoutMs: 2500 },
    );
    const data = await response.json().catch(() => null);
    return {
      reachable: response.ok,
      endpoint: reachableEndpoint(),
      version: typeof data?.version === "string" ? data.version : null,
    };
  } catch {
    return { reachable: false, endpoint: reachableEndpoint(), version: null };
  }
}
