# Radix64

A white-label AI app builder built on the [Base44 platform](https://base44.com). Describe an app in the chat, watch it get built live, and preview it instantly — all under the Radix64 brand.

This is a copy of the **Tiny Sunny** minimal example from [base44/base44-platform-starter](https://github.com/base44/base44-platform-starter), renamed to Radix64 with a green color scheme.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind 4 · `@base44/platform` SDK

## Setup

```bash
cp .env.example .env
# Fill in your BASE44_* variables (see .env.example for details)

npm install
npm run dev
```

The app runs at [http://localhost:3001](http://localhost:3001).

Without the `BASE44_*` env vars the UI loads but building apps won't work — the server actions will error when called.

## What you need

- A Base44 white-label workspace
- An integration account with **Editor** or higher access in that workspace
- A personal access token created **in that workspace** (not the account's personal one)

See the [Base44 white-label docs](https://docs.base44.com/developers/white-label) for the full setup checklist.

## Environment variables

| Variable | Description |
|---|---|
| `BASE44_PLATFORM_HOST` | Base44 platform API host |
| `BASE44_WORKSPACE_ID` | Your workspace ID |
| `BASE44_WORKSPACE_API_KEY` | Integration account personal access token |
| `BASE44_ACCOUNT_EMAIL` | Integration account email (filters `listApps`) |
| `NEXT_PUBLIC_BASE44_APP_HOST` | Host Base44 serves built apps from |

## How it works

```
User types prompt
      │
      ▼
createApp / sendMessage  ──────►  Base44 platform
      │                           builds & deploys app
      │  ◄──────────────────────  preview URL
      ▼
AppPreview (iframe)
```

All Base44 API calls are Next.js Server Actions — the access token never reaches the browser.
