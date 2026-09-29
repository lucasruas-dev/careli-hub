import { describe, expect, it } from "vitest";

import {
  chaveNumerica,
  type ContratoDoPanteon,
  contratosDoPortal,
  type LinhaDaViewDeContratos,
  type LinhaDaViewDeEnvelopes,
  type LinhasDosContratos,
  montarContratosDoPanteon,
  perfilDaPessoa,
  type PropostaForaDaLeitura,
  quadroDosContratos,
  quadroParaOPortal,
  type UnidadeDaLeitura,
} from "./contratos-do-panteon-montagem";

// A LEITURA ÚNICA MONTADA (F4 da fonte única). Os dados são ANONIMIZADOS: nomes, e-mails e ids
// inventados, com a FORMA dos casos medidos em 28/09/2026 (os 8 contratos da Clicksign de VOC/VOL/VOR,
// a VOC0306 que voltou para correção, as nativas da D4Sign, o Garden sem venda no Panteon).

const AGORA = new Date("2026-09-28T15:00:00-03:00");
const RODADA_EM_DIA = "2026-09-28T14:37:00-03:00";

let seq = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function venda(p: Partial<LinhaDaViewDeContratos> & { proposta_id: string; unidade_id: string }): LinhaDaViewDeContratos {
  return {
    ar_c2x_id: null,
    cancelamento_pedido_em: null,
    cliente_nome: "Cliente Anônimo",
    criado_em: "2026-09-20T10:00:00+00:00",
    data_assinatura: null,
    data_ato: null,
    data_faturamento: null,
    empreendimento_codigo: "VOC",
    enterprise_id: "37",
    espelho_de: null,
    etapa: "assinatura",
    etapa_desde: "2026-09-25T10:00:00+00:00",
    gerado_em: "2026-09-24T10:00:00+00:00",
    imobiliaria_nome: "Imobiliária Exemplo",
    lote: "06",
    origem: "panteon",
    preco_tabela: 150000,
    quadra: "03",
    unidade_c2x_id: 5001,
    unidade_codigo: "VOC0306",
    unidade_preco_tabela: 149000,
    valor: 145000,
    ...p,
  };
}

function envelope(p: Partial<LinhaDaViewDeEnvelopes> & { proposta_id: null | string }): LinhaDaViewDeEnvelopes {
  seq += 1;
  return {
    c2x_contract_signature_id: null,
    conferido_em: null,
    criado_em: "2026-09-25T12:00:00+00:00",
    envelope_id: `env-${seq}`,
    enviado_em: "2026-09-25T12:05:00+00:00",
    estado: "aguardando",
    estado_cru: "clicksign:upload",
    falha: null,
    fechado_em: null,
    id: uuid(1000 + seq),
    ordenada: true,
    origem: "panteon",
    provedor: "clicksign",
    provedor_documento_id: `doc-${seq}`,
    signatarios: [
      { chave: "k1", email: "coord@careli.adm.br", nome: "Coordenadora Um", ordem: 1, papel: "coordenadora" },
      { chave: "k2", email: "comprador@exemplo.com", nome: "Comprador Um", ordem: 2, papel: "comprador" },
      { chave: "k3", email: "conjuge@exemplo.com", nome: "Cônjuge Um", ordem: 3, papel: "conjuge" },
      { chave: "k4", email: "vendedora@exemplo.com", nome: "Vendedora Um", ordem: 4, papel: "vendedora" },
    ],
    unidade_id: null,
    ...p,
  };
}

function unidade(p: Partial<UnidadeDaLeitura> & { id: string }): UnidadeDaLeitura {
  return {
    codigo: "GDN0101",
    enterprise_id: "39",
    espelho_de: null,
    lote: "01",
    origem_c2x_id: 9001,
    preco_tabela: 210000,
    quadra: "01",
    ...p,
  };
}

function montar(p: Partial<LinhasDosContratos>): ContratoDoPanteon[] {
  return montarContratosDoPanteon(
    {
      contratoGeradoEm: new Map(),
      contratos: [],
      empreendimentoPorEnterprise: new Map([
        ["37", "VOC"],
        ["39", "GDN"],
      ]),
      envelopes: [],
      propostasForaDaLeitura: [],
      ultimaRodadaOkEm: RODADA_EM_DIA,
      unidades: [],
      ...p,
    },
    AGORA,
  );
}

describe("montarContratosDoPanteon", () => {
  it("⚠️ os 8 contratos da Clicksign saem das vendas nativas, com as marcas por pessoa do quadro", () => {
    const vendas = Array.from({ length: 8 }, (_, i) =>
      venda({ proposta_id: uuid(i + 1), unidade_codigo: `VOL11${String(i).padStart(2, "0")}`, unidade_id: uuid(100 + i) }),
    );
    const envelopes = vendas.map((v, i) =>
      envelope({
        estado: i < 7 ? "parcial" : "aguardando",
        proposta_id: v.proposta_id,
        signatarios: [
          { assinado_em: i < 7 ? "2026-09-26T09:00:00.000-03:00" : undefined, chave: "k1", email: "coord@careli.adm.br", nome: "Coordenadora Um", ordem: 1, papel: "coordenadora" },
          { chave: "k2", email: "comprador@exemplo.com", nome: "Comprador Um", ordem: 2, papel: "comprador" },
        ],
      }),
    );
    const contratos = montar({ contratos: vendas, envelopes });
    expect(contratos).toHaveLength(8);
    expect(contratos.every((c) => c.situacao === "em-assinatura")).toBe(true);
    expect(contratos[0]?.envelope?.pessoas).toEqual([
      { assinadoEm: "2026-09-26T09:00:00.000-03:00", degrau: 1, nome: "Coordenadora Um", papel: "coordenadora", perfil: "Coordenadora de venda", recusadoEm: null },
      { assinadoEm: null, degrau: 2, nome: "Comprador Um", papel: "comprador", perfil: "Comprador", recusadoEm: null },
    ]);
    // Sem e-mail em lugar nenhum do que sai da montagem.
    expect(JSON.stringify(contratos)).not.toContain("@");
  });

  it("⚠️ VOC0306: o envelope cancelado pela volta para correção deixa a venda aguardando emissão, e a linha diz a volta", () => {
    const v = venda({ etapa: "contrato", proposta_id: uuid(1), unidade_id: uuid(100) });
    const [c] = montar({
      contratoGeradoEm: new Map([[v.proposta_id, "2026-09-23T10:00:00+00:00"]]),
      contratos: [v],
      envelopes: [
        envelope({ estado: "cancelado", estado_cru: "panteon:retorno_para_correcao", fechado_em: "2026-09-26T18:00:00+00:00", proposta_id: v.proposta_id }),
      ],
    });
    expect(c?.situacao).toBe("aguardando-emissao");
    expect(c?.envelope).toBeNull();
    expect(c?.proposta).toMatchObject({ geradoEm: null, voltouParaCorrecaoEm: "2026-09-26" });
  });

  it("contrato novo gerado depois da volta: não diz a volta, e gerado em é o contrato novo", () => {
    const v = venda({ etapa: "contrato", proposta_id: uuid(1), unidade_id: uuid(100) });
    const [c] = montar({
      contratoGeradoEm: new Map([[v.proposta_id, "2026-09-27T10:00:00+00:00"]]),
      contratos: [v],
      envelopes: [
        envelope({ estado: "cancelado", estado_cru: "panteon:retorno_para_correcao", fechado_em: "2026-09-26T18:00:00+00:00", proposta_id: v.proposta_id }),
      ],
    });
    expect(c?.proposta).toMatchObject({ geradoEm: "2026-09-27T10:00:00+00:00", voltouParaCorrecaoEm: null });
  });

  it("⚠️ D4Sign assinado sem data por pessoa: todos contam como assinados, com a data nula", () => {
    const v = venda({ origem: "c2x", ar_c2x_id: 777, proposta_id: uuid(1), unidade_id: uuid(100) });
    const contratos = montar({
      contratos: [v],
      envelopes: [
        envelope({
          c2x_contract_signature_id: 3806,
          estado: "assinado",
          origem: "c2x",
          proposta_id: v.proposta_id,
          provedor: "d4sign",
          signatarios: [
            { chave: "c2x:1", email: "cliente@exemplo.com", nome: "Cliente D4", ordem: 2, papel: null, perfil: "Comprador" },
            { chave: "c2x:2", email: "rh@careli.adm.br", nome: "Backoffice D4", ordem: 5, papel: null, perfil: "Backoffice" },
          ],
        }),
      ],
    });
    expect(contratos[0]?.situacao).toBe("assinado");
    const quadro = quadroDosContratos(contratos, { agora: AGORA, interno: false });
    expect(quadro.unidades[0]?.esquema.map((e) => [e.situacao, e.assinadoEm])).toEqual([
      ["assinado", null],
      ["assinado", null],
    ]);
    // O envioId da D4Sign é o `contract_signatures.id` de sempre; o degrau é a posição crua do C2X.
    expect(quadro.unidades[0]?.envioId).toBe(3806);
    expect(quadro.unidades[0]?.esquema.map((e) => e.degrau)).toEqual([2, 5]);
  });

  it("⚠️ degrau cru por provedor: Clicksign sem ordem = 0; D4Sign mantém a posição (recorte misto)", () => {
    const a = venda({ proposta_id: uuid(1), unidade_codigo: "VOC0101", unidade_id: uuid(100) });
    const b = venda({ origem: "c2x", ar_c2x_id: 10, proposta_id: uuid(2), unidade_codigo: "VOC0102", unidade_id: uuid(101) });
    const contratos = montar({
      contratos: [a, b],
      envelopes: [
        envelope({ ordenada: false, proposta_id: a.proposta_id }),
        envelope({
          c2x_contract_signature_id: 50,
          origem: "c2x",
          proposta_id: b.proposta_id,
          provedor: "d4sign",
          signatarios: [{ chave: "c2x:9", email: "x@exemplo.com", nome: "Pessoa D4", ordem: 3, papel: null, perfil: "Imobiliária" }],
        }),
      ],
    });
    const quadro = quadroDosContratos(contratos, { agora: AGORA, interno: true });
    const clicksign = quadro.unidades.find((u) => u.unidade === "VOC0101");
    const d4sign = quadro.unidades.find((u) => u.unidade === "VOC0102");
    expect(new Set(clicksign?.esquema.map((e) => e.degrau))).toEqual(new Set([0]));
    expect(d4sign?.esquema.map((e) => e.degrau)).toEqual([3]);
    // As duas procedências numa fila só: a da D4Sign traz o degrau 3.
    expect(quadro.fila.map((d) => d.degrau)).toEqual([0, 3]);
  });

  it("⚠️ na linha da Têmis o papel vence o e-mail da casa (a coordenadora não vira Backoffice)", () => {
    expect(perfilDaPessoa({ email: "coord@careli.adm.br", origem: "panteon", papel: "coordenadora" })).toBe(
      "Coordenadora de venda",
    );
    expect(perfilDaPessoa({ email: "a@exemplo.com", origem: "panteon", papel: "conjuge" })).toBe("Comprador");
    expect(perfilDaPessoa({ email: "a@exemplo.com", origem: "panteon", papel: "vendedora" })).toBe("Incorporador");
    expect(perfilDaPessoa({ email: "a@exemplo.com", origem: "panteon", papel: "corretor" })).toBe("Imobiliária");
    expect(perfilDaPessoa({ email: "a@careli.adm.br", origem: "panteon", papel: "careli" })).toBe("Backoffice");
    // Na D4Sign vale o perfil gravado pelo espelho; sem ele, só o e-mail da casa.
    expect(perfilDaPessoa({ email: "huber@exemplo.com", origem: "c2x", papel: null, perfil: "Coordenadora de venda" })).toBe(
      "Coordenadora de venda",
    );
    expect(perfilDaPessoa({ email: "rh@careli.adm.br", origem: "c2x", papel: null, perfil: "" })).toBe("Backoffice");
    expect(perfilDaPessoa({ email: "x@exemplo.com", origem: "c2x", papel: null, perfil: null })).toBe("Sem perfil");
  });

  it("envioId estável: Clicksign pela chave numérica do envelope (negativa, não colide com o C2X)", () => {
    const v = venda({ proposta_id: uuid(1), unidade_id: uuid(100) });
    const e = envelope({ proposta_id: v.proposta_id });
    const q1 = quadroDosContratos(montar({ contratos: [v], envelopes: [e] }), { agora: AGORA, interno: false });
    const q2 = quadroDosContratos(montar({ contratos: [v], envelopes: [e] }), { agora: AGORA, interno: false });
    expect(q1.unidades[0]?.envioId).toBe(chaveNumerica(e.id));
    expect(q1.unidades[0]?.envioId).toBe(q2.unidades[0]?.envioId);
    expect(q1.unidades[0]?.envioId).toBeLessThan(0);
    expect(chaveNumerica(uuid(1))).not.toBe(chaveNumerica(uuid(2)));
  });

  it("a unidade é o código de `hercules_unidades` e o empreendimento o código do cadastro", () => {
    const [c] = montar({ contratos: [venda({ proposta_id: uuid(1), unidade_id: uuid(100) })] });
    expect(c?.unidade).toMatchObject({ codigo: "VOC0306", empreendimento: "VOC", enterpriseId: "37" });
  });

  it("⚠️ temContrato = D4Sign vigente com documento, em qualquer estado; Clicksign nunca (PDF não guardado)", () => {
    const a = venda({ proposta_id: uuid(1), unidade_codigo: "VOC0101", unidade_id: uuid(100) });
    const b = venda({ origem: "c2x", ar_c2x_id: 11, proposta_id: uuid(2), unidade_codigo: "VOC0102", unidade_id: uuid(101) });
    const envD4 = envelope({ c2x_contract_signature_id: 60, estado: "aguardando", origem: "c2x", proposta_id: b.proposta_id, provedor: "d4sign" });
    const quadro = quadroDosContratos(
      montar({ contratos: [a, b], envelopes: [envelope({ proposta_id: a.proposta_id }), envD4] }),
      { agora: AGORA, interno: false },
    );
    const clicksign = quadro.unidades.find((u) => u.unidade === "VOC0101");
    const d4sign = quadro.unidades.find((u) => u.unidade === "VOC0102");
    expect(clicksign?.contrato).toMatchObject({ temContrato: false });
    expect(clicksign?.contrato?.contratoId).toBeUndefined();
    expect(d4sign?.contrato).toMatchObject({ contratoId: envD4.id, temContrato: true, unitId: 5001 });
  });

  it("⚠️ o assinado vence o vivo mais novo, e o vivo a mais é aviso INTERNO de dois contratos", () => {
    const v = venda({ proposta_id: uuid(1), unidade_id: uuid(100) });
    const [c] = montar({
      contratos: [v],
      envelopes: [
        envelope({ criado_em: "2026-09-10T10:00:00+00:00", estado: "assinado", fechado_em: "2026-09-11T10:00:00+00:00", proposta_id: v.proposta_id }),
        envelope({ criado_em: "2026-09-20T10:00:00+00:00", estado: "parcial", proposta_id: v.proposta_id }),
      ],
    });
    expect(c?.situacao).toBe("assinado");
    expect(c?.avisos).toContain("dois_contratos_vivos");
    expect(c?.outrosVivos).toHaveLength(1);
  });

  it("⚠️ a campainha: D4Sign com a última rodada boa há mais de 2 h acende o aviso da fonte", () => {
    const v = venda({ origem: "c2x", ar_c2x_id: 12, proposta_id: uuid(1), unidade_id: uuid(100) });
    const env = envelope({ c2x_contract_signature_id: 70, origem: "c2x", proposta_id: v.proposta_id, provedor: "d4sign" });
    const atrasado = montar({ contratos: [v], envelopes: [env], ultimaRodadaOkEm: "2026-09-28T11:00:00-03:00" });
    expect(atrasado[0]?.avisos).toContain("conferencia_atrasada");
    expect(quadroDosContratos(atrasado, { agora: AGORA, interno: true }).avisoDaFonte).toMatch(/atrasada/);
    const emDia = montar({ contratos: [v], envelopes: [env] });
    expect(quadroDosContratos(emDia, { agora: AGORA, interno: true }).avisoDaFonte).toBeNull();
  });
});

describe("as respostas do Lucas (28/09/2026)", () => {
  it("⚠️ resposta 1: o envelope sem venda (o Garden) vira linha também no portal, com o comprador pelos signatários", () => {
    const u = unidade({ id: uuid(500) });
    const env = envelope({
      c2x_contract_signature_id: 4001,
      estado: "parcial",
      origem: "c2x",
      proposta_id: null,
      provedor: "d4sign",
      signatarios: [
        { assinado_em: "2026-09-27T10:00:00.000-03:00", chave: "c2x:1", email: "comp@exemplo.com", nome: "Comprador Garden", ordem: 0, papel: null, perfil: "Comprador" },
        { chave: "c2x:2", email: "inc@exemplo.com", nome: "Incorporadora", ordem: 0, papel: null, perfil: "Incorporador" },
      ],
      unidade_id: u.id,
    });
    const contratos = montar({ envelopes: [env], unidades: [u] });
    expect(contratos).toHaveLength(1);
    expect(contratos[0]).toMatchObject({ avisos: ["envelope_sem_venda"], noPortal: true, proposta: null, situacao: "em-assinatura" });
    expect(contratos[0]?.unidade).toMatchObject({ codigo: "GDN0101", empreendimento: "GDN" });

    const portal = quadroParaOPortal(quadroDosContratos(contratos, { agora: AGORA, interno: false }));
    expect(portal.unidades).toHaveLength(1);
    expect(portal.unidades[0]).toMatchObject({ comprador: "Comprador Garden", empreendimento: "GDN", unidade: "GDN0101" });
    // No portal a linha não diz por que não tem venda.
    expect(JSON.stringify(portal)).not.toMatch(/sem_venda|Venda fora|Panteon/);
    // Na tela interna, o aviso.
    const interno = quadroDosContratos(contratos, { agora: AGORA, interno: true });
    expect(interno.unidades[0]?.aviso).toMatch(/Venda fora do Panteon/);
  });

  it("⚠️ resposta 2: contrato de venda desfeita some do portal e fica na tela interna com o aviso", () => {
    const u = unidade({ codigo: "VOC0909", enterprise_id: "37", id: uuid(600) });
    const fora: PropostaForaDaLeitura = { cancelada_em: "2026-09-10T10:00:00+00:00", etapa: "cancelado", id: uuid(9), origem: "c2x", unidade_id: u.id };
    const env = envelope({ c2x_contract_signature_id: 5005, origem: "c2x", proposta_id: fora.id, provedor: "d4sign", unidade_id: u.id });
    const contratos = montar({ envelopes: [env], propostasForaDaLeitura: [fora], unidades: [u] });
    expect(contratos[0]).toMatchObject({ avisos: ["contrato_de_venda_desfeita"], noPortal: false, propostaDoEnvelope: fora.id });

    const portal = quadroDosContratos(contratos, { agora: AGORA, interno: false });
    expect(portal.unidades).toHaveLength(0);
    expect(portal.totais.contratos).toBe(0);
    const interno = quadroDosContratos(contratos, { agora: AGORA, interno: true });
    expect(interno.unidades).toHaveLength(1);
    // Sem dados de contrato: não é a venda viva (a régua do legado para envio de proposta morta).
    expect(interno.unidades[0]?.contrato).toBeNull();
    expect(interno.unidades[0]?.aviso).toMatch(/venda desfeita/);
  });

  it("⚠️ a venda aguardando emissão no MESMO terreno de um envelope sem venda sai do portal (o contrato correu pelo C2X)", () => {
    // A reserva no pai (linha-sombra) aponta para a unidade viva do filho: mesmo terreno.
    const viva = venda({ etapa: "contrato", proposta_id: uuid(1), unidade_codigo: "VOC0306", unidade_id: uuid(100) });
    const sombra = unidade({ codigo: "VLO0306", enterprise_id: "38", espelho_de: uuid(100), id: uuid(700), origem_c2x_id: 8001 });
    const env = envelope({ c2x_contract_signature_id: 6006, origem: "c2x", proposta_id: null, provedor: "d4sign", unidade_id: sombra.id });
    const contratos = montar({ contratos: [viva], envelopes: [env], unidades: [sombra] });
    const daVenda = contratos.find((c) => c.proposta?.id === viva.proposta_id);
    const doEnvelope = contratos.find((c) => c.avisos.includes("envelope_sem_venda"));
    expect(daVenda?.unidade.terrenoId).toBe(doEnvelope?.unidade.terrenoId);
    expect(daVenda?.noPortal).toBe(false);
    expect(doEnvelope?.noPortal).toBe(true);
    expect(quadroDosContratos(contratos, { agora: AGORA, interno: false }).unidades.map((u) => u.situacao)).toEqual([
      "em-assinatura",
    ]);
  });

  it("venda com envelope próprio no mesmo terreno: ficam as duas (dois contratos de verdade)", () => {
    const viva = venda({ proposta_id: uuid(1), unidade_id: uuid(100) });
    const sombra = unidade({ enterprise_id: "38", espelho_de: uuid(100), id: uuid(700) });
    const contratos = montar({
      contratos: [viva],
      envelopes: [
        envelope({ proposta_id: viva.proposta_id }),
        envelope({ c2x_contract_signature_id: 6007, origem: "c2x", proposta_id: null, provedor: "d4sign", unidade_id: sombra.id }),
      ],
      unidades: [sombra],
    });
    expect(contratos.filter((c) => c.noPortal)).toHaveLength(2);
  });

  it("⚠️ o envelope ligado a venda viva de OUTRO recorte não vira 'sem venda' aqui", () => {
    const u = unidade({ enterprise_id: "38", id: uuid(700) });
    const fora: PropostaForaDaLeitura = { cancelada_em: null, etapa: "assinatura", id: uuid(9), origem: "panteon", unidade_id: uuid(999) };
    const contratos = montar({
      envelopes: [envelope({ proposta_id: fora.id, unidade_id: u.id })],
      propostasForaDaLeitura: [fora],
      unidades: [u],
    });
    expect(contratos).toHaveLength(0);
  });

  it("⚠️ a proposta DA CARGA na sombra do pai (que a view tira) aparece pelo envelope", () => {
    const sombra = unidade({ enterprise_id: "38", espelho_de: uuid(100), id: uuid(700) });
    const fora: PropostaForaDaLeitura = { cancelada_em: null, etapa: "faturado", id: uuid(9), origem: "c2x", unidade_id: sombra.id };
    const contratos = montar({
      envelopes: [envelope({ c2x_contract_signature_id: 1, origem: "c2x", proposta_id: fora.id, provedor: "d4sign", unidade_id: sombra.id })],
      propostasForaDaLeitura: [fora],
      unidades: [sombra],
    });
    expect(contratos).toHaveLength(1);
    expect(contratos[0]?.avisos).toContain("envelope_sem_venda");
  });

  it("⚠️ unidade revendida sem venda: vale o contrato VIVO do comprador atual, e o assinado do anterior fica interno", () => {
    const u = unidade({ id: uuid(500) });
    const antigoAssinado = envelope({
      c2x_contract_signature_id: 100,
      criado_em: "2025-03-10T10:00:00-03:00",
      enviado_em: "2025-03-10T10:00:00-03:00",
      estado: "assinado",
      fechado_em: "2025-03-20T10:00:00-03:00",
      origem: "c2x",
      proposta_id: null,
      provedor: "d4sign",
      signatarios: [{ chave: "c2x:1", email: "antigo@exemplo.com", nome: "Comprador Anterior", ordem: 0, papel: null, perfil: "Comprador" }],
      unidade_id: u.id,
    });
    const novoEmAssinatura = envelope({
      c2x_contract_signature_id: 200,
      criado_em: "2026-09-26T10:00:00-03:00",
      enviado_em: "2026-09-26T10:00:00-03:00",
      estado: "aguardando",
      origem: "c2x",
      proposta_id: null,
      provedor: "d4sign",
      signatarios: [{ chave: "c2x:2", email: "atual@exemplo.com", nome: "Comprador Atual", ordem: 0, papel: null, perfil: "Comprador" }],
      unidade_id: u.id,
    });
    const contratos = montar({ envelopes: [antigoAssinado, novoEmAssinatura], unidades: [u] });
    expect(contratos).toHaveLength(1);
    expect(contratos[0]).toMatchObject({ noPortal: true, situacao: "em-assinatura" });
    expect(contratos[0]?.envelope?.c2xContractSignatureId).toBe(200);
    expect(contratos[0]?.outrosVivos.map((e) => e.c2xContractSignatureId)).toEqual([100]);
    expect(contratos[0]?.avisos).toContain("dois_contratos_vivos");

    const portal = quadroParaOPortal(quadroDosContratos(contratos, { agora: AGORA, interno: false }));
    expect(portal.unidades.map((l) => [l.envioId, l.comprador, l.situacao])).toEqual([[200, "Comprador Atual", "em-assinatura"]]);
  });

  it("⚠️ o contrato de um comprador ANTERIOR não tira do portal a venda nova que espera emissão no terreno", () => {
    // A venda nova (a da Cecília no Garden) é de DEPOIS do envio antigo: as duas linhas ficam.
    const u = unidade({ id: uuid(500) });
    const vendaNova = venda({
      criado_em: "2026-09-27T10:00:00+00:00",
      empreendimento_codigo: "GDN",
      enterprise_id: "39",
      etapa: "contrato",
      lote: u.lote,
      proposta_id: uuid(1),
      quadra: u.quadra,
      unidade_codigo: "GDN0101",
      unidade_id: u.id,
    });
    const antigo = envelope({
      c2x_contract_signature_id: 100,
      criado_em: "2025-03-10T10:00:00-03:00",
      enviado_em: "2025-03-10T10:00:00-03:00",
      estado: "assinado",
      origem: "c2x",
      proposta_id: null,
      provedor: "d4sign",
      unidade_id: u.id,
    });
    const contratos = montar({ contratos: [vendaNova], envelopes: [antigo], unidades: [u] });
    const daVenda = contratos.find((c) => c.proposta?.id === vendaNova.proposta_id);
    expect(daVenda).toMatchObject({ noPortal: true, situacao: "aguardando-emissao" });
    expect(contratos.filter((c) => c.noPortal)).toHaveLength(2);
  });

  it("venda sem data de criação não é substituída pelo envelope do terreno (sem palpite)", () => {
    const viva = venda({ criado_em: null, etapa: "contrato", proposta_id: uuid(1), unidade_id: uuid(100) });
    const sombra = unidade({ codigo: "VLO0306", enterprise_id: "38", espelho_de: uuid(100), id: uuid(700) });
    const env = envelope({ c2x_contract_signature_id: 6006, origem: "c2x", proposta_id: null, provedor: "d4sign", unidade_id: sombra.id });
    const contratos = montar({ contratos: [viva], envelopes: [env], unidades: [sombra] });
    expect(contratos.find((c) => c.proposta?.id === viva.proposta_id)?.noPortal).toBe(true);
  });

  it("grupo sem nenhum envelope vigente (todos cancelados) não vira linha", () => {
    const u = unidade({ id: uuid(500) });
    const contratos = montar({
      envelopes: [envelope({ estado: "cancelado", origem: "c2x", proposta_id: null, provedor: "d4sign", unidade_id: u.id })],
      unidades: [u],
    });
    expect(contratos).toHaveLength(0);
  });
});

// OS CRITÉRIOS DE PARIDADE da v1.389.0/v1.390.0 (assinaturas-do-panteon.test.ts), portados para o
// caminho novo: a rota não chama mais `linhasDeAssinaturaDoPanteon`, e o teste antigo seguir verde
// não prova nada sobre o que a tela mostra agora.
describe("paridade com os testes da v1.389.0 e da v1.390.0, no caminho novo", () => {
  // O CASO DO LUCAS (28/09/2026, VOL 11 06): enviado pela Clicksign em 25/09, as três coordenadoras no
  // degrau 1 e duas já assinaram. A linha tem de dizer 2 de 5, com o degrau 1 ainda na vez.
  it("⚠️ VOL 11 06: quem assinou pessoa a pessoa, 2 de 5, e a vez é o menor degrau pendente", () => {
    const v = venda({ lote: "06", proposta_id: uuid(1), quadra: "11", unidade_codigo: "VOL1106", unidade_id: uuid(100) });
    const contratos = montar({
      contratos: [v],
      envelopes: [
        envelope({
          estado: "parcial",
          ordenada: true,
          proposta_id: v.proposta_id,
          signatarios: [
            { assinado_em: "2026-09-28T13:12:50.000-03:00", chave: "k1", email: "coord1@careli.adm.br", nome: "Coord Um", ordem: 1, papel: "coordenadora" },
            { assinado_em: "2026-09-28T13:12:51.000-03:00", chave: "k2", email: "trocado@careli.adm.br", nome: "Coord Dois", ordem: 1, papel: "coordenadora" },
            { chave: "k3", email: "coord3@careli.adm.br", nome: "Coord Tres", ordem: 1, papel: "coordenadora" },
            { chave: "k4", email: "comprador@exemplo.com", nome: "Jonatas", ordem: 2, papel: "comprador" },
            { chave: "k5", email: "vend@careli.adm.br", nome: "Vendedora", ordem: 3, papel: "vendedora" },
          ],
        }),
      ],
    });
    const [linha] = quadroParaOPortal(quadroDosContratos(contratos, { agora: AGORA, interno: false })).unidades;
    expect(linha).toMatchObject({
      assinadas: 2,
      concluida: false,
      naVez: ["Coord Tres"],
      perfisNaVez: ["Coordenadora de venda"],
      situacao: "em-assinatura",
      total: 5,
      unidade: "VOL1106",
    });
    expect(
      [...(linha?.esquema ?? [])]
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
        .map((item) => [item.nome, item.degrau, item.situacao, item.assinadoEm]),
    ).toEqual([
      ["Coord Dois", 1, "assinado", "2026-09-28"],
      ["Coord Tres", 1, "vez", null],
      ["Coord Um", 1, "assinado", "2026-09-28"],
      ["Jonatas", 2, "aguardando", null],
      ["Vendedora", 3, "aguardando", null],
    ]);
    expect(JSON.stringify(linha)).not.toContain("@");
  });

  it("envelope sem ordem (ordenada = false): todos os pendentes NA VEZ, no degrau 0", () => {
    const v = venda({ proposta_id: uuid(1), unidade_id: uuid(100) });
    const contratos = montar({ contratos: [v], envelopes: [envelope({ ordenada: false, proposta_id: v.proposta_id })] });
    const [linha] = quadroDosContratos(contratos, { agora: AGORA, interno: false }).unidades;
    expect(linha?.esquema.length).toBeGreaterThan(0);
    expect(linha?.esquema.every((item) => item.situacao === "vez" && item.degrau === 0)).toBe(true);
  });

  it("⚠️ `data_assinatura` da venda NÃO faz a linha assinada: sem envelope, aguardando emissão; com a D4Sign assinada, assinado", () => {
    // Mudança deliberada em relação à v1.389.0 ("a data de assinatura da proposta também conta"): a
    // linha é o CONTRATO, e o contrato assinado é o envelope. O teste antigo sai com a função velha (F7).
    const carga = venda({ ar_c2x_id: 31, data_assinatura: "2026-09-12", origem: "c2x", proposta_id: uuid(1), unidade_id: uuid(100) });
    expect(montar({ contratos: [carga] })[0]?.situacao).toBe("aguardando-emissao");
    const comEnvelope = montar({
      contratos: [carga],
      envelopes: [envelope({ c2x_contract_signature_id: 81, estado: "assinado", origem: "c2x", proposta_id: carga.proposta_id, provedor: "d4sign" })],
    });
    expect(comEnvelope[0]?.situacao).toBe("assinado");
  });

  it("⚠️ 'gerado em' na nativa é o contrato gerado; com o mapa lido e sem contrato, NULO (e não a entrada na etapa)", () => {
    const comContrato = venda({ proposta_id: uuid(1), unidade_codigo: "VOC0101", unidade_id: uuid(100) });
    const semContrato = venda({ proposta_id: uuid(2), unidade_codigo: "VOC0102", unidade_id: uuid(101) });
    const lidos = montar({
      contratoGeradoEm: new Map([[comContrato.proposta_id, "2026-09-09T12:00:00.000Z"]]),
      contratos: [comContrato, semContrato],
    });
    expect(lidos.map((c) => c.proposta?.geradoEm)).toEqual(["2026-09-09T12:00:00.000Z", null]);
    // Mapa fora do ar: a primeira passagem para `contrato` da view, para não perder a data por uma leitura acessória.
    const semMapa = montar({ contratoGeradoEm: null, contratos: [semContrato] });
    expect(semMapa[0]?.proposta?.geradoEm).toBe(semContrato.gerado_em);
    // Venda da carga: a passagem da view (diferença declarada e medida no ensaio).
    const carga = venda({ ar_c2x_id: 32, origem: "c2x", proposta_id: uuid(3), unidade_id: uuid(102) });
    expect(montar({ contratos: [carga] })[0]?.proposta?.geradoEm).toBe(carga.gerado_em);
  });

  it("⚠️ temContrato: D4Sign vigente SEM documento no provedor não tem PDF; assinada com documento tem", () => {
    const a = venda({ ar_c2x_id: 41, origem: "c2x", proposta_id: uuid(1), unidade_codigo: "VOC0101", unidade_id: uuid(100) });
    const b = venda({ ar_c2x_id: 42, origem: "c2x", proposta_id: uuid(2), unidade_codigo: "VOC0102", unidade_id: uuid(101) });
    const quadro = quadroDosContratos(
      montar({
        contratos: [a, b],
        envelopes: [
          envelope({ c2x_contract_signature_id: 91, origem: "c2x", proposta_id: a.proposta_id, provedor: "d4sign", provedor_documento_id: null }),
          envelope({ c2x_contract_signature_id: 92, estado: "assinado", origem: "c2x", proposta_id: b.proposta_id, provedor: "d4sign" }),
        ],
      }),
      { agora: AGORA, interno: false },
    );
    const semDocumento = quadro.unidades.find((u) => u.unidade === "VOC0101");
    const assinada = quadro.unidades.find((u) => u.unidade === "VOC0102");
    expect(semDocumento?.contrato).toMatchObject({ temContrato: false });
    expect(semDocumento?.contrato?.contratoId).toBeUndefined();
    expect(assinada?.contrato).toMatchObject({ temContrato: true });
  });

  it("⚠️ Regressão M1: com mais de 500 contratos, os totais contam o recorte inteiro e a lista vem com o aviso do teto", () => {
    const vendas = Array.from({ length: 520 }, (_, i) =>
      venda({ proposta_id: uuid(i + 1), unidade_codigo: `VOC${String(i).padStart(4, "0")}`, unidade_id: uuid(10_000 + i) }),
    );
    const contratos = montar({ contratos: vendas, envelopes: vendas.map((v) => envelope({ proposta_id: v.proposta_id })) });
    const quadro = quadroDosContratos(contratos, { agora: AGORA, interno: false });
    expect(quadro.totais.contratos).toBe(520);
    expect(quadro.totais.emAssinatura).toBe(520);
    expect(quadro.unidades.length).toBeLessThan(quadro.totais.contratos);
    expect(quadro.aviso).toMatch(/Mostrando os 500/);
    expect(quadroParaOPortal(quadro).totais.contratos).toBe(520);
  });
});

describe("quadroDosContratos e o portal", () => {
  const cenario = () => {
    const vendas = [
      venda({ proposta_id: uuid(1), unidade_codigo: "VOC0101", unidade_id: uuid(100) }),
      venda({ data_faturamento: "2026-09-15", etapa: "faturado", origem: "c2x", ar_c2x_id: 21, proposta_id: uuid(2), unidade_codigo: "VOC0102", unidade_id: uuid(101) }),
      venda({ etapa: "contrato", proposta_id: uuid(3), unidade_codigo: "VOC0103", unidade_id: uuid(102) }),
    ];
    const envelopes = [
      envelope({ proposta_id: uuid(1) }),
      envelope({
        c2x_contract_signature_id: 99,
        estado: "assinado",
        fechado_em: "2026-09-12T10:00:00-03:00",
        origem: "c2x",
        proposta_id: uuid(2),
        provedor: "d4sign",
        signatarios: [
          { assinado_em: "2026-09-12T10:00:00.000-03:00", chave: "c2x:5", email: "cli@exemplo.com", nome: "Cliente Dois", ordem: 1, papel: null, perfil: "Comprador" },
        ],
      }),
    ];
    return montar({ contratos: vendas, envelopes });
  };

  it("⚠️ os totais do recorte inteiro, por situação e por empreendimento", () => {
    const quadro = quadroDosContratos(cenario(), { agora: AGORA, interno: false });
    expect(quadro.totais).toMatchObject({ aguardandoEmissao: 1, assinados: 1, contratos: 3, emAssinatura: 1, faturados: 1 });
    expect(quadro.totais.porEmpreendimento).toEqual([
      { aguardandoEmissao: 1, assinados: 1, contratos: 3, emAssinatura: 1, empreendimento: "VOC", faturados: 1 },
    ]);
    expect(quadro.kpis.aguardandoEmissao).toBe(1);
    expect(quadro.conciliando).toBe(false);
    expect(quadro.unidades.every((u) => u.fonte === "panteon")).toBe(true);
  });

  it("⚠️ o portal é uma allowlist: sem e-mail, provedor, fonte, aviso de linha, documento nem vocabulário interno", () => {
    const portal = quadroParaOPortal(quadroDosContratos(cenario(), { agora: AGORA, interno: false }));
    const json = JSON.stringify(portal);
    for (const proibido of ["@", "\"email\"", "\"provedor\"", "\"fonte\"", "\"avisos\"", "outrosVivos", "documentoId", "provedorDocumentoId", "estadoCru", "conferidoEm", "C2X", "D4Sign", "Clicksign", "espelho"]) {
      expect(json).not.toContain(proibido);
    }
    for (const linha of portal.unidades) expect(Object.keys(linha)).not.toContain("aviso");
    expect(portal.avisoDosAssinantes).toBeNull();
  });

  it("contratosDoPortal: do mais recente, contagem antes do teto, e só as linhas do portal", () => {
    const lista = contratosDoPortal(cenario(), 2);
    expect(lista.total).toBe(3);
    expect(lista.truncado).toBe(true);
    expect(lista.contratos).toHaveLength(2);
    expect(lista.porSituacao).toEqual({ "aguardando-emissao": 1, assinado: 1, "em-assinatura": 1 });
    expect(JSON.stringify(lista)).not.toContain("@");
  });
});
