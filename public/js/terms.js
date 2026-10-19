/**
 * Contagem local das palavras e expressões mais frequentes (não usa IA).
 * Complementa a análise do Gemini com um indicador objetivo e instantâneo.
 */

const STOPWORDS = new Set(
  `a à às ao aos as o os um uma uns umas de da das do dos dum duma em na nas no nos num numa por pra pro pras pros para pelo pela pelos pelas
  e é ou mas se que quem qual quais quando onde como porque porquê pq q já ja não nao sim muito muita muitos muitas mais menos bem mal
  eu tu ele ela nós nos vós eles elas você voce vocês voces vc vcs me te lhe nos vos se meu minha meus minhas seu sua seus suas teu tua
  nosso nossa isso isto aquilo esse essa esses essas este esta estes estas aquele aquela ai aí lá la aqui ali então entao tb tbm também tambem
  ser sou é era foi são sao está esta estou estão estao tá ta tô to ter tem têm tenho tinha ter vai vou vamos ir fazer faz fez fiz pode posso
  só so até ate sobre entre depois antes ainda agora sempre nunca nada tudo todo toda todos todas cada outro outra outros outras mesmo mesma
  tão tao assim aqui coisa coisas gente ne né kkk kkkk kkkkk rs haha hahaha vídeo video vídeos videos canal
  the a an and or but if of to in on at for with from by is are was were be been being it its this that these those i you he she we they
  me my your his her our their not no yes do does did have has had will would can could just so very really what who how why when where
  el la los las un una unos unas y o pero de del en con por para es son fue ser lo le les se que como muy más mas yo tu él ella`
    .split(/\s+/)
    .filter(Boolean),
);

/** Normaliza para comparação: minúsculas e sem acentos. */
export function normalizeWord(w) {
  return w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const NORMALIZED_STOPWORDS = new Set([...STOPWORDS].map(normalizeWord));

export function tokenize(text) {
  return (String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) || [])
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !/^(k|h|a|ha|rs)+$/i.test(w));
}

/**
 * Retorna os termos (palavras e pares de palavras) citados no maior número de comentários.
 * Cada comentário conta no máximo uma vez por termo.
 */
export function topTerms(comments, limit = 20) {
  const counts = new Map();
  const display = new Map();

  for (const c of comments) {
    const words = tokenize(c.text);
    const keep = words.filter((w) => !NORMALIZED_STOPWORDS.has(normalizeWord(w)));
    const seen = new Set();

    const add = (key, label) => {
      if (seen.has(key)) return;
      seen.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!display.has(key)) display.set(key, label);
    };

    for (const w of keep) add(normalizeWord(w), w);
    for (let i = 0; i < words.length - 1; i++) {
      const [w1, w2] = [words[i], words[i + 1]];
      if (NORMALIZED_STOPWORDS.has(normalizeWord(w1)) || NORMALIZED_STOPWORDS.has(normalizeWord(w2))) continue;
      add(`${normalizeWord(w1)} ${normalizeWord(w2)}`, `${w1} ${w2}`);
    }
  }

  const minCount = comments.length >= 50 ? 3 : 2;
  const ranked = [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1] || b[0].includes(' ') - a[0].includes(' '));

  // Remove palavras isoladas que só aparecem dentro de um par já listado com contagem igual.
  const result = [];
  for (const [key, count] of ranked) {
    if (!key.includes(' ') && result.some((r) => r.key.includes(' ') && r.key.split(' ').includes(key) && r.count === count)) {
      continue;
    }
    result.push({ key, term: display.get(key), count });
    if (result.length >= limit) break;
  }
  return result.map(({ term, count }) => ({ term, count }));
}
