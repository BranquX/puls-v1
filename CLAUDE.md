# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is AdChat

AdChat is a digital advertising management product for small-medium businesses in Israel. It features an AI chat in Hebrew with specialized agents (copy, analytics, graphics, content), onboarding with deep website scanning, client memory, Brand Kit, Meta (Facebook) Ads integration, and a media library. The UI is entirely RTL Hebrew.

## Development Commands

```bash
# Start Expo dev server (app, typically port 8081 for web)
npm run start

# Start backend API server (Express on port 3001)
npm run server

# Lint
npm run lint

# Platform-specific
npm run ios
npm run android
npm run web
```

Both the Expo app and the Express server must be running for full functionality. The app connects to the server via `EXPO_PUBLIC_API_URL` (defaults to `http://localhost:3001`).

## Architecture

**Two-process system:**
- **Client**: Expo (~54) + expo-router (~6) + React Native 0.81 — file-based routing in `app/`
- **Server**: Single-file Express server (`server.js`) — all API endpoints, AI agents, Meta integration, website scraping

**Data layer**: Supabase (Postgres + Auth with JWT + RLS). SQL schemas in `supabase/` are reference only, not auto-applied.

**AI**: Anthropic Claude (`claude-haiku-4-5-20251001` default) for text/agents, Google Gemini for image generation.

### Client Architecture

- `app/_layout.tsx` — Root layout: Supabase auth listener, public/private route gating, wraps everything in `BusinessProvider`
- `app/(tabs)/` — Main tab navigation: home (recommendations), campaigns, chat, library, settings
- `app/campaign/[id].tsx` — Meta campaign detail (dynamic route)
- `app/onboarding.tsx` — Business onboarding flow
- `contexts/business-context.tsx` — React context providing selected business data from Supabase
- `lib/supabase.ts` — Supabase client init
- `lib/fetch-adchat-api.ts` — Authenticated fetch wrapper (adds Bearer JWT to server requests)

### Server Architecture (`server.js`)

All backend logic lives in a single `server.js` file. Key patterns:

- **Agent system**: All agents run through `runAgentTurn`. Dana is the orchestrator; intent detection via keyword matching routes to specialized agents (Yoni=copy, Ron=analytics, Maya=graphics, Noa=content strategy)
- **Maya's image flow**: Maya outputs JSON `{"action":"generate_image","prompt":"..."}`, server intercepts and calls Gemini, returns `image_base64`
- **In-memory cache**: Simple TTL Map for recommendations, client memory, meta context
- **Auth middleware**: `requireBearerAuthorization` validates Supabase JWT — not all endpoints use it (see CONTEXT.md for details)
- **Meta OAuth**: `/auth/meta` initiates, `/auth/meta/callback` completes; redirect URI is hardcoded to localhost

### Agents

| Key | Name | Role |
|-----|------|------|
| `dana` | דנה | Client manager, onboarding, orchestrator, general responses |
| `yoni` | יוני | Ad copy — outputs 3 versions per prompt format |
| `ron` | רון | PPC analytics, performance recommendations |
| `maya` | מאיה | Graphics — outputs JSON for Gemini image generation |
| `noa` | נועה | Content strategy, publishing calendar |

### Client Memory Categories

`business_profile`, `audience`, `brand`, `goals`, `insights`, `preferences`

## Environment Variables

Server requires `.env` with: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `META_APP_SECRET`.

Client uses: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_RESET_REDIRECT_URL`.

See CONTEXT.md for the full env variable reference.

## Path Alias

TypeScript path alias `@/*` maps to project root (configured in `tsconfig.json`).
