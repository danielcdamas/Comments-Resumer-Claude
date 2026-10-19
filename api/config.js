/**
 * GET /api/config
 * Informa ao navegador o que já está configurado no servidor (sem revelar nenhuma chave).
 */
import { handle, json } from '../lib/http.js';
import { passwordRequired, serverHasKey } from '../lib/keys.js';
import { DEFAULT_MODEL } from '../lib/gemini.js';
import { MAX_COMMENTS_LIMIT } from '../lib/youtube.js';

export const GET = handle(async () =>
  json({
    serverYoutubeKey: serverHasKey('youtube'),
    serverGeminiKey: serverHasKey('gemini'),
    passwordRequired: passwordRequired(),
    defaultModel: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    maxComments: MAX_COMMENTS_LIMIT,
  }),
);
