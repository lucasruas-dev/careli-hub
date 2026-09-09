import { describe, expect, it } from "vitest";

import { FalhaDaClicksign, type Opcoes } from "./cliente";
import { enviarParaAssinatura, nomeDoEnvelope } from "./envelope";

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
    expect(signers[1]?.documentation).toBe("99999900453");
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
