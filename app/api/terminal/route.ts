import { runTerminalCommand } from "@/lib/terminal";
import type { TerminalEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

// One terminal command, streamed as newline-delimited JSON events so long
// answers (model chat, model downloads) render while they run.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const command =
    typeof body?.command === "string" ? body.command.trim() : "";
  if (!command)
    return Response.json({ error: "Type a command first." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: TerminalEvent): boolean => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          return true;
        } catch {
          // The panel was closed and the stream cancelled.
          return false;
        }
      };

      try {
        for await (const event of runTerminalCommand(command, request.signal)) {
          if (request.signal.aborted) break;
          if (!send(event)) return;
        }
      } catch (error) {
        send({
          type: "error",
          text: error instanceof Error ? error.message : "The command failed.",
        });
      } finally {
        if (!request.signal.aborted) send({ type: "done", code: 0 });
        try {
          controller.close();
        } catch {
          // Already closed by the cancelled stream.
        }
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
