# Radix64

A self-hosted AI app builder. Describe an app in the chat, watch it get built, and preview it instantly — all under the Radix64 brand.

The build chat runs on a local **llama3.2:3b** model through [Ollama](https://ollama.com); no hosted AI account is needed.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Ollama (llama3.2:3b)

## Setup

The easiest way is Docker Compose, which starts the app plus a local Ollama server and pulls llama3.2:3b:

```bash
docker compose -f docker-compose.base44.yml up -d
```

The app runs at [http://localhost:3000](http://localhost:3000).

To run it without Docker, start Ollama yourself (`ollama pull llama3.2:3b`), then:

```bash
cp .env.example .env
npm install
npm run dev
```

The app runs at [http://localhost:3001](http://localhost:3001).

## How it works

```
User types prompt
      │
      ▼
POST /api/apps/:id/chat ──► local llama3.2:3b
      │                     streams a short reply,
      │                     then a self-contained HTML app
      │  ◄───────────────── newline-delimited JSON events
      ▼
AppPreview (iframe) ◄── /api/apps/:id/preview
```

Each app keeps its chat history and latest build in a small JSON store (`DATA_DIR`), so the app list and previews survive restarts.

## API

| Route | Purpose |
|---|---|
| `GET /api/apps` | List apps |
| `POST /api/apps` | Create an app from `{ prompt }` |
| `GET /api/apps/:id` | App with its chat history |
| `DELETE /api/apps/:id` | Remove an app and its build |
| `POST /api/apps/:id/chat` | Run one build turn, streamed as NDJSON |
| `GET /api/apps/:id/preview` | Latest build as HTML |
| `GET /api/config` | Active model provider and readiness |
| `GET /api/models` | Models installed in Ollama, plus the selected one |
| `POST /api/models/pull` | Download another model by `{ name }` |
| `POST /api/terminal` | Run one terminal command, streamed as NDJSON |
| `GET` / `PUT /api/settings` | Selected model and whether a GitHub token is stored |
| `POST /api/github/import` | Read a repository (`{ url, branch?, token? }`) into a new app |

## Choosing a model

Click **Model** in the header to pick any model installed in Ollama, or type a name
such as `qwen2.5:3b` and download it. The choice is saved in `DATA_DIR/settings.json`
and overrides `OLLAMA_MODEL`; the header badge always shows the model in use.

## Terminal

Click **Terminal** in the header to open a console managed by the Radix64 server. It
talks to the local Ollama API on the compose network — there is no shell — and keeps a
command history you can walk with the arrow keys:

| Command | What it does |
|---|---|
| `status` | Reachability, Ollama version and the model in use |
| `models` | Models installed in Ollama |
| `ps` | Models currently loaded in memory |
| `show <model>` | Family, parameter size, quantization, capabilities |
| `ask <prompt>` | Chat with the selected model, streamed |
| `run <model> <prompt>` | Chat with a specific model, streamed |
| `pull <model>` | Download a model with progress |
| `version` | Ollama server version |
| `clear` / `help` | Clear the screen / list commands |

Chat and downloads run without a connect deadline, because Ollama answers only after
the prompt is evaluated and a model can take minutes to load.

## Building from a GitHub repository

Click **Read a repo**, paste `owner/repo` or a github.com URL, optionally pick a branch
and add a personal access token for private repositories (it is stored locally in
`DATA_DIR/settings.json` and never returned to the browser). Radix64 reads the
repository's source files, keeps them with the new app, and the first chat turn
rebuilds the app as a self-contained HTML page that keeps the repository's content,
screens and behaviour.

## Environment variables

| Variable | Description |
|---|---|
| `LLM_PROVIDER` | `ollama` (default) or `openai` for any OpenAI-compatible endpoint |
| `OLLAMA_BASE_URL` | Ollama server. Comma-separated addresses are tried in order; defaults to `http://ollama:11434`, then `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Model used for chat and builds, default `llama3.2:3b` |
| `LLM_NUM_CTX` | Context window, default `8192` |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | Only for `LLM_PROVIDER=openai` |
| `DATA_DIR` | Storage directory, default `.data` in the repo |
