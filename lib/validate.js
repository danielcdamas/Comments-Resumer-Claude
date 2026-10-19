/**
 * Validação das entradas enviadas pelo navegador às etapas de análise.
 * Tudo que vem do cliente é tratado como não confiável: tipos são forçados e tamanhos limitados.
 */
import { HttpError } from './http.js';
import { MAX_COMMENT_CHARS } from './youtube.js';

function ensureArray(value, max, label) {
  if (!Array.isArray(value)) return [];
  if (value.length > max) {
    throw new HttpError(413, `Envie no máximo ${max} ${label} por requisição.`, 'too_many_items');
  }
  return value;
}

const cleanText = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function sanitizeComments(value, max) {
  return ensureArray(value, max, 'comentários')
    .map((c) => ({ text: cleanText(c?.text, MAX_COMMENT_CHARS), likes: Math.max(0, Number(c?.likes) || 0) }))
    .filter((c) => c.text);
}

export function sanitizeItems(value, max) {
  const seen = new Set();
  return ensureArray(value, max, 'comentários')
    .map((c) => ({ i: Number(c?.i), text: cleanText(c?.text, MAX_COMMENT_CHARS) }))
    .filter((c) => Number.isInteger(c.i) && c.i >= 0 && c.text && !seen.has(c.i) && seen.add(c.i));
}

export function sanitizeThemes(value, max) {
  return ensureArray(value, max, 'temas')
    .map((t) => ({
      id: cleanText(t?.id, 20),
      title: cleanText(t?.title, 120),
      description: cleanText(t?.description, 500),
    }))
    .filter((t) => /^t\d{1,2}$/.test(t.id) && t.title);
}
