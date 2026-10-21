/**
 * Testes de integração: chamam os handlers reais de /api com as APIs do Google simuladas.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startMockGoogle } from './helpers/mock-google.js';

let mock;
let api;
const saved = {};
const ENV = ['YOUTUBE_API_BASE', 'GEMINI_API_BASE', 'YOUTUBE_API_KEY', 'GEMINI_API_KEY', 'APP_PASSWORD', 'GEMINI_MODEL'];

before(async () => {
  mock = await startMockGoogle({ commentsPerVideo: 120 });
  for (const k of ENV) saved[k] = process.env[k];
  for (const k of ENV) delete process.env[k];
  process.env.YOUTUBE_API_BASE = mock.youtubeBase;
  process.env.GEMINI_API_BASE = mock.geminiBase;
  api = {
    config: await import('../api/config.js'),
    comments: await import('../api/comments.js'),
    themes: await import('../api/themes.js'),
    classify: await import('../api/classify.js'),
  };
});

after(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await mock.close();
});

const KEYS = { 'x-youtube-key': 'AIzaUSERYTKEYxxxxxxxxxxxxxxxxxx', 'x-gemini-key': 'AIzaUSERGEMKEYxxxxxxxxxxxxxxxxx' };

function post(body, headers = KEYS) {
  return new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('config informa o que existe no servidor sem expor chaves', async () => {
  process.env.GEMINI_API_KEY = 'segredo-do-servidor';
  const res = await api.config.GET(new Request('http://localhost/api/config'));
  const data = await res.json();
  delete process.env.GEMINI_API_KEY;
  assert.equal(res.status, 200);
  assert.equal(data.serverGeminiKey, true);
  assert.equal(data.serverYoutubeKey, false);
  assert.ok(!JSON.stringify(data).includes('segredo-do-servidor'));
});

test('fluxo completo: comentários -> temas -> classificação', async () => {
  const r1 = await api.comments.POST(post({ url: 'https://youtu.be/abcdefghijk', max: 100 }));
  assert.equal(r1.status, 200);
  const { video, comments } = await r1.json();
  assert.equal(video.title, 'Vídeo de teste');
  assert.equal(comments.length, 100);

  const r2 = await api.themes.POST(post({ video, comments, language: 'pt-BR' }));
  assert.equal(r2.status, 200);
  const analysis = await r2.json();
  assert.equal(analysis.model, 'gemini-3.8-flash');
  assert.deepEqual(analysis.themes.map((t) => t.id), ['t1', 't2', 't3']);

  const items = comments.map((c, i) => ({ i, text: c.text }));
  const r3 = await api.classify.POST(post({ items, themes: analysis.themes, model: analysis.model }));
  assert.equal(r3.status, 200);
  const { assignments, missing } = await r3.json();
  assert.equal(assignments.length, 100);
  assert.equal(missing, 0);
  assert.equal(assignments.find((a) => a.i === 0).t, 't1');

  const sentConfig = mock.calls.bodies.at(-1).generationConfig;
  assert.equal(sentConfig.thinkingConfig.thinkingLevel, 'low');
  assert.deepEqual(sentConfig.responseSchema.properties.assignments.items.properties.t.enum, ['t1', 't2', 't3', 'outros']);
});

test('max "all" busca todos os comentários disponíveis', async () => {
  const res = await api.comments.POST(post({ url: 'abcdefghijk', max: 'all' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).comments.length, 120);
});

test('validação de entrada e mensagens de erro', async () => {
  const cases = [
    [api.comments.POST(post({ url: 'https://vimeo.com/1' })), 400, /não reconhecido/],
    [api.comments.POST(post('{nao-json')), 400, /inválido/],
    [api.comments.POST(post({ url: 'https://youtu.be/disabled000' })), 403, /desativados/],
    [api.comments.POST(post({ url: 'https://youtu.be/abcdefghijk' }, {})), 401, /Configurações/],
    [api.themes.POST(post({ comments: [] })), 400, /Nenhum comentário/],
    [api.themes.POST(post({ comments: [{ text: 'oi' }], model: 'modelo-inexistente' })), 400, /não está disponível/],
    [api.classify.POST(post({ items: [{ i: 0, text: 'a' }], themes: [] })), 400, /Nenhum tema/],
    [api.classify.POST(post({ items: Array.from({ length: 251 }, (_, i) => ({ i, text: 'a' })), themes: [{ id: 't1', title: 'x' }] })), 413, /no máximo 250/],
  ];
  for (const [promise, status, pattern] of cases) {
    const res = await promise;
    const data = await res.json();
    assert.equal(res.status, status, data.error);
    assert.match(data.error, pattern);
  }
});

test('senha protege as chaves do servidor', async () => {
  process.env.YOUTUBE_API_KEY = 'AIzaSERVERKEYxxxxxxxxxxxxxxxxxx';
  process.env.APP_PASSWORD = 'minha-senha';
  try {
    const denied = await api.comments.POST(post({ url: 'abcdefghijk', max: 10 }, {}));
    assert.equal(denied.status, 401);
    const allowed = await api.comments.POST(post({ url: 'abcdefghijk', max: 10 }, { 'x-app-password': 'minha-senha' }));
    assert.equal(allowed.status, 200);
  } finally {
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.APP_PASSWORD;
  }
});
