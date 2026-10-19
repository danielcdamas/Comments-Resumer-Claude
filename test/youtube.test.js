import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fetchComments, fetchVideo, youtubeErrorMessage } from '../lib/youtube.js';
import { startMockGoogle } from './helpers/mock-google.js';

let mock;
let env;
before(async () => {
  mock = await startMockGoogle({ commentsPerVideo: 250 });
  env = { YOUTUBE_API_BASE: mock.youtubeBase };
});
after(() => mock.close());

const KEY = 'AIzaTESTKEYxxxxxxxxxxxxxxxxxxxx';

test('fetchVideo normaliza metadados', async () => {
  const video = await fetchVideo('abcdefghijk', KEY, env);
  assert.equal(video.title, 'Vídeo de teste');
  assert.equal(video.views, 12345);
  assert.equal(video.url, 'https://www.youtube.com/watch?v=abcdefghijk');
});

test('fetchComments pagina até o limite pedido', async () => {
  const before = mock.calls.commentThreads;
  const comments = await fetchComments('abcdefghijk', KEY, { max: 150 }, env);
  assert.equal(comments.length, 150);
  assert.equal(mock.calls.commentThreads - before, 2, 'duas páginas de 100');
  assert.deepEqual(Object.keys(comments[0]).sort(), ['author', 'id', 'likes', 'publishedAt', 'replies', 'text']);
  assert.equal(new Set(comments.map((c) => c.id)).size, 150);
});

test('fetchComments para quando acabam os comentários', async () => {
  const comments = await fetchComments('abcdefghijk', KEY, { max: 3000 }, env);
  assert.equal(comments.length, 250);
});

test('erros da API viram mensagens claras', async () => {
  await assert.rejects(fetchComments('disabled000', KEY, {}, env), (e) => e.status === 403 && /desativados/.test(e.message));
  await assert.rejects(fetchVideo('notfound000', KEY, env), (e) => e.status === 404);
  await assert.rejects(fetchVideo('abcdefghijk', 'AIzaINVALIDKEYxxxxxxxxxxxxxxxx', env), (e) => e.status === 401);
  assert.match(youtubeErrorMessage(403, { error: { errors: [{ reason: 'quotaExceeded' }] } })[1], /cota/);
  assert.match(youtubeErrorMessage(403, { error: { message: 'YouTube Data API v3 has not been used in project 1 before or it is disabled.' } })[1], /não está ativada/);
});
