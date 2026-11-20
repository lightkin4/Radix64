import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The build pipeline writes through the JSON store, so give it a throwaway
// data directory before the store module is loaded.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "radix64-build-"));

const { buildApp } = await import("../lib/build.ts");
const { createApp, deleteApp, getApp, getAppHtml, startTurn } = await import(
  "../lib/store.ts"
);

const page = (title: string) =>
  `<!DOCTYPE html><html lang="en"><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;

test("builds a new app from a prompt and stores the artifact", async () => {
  const events: Array<{ type: string; status?: string; preview?: string }> = [];
  const result = await buildApp({
    prompt: "a tiny hello page",
    emit: (event) => events.push(event as { type: string }),
    generate: async () => page("Hello"),
  });

  assert.equal(result.version, 1);
  const stored = await getApp(result.app.id);
  assert.ok(stored, "app exists");
  assert.equal(stored.building, false, "build slot released");
  assert.equal(stored.hasPreview, true);
  assert.match(String(await getAppHtml(result.app.id)), /<h1>Hello<\/h1>/);
  assert.equal(stored.messages.at(-1)?.role, "assistant");

  assert.deepEqual(
    events.map((event) => event.type),
    ["app", "step", "step", "build"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "step").map((event) => event.status),
    ["running", "done"],
  );
  assert.equal(
    events[3].preview,
    `/api/apps/${result.app.id}/preview?v=1`,
  );

  await deleteApp(result.app.id);
});

test("rebuilds an existing app with the current HTML in the prompt", async () => {
  const created = await createApp("existing");
  await buildApp({
    prompt: "first version",
    appId: created.id,
    generate: async () => page("One"),
  });

  let seen = "";
  const result = await buildApp({
    prompt: "second version",
    appId: created.id,
    generate: async (messages) => {
      seen = messages.map((message) => message.content).join("\n");
      return page("Two");
    },
  });

  assert.equal(result.version, 2);
  assert.match(seen, /Current app HTML/);
  assert.match(seen, /<h1>One<\/h1>/);
  assert.match(seen, /Change requested: second version/);
  assert.match(String(await getAppHtml(created.id)), /<h1>Two<\/h1>/);

  await deleteApp(created.id);
});

test("a model that returns no app releases the build slot", async () => {
  const created = await createApp("broken");
  await assert.rejects(
    buildApp({
      prompt: "anything",
      appId: created.id,
      // extractHtml wraps stray text, so an empty reply is the real failure.
      generate: async () => "   ",
    }),
    /did not return an app/,
  );

  const stored = await getApp(created.id);
  assert.equal(stored?.building, false, "build slot released after failure");
  assert.equal(stored?.version, 0, "no version was published");
  assert.match(
    String(stored?.messages.at(-1)?.text),
    /did not return an app/,
  );

  await deleteApp(created.id);
});

test("a second build of one app is refused while the first runs", async () => {
  const created = await createApp("busy");
  let release: (value: string) => void = () => undefined;
  const gate = new Promise<string>((resolve) => {
    release = resolve;
  });

  const first = buildApp({
    prompt: "one",
    appId: created.id,
    generate: async () => gate,
  });
  await assert.rejects(
    buildApp({
      prompt: "two",
      appId: created.id,
      generate: async () => page("Two"),
    }),
    /already building/,
  );

  release(page("One"));
  const result = await first;
  assert.equal(result.version, 1);

  await deleteApp(created.id);
});

test("another app cannot build while one is already building", async () => {
  const first = await createApp("first");
  let release: (value: string) => void = () => undefined;
  const gate = new Promise<string>((resolve) => {
    release = resolve;
  });

  const running = buildApp({
    prompt: "one",
    appId: first.id,
    generate: async () => gate,
  });

  // Wait until the first build actually holds the slot.
  for (let tries = 0; tries < 100 && !(await getApp(first.id))?.building; tries++)
    await new Promise((resolve) => setTimeout(resolve, 10));

  // The model answers one request at a time, so a second build is refused up
  // front instead of waiting invisibly behind the first.
  await assert.rejects(
    buildApp({ prompt: "a second page", generate: async () => page("Second") }),
    /still building/,
  );

  release(page("First"));
  assert.equal((await running).version, 1);

  await deleteApp(first.id);
});

test("a turn that stopped refreshing is released so the app can build again", async () => {
  const created = await createApp("stalled");
  assert.ok(await startTurn(created.id, "first attempt"), "first turn claimed");
  assert.equal(await startTurn(created.id, "second attempt"), null, "claimed");

  // Simulate a crashed turn: the claim stopped refreshing minutes ago.
  const file = path.join(String(process.env.DATA_DIR), "apps.json");
  const db = JSON.parse(readFileSync(file, "utf8")) as {
    apps: Array<{ id: string; buildingAt?: string }>;
  };
  const record = db.apps.find((app) => app.id === created.id);
  assert.ok(record);
  record.buildingAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  writeFileSync(file, JSON.stringify(db));

  const turn = await startTurn(created.id, "second attempt");
  assert.ok(turn, "the stale claim was released");
  const stored = await getApp(created.id);
  assert.equal(stored?.building, true, "the new turn owns the app");
  assert.match(
    stored?.messages.map((message) => message.text).join("\n") ?? "",
    /interrupted before it finished/,
  );

  await deleteApp(created.id);
});

test("rejects an empty prompt and an unknown app", async () => {
  await assert.rejects(buildApp({ prompt: "   " }), /Write a prompt first/);
  await assert.rejects(
    buildApp({ prompt: "x", appId: "missing-app" }),
    /no longer exists/,
  );
});
