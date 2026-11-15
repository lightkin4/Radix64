import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppDetail, AppSummary, ChatMessage, Role } from "./types";
import type { RepoSnapshot } from "./github";

// Single-file JSON store. Radix64 runs as one Node process, so serializing
// mutations through a promise chain is enough to keep the file consistent.
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const dbFile = path.join(dataDir, "apps.json");

type StoredApp = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  building: boolean;
  html: string | null;
  messages: ChatMessage[];
  repo: RepoSnapshot | null;
};
type Db = { apps: StoredApp[] };

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function readDb(): Promise<Db> {
  try {
    const parsed = JSON.parse(await readFile(dbFile, "utf8"));
    return { apps: Array.isArray(parsed.apps) ? parsed.apps : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { apps: [] };
    throw error;
  }
}

async function writeDb(db: Db) {
  await mkdir(dataDir, { recursive: true });
  const temp = `${dbFile}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(db, null, 2));
  await rename(temp, dbFile);
}

function summarize(app: StoredApp): AppSummary {
  return {
    id: app.id,
    name: app.name,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
    version: app.version,
    building: app.building,
    hasPreview: app.html !== null,
    repo: app.repo
      ? {
          owner: app.repo.owner,
          repo: app.repo.repo,
          branch: app.repo.branch,
          url: app.repo.url,
          fileCount: app.repo.files.length,
          filesRead: app.repo.contents.length,
        }
      : null,
  };
}

function detail(app: StoredApp): AppDetail {
  return { ...summarize(app), messages: app.messages };
}

export function listApps(): Promise<AppSummary[]> {
  return enqueue(async () => {
    const { apps } = await readDb();
    return [...apps]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summarize);
  });
}

export function getApp(id: string): Promise<AppDetail | null> {
  return enqueue(async () => {
    const { apps } = await readDb();
    const app = apps.find((candidate) => candidate.id === id);
    return app ? detail(app) : null;
  });
}

// The repository an app was imported from, with the file text the build reads.
export function getAppRepo(id: string): Promise<RepoSnapshot | null> {
  return enqueue(async () => {
    const { apps } = await readDb();
    return apps.find((candidate) => candidate.id === id)?.repo ?? null;
  });
}

export function getAppHtml(id: string): Promise<string | null> {
  return enqueue(async () => {
    const { apps } = await readDb();
    return apps.find((candidate) => candidate.id === id)?.html ?? null;
  });
}

export function createApp(
  name: string,
  repo: RepoSnapshot | null = null,
): Promise<AppSummary> {
  return enqueue(async () => {
    const db = await readDb();
    const now = new Date().toISOString();
    const app: StoredApp = {
      id: randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      version: 0,
      building: false,
      html: null,
      messages: [],
      repo,
    };
    db.apps.push(app);
    await writeDb(db);
    return summarize(app);
  });
}

export function deleteApp(id: string): Promise<boolean> {
  return enqueue(async () => {
    const db = await readDb();
    const before = db.apps.length;
    db.apps = db.apps.filter((app) => app.id !== id);
    if (db.apps.length === before) return false;
    await writeDb(db);
    return true;
  });
}

// Claims the build slot and records the user's message in one write, so two
// concurrent turns can't build the same app at once.
export function startTurn(
  id: string,
  text: string,
): Promise<{ message: ChatMessage; app: AppDetail } | null> {
  return enqueue(async () => {
    const db = await readDb();
    const app = db.apps.find((candidate) => candidate.id === id);
    if (!app || app.building) return null;
    const message: ChatMessage = {
      id: randomUUID(),
      role: "user",
      text,
      createdAt: new Date().toISOString(),
    };
    app.messages.push(message);
    app.building = true;
    app.updatedAt = message.createdAt;
    await writeDb(db);
    return { message, app: detail(app) };
  });
}

export function finishTurn(
  id: string,
  html: string,
  assistantText: string,
): Promise<number | null> {
  return enqueue(async () => {
    const db = await readDb();
    const app = db.apps.find((candidate) => candidate.id === id);
    if (!app) return null;
    const now = new Date().toISOString();
    app.html = html;
    app.version += 1;
    app.building = false;
    app.updatedAt = now;
    app.messages.push({
      id: randomUUID(),
      role: "assistant",
      text: assistantText,
      createdAt: now,
    });
    await writeDb(db);
    return app.version;
  });
}

export async function failTurn(id: string, message: string) {
  await enqueue(async () => {
    const db = await readDb();
    const app = db.apps.find((candidate) => candidate.id === id);
    if (!app) return;
    app.building = false;
    app.messages.push({
      id: randomUUID(),
      role: "assistant",
      text: message,
      createdAt: new Date().toISOString(),
    });
    await writeDb(db);
  });
}

export function appendMessage(
  id: string,
  role: Role,
  text: string,
): Promise<ChatMessage | null> {
  return enqueue(async () => {
    const db = await readDb();
    const app = db.apps.find((candidate) => candidate.id === id);
    if (!app) return null;
    const message: ChatMessage = {
      id: randomUUID(),
      role,
      text,
      createdAt: new Date().toISOString(),
    };
    app.messages.push(message);
    app.updatedAt = message.createdAt;
    await writeDb(db);
    return message;
  });
}
