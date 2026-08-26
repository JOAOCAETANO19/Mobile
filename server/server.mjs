#!/usr/bin/env node
// Backend zero-dependência (só Node 18+): /api/health, /api/search, /api/stream/<id>
// Usa yt-dlp (deve estar instalado no PATH) para buscar e resolver a URL de áudio real,
// e faz o proxy do stream de volta para o cliente (o navegador nunca fala com o YouTube
// diretamente, evitando os bloqueios de CORS/anti-bot dos extratores públicos).
//
// Uso:
//   pip install yt-dlp   (+ ffmpeg no sistema)
//   npm run server       # RD_PORT (padrão 8787), RD_API_KEY (opcional), RD_MAX_STREAMS (opcional)

import http from 'node:http';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import { buildSearchArgs, buildStreamArgs, parseYtDlpJsonLines, rankByDuration } from './ytdlp.js';

const PORT = Number(process.env.RD_PORT || 8787);
const API_KEY = process.env.RD_API_KEY || '';
const MAX_STREAMS = Number(process.env.RD_MAX_STREAMS || 20);
const YTDLP_BIN = process.env.RD_YTDLP_BIN || 'yt-dlp';

let activeStreams = 0;

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Rhythm-Dash-Key',
    ...headers,
  });
  res.end(payload);
}

function checkAuth(req, url) {
  if (!API_KEY) return true;
  const headerKey = req.headers['x-rhythm-dash-key'];
  const queryKey = url.searchParams.get('key');
  return headerKey === API_KEY || queryKey === API_KEY;
}

function runYtDlp(args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('yt-dlp: tempo esgotado'));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`yt-dlp não encontrado/erro ao executar (${err.message}). Instale com: pip install yt-dlp`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        reject(new Error(`yt-dlp saiu com código ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function handleHealth(req, res) {
  try {
    await runYtDlp(['--version'], { timeoutMs: 5000 });
    send(res, 200, { ok: true, ytdlp: true, activeStreams, maxStreams: MAX_STREAMS });
  } catch (err) {
    send(res, 200, { ok: true, ytdlp: false, error: String(err.message || err) });
  }
}

async function handleSearch(req, res, url) {
  const q = url.searchParams.get('q') || '';
  if (!q.trim()) return send(res, 400, { error: 'parâmetro q obrigatório' });
  const targetDuration = Number(url.searchParams.get('duration')) || null;

  try {
    const { stdout } = await runYtDlp(buildSearchArgs(q, 8), { timeoutMs: 25000 });
    let results = parseYtDlpJsonLines(stdout);
    if (targetDuration) results = rankByDuration(results, targetDuration);
    send(res, 200, { results });
  } catch (err) {
    send(res, 502, { error: String(err.message || err) });
  }
}

async function handleStream(req, res, url, id) {
  if (activeStreams >= MAX_STREAMS) {
    return send(res, 429, { error: 'Limite de streams simultâneos atingido, tente novamente em instantes.' });
  }
  activeStreams++;
  try {
    const { stdout } = await runYtDlp(buildStreamArgs(decodeURIComponent(id)), { timeoutMs: 20000 });
    const directUrl = stdout.trim().split('\n').pop();
    if (!directUrl || !directUrl.startsWith('http')) {
      throw new Error('yt-dlp não retornou uma URL de stream válida');
    }
    // Faz o proxy do stream de áudio real para o cliente (evita expor a URL do YouTube
    // diretamente e contorna CORS).
    const upstream = await fetch(directUrl);
    res.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') || 'audio/mp4',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    const reader = upstream.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    send(res, 502, { error: String(err.message || err) });
  } finally {
    activeStreams--;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    return send(res, 204, '');
  }

  if (!checkAuth(req, url) && url.pathname !== '/api/health') {
    return send(res, 401, { error: 'Chave inválida (X-Rhythm-Dash-Key ou ?key=)' });
  }

  if (url.pathname === '/api/health') return handleHealth(req, res);
  if (url.pathname === '/api/search') return handleSearch(req, res, url);

  const streamMatch = /^\/api\/stream\/(.+)$/.exec(url.pathname);
  if (streamMatch) return handleStream(req, res, url, streamMatch[1]);

  send(res, 404, { error: 'não encontrado' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Rhythm Dash backend rodando em http://0.0.0.0:${PORT}`);
  console.log(API_KEY ? 'Protegido por RD_API_KEY.' : 'AVISO: sem RD_API_KEY (endpoint público sem proteção).');
});
