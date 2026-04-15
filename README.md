# Puls. — AI-Powered Ad Management for Israeli SMBs

Puls. is a digital advertising management platform for small-medium businesses in Israel. It features an AI chat in Hebrew with specialized agents, Meta Ads integration, media library, and automated analytics.

## Architecture

- **Client**: Expo + expo-router (React Native) — file-based routing in `app/`
- **Server**: Express (`server.js`) — API endpoints, AI agents, Meta integration
- **Database**: Supabase (Postgres + Auth + RLS)
- **AI**: Anthropic Claude (agents), Google Gemini (image generation)
- **Email**: Resend (alerts, weekly reports)

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in all values in .env
```

Required variables: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `META_APP_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### 3. Set up database

Run the SQL files in `supabase/` against your Supabase project:
- `supabase/schema.sql` — base tables
- `supabase/rls-production.sql` — Row Level Security policies
- `supabase/proactive-messages.sql` — weekly reports table
- `supabase/meta-token-expires.sql` — token expiry tracking

### 4. Start development

```bash
# Terminal 1: Backend server (port 3001)
npm run server

# Terminal 2: Expo app (web on port 8081)
npm run web
```

Both processes must be running. The app connects to the server via `EXPO_PUBLIC_API_URL`.

## Development Commands

```bash
npm run start      # Expo dev server
npm run server     # Express API server
npm run web        # Expo web
npm run ios        # iOS simulator
npm run android    # Android emulator
npm run lint       # ESLint
```

## AI Agents

| Agent | Name | Role |
|-------|------|------|
| dana  | Dana | Client manager, orchestrator |
| yoni  | Yoni | Ad copywriting |
| ron   | Ron  | PPC analytics |
| maya  | Maya | Graphics (Gemini image gen) |
| noa   | Noa  | Content strategy |

## Production Deployment

### Server (Railway/Render)

Set all env vars from `.env.example`. The server uses `PORT` from env (defaults to 3001).

Key production settings:
- `APP_WEB_ORIGIN` — your frontend domain (NOT localhost)
- `META_REDIRECT_URI` — your server's OAuth callback URL
- `SUPABASE_SERVICE_ROLE_KEY` — bypasses RLS for server operations
- `CRON_SECRET` — authenticates cron job webhooks

### Client (Vercel/Netlify)

```bash
npx expo export --platform web
```

Set `EXPO_PUBLIC_API_URL` to your server's URL.

### Security Checklist

- [ ] Enable RLS: run `supabase/rls-production.sql`
- [ ] Rotate any exposed API keys
- [ ] Set `NODE_ENV=production`
- [ ] Verify `APP_WEB_ORIGIN` is not localhost
- [ ] Set `CRON_SECRET` to a strong random string
- [ ] Configure Resend domain for email delivery

## Rate Limits

- General API: 100 requests / 15 minutes
- Chat & Agent: 20 requests / minute

## License

Proprietary. All rights reserved.
