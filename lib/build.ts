import { streamChat, type LLMMessage } from "./llm";
import { buildMessages, extractHtml, nameFromPrompt } from "./prompts";
import {
  BUILD_HEARTBEAT_MS,
  createApp,
  failTurn,
  finishTurn,
  getApp,
  getAppHtml,
  getAppRepo,
  listApps,
  startTurn,
  touchTurn,
} from "./store";
import type { AppSummary } from "./types";

// One build pipeline for every entry point: POST /api/build, the terminal's
// `build` command and any other caller. It builds any described app from the
// local model, or rebuilds an existing app (and a connected repository), and
// keeps the store's turn state consistent when the model or the caller fails.

// Hard ceiling for one build. A local model can be slow, but a build that runs
// this long is wedged, so it is stopped and the app released.
const BUILD_TIMEOUT_MS = 20 * 60_000;

export type GenerateFn = (
  messages: LLMMessage[],
  signal?: AbortSignal,
) => Promise<string>;

export type BuildEvent =
  | { type: "app"; app: AppSummary }
  | { type: "step"; label: string; status: "running" | "done" | "error" }
  // Tokens written so far, so a slow local model still shows movement.
  | { type: "progress"; tokens: number }
  | { type: "build"; appId: string; version: number; preview: string }
  | { type: "error"; message: string }
  | { type: "done" };

// Builds stream instead of waiting for the whole reply, so the caller can show
// progress and the connection stays alive for the minutes a local model needs.
async function generateWithProgress(
  messages: LLMMessage[],
  signal: AbortSignal | undefined,
  onProgress: (tokens: number) => void,
): Promise<string> {
  let text = "";
  let chunks = 0;
  for await (const delta of streamChat(messages, {
    numPredict: 1600,
    temperature: 0.4,
    signal,
  })) {
    text += delta;
    chunks += 1;
    if (chunks % 25 === 0) onProgress(chunks);
  }
  return text;
}

export type BuildResult = { app: AppSummary; version: number };

export type BuildInput = {
  prompt: string;
  // An existing app to rebuild; omitted for a brand-new app.
  appId?: string | null;
  signal?: AbortSignal;
  emit?: (event: BuildEvent) => void;
  // Test seam: a fake model instead of the local Ollama server.
  generate?: GenerateFn;
};

export async function buildApp(input: BuildInput): Promise<BuildResult> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Write a prompt first.");

  const emit = input.emit ?? (() => undefined);

  let app = input.appId ? await getApp(input.appId) : null;
  if (input.appId && !app) throw new Error("That app no longer exists.");

  // One build at a time: the local model answers one request at a time, so a
  // second build would otherwise wait invisibly behind the first for minutes.
  const busy = (await listApps()).find((other) => other.building && other.id !== app?.id);
  if (busy)
    throw new Error(`${busy.name} is still building — try again when it finishes.`);

  if (!app) {
    const created = await createApp(nameFromPrompt(prompt));
    emit({ type: "app", app: created });
    app = { ...created, messages: [] };
  }

  // Claims the build slot, so two builds of one app can never overlap.
  const turn = await startTurn(app.id, prompt);
  if (!turn) throw new Error("This app is already building. Try again when it finishes.");

  const appId = app.id;
  const html = await getAppHtml(appId);
  const repo = html ? null : await getAppRepo(appId);
  // Keeps the claim fresh while the model writes, so a slow build is never
  // released as stale half-way through.
  const heartbeat = setInterval(() => {
    void touchTurn(appId);
  }, BUILD_HEARTBEAT_MS);
  // Stops a wedged build: the ceiling below, plus the idle watchdog in the model
  // client, so a stuck generation can never hold the app forever.
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, BUILD_TIMEOUT_MS);
  const forwardAbort = () => controller.abort();
  input.signal?.addEventListener("abort", forwardAbort, { once: true });

  const label = repo ? "Reading the repository" : "Writing your app";
  emit({ type: "step", label, status: "running" });

  try {
    const generate: GenerateFn =
      input.generate ??
      ((messages, signal) =>
        generateWithProgress(messages, signal, (tokens) =>
          emit({ type: "progress", tokens }),
        ));
    const generated = await generate(
      buildMessages(prompt, html, repo),
      controller.signal,
    );
    const document = extractHtml(generated);
    if (!document)
      throw new Error("The model did not return an app. Try rephrasing.");

    const version = (await finishTurn(appId, document, "Your app is ready.")) ?? 0;
    const stored = (await getApp(appId)) ?? app;
    emit({ type: "step", label, status: "done" });
    emit({
      type: "build",
      appId,
      version,
      preview: `/api/apps/${appId}/preview?v=${version}`,
    });
    return { app: stored, version };
  } catch (error) {
    const message = timedOut
      ? "The build took too long and was stopped. Try again, or pick a smaller model."
      : input.signal?.aborted
        ? "The build was stopped before it finished."
        : error instanceof Error
          ? error.message
          : "The build failed.";
    emit({ type: "step", label, status: "error" });
    await failTurn(appId, message);
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardAbort);
    clearInterval(heartbeat);
  }
}
