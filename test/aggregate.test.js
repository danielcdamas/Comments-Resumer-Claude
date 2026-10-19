import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, chunk, runPool } from '../public/js/aggregate.js';

const themes = [
  { id: 't1', title: 'A', description: '', sentiment: 'positivo' },
  { id: 't2', title: 'B', description: '', sentiment: 'negativo' },
  { id: 't3', title: 'C (sem comentários)', description: '', sentiment: 'neutro' },
];

test('conta comentários por tema, calcula percentuais e ordena', () => {
  const comments = [
    { text: 'a1', likes: 1 },
    { text: 'b1', likes: 50 },
    { text: 'b2', likes: 5 },
    { text: 'x', likes: 0 },
    { text: 'a2', likes: 10 },
    { text: 'b3', likes: 0 },
  ];
  const assignments = [
    { i: 0, t: 't1', s: 'positivo' },
    { i: 1, t: 't2', s: 'negativo' },
    { i: 2, t: 't2', s: 'negativo' },
    { i: 3, t: 'outros', s: 'neutro' },
    { i: 4, t: 't1', s: 'positivo' },
    { i: 5, t: 't2', s: 'neutro' },
  ];
  const report = buildReport({ comments, themes, assignments });

  assert.equal(report.total, 6);
  assert.deepEqual(report.themes.map((t) => [t.id, t.count]), [['t2', 3], ['t1', 2], ['outros', 1]]);
  assert.equal(report.themes[0].share, 50);
  assert.equal(report.themes[0].likes, 55);
  assert.deepEqual(report.themes[0].comments.map((c) => c.text), ['b1', 'b2', 'b3'], 'ordenados por curtidas');
  assert.deepEqual(report.themes[0].sentiments, { positivo: 0, negativo: 2, neutro: 1 });
  assert.deepEqual(report.sentiment.counts, { positivo: 2, negativo: 2, neutro: 2 });
  assert.equal(report.sentiment.share.positivo, 33.3);
  assert.ok(!report.themes.some((t) => t.id === 't3'), 'temas vazios são omitidos');
});

test('comentários sem classificação, com tema desconhecido ou índice duplicado caem em "Outros"', () => {
  const comments = [{ text: 'a', likes: 0 }, { text: 'b', likes: 0 }, { text: 'c', likes: 0 }];
  const assignments = [
    { i: 0, t: 't1', s: 'positivo' },
    { i: 0, t: 't2', s: 'negativo' },
    { i: 1, t: 'inventado', s: 'qualquer' },
    { i: 99, t: 't1', s: 'positivo' },
  ];
  const report = buildReport({ comments, themes, assignments });
  const byId = Object.fromEntries(report.themes.map((t) => [t.id, t]));
  assert.equal(byId.t1.count, 1);
  assert.equal(byId.outros.count, 2);
  assert.equal(report.themes.reduce((n, t) => n + t.count, 0), 3, 'soma igual ao total');
  assert.equal(report.themes.at(-1).id, 'outros', '"Outros" sempre por último');
});

test('"Outros" fica por último mesmo sendo o maior grupo', () => {
  const comments = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
  const report = buildReport({ comments, themes, assignments: [{ i: 0, t: 't1', s: 'neutro' }] });
  assert.deepEqual(report.themes.map((t) => t.id), ['t1', 'outros']);
});

test('chunk divide em lotes', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

test('runPool respeita a concorrência e preserva a ordem', async () => {
  let running = 0;
  let peak = 0;
  const progress = [];
  const tasks = [30, 5, 20, 1, 10].map((ms, i) => async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    return i;
  });
  const out = await runPool(tasks, 2, (done, total) => progress.push(`${done}/${total}`));
  assert.deepEqual(out, [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
  assert.equal(progress.at(-1), '5/5');
});
