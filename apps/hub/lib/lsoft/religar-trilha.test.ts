import { describe, expect, it } from "vitest";

import { digitalDaParcela } from "./impressao-digital";
import { type LinhaDaTrilha, type ParcelaNova, planejarReligamentoDaTrilha } from "./religar-trilha";

// Os cenários abaixo são os que a carga de verdade produz. Cada um responde "para onde vai a baixa
// que o time deu na tela, depois que a carga apagou e regravou a parcela com outro id?".

/** Uma parcela como a carga grava. */
const parcela = (id: string, sobre: Partial<ParcelaNova> = {}): ParcelaNova => ({
  cliente_codigo: "00000403",
  empreendimento: "Garden",
  id,
  observacoes: "LOTE: 109 QUADRA: 08",
  origem: "receber",
  parcela: "007/084",
  valor: "2119.05",
  vencimento: "2026-09-10",
  ...sobre,
});

/** As linhas de trilha que uma edição daquela parcela gravou (a baixa grava três). */
const trilhaDe = (antiga: ParcelaNova, ids: string[], parcelaId: null | string = null, ordinal = 1): LinhaDaTrilha[] =>
  ids.map((id) => ({
    cliente_codigo: antiga.cliente_codigo,
    empreendimento_no_momento: antiga.empreendimento,
    id,
    impressao_digital: digitalDaParcela(antiga),
    ordinal,
    parcela_id: parcelaId,
    valor_no_momento: antiga.valor,
    vencimento_no_momento: antiga.vencimento,
  }));

describe("religar a trilha depois da carga", () => {
  it("nada mudou na parcela: religa pela digital exata, e as três linhas da baixa vão juntas", () => {
    const antiga = parcela("velha");
    const nova = parcela("nova");
    const plano = planejarReligamentoDaTrilha(trilhaDe(antiga, ["t1", "t2", "t3"]), [nova]);

    expect(plano.contagem.religadosPorDigital).toBe(1);
    expect(plano.atualizacoes).toEqual([
      { id: "t1", parcela_id: "nova", via: "digital" },
      { id: "t2", parcela_id: "nova", via: "digital" },
      { id: "t3", parcela_id: "nova", via: "digital" },
    ]);
    expect(plano.orfaos).toEqual([]);
  });

  it("a parcela foi PAGA entre as cargas: a digital muda, mas vencimento e valor religam", () => {
    // ⚠️ É o caso mais comum na prática. Paga, a linha sai de RECEBER para RECEBIDOS e a `origem`
    // vira "recebido", então a digital inteira muda.
    const antiga = parcela("velha");
    const nova = parcela("nova", { origem: "recebido" });
    const plano = planejarReligamentoDaTrilha(trilhaDe(antiga, ["t1"]), [nova]);

    expect(plano.contagem.religadosPorVencimentoEValor).toBe(1);
    expect(plano.atualizacoes).toEqual([{ id: "t1", parcela_id: "nova", via: "vencimentoEValor" }]);
  });

  it("o time corrigiu a observação no LSoft: vencimento e valor ainda religam", () => {
    const antiga = parcela("velha");
    const nova = parcela("nova", { observacoes: "LOTE: 109 QUADRA: 08 - CORRIGIDO" });
    const plano = planejarReligamentoDaTrilha(trilhaDe(antiga, ["t1"]), [nova]);
    expect(plano.atualizacoes[0]).toEqual({ id: "t1", parcela_id: "nova", via: "vencimentoEValor" });
  });

  it("DOIS LOTES DO MESMO CLIENTE com o mesmo valor e vencimento: fica órfã, não chuta", () => {
    // ⚠️ O caso que motiva a regra de candidata única. Mario Santos Rocha tem Q13 L22 e Q07 L1,
    // ambos a R$ 2.261,91 com o mesmo vencimento. Só a observação separa, e a trilha não a guarda.
    // Depois de paga (digital muda), escolher uma das duas seria abater no lote do vizinho.
    const antiga = parcela("velha", { observacoes: "LOTE 22 QUADRA 13", valor: "2261.91" });
    const loteA = parcela("nova-a", { observacoes: "LOTE 22 QUADRA 13", origem: "recebido", valor: "2261.91" });
    const loteB = parcela("nova-b", { observacoes: "LOTE 1 QUADRA 7", origem: "recebido", valor: "2261.91" });

    const plano = planejarReligamentoDaTrilha(trilhaDe(antiga, ["t1", "t2"]), [loteA, loteB]);

    expect(plano.atualizacoes).toEqual([]);
    expect(plano.contagem.orfaos).toBe(1);
    expect(plano.orfaos[0]?.linhas).toBe(2);
  });

  it("os mesmos dois lotes, SEM terem sido pagos: a digital exata separa e religa certo", () => {
    // Enquanto nada mudou, a observação está DENTRO da digital, então os lotes não se confundem.
    const antigaA = parcela("velha-a", { observacoes: "LOTE 22 QUADRA 13", valor: "2261.91" });
    const antigaB = parcela("velha-b", { observacoes: "LOTE 1 QUADRA 7", valor: "2261.91" });
    const novaA = parcela("nova-a", { observacoes: "LOTE 22 QUADRA 13", valor: "2261.91" });
    const novaB = parcela("nova-b", { observacoes: "LOTE 1 QUADRA 7", valor: "2261.91" });

    const plano = planejarReligamentoDaTrilha(
      [...trilhaDe(antigaA, ["a1"]), ...trilhaDe(antigaB, ["b1"])],
      [novaB, novaA],
    );

    expect(plano.atualizacoes).toContainEqual({ id: "a1", parcela_id: "nova-a", via: "digital" });
    expect(plano.atualizacoes).toContainEqual({ id: "b1", parcela_id: "nova-b", via: "digital" });
  });

  it("a parcela SUMIU na carga nova: a trilha fica órfã, viva, e é relatada", () => {
    const antiga = parcela("velha");
    const outra = parcela("nova", { parcela: "008/084", valor: "999.00", vencimento: "2026-10-10" });
    const plano = planejarReligamentoDaTrilha(trilhaDe(antiga, ["t1", "t2", "t3"]), [outra]);

    expect(plano.atualizacoes).toEqual([]);
    expect(plano.contagem.orfaos).toBe(1);
    expect(plano.orfaos[0]?.linhas).toBe(3);
  });

  it("duas parcelas antigas nunca colam na mesma parcela nova", () => {
    // Duas parcelas antigas diferentes que, depois de pagas, caem na mesma rede frouxa. A primeira
    // leva; a segunda não pode reaproveitar a mesma parcela e fica órfã.
    const a = parcela("velha-a", { vencimento: "2026-09-10" });
    const b = parcela("velha-b", { vencimento: "2026-09-10", observacoes: "OUTRA OBS" });
    const unica = parcela("nova", { origem: "recebido" });

    const plano = planejarReligamentoDaTrilha([...trilhaDe(a, ["a1"]), ...trilhaDe(b, ["b1"])], [unica]);

    const alvos = plano.atualizacoes.map((u) => u.parcela_id);
    expect(alvos.filter((x) => x === "nova").length).toBeLessThanOrEqual(1);
    expect(plano.contagem.orfaos).toBe(1);
  });

  it("gêmeas genuínas (mesmo tudo) são separadas pelo ordinal", () => {
    // O cliente 00000294: dois recebimentos de R$ 5.000,00 no mesmo dia, byte a byte iguais.
    const gemea = parcela("x", { cliente_codigo: "00000294", valor: "5000.00" });
    const nova1 = parcela("g-1", { cliente_codigo: "00000294", valor: "5000.00" });
    const nova2 = parcela("g-2", { cliente_codigo: "00000294", valor: "5000.00" });

    const plano = planejarReligamentoDaTrilha(
      [...trilhaDe(gemea, ["primeira"], null, 1), ...trilhaDe(gemea, ["segunda"], null, 2)],
      [nova2, nova1],
    );

    expect(plano.atualizacoes).toContainEqual({ id: "primeira", parcela_id: "g-1", via: "digital" });
    expect(plano.atualizacoes).toContainEqual({ id: "segunda", parcela_id: "g-2", via: "digital" });
  });

  it("três gêmeas: o ordinal é a posição entre TODAS, não entre as que sobraram livres", () => {
    // ⚠️ A trilha da gêmea 1 ainda aponta para ela (viva), então ela é reservada primeiro. Contando
    // só as livres, o ordinal 2 cairia na gêmea 3. Tem de cair na 2.
    const gemea = parcela("x", { cliente_codigo: "00000294", valor: "5000.00" });
    const g1 = parcela("g-1", { cliente_codigo: "00000294", valor: "5000.00" });
    const g2 = parcela("g-2", { cliente_codigo: "00000294", valor: "5000.00" });
    const g3 = parcela("g-3", { cliente_codigo: "00000294", valor: "5000.00" });

    const plano = planejarReligamentoDaTrilha(
      [...trilhaDe(gemea, ["da-1"], "g-1", 1), ...trilhaDe(gemea, ["da-2"], null, 2), ...trilhaDe(gemea, ["da-3"], null, 3)],
      [g3, g1, g2],
    );

    expect(plano.atualizacoes).toContainEqual({ id: "da-2", parcela_id: "g-2", via: "digital" });
    expect(plano.atualizacoes).toContainEqual({ id: "da-3", parcela_id: "g-3", via: "digital" });
  });

  it("gêmea 2 foi paga e sumiu da digital: a trilha dela NÃO cai na gêmea 1", () => {
    // Paga, a gêmea 2 muda de origem e de digital. Sobra só uma parcela com a digital antiga, a
    // gêmea 1, que já tem dona. A trilha da 2 fica órfã em vez de ser colada no vizinho.
    const gemea = parcela("x", { cliente_codigo: "00000294", valor: "5000.00" });
    const g1 = parcela("g-1", { cliente_codigo: "00000294", valor: "5000.00" });
    const g2Paga = parcela("g-2", { cliente_codigo: "00000294", origem: "recebido", valor: "5000.00" });

    const plano = planejarReligamentoDaTrilha(
      [...trilhaDe(gemea, ["da-1"], null, 1), ...trilhaDe(gemea, ["da-2"], null, 2)],
      [g1, g2Paga],
    );

    expect(plano.atualizacoes).toContainEqual({ id: "da-1", parcela_id: "g-1", via: "digital" });
    expect(plano.atualizacoes.find((u) => u.id === "da-2")?.parcela_id).not.toBe("g-1");
  });

  it("o grupo que ainda aponta para parcela viva reserva a sua antes de qualquer religação", () => {
    // ⚠️ Sem a reserva, um grupo órfão visitado antes poderia tomar a parcela do grupo sadio.
    const antiga = parcela("viva");
    const sadio = trilhaDe(antiga, ["s1"], "viva");
    const orfaoQueQueriaAMesma = trilhaDe(parcela("sumiu", { origem: "recebido" }), ["o1"]);

    const plano = planejarReligamentoDaTrilha([...orfaoQueQueriaAMesma, ...sadio], [antiga]);

    expect(plano.contagem.jaLigados).toBe(1);
    expect(plano.atualizacoes.find((u) => u.id === "o1")).toBeUndefined();
  });

  it("ignora a trilha do CADASTRO, que não tem digital e nunca perdeu o alvo", () => {
    const cadastro: LinhaDaTrilha = {
      cliente_codigo: "00000403",
      empreendimento_no_momento: null,
      id: "c1",
      impressao_digital: null,
      ordinal: 1,
      parcela_id: null,
      valor_no_momento: null,
      vencimento_no_momento: null,
    };
    const plano = planejarReligamentoDaTrilha([cadastro], [parcela("nova")]);
    expect(plano.atualizacoes).toEqual([]);
    expect(plano.contagem.orfaos).toBe(0);
  });

  it("parcela ainda viva não gera nenhuma atualização", () => {
    const viva = parcela("viva");
    const plano = planejarReligamentoDaTrilha(trilhaDe(viva, ["t1", "t2"], "viva"), [viva]);
    expect(plano.atualizacoes).toEqual([]);
    expect(plano.contagem.jaLigados).toBe(1);
  });
});
