// Pega o <style> de um mockup do Prometeu e devolve o MESMO CSS escopado num wrapper,
// para o React usar as regras originais sem vazar para o resto do hub.
import { readFileSync, writeFileSync } from "node:fs";

const [, , entrada, saida, escopo, nomeConst] = process.argv;

const html = readFileSync(entrada, "utf8");
const css = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));

// Keyframes viram globais no documento: prefixar evita colidir com animação de outra tela.
//
// ⚠️ DEDUPLICAR É OBRIGATÓRIO. O atendente.html declara `@keyframes pulse` DUAS vezes; sem o Set,
// o laço de substituição roda duas passadas sobre o mesmo corpo e produz `pat-pat-pulse` — nome
// que não existe, animação que não roda. Foi assim que o ponto pulsante da chamada em destaque
// ficou parado.
const nomesKeyframes = [
  ...new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])),
];
const prefixo = escopo.replace(/[^\w-]/g, "");

function traduzirSeletor(seletor) {
  return seletor
    .split(",")
    .map((parte) => {
      const s = parte.trim();
      if (!s) return s;
      // As variáveis do mockup moram no :root e no body; aqui passam a morar no wrapper.
      if (s === ":root") return escopo;

      // `body.dark` é o tema do mockup; no hub quem manda é o data-uix-theme do <html>.
      if (s === "body.dark") return `[data-uix-theme="dark"] ${escopo}`;
      if (s.startsWith("body.dark ")) {
        return `[data-uix-theme="dark"] ${escopo} ${s.slice("body.dark ".length)}`;
      }

      // Todo o resto que começa em `body` é ESTADO DA TELA (`body.can-chamar`,
      // `body:not(.x)`, `body[data-posto="salao"]`): o wrapper assume esse papel, então as
      // classes/atributos que o mockup punha no body vão para o wrapper.
      if (s === "body") return escopo;
      if (/^body[.:[\s]/.test(s)) return `${escopo}${s.slice(4)}`;

      return `${escopo} ${s}`;
    })
    .join(", ");
}

// Parser de chaves: separa regra a regra e trata @keyframes (que tem bloco aninhado).
let saidaCss = "";
let i = 0;
while (i < css.length) {
  const abre = css.indexOf("{", i);
  if (abre === -1) break;

  const seletor = css.slice(i, abre).trim();

  // Acha o fecha-chaves correspondente (conta profundidade por causa do @keyframes).
  let profundidade = 1;
  let j = abre + 1;
  while (j < css.length && profundidade > 0) {
    if (css[j] === "{") profundidade += 1;
    else if (css[j] === "}") profundidade -= 1;
    j += 1;
  }

  let corpo = css.slice(abre + 1, j - 1);

  // `animation: pulse ...` tem que apontar para o keyframe já prefixado.
  for (const nome of nomesKeyframes) {
    corpo = corpo.replace(
      new RegExp(`(animation:[^;}]*?)\\b${nome}\\b`, "g"),
      `$1${prefixo}-${nome}`,
    );
  }

  if (seletor.startsWith("@keyframes")) {
    const nome = seletor.replace("@keyframes", "").trim();
    saidaCss += `@keyframes ${prefixo}-${nome}{${corpo}}\n`;
  } else if (seletor.startsWith("@")) {
    saidaCss += `${seletor}{${corpo}}\n`;
  } else {
    const limpo = seletor.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (limpo) saidaCss += `${traduzirSeletor(limpo)}{${corpo}}\n`;
  }

  i = j;
}

const cabecalho = `// GERADO A PARTIR DO MOCKUP APROVADO (${entrada.split(/[\\/]/).pop()}).
//
// É o CSS ORIGINAL do mockup, só escopado em \`${escopo}\` para não vazar no resto do hub e com
// o dark ligado no tema do Panteon (\`data-uix-theme\`) em vez de \`body.dark\`. Não reescreva as
// regras à mão: se o mockup mudar, rode de novo o escopador e substitua este arquivo inteiro.

export const ${nomeConst} = \``;

writeFileSync(
  saida,
  `${cabecalho}${saidaCss.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\`;\n`,
  "utf8",
);

console.log(`${saidaCss.length} chars de CSS escopado em ${escopo}`);
