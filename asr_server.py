#!/usr/bin/env python3
"""
IndicConformer Hindi ASR WebSocket microservice.

Sits between the LiveCaptions Node.js proxy and the local NeMo model.
Resamples incoming audio, runs energy-based VAD, and transcribes each
speech segment with the AI4Bharat IndicConformer Hindi model.

Client → Server:
  { "message_type": "input_audio_chunk", "audio_base_64": "<base64 int16 PCM>" }

Server → Client:
  { "message_type": "session_started" }
  { "message_type": "committed_transcript", "text": "..." }
  { "message_type": "error", "message": "..." }
"""

import asyncio
import base64
import json
import logging
import math
import os
import tempfile
from urllib.parse import urlparse, parse_qs

import numpy as np
import scipy.signal
import soundfile as sf
import websockets
import nemo.collections.asr as nemo_asr

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s  %(message)s",
)
log = logging.getLogger(__name__)

MODEL_ID   = os.environ.get("ASR_MODEL", "ai4bharat/indicconformer_stt_hi_hybrid_ctc_rnnt_large")
ASR_RATE   = 16_000
PORT       = int(os.environ.get("ASR_PORT", 8765))
FRAME_MS   = 30       # VAD frame length in milliseconds

# Energy thresholds on Int16 RMS scale (0–32767).
# Raise SPEECH_RMS if noise triggers false positives; lower if speech is missed.
SPEECH_RMS  = float(os.environ.get("SPEECH_RMS_THRESHOLD",  500))
SILENCE_RMS = float(os.environ.get("SILENCE_RMS_THRESHOLD", 250))

# Minimum speech duration worth transcribing (seconds)
MIN_SPEECH_S = 0.4

# ── Model ────────────────────────────────────────────────────────────────────

_model = None


def load_model() -> None:
    global _model
    log.info("Loading %s …", MODEL_ID)
    m = nemo_asr.models.ASRModel.from_pretrained(MODEL_ID)
    m.freeze()
    m = m.to("cpu")
    m.cur_decoder = "ctc"
    _model = m
    log.info("Model ready.")


def transcribe_segment(pcm_int16: np.ndarray) -> str:
    """Write a 16 kHz mono int16 segment to a temp WAV and run NeMo inference."""
    fd, tmp = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        sf.write(tmp, pcm_int16.astype(np.float32) / 32768.0, ASR_RATE)
        result = _model.transcribe([tmp], batch_size=1, language_id="hi")
        out = result[0]
        return (out if isinstance(out, str) else out.text).strip()
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


# ── Per-connection handler ────────────────────────────────────────────────────

async def handle_client(websocket) -> None:
    addr = websocket.remote_address
    log.info("[%s] connected", addr)

    # Read query params forwarded by the Node.js proxy
    try:
        path = websocket.path
    except AttributeError:
        path = getattr(getattr(websocket, "request", None), "path", "/")
    qs          = parse_qs(urlparse(path).query)
    native_rate = int(qs.get("sample_rate",                ["16000"])[0])
    vad_secs    = float(qs.get("vad_silence_threshold_secs", ["0.8"])[0])

    await websocket.send(json.dumps({"message_type": "session_started"}))

    # Pre-compute resampling ratio (native browser rate → 16 kHz)
    g    = math.gcd(ASR_RATE, native_rate)
    up   = ASR_RATE   // g
    down = native_rate // g

    frame_samples  = ASR_RATE * FRAME_MS // 1000          # 480 samples at 16 kHz
    silence_frames = max(1, round(vad_secs * 1000 / FRAME_MS))
    min_seg_frames = round(MIN_SPEECH_S * 1000 / FRAME_MS)

    vad_buf       = np.array([], dtype=np.int16)
    speech_frames: list[np.ndarray] = []
    silence_count = 0
    in_speech     = False

    loop = asyncio.get_event_loop()

    try:
        async for raw in websocket:
            if isinstance(raw, bytes):
                continue  # ignore raw binary frames

            try:
                msg = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                continue

            if msg.get("message_type") != "input_audio_chunk":
                continue

            # ── Decode base64 → int16 PCM at native rate ──────────────────
            pcm_native = np.frombuffer(
                base64.b64decode(msg["audio_base_64"]), dtype=np.int16
            )

            # ── Resample to 16 kHz ─────────────────────────────────────────
            if up != 1 or down != 1:
                pcm_16k = np.clip(
                    scipy.signal.resample_poly(
                        pcm_native.astype(np.float32), up, down
                    ),
                    -32768, 32767,
                ).astype(np.int16)
            else:
                pcm_16k = pcm_native

            vad_buf = np.concatenate([vad_buf, pcm_16k])

            # ── Energy-based VAD frame loop ────────────────────────────────
            while len(vad_buf) >= frame_samples:
                frame      = vad_buf[:frame_samples]
                vad_buf    = vad_buf[frame_samples:]
                rms        = float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)))

                if rms >= SPEECH_RMS:
                    speech_frames.append(frame.copy())
                    silence_count = 0
                    in_speech     = True
                elif in_speech:
                    speech_frames.append(frame.copy())
                    if rms < SILENCE_RMS:
                        silence_count += 1

                    if silence_count >= silence_frames:
                        segment       = np.concatenate(speech_frames)
                        speech_frames = []
                        silence_count = 0
                        in_speech     = False

                        # Skip segments that are too short (likely noise)
                        if len(segment) < min_seg_frames * frame_samples:
                            continue

                        # Run NeMo inference off the event loop
                        text = await loop.run_in_executor(
                            None, transcribe_segment, segment
                        )
                        if text:
                            log.info("[%s] %s", addr, text)
                            await websocket.send(json.dumps({
                                "message_type": "committed_transcript",
                                "text": text,
                            }))

    except (
        websockets.exceptions.ConnectionClosedOK,
        websockets.exceptions.ConnectionClosedError,
    ):
        pass
    except Exception as exc:
        log.error("[%s] unexpected error: %s", addr, exc, exc_info=True)
        try:
            await websocket.send(
                json.dumps({"message_type": "error", "message": str(exc)})
            )
        except Exception:
            pass
    finally:
        log.info("[%s] disconnected", addr)


# ── Entry point ───────────────────────────────────────────────────────────────

async def main() -> None:
    load_model()
    log.info("ASR server listening on ws://0.0.0.0:%d", PORT)
    async with websockets.serve(handle_client, "0.0.0.0", PORT):
        await asyncio.Future()  # run until cancelled


if __name__ == "__main__":
    asyncio.run(main())
