import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { type CadAutomaticaAnterior, cadsAutomaticasParaApagar } from "./cad-automatica-anterior";

// A LIMPEZA DA CAD AUTOMÁTICA (revisão de 16/09/2026): regenerar a CAD do Garden não pode apagar o
// PDF da CAD da mesma pessoa no Lagoa Bonita.

const cad = (id: string, enterpriseId: null | string): CadAutomaticaAnterior => ({
  enterpriseId,
  id,
  storage_bucket: "apolo-documents",
  storage_path: `entidade/e1/${id}.pdf`,
});

describe("cadsAutomaticasParaApagar", () => {
  it("regenerar a de 39 não remove a marcada de outro empreendimento", () => {
    const saida = cadsAutomaticasParaApagar([cad("lagoa", "33"), cad("garden-velha", "39")], {
      alvo: "39",
      esteiraDaPessoa: ["33", "39"],
    });
    expect(saida.map((c) => c.id)).toEqual(["garden-velha"]);
  });

  it("CAD antiga SEM marca de quem tem dois produtos: fica (não dá para saber de qual é)", () => {
    expect(
      cadsAutomaticasParaApagar([cad("antiga", null)], { alvo: "39", esteiraDaPessoa: ["33", "39"] }),
    ).toEqual([]);
  });

  it("CAD antiga sem marca de quem só tem o produto regenerado: sai, como antes", () => {
    expect(
      cadsAutomaticasParaApagar([cad("antiga", null)], { alvo: "39", esteiraDaPessoa: ["39", " 39 "] }).map(
        (c) => c.id,
      ),
    ).toEqual(["antiga"]);
  });

  it("sem saber o alvo, nenhuma marcada sai; a sem marca só com um produto", () => {
    const anteriores = [cad("marcada", "39"), cad("antiga", null)];
    expect(
      cadsAutomaticasParaApagar(anteriores, { alvo: null, esteiraDaPessoa: ["39"] }).map((c) => c.id),
    ).toEqual(["antiga"]);
    expect(cadsAutomaticasParaApagar(anteriores, { alvo: null, esteiraDaPessoa: ["33", "39"] })).toEqual(
      [],
    );
  });

  it("pessoa com um produto só que NÃO é o alvo: a sem marca fica", () => {
    expect(
      cadsAutomaticasParaApagar([cad("antiga", null)], { alvo: "39", esteiraDaPessoa: ["33"] }),
    ).toEqual([]);
  });
});

describe("a amarra em gerarESalvarCad", () => {
  const texto = readFileSync(join(__dirname, "salvar-cad.ts"), "utf8");

  it("a CAD nova sobe com a marca do empreendimento", () => {
    expect(texto).toMatch(/metadataExtra: \{ origem: CAD_ORIGEM_AUTO, \.\.\.\(alvo \? \{ enterpriseId: alvo \} : \{\}\) \}/);
  });

  it("a remoção passa por cadsAutomaticasParaApagar antes do storage.remove", () => {
    const filtro = texto.indexOf("cadsAutomaticasParaApagar(");
    const remove = texto.indexOf(".remove([");
    expect(filtro).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(filtro);
    expect(texto).toMatch(/for \(const a of apagaveis\)/);
  });
});
