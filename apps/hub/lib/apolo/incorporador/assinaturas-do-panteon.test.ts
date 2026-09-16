import { describe, expect, it } from "vitest";

import {
  type EnvelopeDoPanteon,
  linhasDeAssinaturaDoPanteon,
  montarQuadroDeAssinaturas,
  type PropostaDoPanteonEmContrato,
  somarAssinaturasDoPanteon,
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
  it("⚠️ envelope enviado e aberto: em assinatura, todos aguardando, sem e-mail no esquema", () => {
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
      { assinadoEm: null, degrau: 1, nome: "Maria Souza", perfil: "Comprador", situacao: "aguardando" },
      { assinadoEm: null, degrau: 2, nome: "Ana Testemunha", perfil: "Testemunha", situacao: "aguardando" },
    ]);
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
      { assinadoEm: null, degrau: 0, nome: "Fulano", perfil: "Sem perfil", situacao: "aguardando" },
    ]);
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
