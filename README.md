# Whisper 🎙️

A real-time speech-to-text live captions webapp — designed to help people with hearing loss communicate.

Supports two transcription providers, switchable from the ⚙️ Settings panel:

- **ElevenLabs Scribe Realtime v2** *(default)* — streaming WebSocket with live partial transcripts
- **Sarvam AI Saaras v3** — streaming WebSocket optimised for 10+ Indic languages; emits a finalised transcript per VAD-bounded utterance (no incremental partials)

## Features

- **Live captions** appear on screen as people speak
- Partial (live, blue) and committed (final, white) transcripts
- Large, readable text with **font size controls** (+ / −), persisted across sessions
- Dark high-contrast theme (like TV subtitles)
- Live microphone volume indicator
- Auto-scroll to latest caption
- Clear button to reset the screen
- One-click Start/Stop

> **Why a Node.js server?**  
> The provider APIs authenticate via HTTP headers (`xi-api-key` for ElevenLabs, `api-subscription-key` for Sarvam). Browsers cannot set custom headers on WebSocket/cross-origin requests, so a lightweight proxy server injects the keys securely server-side.

## API keys

Set whichever providers you want to use in `.env` (see `.env.example`):

```
ELEVENLABS_API_KEY=...   # get from https://elevenlabs.io
SARVAM_API_KEY=...       # get from https://dashboard.sarvam.ai
```

You only need the key for the provider(s) you actually enable. Pick the provider from **⚙️ Settings → Provider** in the UI.

---

## 🐳 Docker (recommended)

### Run with a single command

```bash
docker run -d \
  --name livecaptions \
  --restart unless-stopped \
  -p 3000:3000 \
  -e ELEVENLABS_API_KEY=your_api_key_here \
  livecaptions
```

Then open **http://localhost:3000** (or replace `localhost` with your VM's IP).

### Build and run with Docker Compose

```bash
cp .env.example .env
# Edit .env and set ELEVENLABS_API_KEY=your_key_here

docker compose up -d --build
```

### Build the image manually

```bash
docker build -t livecaptions .

docker run -d \
  --name livecaptions \
  --restart unless-stopped \
  -p 3000:3000 \
  -e ELEVENLABS_API_KEY=your_api_key_here \
  livecaptions
```

### Useful commands

```bash
docker logs -f livecaptions        # stream logs
docker compose down                # stop and remove container
docker compose up -d --build       # rebuild after code changes
```

---

## 🖥️ Local development (without Docker)

```bash
cp .env.example .env
# Edit .env → set ELEVENLABS_API_KEY=your_key_here

npm install
npm start
# Open http://localhost:3000
```

---

## How it works

```
Microphone → Browser (native-rate PCM chunks via WebSocket)
    → Node.js proxy on /transcribe
    → ElevenLabs WebSocket (with xi-api-key header — server-side only)
    ← partial_transcript / committed_transcript events
    → Display on screen
```

The API key lives **only on the server** and is never sent to the browser.

---

## Tips

- **Font size**: Use the `+` and `−` buttons; preference is saved in browser
- **Language**: Auto-detects by default; override in ⚙️ Settings
- **Silence sensitivity**: Default 0.8s — captions finalise after 0.8s of silence; adjustable in ⚙️ Settings
