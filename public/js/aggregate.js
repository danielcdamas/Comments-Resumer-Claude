/**
 * Consolida a classificação do Gemini em um relatório com contagens exatas.
 * Módulo puro (sem DOM), usado pelo navegador e pelos testes automatizados.
 */

export const OTHER_THEME_ID = 'outros';
export const OTHER_THEME = {
  id: OTHER_THEME_ID,
  title: 'Outros assuntos',
  description: 'Comentários que não se encaixam em nenhum dos temas recorrentes.',
  sentiment: 'misto',
};

const emptySentiment = () => ({ positivo: 0, negativo: 0, neutro: 0 });

const pct = (part, total) => (total ? Math.round((part / total) * 1000) / 10 : 0);

/**
 * @param {object} p
 * @param {Array<{text:string, likes:number}>} p.comments  Comentários na ordem original (índice = posição).
 * @param {Array<{id:string,title:string,description:string,sentiment:string}>} p.themes
 * @param {Array<{i:number,t:string,s:string}>} p.assignments
 */
export function buildReport({ comments, themes, assignments }) {
  const byIndex = new Map();
  for (const a of assignments || []) {
    if (Number.isInteger(a?.i) && a.i >= 0 && a.i < comments.length && !byIndex.has(a.i)) byIndex.set(a.i, a);
  }

  const allThemes = [...themes, OTHER_THEME];
  const groups = new Map(
    allThemes.map((t) => [t.id, { ...t, count: 0, likes: 0, sentiments: emptySentiment(), comments: [] }]),
  );
  const overall = emptySentiment();

  comments.forEach((comment, i) => {
    const a = byIndex.get(i) || { t: OTHER_THEME_ID, s: 'neutro' };
    const group = groups.get(a.t) || groups.get(OTHER_THEME_ID);
    const sentiment = a.s in overall ? a.s : 'neutro';
    group.count += 1;
    group.likes += Number(comment.likes) || 0;
    group.sentiments[sentiment] += 1;
    overall[sentiment] += 1;
    group.comments.push({ ...comment, index: i, theme: group.id, sentiment });
  });

  const total = comments.length;
  const ranked = [...groups.values()]
    .filter((g) => g.count > 0)
    .map((g) => ({
      ...g,
      share: pct(g.count, total),
      comments: g.comments.sort((x, y) => (y.likes || 0) - (x.likes || 0)),
    }))
    // "Outros" sempre por último; os demais pelo número de comentários e, no empate, pelas curtidas.
    .sort((x, y) => {
      if (x.id === OTHER_THEME_ID) return 1;
      if (y.id === OTHER_THEME_ID) return -1;
      return y.count - x.count || y.likes - x.likes;
    });

  return {
    total,
    themes: ranked,
    sentiment: {
      counts: overall,
      share: {
        positivo: pct(overall.positivo, total),
        negativo: pct(overall.negativo, total),
        neutro: pct(overall.neutro, total),
      },
    },
  };
}

/** Divide uma lista em lotes de tamanho fixo. */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Executa tarefas assíncronas com concorrência limitada, preservando a ordem dos resultados.
 * onProgress(concluidas, total) é chamado a cada tarefa finalizada.
 */
export async function runPool(tasks, concurrency, onProgress) {
  const results = new Array(tasks.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
      done += 1;
      if (onProgress) onProgress(done, tasks.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}
