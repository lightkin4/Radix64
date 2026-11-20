import {
  MODEL_NAME,
  ollamaCandidates,
  ollamaFetch,
  ollamaStatus,
  reachableEndpoint,
} from "./ollama";
import { defaultModelName, selectedModelName } from "./llm";
import { readLines } from "./ndjson";
import { buildApp, type BuildEvent, type BuildResult } from "./build";
import type { TerminalEvent } from "./types";

// The Radix64 terminal: a small managed command set that runs on the server and
// talks to the local Ollama API over the compose network. There is no shell —
// every command maps to a documented Ollama endpoint.

type Json = Record<string, unknown>;

const helpLines = [
  "Radix64 terminal — commands run on the local server.",
  "",
  "  status                 reachability, version and the model in use",
  "  models                 models installed in Ollama",
  "  ps                     models currently loaded in memory",
  "  show <model>           details for one model",
  "  build <prompt>         build any app with the local model",
  "  ask <prompt>           chat with the selected model",
  "  run <model> <prompt>   chat with a specific model",
  "  pull <model>           download a model (e.g. llama3.2:3b)",
  "  version                Ollama server version",
  "  clear                  clear the screen",
  "  help                   this list",
];

const modelPattern = MODEL_NAME;

function tokenize(input: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return parts.filter((part) => part !== "");
}

function sizeLabel(bytes: unknown): string {
  if (typeof bytes !== "number" || bytes <= 0) return "—";
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: { code?: string } }).cause?.code;
    if (
      cause === "ECONNREFUSED" ||
      cause === "ENOTFOUND" ||
      cause === "EAI_AGAIN" ||
      cause === "UND_ERR_CONNECT_TIMEOUT"
    )
      return `${error.message} It may still be starting — try again in a moment.`;
    return cause ? `${error.message} (${cause})` : error.message;
  }
  return "The command failed.";
}

async function readJson(response: Response): Promise<Json | null> {
  try {
    return (await response.json()) as Json;
  } catch {
    return null;
  }
}

async function* getModels(): AsyncGenerator<TerminalEvent> {
  const response = await ollamaFetch(
    "/api/tags",
    { cache: "no-store" },
    { retries: 2, connectTimeoutMs: 3000 },
  );
  if (!response.ok) {
    yield { type: "error", text: `Ollama returned ${response.status} for /api/tags.` };
    return;
  }
  const data = await readJson(response);
  const models = (data?.models ?? []) as Json[];
  if (models.length === 0) {
    yield { type: "line", text: "No models installed. Try: pull llama3.2:3b" };
    return;
  }
  for (const model of models) {
    const name = String(model.name ?? "");
    const modified = String(model.modified_at ?? "").slice(0, 10);
    yield {
      type: "line",
      text: `${name.padEnd(24)} ${sizeLabel(model.size).padStart(8)}   ${modified}`,
    };
  }
}

async function* activeModels(): AsyncGenerator<TerminalEvent> {
  const response = await ollamaFetch(
    "/api/ps",
    { cache: "no-store" },
    { retries: 1, connectTimeoutMs: 3000 },
  );
  if (!response.ok) {
    yield { type: "error", text: `Ollama returned ${response.status} for /api/ps.` };
    return;
  }
  const data = await readJson(response);
  const models = (data?.models ?? []) as Json[];
  if (models.length === 0) {
    yield { type: "line", text: "No model is loaded right now." };
    return;
  }
  for (const model of models) {
    const until = String(model.expires_at ?? "").replace("T", " ").slice(0, 19);
    yield {
      type: "line",
      text: `${String(model.name ?? "").padEnd(24)} ${sizeLabel(model.size).padStart(8)}   until ${until}`,
    };
  }
}

async function* showModel(model: string): AsyncGenerator<TerminalEvent> {
  const response = await ollamaFetch(
    "/api/show",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    },
    { retries: 1, connectTimeoutMs: 5000 },
  );
  if (!response.ok) {
    yield {
      type: "error",
      text: response.status === 404
        ? `${model} is not installed. Try: pull ${model}`
        : `Ollama returned ${response.status} for ${model}.`,
    };
    return;
  }
  const data = await readJson(response);
  const details = (data?.details ?? {}) as Json;
  const capabilities = (data?.capabilities ?? []) as string[];
  const lines = [
    `model            ${model}`,
    `family           ${String(details.family ?? "—")}`,
    `parameters       ${String(details.parameter_size ?? "—")}`,
    `quantization     ${String(details.quantization_level ?? "—")}`,
    `context length   ${String(details.context_length ?? "—")}`,
    `capabilities     ${capabilities.length ? capabilities.join(", ") : "—"}`,
  ];
  for (const line of lines) yield { type: "line", text: line };
}

async function* chat(
  model: string,
  prompt: string,
  signal: AbortSignal,
): AsyncGenerator<TerminalEvent> {
  const started = Date.now();
  let response: Response;
  try {
    response = await ollamaFetch(
      "/api/chat",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
          options: { num_ctx: 4096 },
        }),
        signal,
      },
      // No connect deadline: the model may load for minutes before it answers.
      { retries: 1, connectTimeoutMs: 0 },
    );
  } catch (error) {
    yield { type: "error", text: errorText(error) };
    return;
  }
  if (!response.ok || !response.body) {
    yield {
      type: "error",
      text: response.status === 404
        ? `${model} is not installed. Try: pull ${model}`
        : `Ollama returned ${response.status} for ${model}.`,
    };
    return;
  }

  let count = 0;
  try {
    for await (const line of readLines(response.body)) {
      let data: Json;
      try {
        data = JSON.parse(line) as Json;
      } catch {
        continue;
      }
      if (typeof data.error === "string") {
        yield { type: "error", text: data.error };
        return;
      }
      const text = (data.message as Json | undefined)?.content;
      if (typeof text === "string" && text) {
        count += 1;
        yield { type: "delta", text };
      }
      if (data.done) {
        const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
        yield {
          type: "line",
          text: `\n✓ ${model} · ${count} chunks · ${seconds}s`,
        };
      }
    }
  } catch (error) {
    // Stop (or a closed panel) is not a failure: end the command quietly so the
    // terminal is ready for the next one.
    if (signal.aborted) {
      yield { type: "line", text: "\n⏹ stopped" };
      return;
    }
    yield { type: "error", text: errorText(error) };
  }
}

async function* pullModel(model: string): AsyncGenerator<TerminalEvent> {
  if (!modelPattern.test(model)) {
    yield { type: "error", text: "Use a model name like llama3.2:3b or qwen2.5:3b." };
    return;
  }
  const response = await ollamaFetch(
    "/api/pull",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: true }),
    },
    { retries: 1, connectTimeoutMs: 0 },
  );
  if (!response.ok || !response.body) {
    yield { type: "error", text: `Ollama returned ${response.status} for ${model}.` };
    return;
  }
  let reported = -10;
  for await (const line of readLines(response.body)) {
    let data: Json;
    try {
      data = JSON.parse(line) as Json;
    } catch {
      continue;
    }
    if (typeof data.error === "string") {
      yield { type: "error", text: data.error };
      return;
    }
    if (typeof data.status === "string" && typeof data.total === "number" && data.total > 0 && typeof data.completed === "number") {
      const percent = Math.floor((data.completed / data.total) * 100);
      if (percent >= reported + 10) {
        reported = percent;
        yield { type: "line", text: `${data.status} ${percent}%` };
      }
    } else if (typeof data.status === "string") {
      yield { type: "line", text: data.status };
    }
    if (data.done) break;
  }
  yield { type: "line", text: `${model} is ready. Use it with: run ${model} <prompt>` };
}

async function* status(): AsyncGenerator<TerminalEvent> {
  const [report, model] = await Promise.all([ollamaStatus(), selectedModelName()]);
  yield {
    type: "line",
    text: report.reachable
      ? `server           reachable at ${report.endpoint}`
      : `server           unreachable (tried ${ollamaCandidates().join(", ")})`,
  };
  yield { type: "line", text: `version          ${report.version ?? "—"}` };
  yield { type: "line", text: `model in use     ${model || defaultModelName}` };
  yield { type: "line", text: `last endpoint    ${reachableEndpoint()}` };
}

// Bridges the build pipeline's callback events into the terminal stream, so
// progress arrives while the model writes instead of after it finishes.
async function* runBuild(
  prompt: string,
  signal: AbortSignal,
): AsyncGenerator<TerminalEvent> {
  const queue: BuildEvent[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: unknown = null;
  let result: BuildResult | null = null;

  const push = (event: BuildEvent) => {
    queue.push(event);
    wake?.();
    wake = null;
  };

  void buildApp({ prompt, signal, emit: push })
    .then((built) => {
      result = built;
    })
    .catch((error: unknown) => {
      failure = error;
    })
    .finally(() => {
      finished = true;
      wake?.();
      wake = null;
    });

  while (!finished || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      continue;
    }
    const event = queue.shift() as BuildEvent;
    if (event.type === "app") {
      yield { type: "line", text: `app              ${event.app.name}` };
    } else if (event.type === "step") {
      const icon =
        event.status === "running" ? "…" : event.status === "done" ? "✓" : "✗";
      yield { type: "line", text: `${icon} ${event.label}` };
    } else if (event.type === "progress") {
      if (event.tokens % 200 === 0)
        yield { type: "line", text: `… ${event.tokens} tokens written` };
    } else if (event.type === "build") {
      yield { type: "line", text: `preview          ${event.preview}` };
    } else if (event.type === "error") {
      yield { type: "error", text: event.message };
    }
  }

  if (failure) {
    yield {
      type: "error",
      text: failure instanceof Error ? failure.message : "The build failed.",
    };
    return;
  }

  const built = result as BuildResult | null;
  if (built) {
    yield {
      type: "line",
      text: `✓ ${built.app.name} · v${built.version} · open in the preview panel`,
    };
    yield { type: "app", app: built.app, version: built.version };
  }
}

export async function* runTerminalCommand(
  input: string,
  signal: AbortSignal,
): AsyncGenerator<TerminalEvent> {
  const parts = tokenize(input);
  const command = (parts.shift() ?? "").toLowerCase();
  const rest = parts;
  const model = rest[0] ?? "";
  const prompt = rest.slice(1).join(" ");

  switch (command) {
    case "":
      return;
    case "help":
    case "?":
      for (const line of helpLines) yield { type: "line", text: line };
      return;
    case "status":
    case "ping":
      yield* status();
      return;
    case "models":
    case "list":
    case "ls":
      yield* getModels();
      return;
    case "ps":
      yield* activeModels();
      return;
    case "show":
      if (!model) {
        yield { type: "error", text: "Usage: show <model>" };
        return;
      }
      yield* showModel(model);
      return;
    case "version":
      {
        const report = await ollamaStatus();
        yield {
          type: "line",
          text: report.reachable
            ? `Ollama ${report.version ?? "unknown"} at ${report.endpoint}`
            : `Ollama is unreachable (tried ${ollamaCandidates().join(", ")}).`,
        };
      }
      return;
    case "build": {
      const spec = rest.join(" ");
      if (!spec) {
        yield { type: "error", text: "Usage: build <prompt>" };
        return;
      }
      yield { type: "line", text: `Building: ${spec}` };
      yield {
        type: "line",
        text: "A build takes a few minutes on the local model.",
      };
      yield* runBuild(spec, signal);
      return;
    }
    case "ask": {
      const question = rest.join(" ");
      if (!question) {
        yield { type: "error", text: "Usage: ask <prompt>" };
        return;
      }
      yield { type: "line", text: `→ ${await selectedModelName()}` };
      yield* chat(await selectedModelName(), question, signal);
      return;
    }
    case "run": {
      if (!model || !prompt) {
        yield { type: "error", text: "Usage: run <model> <prompt>" };
        return;
      }
      yield { type: "line", text: `→ ${model}` };
      yield* chat(model, prompt, signal);
      return;
    }
    case "pull":
      if (!model) {
        yield { type: "error", text: "Usage: pull <model>" };
        return;
      }
      yield* pullModel(model);
      return;
    default:
      yield { type: "error", text: `Unknown command: ${command}. Type "help" for the list.` };
  }
}
