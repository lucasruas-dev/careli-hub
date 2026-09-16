import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { LinhaAuditoria } from "@/lib/apolo/board-do-servidor";

import {
  autorNoPortal,
  EQUIPE_CARELI,
  eventoNoRecorte,
  eventoSemMarcaNoRecorte,
  filtroDoHistoricoDoPortal,
  linhaDoTempoParaOPortal,
} from "./historico-do-portal";

// O HISTÓRICO DA FICHA DO BOARD PELO PORTAL (16/09/2026): só a edição do empreendimento que a
// sessão alcança, e a equipe da Careli sem nome nem e-mail.

const HUB = join(__dirname, "..", "..", "..");

const recorte = new Set(["37", "39"]);

const linha = (over: Partial<LinhaAuditoria>): LinhaAuditoria => ({
  action: "edit_ficha",
  actor_user_id: null,
  created_at: "2026-09-16T12:00:00Z",
  field_name: "telefone",
  metadata: { de: "(37) 99999-0000", para: "(37) 98888-0000" },
  ...over,
});

describe("eventoNoRecorte", () => {
  it("edição marcada com empreendimento do recorte: sai", () => {
    expect(eventoNoRecorte({ enterpriseId: "37" }, recorte)).toBe(true);
    expect(eventoNoRecorte({ enterpriseId: 39 }, recorte)).toBe(true);
  });

  it("edição da CAD de OUTRO loteamento: fora", () => {
    expect(eventoNoRecorte({ enterpriseId: "12" }, recorte)).toBe(false);
  });

  it("evento antigo SEM enterpriseId: fora (fail-closed)", () => {
    expect(eventoNoRecorte({ autorNome: null, de: "a", para: "b" }, recorte)).toBe(false);
    expect(eventoNoRecorte({ enterpriseId: "" }, recorte)).toBe(false);
    expect(eventoNoRecorte({ enterpriseId: null }, recorte)).toBe(false);
    expect(eventoNoRecorte(null, recorte)).toBe(false);
  });

  it("correção de identidade (edit_identity, sem empreendimento por desenho): fora", () => {
    const identidade = linha({
      action: "edit_identity",
      field_name: "identidade",
      metadata: { de: { nome: "A" }, motivo: "CPF trocado", origem: "board-validacao", para: { nome: "B" } },
    });
    expect(filtroDoHistoricoDoPortal(recorte).manter(identidade)).toBe(false);
  });
});

describe("autorNoPortal", () => {
  const contasDoHub = new Set(["hub-lucas"]);

  it("conta do hub vira 'Equipe Careli', nunca o nome nem o e-mail", () => {
    expect(autorNoPortal(linha({ actor_user_id: "hub-lucas" }), contasDoHub)).toBe(EQUIPE_CARELI);
    expect(EQUIPE_CARELI).toBe("Equipe Careli");
  });

  it("conta do hub com nome no metadata: continua 'Equipe Careli' (o teste do hub vem antes)", () => {
    expect(
      autorNoPortal(
        linha({ actor_user_id: "hub-lucas", metadata: { autorNome: "Lucas Ruas" } }),
        contasDoHub,
      ),
    ).toBe(EQUIPE_CARELI);
  });

  it("leitura das contas do hub falhou: todo autor com conta vira 'Equipe Careli'", () => {
    expect(
      autorNoPortal(linha({ actor_user_id: "conta-portal", metadata: { autorNome: "Maria" } }), null),
    ).toBe(EQUIPE_CARELI);
  });

  it("conta de portal: o nome que o portal gravou", () => {
    expect(
      autorNoPortal(
        linha({ actor_user_id: "conta-portal", metadata: { autorNome: "  Maria do Cecílio " } }),
        contasDoHub,
      ),
    ).toBe("Maria do Cecílio");
  });

  it("conta desconhecida sem nome: traço; sem conta: Sistema", () => {
    expect(autorNoPortal(linha({ actor_user_id: "sumiu" }), contasDoHub)).toBe("—");
    expect(autorNoPortal(linha({ actor_user_id: null }), contasDoHub)).toBe("Sistema");
  });
});

describe("filtroDoHistoricoDoPortal", () => {
  it("junta as duas regras no formato que historicoDaFicha recebe", () => {
    const filtro = filtroDoHistoricoDoPortal(recorte);
    const doProduto = linha({ actor_user_id: "hub-ana", metadata: { enterpriseId: "37" } });
    const doVizinho = linha({ actor_user_id: "hub-ana", metadata: { enterpriseId: "12" } });

    expect([doProduto, doVizinho].filter(filtro.manter)).toEqual([doProduto]);
    expect(filtro.autor(doProduto, new Set(["hub-ana"]))).toBe(EQUIPE_CARELI);
  });
});

// (16/09/2026, revisão) Sem a pessoa, o evento sem marca sumia sempre: o board da Gurgel perdia a
// história inteira, a identidade corrigida pelo próprio coordenador e a ficha da imobiliária.
describe("o evento sem marca, com a pessoa conhecida", () => {
  const semMarca = linha({ metadata: { de: "a", origem: "board-validacao", para: "b" } });
  const identidade = linha({
    action: "edit_identity",
    field_name: "identidade",
    metadata: { de: { nome: "A" }, origem: "board-validacao", para: { nome: "B" } },
  });

  it("pessoa só com CAD no produto: o antigo e a identidade saem", () => {
    const filtro = filtroDoHistoricoDoPortal(recorte, {
      esteira: ["37"],
      imobiliaria: false,
      vinculos: ["37"],
    });
    expect(filtro.manter(semMarca)).toBe(true);
    expect(filtro.manter(identidade)).toBe(true);
  });

  it("pessoa com CAD em outro loteamento: o sem marca fica fora (pode ser do outro)", () => {
    const filtro = filtroDoHistoricoDoPortal(recorte, {
      esteira: ["37", "12"],
      imobiliaria: false,
      vinculos: ["37"],
    });
    expect(filtro.manter(semMarca)).toBe(false);
    expect(filtro.manter(identidade)).toBe(false);
  });

  it("vínculo de outro produto também fecha", () => {
    expect(
      eventoSemMarcaNoRecorte({ esteira: ["37"], imobiliaria: false, vinculos: ["37", "12"] }, recorte),
    ).toBe(false);
  });

  it("pessoa sem empreendimento conhecido: fora", () => {
    expect(eventoSemMarcaNoRecorte({ esteira: [], imobiliaria: false, vinculos: [] }, recorte)).toBe(
      false,
    );
  });

  it("ficha da IMOBILIÁRIA sem esteira: sai, mesmo com vínculos em vários produtos", () => {
    expect(
      eventoSemMarcaNoRecorte({ esteira: [], imobiliaria: true, vinculos: ["37", "12"] }, recorte),
    ).toBe(true);
  });

  it("a marca continua mandando: evento marcado com outro produto fica fora mesmo com a pessoa só no recorte", () => {
    const filtro = filtroDoHistoricoDoPortal(recorte, {
      esteira: ["37"],
      imobiliaria: false,
      vinculos: ["37"],
    });
    expect(filtro.manter(linha({ metadata: { enterpriseId: "12" } }))).toBe(false);
  });

  it("sem a pessoa (leitura falhou), só o marcado sai", () => {
    expect(filtroDoHistoricoDoPortal(recorte).manter(semMarca)).toBe(false);
  });
});

describe("linhaDoTempoParaOPortal (histórico da unidade na Venda)", () => {
  const evento = (over: { quem: null | string; tipo: string }) => ({ id: "x", quando: "2026-09-01", ...over });

  it("etapa movida por analista da Careli (nome do C2X) vira 'Equipe Careli'", () => {
    const [saida] = linhaDoTempoParaOPortal([evento({ quem: "Ana Analista", tipo: "etapa" })], new Set(["Maria do Cecílio"]));
    expect(saida?.quem).toBe(EQUIPE_CARELI);
  });

  it("etapa de uma conta do próprio portal mantém o nome (sem depender de acento ou caixa)", () => {
    const [saida] = linhaDoTempoParaOPortal(
      [evento({ quem: "MARIA DO CECILIO", tipo: "etapa" })],
      new Set(["Maria do Cecílio"]),
    );
    expect(saida?.quem).toBe("MARIA DO CECILIO");
  });

  it("pagamento e assinatura ficam como estão; etapa sem autor também", () => {
    const eventos = [
      evento({ quem: "Fulano Comprador", tipo: "assinatura" }),
      evento({ quem: null, tipo: "pagamento" }),
      evento({ quem: null, tipo: "etapa" }),
    ];
    expect(linhaDoTempoParaOPortal(eventos, new Set())).toEqual(eventos);
  });

  it("sem conseguir ler as contas, todo nome de etapa vira 'Equipe Careli'", () => {
    const [saida] = linhaDoTempoParaOPortal([evento({ quem: "Maria do Cecílio", tipo: "etapa" })], null);
    expect(saida?.quem).toBe(EQUIPE_CARELI);
  });

  it("a rota da Venda aplica a régua fora do comercial", () => {
    const rota = readFileSync(join(HUB, "app/api/incorporador/venda/historico/route.ts"), "utf8");
    expect(rota).toMatch(/comercial \? eventos : linhaDoTempoParaOPortal\(eventos, nomesDoPortal\)/);
    expect(rota.match(/paraATela\(/g)?.length).toBe(2);
  });
});

// O QUE LIGA A REGRA AO SERVIDOR. Sem estas amarras a regra pura passaria verde com a rota do
// portal chamando o histórico cru, ou com a edição nova gravada sem a marca (e aí o portal não
// mostraria edição nenhuma).
describe("as amarras no servidor", () => {
  const ler = (caminho: string) => readFileSync(join(HUB, caminho), "utf8");

  it("a rota do portal passa o filtro com o recorte do produto (e o espelho do pai) e a pessoa", () => {
    const rota = ler("app/api/incorporador/board/[id]/historico/route.ts");
    expect(rota).toMatch(/historicoDaFicha\(admin\.client, id, filtroDoHistoricoDoPortal\(recorte, pessoa\)\)/);
    expect(rota).toMatch(/let recorte: ReadonlySet<string> = rec\.recorte\.ids;/);
    // (16/09/2026, revisão do conjunto) Fora do comercial o espelho passa pela pessoa quando o portal
    // opera sozinho; o comercial tem o filtro próprio, com o espelho de sempre (D4).
    expect(rota).toMatch(/recorteDeLeituraDoPortal\(\{/);
    expect(rota).toMatch(/operaSozinho: portalConfeccionaContrato\(auth\.sessao\.slug, auth\.sessao\.tipo\)/);
    expect(rota).toMatch(/if \(ehPortalComercial\(auth\.sessao\.tipo\)\)/);
    expect(rota).toMatch(/filtroDoHistoricoDoComercial\(recorteDoComercial\)/);
  });

  it("a rota do hub continua sem filtro (o histórico interno não muda)", () => {
    expect(ler("app/api/apolo/board/[id]/historico/route.ts")).toMatch(
      /historicoDaFicha\(client, id\);/,
    );
  });

  it("o edit_ficha da CAD grava enterpriseId no metadata", () => {
    const servidor = ler("lib/apolo/board-do-servidor.ts");
    const salvar = servidor.slice(servidor.indexOf("export async function salvarFichaDoBoard"));
    const trilha = salvar.slice(salvar.indexOf("const trilha"), salvar.indexOf("let auditoria"));
    expect(trilha).toMatch(/action: "edit_ficha"/);
    expect(trilha).toMatch(/enterpriseId: alvoEnterpriseId,/);
  });

  it("com filtro, a consulta de hub_users traz só o id (nome e e-mail não saem)", () => {
    const servidor = ler("lib/apolo/board-do-servidor.ts");
    const historico = servidor.slice(servidor.indexOf("export async function historicoDaFicha"));
    const ramoDoPortal = historico.slice(
      historico.indexOf("if (filtro?.autor && autores.length > 0)"),
      historico.indexOf("} else if (autores.length > 0)"),
    );
    expect(ramoDoPortal).toMatch(/\.select\("id"\)/);
    expect(ramoDoPortal).not.toMatch(/display_name|email/);
  });
});
