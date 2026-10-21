/**
 * Interface: coleta de comentários, orquestração das etapas de análise e exibição do relatório.
 * Todo texto vindo do YouTube ou do Gemini é inserido com textContent (nunca como HTML).
 */
import { parseVideoId } from './video-id.js';
import { buildReport, chunk, runPool } from './aggregate.js';
import { topTerms } from './terms.js';
import { reportToCsv, reportToMarkdown } from './export.js';

const CLASSIFY_BATCH = 200;
const CLASSIFY_CONCURRENCY = 3;
const THEMES_COMMENT_CHARS = 400;
const CLASSIFY_COMMENT_CHARS = 600;
const STORAGE_KEY = 'comments-resumer.settings';

const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.NumberFormat('pt-BR');
const SENTIMENT_LABEL = { positivo: 'Positivo', negativo: 'Negativo', neutro: 'Neutro', misto: 'Misto' };

const state = { config: null, settings: loadSettings(), controller: null, last: null };

// ---------------------------------------------------------------------------
// Configurações (chaves ficam apenas no navegador do usuário)
// ---------------------------------------------------------------------------

function loadSettings() {
  const empty = { youtubeKey: '', geminiKey: '', password: '', model: '', remember: true };
  for (const store of [() => localStorage, () => sessionStorage]) {
    try {
      const raw = store().getItem(STORAGE_KEY);
      if (raw) return { ...empty, ...JSON.parse(raw) };
    } catch {
      /* armazenamento indisponível (modo privado, bloqueio de cookies) */
    }
  }
  return empty;
}

function saveSettings(settings) {
  state.settings = settings;
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    (settings.remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* mantém apenas em memória */
  }
  updateSettingsIndicator();
}

function missingKeys() {
  const cfg = state.config || {};
  const s = state.settings;
  const missing = [];
  if (!s.youtubeKey && !cfg.serverYoutubeKey) missing.push('YouTube');
  if (!s.geminiKey && !cfg.serverGeminiKey) missing.push('Gemini');
  const usesServerKey = (!s.youtubeKey && cfg.serverYoutubeKey) || (!s.geminiKey && cfg.serverGeminiKey);
  const needsPassword = cfg.passwordRequired && usesServerKey && !s.password;
  return { missing, needsPassword };
}

function updateSettingsIndicator() {
  const { missing, needsPassword } = missingKeys();
  $('#settings-dot').hidden = !(missing.length || needsPassword);
}

function openSettings() {
  const s = state.settings;
  const cfg = state.config || {};
  $('#youtube-key').value = s.youtubeKey;
  $('#gemini-key').value = s.geminiKey;
  $('#app-password').value = s.password;
  $('#remember').checked = s.remember;
  $('#password-field').hidden = !cfg.passwordRequired;

  const model = s.model || cfg.defaultModel || 'gemini-3.8-flash';
  const select = $('#model');
  if (![...select.options].some((o) => o.value === model)) select.add(new Option(model, model));
  select.value = model;

  const parts = [];
  if (cfg.serverYoutubeKey) parts.push('a chave do YouTube');
  if (cfg.serverGeminiKey) parts.push('a chave do Gemini');
  $('#settings-status').textContent = parts.length
    ? `O servidor já tem ${parts.join(' e ')} configurada(s). Preencha apenas o que quiser substituir.`
    : 'Informe suas chaves para começar. Elas são necessárias para ler os comentários e analisá-los.';

  $('#settings').showModal();
}

function bindSettings() {
  $('#open-settings').addEventListener('click', openSettings);
  $('#settings-form').addEventListener('submit', () => {
    saveSettings({
      youtubeKey: $('#youtube-key').value.trim(),
      geminiKey: $('#gemini-key').value.trim(),
      password: $('#app-password').value,
      model: $('#model').value,
      remember: $('#remember').checked,
    });
  });
  $('#clear-settings').addEventListener('click', () => {
    $('#youtube-key').value = '';
    $('#gemini-key').value = '';
    $('#app-password').value = '';
    saveSettings({ ...state.settings, youtubeKey: '', geminiKey: '', password: '' });
  });
}

// ---------------------------------------------------------------------------
// Comunicação com o servidor
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, body, signal) {
  const s = state.settings;
  const headers = { 'content-type': 'application/json' };
  if (s.youtubeKey) headers['x-youtube-key'] = s.youtubeKey;
  if (s.geminiKey) headers['x-gemini-key'] = s.geminiKey;
  if (s.password) headers['x-app-password'] = s.password;

  let res;
  try {
    res = await fetch(path, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Sem conexão com o servidor. Verifique sua internet e tente novamente.', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const fallback = res.status === 504
      ? 'A análise demorou mais que o permitido. Tente com menos comentários.'
      : `Erro inesperado do servidor (${res.status}).`;
    throw new ApiError(data?.error || fallback, res.status);
  }
  return data;
}

const isRetryable = (err) => err instanceof ApiError && [0, 429, 500, 502, 503, 504].includes(err.status);

async function withRetry(fn, signal) {
  try {
    return await fn();
  } catch (err) {
    if (!isRetryable(err) || signal.aborted) throw err;
    await new Promise((r) => setTimeout(r, 3000));
    return fn();
  }
}

// ---------------------------------------------------------------------------
// Progresso
// ---------------------------------------------------------------------------

function setStep(step, status, detail = '') {
  const li = document.querySelector(`[data-step="${step}"]`);
  li.classList.toggle('active', status === 'active');
  li.classList.toggle('done', status === 'done');
  li.querySelector('.step-detail').textContent = detail;
}

function setProgress(pct) {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  $('#progress-fill').style.width = `${value}%`;
  $('.bar').setAttribute('aria-valuenow', String(value));
}

function resetProgress() {
  for (const step of ['comments', 'themes', 'classify']) setStep(step, 'idle');
  setProgress(0);
}

function showError(message) {
  $('#error-text').textContent = message;
  $('#error-box').hidden = false;
}

function setBusy(busy) {
  $('#submit-btn').disabled = busy;
  $('#submit-btn').textContent = busy ? 'Analisando...' : 'Analisar comentários';
  $('#cancel-btn').hidden = !busy;
  for (const el of document.querySelectorAll('#analyze-form input, #analyze-form select')) el.disabled = busy;
}

// ---------------------------------------------------------------------------
// Fluxo principal
// ---------------------------------------------------------------------------

async function analyze(event) {
  event.preventDefault();
  const input = $('#video-url');
  const urlError = $('#url-error');
  const url = input.value.trim();

  if (!parseVideoId(url)) {
    urlError.textContent = url ? 'Link não reconhecido. Use o endereço de um vídeo do YouTube.' : 'Cole o link do vídeo.';
    urlError.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  urlError.hidden = true;
  input.removeAttribute('aria-invalid');

  const { missing, needsPassword } = missingKeys();
  if (missing.length || needsPassword) {
    openSettings();
    $('#settings-status').textContent = missing.length
      ? `Falta informar a chave: ${missing.join(' e ')}.`
      : 'Informe a senha de acesso para usar as chaves do servidor.';
    return;
  }

  const options = {
    max: $('#max-comments').value === 'all' ? 'all' : Number($('#max-comments').value),
    order: $('#order').value,
    language: $('#language').value,
    model: state.settings.model || state.config?.defaultModel,
  };

  state.controller = new AbortController();
  const { signal } = state.controller;
  $('#error-box').hidden = true;
  $('#results').hidden = true;
  $('#progress').hidden = false;
  resetProgress();
  setBusy(true);

  try {
    // Etapa 1: coleta
    setStep('comments', 'active', options.max === 'all' ? 'todos disponíveis' : `até ${fmt.format(options.max)}`);
    setProgress(3);
    const { video, comments } = await api('/api/comments', { url, max: options.max, order: options.order }, signal);
    setStep('comments', 'done', `${fmt.format(comments.length)} coletados`);
    setProgress(15);

    // Etapa 2: temas
    setStep('themes', 'active');
    const analysis = await withRetry(
      () =>
        api(
          '/api/themes',
          {
            video: { title: video.title, channel: video.channel },
            comments: comments.map((c) => ({ text: c.text.slice(0, THEMES_COMMENT_CHARS), likes: c.likes })),
            language: options.language,
            model: options.model,
          },
          signal,
        ),
      signal,
    );
    setStep('themes', 'done', `${analysis.themes.length} temas`);
    setProgress(40);

    // Etapa 3: classificação em lotes paralelos
    const batches = chunk(
      comments.map((c, i) => ({ i, text: c.text.slice(0, CLASSIFY_COMMENT_CHARS) })),
      CLASSIFY_BATCH,
    );
    const themesForClassify = analysis.themes.map(({ id, title, description }) => ({ id, title, description }));
    let failedComments = 0;
    let missingComments = 0;
    setStep('classify', 'active', `0 de ${batches.length} lotes`);

    const results = await runPool(
      batches.map((items) => async () => {
        try {
          const r = await withRetry(
            () => api('/api/classify', { items, themes: themesForClassify, model: analysis.model }, signal),
            signal,
          );
          missingComments += r.missing || 0;
          return r.assignments;
        } catch (err) {
          if (err.name === 'AbortError' || !isRetryable(err)) throw err;
          failedComments += items.length;
          return [];
        }
      }),
      CLASSIFY_CONCURRENCY,
      (done, total) => {
        setStep('classify', 'active', `${done} de ${total} lotes`);
        setProgress(40 + (done / total) * 58);
      },
    );
    if (failedComments === comments.length) {
      throw new ApiError('O Gemini não conseguiu classificar os comentários. Tente novamente em instantes.', 502);
    }
    setStep('classify', 'done');
    setProgress(100);

    const report = buildReport({ comments, themes: analysis.themes, assignments: results.flat() });
    state.last = { video, analysis, report, comments, options, failedComments, missingComments };
    render(state.last);
    $('#progress').hidden = true;
  } catch (err) {
    if (err.name === 'AbortError') {
      $('#progress').hidden = true;
    } else {
      showError(err.message || 'Erro inesperado.');
      if (err instanceof ApiError && err.status === 401) openSettingsHint();
    }
  } finally {
    setBusy(false);
    state.controller = null;
  }
}

function openSettingsHint() {
  $('#settings-dot').hidden = false;
}

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const plural = (n, one, many) => `${fmt.format(n)} ${n === 1 ? one : many}`;

function quoteItem(c) {
  const li = el('li', '', c.text);
  const meta = [plural(c.likes, 'curtida', 'curtidas')];
  if (c.replies) meta.push(plural(c.replies, 'resposta', 'respostas'));
  if (c.author) meta.push(c.author);
  li.append(el('span', 'quote-meta', meta.join(' · ')));
  return li;
}

function render({ video, analysis, report, comments, options, failedComments, missingComments }) {
  // Vídeo
  const thumb = $('#video-thumb');
  if (video.thumbnail) {
    thumb.src = video.thumbnail;
    thumb.hidden = false;
  } else {
    thumb.hidden = true;
  }
  $('#video-title').textContent = video.title;
  $('#video-meta').textContent = [
    video.channel,
    `${fmt.format(video.views)} visualizações`,
    `${fmt.format(video.commentCount)} comentários no total`,
  ].join(' · ');
  $('#video-link').href = video.url;

  // Números
  const recurring = report.themes.filter((t) => t.id !== 'outros');
  $('#stat-total').textContent = fmt.format(report.total);
  $('#stat-themes').textContent = fmt.format(recurring.length);
  $('#stat-top').textContent = recurring[0] ? `${String(recurring[0].share).replace('.', ',')}%` : '–';

  // Resumo e sentimento
  $('#summary').textContent = analysis.summary || '';
  const share = report.sentiment.share;
  const segs = $('#sentiment-bar').children;
  segs[0].style.width = `${share.positivo}%`;
  segs[1].style.width = `${share.neutro}%`;
  segs[2].style.width = `${share.negativo}%`;
  const legend = $('#sentiment-legend');
  legend.replaceChildren(
    ...['positivo', 'neutro', 'negativo'].map((k) =>
      el('li', `l-${k}`, `${SENTIMENT_LABEL[k]}: ${String(share[k]).replace('.', ',')}% (${fmt.format(report.sentiment.counts[k])})`),
    ),
  );

  // Temas
  const list = $('#themes');
  const template = $('#theme-template');
  const maxCount = Math.max(...report.themes.map((t) => t.count), 1);
  list.replaceChildren(
    ...report.themes.map((theme, idx) => {
      const node = template.content.firstElementChild.cloneNode(true);
      if (theme.id === 'outros') node.classList.add('other');
      node.querySelector('.theme-rank').textContent = theme.id === 'outros' ? '–' : String(idx + 1);
      node.querySelector('.theme-title').textContent = theme.title;
      node.querySelector('.theme-desc').textContent = theme.description;
      node.querySelector('.theme-count strong').textContent = fmt.format(theme.count);
      node.querySelector('.theme-count span').textContent = `${String(theme.share).replace('.', ',')}% dos comentários`;
      node.querySelector('.theme-bar span').style.width = `${(theme.count / maxCount) * 100}%`;

      const meta = node.querySelector('.theme-meta');
      if (theme.id !== 'outros') {
        meta.append(el('span', `chip chip-${theme.sentiment}`, SENTIMENT_LABEL[theme.sentiment] || theme.sentiment));
      }
      meta.append(el('span', '', `${plural(theme.likes, 'curtida somada', 'curtidas somadas')}`));
      const sv = theme.sentiments;
      meta.append(el('span', '', `${sv.positivo} positivos · ${sv.neutro} neutros · ${sv.negativo} negativos`));

      const top = theme.comments.slice(0, 3);
      node.querySelector('.quotes').replaceChildren(...top.map(quoteItem));
      const rest = theme.comments.slice(3);
      const details = node.querySelector('.theme-all');
      if (rest.length) {
        details.querySelector('summary').textContent = `Ver todos os ${fmt.format(theme.count)} comentários`;
        // Os demais comentários só são montados quando o usuário abre a lista.
        details.addEventListener(
          'toggle',
          () => {
            if (details.open && !details.dataset.loaded) {
              details.querySelector('.quotes-all').replaceChildren(...rest.map(quoteItem));
              details.dataset.loaded = '1';
            }
          },
        );
      } else {
        details.hidden = true;
      }
      return node;
    }),
  );

  // Conclusões
  const insights = analysis.insights || [];
  $('#insights-card').hidden = !insights.length;
  $('#insights').replaceChildren(...insights.map((t) => el('li', '', t)));

  // Termos
  const terms = topTerms(comments, 24);
  $('#terms').replaceChildren(
    ...(terms.length
      ? terms.map((t) => {
          const li = el('li', '', t.term);
          li.append(el('b', '', fmt.format(t.count)));
          return li;
        })
      : [el('li', '', 'Poucos comentários para identificar termos repetidos.')]),
  );

  // Nota de rodapé
  const notes = [
    `Análise feita com ${analysis.model} sobre os ${fmt.format(report.total)} comentários ${options.order === 'time' ? 'mais recentes' : 'mais relevantes'} (respostas não incluídas).`,
  ];
  if (missingComments) notes.push(`${fmt.format(missingComments)} comentários não receberam tema do Gemini e foram contados em "Outros assuntos".`);
  if (failedComments) notes.push(`${fmt.format(failedComments)} comentários não puderam ser classificados por instabilidade do Gemini e aparecem em "Outros assuntos".`);
  $('#footnote').textContent = notes.join(' ');

  $('#results').hidden = false;
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

function slug(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50).toLowerCase() || 'video';
}

function download(content, filename, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function bindExport() {
  $('#download-csv').addEventListener('click', () => {
    const { video, report } = state.last;
    download(reportToCsv(report), `comentarios-${slug(video.title)}.csv`, 'text/csv;charset=utf-8');
  });
  $('#download-json').addEventListener('click', () => {
    const { video, analysis, report, options } = state.last;
    const data = { generatedAt: new Date().toISOString(), options, video, summary: analysis.summary, insights: analysis.insights, model: analysis.model, report };
    download(JSON.stringify(data, null, 2), `analise-${slug(video.title)}.json`, 'application/json');
  });
  $('#copy-md').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    const md = reportToMarkdown(state.last);
    try {
      await navigator.clipboard.writeText(md);
      button.textContent = 'Copiado!';
    } catch {
      download(md, `resumo-${slug(state.last.video.title)}.md`, 'text/markdown');
      button.textContent = 'Resumo baixado';
    }
    setTimeout(() => (button.textContent = 'Copiar resumo'), 2000);
  });
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

async function init() {
  bindSettings();
  bindExport();
  $('#analyze-form').addEventListener('submit', analyze);
  $('#cancel-btn').addEventListener('click', () => state.controller?.abort());
  $('#video-url').addEventListener('input', () => {
    $('#url-error').hidden = true;
    $('#video-url').removeAttribute('aria-invalid');
  });

  const fromQuery = new URLSearchParams(location.search).get('v');
  if (fromQuery) $('#video-url').value = fromQuery.length === 11 ? `https://www.youtube.com/watch?v=${fromQuery}` : fromQuery;

  try {
    state.config = await api('/api/config');
  } catch {
    state.config = { serverYoutubeKey: false, serverGeminiKey: false, passwordRequired: false };
  }
  updateSettingsIndicator();
}

init();
