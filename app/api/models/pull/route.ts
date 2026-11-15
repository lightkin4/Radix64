import { isModelReady, listModels, pullModel, selectedModelName } from "@/lib/llm";

export const dynamic = "force-dynamic";
// Downloading a model can take minutes on a slow connection.
export const maxDuration = 60 * 30;

// Downloads a model into Ollama so it can be picked for chat.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Which model should be downloaded?" }, { status: 400 });
  }

  try {
    await pullModel(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The download failed.";
    return Response.json({ error: message }, { status: 502 });
  }

  const selected = await selectedModelName();
  return Response.json({
    name,
    models: await listModels(),
    ready: await isModelReady(selected),
  });
}
