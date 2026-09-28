import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  abrirRegistro,
  carimbarFalha,
  carimbarSucesso,
  type EnvelopeDaProposta,
  envelopeQueSegura,
  finalidadeDoEnvio,
} from "./envio-db";
import type { Signatario } from "./tipos";

// ⚠️ O QUE ESTES TESTES PROTEGEM: a conta da Clicksign, que é de PRODUÇÃO. Envelope custa e, depois
// de ativado, NÃO se apaga — só se cancela, e o cancelado fica na lista para sempre. Esta régua é a
// única coisa entre um segundo clique e o segundo envelope do mesmo contrato; errar para o outro
// lado (segurar demais) trava uma venda que tinha direito de ser reenviada, então os dois sentidos
// estão cobertos aqui.
//
// Os valores vêm do arquivo e da migration 0149: `estado` é `EstadoDaAssinatura`, `envelope_id` só
// nasce quando SOBROU algo na conta (`clicksign/envelope.ts`: `rascunhoApagado ? null : envelopeId`)
// e `falha` guarda o texto da recusa.

/** Uma linha de `temis_envelopes`, com o que a régua lê. */
function linha(patch: Partial<EnvelopeDaProposta>): EnvelopeDaProposta {
  return {
    criado_em: "2026-09-11T12:00:00.000Z",
    envelope_id: null,
    estado: "aguardando",
    falha: null,
    id: "reg-1",
    provedor: "clicksign",
    ...patch,
  };
}

describe("o que LIBERA o reenvio", () => {
  // O caso de uso de verdade: o envelope foi cancelado na Clicksign, o webhook gravou `cancelado`
  // aqui, e alguém precisa mandar o contrato de novo.
  it.each(["cancelado", "expirado", "recusado"])("%s não segura, mesmo com envelope_id", (estado) => {
    expect(envelopeQueSegura([linha({ envelope_id: "env-9", estado })])).toBeNull();
  });

  // ⚠️ `falha` COM `envelope_id` NULO QUER DIZER "NADA FICOU LÁ", com todas as letras: no passo 1 o
  // envelope nem chegou a existir, e nos passos seguintes o rascunho foi apagado e o id voltou nulo
  // de propósito. Segurar aqui travaria toda venda cujo primeiro envio falhou cedo.
  it("a tentativa que falhou sem deixar envelope não segura", () => {
    expect(envelopeQueSegura([linha({ falha: "A Clicksign recusou no passo criar" })])).toBeNull();
  });

  it("proposta sem envelope nenhum não segura", () => {
    expect(envelopeQueSegura([])).toBeNull();
  });
});

describe("o que SEGURA o envio", () => {
  it("envelope aguardando assinatura segura", () => {
    const vivo = envelopeQueSegura([linha({ envelope_id: "env-1", estado: "aguardando" })]);
    expect(vivo?.envelope_id).toBe("env-1");
  });

  // ⚠️ O PIOR CASO, E O MAIS PROVÁVEL: falha no passo `notificar` deixa o envelope ATIVO e gravado
  // com `envelope_id` + `aguardando`. Um segundo envio aqui põe DOIS envelopes running cobrando.
  it("a falha do notificar segura, porque ela grava o id do envelope que ficou ativo", () => {
    const vivo = envelopeQueSegura([
      linha({ envelope_id: "env-2", estado: "aguardando", falha: "notificar: 500" }),
    ]);
    expect(vivo?.envelope_id).toBe("env-2");
  });

  // ⚠️ A LINHA AMBÍGUA: começou e ninguém sabe como terminou (a função morreu, o timeout da Vercel,
  // o `carimbarFalha` que não gravou). Recusar é a escolha da casa — e é ela que também segura o
  // duplo clique, porque durante o envio normal a linha vive exatamente nesse estado.
  it("o envio que começou e não terminou segura", () => {
    const vivo = envelopeQueSegura([linha({ envelope_id: null, estado: "rascunho", falha: null })]);
    expect(vivo?.id).toBe("reg-1");
  });

  it("contrato já assinado segura", () => {
    const vivo = envelopeQueSegura([linha({ envelope_id: "env-3", estado: "assinado" })]);
    expect(vivo?.estado).toBe("assinado");
  });

  // Estado que o código não conhece não é permissão: só os três da lista liberam.
  it("estado desconhecido com envelope na conta segura", () => {
    expect(envelopeQueSegura([linha({ envelope_id: "env-4", estado: "sei_la" })])).not.toBeNull();
  });
});

describe("com mais de uma linha", () => {
  // A consulta pede `criado_em desc`: a primeira que segura é a mais recente, e é o id dela que a
  // frase da recusa manda conferir. Mandar conferir o envelope mais velho é mandar procurar o errado.
  it("devolve a linha que segura, na ordem em que vieram", () => {
    const vivo = envelopeQueSegura([
      linha({ criado_em: "2026-09-11T15:00:00.000Z", envelope_id: "env-novo", estado: "aguardando" }),
      linha({ criado_em: "2026-09-10T09:00:00.000Z", envelope_id: "env-velho", estado: "aguardando" }),
    ]);
    expect(vivo?.envelope_id).toBe("env-novo");
  });

  // ⚠️ UM CANCELADO NÃO PERDOA O VIVO. O histórico de uma venda reenviada tem as duas linhas, e
  // achar o cancelado primeiro não pode virar "pode mandar".
  it("o cancelado antigo não libera o vivo de hoje", () => {
    const vivo = envelopeQueSegura([
      linha({ envelope_id: "env-cancelado", estado: "cancelado" }),
      linha({ envelope_id: "env-vivo", estado: "aguardando" }),
    ]);
    expect(vivo?.envelope_id).toBe("env-vivo");
  });

  it("só linhas liberadas não seguram nada", () => {
    const nenhum = envelopeQueSegura([
      linha({ envelope_id: "env-cancelado", estado: "cancelado" }),
      linha({ envelope_id: "env-recusado", estado: "recusado" }),
      linha({ falha: "não deu", id: "reg-2" }),
    ]);
    expect(nenhum).toBeNull();
  });
});

// ── O CARIMBO PELA FUNÇÃO DA 0195 (F1 da fonte única, 28/09/2026) ─────────────────
//
// ⚠️ O QUE ERA: `carimbarSucesso` gravava `estado = aguardando` e o jsonb inteiro dos signatários
// por update direto, sem condição. O webhook chega ANTES do carimbo (26 de 26 uploads, medido): um
// `sign` que já tivesse virado "parcial" voltava a "aguardando", e a marca de quem assinou sumia.

/** Um duplo que guarda os updates por tabela e as chamadas à função da 0195. */
function bancoDoCarimbo(funcao?: { data: unknown; error: null | { code: string; message: string } }) {
  const updates: Array<{ filtros: Array<[string, unknown]>; patch: Record<string, unknown>; tabela: string }> = [];
  const chamadas: Array<Record<string, unknown>> = [];

  const from = (tabela: string) => {
    const registro = { filtros: [] as Array<[string, unknown]>, patch: {} as Record<string, unknown>, tabela };
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      eq: (coluna: string, valor: unknown) => {
        registro.filtros.push([coluna, valor]);
        return builder;
      },
      in: (coluna: string, valor: unknown) => {
        registro.filtros.push([`in:${coluna}`, valor]);
        return builder;
      },
      is: (coluna: string, valor: unknown) => {
        registro.filtros.push([`is:${coluna}`, valor]);
        return builder;
      },
      not: (coluna: string, operador: string, valor: unknown) => {
        registro.filtros.push([`not-${operador}:${coluna}`, valor]);
        return builder;
      },
      then: (resolver: (r: { error: null }) => unknown) => Promise.resolve(resolver({ error: null })),
      update: (patch: Record<string, unknown>) => {
        registro.patch = patch;
        updates.push(registro);
        return builder;
      },
    });
    return builder;
  };

  const rpc = (_nome: string, args: Record<string, unknown>) => {
    chamadas.push(args);
    return Promise.resolve(
      funcao ?? {
        data: [
          {
            assinaram: 0,
            estado_antes: "rascunho",
            estado_depois: "aguardando",
            fechado: null,
            mudou_estado: true,
            quadro: args.p_quadro ?? [],
            recusa: null,
            total: 0,
          },
        ],
        error: null,
      },
    );
  };

  return { chamadas, sb: { from, rpc } as unknown as SupabaseClient, updates };
}

const QUEM_ASSINA: Signatario[] = [
  { email: "compradora@x.com", nome: "Vitória", ordem: 1, papel: "comprador" },
  { email: "vendedora@x.com", nome: "Vendedora", ordem: 2, papel: "vendedora" },
];

describe("o carimbo do envio não escreve estado nem quadro por update direto", () => {
  it("sucesso: ids por update; estado e quadro (com a chave da Clicksign) pela função", async () => {
    const { chamadas, sb, updates } = bancoDoCarimbo();

    await carimbarSucesso(
      sb,
      "reg-1",
      { documentoId: "doc-1", envelopeId: "env-1", signatarios: { "compradora@x.com": "sig-a" } },
      QUEM_ASSINA,
    );

    const doEnvelope = updates.filter((u) => u.tabela === "temis_envelopes");
    expect(doEnvelope).toHaveLength(1);
    expect(doEnvelope[0]?.patch).toMatchObject({ envelope_id: "env-1", provedor_documento_id: "doc-1" });
    expect(doEnvelope[0]?.patch).not.toHaveProperty("estado");
    expect(doEnvelope[0]?.patch).not.toHaveProperty("signatarios");
    expect(doEnvelope[0]?.filtros).toContainEqual(["not-in:estado", "(assinado,recusado,cancelado,expirado)"]);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({
      p_envelope: "reg-1",
      p_estado: "aguardando",
      p_estado_cru: "clicksign:running",
      // ⚠️ Quem a Clicksign devolveu leva o id dela; quem não, a chave provisória da posição.
      p_quadro: [
        { chave: "sig-a", email: "compradora@x.com", nome: "Vitória", ordem: 1, papel: "comprador" },
        { chave: "tmp:2", email: "vendedora@x.com", nome: "Vendedora", ordem: 2, papel: "vendedora" },
      ],
    });

    // Os eventos que chegaram antes do carimbo ganham o envelope_id (Integridade M2).
    const dosEventos = updates.filter((u) => u.tabela === "temis_assinatura_eventos");
    expect(dosEventos).toHaveLength(1);
    expect(dosEventos[0]?.patch).toEqual({ envelope_id: "env-1" });
    expect(dosEventos[0]?.filtros).toContainEqual(["provedor_documento_id", "doc-1"]);
    expect(dosEventos[0]?.filtros).toContainEqual(["is:envelope_id", null]);
    // ⚠️ Só o conferido: o documento do não conferido veio de um corpo que qualquer um escreve.
    expect(dosEventos[0]?.filtros).toContainEqual(["assinatura_conferida", true]);
  });

  it("falha no notificar: a falha por update, e o ativo pela função", async () => {
    const { chamadas, sb, updates } = bancoDoCarimbo();

    await carimbarFalha(sb, "reg-1", {
      documentoId: "doc-1",
      envelopeId: "env-1",
      erro: "500",
      passo: "notificar",
      rascunhoApagado: false,
    });

    expect(updates).toHaveLength(1);
    expect(updates[0]?.patch).not.toHaveProperty("estado");
    expect(updates[0]?.patch).toMatchObject({ envelope_id: "env-1", provedor_documento_id: "doc-1" });
    expect(chamadas).toEqual([expect.objectContaining({ p_estado: "aguardando", p_quadro: null })]);
  });

  it("falha antes de ativar: nada de estado, nem pela função", async () => {
    const { chamadas, sb } = bancoDoCarimbo();

    await carimbarFalha(sb, "reg-1", {
      documentoId: null,
      envelopeId: null,
      erro: "422",
      passo: "criar",
      rascunhoApagado: true,
    });

    expect(chamadas).toEqual([]);
  });

  // ⚠️ SEM CAMINHO DE RESERVA (plano, F1): a 0195 é aplicada ANTES do deploy. Sem a função, o
  // carimbo não escreve estado por fora (seria a segunda cópia da regra monotônica, sem trava).
  it("sem a 0195 no banco: NENHUM update de estado por fora", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { chamadas, sb, updates } = bancoDoCarimbo({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.temis_envelope_registrar_assinaturas" },
    });

    await carimbarSucesso(sb, "reg-1", { documentoId: "doc-1", envelopeId: "env-1" }, QUEM_ASSINA);

    expect(chamadas).toHaveLength(1);
    expect(updates.some((u) => u.tabela === "temis_envelopes" && "estado" in u.patch)).toBe(false);
    expect(updates.some((u) => "signatarios" in u.patch)).toBe(false);
  });
});

// ── A FINALIDADE DO ENVELOPE (F1 da fonte única, Segurança 8 do plano) ──────
//
// ⚠️ O QUE SE PROTEGE: `finalidade` é a coluna que a F2 e a F4 usam para decidir o que é CONTRATO.
// Um distrato gravado como "contrato" vira "contrato assinado" lá na frente, com a suíte verde. O
// card vem do navegador: só vale se for DESTA proposta; sem card, só "contrato" quando é o único.

/** Um duplo que devolve os cards da proposta (ou um erro) e guarda os inserts. */
function bancoDaFinalidade(dados: {
  cards?: Array<{ id: string; tipo: string }>;
  erroDaLeitura?: { code: string; message: string };
  erroDoInsert?: { code: string; message: string };
}) {
  const inserts: Array<Record<string, unknown>> = [];
  const filtros: Array<[string, unknown]> = [];
  const from = (tabela: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      eq: (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return tabela === "temis_trabalhos"
          ? Promise.resolve({
              data: dados.erroDaLeitura ? null : (dados.cards ?? []),
              error: dados.erroDaLeitura ?? null,
            })
          : builder;
      },
      insert: (valores: Record<string, unknown>) => {
        inserts.push(valores);
        return builder;
      },
      maybeSingle: () =>
        Promise.resolve(
          dados.erroDoInsert
            ? { data: null, error: dados.erroDoInsert }
            : { data: { id: "reg-novo" }, error: null },
        ),
      select: () => builder,
    });
    return builder;
  };
  return { filtros, inserts, sb: { from } as unknown as SupabaseClient };
}

describe("finalidadeDoEnvio: o que este envelope assina", () => {
  it("(a) card DESTA proposta, de distrato: distrato, com o id do card", async () => {
    const { filtros, sb } = bancoDaFinalidade({
      cards: [
        { id: "card-contrato", tipo: "contrato" },
        { id: "card-distrato", tipo: "distrato" },
      ],
    });

    const r = await finalidadeDoEnvio(sb, "prop-1", "card-distrato");

    expect(r).toEqual({ finalidade: "distrato", trabalhoId: "card-distrato" });
    expect(filtros).toContainEqual(["proposta_id", "prop-1"]);
  });

  it("(b) card de OUTRA proposta não vale: cai na regra sem card", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sb } = bancoDaFinalidade({
      cards: [
        { id: "card-contrato", tipo: "contrato" },
        { id: "card-distrato", tipo: "distrato" },
      ],
    });

    const r = await finalidadeDoEnvio(sb, "prop-1", "card-de-outra-venda");

    // Dois cards e nenhum válido: nulo, e nunca "contrato" por palpite.
    expect(r).toEqual({ finalidade: null, trabalhoId: null });
    expect(aviso).toHaveBeenCalled();
  });

  it("(b2) card de outra proposta, com um único card de contrato nesta: contrato pelo único", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sb } = bancoDaFinalidade({ cards: [{ id: "card-contrato", tipo: "contrato" }] });

    const r = await finalidadeDoEnvio(sb, "prop-1", "card-de-outra-venda");

    expect(r).toEqual({ finalidade: "contrato", trabalhoId: "card-contrato" });
  });

  it("(c) sem card, e um card só, de contrato: contrato", async () => {
    const { sb } = bancoDaFinalidade({ cards: [{ id: "card-contrato", tipo: "contrato" }] });

    const r = await finalidadeDoEnvio(sb, "prop-1", null);

    expect(r).toEqual({ finalidade: "contrato", trabalhoId: "card-contrato" });
  });

  it("(d) sem card, com contrato e cancelamento: nulo (não adivinha)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { sb } = bancoDaFinalidade({
      cards: [
        { id: "card-contrato", tipo: "contrato" },
        { id: "card-cancelamento", tipo: "cancelamento" },
      ],
    });

    const r = await finalidadeDoEnvio(sb, "prop-1", null);

    expect(r).toEqual({ finalidade: null, trabalhoId: null });
  });

  it("(e) leitura dos cards com erro: nulo, sem lançar (a classificação não barra o envio)", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { sb } = bancoDaFinalidade({ erroDaLeitura: { code: "57014", message: "timeout" } });

    await expect(finalidadeDoEnvio(sb, "prop-1", "card-contrato")).resolves.toEqual({
      finalidade: null,
      trabalhoId: null,
    });
    // O log leva só code e message.
    expect(erro).toHaveBeenCalledWith(expect.any(String), { code: "57014", message: "timeout" });
  });
});

describe("abrirRegistro grava a finalidade e o card", () => {
  const dados = {
    documentoId: "doc-hercules-1",
    enterpriseId: "ent-1",
    finalidade: "distrato" as const,
    nome: "Contrato",
    ordenada: true,
    propostaId: "prop-1",
    signatarios: QUEM_ASSINA,
    trabalhoId: "card-distrato",
    unidadeId: "uni-1",
    usuarioId: "u-1",
    usuarioNome: "Operador",
  };

  it("o insert leva finalidade e trabalho_id, e o quadro com a chave provisória", async () => {
    const { inserts, sb } = bancoDaFinalidade({});

    const r = await abrirRegistro(sb, dados);

    expect(r).toEqual({ id: "reg-novo", ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ estado: "rascunho", finalidade: "distrato", trabalho_id: "card-distrato" });
    expect((inserts[0]?.signatarios as Array<{ chave: string }>).map((p) => p.chave)).toEqual(["tmp:1", "tmp:2"]);
  });

  // ⚠️ SEM RESERVA (plano, F1): sem as colunas da 0195 o insert NÃO é repetido sem elas. O envio
  // para aqui (503) e nada vai para a Clicksign, que é o lado seguro.
  it("sem as colunas da 0195 (PGRST204): um insert só, e 503 apontando a migration", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { inserts, sb } = bancoDaFinalidade({
      erroDoInsert: {
        code: "PGRST204",
        message: "Could not find the 'finalidade' column of 'temis_envelopes' in the schema cache",
      },
    });

    const r = await abrirRegistro(sb, dados);

    expect(inserts).toHaveLength(1);
    expect(r).toMatchObject({ ok: false, status: 503 });
    if (r.ok) return;
    expect(r.erro).toContain("0195");
  });
});
