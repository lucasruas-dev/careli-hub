import { describe, expect, it } from "vitest";

import { agrupar } from "@/lib/apolo/catalogo-empreendimentos";

import {
  codesDoRecorte,
  empreendimentosDoPortal,
  masterplanInternoDe,
  nomeApresentavel,
} from "./empreendimentos-do-portal";

// Catálogo REAL do C2X, lido em 17/08/2026 (o mesmo do teste do escopo).
const CATALOGO = agrupar([
  { code: "LBF", id: 33, name: "LAGOA BONITA" },
  { code: "LBR", id: 27, name: "LAGOA BONITA" },
  { code: "LBP", id: 32, name: "LAGOA BONITA" },
  { code: "VOC", id: 37, name: "VALE DO OURO" },
  { code: "VOL", id: 36, name: "VALE DO OURO" },
  { code: "VAL", id: 29, name: "VISTA ALEGRE" },
  { code: "REP", id: 20, name: "CONDOMINIO RECANTO DO PARA" },
  { code: "GDN", id: 39, name: "GARDEN" },
]);

describe("o nome que o cliente lê", () => {
  it("tira a caixa alta do C2X", () => {
    expect(nomeApresentavel("VISTA ALEGRE")).toBe("Vista Alegre");
    expect(nomeApresentavel("VALE DO OURO")).toBe("Vale do Ouro");
  });

  it("nome já escrito com caixa própria passa intacto", () => {
    expect(nomeApresentavel("Garden Resort Residence")).toBe("Garden Resort Residence");
  });
});

describe("o masterplan interno", () => {
  it("responde pelo código que tem mapa desenhado", () => {
    expect(masterplanInternoDe(["gdn"])).toBe("GDN");
  });

  it("⚠️ as três divisões do Vale do Ouro apontam para o MESMO arquivo", () => {
    // Um arquivo, três donos possíveis: `vale-do-ouro.html` traz os 298 lotes do loteamento
    // histórico (VOL do Lino + VOC do Cecílio), com preço e NOME COMPLETO de 161 compradores, e
    // exportação para planilha.
    //
    // ⚠️ POR ISSO ELE NUNCA É SERVIDO CRU. Quem entrega é `/api/incorporador/masterplan`, e lá o
    // `recortarMasterplan` tira do HTML os lotes que não são deste portal antes de responder —
    // eles voltam só como desenho cinza, sem quadra, lote, área, preço ou nome. O teste do
    // recorte contra o arquivo real está em [[masterplan-recorte]].
    //
    // Mapear os três aqui é o que permite ao portal OFERECER o mapa; é o recorte na rota que
    // decide o que cabe dentro dele.
    expect(masterplanInternoDe(["VOC"])).toBe("VOC");
    expect(masterplanInternoDe(["VOL"])).toBe("VOL");
    expect(masterplanInternoDe(["VLO"])).toBe("VLO");
  });

  it("⚠️ as três glebas da Lagoa Bonita apontam para o MESMO arquivo", () => {
    // `lagoa-bonita.html` cobre o loteamento inteiro: 495 lotes, com preço e comprador, sendo
    // 240 do LBR, 125 do LBP e 47 do LBF (a gleba do Fernando, o portal piloto). Como no Vale
    // do Ouro, o arquivo NUNCA é servido cru: o recorte da rota entrega a cada portal só os
    // lotes dele — os demais viram desenho cinza, sem dado.
    expect(masterplanInternoDe(["LBF"])).toBe("LBF");
    expect(masterplanInternoDe(["LBR"])).toBe("LBR");
    expect(masterplanInternoDe(["LBP"])).toBe("LBP");
  });

  it("⚠️ os dois de empreendimento único também têm mapa: VAL e REP, um arquivo cada", () => {
    // Desenhados em 17/08/2026 no molde da Lagoa: `vista-alegre.html` (126 lotes) e
    // `recanto-do-para.html` (199). Sem divisões: o recorte da rota confere o escopo e, cobrindo
    // tudo — o caso normal deles —, devolve o arquivo intacto. O portal do Bill (VAL) deixou de
    // ser o exemplo de "sem mapa".
    expect(masterplanInternoDe(["VAL"])).toBe("VAL");
    expect(masterplanInternoDe(["rep"])).toBe("REP");
  });

  it("⚠️ empreendimento sem mapa devolve nulo, e a tela não oferece o botão", () => {
    // A Lavra do Ouro (LOU, enterprise 1) está exatamente neste caso hoje.
    expect(masterplanInternoDe(["LOU"])).toBeNull();
  });
});

describe("os empreendimentos do portal", () => {
  it("lista só o que a sessão autorizou, com o nome de mercado", () => {
    const lista = empreendimentosDoPortal(CATALOGO, ["VAL"]);

    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ codes: ["VAL"], id: "29", nome: "Vista Alegre" });
  });

  it("⚠️ grupo com UMA divisão liberada não arrasta as outras", () => {
    // O Lagoa Bonita tem três glebas, de três donos. Devolver os códigos do grupo inteiro
    // mostraria o estoque do vizinho dentro de um card com o nome certo.
    const lista = empreendimentosDoPortal(CATALOGO, ["LBF"]);

    expect(lista).toHaveLength(1);
    expect(lista[0]?.codes).toEqual(["LBF"]);
    expect(lista[0]?.id).toBe("group:Lagoa Bonita");
  });

  it("grupo inteiro liberado devolve as três divisões num card só", () => {
    const lista = empreendimentosDoPortal(CATALOGO, ["LBF", "LBR", "LBP"]);

    expect(lista).toHaveLength(1);
    expect([...(lista[0]?.codes ?? [])].sort()).toEqual(["LBF", "LBP", "LBR"]);
  });

  it("código que a sessão não trouxe não entra, mesmo existindo no catálogo", () => {
    const lista = empreendimentosDoPortal(CATALOGO, ["VOC"]);

    expect(lista.flatMap((emp) => emp.codes)).toEqual(["VOC"]);
  });
});

describe("o recorte por empreendimento", () => {
  const LISTA = empreendimentosDoPortal(CATALOGO, ["VOC", "VAL", "GDN"]);

  it("sem pedido, devolve tudo o que o cliente tem", () => {
    expect(codesDoRecorte(LISTA).sort()).toEqual(["GDN", "VAL", "VOC"]);
  });

  it("com pedido, devolve só o do empreendimento escolhido", () => {
    expect(codesDoRecorte(LISTA, "29")).toEqual(["VAL"]);
  });

  it("⚠️ pedido que não é dele devolve VAZIO, nunca a visão consolidada", () => {
    // A rota transforma isso em 404. O erro clássico é o filtro que "não achou" virar relatório
    // do loteamento inteiro.
    expect(codesDoRecorte(LISTA, "36")).toEqual([]);
    expect(codesDoRecorte(LISTA, "group:Lagoa Bonita")).toEqual([]);
  });

  it("string vazia é ausência de pedido, não curinga de outro empreendimento", () => {
    expect(codesDoRecorte(LISTA, "  ").sort()).toEqual(["GDN", "VAL", "VOC"]);
  });
});
