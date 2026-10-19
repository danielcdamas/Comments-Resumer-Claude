import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveKey } from '../lib/keys.js';

const req = (headers = {}) => new Request('http://x/api', { headers });
const USER_KEY = 'AIzaUSERKEYxxxxxxxxxxxxxxxxxxxx';

test('a chave informada pelo usuário tem prioridade e dispensa senha', () => {
  const env = { YOUTUBE_API_KEY: 'server', APP_PASSWORD: 'segredo' };
  assert.equal(resolveKey(req({ 'x-youtube-key': USER_KEY }), 'youtube', env), USER_KEY);
});

test('usa a chave do servidor quando não há senha configurada', () => {
  assert.equal(resolveKey(req(), 'gemini', { GEMINI_API_KEY: 'server-key' }), 'server-key');
});

test('exige a senha correta para usar a chave do servidor', () => {
  const env = { GEMINI_API_KEY: 'server-key', APP_PASSWORD: 'segredo' };
  assert.throws(() => resolveKey(req(), 'gemini', env), (e) => e.status === 401 && e.code === 'invalid_password');
  assert.throws(() => resolveKey(req({ 'x-app-password': 'errada' }), 'gemini', env), (e) => e.code === 'invalid_password');
  assert.equal(resolveKey(req({ 'x-app-password': 'segredo' }), 'gemini', env), 'server-key');
});

test('sem nenhuma chave, orienta o usuário', () => {
  assert.throws(() => resolveKey(req(), 'youtube', {}), (e) => e.status === 401 && /Configurações/.test(e.message));
});

test('rejeita chave com formato suspeito', () => {
  assert.throws(() => resolveKey(req({ 'x-gemini-key': 'abc&x=1' }), 'gemini', {}), (e) => e.code === 'invalid_key_format');
});
