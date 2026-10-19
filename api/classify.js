/**
 * POST /api/classify  (etapa 2 da análise, chamada uma vez por lote)
 * Corpo: { items: [{ i, text }], themes: [{ id, title, description }], model? }
 * Resposta: { assignments: [{ i, t, s }], missing }
 */
import { HttpError, handle, json, readJson } from '../lib/http.js';
import { resolveKey } from '../lib/keys.js';
import { MAX_CLASSIFY_BATCH, MAX_THEMES, classifyBatch, resolveModel } from '../lib/gemini.js';
import { sanitizeItems, sanitizeThemes } from '../lib/validate.js';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const items = sanitizeItems(body.items, MAX_CLASSIFY_BATCH);
  const themes = sanitizeThemes(body.themes, MAX_THEMES);
  if (!items.length) throw new HttpError(400, 'Nenhum comentário enviado para classificação.', 'no_items');
  if (!themes.length) throw new HttpError(400, 'Nenhum tema enviado para classificação.', 'no_themes');

  const model = resolveModel(body.model);
  const key = resolveKey(request, 'gemini');
  return json(await classifyBatch({ items, themes, model, key }));
});
