import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../public/js/aggregate.js';
import { reportToCsv, reportToMarkdown } from '../public/js/export.js';

const comments = [
  { text: 'Ótimo; "excelente"\nvídeo', likes: 3, author: 'Ana', publishedAt: '2026-02-03T10:00:00Z', replies: 2 },
  { text: '=HYPERLINK("http://x")', likes: 1, author: 'Bia' },
];
const themes = [{ id: 't1', title: 'Elogios', description: 'Gostaram.', sentiment: 'positivo' }];
const report = buildReport({ comments, themes, assignments: [{ i: 0, t: 't1', s: 'positivo' }, { i: 1, t: 'outros', s: 'neutro' }] });

test('CSV escapa separadores, aspas e quebras de linha e neutraliza fórmulas', () => {
  const csv = reportToCsv(report);
  assert.ok(csv.startsWith('﻿tema;sentimento;curtidas'));
  assert.ok(csv.includes('Elogios;positivo;3;2;Ana;2026-02-03;"Ótimo; ""excelente""\nvídeo"'));
  assert.ok(csv.includes(`;"'=HYPERLINK(""http://x"")"`), 'fórmula prefixada com apóstrofo');
});

test('Markdown inclui resumo, temas e conclusões', () => {
  const md = reportToMarkdown({
    video: { title: 'Meu vídeo', channel: 'Canal', url: 'https://youtu.be/x' },
    analysis: { summary: 'Resumo aqui.', insights: ['Fazer X'] },
    report,
  });
  assert.match(md, /^# Análise de comentários: Meu vídeo/);
  assert.match(md, /### 1\. Elogios — 1 comentários \(50%\)/);
  assert.match(md, /> Ótimo/);
  assert.match(md, /## Conclusões e oportunidades\n\n- Fazer X/);
});
