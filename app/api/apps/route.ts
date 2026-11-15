import { createApp, listApps } from "@/lib/store";
import { nameFromPrompt } from "@/lib/prompts";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ apps: await listApps() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt)
    return Response.json({ error: "Describe the app you want." }, { status: 400 });

  const app = await createApp(nameFromPrompt(prompt));
  return Response.json({ app }, { status: 201 });
}
