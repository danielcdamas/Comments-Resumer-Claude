/**
 * POST /api/comments
 * Corpo: { url: string, max?: number, order?: 'relevance' | 'time' }
 * Resposta: { video, comments: [{ id, author, text, likes, replies, publishedAt }] }
 */
import { HttpError, handle, json, readJson } from '../lib/http.js';
import { resolveKey } from '../lib/keys.js';
import { fetchComments, fetchVideo, parseVideoId } from '../lib/youtube.js';

export const POST = handle(async (request) => {
  const body = await readJson(request, 10_000);
  const videoId = parseVideoId(body.url);
  if (!videoId) {
    throw new HttpError(400, 'Link do YouTube não reconhecido. Cole o endereço completo do vídeo.', 'invalid_url');
  }
  const key = resolveKey(request, 'youtube');
  const video = await fetchVideo(videoId, key);
  const comments = await fetchComments(videoId, key, { max: body.max, order: body.order });
  if (!comments.length) {
    throw new HttpError(404, 'Este vídeo ainda não tem comentários para analisar.', 'no_comments');
  }
  return json({ video, comments });
});
