/**
 * Resolução das chaves de API.
 *
 * Regras de negócio:
 * 1. Se o usuário informar a própria chave na tela (cabeçalho x-youtube-key / x-gemini-key),
 *    ela é usada. Nesse caso o consumo de cota é do próprio usuário e não é exigida senha.
 * 2. Caso contrário, usa-se a chave configurada no servidor (variáveis de ambiente
 *    YOUTUBE_API_KEY / GEMINI_API_KEY). Se APP_PASSWORD estiver definida, o uso das chaves
 *    do servidor exige a senha (cabeçalho x-app-password), evitando que terceiros consumam
 *    a cota do dono da ferramenta.
 * As chaves nunca são devolvidas ao navegador nem registradas em log.
 */
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';

const KEY_PATTERN = /^[A-Za-z0-9_\-.]{20,200}$/;

const SERVICES = {
  youtube: { header: 'x-youtube-key', env: 'YOUTUBE_API_KEY', label: 'YouTube Data API' },
  gemini: { header: 'x-gemini-key', env: 'GEMINI_API_KEY', label: 'Gemini' },
};

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function passwordRequired(env = process.env) {
  return Boolean(env.APP_PASSWORD);
}

export function serverHasKey(service, env = process.env) {
  return Boolean(env[SERVICES[service].env]);
}

/**
 * Retorna a chave a ser usada para o serviço ('youtube' | 'gemini').
 * Lança HttpError com mensagem amigável quando não houver chave disponível.
 */
export function resolveKey(request, service, env = process.env) {
  const cfg = SERVICES[service];
  const userKey = (request.headers.get(cfg.header) || '').trim();
  if (userKey) {
    if (!KEY_PATTERN.test(userKey)) {
      throw new HttpError(400, `A chave da ${cfg.label} informada tem formato inválido.`, 'invalid_key_format');
    }
    return userKey;
  }

  const serverKey = env[cfg.env];
  if (!serverKey) {
    throw new HttpError(
      401,
      `Nenhuma chave da ${cfg.label} configurada. Abra "Configurações" e informe sua chave.`,
      'missing_key',
    );
  }

  if (passwordRequired(env)) {
    const given = request.headers.get('x-app-password') || '';
    if (!given || !safeEqual(given, env.APP_PASSWORD)) {
      throw new HttpError(
        401,
        'Senha de acesso ausente ou incorreta. Informe a senha em "Configurações" ou use suas próprias chaves.',
        'invalid_password',
      );
    }
  }
  return serverKey;
}
