import { getSettings, saveSettings } from "@/lib/settings";
import { defaultModelName } from "@/lib/llm";
import type { SettingsView } from "@/lib/types";

export const dynamic = "force-dynamic";

function view(settings: Awaited<ReturnType<typeof getSettings>>): SettingsView {
  return {
    model: settings.model,
    defaultModel: defaultModelName,
    provider: process.env.LLM_PROVIDER === "openai" ? "openai" : "ollama",
    hasGithubToken: Boolean(settings.githubToken),
  };
}

export async function GET() {
  return Response.json(view(await getSettings()));
}

// `{ model }` picks the chat model, `{ githubToken }` stores (or clears with an
// empty string) the token used for private repositories.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const patch: { model?: string | null; githubToken?: string | null } = {};

  if ("model" in body) {
    if (body.model !== null && typeof body.model !== "string") {
      return Response.json({ error: "Invalid model." }, { status: 400 });
    }
    const model = typeof body.model === "string" ? body.model.trim() : null;
    if (model && !/^[\w.\-/:]{1,80}$/.test(model)) {
      return Response.json({ error: "Use a model name like llama3.2:3b." }, { status: 400 });
    }
    patch.model = model;
  }

  if ("githubToken" in body) {
    if (body.githubToken !== null && typeof body.githubToken !== "string") {
      return Response.json({ error: "Invalid token." }, { status: 400 });
    }
    const token = typeof body.githubToken === "string" ? body.githubToken.trim() : "";
    patch.githubToken = token.length > 0 ? token : null;
  }

  return Response.json(view(await saveSettings(patch)));
}
