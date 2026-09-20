import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GuardianCompromissoDetail } from "@/lib/guardian/compromissos";

// REVISÃO INDEPENDENTE DE 20/09/2026 — a lente é A TELA E A SEGURANÇA.
//
// ⚠️ OS TESTES DESTE ARQUIVO NASCERAM VERMELHOS, um por achado da revisão. Os seis foram corrigidos
// em 20/09/2026 e ficaram aqui para travar o conserto: o comentário de cada um guarda o que era, que
// é a única coisa que explica por que a linha de baixo importa.
//
// ⚠️ NADA AQUI TOCA A CLICKSIGN: a porta é um duplo e a contagem de chamadas dele é a prova. A conta
// é de produção, cada envelope custa e o ativado não se apaga.

const leituraDaVenda = vi.fn();
const quadroDoEmpreendimento = vi.fn();

vi.mock("@/lib/temis/dados-do-contrato", () => ({
  dadosDaProposta: (...args: unknown[]) => leituraDaVenda(...args),
}));

vi.mock("@/lib/assinatura/quadro-db", () => ({
  assinantesDoQuadro: (...args: unknown[]) => quadroDoEmpreendimento(...args),
  empresasDoEmpreendimento: async () => ({ coordenador: null, vendedora: "ent-vendedora" }),
}));

const { enviarAcordoParaAssinatura } = await import("./envio-db");

const acordo = (patch: Partial<GuardianCompromissoDetail> = {}): GuardianCompromissoDetail =>
  ({
    acquisitionRequestC2xId: 9001,
    approvalStatus: "aprovado",
    clientC2xId: 2508,
    id: "11111111-2222-3333-4444-555555555555",
    kind: "acordo",
    metadata: {},
    parcelas: [{ amount: 591.08, dueDate: "2026-07-15", id: "p1", sequence: 1 }],
    protocol: "AC-000042",
    status: "ativo",
    ...patch,
  }) as unknown as GuardianCompromissoDetail;

const vendaDoPanteon = {
  dados: {
    compradores: [
      {
        temConjuge: false,
        valores: {
          cpf_cliente: "444.555.666-17",
          email_cliente: "comprador@exemplo.test",
          nome_cliente: "Beltrano Exemplo Ferreira",
        },
      },
    ],
    gerais: { __empreendimento_id: "19", codigo_unidade: "VDO1301", empreendimento_codigo: "VDO" },
  },
};

const representante = {
  cpf: "111.222.333-44",
  email: "representante@incorporadora.test",
  nome: "Fulana Representante Legal",
  papel: "vendedora" as const,
  telefone: null,
};

const PDF_PRONTO = async () => ({
  bytes: new Uint8Array([37, 80, 68, 70]),
  nome: "Termo de Acordo - REVISAO.pdf",
  ok: true as const,
});

/**
 * O Supabase do Panteon com memória: o que o `insert` grava passa a aparecer na leitura seguinte.
 *
 * ⚠️ A MEMÓRIA É O PONTO. O duplo do implementador devolve uma lista FIXA de envelopes, então nele
 * nenhuma segunda chamada enxerga o que a primeira gravou — e a corrida do segundo envelope não tem
 * como aparecer. Aqui a lista é viva.
 */
function bancoComMemoria() {
  const envelopes: Record<string, unknown>[] = [];
  const escritas: { patch: Record<string, unknown>; tabela: string }[] = [];

  const from = (tabela: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      eq: () => builder,
      insert: (patch: Record<string, unknown>) => {
        escritas.push({ patch, tabela });
        if (tabela === "temis_envelopes") {
          envelopes.unshift({
            atualizado_em: null,
            criado_em: new Date().toISOString(),
            enviado_em: null,
            enviado_por_nome: null,
            envelope_id: null,
            estado: "rascunho",
            estado_cru: null,
            falha: null,
            id: `registro-${envelopes.length + 1}`,
            provedor: "clicksign",
            provedor_documento_id: null,
          });
        }
        return builder;
      },
      limit: () => builder,
      maybeSingle: () =>
        Promise.resolve(
          tabela === "hercules_propostas"
            ? { data: { id: "prop-1", unidade_id: "uni-1" }, error: null }
            : { data: { id: `registro-${envelopes.length}` }, error: null },
        ),
      order: () => builder,
      select: () => builder,
      then: (resolver: (r: unknown) => unknown) =>
        Promise.resolve(resolver({ data: [...envelopes], error: null })),
      update: (patch: Record<string, unknown>) => {
        escritas.push({ patch, tabela });
        return builder;
      },
    });
    return builder;
  };

  return { envelopes, escritas, sb: { from } as unknown as SupabaseClient };
}

/** O duplo da porta HTTP da Clicksign. */
function portaDeTeste() {
  const chamadas: { caminho: string; metodo: string }[] = [];

  const porta = async <T = unknown>(
    caminho: string,
    opcoes: { metodo?: string } = {},
  ): Promise<T> => {
    const metodo = opcoes.metodo ?? "GET";
    chamadas.push({ caminho, metodo });
    if (metodo === "POST" && caminho === "/envelopes") {
      return { data: { id: `env-${chamadas.length}` } } as T;
    }
    if (caminho.endsWith("/documents")) return { data: { id: "doc-1" } } as T;
    if (caminho.endsWith("/signers")) return { data: { id: "sig-1" } } as T;
    return {} as T;
  };

  return { chamadas, porta };
}

beforeEach(() => {
  leituraDaVenda.mockReset();
  quadroDoEmpreendimento.mockReset();
  leituraDaVenda.mockResolvedValue(vendaDoPanteon);
  quadroDoEmpreendimento.mockResolvedValue([representante]);
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// ACHADO 1 — A APROVAÇÃO É LIDA UMA VEZ SÓ, E NÃO MAIS DEPOIS
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// `enviarAcordoParaAssinatura` pergunta o gate no passo 1 e nunca mais. Entre ele e a chamada que
// cria o envelope correm quatro esperas: a venda no Panteon, a leitura dos envelopes, a montagem do
// PDF (que abre o C2X: `montarTermoDoAcordoEmPdf` chama `loadHadesAttendanceClient`) e o insert do
// registro. A rota reserva 120s para isso. Se a aprovação cair nesse meio, o envelope sai assim
// mesmo — pago, permanente, com as condições que deixaram de valer.
describe("a corrida de dentro do envio", () => {
  it("a aprovação cai no meio do envio e NADA sai", async () => {
    const { escritas, sb } = bancoComMemoria();
    const { chamadas, porta } = portaDeTeste();
    const caso = acordo();

    // O gestor reprova enquanto o papel está sendo montado — que é exatamente a espera mais longa
    // do caminho, porque é ela que abre o C2X.
    const montarPdf = async () => {
      (caso as { approvalStatus: string }).approvalStatus = "reprovado";
      return PDF_PRONTO();
    };

    const saida = await enviarAcordoParaAssinatura(sb, caso, {}, { montarPdf, porta });

    // A régua do Lucas conferida OUTRA VEZ, contra o banco, imediatamente antes de gravar a
    // intenção (`aprovacaoAindaVale`): nada sai, e nem a linha do registro nasce.
    expect(chamadas).toHaveLength(0);
    expect(escritas).toHaveLength(0);
    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.status).toBe(409);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// ACHADO 2 — DOIS ENVIOS AO MESMO TEMPO CRIAM DOIS ENVELOPES
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// A guarda contra o segundo envelope é um SELECT seguido de um INSERT, sem nada no banco que
// impeça a segunda linha: a migration 0179 cria o índice `temis_envelopes_compromisso_idx` como
// NÃO único. Duas abas, dois operadores, ou um retry depois do timeout de 120s caem na janela entre
// a leitura e a escrita — e cada envelope custa e não se apaga.
describe("o segundo envelope do mesmo acordo", () => {
  it("dois envios simultâneos criam UM envelope na Clicksign", async () => {
    const { sb } = bancoComMemoria();
    const { chamadas, porta } = portaDeTeste();

    const [a, b] = await Promise.all([
      enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta }),
      enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta }),
    ]);

    const envelopesCriados = chamadas.filter(
      (c) => c.metodo === "POST" && c.caminho === "/envelopes",
    );

    // Um acordo, um envelope: quem grava a segunda linha lê de volta, se vê atrás da primeira e
    // desiste ANTES de tocar a API que cobra.
    expect(envelopesCriados).toHaveLength(1);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });

  // A prova de que a guarda funciona quando as duas chamadas NÃO se cruzam: a segunda vê a linha da
  // primeira e para. O defeito acima é só a janela entre o SELECT e o INSERT.
  it("em sequência, a guarda segura o segundo envio", async () => {
    const { sb } = bancoComMemoria();
    const { chamadas, porta } = portaDeTeste();

    await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta });
    const segundo = await enviarAcordoParaAssinatura(
      sb,
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(segundo.ok).toBe(false);
    if (!segundo.ok) expect(segundo.status).toBe(409);
    expect(chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/envelopes")).toHaveLength(
      1,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// A TELA, LIDA COMO TEXTO — o mesmo recurso de `termo-de-acordo-na-tela.test.ts`
// ────────────────────────────────────────────────────────────────────────────────────────────

const TELA = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "..",
    "modules",
    "guardian",
    "attendance",
    "components",
    "PropostasPanel.tsx",
  ),
  "utf8",
);

/** O trecho do componente de assinatura, até a próxima função de topo. */
function componenteDaAssinatura(): string {
  const inicio = TELA.indexOf("function AssinaturaDoAcordo(");
  expect(inicio).toBeGreaterThan(-1);
  const resto = TELA.slice(inicio);
  const fim = resto.indexOf("\nfunction ", 1);
  return fim === -1 ? resto : resto.slice(0, fim);
}

// ── O QUE A REVISÃO CONFERIU E ESTÁ CERTO ───────────────────────────────────

describe("a chave de liberação", () => {
  it("continua desligada, e esconde TAMBÉM o bloco de assinatura", () => {
    const chaves = readFileSync(
      join(__dirname, "..", "..", "apolo", "termos-liberados.ts"),
      "utf8",
    );

    expect(chaves).toContain("export const TERMO_DE_ACORDO_LIBERADO = false;");
    expect(chaves).toContain("export const TERMO_DE_RESCISAO_LIBERADO = false;");

    // Os dois blocos do card nascem atrás da MESMA chave: com ela desligada, nem o botão do termo
    // nem o de assinatura existem na tela.
    expect(TELA).toContain(
      "{isAcordo && TERMO_DE_ACORDO_LIBERADO ? <TermoDeAcordoAcao item={item} /> : null}",
    );
    expect(TELA).toContain(
      "{isAcordo && TERMO_DE_ACORDO_LIBERADO ? <AssinaturaDoAcordo item={item} /> : null}",
    );
    // E não nasceu uma segunda chave.
    expect(TELA).not.toContain("ASSINATURA_DO_ACORDO_LIBERADA");
  });
});

// ⚠️ O VOLUME. Cada card dispara a SUA requisição ao abrir a ficha, e não há lote nem `in`: o custo
// cresce linearmente com o número de acordos do mesmo cliente. Medido no Supabase de produção em
// 20/09/2026: 12 clientes têm 1 acordo aprovado e 3 têm 2, ou seja, no máximo DUAS requisições caras
// por ficha hoje.
//
// ⚠️ E A REQUISIÇÃO DEIXOU DE SER CONDICIONADA AO GATE em 20/09/2026, de propósito: era ela que
// escondia o envelope vivo de um acordo que perdeu a aprovação. O custo do caso barrado é medido, e
// é baixo: `prepararEnvioDoAcordo` lê os envelopes e SAI no gate, antes de `dadosDaProposta` e do
// quadro do empreendimento, que são a parte cara; o diário só roda quando existe envelope. Para os
// 22 acordos reprovados de hoje, um select em `temis_envelopes` que devolve zero linhas.
describe("o volume da tela", () => {
  it("uma requisição por card, disparada no próprio card", () => {
    const trecho = componenteDaAssinatura();

    expect(trecho).toContain("useEffect(() => {");
    expect(trecho).toContain("void carregar();");
    expect(trecho).toContain("/api/guardian/termo-de-acordo/assinatura?acordo=");
    // Uma chamada por card: não existe carregador compartilhado na lista.
    expect(TELA.match(/termo-de-acordo\/assinatura\?acordo=/g) ?? []).toHaveLength(1);
  });

  it("o gate não desliga mais a leitura, e é o servidor que sai cedo", () => {
    const trecho = componenteDaAssinatura();

    // O `return` que fazia a tela nem perguntar morreu com o achado do envelope escondido.
    expect(trecho).not.toContain("if (motivoDoGate) return;");

    // E quem economiza é a lib: o gate roda DEPOIS da leitura dos envelopes e ANTES da venda.
    const envio = readFileSync(join(__dirname, "envio-db.ts"), "utf8");
    const preparo = envio.slice(envio.indexOf("export async function prepararEnvioDoAcordo("));
    const leEnvelopes = preparo.indexOf("envelopesDoCompromisso(");
    const roda = preparo.indexOf("motivoParaNaoEnviarParaAssinatura(");
    const leVenda = preparo.indexOf("vendaDoAcordo(");
    expect(leEnvelopes).toBeGreaterThan(-1);
    expect(roda).toBeGreaterThan(leEnvelopes);
    expect(leVenda).toBeGreaterThan(roda);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// ACHADO 3 — O ACORDO QUE PERDE A APROVAÇÃO DEPOIS DO ENVIO SOME DA TELA, COM O ENVELOPE DENTRO
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// `if (motivoDoGate) return null;` apaga o BLOCO INTEIRO, e não só o botão de enviar: vão junto o
// "N de M assinaram", o id do envelope e o botão de CANCELAR. O cancelamento foi deixado sem gate
// de propósito, porque é o gesto corretivo de quando a aprovação cai depois do envio — e é
// exatamente nesse caso que a tela deixa de oferecê-lo. O caminho existe e é curto: editar um
// acordo aprovado o devolve para `pendente` (`carimboAoCriar` em `aprovacao-da-proposta.ts`, usado
// pelo PUT de `/api/guardian/compromissos/[id]`, que não olha a aprovação), e o deep-link
// "?editProposal=" abre o modal de edição sem conferir `editable`.
describe("o envelope vivo de um acordo que perdeu a aprovação", () => {
  it("com envelope, o bloco fica na tela e o botão de cancelar com ele", () => {
    const trecho = componenteDaAssinatura();

    // O `return null` incondicional morreu: agora o bloco só some quando não há NADA a mostrar.
    expect(trecho).not.toContain("if (motivoDoGate) return null;");
    expect(trecho).toContain(
      "const semNadaAMostrar = Boolean(motivoDoGate) && !envelope && !erro;",
    );

    // ⚠️ O QUE SOME É O BOTÃO DE ENVIAR, E SÓ ELE: mandar é o que a régua do Lucas proíbe; cancelar
    // é o conserto de quem já mandou, e é exatamente o caso deste achado.
    const desiste = trecho.indexOf("if (semNadaAMostrar) return null;");
    const cancelar = trecho.indexOf("Cancelar envelope");
    expect(desiste).toBeGreaterThan(-1);
    expect(cancelar).toBeGreaterThan(desiste);
    expect(trecho).toContain("{motivoDoGate ? null : (");

    // E a frase do gate continua escrita ao lado, para o botão ausente não virar mistério.
    expect(trecho).toContain("const porQueNaoEnvia = motivoDoGate ?? impedimento;");
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// ACHADO 4 — A FRASE DA RECUSA É APAGADA ANTES DE APARECER
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// `agir` grava a recusa em `setErro(...)` e, no `finally`, chama `carregar()` — que começa com
// `setErro(null)`. Entre as duas não há `await`, então as duas mudanças de estado caem no MESMO
// lote do React e a tela nunca chega a desenhar a frase. Quem paga é a recusa que o GET não sabe
// recalcular: a do papel, quando o C2X não confirma mais o débito negociado
// (`montarTermoDoAcordoEmPdf` devolve 409 ANTES de qualquer linha nascer). O operador clica em
// "Enviar para assinatura", nada acontece na tela, e o botão continua aceso.
describe("a recusa do servidor na tela do acordo", () => {
  it("o recarregar NÃO apaga a frase que o envio acabou de escrever", () => {
    const trecho = componenteDaAssinatura();

    // ⚠️ ANCORADO EM `agir`, e não no componente inteiro: `carregar` também escreve em `setErro` com
    // a mesma forma, e medir do lugar errado mediria outra coisa.
    const deAgir = trecho.indexOf("async function agir(");
    expect(deAgir).toBeGreaterThan(-1);

    const escreve = trecho.indexOf("setErro(corpo?.error ??", deAgir);
    const recarrega = trecho.indexOf("await carregar();", deAgir);
    expect(escreve).toBeGreaterThan(-1);
    expect(recarrega).toBeGreaterThan(escreve);

    // Continua não havendo espera entre gravar a frase e mandar recarregar: as duas mudanças de
    // estado caem no MESMO lote de render do React, e é por isso que o conserto tinha de ser no
    // outro lado.
    expect(trecho.slice(escreve, recarrega)).not.toContain("await ");

    // ⚠️ O CONSERTO: `carregar` não zera mais o erro. Quem limpa é quem COMEÇA uma ação nova, e
    // `agir` já limpa. Assim a recusa que o GET não sabe recalcular (o papel recusado porque o
    // débito mudou no C2X, que devolve 409 antes de qualquer linha nascer) sobrevive à recarga.
    const carregar = trecho.indexOf("const carregar = useCallback(");
    const fimDoCarregar = trecho.indexOf("}, [item.id]);", carregar);
    expect(carregar).toBeGreaterThan(-1);
    expect(fimDoCarregar).toBeGreaterThan(carregar);
    expect(trecho.slice(carregar, fimDoCarregar)).not.toContain("setErro(null);");

    // E `agir` continua limpando ao começar, que é onde limpar faz sentido.
    const agir = trecho.indexOf("async function agir(");
    expect(trecho.slice(agir, escreve)).toContain("setErro(null);");
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// ACHADO 5 — TRAVESSÃO EM FRASE VISÍVEL
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// Regra da casa (feedback_sem_travessao): texto que o operador lê não usa travessão. A frase das
// chaves da Clicksign vai para a caixa vermelha da tela pelo `error` da rota.
describe("os textos que o operador lê", () => {
  it("DEFEITO: a frase das chaves da Clicksign tem travessão", () => {
    const rota = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "app",
        "api",
        "guardian",
        "termo-de-acordo",
        "assinatura",
        "route.ts",
      ),
      "utf8",
    );
    const frase = rota
      .split("\n")
      .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
      .find((linha) => linha.includes("Sensitive"));

    expect(frase).toBeDefined();
    expect(frase ?? "").not.toContain("—");
  });

  // O resto das frases novas passa limpo: é uma linha só que destoa.
  it("as frases do gate e do envio não usam travessão", () => {
    for (const arquivo of ["envio-gate.ts", "envio-db.ts", "signatarios-do-acordo.ts"]) {
      const fonte = readFileSync(join(__dirname, arquivo), "utf8");
      const visiveis = fonte
        .split("\n")
        .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
        .filter((linha) => /"[^"]*—|`[^`]*—/.test(linha));

      expect(visiveis).toEqual([]);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// ACHADO 6 — EXCLUIR O ACORDO DEIXA O ENVELOPE ÓRFÃO, SEM AVISO
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// O mesmo card tem o botão da lixeira, aceso para QUALQUER acordo, inclusive o que já foi para
// assinatura. A 0179 liga o envelope ao compromisso com `on delete set null`: apagado o acordo, a
// linha de `temis_envelopes` perde a chave e some de todas as leituras (a única tela que lê
// envelope por compromisso é este card). O envelope continua vivo na Clicksign, com gente
// assinando, e ninguém mais o alcança pelo Panteon.
describe("a lixeira do card e o envelope", () => {
  it("a exclusão do acordo pergunta pelo envelope vivo antes de apagar", () => {
    const rotaDoCompromisso = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "app",
        "api",
        "guardian",
        "compromissos",
        "[id]",
        "route.ts",
      ),
      "utf8",
    );

    expect(rotaDoCompromisso).toContain("deleteGuardianCompromisso");

    // ⚠️ A PERGUNTA VEM ANTES DE APAGAR, e ela é a mesma leitura do card (`envelopes-db.ts`), não
    // uma segunda consulta que pudesse discordar dela.
    expect(rotaDoCompromisso).toContain("impedimentoParaExcluirOAcordo");
    const pergunta = rotaDoCompromisso.indexOf("impedimentoParaExcluirOAcordo(admin, id)");
    const apaga = rotaDoCompromisso.indexOf("deleteGuardianCompromisso(client, id)");
    expect(pergunta).toBeGreaterThan(-1);
    expect(apaga).toBeGreaterThan(pergunta);
  });

  it("o aviso da lixeira menciona o termo em assinatura, e a recusa vira frase", () => {
    const daqui = TELA.indexOf("async function handleDelete()");
    const bloco = TELA.slice(daqui, TELA.indexOf("\n  }", daqui));

    expect(bloco).toContain("window.prompt(");
    // Quem vai apagar um acordo já enviado é avisado ANTES de digitar o motivo.
    expect(bloco.toLowerCase()).toContain("assinatura");
    // E a recusa do servidor (409) deixou de ser silêncio: até hoje o botão só voltava ao normal.
    expect(bloco).toContain("window.alert(");
  });
});
