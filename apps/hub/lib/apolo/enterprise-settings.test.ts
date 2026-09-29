import { describe, expect, it } from "vitest";

import { listEnterpriseSettings } from "./enterprise-settings";

// A ORDEM DE ASSINATURA VOLTA DO GET COMO FOI GRAVADA.
//
// Nívea (24/09/2026): *"A ordem de assinatura não está ficando salva."*
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: A GRAVAÇÃO JÁ FOI CONSERTADA E ESTÁ NO AR; QUEM JOGAVA O MAPA FORA
// ERA A LEITURA. O commit b108e654 (23/09/2026 07:52, release 1.363.0) fez o mapa `{papel: número}`
// chegar inteiro ao banco, mas `listaDePapeis` começava com `if (!Array.isArray(bruto)) return
// null` — então o Setup reabria mostrando o padrão canônico em cima de uma coluna gravada certa, e
// o aviso âmbar do cartão disparava em TODO salvamento bem-sucedido.
//
// ⚠️ MEDIDO EM 25/09/2026 (`select enterprise_id, assinatura_ordenada, assinatura_ordem, updated_at
// from apolo_enterprise_settings order by updated_at desc`): 40 linhas, ZERO mapas, UMA lista (o RVP
// 38, na grafia antiga), e o VOL (36) e o VOC (37) com `assinatura_ordenada = true` e
// `assinatura_ordem` NULA desde 23/09 05:56 — uma hora e quarenta e dois minutos ANTES do conserto
// subir. As duas grafias precisam sobreviver à leitura: a antiga porque está no banco, a nova
// porque é a que a tela manda.

/** O `adminClient` reduzido ao que `listEnterpriseSettings` usa: `from().select().limit()`. */
function clienteFalso(linhas: Array<Record<string, unknown>>) {
  const encadeia = () => {
    const alvo: Record<string, unknown> = {
      limit: () => Promise.resolve({ data: linhas, error: null }),
      select: () => encadeia(),
    };
    return alvo;
  };
  return { from: () => encadeia() } as never;
}

const LINHA = {
  analise_credito_habilitada: true,
  assinatura_ordenada: true,
  code: "VOL",
  comprovante_renda_habilitado: false,
  credenciamento_ativo: true,
  enterprise_id: "36",
  limite_credito: null,
  prevenda_habilitada: true,
  recepcao_cad: true,
  recepcao_imobiliaria: true,
  valor_pix: null,
};

const ordemDo = async (assinatura_ordem: unknown) =>
  (await listEnterpriseSettings(clienteFalso([{ ...LINHA, assinatura_ordem }])))["36"]
    ?.assinaturaOrdem;

describe("a ordem de assinatura sobrevive à leitura, nas duas grafias", () => {
  it("⚠️ o MAPA que a tela manda volta como mapa, e não como nulo", async () => {
    expect(await ordemDo({ comprador: 1, conjuge: 2 })).toEqual({ comprador: 1, conjuge: 2 });
  });

  it("o mapa do caso comum da casa — comprador 1, o resto 2 — volta com o empate intacto", async () => {
    // Lucas (13/09/2026): *"eu posso colocar o comprador como 1 e o resto como 2"*. É o empate que
    // some quando a lista é achatada em fila.
    const mandado = {
      comprador: 1,
      conjuge: 2,
      coordenadora: 2,
      corretor: 2,
      testemunha: 2,
      vendedora: 2,
    };
    expect(await ordemDo(mandado)).toEqual(mandado);
  });

  it("a LISTA antiga continua voltando como lista — é o que o RVP (38) tem gravado", async () => {
    expect(await ordemDo(["comprador", "vendedora"])).toEqual(["comprador", "vendedora"]);
  });

  it("⚠️ nula volta NULA, e não lista vazia: nulo é 'usa o padrão da casa'", async () => {
    expect(await ordemDo(null)).toBeNull();
  });

  it("lixo na coluna vira nulo, sem lançar — a coluna é jsonb livre", async () => {
    expect(await ordemDo("comprador")).toBeNull();
    expect(await ordemDo(7)).toBeNull();
    expect(await ordemDo({ comprador: "primeiro" })).toBeNull();
    expect(await ordemDo({ comprador: 1, conjuge: null })).toBeNull();
    expect(await ordemDo({ comprador: Number.NaN })).toBeNull();
  });

  it("papel vazio na lista antiga continua sendo descartado", async () => {
    expect(await ordemDo(["comprador", "  ", 7, "vendedora"])).toEqual([
      "comprador",
      "vendedora",
    ]);
  });
});
