/**
 * Reconhecimento de links do YouTube. Compartilhado entre o navegador e o servidor.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extrai o ID do vídeo de praticamente qualquer formato de link do YouTube
 * (watch, youtu.be, shorts, live, embed, m.youtube, music.youtube) ou do próprio ID.
 * Retorna null se não reconhecer.
 */
export function parseVideoId(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (VIDEO_ID.test(value)) return value;

  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1];
    return VIDEO_ID.test(id || '') ? id : null;
  }
  if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;

  const v = url.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return v;

  const match = url.pathname.match(/^\/(?:shorts|live|embed|v|e)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/);
  return match ? match[1] : null;
}

