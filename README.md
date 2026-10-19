# Resumo de Comentários do YouTube

Ferramenta web que lê os comentários de qualquer vídeo do YouTube e mostra **quais assuntos aparecem com mais frequência**, agrupados por tema, com contagem exata, percentual, sentimento e exemplos reais de cada tema.

## Como funciona

1. **Coleta** — a YouTube Data API v3 devolve até 3.000 comentários de primeiro nível (os mais relevantes ou os mais recentes).
2. **Descoberta de temas** — o Gemini lê os comentários e propõe de 4 a 12 temas recorrentes, um resumo geral e conclusões práticas.
3. **Classificação** — em lotes de 200, em paralelo, o Gemini classifica cada comentário em um tema (ou em "Outros assuntos") e indica o sentimento.
4. **Consolidação** — o próprio código conta os comentários por tema. Os números não são estimativas do modelo: cada comentário é rastreável até o tema em que foi contado.

Também mostra os **termos mais citados** (contagem direta de palavras, sem IA) e permite exportar o relatório em **CSV** (abre no Excel), **JSON** ou copiar um **resumo em Markdown**.

## Chaves necessárias

| Chave | Onde obter | Custo |
|---|---|---|
| Gemini | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Conforme o plano do Gemini. Uma análise de 500 comentários usa da ordem de 100 mil tokens. |
| YouTube Data API v3 | [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com): ative a API no projeto e crie uma chave em "Credenciais" | Gratuita: 10.000 unidades/dia; cada 100 comentários custam 1 unidade. |

A mesma chave pode servir para os dois serviços se a YouTube Data API v3 for ativada no projeto Google Cloud da chave do Gemini e a chave não tiver restrições que bloqueiem essa API.

Há duas formas de informar as chaves:

- **Na tela** (botão "Configurações"): ficam salvas apenas no navegador de quem usa e são repassadas ao Google a cada análise, sem armazenamento no servidor.
- **No servidor** (variáveis de ambiente na Vercel): qualquer pessoa com o link usa a ferramenta sem informar chaves. Defina `APP_PASSWORD` para que só quem sabe a senha consuma a sua cota.

## Variáveis de ambiente (todas opcionais)

| Variável | Função |
|---|---|
| `YOUTUBE_API_KEY` | Chave da YouTube Data API usada quando o usuário não informa a dele. |
| `GEMINI_API_KEY` | Chave do Gemini usada quando o usuário não informa a dele. |
| `GEMINI_MODEL` | Modelo padrão (padrão: `gemini-3.8-flash`). |
| `APP_PASSWORD` | Exige esta senha para usar as chaves do servidor. |

Na Vercel: *Project → Settings → Environment Variables*. Depois de alterar, faça um novo deploy (*Deployments → ⋯ → Redeploy*).

## Estrutura

```
api/            Funções serverless (Vercel): config, comments, themes, classify
lib/            Regras de servidor: YouTube, Gemini, chaves, validação, HTTP
public/         Site estático (HTML, CSS e módulos JS do navegador)
  js/aggregate.js  Consolidação e contagem dos temas (compartilhado com os testes)
  js/terms.js      Termos mais citados (sem IA)
  js/export.js     CSV e Markdown
  js/video-id.js   Reconhecimento de links do YouTube (usado no navegador e no servidor)
scripts/        Servidor local e verificação de sintaxe
test/           Testes unitários, de integração e de navegador (com APIs do Google simuladas)
```

Sem dependências externas em produção: apenas Node.js 22+.

## Desenvolvimento local

```bash
cp .env.example .env      # opcional: preencha as chaves
npm run dev               # http://localhost:3000
npm run check             # sintaxe de todos os arquivos
npm test                  # testes unitários e de integração (sem rede)
NODE_PATH="$(npm root -g)" npm run test:e2e   # navegador desktop + celular (requer Playwright)
```

## Segurança e limites

- Chaves nunca são devolvidas ao navegador nem registradas em log; a chave do Gemini viaja no cabeçalho `x-goog-api-key`.
- Os comentários são enviados ao modelo delimitados e com instrução explícita para não seguir comandos contidos neles.
- Todo texto de comentários e do modelo é exibido como texto puro (sem HTML), com Content-Security-Policy restritiva.
- Entradas do navegador são validadas e limitadas (quantidade, tamanho, formato do modelo e dos IDs).
- Respostas aos comentários não são incluídas na análise, apenas os comentários de primeiro nível.
- Vídeos com comentários desativados, privados ou inexistentes geram mensagens explicativas.
