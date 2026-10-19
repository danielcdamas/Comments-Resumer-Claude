/**
 * Utilitários HTTP compartilhados pelas funções serverless (formato Web: Request -> Response).
 */

/** Erro com status HTTP e mensagem pronta para exibir ao usuário. */
export class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/** Lê e valida o corpo JSON da requisição, com limite de tamanho. */
export async function readJson(request, maxBytes = 4_000_000) {
  const raw = await request.text();
  if (raw.length > maxBytes) {
    throw new HttpError(413, 'A requisição é grande demais. Reduza a quantidade de comentários.', 'payload_too_large');
  }
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data;
  } catch {
    throw new HttpError(400, 'Corpo da requisição inválido (JSON esperado).', 'invalid_json');
  }
}

/**
 * Envolve um handler: converte HttpError em resposta JSON e esconde erros inesperados.
 */
export function handle(fn) {
  return async (request) => {
    try {
      return await fn(request);
    } catch (err) {
      if (err instanceof HttpError) {
        return json({ error: err.message, code: err.code }, err.status);
      }
      console.error('Unexpected error:', err);
      return json({ error: 'Erro interno inesperado. Tente novamente em instantes.', code: 'internal' }, 500);
    }
  };
}

/** fetch com tempo limite. */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new HttpError(504, 'O serviço externo demorou demais para responder. Tente novamente.', 'upstream_timeout');
    }
    throw new HttpError(502, 'Falha de conexão com o serviço externo. Tente novamente.', 'upstream_unreachable');
  } finally {
    clearTimeout(timer);
  }
}
