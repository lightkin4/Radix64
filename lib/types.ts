export type Role = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: Role;
  text: string;
  createdAt: string;
};

export type AppSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  building: boolean;
  hasPreview: boolean;
};

export type AppDetail = AppSummary & { messages: ChatMessage[] };

// Server-sent events of one chat turn, newline-delimited JSON.
export type ChatEvent =
  | { type: "message"; message: ChatMessage }
  | { type: "delta"; text: string }
  | { type: "step"; label: string; status: "running" | "done" | "error" }
  | { type: "build"; version: number }
  | { type: "error"; message: string }
  | { type: "done" };

export type StepStatus = "running" | "done" | "error";

export type ModelConfig = {
  provider: string;
  model: string;
  ready: boolean;
};
