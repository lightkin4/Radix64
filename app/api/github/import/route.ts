import { readRepo } from "@/lib/github";
import { getSettings, saveSettings } from "@/lib/settings";
import { createApp } from "@/lib/store";

export const dynamic = "force-dynamic";
// Reading a repository means dozens of GitHub requests.
export const maxDuration = 60 * 5;

// Connects a GitHub repository: reads its source files and stores them with a
// new app, so the next build recreates that app in Radix64.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) {
    return Response.json({ error: "Paste a GitHub repository URL." }, { status: 400 });
  }

  const settings = await getSettings();
  const token =
    typeof body?.token === "string" && body.token.trim()
      ? body.token.trim()
      : settings.githubToken;
  const branch = typeof body?.branch === "string" ? body.branch.trim() : "";

  let repo;
  try {
    repo = await readRepo(url, { branch, token });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read that repository.";
    return Response.json({ error: message }, { status: 502 });
  }

  if (typeof body?.token === "string" && body.token.trim()) {
    await saveSettings({ githubToken: body.token.trim() });
  }

  const app = await createApp(`${repo.owner}/${repo.repo}`, repo);
  return Response.json({ app }, { status: 201 });
}
