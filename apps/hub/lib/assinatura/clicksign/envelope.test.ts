import { describe, expect, it } from "vitest";

import { FalhaDaClicksign, type Opcoes } from "./cliente";
import {
  acrescentarSignatario,
  cancelarEnvelope,
  consultarEnvelope,
  enviarParaAssinatura,
  nomeDoEnvelope,
  notificarSignatario,
  removerSignatario,
} from "./envelope";

import type { Signatario } from "../tipos";

// ⚠️ ESTES TESTES NUNCA TOCAM A CLICKSIGN, E ISSO É A REGRA, NÃO UM DETALHE. A conta configurada é
// de PRODUÇÃO (Lucas, 08/09/2026 — o sandbox deles está com problema): um teste que chamasse a API
// de verdade deixaria um envelope pago e PERMANENTE na conta a cada `vitest run`. Tudo aqui passa
// pelo duplo da porta HTTP.

type Chamada = { caminho: string; corpo: unknown; metodo: string };

/** O duplo: registra o que foi pedido e devolve o que a doc diz que volta. */
function duplo(respostas: Record<string, unknown> = {}) {
  const chamadas: Chamada[] = [];
  let contadorDeSigner = 0;

  const porta = async <T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> => {
    chamadas.push({ caminho, corpo: opcoes.corpo, metodo: opcoes.metodo ?? "GET" });

    for (const [padrao, resposta] of Object.entries(respostas)) {
      if (caminho.includes(padrao) && (opcoes.metodo ?? "GET") !== "DELETE") {
        if (resposta instanceof Error) throw resposta;
        return resposta as T;
      }
    }

    if (caminho === "/envelopes") return { data: { id: "env_1" } } as T;
    if (caminho.endsWith("/documents")) return { data: { id: "doc_1" } } as T;
    if (caminho.endsWith("/signers")) {
      contadorDeSigner += 1;
      return { data: { id: `sig_${contadorDeSigner}` } } as T;
    }
    return {} as T;
  };

  return { chamadas, porta };
}

const pessoa = (nome: string, email: string, papel: Signatario["papel"], ordem: number): Signatario => ({
  cpf: null,
  email,
  nome,
  ordem,
  papel,
});

const pedido = (signatarios: Signatario[]) => ({
  arquivo: { bytes: new Uint8Array([37, 80, 68, 70]), nome: "Contrato - TST - Q01 L05 - Henrique Sales do Vale v1.pdf" },
  identidade: {
    comprador: "Henrique Sales do Vale",
    documentoId: "doc-uuid",
    empreendimento: "TST",
    propostaId: "prop-uuid",
    unidade: "Q01 L05",
  },
  signatarios,
});

describe("o fluxo do envelope", () => {
  it("faz os seis passos da doc, nesta ordem", async () => {
    const { chamadas, porta } = duplo();
    const r = await enviarParaAssinatura(
      pedido([pessoa("Henrique Sales do Vale", "h@x.com", "comprador", 1)]),
      porta,
    );

    expect(r.ok).toBe(true);
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      "POST /envelopes",
      "POST /envelopes/env_1/documents",
      "POST /envelopes/env_1/signers",
      "POST /envelopes/env_1/requirements",
      "POST /envelopes/env_1/requirements",
      "PATCH /envelopes/env_1",
      "POST /envelopes/env_1/notifications",
    ]);
  });

  // ⚠️ ATIVAR NÃO CONVIDA NINGUÉM. Sem o passo de notificação o envelope fica `running` com todo
  // mundo esperando um e-mail que nunca saiu: a tela diz "enviado", a Clicksign diz "aguardando", e
  // o comprador não recebeu nada.
  it("notifica depois de ativar", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(pedido([pessoa("A Silva", "a@x.com", "comprador", 1)]), porta);
    const ativar = chamadas.findIndex((c) => c.metodo === "PATCH");
    const notificar = chamadas.findIndex((c) => c.caminho.endsWith("/notifications"));
    expect(ativar).toBeGreaterThan(-1);
    expect(notificar).toBeGreaterThan(ativar);
  });

  // ⚠️ A v1 PEDIA DATA-URI E A v3 NÃO. Mandar `data:application/pdf;base64,` faz o arquivo chegar
  // corrompido — dentro de um envelope que a API aceitou.
  it("sobe o PDF como data-URI, com o prefixo que a v3 exige", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(pedido([pessoa("A Silva", "a@x.com", "comprador", 1)]), porta);

    const upload = chamadas.find((c) => c.caminho.endsWith("/documents"));
    // Tipado com as chaves que o teste checa, e não como `Record<string, string>`: sob
    // `noUncheckedIndexedAccess` o Record devolve `string | undefined` e o `.startsWith`
    // não compila. Nomear os campos também documenta o que a v3 espera no upload.
    const attrs = (
      upload?.corpo as { data: { attributes: { content_base64: string; filename: string } } }
    ).data.attributes;
    // ⚠️ Este teste já afirmou o CONTRÁRIO (que ia cru). A doc oficial da v3 mostra o data-URI
    // nos dois lugares onde há exemplo de requisição, e errar aqui quebra o passo 2 — quando o
    // envelope do passo 1 já existe e já custou.
    expect(attrs.content_base64).toBe("data:application/pdf;base64,JVBERg==");
    expect(attrs.content_base64.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(attrs.filename.endsWith(".pdf")).toBe(true);
  });

  // ⚠️ SÓ O DOCUMENTO TEM `metadata` NA v3, e ele volta no webhook: é o elo entre o evento que chega
  // de fora e a proposta.
  it("manda a identidade no metadata do documento, e marca o teste", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(pedido([pessoa("A Silva", "a@x.com", "comprador", 1)]), porta);

    const upload = chamadas.find((c) => c.caminho.endsWith("/documents"));
    const meta = (upload?.corpo as { data: { attributes: { metadata: Record<string, string> } } })
      .data.attributes.metadata;
    expect(meta).toMatchObject({
      documento_id: "doc-uuid",
      empreendimento: "TST",
      proposta_id: "prop-uuid",
      teste: "true",
      unidade: "Q01 L05",
    });
  });

  // ⚠️ O metadata VOLTA NO CORPO DE TODO EVENTO, e log de webhook é legível por quem tem acesso ao
  // projeto. CPF não entra ali.
  it("não põe CPF no metadata", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(
      pedido([{ ...pessoa("A Silva", "a@x.com", "comprador", 1), cpf: "999.999.004-53" }]),
      porta,
    );
    const upload = chamadas.find((c) => c.caminho.endsWith("/documents"));
    expect(JSON.stringify(upload?.corpo)).not.toContain("99999900453");
  });
});

describe("a ordem vira `group`", () => {
  // ⚠️ O `group` DA CLICKSIGN COMEÇA EM 1 (default deles). Nossa `ordenarSignatarios` devolve 0
  // quando ninguém espera ninguém; mandar 0 seria um valor que a doc não prevê.
  it("manda todo mundo no grupo 1 quando a ordem está desligada (ordem 0)", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(
      pedido([
        pessoa("A Silva", "a@x.com", "comprador", 0),
        pessoa("B Souza", "b@x.com", "vendedora", 0),
      ]),
      porta,
    );

    const grupos = chamadas
      .filter((c) => c.caminho.endsWith("/signers"))
      .map((c) => (c.corpo as { data: { attributes: { group: number } } }).data.attributes.group);
    expect(grupos).toEqual([1, 1]);
  });

  it("repassa a fila quando a ordem está ligada", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(
      pedido([
        pessoa("A Silva", "a@x.com", "comprador", 1),
        pessoa("C Lima", "c@x.com", "conjuge", 2),
        pessoa("B Souza", "b@x.com", "vendedora", 3),
      ]),
      porta,
    );

    const grupos = chamadas
      .filter((c) => c.caminho.endsWith("/signers"))
      .map((c) => (c.corpo as { data: { attributes: { group: number } } }).data.attributes.group);
    expect(grupos).toEqual([1, 2, 3]);
  });

  // ⚠️ COM A BANDEIRA LIGADA (o default deles) A CLICKSIGN PEDE CPF NA HORA DE ASSINAR. Um comprador
  // sem CPF no cadastro ficaria travado na tela do provedor, sem ter o que digitar.
  it("desliga `has_documentation` quando não há CPF, e liga quando há", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(
      pedido([
        pessoa("A Silva", "a@x.com", "comprador", 1),
        { ...pessoa("B Souza", "b@x.com", "conjuge", 1), cpf: "999.999.004-53" },
      ]),
      porta,
    );

    const signers = chamadas
      .filter((c) => c.caminho.endsWith("/signers"))
      .map((c) => (c.corpo as { data: { attributes: Record<string, unknown> } }).data.attributes);
    expect(signers[0]?.has_documentation).toBe(false);
    expect(signers[0]?.documentation).toBeUndefined();
    expect(signers[1]?.has_documentation).toBe(true);
    // ⚠️ COM MÁSCARA. Este teste já afirmou `"99999900453"` — e foi exatamente isso que derrubou o
    // PRIMEIRO ENVIO REAL: 400 com `/data/attributes/documentation não está em um formato válido`.
    // A doc do endpoint pede *"o CPF do signatário formatado (ex: 000.000.000-00)"*.
    expect(signers[1]?.documentation).toBe("999.999.004-53");
  });

  // ⚠️ A CLICKSIGN VALIDA O CPF CONTRA A RECEITA. O do ZZ TESTE é fictício: passa no dígito
  // verificador e mesmo assim volta 422 `documentation - inválido`. Sem esta saída, o teste não
  // andaria — e, pior, um cliente real com CPF suspenso na Receita travaria do mesmo jeito.
  it("com `semCpf`, não manda documentação nenhuma", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(
      {
        ...pedido([{ ...pessoa("A Silva", "a@x.com", "comprador", 1), cpf: "999.999.004-53" }]),
        semCpf: true,
      },
      porta,
    );

    const attrs = (
      chamadas.find((c) => c.caminho.endsWith("/signers"))?.corpo as {
        data: { attributes: Record<string, unknown> };
      }
    ).data.attributes;
    expect(attrs.has_documentation).toBe(false);
    expect(attrs.documentation).toBeUndefined();
    // O resto do signatário continua inteiro: sem CPF não quer dizer sem identificação.
    expect(attrs.email).toBe("a@x.com");
    expect(attrs.name).toBe("A Silva");
  });

  // ⚠️ O CPF CHEGA DO CADASTRO DE DOIS JEITOS — com máscara e sem —, e a Clicksign só aceita um.
  // Se o formato dependesse de como alguém digitou na ficha, o envio quebraria para uns clientes e
  // não para outros, o que é o tipo de defeito que demora a aparecer.
  it("normaliza o CPF: entre como entrar, sai formatado", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(
      pedido([{ ...pessoa("C Lima", "c@x.com", "comprador", 1), cpf: "99999900453" }]),
      porta,
    );

    const attrs = (
      chamadas.find((c) => c.caminho.endsWith("/signers"))?.corpo as {
        data: { attributes: Record<string, unknown> };
      }
    ).data.attributes;
    expect(attrs.documentation).toBe("999.999.004-53");
  });

  // ⚠️ O CAMPO É O CPF DE UMA PESSOA. Um CNPJ (14 dígitos) ali faz o cadastro do signatário ser
  // recusado — no meio do fluxo, com o envelope já criado.
  it("não manda CNPJ como documentação", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(
      pedido([{ ...pessoa("Empresa Ltda", "e@x.com", "comprador", 1), cpf: "12.345.678/0001-90" }]),
      porta,
    );
    const attrs = (
      chamadas.find((c) => c.caminho.endsWith("/signers"))?.corpo as {
        data: { attributes: Record<string, unknown> };
      }
    ).data.attributes;
    expect(attrs.has_documentation).toBe(false);
    expect(attrs.documentation).toBeUndefined();
  });
});

describe("o envelope, por dentro", () => {
  it("pede o cancelamento no vencimento parcial, e bloqueia depois da recusa", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(pedido([pessoa("A Silva", "a@x.com", "comprador", 1)]), porta);

    const attrs = (chamadas[0]?.corpo as { data: { attributes: Record<string, unknown> } }).data
      .attributes;
    // ⚠️ `closed` COM ASSINATURA PARCIAL É UM CONTRATO COM CARA DE CONCLUÍDO E SEM VALOR NENHUM.
    expect(attrs.deadline_partial_signature_action).toBe("canceled");
    expect(attrs.block_after_refusal).toBe(true);
    expect(attrs.locale).toBe("pt-BR");
  });

  // ⚠️ TETO RÍGIDO DE 90 DIAS, contados do upload. Um número maior vira 422 no meio do fluxo — com o
  // envelope já criado.
  it("apara o prazo em 90 dias", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(
      { ...pedido([pessoa("A Silva", "a@x.com", "comprador", 1)]), prazoEmDias: 365 },
      porta,
    );

    const attrs = (chamadas[0]?.corpo as { data: { attributes: { deadline_at: string } } }).data
      .attributes;
    const dias = (new Date(attrs.deadline_at).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(89);
    expect(dias).toBeLessThan(91);
  });

  it("cria os dois requisitos por pessoa: assinar e autenticar por e-mail", async () => {
    const { chamadas, porta } = duplo();
    await enviarParaAssinatura(pedido([pessoa("A Silva", "a@x.com", "comprador", 1)]), porta);

    const requisitos = chamadas
      .filter((c) => c.caminho.endsWith("/requirements"))
      .map((c) => (c.corpo as { data: { attributes: Record<string, string> } }).data.attributes);
    expect(requisitos).toEqual([
      { action: "agree", role: "sign" },
      { action: "provide_evidence", auth: "email" },
    ]);
  });
});

describe("quando dá errado", () => {
  // ⚠️ A JANELA DE DESFAZER VAI ATÉ O `running`. Rascunho apaga; ativado, não — e ele cobra.
  it("apaga o rascunho quando falha antes de ativar", async () => {
    const { chamadas, porta } = duplo({
      "/signers": new FalhaDaClicksign("Clicksign devolveu 422.", {
        detalhes: ["/data/attributes/email já existe"],
        requestId: "req-1",
        status: 422,
      }),
    });

    const r = await enviarParaAssinatura(pedido([pessoa("A Silva", "a@x.com", "comprador", 1)]), porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.passo).toBe("signatarios");
    expect(r.rascunhoApagado).toBe(true);
    expect(r.requestId).toBe("req-1");
    expect(chamadas.some((c) => c.metodo === "DELETE" && c.caminho === "/envelopes/env_1")).toBe(true);
    // E nunca chegou a ativar.
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
  });

  // ⚠️ DEPOIS DE ATIVADO NÃO SE DESFAZ NADA, e mentir sobre isso é pior do que a falha: quem lê
  // "nada ficou pendente" tentaria de novo e criaria o SEGUNDO envelope do mesmo contrato.
  it("não tenta apagar depois de ativado", async () => {
    const { chamadas, porta } = duplo({
      "/notifications": new FalhaDaClicksign("Clicksign devolveu 500.", {
        detalhes: [],
        requestId: null,
        status: 500,
      }),
    });

    const r = await enviarParaAssinatura(pedido([pessoa("A Silva", "a@x.com", "comprador", 1)]), porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.passo).toBe("notificar");
    expect(r.rascunhoApagado).toBe(false);
    expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
  });

  it("leva os detalhes do JSON:API na mensagem — é o que diz QUAL campo falhou", async () => {
    const { porta } = duplo({
      "/documents": new FalhaDaClicksign("Clicksign devolveu 415.", {
        detalhes: ["/data/attributes/content_base64 inválido"],
        requestId: null,
        status: 415,
      }),
    });
    const r = await enviarParaAssinatura(pedido([pessoa("A Silva", "a@x.com", "comprador", 1)]), porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("content_base64");
  });
});

describe("o nome do envelope", () => {
  // ⚠️ O PRIMEIRO USO É O ZZ TESTE **EM PRODUÇÃO**: o envelope convive com contrato de verdade na
  // mesma conta e, depois de ativado, não se apaga.
  it("marca [TESTE] quando o empreendimento é o de teste", () => {
    expect(
      nomeDoEnvelope({ comprador: "Henrique Sales do Vale", empreendimento: "TST", unidade: "Q01 L05" }),
    ).toBe("[TESTE] Contrato - TST - Q01 L05 - Henrique Sales do Vale");
  });

  it("reconhece o nome do empreendimento de teste, e não só o código", () => {
    expect(
      nomeDoEnvelope({
        comprador: "Henrique Sales do Vale",
        empreendimento: "ZZ TESTE - nao e empreendimento real",
        unidade: "Q01 L05",
      }).startsWith("[TESTE]"),
    ).toBe(true);
  });

  it("não marca o contrato de verdade", () => {
    expect(
      nomeDoEnvelope({ comprador: "Maria Souza", empreendimento: "JDG", unidade: "Q07 L12" }),
    ).toBe("Contrato - JDG - Q07 L12 - Maria Souza");
  });
});

// ⚠️ CANCELAR É O QUE TIRA O CONTRATO VELHO DA MÃO DE QUEM IA ASSINAR, e é o passo de que o retorno
// para correção depende (`lib/temis/retorno-para-correcao.ts`): se ele não acontecer, o card NÃO
// volta — em nenhuma das três etapas que voltam, Contrato, Em assinatura e Pré-faturamento. Por isso
// o que se testa aqui é a forma exata do pedido e o desfecho da falha — não a "mensagem bonita".
describe("o cancelamento do envelope", () => {
  it("faz um PATCH no envelope com status canceled", async () => {
    const { chamadas, porta } = duplo();
    const r = await cancelarEnvelope("env-7", porta);

    expect(r.ok).toBe(true);
    expect(chamadas).toEqual([
      {
        caminho: "/envelopes/env-7",
        // O mesmo formato do passo que ATIVA: JSON:API, com `id` e `type` no corpo. Ver a ressalva
        // escrita em `cancelarEnvelope` — a forma é inferida do passo 5, não lida na doc.
        corpo: { data: { attributes: { status: "canceled" }, id: "env-7", type: "envelopes" } },
        metodo: "PATCH",
      },
    ]);
  });

  // ⚠️ `PATCH /envelopes/` (id vazio) bate em OUTRA rota da API, e um 200 dali seria lido como
  // "cancelado" — a mentira mais cara possível neste lugar, porque solta o card com o envelope vivo.
  it("não chama a Clicksign sem id", async () => {
    const { chamadas, porta } = duplo();
    const r = await cancelarEnvelope("   ", porta);

    expect(r.ok).toBe(false);
    expect(chamadas).toEqual([]);
  });

  it("devolve a falha com os detalhes e o request id, e não lança", async () => {
    const { porta } = duplo({
      "/envelopes/env-8": new FalhaDaClicksign("Clicksign devolveu 422.", {
        detalhes: ["/data/attributes/status não permite a transição"],
        requestId: "req-9",
        status: 422,
      }),
    });

    const r = await cancelarEnvelope("env-8", porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("não permite a transição");
    expect(r.requestId).toBe("req-9");
  });

  // ⚠️ A API RECUSAR É UMA CERTEZA: ela respondeu, e o envelope continua vivo. Quem lê pode afirmar
  // que as pessoas seguem com o contrato na mão.
  it("recusa da API não é duvidosa: o envelope continua vivo", async () => {
    const { porta } = duplo({
      "/envelopes/env-8": new FalhaDaClicksign("Clicksign devolveu 422.", {
        detalhes: [],
        requestId: null,
        status: 422,
      }),
    });

    const r = await cancelarEnvelope("env-8", porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.duvidoso).toBe(false);
  });

  // ⚠️ TIMEOUT NÃO É RECUSA, e este é o caso que fazia a frase AFIRMAR o que o código não sabe.
  // `chamar` aborta em 15s e lança com `status: 0` — o PATCH pode ter chegado e o envelope já estar
  // morto do outro lado. É a mesma distinção que `carimbarFalha` faz no passo `ativar` do envio.
  it("timeout e falha de rede são duvidosos: pode ter chegado", async () => {
    for (const mensagem of ["Clicksign não respondeu em 15s.", "Falha de rede ao chamar a Clicksign."]) {
      const { porta } = duplo({
        "/envelopes/env-8": new FalhaDaClicksign(mensagem, {
          detalhes: [],
          requestId: null,
          status: 0,
        }),
      });

      const r = await cancelarEnvelope("env-8", porta);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.duvidoso).toBe(true);
    }
  });

  // Sem id nada foi chamado: não há dúvida nenhuma sobre ter chegado.
  it("sem id, a falha não é duvidosa", async () => {
    const { porta } = duplo();
    const r = await cancelarEnvelope("", porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.duvidoso).toBe(false);
  });
});

// ⚠️ ESTA LEITURA EXISTE PORQUE O NOSSO BANCO ATRASA. `temis_envelopes.estado` só é escrito pelo
// webhook, e quem decide se pode cancelar precisa do estado de AGORA — o caso medido no desenho é o
// quarto signatário assinando às 14:00:00 e o clique em voltar às 14:00:01, com a tela carregada às
// 13:58. Ver `lib/temis/retorno-para-correcao.ts`.
describe("a leitura do estado real do envelope", () => {
  it("faz um GET no envelope e devolve o status cru", async () => {
    const { chamadas, porta } = duplo({
      "/envelopes/env-10": { data: { attributes: { status: "running" } } },
    });

    const r = await consultarEnvelope("env-10", porta);
    expect(chamadas).toEqual([{ caminho: "/envelopes/env-10", corpo: undefined, metodo: "GET" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("running");
    expect(r.estado).toBe("aguardando");
  });

  // ⚠️ `closed` NÃO VIRA `assinado`, e é a armadilha mais séria da Clicksign para nós: o
  // `deadline_partial_signature_action` pode fechar o envelope no vencimento COM AS ASSINATURAS QUE
  // TIVER. Sem saber se todos assinaram, `estadoDaClicksign` devolve `desconhecido` — e quem chama
  // recusa a volta em vez de cancelar ou de mandar abrir distrato.
  it("closed volta como desconhecido, e não como assinado", async () => {
    const { porta } = duplo({ "/envelopes/env-11": { data: { attributes: { status: "closed" } } } });
    const r = await consultarEnvelope("env-11", porta);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("closed");
    expect(r.estado).toBe("desconhecido");
  });

  it("canceled volta como cancelado", async () => {
    const { porta } = duplo({ "/envelopes/env-12": { data: { attributes: { status: "canceled" } } } });
    const r = await consultarEnvelope("env-12", porta);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.estado).toBe("cancelado");
  });

  // ⚠️ A FORMA DA RESPOSTA É INFERÊNCIA — ver a ressalva escrita em `consultarEnvelope`. O webhook
  // real chegou com o status ao lado do id (`document: { key, path, status }`), e não dentro de
  // `attributes`; por isso o mesmo campo é lido nos dois níveis.
  it("lê o status também um nível acima, em data.status", async () => {
    const { porta } = duplo({ "/envelopes/env-13": { data: { status: "running" } } });
    const r = await consultarEnvelope("env-13", porta);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe("running");
  });

  // ⚠️ RESPOSTA SEM STATUS É FALHA, E NÃO "DESCONHECIDO". Quem chama RECUSA a volta na falha; tratar
  // a forma inesperada como leitura boa misturaria "não sei traduzir" com "não consegui perguntar".
  it("resposta sem status vira falha, para a volta ser recusada", async () => {
    const { porta } = duplo({ "/envelopes/env-14": { data: { attributes: {} } } });
    const r = await consultarEnvelope("env-14", porta);
    expect(r.ok).toBe(false);
  });

  // ⚠️ `GET /envelopes/` (id vazio) é a LISTAGEM da conta, que responde 200 com a página inteira —
  // ler um status dali seria afirmar sobre um envelope que não é este.
  it("não chama a Clicksign sem id", async () => {
    const { chamadas, porta } = duplo();
    const r = await consultarEnvelope("   ", porta);
    expect(r.ok).toBe(false);
    expect(chamadas).toEqual([]);
  });

  it("devolve a falha com o request id, e não lança", async () => {
    const { porta } = duplo({
      "/envelopes/env-15": new FalhaDaClicksign("Clicksign devolveu 404.", {
        detalhes: ["envelope não encontrado"],
        requestId: "req-15",
        status: 404,
      }),
    });

    const r = await consultarEnvelope("env-15", porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("não encontrado");
    expect(r.requestId).toBe("req-15");
  });
});

// ── A TROCA DE SIGNATÁRIO E O REENVIO DO CONVITE ────────────────────────────
//
// ⚠️ O CASO QUE ESTAS TRÊS FUNÇÕES CONSERTAM FOI MEDIDO EM PRODUÇÃO (12/09/2026): o convite do
// segundo signatário voltou com HardBounce porque o e-mail tinha uma letra a menos. A compradora
// assinou, o cônjuge nunca recebeu nada.

/**
 * O duplo que deixa o DELETE falhar.
 *
 * ⚠️ O `duplo` LÁ DE CIMA IGNORA AS RESPOSTAS CONFIGURADAS NO DELETE, DE PROPÓSITO: é o que permite
 * ao `desfazer` do envio apagar o rascunho mesmo nos testes que fazem a chamada anterior falhar.
 * Aqui o DELETE é justamente o que está sendo testado — e o 403 dele é a trava principal da troca.
 */
function duploComDelete(respostas: Record<string, unknown> = {}) {
  const chamadas: Chamada[] = [];

  const porta = async <T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> => {
    chamadas.push({ caminho, corpo: opcoes.corpo, metodo: opcoes.metodo ?? "GET" });

    for (const [padrao, resposta] of Object.entries(respostas)) {
      if (caminho.includes(padrao)) {
        if (resposta instanceof Error) throw resposta;
        return resposta as T;
      }
    }

    if (caminho.endsWith("/signers")) return { data: { id: "sig_novo" } } as T;
    return {} as T;
  };

  return { chamadas, porta };
}

const falha = (mensagem: string, status: number, requestId: null | string = null) =>
  new FalhaDaClicksign(mensagem, { detalhes: [], requestId, status });

describe("remover um signatário do envelope", () => {
  it("chama o DELETE do signatário, e não o do envelope", async () => {
    const { chamadas, porta } = duploComDelete();
    const r = await removerSignatario("env-20", "sig-1", porta);

    expect(r.ok).toBe(true);
    expect(chamadas).toEqual([
      { caminho: "/envelopes/env-20/signers/sig-1", corpo: undefined, metodo: "DELETE" },
    ]);
  });

  // ⚠️ A TRAVA PRINCIPAL É DELES, E CHEGA COMO 403: *"Já assinou um documento. Não pode ser
  // excluído"*. Ela precisa chegar DISTINGUÍVEL a quem chama — virar "falhou" genérico faria a tela
  // mandar tentar de novo uma operação que a API vai recusar para sempre.
  it("403 volta como jaAssinou, e não como falha genérica", async () => {
    const { porta } = duploComDelete({
      "/signers/sig-1": falha("Clicksign devolveu 403.", 403, "req-403"),
    });

    const r = await removerSignatario("env-20", "sig-1", porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.jaAssinou).toBe(true);
    expect(r.naoEncontrado).toBe(false);
    expect(r.requestId).toBe("req-403");
  });

  it("404 volta como naoEncontrado", async () => {
    const { porta } = duploComDelete({ "/signers/sig-1": falha("Clicksign devolveu 404.", 404) });

    const r = await removerSignatario("env-20", "sig-1", porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.jaAssinou).toBe(false);
    expect(r.naoEncontrado).toBe(true);
  });

  it("503 não é nem uma coisa nem outra, e não lança", async () => {
    const { porta } = duploComDelete({ "/signers/sig-1": falha("Clicksign devolveu 503.", 503) });

    const r = await removerSignatario("env-20", "sig-1", porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.jaAssinou).toBe(false);
    expect(r.naoEncontrado).toBe(false);
    expect(r.status).toBe(503);
  });

  // ⚠️ `DELETE /envelopes/{id}/signers/` (signer vazio) bate na COLEÇÃO, não na pessoa: uma resposta
  // boa dali seria lida como "removido", e o passo seguinte recriaria quem nunca saiu.
  it("não chama a Clicksign sem os dois ids", async () => {
    const { chamadas, porta } = duploComDelete();
    expect((await removerSignatario("", "sig-1", porta)).ok).toBe(false);
    expect((await removerSignatario("env-20", "  ", porta)).ok).toBe(false);
    expect(chamadas).toEqual([]);
  });
});

describe("reenviar o convite de UM signatário", () => {
  // ⚠️ NÃO É O `/envelopes/{id}/notifications` DO PASSO 6: aquele avisa TODO MUNDO, e num envelope
  // em que a compradora já assinou isso põe na caixa dela o convite de um contrato que ela já
  // assinou. Lucas, 12/09/2026: *"enviar o contrato dele somente"*.
  it("posta no endpoint do signatário, e não no do envelope", async () => {
    const { chamadas, porta } = duploComDelete();
    const r = await notificarSignatario("env-21", "sig-2", undefined, porta);

    expect(r.ok).toBe(true);
    expect(chamadas).toEqual([
      {
        caminho: "/envelopes/env-21/signers/sig-2/notifications",
        corpo: { data: { attributes: {}, type: "notifications" } },
        metodo: "POST",
      },
    ]);
  });

  // Sem mensagem a Clicksign usa a dela — a mesma que o convite original levou. Mandar o campo
  // vazio seria trocar o texto conhecido por um branco.
  it("só manda `message` quando há mensagem de verdade", async () => {
    const { chamadas, porta } = duploComDelete();
    await notificarSignatario("env-21", "sig-2", "   ", porta);
    await notificarSignatario("env-21", "sig-2", " Segue o contrato ", porta);

    expect(chamadas[0]?.corpo).toEqual({ data: { attributes: {}, type: "notifications" } });
    expect(chamadas[1]?.corpo).toEqual({
      data: { attributes: { message: "Segue o contrato" }, type: "notifications" },
    });
  });

  // ⚠️ "ESPERE UM MINUTO" NÃO É "DEU ERRO". A doc indica cerca de uma notificação por minuto por
  // endpoint, e este é o botão que alguém clica duas vezes quando o cliente diz que não recebeu.
  it("429 volta como limiteDeEnvio", async () => {
    const { porta } = duploComDelete({
      "/notifications": falha("Clicksign devolveu 429.", 429),
    });

    const r = await notificarSignatario("env-21", "sig-2", undefined, porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.limiteDeEnvio).toBe(true);
  });

  it("outra falha não vira limite de envio, e não lança", async () => {
    const { porta } = duploComDelete({ "/notifications": falha("Clicksign devolveu 500.", 500) });

    const r = await notificarSignatario("env-21", "sig-2", undefined, porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.limiteDeEnvio).toBe(false);
    expect(r.status).toBe(500);
  });

  it("não chama a Clicksign sem os dois ids", async () => {
    const { chamadas, porta } = duploComDelete();
    expect((await notificarSignatario("", "sig-2", undefined, porta)).ok).toBe(false);
    expect(chamadas).toEqual([]);
  });
});

describe("acrescentar um signatário a um envelope que já roda", () => {
  const novo = pessoa("Maria Souza Lima", "maria@x.com", "conjuge", 1);

  // ⚠️ O PASSO DOS REQUISITOS É O QUE FALHA CALADO. Signatário sem os dois requisitos recebe o
  // convite, abre o documento e NÃO TEM O QUE ASSINAR — e o envelope nunca fecha, sem erro nenhum.
  it("faz o passo 3 e o passo 4 — os DOIS requisitos —, nesta ordem", async () => {
    const { chamadas, porta } = duploComDelete();
    const r = await acrescentarSignatario("env-22", { documentoId: "doc-9", pessoa: novo }, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signerId).toBe("sig_novo");
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      "POST /envelopes/env-22/signers",
      "POST /envelopes/env-22/requirements",
      "POST /envelopes/env-22/requirements",
    ]);
  });

  it("os requisitos apontam para o documento e para o signatário novo", async () => {
    const { chamadas, porta } = duploComDelete();
    await acrescentarSignatario("env-22", { documentoId: "doc-9", pessoa: novo }, porta);

    const requisitos = chamadas.filter((c) => c.caminho.endsWith("/requirements"));
    for (const requisito of requisitos) {
      expect(requisito.corpo).toMatchObject({
        data: {
          relationships: {
            document: { data: { id: "doc-9", type: "documents" } },
            signer: { data: { id: "sig_novo", type: "signers" } },
          },
        },
      });
    }
    expect(requisitos.map((c) => (c.corpo as { data: { attributes: unknown } }).data.attributes)).toEqual([
      { action: "agree", role: "sign" },
      { action: "provide_evidence", auth: "email" },
    ]);
  });

  // Os dois desfechos são muito diferentes: no `signatario` ninguém entrou, no `requisitos` a pessoa
  // entrou sem ter o que assinar. Quem chama precisa distinguir para dizer isso em português.
  it("falha no cadastro volta com passo `signatario` e sem id", async () => {
    const { porta } = duploComDelete({ "/signers": falha("Clicksign devolveu 422.", 422) });
    const r = await acrescentarSignatario("env-22", { documentoId: "doc-9", pessoa: novo }, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.passo).toBe("signatario");
    expect(r.signerId).toBeNull();
  });

  it("falha nos requisitos volta com passo `requisitos` E o id de quem ficou pela metade", async () => {
    const { porta } = duploComDelete({ "/requirements": falha("Clicksign devolveu 500.", 500) });
    const r = await acrescentarSignatario("env-22", { documentoId: "doc-9", pessoa: novo }, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.passo).toBe("requisitos");
    expect(r.signerId).toBe("sig_novo");
  });

  // Sem o id do documento o requisito não tem para onde apontar: criar o signatário primeiro
  // deixaria exatamente a pessoa pendurada que esta função existe para evitar.
  it("não chama nada sem o id do documento", async () => {
    const { chamadas, porta } = duploComDelete();
    const r = await acrescentarSignatario("env-22", { documentoId: "  ", pessoa: novo }, porta);

    expect(r.ok).toBe(false);
    expect(chamadas).toEqual([]);
  });
});
