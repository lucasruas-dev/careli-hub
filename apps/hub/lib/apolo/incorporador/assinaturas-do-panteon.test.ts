import { describe, expect, it } from "vitest";

import {
  assinaturasDoPayload,
  type EnvelopeDoPanteon,
  linhasDeAssinaturaDoPanteon,
  montarQuadroDeAssinaturas,
  type PropostaDoPanteonEmContrato,
  somarAssinaturasDoPanteon,
  type UnidadeDeAssinatura,
  unirComOPanteon,
} from "./assinaturas";

// OS CONTRATOS DO PRODUTO QUE SÓ EXISTE NO PANTEON, NA ABA CONTRATOS DO PORTAL (pendência da ficha,
// onda 1, 16/09/2026). O que se trava aqui é a montagem pura:
//   • o "assinou?" é o de `apurarFatosDoContrato` (envelope `assinado` ou data de assinatura);
//   • sem envelope vivo a linha é "aguardando emissão"; com envelope enviado, "em assinatura";
//   • quem assina sai do envelope congelado, com o rótulo do papel e sem e-mail;
//   • a soma com o quadro do legado mantém a ordem do gargalo e soma os KPIs de unidade.

const proposta = (p: Partial<PropostaDoPanteonEmContrato> & { id: string }): PropostaDoPanteonEmContrato => ({
  cliente_nome: "Maria Souza",
  data_assinatura: null,
  data_ato: null,
  data_faturamento: null,
  empreendimento_codigo: "jad",
  etapa: "contrato",
  etapa_desde: "2026-09-10T12:00:00.000Z",
  imobiliaria_nome: "Imobiliária Centro",
  preco_tabela: "450000",
  unidade_nome: "Torre A · Apto 304",
  valor: 440000,
  ...p,
});

const envelope = (p: Partial<EnvelopeDoPanteon> & { proposta_id: string }): EnvelopeDoPanteon => ({
  criado_em: "2026-09-11T12:00:00.000Z",
  enviado_em: "2026-09-11T12:05:00.000Z",
  estado: "aguardando",
  fechado_em: null,
  signatarios: [
    { email: "maria@exemplo.com", nome: "Maria Souza", ordem: 1, papel: "comprador" },
    { email: "rh@careli.adm.br", nome: "Ana Testemunha", ordem: 2, papel: "testemunha" },
  ],
  ...p,
});

describe("linhasDeAssinaturaDoPanteon", () => {
  it("⚠️ envelope enviado e aberto: em assinatura, o primeiro degrau na vez, sem e-mail no esquema", () => {
    const [linha] = linhasDeAssinaturaDoPanteon([proposta({ id: "p1" })], [envelope({ proposta_id: "p1" })]);
    expect(linha).toMatchObject({
      assinadas: 0,
      comprador: "Maria Souza",
      concluida: false,
      empreendimento: "JAD",
      enviadoEm: "2026-09-11",
      situacao: "em-assinatura",
      total: 2,
      unidade: "Torre A · Apto 304",
    });
    expect(linha?.esquema).toEqual([
      { assinadoEm: null, degrau: 1, nome: "Maria Souza", perfil: "Comprador", situacao: "vez" },
      { assinadoEm: null, degrau: 2, nome: "Ana Testemunha", perfil: "Testemunha", situacao: "aguardando" },
    ]);
    expect(linha).toMatchObject({ naVez: ["Maria Souza"], perfisNaVez: ["Comprador"] });
    expect(JSON.stringify(linha)).not.toContain("@");
    // Sem botão de PDF: a rota do PDF é a do C2X.
    expect(linha?.contrato).toMatchObject({ temContrato: false, unitId: 0, valorTabela: 450000 });
  });

  it("⚠️ envelope assinado: concluída, todos assinados no dia do fechamento (em Brasília)", () => {
    const [linha] = linhasDeAssinaturaDoPanteon(
      [proposta({ etapa: "assinatura", id: "p1" })],
      // 23h30 de Brasília do dia 15 é 02h30 UTC do dia 16.
      [envelope({ estado: "assinado", fechado_em: "2026-09-16T02:30:00.000Z", proposta_id: "p1" })],
    );
    expect(linha).toMatchObject({ assinadas: 2, concluida: true, situacao: "assinado" });
    expect(linha?.esquema.every((item) => item.situacao === "assinado" && item.assinadoEm === "2026-09-15")).toBe(true);
  });

  it("⚠️ a data de assinatura da proposta também conta (a régua do cancelamento)", () => {
    const [linha] = linhasDeAssinaturaDoPanteon([proposta({ data_assinatura: "2026-09-12", id: "p1" })], []);
    expect(linha).toMatchObject({ concluida: true, situacao: "assinado" });
  });

  it("sem envelope, ou só com envelope cancelado: aguardando emissão, sem esquema", () => {
    const linhas = linhasDeAssinaturaDoPanteon(
      [proposta({ id: "p1" }), proposta({ id: "p2", unidade_nome: "Torre A · Apto 305" })],
      [envelope({ estado: "cancelado", proposta_id: "p2" })],
    );
    for (const linha of linhas) {
      expect(linha).toMatchObject({ enviadoEm: "", esquema: [], situacao: "aguardando-emissao", total: 0 });
    }
  });

  it("o envelope que vale é o mais recente que não morreu; papel desconhecido vira Sem perfil", () => {
    const [linha] = linhasDeAssinaturaDoPanteon(
      [proposta({ id: "p1" })],
      [
        envelope({ criado_em: "2026-09-01T00:00:00.000Z", estado: "assinado", proposta_id: "p1" }),
        envelope({ criado_em: "2026-09-12T00:00:00.000Z", estado: "expirado", proposta_id: "p1" }),
        envelope({
          criado_em: "2026-09-05T00:00:00.000Z",
          estado: "parcial",
          proposta_id: "p1",
          signatarios: [{ nome: "Fulano", ordem: "x", papel: "interveniente" }],
        }),
      ],
    );
    // O de 01/09 era "assinado", mas o de 05/09 é mais recente e está vivo.
    expect(linha).toMatchObject({ concluida: false, situacao: "em-assinatura" });
    expect(linha?.esquema).toEqual([
      { assinadoEm: null, degrau: 0, nome: "Fulano", perfil: "Sem perfil", situacao: "vez" },
    ]);
  });

  // O CASO DO LUCAS (28/09/2026, VOL 11 06): enviado pela Clicksign em 25/09, as três coordenadoras no
  // degrau 1 e duas já assinaram. A linha tem de dizer 2 de 5, com o degrau 1 ainda na vez.
  it("⚠️ quem assinou sai do payload do webhook, por e-mail ou pela chave; a vez é o menor degrau pendente", () => {
    const payload = {
      document: {
        events: [
          { data: { signer: { email: "COORD1@careli.adm.br", key: "k1" } }, name: "sign", occurred_at: "2026-09-28T13:12:50-03:00" },
          { data: { signer: { email: "outra@careli.adm.br", key: "k2" } }, name: "sign", occurred_at: "2026-09-28T13:12:51-03:00" },
        ],
        signers: [
          { email: "coord1@careli.adm.br", key: "k1", name: "Coord Um" },
          { email: "outra@careli.adm.br", key: "k2", name: "Coord Dois" },
          { email: "coord3@careli.adm.br", key: "k3", name: "Coord Tres" },
          { email: "comprador@exemplo.com", key: "k4", name: "Jonatas" },
        ],
      },
    };
    const assinaturas = assinaturasDoPayload(payload);
    const [linha] = linhasDeAssinaturaDoPanteon(
      [proposta({ etapa: "assinatura", id: "p1", unidade_id: "u1", unidade_nome: "Quadra 11 · Lote 06" })],
      [
        envelope({
          ordenada: true,
          proposta_id: "p1",
          provedor_documento_id: "doc-1",
          signatarios: [
            { email: "coord1@careli.adm.br", nome: "Coord Um", ordem: 1, papel: "coordenadora" },
            // o e-mail congelado difere do que assinou: casa pela chave
            { chave: "k2", email: "trocado@careli.adm.br", nome: "Coord Dois", ordem: 1, papel: "coordenadora" },
            { email: "coord3@careli.adm.br", nome: "Coord Tres", ordem: 1, papel: "coordenadora" },
            { email: "comprador@exemplo.com", nome: "Jonatas", ordem: 2, papel: "comprador" },
            { email: "vend@careli.adm.br", nome: "Vendedora", ordem: 3, papel: "vendedora" },
          ],
        }),
      ],
      { assinaturasPorDocumento: new Map([["doc-1", assinaturas]]), codigoDaUnidade: new Map([["u1", "VOL1106"]]) },
    );
    expect(linha).toMatchObject({
      assinadas: 2,
      concluida: false,
      naVez: ["Coord Tres"],
      situacao: "em-assinatura",
      total: 5,
      unidade: "VOL1106",
    });
    expect(linha?.esquema.map((item) => [item.nome, item.situacao, item.assinadoEm])).toEqual([
      ["Coord Dois", "assinado", "2026-09-28"],
      ["Coord Tres", "vez", null],
      ["Coord Um", "assinado", "2026-09-28"],
      ["Jonatas", "aguardando", null],
      ["Vendedora", "aguardando", null],
    ]);
    expect(JSON.stringify(linha)).not.toContain("@");
  });

  it("envelope sem ordem (ordenada = false): todos os pendentes na vez, no degrau 0", () => {
    const [linha] = linhasDeAssinaturaDoPanteon(
      [proposta({ id: "p1" })],
      [envelope({ ordenada: false, proposta_id: "p1" })],
    );
    expect(linha?.esquema.every((item) => item.situacao === "vez" && item.degrau === 0)).toBe(true);
  });
});

describe("unirComOPanteon", () => {
  const legado = (unidade: string, situacao: UnidadeDeAssinatura["situacao"]): UnidadeDeAssinatura => ({
    assinadas: 0,
    aviso: null,
    comprador: null,
    concluida: false,
    contrato: null,
    empreendimento: "VOL",
    enviadoEm: situacao === "aguardando-emissao" ? "" : "2026-09-20",
    envioId: situacao === "aguardando-emissao" ? 0 : 99,
    esquema: [],
    fonte: "c2x-legado",
    grupos: [],
    naVez: [],
    perfisNaVez: [],
    situacao,
    total: 0,
    unidade,
  });
  const quadroCom = (unidades: UnidadeDeAssinatura[], aguardandoEmissao: number) => {
    const vazio = montarQuadroDeAssinaturas([], [], new Map());
    return { ...vazio, kpis: { ...vazio.kpis, aguardandoEmissao }, unidades };
  };
  const doPanteon = (etapa: string, envelopes: EnvelopeDoPanteon[]) =>
    linhasDeAssinaturaDoPanteon(
      [proposta({ empreendimento_codigo: "vol", etapa, id: "p1", unidade_id: "u1" })],
      envelopes,
      { codigoDaUnidade: new Map([["u1", "VOL1106"]]) },
    );

  it("⚠️ a venda redigitada no C2X sem envio sai; fica a do Panteon em assinatura, e o KPI desconta", () => {
    const quadro = quadroCom([legado("VOL1106", "aguardando-emissao"), legado("VOL0101", "aguardando-emissao")], 2);
    const unido = unirComOPanteon(quadro, doPanteon("assinatura", [envelope({ proposta_id: "p1" })]));
    expect(unido.unidades.map((l) => [l.unidade, l.situacao]).sort()).toEqual([
      ["VOL0101", "aguardando-emissao"],
      ["VOL1106", "em-assinatura"],
    ]);
    expect(unido.kpis.aguardandoEmissao).toBe(1);
  });

  it("⚠️ o contrato que foi para a D4Sign pelo C2X vence a proposta do Panteon sem envelope", () => {
    const quadro = quadroCom([legado("VOL1106", "em-assinatura")], 0);
    const unido = unirComOPanteon(quadro, doPanteon("contrato", []));
    expect(unido.unidades.map((l) => [l.unidade, l.situacao])).toEqual([["VOL1106", "em-assinatura"]]);
    expect(unido.kpis.aguardandoEmissao).toBe(0);
  });

  it("os dois sem envio: fica uma só linha, a do Panteon", () => {
    const quadro = quadroCom([legado("VOL1106", "aguardando-emissao")], 1);
    const unido = unirComOPanteon(quadro, doPanteon("contrato", []));
    expect(unido.unidades).toHaveLength(1);
    expect(unido.unidades[0]?.fonte).not.toBe("c2x-legado");
    expect(unido.kpis.aguardandoEmissao).toBe(1);
  });

  it("⚠️ uma por uma: duas linhas aguardando do legado na mesma unidade, sai só uma", () => {
    const quadro = quadroCom([legado("VOL1106", "aguardando-emissao"), legado("VOL1106", "aguardando-emissao")], 2);
    const unido = unirComOPanteon(quadro, doPanteon("assinatura", [envelope({ proposta_id: "p1" })]));
    expect(unido.unidades.filter((l) => l.situacao === "aguardando-emissao")).toHaveLength(1);
    expect(unido.unidades.filter((l) => l.situacao === "em-assinatura")).toHaveLength(1);
    expect(unido.kpis.aguardandoEmissao).toBe(1);
  });

  it("os dois com envio: ficam os dois contratos, nada é escondido", () => {
    const quadro = quadroCom([legado("VOL1106", "em-assinatura")], 0);
    const unido = unirComOPanteon(quadro, doPanteon("assinatura", [envelope({ proposta_id: "p1" })]));
    expect(unido.unidades).toHaveLength(2);
  });
});

describe("somarAssinaturasDoPanteon", () => {
  it("sem linha do Panteon o quadro volta o mesmo", () => {
    const quadro = montarQuadroDeAssinaturas([], [], new Map());
    expect(somarAssinaturasDoPanteon(quadro, [])).toBe(quadro);
  });

  it("⚠️ soma lista e KPIs de unidade, emissão e comprador; pendente antes de concluída", () => {
    const quadro = montarQuadroDeAssinaturas([], [], new Map());
    const linhas = linhasDeAssinaturaDoPanteon(
      [
        proposta({ etapa: "assinatura", id: "p1", unidade_nome: "Apto 101" }),
        proposta({ id: "p2", unidade_nome: "Apto 102" }),
        proposta({ id: "p3", unidade_nome: "Apto 103" }),
      ],
      [
        envelope({ estado: "assinado", fechado_em: "2026-09-12T15:00:00.000Z", proposta_id: "p1" }),
        envelope({ proposta_id: "p2" }),
      ],
    );

    const somado = somarAssinaturasDoPanteon(quadro, linhas);
    expect(somado.kpis).toMatchObject({
      aguardandoEmissao: 1,
      compradorOk: 1,
      compradorPendente: 1,
      unidadesComEnvio: 2,
      unidadesTotalmenteAssinadas: 1,
    });
    expect(somado.unidades.map((u) => [u.unidade, u.situacao])).toEqual([
      ["Apto 103", "aguardando-emissao"],
      ["Apto 102", "em-assinatura"],
      ["Apto 101", "assinado"],
    ]);
    expect(somado.aviso).toBeNull();
  });
});
