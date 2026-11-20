import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "radix64-terminal-"));

const { runTerminalCommand } = await import("../lib/terminal.ts");
type TerminalEvent = import("../lib/types.ts").TerminalEvent;

async function collect(
  command: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<TerminalEvent[]> {
  const events: TerminalEvent[] = [];
  for await (const event of runTerminalCommand(command, signal)) events.push(event);
  return events;
}

function textOf(events: TerminalEvent[]): string {
  return events
    .map((event) => ("text" in event ? event.text : ""))
    .join("\n");
}

test("help lists every command", async () => {
  const output = textOf(await collect("help"));
  for (const command of ["status", "models", "ps", "show", "build", "ask", "run", "pull", "version"]) {
    assert.match(output, new RegExp(`\\b${command}\\b`));
  }
});

test("status reports the reachable server and the model in use", async () => {
  const events = await collect("status");
  assert.ok(!events.some((event) => event.type === "error"));
  const output = textOf(events);
  assert.match(output, /reachable at http:\/\/ollama:11434/);
  assert.match(output, /model in use\s+\S+/);
});

test("models and show read the installed models", async () => {
  const list = await collect("models");
  assert.match(textOf(list), /llama3\.2:3b/);

  const shown = await collect("show llama3.2:3b");
  const output = textOf(shown);
  assert.match(output, /family\s+llama/);
  assert.match(output, /quantization/);
  assert.ok(!shown.some((event) => event.type === "error"));
});

test("an unknown command errors, and the next command still runs", async () => {
  const bad = await collect("nope");
  assert.ok(bad.some((event) => event.type === "error"));

  const good = await collect("status");
  assert.ok(!good.some((event) => event.type === "error"));
  assert.match(textOf(good), /reachable/);
});

test("usage errors never reach the model", async () => {
  assert.match(textOf(await collect("run")), /Usage: run <model> <prompt>/);
  assert.match(textOf(await collect("build")), /Usage: build <prompt>/);
  assert.match(textOf(await collect("show")), /Usage: show <model>/);
  assert.match(
    textOf(await collect("pull ../../etc/passwd")),
    /Use a model name like/,
  );
});

// Generating with the local model is slow and the server answers one request at
// a time, so this live test is opt-in: RADIX64_LIVE_CHAT=1 npm test
test(
  "a running chat stops cleanly when the signal aborts",
  { skip: process.env.RADIX64_LIVE_CHAT === "1" ? false : "set RADIX64_LIVE_CHAT=1" },
  async () => {
  const controller = new AbortController();
  const events: TerminalEvent[] = [];
  for await (const event of runTerminalCommand(
    "run llama3.2:3b count from one to one hundred slowly",
    controller.signal,
  )) {
    events.push(event);
    if (event.type === "delta") controller.abort();
  }

  assert.ok(
    events.some((event) => event.type === "delta"),
    "the model started answering",
  );
  assert.ok(
    !events.some((event) => event.type === "error"),
    "stopping is not reported as an error",
  );
});
