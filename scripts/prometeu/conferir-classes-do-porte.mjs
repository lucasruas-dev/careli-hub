// Confere se toda classe usada no JSX portado existe no CSS do mockup. Classe inventada = peça
// sem estilo, que é exatamente o tipo de erro que o typecheck não pega.
import { readFileSync } from "node:fs";

const [, , tsx, css, escopo, ajustes] = process.argv;

const fonte = readFileSync(tsx, "utf8");
const estilo = readFileSync(css, "utf8") + (ajustes ? readFileSync(ajustes, "utf8") : "");

// Classes declaradas no CSS.
const declaradas = new Set(
  [...estilo.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]),
);

// Classes usadas no JSX: className="..." e className={`...`} (pegando os literais).
const usadas = new Set();
for (const trecho of fonte.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
  const cru = (trecho[1] ?? trecho[2] ?? "")
    // tira as interpolações ${...}: o que sobra são os literais
    .replace(/\$\{[^}]*\}/g, " ");
  for (const classe of cru.split(/\s+/)) {
    if (classe && /^[a-zA-Z][\w-]*$/.test(classe)) usadas.add(classe);
  }
}
// className={cond ? "a" : "b"} e strings soltas dentro de expressões
for (const trecho of fonte.matchAll(/className=\{[^}]*\}/g)) {
  for (const literal of trecho[0].matchAll(/"([^"]*)"/g)) {
    for (const classe of literal[1].split(/\s+/)) {
      if (classe && /^[a-zA-Z][\w-]*$/.test(classe)) usadas.add(classe);
    }
  }
}

const orfas = [...usadas].filter((c) => !declaradas.has(c) && c !== escopo.replace(".", ""));

console.log(`usadas: ${usadas.size} · declaradas no CSS: ${declaradas.size}`);
console.log(orfas.length ? `SEM ESTILO: ${orfas.join(", ")}` : "todas as classes têm estilo");
