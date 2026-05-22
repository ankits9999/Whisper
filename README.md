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
- API key stored in `localStorage` — enter once, always remembered

---

## 🚀 Deploy to Azure Static Web Apps (Free)

### Prerequisites
- [Azure account](https://azure.microsoft.com/free/) (free tier works)
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed
- [Static Web Apps CLI](https://azure.github.io/static-web-apps-cli/): `npm install -g @azure/static-web-apps-cli`

### Option A — Azure Portal (no CLI needed)

1. Go to [portal.azure.com](https://portal.azure.com) → **Create a resource** → **Static Web App**
2. Choose **Free** plan
3. Connect your GitHub repo (push this project to GitHub first)
4. Set **App location** to `/public` and leave **API location** empty
5. Click **Review + Create**

Azure will add a GitHub Actions workflow and auto-deploy on every push.

### Option B — Azure CLI

```bash
# 1. Login
az login

# 2. Create resource group
az group create --name livecaptions-rg --location westeurope

# 3. Create the Static Web App
az staticwebapp create \
  --name livecaptions \
  --resource-group livecaptions-rg \
  --location westeurope \
  --sku Free

# 4. Deploy (from the project root)
swa deploy ./public \
  --deployment-token $(az staticwebapp secrets list \
      --name livecaptions \
      --resource-group livecaptions-rg \
      --query "properties.apiKey" -o tsv)
```

Your app will be live at `https://livecaptions.azurestaticapps.net` (or similar).

### After deploying

1. Open the URL in your browser
2. Click ⚙️ **Settings** (opens automatically on first visit)
3. Paste your ElevenLabs API key — it's saved in `localStorage`, never leaves your browser except to ElevenLabs directly
4. Click **Save**, then **Start Listening**

---

## 🖥️ Local development

```bash
npm install
npm start        # starts on http://localhost:3000
```

Or use the SWA CLI to emulate Azure locally:

```bash
swa start ./public
```

---

## How it works

```
Microphone → Browser (PCM 16kHz base64)
    → WebSocket (wss://api.elevenlabs.io) with xi-api-key query param
    ← partial_transcript / committed_transcript events
    → Display on screen
```

The app connects **directly from the browser** to ElevenLabs — no server needed. The API key is stored in `localStorage` and sent as a URL query parameter (`xi-api-key=...`), which is the standard approach for WebSocket authentication in browser environments.

---

## Tips

- **Font size**: Use the `+` and `−` buttons; font size preference is saved
- **Language**: Auto-detects by default; override in ⚙️ Settings
- **Silence sensitivity**: Default 0.8s — captions finalise after 0.8s of silence; adjustable in Settings
