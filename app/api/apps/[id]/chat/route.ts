import { complete, isModelReady, streamChat } from "@/lib/llm";
import { buildMessages, extractHtml, replyMessages } from "@/lib/prompts";
import {
  failTurn,
  finishTurn,
  getAppHtml,
  getAppRepo,
  startTurn,
} from "@/lib/store";
import type { ChatEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

// One chat turn: stream a short assistant reply, then build the app's HTML.
// Events are newline-delimited JSON so the chat UI can render as it goes.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const prompt = typeof body?.content === "string" ? body.content.trim() : "";
  if (!prompt)
    return Response.json({ error: "Write a message first." }, { status: 400 });

  if (!(await isModelReady()))
    return Response.json(
      {
        error:
          "The local model is still starting up. This takes a minute on first run — try again shortly.",
      },
      { status: 503 },
    );

  const turn = await startTurn(id, prompt);
  if (!turn)
    return Response.json(
      { error: "This app is not ready for another message yet." },
      { status: 409 },
    );

  // If the browser goes away mid-turn (reload, stop, closed tab) the stream
  // never runs its catch, which used to leave the app stuck "building" and
  // refusing every later message. Release the turn from the abort instead.
  let settled = false;
  const stopTurn = () => {
    if (settled) return;
    settled = true;
    void failTurn(id, "The turn was stopped before it finished.");
  };
  request.signal.addEventListener("abort", stopTurn);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const step = (label: string, status: "running" | "done" | "error") =>
        send({ type: "step", label, status });
      let building = false;
      let buildLabel = "Writing your app";

      try {
        send({ type: "message", message: turn.message });
        const html = await getAppHtml(id);
        // A repo import has no build yet: the first turn rebuilds it from source.
        const repo = html ? null : await getAppRepo(id);

        step("Thinking", "running");
        let reply = "";
        for await (const delta of streamChat(
          replyMessages(turn.app.messages.slice(0, -1), prompt, html),
          { numPredict: 160, temperature: 0.7, signal: request.signal },
        )) {
          reply += delta;
          send({ type: "delta", text: delta });
        }
        step("Thinking", "done");

        const buildStep = repo ? "Reading the repository" : "Writing your app";
        buildLabel = buildStep;
        step(buildStep, "running");
        building = true;
        const generated = await complete(buildMessages(prompt, html, repo), {
          numPredict: 2600,
          temperature: 0.4,
          signal: request.signal,
        });
        const document = extractHtml(generated);
        if (!document)
          throw new Error("The model did not return an app. Try rephrasing.");

        const version = await finishTurn(
          id,
          document,
          reply.trim() || "Your app is ready.",
        );
        settled = true;
        building = false;
        step(buildStep, "done");
        if (version !== null) send({ type: "build", version });
        send({ type: "done" });
      } catch (error) {
        // A browser that navigated away or pressed stop is not a model failure:
        // say so plainly instead of reporting a connection error.
        const stopped = request.signal.aborted;
        const message = stopped
          ? "The turn was stopped before it finished."
          : error instanceof Error
            ? error.message
            : "Something went wrong while building your app.";
        step(buildLabel, building ? "error" : "done");
        if (!stopped) send({ type: "error", message });
        if (!settled) {
          settled = true;
          await failTurn(id, message);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
