import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FalhaDaClicksign, type Opcoes } from "@/lib/assinatura/clicksign/cliente";
import type { EnvelopeParaCancelar } from "@/lib/assinatura/envio-db";
import type { EstadoDaAssinatura } from "@/lib/assinatura/tipos";
import { type Banco, criarBanco } from "@/lib/hercules/banco-em-memoria.para-teste";

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
function linha(patch: Partial<EnvelopeParaCancelar>): EnvelopeParaCancelar {
  return {
    criado_em: "2026-09-11T12:00:00.000Z",
    envelope_id: "env-1",
    estado: "aguardando",
    falha: null,
    id: "reg-1",
    provedor: "clicksign",
    provedor_documento_id: "doc-1",
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

  // ⚠️ A LINHA SEM O ID DO DOCUMENTO NÃO É RECUSADA AQUI, E ISSO É A CORREÇÃO DE 25/09/2026. Cancelar
  // na v3 é um PATCH no DOCUMENTO ("Editar Documento",
  // `PATCH /envelopes/{envelope_id}/documents/{document_id}`), então sem `provedor_documento_id` não
  // há o que cancelar — mas esta função é PURA e só vê o nosso banco, que atrasa. Recusar aqui era
  // recusar antes de ler a Clicksign: prendia a linha até quando o envelope JÁ estava morto lá fora
  // (nada a cancelar) e mandava um humano cancelar à mão um envelope cujo estado ninguém tinha lido.
  // Quem recusa é `conferirEMatarOEnvelope`, com o estado medido na mão — ver o bloco do caminho
  // inteiro, mais abaixo.
  it("envelope vivo sem o id do documento não recusa aqui: devolve o envelope e documento null", () => {
    const r = conferirEnvelopeParaVoltar([
      linha({ envelope_id: "env-5", estado: "parcial", provedor_documento_id: null }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeParaCancelar).toBe("env-5");
    expect(r.documentoParaCancelar).toBeNull();
    expect(r.registroId).toBe("reg-1");
  });

  it("com o id do documento, diz qual documento cancelar", () => {
    const r = conferirEnvelopeParaVoltar([
      linha({ envelope_id: "env-6", estado: "parcial", provedor_documento_id: "doc-6" }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeParaCancelar).toBe("env-6");
    expect(r.documentoParaCancelar).toBe("doc-6");
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
  envelopes: EnvelopeParaCancelar[];
}) {
  const tabelas: string[] = [];
  /** O que cada `update` mandou escrever — é onde se confere o campo que a volta LIMPA. */
  const atualizacoes: { patch: Record<string, unknown>; tabela: string }[] = [];
  /**
   * As colunas que cada `select` PEDIU, por tabela.
   *
   * ⚠️ ESTE DUPLO DEVOLVE A LINHA INTEIRA DA FIXTURE, ENTÃO SEM ISTO O `select` NÃO ESTÁ PRESO POR
   * NADA. Voltar `COLUNAS_PARA_CANCELAR` para a lista antiga de seis colunas deixava a suíte inteira
   * verde e o `tsc` também (o cast é `as unknown as`), e em produção `provedor_documento_id` chegaria
   * `undefined`: a recusa dispararia em toda linha viva e o card da Nívea travaria de novo, com a
   * frase dizendo que o Panteon não guardou o documento — mentindo sobre o banco.
   */
  const colunasPedidas: { colunas: string; tabela: string }[] = [];

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
      select: (colunas?: string) => {
        if (typeof colunas === "string") colunasPedidas.push({ colunas, tabela });
        return builder;
      },
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

  return { atualizacoes, colunasPedidas, sb: { from } as unknown as SupabaseClient, tabelas };
}

/**
 * O duplo da porta HTTP: registra o que foi pedido. Ver a nota de `PortaDaClicksign`.
 *
 * ⚠️ O `get` ACEITA UMA LISTA, E NÃO É CONFORTO DE TESTE. Desde 25/09/2026 o cancelamento faz DUAS
 * leituras do envelope: a de antes, que decide se pode cancelar, e a de DEPOIS do PATCH, que confirma
 * que o envelope morreu — o 200 do PATCH no documento não prova isso, e a doc não diz que prova (ver
 * `cancelarEnvelope`). Um duplo com uma resposta só para os dois GETs não consegue montar o caso que
 * importa: running antes, running ainda depois. A última resposta da lista repete.
 */
function portaDeTeste(
  respostas: { get?: Error | unknown | (Error | unknown)[]; patch?: Error | unknown } = {},
) {
  const chamadas: { caminho: string; metodo: string }[] = [];
  const gets = Array.isArray(respostas.get) ? [...respostas.get] : [respostas.get];
  let lidos = 0;

  const porta = async <T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> => {
    const metodo = opcoes.metodo ?? "GET";
    chamadas.push({ caminho, metodo });
    if (metodo !== "GET") {
      if (respostas.patch instanceof Error) throw respostas.patch;
      return (respostas.patch ?? {}) as T;
    }
    const resposta = gets[Math.min(lidos, gets.length - 1)];
    lidos += 1;
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

  const running = { data: { attributes: { status: "running" } } };
  const canceled = { data: { attributes: { status: "canceled" } } };

  it("banco diz parcial e a Clicksign diz running: cancela e volta", async () => {
    const { sb } = bancoDeTeste({
      card: cardEmAssinatura,
      envelopes: [linha({ envelope_id: "env-vivo", estado: "parcial" })],
    });
    const { chamadas, porta } = portaDeTeste({ get: [running, canceled] });

    const r = await retornarParaAnalise(sb, pedido, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeCancelado).toBe("env-vivo");
    // ⚠️ O GET É NO ENVELOPE E O PATCH É NO DOCUMENTO — lido na doc em 25/09/2026. "Detalhes do
    // Envelope" é `GET /envelopes/{envelope_id}`; "Editar Documento" é
    // `PATCH /envelopes/{envelope_id}/documents/{document_id}`, e é lá que `canceled` é aceito.
    //
    // ⚠️ E SÃO TRÊS CHAMADAS, NÃO DUAS: o GET depois do PATCH é o que CONFIRMA que o envelope morreu.
    // O 200 do PATCH fala só do documento, e nenhuma das duas páginas da doc diz que um mata o outro.
    expect(chamadas).toEqual([
      { caminho: "/envelopes/env-vivo", metodo: "GET" },
      { caminho: "/envelopes/env-vivo/documents/doc-1", metodo: "PATCH" },
      { caminho: "/envelopes/env-vivo", metodo: "GET" },
    ]);
  });

  // ⚠️ O TESTE DA QUINTA INFERÊNCIA, MEDIDA NO CAMINHO INTEIRO: o PATCH no documento volta 200 e o
  // ENVELOPE continua `running` na conta. Nada disso está na doc (as duas páginas foram lidas em
  // 25/09/2026 e nenhuma liga uma coisa à outra), então o card NÃO volta e NADA é gravado. Se
  // voltasse, o Panteon afirmaria na auditoria uma morte que não houve, `cancelado` (terminal) faria o
  // `auto_close` seguinte ser descartado, e `ESTADOS_QUE_LIBERAM_REENVIO` liberaria um SEGUNDO
  // envelope pago com o primeiro ainda correndo.
  it("PATCH 200 e o envelope ainda running: o card NÃO volta e nada é gravado", async () => {
    const { atualizacoes, sb } = bancoDeTeste({
      card: cardEmAssinatura,
      envelopes: [linha({ envelope_id: "env-vivo", estado: "parcial" })],
    });
    const { chamadas, porta } = portaDeTeste({ get: [running, running] });

    const r = await retornarParaAnalise(sb, pedido, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    // A frase não afirma a morte nem a vida do envelope: manda conferir.
    expect(r.erro).toContain("não conseguiu confirmar");
    expect(r.erro).toContain("env-vivo");
    expect(r.erro).not.toContain("tente de novo");
    // Nem o card andou, nem a linha do envelope foi carimbada.
    expect(atualizacoes).toEqual([]);
    expect(chamadas.map((c) => c.metodo)).toEqual(["GET", "PATCH", "GET"]);
  });

  // ⚠️ A RECUSA POR FALTA DO ID DO DOCUMENTO VEM DEPOIS DA LEITURA, e é o que este teste prende. O
  // envelope foi LIDO e está correndo agora: só então a frase pode mandar cancelar por lá. Antes de
  // 25/09/2026 esta recusa vinha antes do GET, e mandava cancelar à mão um envelope cujo estado
  // ninguém havia lido — inclusive um assinado por todos com o webhook a caminho.
  it("linha viva sem o id do documento: lê primeiro, e só então recusa mandando cancelar por lá", async () => {
    const { atualizacoes, sb } = bancoDeTeste({
      card: cardEmAssinatura,
      envelopes: [linha({ envelope_id: "env-vivo", estado: "parcial", provedor_documento_id: null })],
    });
    const { chamadas, porta } = portaDeTeste({ get: running });

    const r = await retornarParaAnalise(sb, pedido, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("env-vivo");
    expect(r.erro).toContain("o webhook grava o cancelamento aqui");
    // Leu o estado ANTES de recusar, e não mandou PATCH nenhum.
    expect(chamadas).toEqual([{ caminho: "/envelopes/env-vivo", metodo: "GET" }]);
    expect(atualizacoes).toEqual([]);
  });

  // ⚠️ E A SAÍDA DO WEBHOOK PERDIDO VOLTOU A FUNCIONAR PARA ESSA LINHA: a Clicksign já cancelou, não
  // há NADA a cancelar, e o card volta sem PATCH. Com a recusa antes da leitura, esta linha ficava
  // presa para sempre — recusando um cancelamento que não precisava acontecer.
  it("linha sem o id do documento e envelope já canceled: volta sem PATCH nenhum", async () => {
    const { sb } = bancoDeTeste({
      card: cardEmAssinatura,
      envelopes: [linha({ envelope_id: "env-morto", estado: "parcial", provedor_documento_id: null })],
    });
    const { chamadas, porta } = portaDeTeste({ get: canceled });

    const r = await retornarParaAnalise(sb, pedido, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeCancelado).toBeNull();
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
  });

  // ⚠️ O `select` DO CAMINHO DA NÍVEA FICA PRESO AQUI. O duplo devolve a linha inteira da fixture, que
  // sempre traz `provedor_documento_id`: sem esta asserção, voltar a lista de colunas para a antiga
  // deixava a suíte verde e o `tsc` também, e em produção o id chegaria `undefined`.
  it("a consulta dos envelopes PEDE o provedor_documento_id", async () => {
    const { colunasPedidas, sb } = bancoDeTeste({
      card: cardEmAssinatura,
      envelopes: [linha({ envelope_id: "env-vivo", estado: "parcial" })],
    });
    const { porta } = portaDeTeste({ get: [running, canceled] });

    await retornarParaAnalise(sb, pedido, porta);

    const doEnvelope = colunasPedidas.find((c) => c.tabela === "temis_envelopes");
    expect(doEnvelope?.colunas).toContain("provedor_documento_id");
    // E as colunas da régua continuam lá: é o mesmo `select` das duas perguntas.
    expect(doEnvelope?.colunas).toContain("envelope_id");
    expect(doEnvelope?.colunas).toContain("estado");
    expect(doEnvelope?.colunas).toContain("provedor");
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

  // ⚠️ A RECUSA DA API PAROU DE AFIRMAR QUE O CONTRATO SEGUE ASSINÁVEL, E ISSO FOI MEDIDO NA DOC EM
  // 25/09/2026: o documento aceita `canceled` só enquanto está `running` ("Editar Documento"), então um
  // 4xx aqui é tanto "recusou" quanto "esse documento JÁ está cancelado". O segundo caso é o clique
  // repetido depois de um carimbo que falhou no banco, e nele a frase antiga dizia ao operador que as
  // pessoas continuavam com o contrato atual para assinar quando ninguém mais assina aquilo.
  it("recusa da API: manda conferir, sem afirmar que o contrato segue assinável", async () => {
    const { sb } = bancoComEnvelopeVivo();
    const { porta } = portaDeTeste({
      get: respondeRunning,
      patch: falha(422),
    });

    const r = await retornarParaAnalise(sb, pedido, porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.erro).toContain("A Clicksign recusou o cancelamento do contrato do envelope env-vivo");
    expect(r.erro).toContain("pode ser porque o documento JÁ está cancelado ou fechado");
    expect(r.erro).toContain("o webhook grava o cancelamento aqui e libera a volta");
    // A frase NÃO afirma mais o que o código não sabe.
    expect(r.erro).not.toContain("as pessoas continuam com o contrato atual para assinar. Cancele");
    expect(r.erro).not.toContain("tente de novo");
  });

  // ⚠️ TIMEOUT NÃO É RECUSA: o PATCH pode ter chegado. Afirmar "continuam com o contrato atual"
  // aqui seria trocar dúvida por certeza falsa — a mesma decisão que `carimbarFalha` toma no envio.
  //
  // ⚠️ E A FRASE PAROU DE DIZER "A CLICKSIGN NÃO RESPONDEU", porque desde 25/09/2026 ela cobre dois
  // fatos: o timeout e a releitura que não confirmou a morte do envelope (nesse a Clicksign respondeu,
  // e aceitou). O que os dois têm em comum é o que ela afirma.
  it("timeout: diz que o Panteon não conseguiu confirmar a morte do envelope", async () => {
    const { sb } = bancoComEnvelopeVivo();
    const { porta } = portaDeTeste({ get: respondeRunning, patch: falha(0) });

    const r = await retornarParaAnalise(sb, pedido, porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("não conseguiu confirmar");
    expect(r.erro).toContain("pode ter sido cancelado lá ou continuar valendo");
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

// ── A VENDA VOLTA JUNTO COM O CARD ─────────────────────────────────────────────
//
// Lucas, 24/09/2026: *"preciso garantir que tudo que acontece na temis reflete no hercules"*. A volta
// para correção a partir de "Em assinatura" ou do Pré-faturamento devolve a venda de `assinatura`
// para `contrato`. E isto não é enfeite: sem a volta, o Indeferir seguinte não devolve a venda a quem
// vendeu, porque `devolverAQuemVendeu` só age em venda em `contrato`
// (indeferimento-na-venda-server.ts).

describe("a volta para correção leva a venda de volta para contrato", () => {
  const bancos: Banco[] = [];
  afterEach(() => {
    for (const b of bancos) expect(b.problemas).toEqual([]);
    bancos.length = 0;
    vi.restoreAllMocks();
  });

  const bancoDaVolta = (estagio: string, etapa: string): Banco => {
    const b = criarBanco({
      hercules_proposta_etapas: [],
      hercules_propostas: [
        { etapa, etapa_desde: "2026-09-23T14:00:00.000Z", id: "venda-1", workspace_id: "careli" },
      ],
      temis_envelopes: [],
      temis_trabalho_etapas: [],
      temis_trabalhos: [
        { estagio, estagio_desde: "2026-09-23T14:00:00.000Z", id: "card-1", proposta_id: "venda-1", tipo: "contrato", workspace_id: "careli" },
      ],
    });
    bancos.push(b);
    return b;
  };

  it.each(["assinatura", "prazo_legal"])(
    "de %s: a venda vai de assinatura para contrato, com histórico e autor",
    async (estagio) => {
      const b = bancoDaVolta(estagio, "assinatura");

      const r = await retornarParaAnalise(b.cliente, { ...pedido, usuarioNome: "Nivea" }, portaDeTeste().porta);

      expect(r.ok).toBe(true);
      expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("analise");
      expect(b.linha("hercules_propostas", "venda-1")).toMatchObject({ etapa: "contrato", etapa_por: "Nivea" });
      expect(b.linhas("hercules_proposta_etapas")).toEqual([
        expect.objectContaining({
          autor_nome: "Nivea",
          de: "assinatura",
          motivo: "Contrato voltou para correção na Têmis",
          para: "contrato",
        }),
      ]);
      if (r.ok) expect(r.avisoDoHercules ?? null).toBeNull();
    },
  );

  it("de contrato para a análise: a venda já está em contrato e não é tocada (os 8 casos medidos)", async () => {
    const b = bancoDaVolta("contrato", "contrato");
    const r = await retornarParaAnalise(b.cliente, pedido, portaDeTeste().porta);
    expect(r.ok).toBe(true);
    expect(b.consultas.some((q) => q.tabela === "hercules_propostas" && q.operacao === "update")).toBe(false);
    expect(b.linhas("hercules_proposta_etapas")).toEqual([]);
  });

  it("venda que não acompanha (voltou a quem vendeu): o card volta, a resposta é ok com avisoDoHercules", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = bancoDaVolta("assinatura", "proposta");
    const r = await retornarParaAnalise(b.cliente, pedido, portaDeTeste().porta);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("analise");
    expect(b.linha("hercules_propostas", "venda-1")?.etapa).toBe("proposta");
    expect(r.avisoDoHercules).toContain("a venda no Hércules não acompanhou");
  });
});
