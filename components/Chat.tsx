"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import Markdown from "react-markdown";
import { StickToBottom } from "use-stick-to-bottom";
import { createApp, getApp, streamChat } from "@/lib/api";
import type { AppSummary, ChatMessage, StepStatus } from "@/lib/types";

type Step = { id: string; label: string; status: StepStatus };
type Item = {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps: Step[];
};
type Status = "ready" | "loading" | "submitted" | "building" | "error";

type Props = {
  appId: string | null;
  onAppCreated: (app: AppSummary) => void;
  onBuild: (version: number) => void;
};

function toItem(message: ChatMessage): Item {
  return { id: message.id, role: message.role, text: message.text, steps: [] };
}

// Chat with the self-hosted API: one turn streams a reply, then a fresh build.
export default function Chat({ appId, onAppCreated, onBuild }: Props) {
  const [activeId, setActiveId] = useState<string | null>(appId);
  const [items, setItems] = useState<Item[]>([]);
  const [live, setLive] = useState<{ text: string; steps: Step[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("ready");
  const [prompt, setPrompt] = useState("");
  const createdHere = useRef<string | null>(null);
  const turn = useRef<{ text: string; steps: Step[] } | null>(null);
  const request = useRef<AbortController | null>(null);

  // Load the conversation when another app is picked. An app this component
  // just created is skipped — its first turn is still streaming.
  useEffect(() => {
    if (appId && createdHere.current === appId) {
      createdHere.current = null;
      return;
    }
    request.current?.abort();
    setActiveId(appId);
    setItems([]);
    setError(null);
    if (!appId) {
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    getApp(appId).then(
      (app) => {
        if (cancelled) return;
        setItems(app.messages.map(toItem));
        setStatus("ready");
      },
      (cause: Error) => {
        if (cancelled) return;
        setError(cause.message);
        setStatus("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [appId]);

  useEffect(() => () => request.current?.abort(), []);

  function pushDelta(text: string) {
    const current = turn.current ?? { text: "", steps: [] };
    current.text += text;
    turn.current = current;
    setLive({ text: current.text, steps: [...current.steps] });
  }

  function pushStep(label: string, stepStatus: StepStatus) {
    const current = turn.current ?? { text: "", steps: [] };
    const existing = current.steps.find((step) => step.label === label);
    if (existing) existing.status = stepStatus;
    else
      current.steps.push({
        id: `${label}-${current.steps.length}`,
        label,
        status: stepStatus,
      });
    turn.current = current;
    setLive({ text: current.text, steps: [...current.steps] });
  }

  function takeTurn() {
    const current = turn.current;
    turn.current = null;
    return current;
  }

  async function submit() {
    const text = prompt.trim();
    if (!text || status === "building" || status === "submitted" || status === "loading")
      return;
    setPrompt("");
    setError(null);
    setStatus("submitted");
    turn.current = null;
    setLive(null);

    const controller = new AbortController();
    request.current = controller;
    let failed = false;

    try {
      let id = activeId;
      if (!id) {
        const created = await createApp(text);
        id = created.id;
        createdHere.current = id;
        setActiveId(id);
        onAppCreated(created);
      }

      setStatus("building");
      for await (const event of streamChat(id, text, controller.signal)) {
        if (event.type === "message") {
          setItems((all) => [...all, toItem(event.message)]);
        } else if (event.type === "delta") {
          pushDelta(event.text);
        } else if (event.type === "step") {
          pushStep(event.label, event.status);
        } else if (event.type === "build") {
          onBuild(event.version);
        } else if (event.type === "error") {
          failed = true;
          setError(event.message);
        }
      }
    } catch (cause) {
      if ((cause as Error)?.name !== "AbortError") {
        failed = true;
        setError(
          cause instanceof Error ? cause.message : "Something went wrong.",
        );
      }
    } finally {
      const current = takeTurn();
      setLive(null);
      if (current && (current.text.trim() || current.steps.length)) {
        setItems((all) => [
          ...all,
          {
            id: `turn-${Date.now()}`,
            role: "assistant",
            text: current.text,
            steps: current.steps,
          },
        ]);
      }
      request.current = null;
      setStatus((current) =>
        current === "building" || current === "submitted"
          ? failed
            ? "error"
            : "ready"
          : current,
      );
    }
  }

  const canSend =
    status === "ready" || status === "error" ? true : false;

  let statusText = "";
  if (error) statusText = error;
  else if (status === "loading") statusText = "Loading the conversation…";
  else if (status === "submitted")
    statusText = activeId ? "Sending…" : "Creating app…";
  else if (status === "building") {
    const running = live?.steps.find((step) => step.status === "running");
    statusText = running ? `${running.label}…` : "Building…";
  }

  return (
    <div className="chat">
      <StickToBottom className="chat-scroll" initial="instant">
        <StickToBottom.Content className="chat-messages">
          {items.map((item) => (
            <div key={item.id} className="chat-message">
              <Message item={item} />
            </div>
          ))}
          {live && (live.text || live.steps.length > 0) && (
            <div className="chat-message">
              <Message
                item={{ id: "live", role: "assistant", ...live }}
              />
            </div>
          )}
          {statusText && (
            <p className="chat-status">
              {statusText}
              {error && status !== "building" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setError(null);
                    setStatus("ready");
                  }}
                >
                  Dismiss
                </Button>
              )}
            </p>
          )}
        </StickToBottom.Content>
      </StickToBottom>

      <div className="chat-composer">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            e.preventDefault();
            submit();
          }}
          placeholder={activeId ? "Ask for a change…" : "Describe your app…"}
          className="chat-input"
          rows={1}
        />
        <Button
          onClick={submit}
          disabled={!canSend || !prompt.trim()}
          className="bg-green-700 hover:bg-green-600 text-white"
        >
          Send
        </Button>
      </div>
    </div>
  );
}

function Message({ item }: { item: Item }) {
  return (
    <>
      {item.text && item.role === "user" && (
        <p className="chat-user-text">{item.text}</p>
      )}
      {item.text && item.role === "assistant" && (
        <div className="chat-assistant-text">
          <Markdown
            components={{
              a: ({ node: _node, ...props }) => (
                <a {...props} target="_blank" rel="noreferrer" />
              ),
            }}
          >
            {item.text}
          </Markdown>
        </div>
      )}
      {item.steps.map((step) => (
        <p key={step.id} className="chat-tool-line">
          {stepIcon(step.status)} {step.label}
        </p>
      ))}
    </>
  );
}

function stepIcon(status: StepStatus) {
  if (status === "running") return "…";
  if (status === "error") return "✗";
  return "✓";
}
