import test from "node:test";
import assert from "node:assert/strict";
import { ollamaCandidates, ollamaFetch, ollamaStatus } from "../lib/ollama.ts";
import { defaultModelName, isModelReady, listModels } from "../lib/llm.ts";

// Connectivity between Radix64 and the local Ollama server. Run inside the app
// container, where the compose network name resolves:
//   docker compose exec -T web npm test

test("candidates always include the compose network address", () => {
  const candidates = ollamaCandidates();
  assert.ok(candidates.includes("http://ollama:11434"), "network endpoint");
  assert.ok(candidates.includes("http://127.0.0.1:11434"), "loopback endpoint");
});

test("reaches the Ollama server on the compose network", async () => {
  const status = await ollamaStatus();
  assert.equal(status.reachable, true, "Ollama answered /api/version");
  assert.match(String(status.version), /^\d+\.\d+/, "reports a version");
  assert.match(status.endpoint, /ollama:11434|127\.0\.0\.1:11434/);
});

test("falls back when the first configured address is dead", async () => {
  const previous = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = "http://127.0.0.1:9";
  try {
    assert.equal(ollamaCandidates()[0], "http://127.0.0.1:9");
    const response = await ollamaFetch(
      "/api/tags",
      { cache: "no-store" },
      { retries: 0, connectTimeoutMs: 1500 },
    );
    assert.equal(response.status, 200);
    const data = (await response.json()) as { models?: unknown[] };
    assert.ok(Array.isArray(data.models));
  } finally {
    if (previous === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = previous;
  }
});

test("lists the installed models and sees the configured default", async () => {
  const models = await listModels();
  assert.ok(models.length > 0, "at least one model is installed");
  assert.ok(
    models.some(
      (model) =>
        model.name === defaultModelName ||
        model.name === `${defaultModelName}:latest`,
    ),
    `default model ${defaultModelName} is installed`,
  );
  assert.equal(await isModelReady(defaultModelName), true);
});
