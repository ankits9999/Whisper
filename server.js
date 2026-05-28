require('dotenv').config();
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const path = require('path');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: '/transcribe' });

const PORT    = process.env.PORT    || 3000;
const ASR_URL = process.env.ASR_URL || 'ws://localhost:8765';

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (clientWs, req) => {
  const url        = new URL(req.url, 'http://localhost');
  const sampleRate = url.searchParams.get('sample_rate') || '16000';
  const vadThresh  = url.searchParams.get('vad_silence_threshold_secs') || '0.8';
  const langCode   = url.searchParams.get('language_code') || '';

  console.log(`[Client] Connected — sample rate: ${sampleRate} Hz`);

  const params = new URLSearchParams({
    sample_rate: sampleRate,
    vad_silence_threshold_secs: vadThresh,
  });
  if (langCode) params.set('language_code', langCode);

  const asrUrl = `${ASR_URL}/transcribe?${params}`;
  const asrWs  = new WebSocket(asrUrl);

  asrWs.on('open', () => console.log('[ASR] Connected'));

  asrWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN)
      clientWs.send(isBinary ? data : data.toString('utf8'));
  });

  asrWs.on('error', (err) => {
    console.error('[ASR] Error:', err.message);
    if (clientWs.readyState === WebSocket.OPEN)
      clientWs.send(JSON.stringify({ message_type: 'error', message: err.message }));
  });

  asrWs.on('close', (code, reason) => {
    console.log(`[ASR] Closed (${code}): ${reason.toString()}`);
    if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
  });

  clientWs.on('message', (data, isBinary) => {
    if (asrWs.readyState === WebSocket.OPEN)
      asrWs.send(isBinary ? data : data.toString('utf8'));
  });

  clientWs.on('close', () => {
    console.log('[Client] Disconnected');
    if (asrWs.readyState === WebSocket.OPEN) asrWs.close();
  });

  clientWs.on('error', (err) => {
    console.error('[Client] Error:', err.message);
    if (asrWs.readyState === WebSocket.OPEN) asrWs.close();
  });
});

server.listen(PORT, () => {
  console.log(`\n🎙️  LiveCaptions running at http://localhost:${PORT}`);
  console.log(`   ASR backend : ${ASR_URL}\n`);
});
