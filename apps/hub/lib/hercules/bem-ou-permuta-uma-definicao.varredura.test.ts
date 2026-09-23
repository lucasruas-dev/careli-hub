import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// UMA DEFINIÇÃO SÓ DE `BemOuPermuta` (varredura do conjunto, 22/09/2026).
//
// ⚠️ DUAS DECLARAÇÕES VIVAS DO MESMO DADO COMPILAM HOJE E DIVERGEM AMANHÃ. O tipo nasceu em
// `lib/hercules/bens-e-permutas.ts` (a régua, o cronograma, a rota, a proposta, as composições, a
// simulação e o contrato importam de lá) e uma CÓPIA ficou em `proposta-para-pdf.ts`, marcada pelo
// próprio arquivo como *"declarado aqui por ora, e precisa ser reconciliado"*. O TypeScript aceita
// as duas por compatibilidade estrutural: no dia em que um campo mudar de um lado (um `entraComo`
// novo, um `valor` em centavos), o outro segue compilando e a folha do cliente passa a descrever
// uma permuta que a régua não reconhece.
//
// ⚠️ E ISTO NÃO É TYPECHECK. `npm run check-types` passa com as duas declarações — foi assim que
// elas conviveram. Só uma varredura no texto do repositório enxerga a segunda.
//
// Como funciona: procura `type BemOuPermuta =` em todo arquivo `.ts`/`.tsx` de `app/`, `lib/`,
// `modules/` e `components/`, fora de comentário. O único lugar onde ele pode estar é o dono.
const RAIZ = path.resolve(__dirname, "..", "..");
const PASTAS = ["app", "components", "lib", "modules"];
const DONO = path.join("lib", "hercules", "bens-e-permutas.ts");
const DECLARACAO = /^\s*(export\s+)?type\s+BemOuPermuta\s*=/m;

function arquivosDe(pasta: string): string[] {
  const saida: string[] = [];
  const andar = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === "node_modules" || item.name.startsWith(".")) continue;
      const cheio = path.join(dir, item.name);
      if (item.isDirectory()) andar(cheio);
      else if (/\.tsx?$/.test(item.name)) saida.push(cheio);
    }
  };
  const inicio = path.join(RAIZ, pasta);
  if (fs.existsSync(inicio)) andar(inicio);
  return saida;
}

/** O texto sem comentário nenhum: uma nota que CITA o tipo não é uma declaração dele. */
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//"))
    .join("\n");
}

describe("o bem e a permuta têm UM tipo só", () => {
  it("⚠️ ninguém além de bens-e-permutas.ts declara BemOuPermuta", () => {
    const declaram = PASTAS.flatMap(arquivosDe)
      .filter((arquivo) => DECLARACAO.test(semComentarios(fs.readFileSync(arquivo, "utf8"))))
      .map((arquivo) => path.relative(RAIZ, arquivo).split(path.sep).join("/"));

    expect(declaram).toEqual([DONO.split(path.sep).join("/")]);
  });
});
