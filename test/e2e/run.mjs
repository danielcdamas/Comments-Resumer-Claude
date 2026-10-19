/**
 * Teste de ponta a ponta no navegador (Chromium via Playwright), em desktop e celular.
 * Usa as APIs do Google simuladas, então não consome cota nem exige chaves reais.
 *
 * Uso: NODE_PATH="$(npm root -g)" node test/e2e/run.mjs [pasta-para-capturas]
 * (requer o pacote "playwright" instalado globalmente ou no projeto)
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { startMockGoogle } from '../helpers/mock-google.js';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const root = resolve(new URL('../..', import.meta.url).pathname);
const shots = resolve(process.argv[2] || join(root, 'test-results'));
mkdirSync(shots, { recursive: true });
const PORT = 3107;
const BASE = `http://127.0.0.1:${PORT}`;

const mock = await startMockGoogle({ commentsPerVideo: 450, failClassifyTimes: 1 });
const server = spawn(process.execPath, [join(root, 'scripts/dev-server.js')], {
  env: { ...process.env, PORT: String(PORT), YOUTUBE_API_BASE: mock.youtubeBase, GEMINI_API_BASE: mock.geminiBase },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((r) => server.stdout.once('data', r));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const results = [];

async function scenario(name, contextOptions, fn) {
  const context = await browser.newContext({ ...contextOptions, acceptDownloads: true });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => {
    // Respostas de erro esperadas da API aparecem como "Failed to load resource"; não são falhas do app.
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  try {
    await fn(page);
    assert.deepEqual(problems, [], `erros no console em "${name}"`);
    results.push(`OK   ${name}`);
  } catch (err) {
    results.push(`FAIL ${name}: ${err.message}`);
    await page.screenshot({ path: join(shots, `falha-${name.replace(/\W+/g, '-')}.png`), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function fullFlow(page, label) {
  await page.goto(BASE);
  await page.waitForFunction(() => document.querySelector('#settings-dot') && !document.querySelector('#settings-dot').hidden);

  // Link inválido
  await page.fill('#video-url', 'https://vimeo.com/123');
  await page.click('#submit-btn');
  await page.waitForSelector('#url-error:not([hidden])');
  assert.match(await page.textContent('#url-error'), /não reconhecido/);
  await page.screenshot({ path: join(shots, `${label}-1-inicio.png`), fullPage: true });

  // Sem chaves: abre configurações
  await page.fill('#video-url', 'https://www.youtube.com/watch?v=abcdefghijk');
  await page.selectOption('#max-comments', '500');
  await page.click('#submit-btn');
  await page.waitForSelector('dialog#settings[open]');
  assert.match(await page.textContent('#settings-status'), /Falta informar a chave: YouTube e Gemini/);
  await page.fill('#youtube-key', 'AIzaUSERYTKEYxxxxxxxxxxxxxxxxxx');
  await page.fill('#gemini-key', 'AIzaUSERGEMKEYxxxxxxxxxxxxxxxxx');
  await page.screenshot({ path: join(shots, `${label}-2-configuracoes.png`) });
  await page.click('#settings-form button[type="submit"]');
  await page.waitForSelector('dialog#settings:not([open])', { state: 'attached' });
  assert.equal(await page.isHidden('#settings-dot'), true);

  // Análise completa (com uma falha temporária simulada do Gemini, que deve ser repetida)
  await page.click('#submit-btn');
  await page.waitForSelector('#progress:not([hidden])');
  await page.waitForSelector('#results:not([hidden])', { timeout: 30_000 });
  assert.equal(await page.isHidden('#error-box'), true, 'sem mensagem de erro');

  assert.equal(await page.textContent('#stat-total'), '450');
  assert.equal(await page.textContent('#stat-themes'), '3');
  const titles = await page.$$eval('.theme-title', (els) => els.map((e) => e.textContent));
  assert.deepEqual(titles, ['Elogios à edição', 'Pedidos de parte 2', 'Reclamações do áudio', 'Outros assuntos']);
  const counts = await page.$$eval('.theme-count strong', (els) => els.map((e) => Number(e.textContent.replace(/\D/g, ''))));
  assert.equal(counts.reduce((a, b) => a + b, 0), 450, 'soma dos temas igual ao total');
  assert.deepEqual(counts, [129, 129, 128, 64]);
  assert.match(await page.textContent('#footnote'), /gemini-3\.8-flash/);
  assert.ok((await page.$$('#terms li')).length > 3, 'termos frequentes exibidos');
  assert.equal((await page.$$('#insights li')).length, 2);

  // "Ver todos" carrega a lista sob demanda
  await page.click('.theme:first-child .theme-all summary');
  await page.waitForSelector('.theme:first-child .quotes-all li');
  assert.equal((await page.$$('.theme:first-child .quotes-all li')).length, 126);

  // Exportações
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download-csv')]);
  const csvPath = join(shots, `${label}.csv`);
  await download.saveAs(csvPath);
  const csv = readFileSync(csvPath, 'utf8');
  assert.equal(csv.trim().split('\r\n').length, 451, 'CSV com cabeçalho + 450 linhas');
  await page.click('#copy-md');
  await page.waitForFunction(() => document.querySelector('#copy-md').textContent === 'Copiado!');
  const md = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(md, /### 1\. Elogios à edição — 129 comentários/);

  // Sem rolagem horizontal
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `rolagem horizontal de ${overflow}px`);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(shots, `${label}-3-resultado.png`), fullPage: true });
}

await scenario('desktop - fluxo completo', { viewport: { width: 1280, height: 900 } }, (p) => fullFlow(p, 'desktop'));
await scenario('celular - fluxo completo', { ...devices['iPhone 13'], browserName: undefined }, (p) => fullFlow(p, 'celular'));

await scenario('erro: comentários desativados', { viewport: { width: 1280, height: 900 } }, async (page) => {
  await page.goto(BASE);
  await page.evaluate(() =>
    localStorage.setItem('comments-resumer.settings', JSON.stringify({ youtubeKey: 'AIzaUSERYTKEYxxxxxxxxxxxxxxxxxx', geminiKey: 'AIzaUSERGEMKEYxxxxxxxxxxxxxxxxx', remember: true })),
  );
  await page.goto(`${BASE}/?v=disabled000`);
  assert.equal(await page.inputValue('#video-url'), 'https://www.youtube.com/watch?v=disabled000');
  await page.click('#submit-btn');
  await page.waitForSelector('#error-box:not([hidden])');
  assert.match(await page.textContent('#error-text'), /desativados/);
  assert.equal(await page.isEnabled('#submit-btn'), true, 'botão liberado após erro');
  await page.screenshot({ path: join(shots, 'erro-comentarios-desativados.png') });
});

await scenario('erro: chave inválida', { viewport: { width: 1280, height: 900 } }, async (page) => {
  await page.goto(BASE);
  await page.evaluate(() =>
    localStorage.setItem('comments-resumer.settings', JSON.stringify({ youtubeKey: 'AIzaINVALIDKEYxxxxxxxxxxxxxxxx', geminiKey: 'AIzaUSERGEMKEYxxxxxxxxxxxxxxxxx', remember: true })),
  );
  await page.goto(`${BASE}/?v=abcdefghijk`);
  await page.click('#submit-btn');
  await page.waitForSelector('#error-box:not([hidden])');
  assert.match(await page.textContent('#error-text'), /chave da YouTube Data API é inválida/);
});

await browser.close();
server.kill();
await mock.close();

console.log(results.join('\n'));
console.log(`Capturas em: ${shots}`);
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
