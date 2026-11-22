# Crux

Learn any topic by arguing about it. Type a claim, a question or just a subject. Crux researches it on the live web, maps what you need to know, and then teaches you through conversation instead of reading.

Built for about an hour a day on one topic, using your own Anthropic API credit.

## Run it

Needs Node 20.12 or newer.

```bash
npm install
cp .env.example .env      # then paste your Anthropic API key into .env
npm start                 # → http://localhost:3000
```

To click around without spending anything: `npm run mock` (canned replies, no API calls).

## What's inside

| Room | What happens |
| --- | --- |
| **The Guide** | Sol teaches the concept map by asking questions. A concept only lights up when you explain or apply it in your own words. Each session opens with recall of what you lit before. |
| **The Teacher** | Ada answers whatever you ask, directly and from facts, and says how settled each point is. In the server version she can search the web on each question and lists the pages she cited. |
| **The Table** | Four invented experts who genuinely disagree are mid-argument. Jump in, address one with `@name`, or stay quiet and let them go at each other. They concede when you land a point and correct you when you're wrong. |
| **The Hot Seat** | Vex cross-examines you. Every answer is scored on clarity, evidence, logic and rebuttal, and rewritten as a stronger version you could say out loud. You can argue the side you reject, graded on whether a believer would nod along. |
| **The Chair** | A decision scenario built for the topic. You make six calls, gauges move, and consequences arrive. |
| **The Playbook** | Your 30-second pitch, best arguments, likely objections with replies, what to concede, and your weak spots, written from what you actually said. |

Around the rooms: a gut-check stance before you learn anything, a chart of how your stance drifts, the cruxes the disagreement turns on, a facts sheet, a streak, and minutes practised today. There is a microphone button for speaking answers and a toggle to have replies read aloud (both use the browser's built-in speech features, so Chrome works best).

## Talking to it

Every room has a microphone button, a **Voice** toggle that reads replies aloud, and a **Conversation** toggle for hands-free back and forth: the reply is spoken, the microphone opens, and what you say is sent when you stop talking. Tap the microphone to interrupt.

Out of the box this uses the browser's own speech features, which are free (recognition works in Chrome, Edge and Safari). For natural voices, put an ElevenLabs key in `.env` as `ELEVENLABS_API_KEY`. Each speaker then gets a different ElevenLabs voice, and browsers without built-in recognition, such as Firefox, can use the microphone through ElevenLabs transcription. If the ElevenLabs quota runs out, Crux falls back to the browser voice.

## Cost and the budget cap

The header shows a running estimate of what the app has spent. `BUDGET_USD` in `.env` (default 100) is a hard stop: once the estimate reaches it, Crux refuses further calls. The estimate uses list prices in `lib/ai.js`; the Anthropic Console is the source of truth.

Pick the model in the header. Opus 5.5 is the default. Sonnet 5.5 costs about half, Haiku 5.5 is close to free, Fable 5.2 is the most capable at twice the Opus price. Opening a topic runs up to five web searches (one cent each) if web search is enabled for your organisation in the Console; without it, Crux builds the topic from model knowledge and says so.

## Where things live

- `server.js` — HTTP server and API routes
- `lib/prompts.js` — every prompt and JSON schema
- `lib/ai.js` — Claude calls, streaming, cost tracking
- `lib/store.js` — saves everything as JSON under `data/` (git-ignored)
- `public/` — the browser app, no build step

## Hosting it

It binds to `127.0.0.1` by default. If you put it on a server, set `HOST=0.0.0.0` and `APP_PASSWORD`, otherwise anyone with the URL can spend your credit.

## Claude-hosted edition

`artifact/` holds a single-page version that runs as a private Claude artifact, so it is always available with nothing to run. `node artifact/build.mjs` rebuilds `artifact/crux.html` from the same prompts.

It differs from the local server in three ways: replies use your Claude plan's usage, not API credit; it cannot search the web, so recent material has to be pasted in when you open a topic; and your topics are stored in the artifact's private per-person database.
