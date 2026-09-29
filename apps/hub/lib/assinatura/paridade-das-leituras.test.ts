import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CATEGORIAS_EXPLICADAS,
  compararLeituras,
  type FatosDaParidade,
  type LinhaComparavel,
  type LinhaNova,
  type RelatorioDaParidade,
  totalInexplicado,
} from "./paridade-das-leituras";

// A TRAVA DA F4 (o ensaio de paridade): cada diferença entre o leitor antigo e a leitura única cai
// numa categoria que o plano ou uma resposta do Lucas explica; o resto é `inexplicado`, e o deploy
// espera. Dados inventados, sem pessoa nenhuma.

const fatosVazios = (p: Partial<FatosDaParidade> = {}): FatosDaParidade => ({
  arsVivosNoC2x: new Set(),
  chavesSoNoC2x: new Set(),
  duplicatasDeGleba: new Set(),
  envios: new Map(),
  ...p,
});

type FatoDoEnvio = FatosDaParidade["envios"] extends ReadonlyMap<number, infer V> ? V : never;
const fatoDoEnvio = (p: Partial<FatoDoEnvio> = {}): FatoDoEnvio => ({
  arId: null,
  semUuid: false,
  status6: false,
  tipoNaoMapeado: false,
  unidadeForaDoPanteon: false,
  ...p,
});

const antiga = (p: Partial<LinhaComparavel> & { unidade: string }): LinhaComparavel => ({
  assinadas: 0,
  empreendimento: "VOC",
  esquema: ["1:Comprador"],
  envioId: 0,
  situacao: "aguardando-emissao",
  temContrato: false,
  temGeradoEm: false,
  total: 0,
  ...p,
});

const nova = (p: Partial<LinhaNova> & { unidade: string }): LinhaNova => ({
  ...antiga(p),
  arC2xId: null,
  avisos: [],
  noPortal: true,
  origemDaVenda: "panteon",
  propostaId: "p1",
  provedor: null,
  ...p,
});

describe("compararLeituras", () => {
  it("linha igual é igual; o mesmo envio da D4Sign pareia pelo número", () => {
    const r = compararLeituras(
      [antiga({ assinadas: 2, envioId: 3806, situacao: "em-assinatura", total: 3, unidade: "VOC0101" })],
      [nova({ assinadas: 2, envioId: 3806, provedor: "d4sign", situacao: "em-assinatura", total: 3, unidade: "VOC0101" })],
      fatosVazios(),
    );
    expect(r.porCategoria).toEqual({ igual: 1 });
  });

  it("⚠️ a nativa da Clicksign sai de 'aguardando emissão' (a redigitação) para em assinatura", () => {
    const r = compararLeituras(
      [antiga({ unidade: "VOL1106" })],
      [nova({ assinadas: 2, envioId: -5, provedor: "clicksign", situacao: "em-assinatura", total: 11, unidade: "VOL1106" })],
      fatosVazios(),
    );
    expect(r.porCategoria).toEqual({ clicksign_no_panteon: 1 });
  });

  it("⚠️ a Clicksign que o antigo JÁ mostrava (envioId 0) só se explica andando para a frente", () => {
    const avancou = compararLeituras(
      [antiga({ assinadas: 2, situacao: "em-assinatura", total: 11, unidade: "VOL1106" })],
      [nova({ assinadas: 3, envioId: -5, provedor: "clicksign", situacao: "em-assinatura", total: 11, unidade: "VOL1106" })],
      fatosVazios(),
    );
    expect(avancou.porCategoria).toEqual({ clicksign_no_panteon: 1 });

    // 2/11 → 0/11: as marcas sumiram (o backfill da F1 que não rodou). Não se esconde.
    const perdeuMarcas = compararLeituras(
      [antiga({ assinadas: 2, situacao: "em-assinatura", total: 11, unidade: "VOL1106" })],
      [nova({ assinadas: 0, envioId: -5, provedor: "clicksign", situacao: "em-assinatura", total: 11, unidade: "VOL1106" })],
      fatosVazios(),
    );
    expect(totalInexplicado(perdeuMarcas)).toBe(1);

    // assinado 11/11 → em assinatura 3/11.
    const desassinou = compararLeituras(
      [antiga({ assinadas: 11, situacao: "assinado", total: 11, unidade: "VOL1106" })],
      [nova({ assinadas: 3, envioId: -5, provedor: "clicksign", situacao: "em-assinatura", total: 11, unidade: "VOL1106" })],
      fatosVazios(),
    );
    expect(totalInexplicado(desassinou)).toBe(1);
  });

  it("⚠️ Clicksign no lugar de um envio da D4Sign que o antigo mostrava: outro contrato, inexplicado", () => {
    const r = compararLeituras(
      [antiga({ assinadas: 1, envioId: 3806, situacao: "em-assinatura", total: 3, unidade: "VOC0101" })],
      [nova({ assinadas: 2, envioId: -5, provedor: "clicksign", situacao: "em-assinatura", total: 4, unidade: "VOC0101" })],
      fatosVazios(),
    );
    expect(totalInexplicado(r)).toBe(1);
  });

  it("⚠️ nativa ligada: explicada sobre o 'aguardando emissão' antigo; a que recua, ou troca o envio do antigo, não", () => {
    const ligou = compararLeituras(
      [antiga({ unidade: "ACP0101" , empreendimento: "ACP" })],
      [nova({ assinadas: 1, empreendimento: "ACP", envioId: 3900, provedor: "d4sign", situacao: "em-assinatura", total: 3, unidade: "ACP0101" })],
      fatosVazios(),
    );
    expect(ligou.porCategoria).toEqual({ nativa_ligada: 1 });

    const recuou = compararLeituras(
      [antiga({ assinadas: 3, envioId: 3806, situacao: "assinado", total: 3, unidade: "ACP0101", empreendimento: "ACP" })],
      [nova({ assinadas: 1, empreendimento: "ACP", envioId: 3900, provedor: "d4sign", situacao: "em-assinatura", total: 3, unidade: "ACP0101" })],
      fatosVazios(),
    );
    expect(totalInexplicado(recuou)).toBe(1);

    const trocouOEnvio = compararLeituras(
      [antiga({ assinadas: 1, envioId: 3806, situacao: "em-assinatura", total: 3, unidade: "ACP0101", empreendimento: "ACP" })],
      [nova({ assinadas: 2, empreendimento: "ACP", envioId: 3900, provedor: "d4sign", situacao: "em-assinatura", total: 3, unidade: "ACP0101" })],
      fatosVazios(),
    );
    expect(totalInexplicado(trocouOEnvio)).toBe(1);
  });

  it("⚠️ resposta 1: a venda que não está no Panteon aparece pelo envelope", () => {
    const r = compararLeituras(
      [antiga({ empreendimento: "GDN", envioId: 4001, situacao: "em-assinatura", total: 2, unidade: "GDN0101" })],
      [nova({ avisos: ["envelope_sem_venda"], empreendimento: "GDN", envioId: 4001, provedor: "d4sign", situacao: "em-assinatura", total: 2, unidade: "GDN0101", assinadas: 1 })],
      fatosVazios(),
    );
    // O mesmo envio, o espelho um passo à frente.
    expect(r.porCategoria).toEqual({ d4sign_mais_recente: 1 });
    const soNovo = compararLeituras([], [nova({ avisos: ["envelope_sem_venda"], empreendimento: "GDN", unidade: "GDN0102" })], fatosVazios());
    expect(soNovo.porCategoria).toEqual({ presente_pelo_envelope: 1 });
    // Em par, só sobre o antigo sem envio.
    const emPar = compararLeituras(
      [antiga({ empreendimento: "GDN", unidade: "GDN0103" })],
      [nova({ avisos: ["envelope_sem_venda"], empreendimento: "GDN", envioId: 4003, origemDaVenda: null, propostaId: null, provedor: "d4sign", situacao: "em-assinatura", total: 2, unidade: "GDN0103" })],
      fatosVazios(),
    );
    expect(emPar.porCategoria).toEqual({ presente_pelo_envelope: 1 });
  });

  it("⚠️ unidade revendida: o antigo com o envio VIVO do comprador novo e o novo com o ASSINADO do anterior é inexplicado", () => {
    const r = compararLeituras(
      [antiga({ empreendimento: "GDN", envioId: 200, situacao: "em-assinatura", total: 2, unidade: "GDN0101" })],
      [
        nova({
          assinadas: 2,
          avisos: ["envelope_sem_venda"],
          empreendimento: "GDN",
          envioId: 100,
          origemDaVenda: null,
          propostaId: null,
          provedor: "d4sign",
          situacao: "assinado",
          total: 2,
          unidade: "GDN0101",
        }),
      ],
      fatosVazios({ envios: new Map([[200, fatoDoEnvio({ arId: 902 })]]) }),
    );
    expect(totalInexplicado(r)).toBe(1);
  });

  it("⚠️ unidade revendida certa: o envio do comprador anterior (pedido desfeito no C2X) sai explicado pela resposta 2", () => {
    const r = compararLeituras(
      [
        antiga({ assinadas: 2, empreendimento: "GDN", envioId: 100, situacao: "assinado", total: 2, unidade: "GDN0101" }),
        antiga({ empreendimento: "GDN", envioId: 200, situacao: "em-assinatura", total: 2, unidade: "GDN0101" }),
      ],
      [nova({ avisos: ["envelope_sem_venda"], empreendimento: "GDN", envioId: 200, origemDaVenda: null, propostaId: null, provedor: "d4sign", situacao: "em-assinatura", total: 2, unidade: "GDN0101" })],
      fatosVazios({
        arsVivosNoC2x: new Set([902]),
        envios: new Map([
          [100, fatoDoEnvio({ arId: 901 })],
          [200, fatoDoEnvio({ arId: 902 })],
        ]),
      }),
    );
    expect(r.porCategoria).toEqual({ contrato_anterior_da_revenda: 1, igual: 1 });
  });

  it("⚠️ resposta 2: o contrato de venda desfeita só na tela interna é explicado", () => {
    const r = compararLeituras(
      [antiga({ envioId: 77, situacao: "em-assinatura", unidade: "VOC0909" })],
      [nova({ avisos: ["contrato_de_venda_desfeita"], envioId: 77, noPortal: false, unidade: "VOC0909" })],
      fatosVazios(),
    );
    expect(r.porCategoria).toEqual({ venda_desfeita_so_interna: 1 });
  });

  it("⚠️ a venda substituída pelo envelope do terreno: explicada só se o envio do antigo segue no portal", () => {
    const envelopeNoPai = nova({ avisos: ["envelope_sem_venda"], empreendimento: "VLO", envioId: 6006, origemDaVenda: null, propostaId: null, provedor: "d4sign", situacao: "em-assinatura", total: 2, unidade: "VLO0306" });
    const escondida = nova({ noPortal: false, unidade: "VOC0306" });
    const segue = compararLeituras([antiga({ envioId: 6006, situacao: "em-assinatura", total: 2, unidade: "VOC0306" })], [escondida, envelopeNoPai], fatosVazios());
    expect(segue.porCategoria).toEqual({ presente_pelo_envelope: 1, substituida_pelo_envelope: 1 });

    const sumiu = compararLeituras([antiga({ envioId: 7007, situacao: "em-assinatura", total: 2, unidade: "VOC0306" })], [escondida, envelopeNoPai], fatosVazios());
    expect(sumiu.porCategoria.inexplicado).toBe(1);

    const aguardandoDosDois = compararLeituras([antiga({ unidade: "VOC0306" })], [escondida], fatosVazios());
    expect(aguardandoDosDois.porCategoria).toEqual({ substituida_pelo_envelope: 1 });
  });

  it("mesmas contagens: o botão do PDF diferente e o degrau/perfil diferente são categorias próprias", () => {
    const r = compararLeituras(
      [
        antiga({ assinadas: 1, envioId: 10, situacao: "em-assinatura", temContrato: false, total: 2, unidade: "VOC0001" }),
        antiga({ assinadas: 1, envioId: 11, esquema: ["1:Comprador", "2:Imobiliária"], situacao: "em-assinatura", total: 2, unidade: "VOC0002" }),
      ],
      [
        nova({ assinadas: 1, envioId: 10, provedor: "d4sign", situacao: "em-assinatura", temContrato: true, total: 2, unidade: "VOC0001" }),
        nova({ assinadas: 1, envioId: 11, esquema: ["0:Comprador", "0:Imobiliária"], provedor: "d4sign", situacao: "em-assinatura", total: 2, unidade: "VOC0002" }),
      ],
      fatosVazios(),
    );
    expect(r.porCategoria).toEqual({ degrau_ou_perfil: 1, tem_contrato_diferente: 1 });
  });

  it("só no antigo: explicado pelos fatos do envio; sem fato, INEXPLICADO com a unidade", () => {
    const r = compararLeituras(
      [
        antiga({ envioId: 10, situacao: "em-assinatura", unidade: "VOC0001" }),
        antiga({ envioId: 11, situacao: "em-assinatura", unidade: "VOC0002" }),
        antiga({ envioId: 12, situacao: "em-assinatura", unidade: "VOC0003" }),
        antiga({ unidade: "VOC0004" }),
        antiga({ envioId: 13, situacao: "em-assinatura", unidade: "VOC0005" }),
        antiga({ envioId: 14, situacao: "em-assinatura", unidade: "VOC0006" }),
      ],
      [],
      fatosVazios({
        chavesSoNoC2x: new Set(["VOC:VOC0004"]),
        envios: new Map([
          [10, fatoDoEnvio({ semUuid: true })],
          [11, fatoDoEnvio({ status6: true })],
          [12, fatoDoEnvio({ unidadeForaDoPanteon: true })],
          [14, fatoDoEnvio({ tipoNaoMapeado: true })],
        ]),
      }),
    );
    expect(r.porCategoria).toEqual({
      envio_sem_uuid: 1,
      inexplicado: 1,
      status6: 1,
      tipo_nao_mapeado: 1,
      unidade_fora_do_panteon: 1,
      venda_so_no_c2x_sem_envio: 1,
    });
    expect(r.inexplicados).toEqual([{ empreendimento: "VOC", motivo: "só no leitor antigo", unidade: "VOC0005" }]);
    expect(totalInexplicado(r)).toBe(1);
  });

  it("só no novo: carga desfeita no C2X, a mesma venda em duas glebas, a nativa ligada e a linha fora do portal", () => {
    const r = compararLeituras(
      [],
      [
        nova({ arC2xId: 900, origemDaVenda: "c2x", propostaId: "pa", unidade: "VOC0010" }),
        nova({ empreendimento: "ACT", origemDaVenda: "c2x", arC2xId: 901, propostaId: "pb", unidade: "ACT0010" }),
        nova({ envioId: 3901, provedor: "d4sign", situacao: "em-assinatura", unidade: "VOC0011" }),
        nova({ noPortal: false, unidade: "VOC0012" }),
      ],
      fatosVazios({ arsVivosNoC2x: new Set([901]), duplicatasDeGleba: new Set(["pb"]) }),
    );
    expect(r.porCategoria).toEqual({
      mesma_venda_em_duas_glebas: 1,
      nativa_ligada: 1,
      substituida_pelo_envelope: 1,
      venda_da_carga_desfeita_no_c2x: 1,
    });
    expect(r.porEmpreendimento.ACT).toEqual({ mesma_venda_em_duas_glebas: 1 });
  });

  it("⚠️ a mesma venda em duas glebas também não esconde recuo", () => {
    const r = compararLeituras(
      [antiga({ assinadas: 3, empreendimento: "ACT", envioId: 55, situacao: "assinado", total: 3, unidade: "ACT0010" })],
      [nova({ empreendimento: "ACT", origemDaVenda: "c2x", propostaId: "pb", unidade: "ACT0010" })],
      fatosVazios({ duplicatasDeGleba: new Set(["pb"]) }),
    );
    expect(totalInexplicado(r)).toBe(1);
  });

  it("⚠️ o espelho ATRÁS do antigo no mesmo envio é inexplicado (não se esconde regressão)", () => {
    const r = compararLeituras(
      [antiga({ assinadas: 3, envioId: 50, situacao: "em-assinatura", total: 4, unidade: "VOC0020" })],
      [nova({ assinadas: 1, envioId: 50, provedor: "d4sign", situacao: "em-assinatura", total: 4, unidade: "VOC0020" })],
      fatosVazios(),
    );
    expect(totalInexplicado(r)).toBe(1);
  });

  it("⚠️ um vigente por venda: só o envio do MESMO pedido do C2X se explica", () => {
    const antigas = [
      antiga({ envioId: 60, situacao: "assinado", assinadas: 1, total: 1, unidade: "VOC0030" }),
      antiga({ envioId: 61, situacao: "em-assinatura", total: 1, unidade: "VOC0030" }),
    ];
    const novas = [nova({ envioId: 60, provedor: "d4sign", situacao: "assinado", assinadas: 1, total: 1, unidade: "VOC0030", origemDaVenda: "c2x" })];
    const mesmoPedido = compararLeituras(
      antigas,
      novas,
      fatosVazios({ envios: new Map([[60, fatoDoEnvio({ arId: 900 })], [61, fatoDoEnvio({ arId: 900 })]]) }),
    );
    expect(mesmoPedido.porCategoria).toEqual({ igual: 1, um_vigente_por_venda: 1 });

    // Outro pedido, ainda vivo no C2X: é o contrato de outra venda que sumiu.
    const outroPedido = compararLeituras(
      antigas,
      novas,
      fatosVazios({
        arsVivosNoC2x: new Set([900, 901]),
        envios: new Map([[60, fatoDoEnvio({ arId: 900 })], [61, fatoDoEnvio({ arId: 901 })]]),
      }),
    );
    expect(totalInexplicado(outroPedido)).toBe(1);

    // Sem o pedido medido, nada se explica pela unidade.
    expect(totalInexplicado(compararLeituras(antigas, novas, fatosVazios()))).toBe(1);
  });

  it("o 'gerado em' perdido é contado à parte, por empreendimento", () => {
    const r = compararLeituras(
      [antiga({ temGeradoEm: true, unidade: "VOC0040" }), antiga({ temGeradoEm: true, unidade: "VOC0041" })],
      [nova({ temGeradoEm: false, unidade: "VOC0040" }), nova({ temGeradoEm: true, unidade: "VOC0041" })],
      fatosVazios(),
    );
    expect(r.porCategoria).toEqual({ igual: 2 });
    expect(r.geradoEmPerdido).toEqual({ porEmpreendimento: { VOC: 1 }, total: 1 });
  });
});

// ⚠️ A FIXTURE DO ENSAIO REAL. Ela nasce de `node scripts/temis/comparar-leitura-de-assinaturas.mjs
// --fixture` (só leitura), DEPOIS da 0195 aplicada e do espelho carregado (F3). Enquanto não existe,
// o teste diz isso no nome e não finge que passou.
//
// ⚠️ SUÍTE VERDE SEM A FIXTURE NÃO É A TRAVA CUMPRIDA. No pedido de deploy da F4, a suíte roda com
// `PARIDADE_EXIGIDA=1`: aí a falta da fixture é FALHA, e não um teste pulado.
const FIXTURE = path.resolve(__dirname, "__fixtures__/paridade-das-leituras.json");
const temFixture = fs.existsSync(FIXTURE);
const exigida = process.env.PARIDADE_EXIGIDA === "1";

type FixtureDaParidade = RelatorioDaParidade & {
  codigos: number;
  cortadosNoTetoAntigo: string[];
  falhas: string[];
};

describe("a fixture do ensaio de paridade", () => {
  it.skipIf(!temFixture)("⚠️ inexplicado = 0, sem falha nem corte, e toda categoria é uma das explicadas", () => {
    const relatorio = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as FixtureDaParidade;
    // Um código cujo leitor antigo falhou (ou veio degradado) sumia dos DOIS lados e a trava ficava verde.
    expect(relatorio.codigos).toBeGreaterThan(0);
    expect(relatorio.falhas).toEqual([]);
    expect(relatorio.cortadosNoTetoAntigo).toEqual([]);
    expect(relatorio.inexplicados).toEqual([]);
    expect(totalInexplicado(relatorio)).toBe(0);
    for (const categoria of Object.keys(relatorio.porCategoria)) {
      expect(CATEGORIAS_EXPLICADAS).toContain(categoria);
    }
  });

  it.skipIf(temFixture || exigida)("(a fixture ainda não foi gerada: rode o ensaio depois da 0195 e da carga do espelho)", () => {
    expect(temFixture).toBe(false);
  });

  it.runIf(exigida && !temFixture)("⚠️ PARIDADE_EXIGIDA: sem a fixture commitada, a F4 não sobe", () => {
    expect.fail(`a fixture ${path.basename(FIXTURE)} não existe: rode o ensaio com --fixture e commite a saída`);
  });
});
