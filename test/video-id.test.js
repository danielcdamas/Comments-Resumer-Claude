import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoId } from '../public/js/video-id.js';

const ID = 'dQw4w9WgXcQ';

test('reconhece os formatos de link do YouTube', () => {
  const valid = [
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s&list=PL123`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `youtube.com/watch?feature=share&v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `  https://youtu.be/${ID}  `,
  ];
  for (const input of valid) assert.equal(parseVideoId(input), ID, input);
});

test('rejeita entradas inválidas', () => {
  const invalid = [
    '',
    null,
    undefined,
    123,
    'abc',
    'https://vimeo.com/123456789',
    `https://evil.com/watch?v=${ID}`,
    `https://youtube.com.evil.com/watch?v=${ID}`,
    'https://www.youtube.com/watch?v=curto',
    'https://www.youtube.com/@canal',
    'https://youtu.be/',
    'javascript:alert(1)',
  ];
  for (const input of invalid) assert.equal(parseVideoId(input), null, String(input));
});
