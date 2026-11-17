export type Role = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: Role;
  text: string;
  createdAt: string;
};

export type RepoSummary = {
  owner: string;
  repo: string;
  branch: string;
  url: string;
  fileCount: number;
  filesRead: number;
};

export type AppSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  building: boolean;
  hasPreview: boolean;
  repo: RepoSummary | null;
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

// Radix64 terminal events, newline-delimited JSON from POST /api/terminal.
export type TerminalEvent =
  | { type: "line"; text: string }
  | { type: "delta"; text: string }
  | { type: "error"; text: string }
  | { type: "done"; code: number };

export type ModelConfig = {
  provider: string;
  model: string;
  ready: boolean;
  defaultModel: string;
};

export type ModelInfo = {
  name: string;
  size: number | null;
  modifiedAt: string | null;
};

export type ModelCatalog = {
  provider: string;
  models: ModelInfo[];
  selected: string;
  defaultModel: string;
  ready: boolean;
};

export type SettingsView = {
  model: string | null;
  defaultModel: string;
  provider: string;
  hasGithubToken: boolean;
};
