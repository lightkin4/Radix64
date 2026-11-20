"use client";
import { useEffect, useRef, useState } from "react";
import { TerminalIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { streamTerminal } from "@/lib/api";
import type { AppSummary } from "@/lib/types";

type Kind = "cmd" | "out" | "err" | "note";
type Line = { id: number; kind: Kind; text: string };

let nextLineId = 1;

const quickCommands = ["status", "models", "ps", "help"];

// A terminal managed by the Radix64 server: every command runs against the
// local Ollama API on the compose network, so the models and the server can be
// inspected and driven from inside the app.
export default function Terminal({
  onClose,
  onBuilt,
}: {
  onClose: () => void;
  // A `build` command finished: show that app in the preview panel.
  onBuilt: (app: AppSummary, version: number) => void;
}) {
  const [lines, setLines] = useState<Line[]>(() => [
    {
      id: nextLineId++,
      kind: "note",
      text: "Radix64 terminal · runs on the local server against the Ollama API",
    },
    { id: nextLineId++, kind: "note", text: 'Type "help" for the command list.' },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const history = useRef<string[]>([]);
  const historyIndex = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        request.current?.abort();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      request.current?.abort();
    };
  }, [onClose]);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  function append(kind: Kind, text: string) {
    setLines((all) => [...all, { id: nextLineId++, kind, text }]);
  }

  async function execute(rawCommand: string) {
    const command = rawCommand.trim();
    if (!command || busy) return;

    setInput("");
    history.current = [...history.current, command].slice(-50);
    historyIndex.current = null;

    if (command.toLowerCase() === "clear") {
      setLines([]);
      return;
    }

    append("cmd", `$ ${command}`);
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    let streamingId: number | null = null;

    try {
      for await (const event of streamTerminal(command, controller.signal)) {
        if (event.type === "line") {
          streamingId = null;
          append("out", event.text);
        } else if (event.type === "delta") {
          if (streamingId === null) {
            const id = nextLineId++;
            streamingId = id;
            setLines((all) => [...all, { id, kind: "out", text: event.text }]);
          } else {
            const id = streamingId;
            setLines((all) =>
              all.map((line) =>
                line.id === id ? { ...line, text: line.text + event.text } : line,
              ),
            );
          }
        } else if (event.type === "error") {
          streamingId = null;
          append("err", event.text);
        } else if (event.type === "app") {
          streamingId = null;
          onBuilt(event.app, event.version);
          append("note", `Opened ${event.app.name} in the preview panel.`);
        }
      }
    } catch (cause) {
      if ((cause as Error)?.name !== "AbortError") {
        append(
          "err",
          cause instanceof Error ? cause.message : "The command failed.",
        );
      }
    } finally {
      request.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function recall(direction: -1 | 1) {
    const items = history.current;
    if (items.length === 0) return;
    const current =
      historyIndex.current === null
        ? direction === -1
          ? items.length
          : -1
        : historyIndex.current;
    const next = Math.min(items.length - 1, Math.max(0, current + direction));
    if (next < 0 || next >= items.length) {
      historyIndex.current = null;
      setInput("");
      return;
    }
    historyIndex.current = next;
    setInput(items[next]);
  }

  return (
    <div
      className="terminal-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="terminal"
        role="dialog"
        aria-modal="true"
        aria-label="Radix64 terminal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="terminal-head">
          <TerminalIcon className="size-4 text-green-400" />
          <div>
            <p className="terminal-title">Terminal</p>
            <p className="terminal-subtitle">
              Local server · Ollama on the compose network
            </p>
          </div>
          <div className="terminal-actions">
            {busy ? (
              <Button
                variant="ghost"
                size="sm"
                className="terminal-button"
                onClick={() => request.current?.abort()}
              >
                Stop
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="terminal-button"
                onClick={() => setLines([])}
              >
                Clear
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="terminal-button"
              aria-label="Close terminal"
              onClick={onClose}
            >
              <XIcon />
            </Button>
          </div>
        </header>

        <div className="terminal-quick">
          {quickCommands.map((command) => (
            <button
              key={command}
              type="button"
              className="terminal-chip"
              disabled={busy}
              onClick={() => execute(command)}
            >
              {command}
            </button>
          ))}
        </div>

        <div className="terminal-scroll" ref={scroller}>
          {lines.map((line) => (
            <div key={line.id} className="terminal-line" data-kind={line.kind}>
              {line.text}
            </div>
          ))}
          {busy && <div className="terminal-line terminal-cursor">▍</div>}
        </div>

        <form
          className="terminal-input-row"
          onSubmit={(event) => {
            event.preventDefault();
            execute(input);
          }}
        >
          <span className="terminal-prompt">$</span>
          <input
            ref={inputRef}
            className="terminal-input"
            value={input}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            aria-label="Terminal command"
            placeholder={busy ? "Running…" : "status · models · ask <prompt>"}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                recall(-1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                recall(1);
              }
            }}
          />
        </form>
      </section>
    </div>
  );
}
