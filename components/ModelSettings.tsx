"use client";
import { useCallback, useEffect, useState } from "react";
import { DownloadIcon } from "lucide-react";
import Modal from "./Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getModelCatalog, pullModel, saveSettings } from "@/lib/api";
import type { ModelCatalog, ModelInfo } from "@/lib/types";

function sizeLabel(size: number | null): string {
  if (!size) return "";
  const gb = size / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(size / 1024 ** 2)} MB`;
}

// Pick which Ollama model answers the chat, or download another one.
export default function ModelSettings({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [chosen, setChosen] = useState("");
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState<"load" | "pull" | "save" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    setError(null);
    try {
      const next = await getModelCatalog();
      setCatalog(next);
      setChosen(next.selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the models.");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function download() {
    const name = custom.trim();
    if (!name) return;
    setBusy("pull");
    setError(null);
    setNote(`Downloading ${name}. This can take a few minutes.`);
    try {
      await pullModel(name);
      setCustom("");
      const next = await getModelCatalog();
      setCatalog(next);
      setChosen(name);
      setNote(`${name} is ready. Save to start using it.`);
    } catch (cause) {
      setNote(null);
      setError(cause instanceof Error ? cause.message : "The download failed.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!chosen) return;
    setBusy("save");
    setError(null);
    try {
      await saveSettings({ model: chosen });
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the model.");
      setBusy(null);
    }
  }

  const models: ModelInfo[] = catalog?.models ?? [];
  const selectedSize = models.find((model) => model.name === chosen)?.size ?? null;

  return (
    <Modal
      title="Chat model"
      subtitle="Radix64 runs every reply and build on a model in your local Ollama server."
      onClose={onClose}
    >
      <div className="modal-row">
        <span className="modal-label">Installed models</span>
        {busy === "load" && <p className="modal-hint">Reading installed models…</p>}
        {busy !== "load" && models.length === 0 && (
          <p className="modal-hint">
            No models installed yet. Download one below to get started.
          </p>
        )}
        {models.length > 0 && (
          <Select value={chosen} onValueChange={setChosen}>
            <SelectTrigger className="model-select">
              <SelectValue placeholder="Pick a model" />
            </SelectTrigger>
            <SelectContent position="popper">
              {models.map((model) => (
                <SelectItem key={model.name} value={model.name}>
                  <span className="model-name">{model.name}</span>
                  {model.size ? (
                    <span className="model-size">{sizeLabel(model.size)}</span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {catalog && (
          <p className="modal-hint">
            Default from the environment: {catalog.defaultModel}
            {selectedSize ? ` · ${sizeLabel(selectedSize)}` : ""}
          </p>
        )}
      </div>

      <div className="modal-row">
        <span className="modal-label">Download another model</span>
        <div className="modal-inline">
          <Input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder="qwen2.5:3b"
            onKeyDown={(event) => {
              if (event.key === "Enter" && busy !== "pull") download();
            }}
          />
          <Button
            variant="secondary"
            onClick={download}
            disabled={busy === "pull" || !custom.trim()}
          >
            <DownloadIcon />
            {busy === "pull" ? "Downloading…" : "Download"}
          </Button>
        </div>
        <p className="modal-hint">
          Any Ollama model name works. Bigger models answer better but build slower.
        </p>
      </div>

      {note && <p className="modal-ok">{note}</p>}
      {error && <p className="modal-error">{error}</p>}

      <div className="modal-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="bg-green-700 hover:bg-green-600 text-white"
          onClick={save}
          disabled={!chosen || busy === "save" || busy === "pull"}
        >
          {busy === "save" ? "Saving…" : "Use this model"}
        </Button>
      </div>
    </Modal>
  );
}
