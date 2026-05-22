# LiveCaptions 🎙️

A real-time speech-to-text live captions webapp powered by **ElevenLabs Scribe Realtime v2** — designed to help people with hearing loss communicate.

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
> The ElevenLabs WebSocket API authenticates via the `xi-api-key` **HTTP header**. Browsers cannot set custom headers on WebSocket connections, so a lightweight proxy server is required to inject the key securely. Azure App Service (free F1 tier) supports this perfectly.

---

## 🚀 Deploy to Azure App Service (Free F1 tier)

### Prerequisites

```bash
npm install -g @azure/static-web-apps-cli   # optional, for local Azure emulation
az extension add --name webapp              # if not already installed
```

### Step 1 — Add your API key and push to GitHub

```bash
# Never commit your real .env — set the key as an Azure App Setting instead
git init && git add . && git commit -m "Initial commit"
gh repo create livecaptions --public --push   # or push to existing repo
```

### Step 2 — Create and deploy to Azure App Service

```bash
az login

# Create resource group
az group create --name livecaptions-rg --location westeurope

# Create free App Service plan (F1)
az appservice plan create \
  --name livecaptions-plan \
  --resource-group livecaptions-rg \
  --sku F1 --is-linux

# Create the web app (Node 20)
az webapp create \
  --name livecaptions \
  --resource-group livecaptions-rg \
  --plan livecaptions-plan \
  --runtime "NODE:20-lts"

# Set your ElevenLabs API key as an environment variable (never in source code)
az webapp config appsettings set \
  --name livecaptions \
  --resource-group livecaptions-rg \
  --settings ELEVENLABS_API_KEY="your_api_key_here"

# Enable WebSocket support (required!)
az webapp config set \
  --name livecaptions \
  --resource-group livecaptions-rg \
  --web-sockets-enabled true

# Deploy from local folder
az webapp up \
  --name livecaptions \
  --resource-group livecaptions-rg \
  --runtime "NODE:20-lts"
```

Your app will be live at `https://livecaptions.azurewebsites.net`

### Step 3 — Set startup command

In Azure Portal → your web app → **Configuration → General settings → Startup Command**:

```
node server.js
```

Or via CLI:
```bash
az webapp config set \
  --name livecaptions \
  --resource-group livecaptions-rg \
  --startup-file "node server.js"
```

---

## 🖥️ Local development

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
Microphone → Browser (PCM 16kHz chunks via WebSocket)
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
