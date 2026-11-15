import { defaultModelName, isModelReady, listModels, selectedModelName } from "@/lib/llm";

export const dynamic = "force-dynamic";

// Models installed in Ollama, plus the one Radix64 is currently using.
export async function GET() {
  const selected = await selectedModelName();
  const provider = process.env.LLM_PROVIDER === "openai" ? "openai" : "ollama";
  const [models, ready] = await Promise.all([
    listModels(),
    isModelReady(selected),
  ]);
  return Response.json({
    provider,
    models,
    selected,
    defaultModel: defaultModelName,
    ready,
  });
}
