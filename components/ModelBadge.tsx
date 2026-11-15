"use client";
import { useEffect, useState } from "react";
import { getModelConfig } from "@/lib/api";
import type { ModelConfig } from "@/lib/types";

// Shows which model answers the chat, and whether the local llama is loaded yet.
export default function ModelBadge() {
  const [config, setConfig] = useState<ModelConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const next = await getModelConfig();
        if (cancelled) return;
        setConfig(next);
        if (next.ready) return;
      } catch {
        if (cancelled) return;
      }
      timer = setTimeout(poll, 5000);
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const label = !config
    ? "local model"
    : config.ready
      ? `${config.model} · local`
      : `${config.model} · starting…`;

  return (
    <span
      className="model-badge"
      data-ready={config?.ready ? "true" : "false"}
      title={config ? `${config.provider} · ${config.model}` : "Local model"}
    >
      {label}
    </span>
  );
}
