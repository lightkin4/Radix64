"use client";
import { useEffect, useState } from "react";
import {
  useChat,
  type UseChatResult,
  type ChatBackend,
  type ChatItem,
  type ChatStep,
} from "@base44/platform/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import Markdown from "react-markdown";
import { StickToBottom } from "use-stick-to-bottom";
import {
  createApp,
  openLiveSession,
  sendMessage,
  submitToolCallInput,
  type App,
} from "../server/base44";
import ToolQuestion from "./ToolQuestion";

// The four Base44 calls run on the server — the browser never holds a key.
const backend: ChatBackend = {
  createApp,
  openLiveSession,
  sendMessage,
  submitToolCallInput,
};

export default function Chat({
  app,
  onAppCreated,
  onBuildingChange,
}: {
  app: App | null;
  onAppCreated: (app: App) => void;
  onBuildingChange: (building: boolean) => void;
}) {
  const chat = useChat({ appId: app?.id ?? null, backend, onAppCreated });
  const [prompt, setPrompt] = useState("");
  const building = chat.status === "building";
  // Send only when the AI can take a prompt. After a failed build a prompt can ask for a fix.
  const canSend = chat.status === "ready" || chat.status === "error";

  useEffect(() => {
    onBuildingChange(building);
  }, [building, onBuildingChange]);

  // The first prompt creates the app; every later one goes to it.
  function submit() {
    if (!canSend || !prompt.trim()) return;
    if (app) chat.send(prompt);
    else chat.create(prompt);
    setPrompt("");
  }

  return (
    <div className="chat">
      <StickToBottom className="chat-scroll" initial="instant">
        <StickToBottom.Content className="chat-messages">
          {chat.items.map((item) => (
            <div key={item.id} className="chat-message">
              {item.text && item.role === "user" && (
                <p className={userTextClass(item)}>{item.text}</p>
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
              {item.steps.map((step) =>
                step.question ? (
                  <ToolQuestion key={step.id} question={step.question} />
                ) : (
                  <div key={step.id}>
                    <p className="chat-tool-line">
                      {stepIcon(step)} {step.label}
                    </p>
                    {step.answered?.map((answer, i) => (
                      <p key={i} className="chat-answer">
                        {answer.question}:{" "}
                        {[...answer.labels, answer.text]
                          .filter(Boolean)
                          .join(", ")}
                      </p>
                    ))}
                  </div>
                )
              )}
            </div>
          ))}
          <StatusLine chat={chat} hasApp={!!app} />
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
          placeholder={app ? "Ask for a change…" : "Describe your app…"}
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

function userTextClass(item: ChatItem) {
  if (item.pending) return "chat-user-text chat-pending";
  return "chat-user-text";
}

function stepIcon(step: ChatStep) {
  if (step.status === "running") return "…";
  if (step.status === "waiting") return "?";
  if (step.status === "error") return "✗";
  if (step.status === "stopped") return "–";
  return "✓";
}

function StatusLine({
  chat,
  hasApp,
}: {
  chat: UseChatResult;
  hasApp: boolean;
}) {
  let text = "";
  if (chat.error) text = chat.error.message;
  else if (chat.status === "submitted")
    text = hasApp ? "Sending…" : "Creating app…";
  else if (chat.status === "waiting") text = "Waiting for your answer";
  else if (chat.status === "building") text = "Building…";
  else if (hasApp && chat.connection === "connecting")
    text = "Loading the conversation…";
  if (!text) return null;
  return (
    <p className="chat-status">
      {text}
      {chat.error && (
        <Button size="sm" variant="ghost" onClick={chat.clearError}>
          Dismiss
        </Button>
      )}
    </p>
  );
}
