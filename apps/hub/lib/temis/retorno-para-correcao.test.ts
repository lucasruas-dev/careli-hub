import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { FalhaDaClicksign, type Opcoes } from "@/lib/assinatura/clicksign/cliente";
import type { EnvelopeDaProposta } from "@/lib/assinatura/envio-db";
import type { EstadoDaAssinatura } from "@/lib/assinatura/tipos";

import {
  AVISO_DA_VOLTA,
  AVISO_DA_VOLTA_COM_ENVELOPE,
  AVISO_DA_VOLTA_SIMPLES,
  conferirEnvelopeParaVoltar,
  conferirEstadoRealParaVoltar,
  conferirEstagioParaVoltar,
  RECUSA_DO_CONTRATO_ASSINADO,
  retornarParaAnalise,
} from "./retorno-para-correcao";

// ⚠️ O QUE ESTES TESTES PROTEGEM É UMA ASSINATURA QUE NÃO SE DESFAZ. A régua daqui decide duas
// coisas caras: se um card com o contrato NA RUA pode voltar para a análise (e aí o envelope tem de
// morrer antes), e se um contrato JÁ ASSINADO POR TODOS pode ser mexido (não pode — o caminho é o
// distrato, Lucas em 11-12/09/2026).
//
// ⚠️ E ELA É PURA PORQUE PRECISA DE TESTE. Dentro da função que fala com o Supabase e com a
// Clicksign, cada um destes casos exigiria um duplo inteiro; aqui se confere a decisão, que é do que
// a regra fala.

describe("de onde o card volta", () => {
  // ⚠️ O `prazo_legal` ESTÁ AQUI POR CORREÇÃO DE REGRA, E NÃO POR DEFEITO DESCOBERTO. O lote
  // anterior cravava que o Pré-faturamento NÃO volta, supondo que só se chega lá com tudo assinado.
  // Lucas (12/09/2026): *"prefaturamento pode desde que nao esteja todo assinado"*. Quem barra o
  // Pré-faturamento assinado é o ENVELOPE, no bloco de baixo — nunca a etapa.
  it.each(["assinatura", "contrato", "prazo_legal"])("%s começa a volta", (estagio) => {
    expect(conferirEstagioParaVoltar(estagio, "contrato").ok).toBe(true);
  });
});

describe("de onde o card NÃO volta", () => {
  // ⚠️ FATURADO É O FIM — Lucas (12/09/2026): *"somente no ultimo estagio que nao tem como voltar
  // para corrigir"*. E a frase manda abrir o cancelamento, que é o caminho que sobra.
  it("faturado recusa dizendo onde está e mandando abrir o cancelamento", () => {
    const r = conferirEstagioParaVoltar("faturado", "contrato");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // A frase diz a etapa com a palavra da tela (`nomeDaEtapaGravada`), e não o valor cru do banco.
    expect(r.erro).toContain('"Faturado"');
    expect(r.erro).toContain("cancelamento");
  });

  // ⚠️ INDEFERIDO É SAÍDA LATERAL: o card não está no caminho do contrato, e não há etapa para onde
  // devolvê-lo. Mandar abrir cancelamento aqui seria conselho errado — não há contrato em pé.
  it("indeferido recusa apontando para quem vendeu, e não para o cancelamento", () => {
    const r = conferirEstagioParaVoltar("indeferido", "contrato");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain('"Indeferido"');
    expect(r.erro).toContain("Hércules");
    expect(r.erro).not.toContain("cancelamento");
  });

  // ⚠️ NÃO MANDA ABRIR CANCELAMENTO NENHUM: quem já está na análise só precisa corrigir e gerar.
  it("já estar na Análise recusa sem mandar cancelar nada", () => {
    const r = conferirEstagioParaVoltar("analise", "contrato");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("já está na Análise");
    expect(r.erro).not.toContain("cancelamento");
  });

  it("estágio que o código não conhece também recusa", () => {
    expect(conferirEstagioParaVoltar("confeccao", "contrato").ok).toBe(false);
  });
});

describe("o aviso que a tela mostra antes de confirmar", () => {
  // ⚠️ OS DOIS ESTÁGIOS EM QUE O CONTRATO JÁ ESTEVE NA RUA AVISAM DO CANCELAMENTO. É o aviso do
  // PIOR CASO: quem confirma precisa saber que pode estar matando um envelope pago.
  it.each(["assinatura", "prazo_legal"] as const)("%s avisa que o envelope morre", (estagio) => {
    expect(AVISO_DA_VOLTA[estagio]).toContain("CANCELA o envelope");
  });

  // Da etapa de Contrato o envelope ainda não saiu — o envio é que move o card para "Em assinatura".
  it("contrato fala só da volta, sem prometer cancelamento", () => {
    expect(AVISO_DA_VOLTA.contrato).not.toContain("CANCELA");
    expect(AVISO_DA_VOLTA.contrato).toContain("o prazo daquela etapa recomeça");
  });
});

/** Uma linha de `temis_envelopes`, com o que a régua lê (migration 0149). */
function linha(patch: Partial<EnvelopeDaProposta>): EnvelopeDaProposta {
  return {
    criado_em: "2026-09-11T12:00:00.000Z",
    envelope_id: "env-1",
    estado: "aguardando",
    falha: null,
    id: "reg-1",
    provedor: "clicksign",
    ...patch,
  };
}

describe("o envelope, na hora de voltar", () => {
  // ⚠️ A TRAVA QUE FAZ A REGRA VALER DE VERDADE, E ELA É A MESMA NOS TRÊS ESTÁGIOS. O card pode
  // dizer "em assinatura" enquanto o envelope já fechou (o webhook pode não ter chegado, ou a última
  // assinatura pode ter entrado entre a tela carregar e alguém clicar), e pode dizer
  // "Pré-faturamento" tendo chegado lá por marcação humana. Quem decide é o ENVELOPE.
  it("assinado por todos BARRA a volta, e manda fazer o distrato", () => {
    const r = conferirEnvelopeParaVoltar([linha({ envelope_id: "env-9", estado: "assinado" })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe(RECUSA_DO_CONTRATO_ASSINADO);
    // A palavra é `distrato`, e ela vem da régua de `lib/temis/cancelamento.ts`: assinatura
    // completa cai sempre nele. A frase manda abrir o pedido de cancelamento e diz como ele será
    // classificado — a classificação não é refeita aqui.
    expect(RECUSA_DO_CONTRATO_ASSINADO).toContain("distrato");
    expect(RECUSA_DO_CONTRATO_ASSINADO).toContain("pedido de cancelamento");
  });

  it("parcialmente assinado libera a volta, cancelando o envelope", () => {
    const r = conferirEnvelopeParaVoltar([linha({ envelope_id: "env-2", estado: "parcial" })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeParaCancelar).toBe("env-2");
    expect(r.registroId).toBe("reg-1");
  });

  it("aguardando assinatura libera a volta, cancelando o envelope", () => {
    const r = conferirEnvelopeParaVoltar([linha({ envelope_id: "env-3", estado: "aguardando" })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeParaCancelar).toBe("env-3");
  });

  // ⚠️ SEM ENVELOPE NENHUM NÃO É ERRO. É o card que subiu por marcação humana (`marcarAtividade`,
  // medido em 09/09/2026 no card do Henrique, que chegou ao fim sem contrato e sem envelope): não há
  // nada vivo lá fora, e o card volta direto.
  it("proposta sem envelope nenhum volta sem cancelar nada", () => {
    const r = conferirEnvelopeParaVoltar([]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeParaCancelar).toBeNull();
  });

  // Os três estados que já liberam o REENVIO liberam a volta pelo mesmo motivo: o que estava na rua
  // já morreu.
  it.each(["cancelado", "expirado", "recusado"])("%s volta sem cancelar nada", (estado) => {
    const r = conferirEnvelopeParaVoltar([linha({ envelope_id: "env-4", estado })]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeParaCancelar).toBeNull();
  });

  // ⚠️ A LINHA AMBÍGUA: um envio começou e o Panteon nunca soube como terminou. Não dá para cancelar
  // o que não se sabe identificar — e soltar o card aqui é o estado que este desenho existe para
  // impedir.
  it("o envio que não se sabe como terminou barra a volta e manda conferir na Clicksign", () => {
    const r = conferirEnvelopeParaVoltar([
      linha({ envelope_id: null, estado: "rascunho", falha: null }),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("reg-1");
    expect(r.erro).toContain("Clicksign");
  });

  // ⚠️ O `provedor` ERA SELECIONADO E JOGADO FORA, e isso é um id indo para a API errada:
  // `cancelarEnvelope` fala CLICKSIGN. São dois provedores vivos de propósito (Lucas, 07/09/2026),
  // e o D4Sign não tem webhook escrevendo em `temis_envelopes` — por isso a frase NÃO promete que o
  // webhook libera a volta, ao contrário das outras deste arquivo.
  it("envelope vivo de outro provedor barra a volta, sem mandar o id para a Clicksign", () => {
    const r = conferirEnvelopeParaVoltar([
      linha({ envelope_id: "d4-1", estado: "aguardando", provedor: "d4sign" }),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("D4Sign");
    expect(r.erro).toContain("reg-1");
    expect(r.erro).not.toContain("o webhook grava o cancelamento aqui");
  });

  // A consulta pede `criado_em desc`: é o envelope mais recente que segura, e é ele que se cancela.
  it("com mais de um, cancela o mais recente que ainda está vivo", () => {
    const r = conferirEnvelopeParaVoltar([
      linha({ criado_em: "2026-09-11T15:00:00.000Z", envelope_id: "env-novo", estado: "aguardando" }),
      linha({ criado_em: "2026-09-10T09:00:00.000Z", envelope_id: "env-velho", estado: "recusado" }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeParaCancelar).toBe("env-novo");
  });
});

// ⚠️ O PORTÃO É O ENVELOPE, E NÃO A ETAPA — e é isto que este bloco congela. As duas conferências
// são independentes de propósito: a do estágio só diz onde o botão aparece, e a do envelope decide
// em TODOS eles. Um teste que provasse a recusa só na assinatura deixaria passar exatamente o caso
// que o Lucas descreveu no Pré-faturamento.
describe("o envelope assinado barra em qualquer um dos três estágios", () => {
  it.each(["assinatura", "contrato", "prazo_legal"])("%s: etapa passa, envelope barra", (estagio) => {
    expect(conferirEstagioParaVoltar(estagio, "contrato").ok).toBe(true);

    const r = conferirEnvelopeParaVoltar([linha({ envelope_id: "env-5", estado: "assinado" })]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe(RECUSA_DO_CONTRATO_ASSINADO);
  });
});

// ⚠️ ESTE BLOCO É A TRAVA QUE O BANCO NÃO CONSEGUE DAR. `temis_envelopes.estado` só é escrito pelo
// webhook, então ele é justamente a fonte que ATRASA: três de quatro assinaram, o quarto assina às
// 14:00:00 e às 14:00:01 alguém clica em voltar com a tela carregada às 13:58. Quem responde é a
// Clicksign, lida imediatamente antes do cancelamento.
describe("o estado REAL, lido na Clicksign", () => {
  const lido = (estado: EstadoDaAssinatura, status: string) => ({
    envelopeId: "env-20",
    estado,
    status,
  });

  it.each(["aguardando", "parcial", "rascunho"] as const)("%s: cancela e volta", (estado) => {
    const r = conferirEstadoRealParaVoltar(lido(estado, "running"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cancelar).toBe(true);
  });

  // Já morreu lá fora: não se cancela duas vezes, e o card volta direto. São os mesmos três estados
  // que liberam o REENVIO em `envelopeQueSegura`.
  it.each(["cancelado", "expirado", "recusado"] as const)("%s: volta sem cancelar", (estado) => {
    const r = conferirEstadoRealParaVoltar(lido(estado, "canceled"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cancelar).toBe(false);
  });

  it("assinado por todos barra, e manda fazer o distrato", () => {
    const r = conferirEstadoRealParaVoltar(lido("assinado", "closed"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe(RECUSA_DO_CONTRATO_ASSINADO);
  });

  // ⚠️ `closed` CHEGA COMO `desconhecido` e NÃO como assinado — o
  // `deadline_partial_signature_action` pode fechar o envelope no vencimento com as assinaturas que
  // tiver. Fechado, de um jeito ou de outro, a volta para: e a frase diz as DUAS saídas, sem
  // afirmar qual dos dois é.
  it("desconhecido barra a volta dizendo o status cru, e não manda tentar de novo", () => {
    const r = conferirEstadoRealParaVoltar(lido("desconhecido", "closed"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain('"closed"');
    expect(r.erro).toContain("env-20");
    expect(r.erro).toContain("distrato");
    expect(r.erro).not.toContain("tente de novo");
  });
});

/** O duplo do Supabase: o card, os envelopes da proposta e o registro do que foi lido. */
function bancoDeTeste(dados: {
  card: null | { estagio: string; id: string; proposta_id: null | string; tipo: string };
  envelopes: EnvelopeDaProposta[];
}) {
  const tabelas: string[] = [];
  /** O que cada `update` mandou escrever — é onde se confere o campo que a volta LIMPA. */
  const atualizacoes: { patch: Record<string, unknown>; tabela: string }[] = [];

  const from = (tabela: string) => {
    tabelas.push(tabela);
    let ehUpdate = false;

    const leitura = { data: tabela === "temis_envelopes" ? dados.envelopes : [], error: null };
    const builder = {
      eq: () => builder,
      insert: () => Promise.resolve({ data: null, error: null }),
      limit: () => Promise.resolve(leitura),
      maybeSingle: () => Promise.resolve({ data: dados.card, error: null }),
      order: () => builder,
      select: () => builder,
      // O builder do Supabase é um `PromiseLike`: `update().eq().select()` é aguardado direto.
      then: (resolver: (r: { data: unknown; error: null }) => unknown) =>
        Promise.resolve(
          resolver(ehUpdate ? { data: [{ id: "card-1" }], error: null } : leitura),
        ),
      update: (patch: Record<string, unknown>) => {
        ehUpdate = true;
        atualizacoes.push({ patch, tabela });
        return builder;
      },
    };
    return builder;
  };

  return { atualizacoes, sb: { from } as unknown as SupabaseClient, tabelas };
}

/** O duplo da porta HTTP: registra o que foi pedido. Ver a nota de `PortaDaClicksign`. */
function portaDeTeste(respostas: { get?: Error | unknown; patch?: Error | unknown } = {}) {
  const chamadas: { caminho: string; metodo: string }[] = [];

  const porta = async <T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> => {
    const metodo = opcoes.metodo ?? "GET";
    chamadas.push({ caminho, metodo });
    const resposta = metodo === "GET" ? respostas.get : respostas.patch;
    if (resposta instanceof Error) throw resposta;
    return (resposta ?? {}) as T;
  };

  return { chamadas, porta };
}

const pedido = { observacao: null, trabalhoId: "card-1", usuarioId: "u-1", usuarioNome: "Zeus" };

// ⚠️ O ENVELOPE É LIDO POR PROPOSTA, E A PROPOSTA TEM DOIS CARDS — medido em 10/09/2026 na proposta
// do Henrique (Q01 L05). `temis_envelopes` não tem `trabalho_id` (a 0149 liga por `proposta_id` +
// `documento_id`), e o pedido de cancelamento nasce com a MESMA `proposta_id` da venda. Sem o portão
// por TIPO, o card de distrato travava para sempre lendo o envelope assinado da VENDA, e voltar o
// card de cancelamento cancelava, na conta de PRODUÇÃO, o envelope vivo da venda.
describe("o envelope é da VENDA, e o card pode não ser", () => {
  const envelopeAssinadoDaVenda = [
    linha({ envelope_id: "env-da-venda", estado: "assinado", id: "reg-venda" }),
  ];

  it("card de cancelamento volta sem sequer consultar o envelope da venda", async () => {
    const { sb, tabelas } = bancoDeTeste({
      card: { estagio: "contrato", id: "card-1", proposta_id: "prop-1", tipo: "cancelamento" },
      envelopes: envelopeAssinadoDaVenda,
    });
    const { chamadas, porta } = portaDeTeste();

    const r = await retornarParaAnalise(sb, pedido, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeCancelado).toBeNull();
    // Nem a tabela de envelopes foi aberta: não há como recusar nem cancelar o que não se leu.
    expect(tabelas).not.toContain("temis_envelopes");
    expect(chamadas).toEqual([]);
  });

  it.each(["cessao", "distrato"])("card de %s também volta, sem tocar no envelope", async (tipo) => {
    const { sb, tabelas } = bancoDeTeste({
      card: { estagio: "assinatura", id: "card-1", proposta_id: "prop-1", tipo },
      envelopes: envelopeAssinadoDaVenda,
    });
    const { chamadas, porta } = portaDeTeste();

    const r = await retornarParaAnalise(sb, pedido, porta);
    expect(r.ok).toBe(true);
    expect(tabelas).not.toContain("temis_envelopes");
    expect(chamadas).toEqual([]);
  });

  // O MESMO envelope, no card que é dono dele: aí a regra do Lucas vale inteira.
  it("card de contrato, com o mesmo envelope assinado, é RECUSADO", async () => {
    const { sb } = bancoDeTeste({
      card: { estagio: "assinatura", id: "card-1", proposta_id: "prop-1", tipo: "contrato" },
      envelopes: envelopeAssinadoDaVenda,
    });
    const { chamadas, porta } = portaDeTeste();

    const r = await retornarParaAnalise(sb, pedido, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe(RECUSA_DO_CONTRATO_ASSINADO);
    expect(r.status).toBe(409);
    // E nada foi cancelado na conta de produção.
    expect(chamadas).toEqual([]);
  });
});

// ⚠️ A ORDEM É LER → RECUSAR OU CANCELAR → MOVER, e é o que este bloco congela.
describe("o caminho inteiro, com a Clicksign", () => {
  const cardEmAssinatura = {
    estagio: "assinatura",
    id: "card-1",
    proposta_id: "prop-1",
    tipo: "contrato",
  };

  it("banco diz parcial e a Clicksign diz running: cancela e volta", async () => {
    const { sb } = bancoDeTeste({
      card: cardEmAssinatura,
      envelopes: [linha({ envelope_id: "env-vivo", estado: "parcial" })],
    });
    const { chamadas, porta } = portaDeTeste({ get: { data: { attributes: { status: "running" } } } });

    const r = await retornarParaAnalise(sb, pedido, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeCancelado).toBe("env-vivo");
    expect(chamadas).toEqual([
      { caminho: "/envelopes/env-vivo", metodo: "GET" },
      { caminho: "/envelopes/env-vivo", metodo: "PATCH" },
    ]);
  });

  // ⚠️ O CASO QUE O BANCO NÃO PEGA: o webhook ainda não chegou, a linha diz `parcial`, e a Clicksign
  // já fechou o envelope. Sem a leitura, o PATCH cancelaria um contrato assinado por todos — e
  // `cancelado` é terminal, então o `auto_close` que chegasse depois seria DESCARTADO.
  it("banco diz parcial e a Clicksign diz closed: RECUSA, e não cancela nada", async () => {
    const { sb } = bancoDeTeste({
      card: cardEmAssinatura,
      envelopes: [linha({ envelope_id: "env-fechado", estado: "parcial" })],
    });
    const { chamadas, porta } = portaDeTeste({ get: { data: { attributes: { status: "closed" } } } });

    const r = await retornarParaAnalise(sb, pedido, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain('"closed"');
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
  });

  // ⚠️ FAIL-CLOSED: sem saber o estado, não se cancela. E a frase não afirma nada sobre o envelope.
  it("leitura que falha recusa a volta, sem cancelar no escuro", async () => {
    const { sb } = bancoDeTeste({
      card: cardEmAssinatura,
      envelopes: [linha({ envelope_id: "env-mudo", estado: "aguardando" })],
    });
    const { chamadas, porta } = portaDeTeste({ get: new Error("timeout") });

    const r = await retornarParaAnalise(sb, pedido, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.erro).toContain("Não deu para confirmar o estado do envelope");
    expect(r.erro).not.toContain("tente de novo");
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
  });

  // ⚠️ A CLICKSIGN JÁ CANCELOU LÁ (por alguém, ou pelo prazo) e o webhook não chegou: não há o que
  // cancelar, e o card volta direto.
  it("a Clicksign diz canceled: volta sem mandar PATCH nenhum", async () => {
    const { sb } = bancoDeTeste({
      card: cardEmAssinatura,
      envelopes: [linha({ envelope_id: "env-morto", estado: "aguardando" })],
    });
    const { chamadas, porta } = portaDeTeste({ get: { data: { attributes: { status: "canceled" } } } });

    const r = await retornarParaAnalise(sb, pedido, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeCancelado).toBeNull();
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
  });
});

// ⚠️ A FRASE NUNCA DIZ "TENTE DE NOVO" — é a regra escrita da casa (`lib/assinatura/envio-db.ts`),
// e quem libera a volta é o WEBHOOK gravando o cancelamento aqui.
describe("quando o cancelamento não dá certo", () => {
  const cardEmAssinatura = {
    estagio: "assinatura",
    id: "card-1",
    proposta_id: "prop-1",
    tipo: "contrato",
  };

  const bancoComEnvelopeVivo = () =>
    bancoDeTeste({
      card: cardEmAssinatura,
      envelopes: [linha({ envelope_id: "env-vivo", estado: "aguardando" })],
    });

  const respondeRunning = { data: { attributes: { status: "running" } } };

  /**
   * ⚠️ `status: 0` É O QUE `chamar` PÕE QUANDO NÃO HOUVE RESPOSTA HTTP — o timeout de 15s e a falha
   * de rede. É por ele que `cancelarEnvelope` separa "a API recusou" de "não dá para saber".
   */
  const falha = (status: number) =>
    new FalhaDaClicksign(
      status === 0 ? "Clicksign não respondeu em 15s." : `Clicksign devolveu ${status}.`,
      { detalhes: [], requestId: null, status },
    );

  // A API respondeu: é uma CERTEZA de que o envelope continua vivo.
  it("recusa da API: afirma que o contrato segue na mão de quem ia assinar", async () => {
    const { sb } = bancoComEnvelopeVivo();
    const { porta } = portaDeTeste({
      get: respondeRunning,
      patch: falha(422),
    });

    const r = await retornarParaAnalise(sb, pedido, porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.erro).toContain("continuam com o contrato atual para assinar");
    expect(r.erro).toContain("o webhook grava o cancelamento aqui e libera a volta");
    expect(r.erro).not.toContain("tente de novo");
  });

  // ⚠️ TIMEOUT NÃO É RECUSA: o PATCH pode ter chegado. Afirmar "continuam com o contrato atual"
  // aqui seria trocar dúvida por certeza falsa — a mesma decisão que `carimbarFalha` toma no envio.
  it("timeout: diz que NÃO DÁ PARA SABER se o cancelamento chegou", async () => {
    const { sb } = bancoComEnvelopeVivo();
    const { porta } = portaDeTeste({ get: respondeRunning, patch: falha(0) });

    const r = await retornarParaAnalise(sb, pedido, porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("NÃO DÁ PARA SABER");
    expect(r.erro).not.toContain("continuam com o contrato atual para assinar");
    expect(r.erro).not.toContain("tente de novo");
  });
});

// ⚠️ O RELÓGIO DOS 7 DIAS É DO CONTRATO QUE ACABOU DE SER DESFEITO. `arrependimento_inicio` nasce
// em `concluirAssinaturaDoCard` quando o envelope fecha, com a data da última assinatura do
// COMPRADOR. Voltando do Pré-faturamento, aquele contrato deixou de existir — manter a data faria a
// tela contar dias de um prazo que parou de correr e liberar o faturamento sozinha.
describe("a volta zera o prazo de arrependimento", () => {
  it("voltando do Pré-faturamento, o campo é limpo junto com a etapa", async () => {
    const { atualizacoes, sb } = bancoDeTeste({
      card: { estagio: "prazo_legal", id: "card-1", proposta_id: "prop-1", tipo: "contrato" },
      envelopes: [],
    });
    const { porta } = portaDeTeste();

    const r = await retornarParaAnalise(sb, pedido, porta);
    expect(r.ok).toBe(true);

    const doCard = atualizacoes.find((u) => u.tabela === "temis_trabalhos");
    expect(doCard?.patch.estagio).toBe("analise");
    expect(doCard?.patch.arrependimento_inicio).toBeNull();
  });

  // Limpa SEMPRE, e não só vindo do Pré-faturamento: o card que já passou por lá carrega a data
  // pelos estágios seguintes, e `null` num card que nunca teve prazo é o que ele já tinha.
  it("voltando de Em assinatura, o campo também sai null", async () => {
    const { atualizacoes, sb } = bancoDeTeste({
      card: { estagio: "assinatura", id: "card-1", proposta_id: "prop-1", tipo: "contrato" },
      envelopes: [],
    });
    const { porta } = portaDeTeste();

    await retornarParaAnalise(sb, pedido, porta);

    const doCard = atualizacoes.find((u) => u.tabela === "temis_trabalhos");
    expect(doCard?.patch.arrependimento_inicio).toBeNull();
  });
});

// ⚠️ AS FRASES DA CONFIRMAÇÃO VIVEM EM DOIS ARQUIVOS, E ISSO É DE PROPÓSITO. A tela de trabalho é
// `"use client"`: importar daqui arrastaria para o pacote do navegador a chamada da Clicksign e a
// escrita no Supabase que este módulo carrega junto. O preço de manter a cópia é a chance de as
// duas divergirem — e é exatamente isso que este teste impede, comparando byte a byte.
//
// ⚠️ E O QUE SE PERDE NUMA DIVERGÊNCIA NÃO É COSMÉTICO: a frase do envelope é a única coisa que
// avisa, ANTES do clique, que um envelope da conta de PRODUÇÃO vai ser cancelado e que quem já
// assinou terá de assinar de novo. Uma cópia resumida devolveria a surpresa para depois.
describe("a tela mostra as mesmas frases que este módulo define", () => {
  const TELA = readFileSync(
    join(__dirname, "../../modules/temis/blocks/trabalho/tela-de-trabalho.tsx"),
    "utf8",
  );

  it("a confirmação que avisa do cancelamento está na tela, palavra por palavra", () => {
    expect(TELA).toContain(AVISO_DA_VOLTA_COM_ENVELOPE);
    expect(AVISO_DA_VOLTA.assinatura).toBe(AVISO_DA_VOLTA_COM_ENVELOPE);
    expect(AVISO_DA_VOLTA.prazo_legal).toBe(AVISO_DA_VOLTA_COM_ENVELOPE);
  });

  it("a confirmação da etapa de Contrato está na tela, palavra por palavra", () => {
    expect(TELA).toContain(AVISO_DA_VOLTA_SIMPLES);
    expect(AVISO_DA_VOLTA.contrato).toBe(AVISO_DA_VOLTA_SIMPLES);
  });

  // ⚠️ INDEFERIDO NÃO MANDA CANCELAR NADA, e a tela tem de dizer o mesmo que o 409 deste módulo.
  // Até 12/09/2026 a tela usava UMA frase para Faturado e Indeferido, mandando abrir o pedido de
  // cancelamento nos dois — no card indeferido isso é conselho errado: não há contrato em pé.
  it("o indeferido, na tela, aponta para o Hércules e não para o cancelamento", () => {
    expect(TELA).toContain("A correção volta pelo Hércules, com quem vendeu.");

    const r = conferirEstagioParaVoltar("indeferido", "contrato");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("A correção volta pelo Hércules, com quem vendeu.");
  });
});
