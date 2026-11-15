import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Local settings for this Radix64 install: the model the chat should use and an
// optional GitHub token for private repositories. Kept next to the app store so
// it survives restarts; the token is never sent back to the browser.
export type Settings = {
  model: string | null;
  githubToken: string | null;
};

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const file = path.join(dataDir, "settings.json");

const empty: Settings = { model: null, githubToken: null };

function normalize(value: unknown): Settings {
  const raw = (value ?? {}) as Partial<Settings>;
  return {
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : null,
    githubToken:
      typeof raw.githubToken === "string" && raw.githubToken.trim()
        ? raw.githubToken.trim()
        : null,
  };
}

export async function getSettings(): Promise<Settings> {
  try {
    return normalize(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...empty };
    throw error;
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = normalize({ ...current, ...patch });
  await mkdir(dataDir, { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(next, null, 2));
  await rename(temp, file);
  return next;
}
