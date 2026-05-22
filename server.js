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

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (clientWs, req) => {
  const url = new URL(req.url, `http://localhost`);
  const languageCode = url.searchParams.get('language_code') || '';
  const vadThreshold = url.searchParams.get('vad_silence_threshold_secs') || '0.8';

  if (!ELEVENLABS_API_KEY) {
    clientWs.send(JSON.stringify({
      message_type: 'error',
      message: 'ELEVENLABS_API_KEY is not set in .env file. Please add it and restart the server.'
    }));
    clientWs.close();
    return;
  }

  const params = new URLSearchParams({
    model_id: 'scribe_v2_realtime',
    audio_format: 'pcm_16000',
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

  elevenWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data.toString());
    }
  });

  elevenWs.on('error', (err) => {
    console.error('[ElevenLabs] Error:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ message_type: 'error', message: err.message }));
    }
  });

  elevenWs.on('close', (code, reason) => {
    console.log(`[ElevenLabs] Closed (${code}):`, reason.toString());
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on('message', (data) => {
    if (elevenWs.readyState === WebSocket.OPEN) {
      elevenWs.send(data);
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
  console.log(`\n🎙️  LiveCaptions server running at http://localhost:${PORT}\n`);
  if (!ELEVENLABS_API_KEY) {
    console.warn('⚠️  Warning: ELEVENLABS_API_KEY not set. Copy .env.example to .env and add your key.\n');
  }
});
