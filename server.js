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
  const languageCode = url.searchParams.get('language_code') || '';
  const vadThreshold = url.searchParams.get('vad_silence_threshold_secs') || '0.8';
  const sampleRate   = parseInt(url.searchParams.get('sample_rate') || '16000', 10);
  const audioFormat  = sampleRateToFormat(sampleRate);

  console.log(`[Client] Connected — sample rate: ${sampleRate} Hz → audio_format: ${audioFormat}`);

  if (!ELEVENLABS_API_KEY) {
    clientWs.send(JSON.stringify({
      message_type: 'error',
      message: 'ELEVENLABS_API_KEY is not set. Please add it to your .env and restart.'
    }));
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
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ message_type: 'error', message: err.message }));
    }
  });

  elevenWs.on('close', (code, reason) => {
    console.log(`[ElevenLabs] Closed (${code}): ${reason.toString()}`);
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on('message', (data, isBinary) => {
    if (elevenWs.readyState === WebSocket.OPEN) {
      // Preserve frame type: ws delivers text frames as Buffers, but sending a
      // Buffer causes ws to emit a binary frame. ElevenLabs closes immediately
      // on unexpected binary frames for JSON control messages.
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
});

server.listen(PORT, () => {
  console.log(`\n🎙️  LiveCaptions running at http://localhost:${PORT}\n`);
  if (!ELEVENLABS_API_KEY) {
    console.warn('⚠️  ELEVENLABS_API_KEY not set. Copy .env.example to .env and add your key.\n');
  }
});
