/**
 * Verificação rápida de sintaxe de todos os arquivos JavaScript do projeto (sem dependências externas).
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const dirs = ['api', 'lib', 'public/js', 'scripts', 'test'];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) files.push(p);
  }
};
dirs.forEach(walk);

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`Erro de sintaxe em ${f}:\n${err.stderr}`);
  }
}
console.log(`${files.length - failed}/${files.length} arquivos sem erros de sintaxe.`);
process.exit(failed ? 1 : 0);
