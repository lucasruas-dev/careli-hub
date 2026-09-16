import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// NENHUM ARQUIVO "use client" PODE ALCANÇAR O MYSQL2 (revisão do conjunto do portal, 16/09/2026).
//
// Por que existe: a tela de Produtos do portal (ProdutosDoHercules) trocou um `import type` de
// lib/apolo/incorporador/painel-de-produtos por um import de VALOR. Esse arquivo puxa
// `findEnterpriseMirror` (lib/guardian/c2x-analytics.ts → lib/guardian/db.ts → mysql2/promise), e o
// mysql2 pede 'net', 'tls' e 'url' do Node. No navegador isso é "Module not found: Can't resolve
// 'net'" no build, e caem juntos o portal da Cecílio e o da Gurgel. O typecheck, o eslint e o
// vitest (que rodam em Node) não enxergam: por isso esta varredura.
//
// Como funciona: parte de todo arquivo com "use client" em app/, modules/ e components/ e segue os
// imports de VALOR (estáticos, reexportações e `import()`), pelo alias `@/` e por caminho relativo.
// `import type` e `import { type A, type B }` não entram no bundle e são ignorados. Chegou a um
// pacote `mysql2`: falha, com a cadeia inteira na mensagem.

const RAIZ = path.resolve(__dirname, "..");
const PASTAS = ["app", "modules", "components"];
const EXTENSOES = [".ts", ".tsx", ".js", ".mjs"];
const PROIBIDO = /^mysql2(\/|$)/;

function arquivosDe(pasta: string): string[] {
  const saida: string[] = [];
  const andar = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === "node_modules" || item.name.startsWith(".")) continue;
      const cheio = path.join(dir, item.name);
      if (item.isDirectory()) andar(cheio);
      else if (/\.(tsx?|mjs|js)$/.test(item.name) && !/\.test\.tsx?$/.test(item.name)) saida.push(cheio);
    }
  };
  if (fs.existsSync(pasta)) andar(pasta);
  return saida;
}

function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//"))
    .join("\n");
}

/** Os especificadores que viram código no bundle. */
function importsDeValor(fonte: string): string[] {
  const limpo = semComentarios(fonte);
  const saida: string[] = [];
  const estatico = /(^|\n)\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  for (const achado of limpo.matchAll(estatico)) {
    const [, , , soTipo, clausula = "", origem = ""] = achado;
    if (soTipo) continue;
    const chaves = clausula.match(/^\{([\s\S]*)\}$/);
    if (chaves) {
      const nomes = (chaves[1] ?? "").split(",").map((n) => n.trim()).filter(Boolean);
      if (nomes.length > 0 && nomes.every((n) => n.startsWith("type "))) continue;
    }
    saida.push(origem);
  }
  for (const achado of limpo.matchAll(/(^|\n)\s*import\s*["']([^"']+)["']/g)) saida.push(achado[2] ?? "");
  for (const achado of limpo.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) saida.push(achado[1] ?? "");
  return saida.filter(Boolean);
}

function resolver(de: string, especificador: string): null | string {
  let base: string;
  if (especificador.startsWith("@/")) base = path.join(RAIZ, especificador.slice(2));
  else if (especificador.startsWith(".")) base = path.resolve(path.dirname(de), especificador);
  else return null;
  const candidatos = [
    base,
    ...EXTENSOES.map((ext) => base + ext),
    ...EXTENSOES.map((ext) => path.join(base, `index${ext}`)),
  ];
  return candidatos.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

describe("bundle do navegador", () => {
  it("nenhum arquivo \"use client\" alcança o mysql2 por import de valor", () => {
    const clientes = PASTAS.flatMap((p) => arquivosDe(path.join(RAIZ, p))).filter((arquivo) =>
      /^\s*["']use client["']/.test(fs.readFileSync(arquivo, "utf8")),
    );
    expect(clientes.length).toBeGreaterThan(50);

    // arquivo → cadeia até o mysql2 (ou null quando não chega). Memória compartilhada entre as raízes.
    const memoria = new Map<string, null | string[]>();
    const emAndamento = new Set<string>();

    const cadeiaAteOProibido = (arquivo: string): null | string[] => {
      if (memoria.has(arquivo)) return memoria.get(arquivo) ?? null;
      if (emAndamento.has(arquivo)) return null;
      emAndamento.add(arquivo);
      let achada: null | string[] = null;
      for (const especificador of importsDeValor(fs.readFileSync(arquivo, "utf8"))) {
        if (PROIBIDO.test(especificador)) {
          achada = [especificador];
          break;
        }
        const alvo = resolver(arquivo, especificador);
        if (!alvo) continue;
        const resto = cadeiaAteOProibido(alvo);
        if (resto) {
          achada = [path.relative(RAIZ, alvo), ...resto];
          break;
        }
      }
      emAndamento.delete(arquivo);
      memoria.set(arquivo, achada);
      return achada;
    };

    const violacoes = clientes
      .map((arquivo) => {
        const cadeia = cadeiaAteOProibido(arquivo);
        return cadeia ? [path.relative(RAIZ, arquivo), ...cadeia].join(" → ") : null;
      })
      .filter((v): v is string => v !== null);

    expect(violacoes).toEqual([]);
  });
});
