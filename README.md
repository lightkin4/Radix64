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

## Environment variables

| Variable | Description |
|---|---|
| `LLM_PROVIDER` | `ollama` (default) or `openai` for any OpenAI-compatible endpoint |
| `OLLAMA_BASE_URL` | Ollama server, default `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Model used for chat and builds, default `llama3.2:3b` |
| `LLM_NUM_CTX` | Context window, default `8192` |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | Only for `LLM_PROVIDER=openai` |
| `DATA_DIR` | Storage directory, default `.data` in the repo |
