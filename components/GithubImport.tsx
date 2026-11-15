"use client";
import { useState } from "react";
import { GithubIcon } from "lucide-react";
import Modal from "./Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importRepo } from "@/lib/api";
import type { AppSummary } from "@/lib/types";

// Connect a GitHub repository: Radix64 reads its files and rebuilds the app.
export default function GithubImport({
  hasToken,
  onClose,
  onImported,
}: {
  hasToken: boolean;
  onClose: () => void;
  onImported: (app: AppSummary) => void;
}) {
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    const repo = url.trim();
    if (!repo) return;
    setBusy(true);
    setError(null);
    try {
      const app = await importRepo({
        url: repo,
        branch: branch.trim() || undefined,
        token: token.trim() || undefined,
      });
      onImported(app);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not read that repository.",
      );
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Connect a GitHub repository"
      subtitle="Radix64 reads the repository's source files and rebuilds the app from them."
      onClose={onClose}
    >
      <div className="modal-row">
        <span className="modal-label">Repository</span>
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="owner/repo or https://github.com/owner/repo"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "Enter" && !busy) connect();
          }}
        />
        <p className="modal-hint">
          Public repositories need nothing else. Big repositories are read up to the
          most useful source files.
        </p>
      </div>

      <div className="modal-inline">
        <div className="modal-row">
          <span className="modal-label">Branch</span>
          <Input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="default branch"
          />
        </div>
        <div className="modal-row">
          <span className="modal-label">Access token</span>
          <Input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={hasToken ? "saved token" : "optional, for private repos"}
          />
        </div>
      </div>

      {error && <p className="modal-error">{error}</p>}
      {busy && <p className="modal-ok">Reading the repository and its files…</p>}

      <div className="modal-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="bg-green-700 hover:bg-green-600 text-white"
          onClick={connect}
          disabled={busy || !url.trim()}
        >
          <GithubIcon />
          {busy ? "Reading…" : "Read repository"}
        </Button>
      </div>
    </Modal>
  );
}
