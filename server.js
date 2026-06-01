require('dotenv').config();
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/transcribe' });

const PORT = process.env.PORT || 3000;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// Tolerate users pasting the full subprotocol value (`api-subscription-key.sk_…`)
// into the env var — strip the prefix so we get the bare key.
const SARVAM_API_KEY = (process.env.SARVAM_API_KEY || '').replace(/^api-subscription-key\./, '');

const SAMPLE_RATE_FORMAT_MAP = {
  8000:  'pcm_8000',
  16000: 'pcm_16000',
  22050: 'pcm_22050',
  24000: 'pcm_24000',
  44100: 'pcm_44100',
  48000: 'pcm_48000',
};

function sampleRateToFormat(rate) {
  return SAMPLE_RATE_FORMAT_MAP[rate] || 'pcm_16000';
}

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (clientWs, req) => {
  const url = new URL(req.url, `http://localhost`);
  const provider     = (url.searchParams.get('provider') || 'sarvam').toLowerCase();
  const languageCode = url.searchParams.get('language_code') || '';
  const vadThreshold = url.searchParams.get('vad_silence_threshold_secs') || '0.8';
  const sampleRate   = parseInt(url.searchParams.get('sample_rate') || '16000', 10);

  console.log(`[Client] Connected — provider: ${provider}, sample rate: ${sampleRate} Hz`);

  if (provider === 'sarvam') {
    handleSarvam(clientWs, { languageCode, vadThreshold, sampleRate });
  } else {
    handleElevenLabs(clientWs, { languageCode, vadThreshold, sampleRate });
  }
});

// ─── ElevenLabs (streaming WebSocket) ────────────────────────────────────────
function handleElevenLabs(clientWs, { languageCode, vadThreshold, sampleRate }) {
  const audioFormat = sampleRateToFormat(sampleRate);

  if (!ELEVENLABS_API_KEY) {
    sendError(clientWs, 'ELEVENLABS_API_KEY is not set. Please add it to your .env and restart.');
    clientWs.close();
    return;
  }

  const params = new URLSearchParams({
    model_id: 'scribe_v2_realtime',
    audio_format: audioFormat,
    commit_strategy: 'vad',
    vad_silence_threshold_secs: vadThreshold,
  });
  if (languageCode) params.set('language_code', languageCode);

  const elevenLabsUrl = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params.toString()}`;
  const elevenWs = new WebSocket(elevenLabsUrl, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY }
  });

  elevenWs.on('open', () => {
    clientWs.send(JSON.stringify({ message_type: 'session_started' }));
    console.log('[ElevenLabs] Connected');
  });

  elevenWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(isBinary ? data : data.toString('utf8'));
    }
  });

  elevenWs.on('error', (err) => {
    console.error('[ElevenLabs] Error:', err.message);
    sendError(clientWs, err.message);
  });

  elevenWs.on('close', (code, reason) => {
    console.log(`[ElevenLabs] Closed (${code}): ${reason.toString()}`);
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on('message', (data, isBinary) => {
    if (elevenWs.readyState === WebSocket.OPEN) {
      elevenWs.send(isBinary ? data : data.toString('utf8'));
    }
  });

  clientWs.on('close', () => {
    console.log('[Client] Disconnected');
    if (elevenWs.readyState === WebSocket.OPEN) elevenWs.close();
  });

  clientWs.on('error', (err) => {
    console.error('[Client] Error:', err.message);
    if (elevenWs.readyState === WebSocket.OPEN) elevenWs.close();
  });
}

// ─── Sarvam (Saaras v3 streaming WebSocket) ─────────────────────────────────
//
// Sarvam's streaming endpoint accepts WAV-wrapped, base64-encoded PCM chunks
// inside a JSON envelope, and emits `{type: "data", data: {transcript}}`
// messages whenever its server-side VAD finalises an utterance. The per-message
// `sample_rate` field is enum-restricted to 16000/22050/24000, so we resample
// the browser's native-rate PCM (44.1k/48k) down to 16 kHz before sending.
const SARVAM_WS_URL = 'wss://api.sarvam.ai/speech-to-text/ws';
const SARVAM_TARGET_RATE = 16000;

function handleSarvam(clientWs, { languageCode, vadThreshold, sampleRate }) {
  if (!SARVAM_API_KEY) {
    sendError(clientWs, 'SARVAM_API_KEY is not set. Please add it to your .env and restart.');
    clientWs.close();
    return;
  }

  // Sarvam expects `unknown` (auto-detect) or BCP-47 like `hi-IN`.
  // Default to hi-IN for Hindi+English bilingual speech common in India.
  const sarvamLang = languageCode ? `${languageCode}-IN` : 'hi-IN';
  // Map our 0.3–3.0s threshold to Sarvam's binary high_vad_sensitivity flag:
  // high sensitivity ≈ 0.5s silence boundary; low ≈ 1s.
  const highVad = parseFloat(vadThreshold) <= 0.7 ? 'true' : 'false';

  const params = new URLSearchParams({
    'language-code': sarvamLang,
    model: 'saaras:v3',
    mode: 'transcribe',
    sample_rate: String(SARVAM_TARGET_RATE),
    input_audio_codec: 'wav',
    high_vad_sensitivity: highVad,
    vad_signals: 'true',
    // Trim end-of-speech detection so segments finalise faster — gives a
    // more "live" feel at the cost of occasionally splitting on natural
    // mid-sentence pauses. Frames are 32ms each: 15 negative frames in a
    // 25-frame window ≈ ~480ms of silence to close a segment.
    negative_frames_count:  '15',
    negative_frames_window: '25',
    min_speech_frames:      '5',
  });
  const sarvamUrl = `${SARVAM_WS_URL}?${params.toString()}`;
  // Sarvam accepts auth either as the `Api-Subscription-Key` HTTP header OR
  // smuggled through the WebSocket subprotocol field as
  // `api-subscription-key.<KEY>` (the trick their own browser demo uses,
  // because browsers can't set custom WS headers). We send both so it works
  // no matter which form the server happens to negotiate.
  const sarvamWs = new WebSocket(
    sarvamUrl,
    [`api-subscription-key.${SARVAM_API_KEY}`],
    { headers: { 'Api-Subscription-Key': SARVAM_API_KEY } }
  );

  sarvamWs.on('unexpected-response', (_req, res) => {
    let body = '';
    res.on('data', (c) => { body += c.toString(); });
    res.on('end', () => {
      const msg = `Sarvam handshake failed: HTTP ${res.statusCode} ${body.slice(0, 300)}`;
      console.error('[Sarvam]', msg);
      sendError(clientWs, msg);
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
    });
  });

  sarvamWs.on('open', () => {
    clientWs.send(JSON.stringify({ message_type: 'session_started' }));
    console.log(`[Sarvam] Connected — language: ${sarvamLang}, high_vad_sensitivity: ${highVad}`);
  });

  sarvamWs.on('message', (raw) => {
    const text = raw.toString('utf8');
    console.log('[Sarvam ←]', text.slice(0, 500));
    let msg;
    try { msg = JSON.parse(text); } catch { return; }

    if (msg.type === 'data' && msg.data && msg.data.transcript) {
      const transcript = msg.data.transcript.trim();
      if (transcript && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ message_type: 'committed_transcript', text: transcript }));
      }
    } else if (msg.type === 'error') {
      sendError(clientWs, (msg.data && (msg.data.message || msg.data.error)) || 'Sarvam streaming error');
    }
    // `events` (speech_start / speech_end) are logged above but not forwarded.
  });

  sarvamWs.on('error', (err) => {
    console.error('[Sarvam] WS error:', err.message);
    sendError(clientWs, err.message);
  });

  sarvamWs.on('close', (code, reason) => {
    const r = reason && reason.toString();
    console.log(`[Sarvam] Closed (${code})${r ? ': ' + r : ''}`);
    if (code !== 1000 && code !== 1005) {
      sendError(clientWs, `Sarvam closed (${code})${r ? ': ' + r : ''}`);
    }
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  // Buffer ~500ms of 16k PCM before flushing one WAV message. Sarvam's VAD
  // can't do anything useful with 100ms standalone WAV files (each carries
  // its own RIFF header), so we accumulate and send chunks large enough for
  // its server-side segmentation to land on real word boundaries.
  const FLUSH_SAMPLES = SARVAM_TARGET_RATE / 2; // 500ms @ 16k = 8000 samples
  let pending = [];
  let pendingLen = 0;

  const flushPending = () => {
    if (pendingLen === 0 || sarvamWs.readyState !== WebSocket.OPEN) return;
    const merged = new Int16Array(pendingLen);
    let off = 0;
    for (const chunk of pending) { merged.set(chunk, off); off += chunk.length; }
    pending = [];
    pendingLen = 0;
    const wav = pcmToWav(merged, SARVAM_TARGET_RATE);
    sarvamWs.send(JSON.stringify({
      audio: {
        data: wav.toString('base64'),
        sample_rate: String(SARVAM_TARGET_RATE),
        encoding: 'audio/wav',
      }
    }));
  };

  clientWs.on('message', (data) => {
    if (sarvamWs.readyState !== WebSocket.OPEN) return;
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
    if (msg.message_type !== 'input_audio_chunk' || !msg.audio_base_64) return;

    const pcmIn = new Int16Array(Buffer.from(msg.audio_base_64, 'base64').buffer);
    if (pcmIn.length === 0) return;

    const pcm16k = resampleInt16(pcmIn, sampleRate, SARVAM_TARGET_RATE);
    pending.push(pcm16k);
    pendingLen += pcm16k.length;
    if (pendingLen >= FLUSH_SAMPLES) flushPending();
  });

  clientWs.on('close', () => {
    console.log('[Client] Disconnected');
    if (sarvamWs.readyState === WebSocket.OPEN) {
      try { flushPending(); } catch {}
      try { sarvamWs.send(JSON.stringify({ type: 'flush' })); } catch {}
      sarvamWs.close();
    }
  });

  clientWs.on('error', (err) => {
    console.error('[Client] Error:', err.message);
    if (sarvamWs.readyState === WebSocket.OPEN) sarvamWs.close();
  });
}

// Linear-interp downsampler. Adequate for speech captions; for music we'd
// want a proper low-pass + decimator, but voice content above 8 kHz carries
// negligible information so simple interp is fine here.
function resampleInt16(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcIdx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function pcmToWav(int16, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = int16.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);              // PCM
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength).copy(buf, 44);
  return buf;
}

function sendError(clientWs, message) {
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify({ message_type: 'error', message }));
  }
}

server.listen(PORT, () => {
  console.log(`\n🎙️  LiveCaptions running at http://localhost:${PORT}\n`);
  if (!ELEVENLABS_API_KEY) {
    console.warn('⚠️  ELEVENLABS_API_KEY not set — ElevenLabs provider will fail.');
  }
  if (!SARVAM_API_KEY) {
    console.warn('⚠️  SARVAM_API_KEY not set — Sarvam provider will fail.');
  }
  console.log('');
});
