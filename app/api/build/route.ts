import { buildApp, type BuildEvent } from "@/lib/build";

export const dynamic = "force-dynamic";

// POST /api/build — build any app from a prompt, or rebuild an existing one.
//
//   { "prompt": "a pomodoro timer", "appId": "optional-existing-app" }
//
// Streams newline-delimited JSON progress. The app is stored when the `build`
// event arrives; `preview` is the URL its HTML is served from.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const appId = typeof body?.appId === "string" && body.appId ? body.appId : null;
  if (!prompt)
    return Response.json({ error: "Write a prompt first." }, { status: 400 });

  const encoder = new TextEncoder();
  // The build stops when the caller disconnects, so the app is released instead
  // of staying "building" forever.
  const stop = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: BuildEvent): boolean => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          return true;
        } catch {
          // The caller went away and the stream was cancelled.
          return false;
        }
      };

      try {
        await buildApp({
          prompt,
          appId,
          signal: AbortSignal.any([request.signal, stop.signal]),
          emit: send,
        });
        send({ type: "done" });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "The build failed.",
        });
        send({ type: "done" });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the cancelled stream.
        }
      }
    },
    cancel() {
      stop.abort();
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
