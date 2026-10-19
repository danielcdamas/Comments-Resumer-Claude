/**
 * POST /api/themes  (etapa 1 da análise)
 * Corpo: { video, comments: [{ text, likes }], language?, model? }
 * Resposta: { model, summary, themes: [{ id, title, description, sentiment }], insights: [] }
 */
import { HttpError, handle, json, readJson } from '../lib/http.js';
import { resolveKey } from '../lib/keys.js';
import { discoverThemes, resolveModel } from '../lib/gemini.js';
import { MAX_COMMENTS_LIMIT } from '../lib/youtube.js';
import { sanitizeComments } from '../lib/validate.js';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const comments = sanitizeComments(body.comments, MAX_COMMENTS_LIMIT)
    // Os mais curtidos primeiro: se o texto exceder o limite do modelo, cortamos os menos relevantes.
    .sort((a, b) => b.likes - a.likes);
  if (!comments.length) throw new HttpError(400, 'Nenhum comentário enviado para análise.', 'no_comments');

  const model = resolveModel(body.model);
  const key = resolveKey(request, 'gemini');
  const video = { title: String(body.video?.title || ''), channel: String(body.video?.channel || '') };
  const result = await discoverThemes({ comments, video, language: body.language, model, key });
  return json({ model, ...result });
});
