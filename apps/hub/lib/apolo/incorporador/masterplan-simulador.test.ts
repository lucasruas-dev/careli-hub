import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { comSimuladorAberto, loteDoPedido } from "./masterplan-simulador";

/** O arquivo REAL: é nele que a injeção precisa funcionar, não num HTML de mentira. */
function masterplanReal(): string {
  const candidatos = [
    path.join(process.cwd(), "masterplans-internos", "vista-alegre.html"),
    path.join(process.cwd(), "apps", "hub", "masterplans-internos", "vista-alegre.html"),
  ];
  const achado = candidatos.find((c) => fs.existsSync(c));
  if (!achado) throw new Error("masterplan de referência não encontrado");
  return fs.readFileSync(achado, "utf8");
}

describe("loteDoPedido", () => {
  it("lê quadra e lote", () => {
    expect(loteDoPedido("15|01")).toEqual({ lote: "01", quadra: "15" });
  });

  it("⚠️ limpa o que não é letra nem dígito", () => {
    // O valor entra dentro de um <script>: aspas, barras e sinais não têm por que passar.
    expect(loteDoPedido('15"|01<script>')).toEqual({ lote: "01script", quadra: "15" });
  });

  it("sem lote, não simula", () => {
    expect(loteDoPedido("")).toBeNull();
    expect(loteDoPedido("15")).toBeNull();
    expect(loteDoPedido(null)).toBeNull();
  });
});

describe("comSimuladorAberto, no arquivo real", () => {
  const html = masterplanReal();
  const final = comSimuladorAberto(html, "15", "01");

  it("injeta o estilo e o abridor", () => {
    expect(final).toContain('id="so-simulador"');
    expect(final).toContain('id="abrir-simulador"');
  });

  it("⚠️ entra antes do ÚLTIMO </body>", () => {
    // O arquivo tem um `</body>` DENTRO de uma string JavaScript (o HTML que ele exporta): injetar
    // no primeiro colocaria o script dentro de um texto, e nada rodaria.
    expect(html.split("</body>").length - 1).toBeGreaterThan(1);
    expect(final.indexOf('id="abrir-simulador"')).toBeLessThan(final.lastIndexOf("</body>"));
    // E depois do script do masterplan, senão `abre` e `lotes` ainda não existem.
    expect(final.indexOf('id="abrir-simulador"')).toBeGreaterThan(final.lastIndexOf("function abre("));
  });

  it("⚠️ esconde a cena junto com a casca", () => {
    // O primeiro corte deixava o mapa visível e a modal abria com o loteamento na tela, o simulador
    // atrás. Lucas: "não precisa trazer o espelho".
    const estilo = final.slice(final.indexOf('id="so-simulador"'), final.indexOf("</style>", final.indexOf('id="so-simulador"')));
    for (const alvo of [".cena", ".topo", ".macro", ".unidade", ".rodape"]) {
      expect(estilo).toContain(alvo);
    }
    expect(estilo).toContain("#popPlano");
  });

  it("o valor do lote entra escapado", () => {
    const comAspas = comSimuladorAberto(html, "15", "01");
    expect(comAspas).toContain('String("15")');
    expect(comAspas).toContain('String("01")');
  });

  it("não mexe no resto do arquivo", () => {
    // Byte a byte: o masterplan é uma tela aprovada, e a injeção só ACRESCENTA.
    expect(final.replace(/<style id="so-simulador">[\s\S]*?<\/script>/, "")).toBe(html);
  });
});
