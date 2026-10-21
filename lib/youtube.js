/**
 * Integração com a YouTube Data API v3.
 * Custo de cota: 1 unidade por chamada de videos.list e por página (100 comentários) de commentThreads.list.
 * A cota gratuita padrão é de 10.000 unidades/dia.
 */
import { HttpError, fetchWithTimeout } from './http.js';
import { parseVideoId } from '../public/js/video-id.js';

export { parseVideoId };

const DEFAULT_BASE = 'https://www.googleapis.com/youtube/v3';

export const MAX_COMMENTS_LIMIT = 3000;
export const MAX_COMMENT_CHARS = 1500;

function apiBase(env = process.env) {
  return (env.YOUTUBE_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
}

/** Converte erros da API em mensagens claras em português. */
export function youtubeErrorMessage(status, body) {
  const err = body?.error || {};
  const reason = err.errors?.[0]?.reason || err.details?.find?.((d) => d.reason)?.reason || '';
  const message = String(err.message || '');

  if (reason === 'commentsDisabled') return [403, 'Os comentários estão desativados neste vídeo.'];
  if (reason === 'videoNotFound') return [404, 'Vídeo não encontrado. Verifique o link.'];
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return [429, 'A cota diária da YouTube Data API foi esgotada. Ela é renovada à meia-noite (horário do Pacífico).'];
  }
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED' || /has not been used|is disabled/i.test(message)) {
    return [403, 'A "YouTube Data API v3" não está ativada no projeto Google Cloud desta chave. Ative-a no console do Google Cloud.'];
  }
  if (reason === 'API_KEY_INVALID' || reason === 'keyInvalid' || /API key not valid/i.test(message)) {
    return [401, 'A chave da YouTube Data API é inválida.'];
  }
  if (reason === 'API_KEY_SERVICE_BLOCKED' || /blocked/i.test(message)) {
    return [403, 'Esta chave tem restrições que bloqueiam a YouTube Data API. Libere a API nas restrições da chave.'];
  }
  if (reason === 'forbidden') return [403, 'O YouTube não permite ler os comentários deste vídeo.'];
  return [status >= 500 ? 502 : status, `Erro da YouTube Data API (${status}): ${message || 'sem detalhes'}`];
}

async function callApi(path, params, key, env) {
  const url = new URL(`${apiBase(env)}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  url.searchParams.set('key', key);

  const res = await fetchWithTimeout(url, { headers: { accept: 'application/json' } }, 20_000);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const [status, message] = youtubeErrorMessage(res.status, body);
    throw new HttpError(status, message, 'youtube_error');
  }
  return body || {};
}

export async function fetchVideo(videoId, key, env = process.env) {
  const data = await callApi('videos', { part: 'snippet,statistics', id: videoId }, key, env);
  const item = data.items?.[0];
  if (!item) throw new HttpError(404, 'Vídeo não encontrado ou privado. Verifique o link.', 'video_not_found');

  const sn = item.snippet || {};
  const st = item.statistics || {};
  const thumbs = sn.thumbnails || {};
  return {
    id: videoId,
    title: sn.title || '',
    channel: sn.channelTitle || '',
    publishedAt: sn.publishedAt || null,
    description: (sn.description || '').slice(0, 1000),
    thumbnail: (thumbs.medium || thumbs.high || thumbs.default || {}).url || null,
    views: Number(st.viewCount || 0),
    likes: Number(st.likeCount || 0),
    commentCount: Number(st.commentCount || 0),
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function normalizeComment(thread) {
  const top = thread.snippet?.topLevelComment;
  const sn = top?.snippet || {};
  const text = String(sn.textOriginal || sn.textDisplay || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_COMMENT_CHARS);
  return {
    id: top?.id || thread.id,
    author: sn.authorDisplayName || '',
    text,
    likes: Number(sn.likeCount || 0),
    replies: Number(thread.snippet?.totalReplyCount || 0),
    publishedAt: sn.publishedAt || null,
  };
}

/**
 * Busca até `max` comentários de primeiro nível.
 * order: 'relevance' (mais relevantes, padrão do YouTube) ou 'time' (mais recentes).
 */
export async function fetchComments(videoId, key, { max = 500, order = 'relevance' } = {}, env = process.env) {
  const limit = Math.min(Math.max(Number(max) || 0, 1), MAX_COMMENTS_LIMIT);
  const comments = [];
  const seen = new Set();
  let pageToken;

  do {
    const data = await callApi(
      'commentThreads',
      {
        part: 'snippet',
        videoId,
        maxResults: Math.min(100, limit - comments.length),
        order: order === 'time' ? 'time' : 'relevance',
        textFormat: 'plainText',
        pageToken,
      },
      key,
      env,
    );
    for (const thread of data.items || []) {
      const c = normalizeComment(thread);
      if (!c.text || seen.has(c.id)) continue;
      seen.add(c.id);
      comments.push(c);
      if (comments.length >= limit) break;
    }
    pageToken = data.nextPageToken;
  } while (pageToken && comments.length < limit);

  return comments;
}
