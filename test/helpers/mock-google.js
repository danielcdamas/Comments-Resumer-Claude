/**
 * Servidor que simula a YouTube Data API e a API do Gemini, para testes sem rede e sem custo.
 *
 * - GET  /youtube/v3/videos?id=...              -> metadados do vídeo
 * - GET  /youtube/v3/commentThreads?videoId=... -> comentários paginados (100 por página)
 * - POST /v1beta/models/<modelo>:generateContent -> temas ou classificação, conforme o schema pedido
 *
 * IDs especiais de vídeo: "disabled000" (comentários desativados), "notfound000" (inexistente).
 * Chave "AIzaINVALIDKEYxxxxxxxxxxxxxxxx" simula chave inválida.
 */
import { createServer } from 'node:http';

export const SAMPLE_TEXTS = [
  'Que vídeo incrível, a edição ficou perfeita!',
  'Faz a parte 2 por favor, quero ver a continuação',
  'O áudio está muito baixo, difícil de ouvir',
  'Parte 2 quando? Ansioso pela continuação',
  'Edição sensacional, parabéns pelo trabalho',
  'Não gostei do áudio, tem muito ruído no fundo',
  'Primeiro!',
];

export function buildComments(total) {
  return Array.from({ length: total }, (_, i) => ({
    id: `c${i}`,
    text: `${SAMPLE_TEXTS[i % SAMPLE_TEXTS.length]} #${i}`,
    likes: (total - i) * 3,
  }));
}

const THEMES = [
  { title: 'Elogios à edição', description: 'O público elogia a edição do vídeo.', sentiment: 'positivo' },
  { title: 'Pedidos de parte 2', description: 'Pedem a continuação do vídeo.', sentiment: 'positivo' },
  { title: 'Reclamações do áudio', description: 'Criticam o volume e o ruído do áudio.', sentiment: 'negativo' },
];

function classifyText(text) {
  const t = text.toLowerCase();
  if (/edi[cç][aã]o/.test(t)) return { t: 't1', s: 'positivo' };
  if (/parte 2|continua/.test(t)) return { t: 't2', s: 'positivo' };
  if (/[aá]udio/.test(t)) return { t: 't3', s: 'negativo' };
  return { t: 'outros', s: 'neutro' };
}

function geminiReply(obj) {
  return {
    candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
  };
}

export function startMockGoogle({ commentsPerVideo = 250, port = 0, failClassifyTimes = 0 } = {}) {
  const comments = buildComments(commentsPerVideo);
  const calls = { videos: 0, commentThreads: 0, themes: 0, classify: 0, bodies: [] };
  let classifyFailures = failClassifyTimes;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const key = url.searchParams.get('key') || req.headers['x-goog-api-key'];
    if (key === 'AIzaINVALIDKEYxxxxxxxxxxxxxxxx') {
      return send(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } });
    }

    if (url.pathname === '/youtube/v3/videos') {
      calls.videos++;
      const id = url.searchParams.get('id');
      if (id === 'notfound000') return send(200, { items: [] });
      return send(200, {
        items: [{
          id,
          snippet: { title: 'Vídeo de teste', channelTitle: 'Canal Teste', publishedAt: '2026-01-01T00:00:00Z', description: 'desc', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/x/mqdefault.jpg' } } },
          statistics: { viewCount: '12345', likeCount: '100', commentCount: String(commentsPerVideo) },
        }],
      });
    }

    if (url.pathname === '/youtube/v3/commentThreads') {
      calls.commentThreads++;
      if (url.searchParams.get('videoId') === 'disabled000') {
        return send(403, { error: { code: 403, message: 'The video has disabled comments.', errors: [{ reason: 'commentsDisabled' }] } });
      }
      const start = Number(url.searchParams.get('pageToken') || 0);
      const size = Number(url.searchParams.get('maxResults') || 20);
      const page = comments.slice(start, start + size);
      const next = start + size < comments.length ? String(start + size) : undefined;
      return send(200, {
        nextPageToken: next,
        items: page.map((c) => ({
          id: c.id,
          snippet: {
            totalReplyCount: 1,
            topLevelComment: { id: c.id, snippet: { authorDisplayName: '@autor', textDisplay: c.text, textOriginal: c.text, likeCount: c.likes, publishedAt: '2026-01-02T00:00:00Z' } },
          },
        })),
      });
    }

    const gen = url.pathname.match(/^\/v1beta\/models\/([^/:]+):generateContent$/);
    if (gen && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      calls.bodies.push(body);
      if (gen[1] === 'modelo-inexistente') {
        return send(404, { error: { code: 404, message: 'models/modelo-inexistente is not found', status: 'NOT_FOUND' } });
      }
      const prompt = body.contents[0].parts[0].text;
      const isClassify = Boolean(body.generationConfig?.responseSchema?.properties?.assignments);

      if (!isClassify) {
        calls.themes++;
        return send(200, geminiReply({ summary: 'O público elogia a edição, pede parte 2 e reclama do áudio.', themes: THEMES, insights: ['Gravar a parte 2', 'Melhorar o microfone'] }));
      }

      calls.classify++;
      if (classifyFailures > 0) {
        classifyFailures--;
        return send(503, { error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } });
      }
      const assignments = [];
      for (const line of prompt.split('\n')) {
        const m = line.match(/^\[(\d+)\] (.*)$/);
        if (m) assignments.push({ i: Number(m[1]), ...classifyText(m[2]) });
      }
      return send(200, geminiReply({ assignments }));
    }

    send(404, { error: { code: 404, message: 'not found' } });
  });

  return new Promise((resolveStart) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolveStart({
        server,
        calls,
        youtubeBase: `http://127.0.0.1:${actual}/youtube/v3`,
        geminiBase: `http://127.0.0.1:${actual}/v1beta`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
