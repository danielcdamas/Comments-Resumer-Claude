/**
 * Geração dos arquivos de exportação (CSV e Markdown). Módulo puro, sem DOM.
 */

function csvCell(value) {
  const s = String(value ?? '');
  // Prefixo evita que planilhas interpretem o conteúdo como fórmula.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",;\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV com todos os comentários e o tema atribuído (separador ";" para Excel em português). */
export function reportToCsv(report) {
  const header = ['tema', 'sentimento', 'curtidas', 'respostas', 'autor', 'data', 'comentario'];
  const rows = [header.join(';')];
  for (const theme of report.themes) {
    for (const c of theme.comments) {
      rows.push(
        [theme.title, c.sentiment, c.likes, c.replies ?? 0, c.author ?? '', (c.publishedAt || '').slice(0, 10), c.text]
          .map(csvCell)
          .join(';'),
      );
    }
  }
  // BOM garante que o Excel reconheça os acentos (UTF-8).
  return `﻿${rows.join('\r\n')}\r\n`;
}

/** Resumo em Markdown, pronto para colar em documentos ou mensagens. */
export function reportToMarkdown({ video, analysis, report }, examplesPerTheme = 3) {
  const lines = [];
  lines.push(`# Análise de comentários: ${video.title}`);
  lines.push('');
  lines.push(`Canal: ${video.channel} | ${video.url}`);
  lines.push(`Comentários analisados: ${report.total}`);
  const s = report.sentiment.share;
  lines.push(`Sentimento: ${s.positivo}% positivo, ${s.neutro}% neutro, ${s.negativo}% negativo`);
  lines.push('');
  if (analysis.summary) {
    lines.push('## Resumo', '', analysis.summary, '');
  }
  lines.push('## Temas mais recorrentes', '');
  report.themes.forEach((t, idx) => {
    lines.push(`### ${idx + 1}. ${t.title} — ${t.count} comentários (${t.share}%)`);
    if (t.description) lines.push('', t.description);
    const examples = t.comments.slice(0, examplesPerTheme);
    if (examples.length) {
      lines.push('');
      for (const c of examples) lines.push(`> ${c.text.slice(0, 300)} (${c.likes} curtidas)`, '>');
      lines.pop();
    }
    lines.push('');
  });
  if (analysis.insights?.length) {
    lines.push('## Conclusões e oportunidades', '');
    for (const i of analysis.insights) lines.push(`- ${i}`);
    lines.push('');
  }
  return lines.join('\n');
}
