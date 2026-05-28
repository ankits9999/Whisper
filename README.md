# Whisper 🎙️

A real-time Hindi speech-to-text live captions webapp powered by the **AI4Bharat IndicConformer** model — running entirely locally, no cloud APIs or API keys required.

Designed to help people with hearing loss communicate in Hindi.

## Features

- **Live Hindi captions** appear on screen as people speak
- Committed (final, white) transcripts with silence-based segmentation
- Large, readable text with **font size controls** (+ / −), persisted across sessions
- Dark high-contrast theme (like TV subtitles)
- Live microphone volume indicator
- Auto-scroll to latest caption
- Clear button to reset the screen
- One-click Start/Stop
- Fully **offline** — all inference runs locally via a Python microservice

---

## How it works

```
Microphone (browser)
    │ base64 PCM chunks over WebSocket
    ▼
Node.js proxy  (:3000)
    │ forwards audio over WebSocket
    ▼
Python ASR server  (:8765)
    │  • resample to 16 kHz
    │  • energy-based VAD — detect speech segments
    │  • IndicConformer Hindi model (NeMo)
    ▼
committed_transcript  →  back to browser  →  displayed on screen
```

---

## 🐳 Docker (recommended)

The easiest way to run everything. One command builds and starts both services.

```bash
docker compose up --build
```

**First run** is slow — Docker installs the AI4Bharat NeMo fork and downloads the Hindi model (~500 MB from HuggingFace). Expect 15–30 minutes depending on your connection and machine.

**Subsequent runs** are fast — the model is cached in a Docker volume (`nemo_cache`) and loads in ~30–60 seconds.

Once both services are healthy, open **http://localhost:3000**.

### Follow startup logs

```bash
docker compose logs -f asr          # watch model download + load progress
docker compose logs -f livecaptions # Node.js proxy
```

The `livecaptions` service will not start until the ASR model is fully loaded and port 8765 is open (enforced by a healthcheck).

### Useful commands

```bash
docker compose down                 # stop all containers
docker compose up -d --build        # rebuild after a code change
docker volume rm whisper_nemo_cache # force fresh model download on next run
```

---

## 🖥️ Local development (without Docker)

### 1. Set up the Python ASR server (one-time)

Requires Python 3.10+.

```bash
bash setup_asr.sh
```

This installs:
- PyTorch (CPU)
- AI4Bharat NeMo fork (`nemo-v2` branch)
- `websockets`, `numpy`, `scipy`, `soundfile`

### 2. Start the ASR server

```bash
python asr_server.py
# Listening on ws://0.0.0.0:8765
# Model downloads from HuggingFace on first run (~500 MB)
```

### 3. Start the Node.js frontend

In a second terminal:

```bash
npm install
npm start
# http://localhost:3000
```

---

## Configuration

Copy `.env.example` to `.env` to override defaults:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Node.js server port |
| `ASR_URL` | `ws://localhost:8765` | URL of the Python ASR microservice |
| `SPEECH_RMS_THRESHOLD` | `500` | RMS energy level (0–32767) that counts as speech |
| `SILENCE_RMS_THRESHOLD` | `250` | RMS level below which a frame is silence |

**VAD tuning**: If captions trigger on background noise, raise `SPEECH_RMS_THRESHOLD`. If speech goes undetected, lower it.

---

## Tips

- **Font size**: Use the `+` and `−` buttons; preference is saved in the browser
- **Silence sensitivity**: Default 0.8 s — captions finalise after 0.8 s of silence; adjustable in ⚙️ Settings
- **Quiet mic?** Lower `SPEECH_RMS_THRESHOLD` (e.g. `200`) if the server isn't picking up your voice
- **Noisy room?** Raise `SPEECH_RMS_THRESHOLD` (e.g. `800`) to suppress background triggering
