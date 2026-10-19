import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topTerms, tokenize } from '../public/js/terms.js';

test('tokenize ignora números, risadas e palavras curtas', () => {
  assert.deepEqual(tokenize('KKKK muito bom 2026 o vídeo, hahaha parabéns!'), ['muito', 'bom', 'vídeo', 'parabéns']);
});

test('topTerms conta em quantos comentários cada termo aparece', () => {
  const comments = [
    { text: 'Quero a parte dois! parte dois!' },
    { text: 'faz a parte dois logo' },
    { text: 'Parte dois quando?' },
    { text: 'O áudio está baixo' },
    { text: 'audio ruim' },
    { text: 'nada a ver' },
  ];
  const terms = topTerms(comments, 10);
  const map = Object.fromEntries(terms.map((t) => [t.term.toLowerCase(), t.count]));
  assert.equal(map['parte dois'], 3, 'cada comentário conta uma vez');
  assert.equal(map['áudio'], 2, 'variações com e sem acento são agrupadas');
  assert.ok(!('parte' in map), 'palavra contida em par com mesma contagem é omitida');
  assert.ok(!('que' in map) && !('nada' in map), 'stopwords removidas');
});

test('topTerms retorna lista vazia sem repetições', () => {
  assert.deepEqual(topTerms([{ text: 'um único comentário' }]), []);
});
