import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { FalhaDaClicksign, type Opcoes } from "@/lib/assinatura/clicksign/cliente";

import {
  conferirEmailDaTroca,
  fraseDaFalhaDepoisDeRemover,
  lerSignatariosCongelados,
  RECUSA_DE_QUEM_JA_ASSINOU,
  type SignatarioCongelado,
  trocarEmailDoSignatario,
} from "./trocar-signatario";

// ⚠️ O QUE ESTES TESTES PROTEGEM É UM ENVELOPE VIVO DA CONTA DE PRODUÇÃO. A troca de e-mail REMOVE
// um signatário, e removido ele não volta: toda conferência que falha DEPOIS da remoção deixa uma
// pessoa fora do contrato. Por isso a maior parte daqui prova o que acontece ANTES da primeira
// chamada — e prova que, quando algo dá errado depois, a frase diz exatamente onde parou.
//
// ⚠️ E NADA AQUI TOCA A CLICKSIGN. A porta HTTP é um duplo, como em `clicksign/envelope.test.ts`:
// um teste que chamasse a API de verdade mexeria num contrato de alguém.

const pessoa = (patch: Partial<SignatarioCongelado> = {}): SignatarioCongelado => ({
  chave: null,
  email: "titular@x.com",
  nome: "Henrique Sales do Vale",
  ordem: 1,
  papel: "comprador",
  ...patch,
});

const titular = pessoa({ chave: "sig-titular" });
const conjuge = pessoa({
  chave: "sig-conjuge",
  email: "conjug@x.com",
  nome: "Maria Souza Lima",
  papel: "conjuge",
});

describe("a lista congelada do envio", () => {
  it("lê nome, e-mail, ordem e papel, e a chave quando já houve troca", () => {
    const lida = lerSignatariosCongelados([
      { chave: "sig-1", email: "a@x.com", nome: "Ana Paula Dias", ordem: 2, papel: "conjuge" },
    ]);
    expect(lida).toEqual([
      { chave: "sig-1", email: "a@x.com", nome: "Ana Paula Dias", ordem: 2, papel: "conjuge" },
    ]);
  });

  // ⚠️ PAPEL DESCONHECIDO NÃO SOME COM A PESSOA. O papel aqui só vira rótulo dentro da frase de
  // recusa; descartar a linha tiraria da conferência justamente um endereço que pode ser o
  // duplicado que ela existe para pegar.
  it("papel que não conhecemos vira comprador, e a pessoa fica na lista", () => {
    const lida = lerSignatariosCongelados([{ email: "a@x.com", nome: "Ana Dias", papel: "sindico" }]);
    expect(lida).toHaveLength(1);
    expect(lida[0]?.papel).toBe("comprador");
    // Sem `ordem` gravada, o grupo 1 — que é o paralelo, o padrão do envio.
    expect(lida[0]?.ordem).toBe(1);
  });

  it("lixo no jsonb não vira signatário", () => {
    expect(lerSignatariosCongelados(null)).toEqual([]);
    expect(lerSignatariosCongelados("nada")).toEqual([]);
    expect(lerSignatariosCongelados([null, 7, {}, []])).toEqual([]);
  });
});

// ⚠️ TODA ESTA CONFERÊNCIA ACONTECE ANTES DA REMOÇÃO. Descobrir o endereço inválido depois de tirar
// alguém do envelope seria o pior desfecho possível: a pessoa fica fora do contrato e o e-mail novo
// continua sem servir.
describe("o que se confere antes de mexer no envelope", () => {
  it("e-mail que não é e-mail é recusado, e a frase diz que nada foi mexido", () => {
    for (const bruto of ["", "   ", "maria", "maria@", "maria@empresa", "maria empresa@x.com"]) {
      const r = conferirEmailDaTroca({ atual: conjuge, emailNovo: bruto, todos: [titular, conjuge] });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.status).toBe(400);
      expect(r.erro).toContain("nada foi mexido");
    }
  });

  // ⚠️ IGUAL AO ATUAL É RECUSA, E NÃO "NADA A FAZER": não há o que trocar, e o clique custaria a
  // remoção de um signatário vivo por nada — quem já abriu o convite perderia o link. A frase manda
  // para o botão certo, o de reenviar.
  it("e-mail igual ao atual é recusado, e a frase manda reenviar o convite", () => {
    for (const igual of ["conjug@x.com", "  CONJUG@X.com "]) {
      const r = conferirEmailDaTroca({ atual: conjuge, emailNovo: igual, todos: [titular, conjuge] });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.status).toBe(400);
      expect(r.erro).toContain("reenviar o convite");
    }
  });

  // ⚠️ DOIS SIGNATÁRIOS COM O MESMO ENDEREÇO QUEBRAM A CLICKSIGN — é a armadilha do cônjuge que usa
  // a caixa do titular, catalogada desde o D4Sign. A conferência é a MESMA do envio
  // (`conferirSignatarios`), para a troca não aceitar o que o envio recusa.
  it("e-mail que já é de outro signatário é recusado, com os dois nomes na frase", () => {
    const r = conferirEmailDaTroca({
      atual: conjuge,
      emailNovo: "TITULAR@x.com",
      todos: [titular, conjuge],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("Henrique Sales do Vale");
    expect(r.erro).toContain("Maria Souza Lima");
    expect(r.erro).toContain("Nada foi mexido");
  });

  it("e-mail novo e válido passa, já aparado", () => {
    const r = conferirEmailDaTroca({
      atual: conjuge,
      emailNovo: "  maria.souza@empresa.com.br ",
      todos: [titular, conjuge],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.email).toBe("maria.souza@empresa.com.br");
  });
});

// ⚠️ ESTA FRASE É O CONSERTO DO DESFECHO PIOR. Depois da remoção o signatário antigo não volta:
// "falha ao trocar o e-mail" faria o operador achar que nada aconteceu, e o contrato ficaria parado
// sem ninguém entender por quê.
describe("a frase de quando falha DEPOIS da remoção", () => {
  it("falha no cadastro: diz que a pessoa está fora e que tentar de novo refaz", () => {
    const frase = fraseDaFalhaDepoisDeRemover({
      desfeito: false,
      detalhe: "Clicksign devolveu 422.",
      envelopeId: "env-30",
      nome: "Maria Souza Lima",
      passo: "signatario",
    });

    expect(frase).toContain("JÁ FOI REMOVIDO");
    expect(frase).toContain("Maria Souza Lima");
    expect(frase).toContain("env-30");
    expect(frase).toContain("Clicksign devolveu 422.");
    expect(frase).toContain("Tente a troca de novo");
  });

  it("falha nos requisitos e o cadastro foi desfeito: manda tentar de novo", () => {
    const frase = fraseDaFalhaDepoisDeRemover({
      desfeito: true,
      detalhe: "Clicksign devolveu 500.",
      envelopeId: "env-30",
      nome: "Maria Souza Lima",
      passo: "requisitos",
    });

    expect(frase).toContain("NÃO TEM O QUE ASSINAR");
    expect(frase).toContain("DESFEITO");
    expect(frase).toContain("Tente a troca de novo");
    expect(frase).toContain("env-30");
  });

  // ⚠️ QUANDO NEM O DESFAZER FUNCIONA, A FRASE NÃO PODE MANDAR TENTAR DE NOVO. Sobrou uma linha
  // pendurada no envelope, sem requisito, e a retentativa não a alcança: o único caminho é mão
  // humana no painel da Clicksign, e a frase tem de dizer isso com todas as letras.
  it("falha nos requisitos E no desfazer: manda remover à mão na Clicksign", () => {
    const frase = fraseDaFalhaDepoisDeRemover({
      desfeito: false,
      detalhe: "Clicksign devolveu 500.",
      envelopeId: "env-30",
      nome: "Maria Souza Lima",
      passo: "requisitos",
    });

    expect(frase).toContain("NÃO TEM O QUE ASSINAR");
    expect(frase).toContain("painel da Clicksign");
    expect(frase).not.toContain("Tente a troca de novo");
    expect(frase).toContain("env-30");
  });
});

// ── O CAMINHO INTEIRO ───────────────────────────────────────────────────────

/** O duplo do Supabase: a linha do envelope, o payload do webhook e o que foi escrito. */
function bancoDeTeste(dados: { envelope: null | Record<string, unknown>; payload?: unknown }) {
  const atualizacoes: Record<string, unknown>[] = [];

  const from = (tabela: string) => {
    const builder = {
      eq: () => builder,
      limit: () => builder,
      maybeSingle: () =>
        Promise.resolve(
          tabela === "temis_envelopes"
            ? { data: dados.envelope, error: null }
            : { data: dados.payload === undefined ? null : { payload: dados.payload }, error: null },
        ),
      order: () => builder,
      select: () => builder,
      // O builder do Supabase é um `PromiseLike`: `update().eq()` é aguardado direto.
      then: (resolver: (r: { error: null }) => unknown) => Promise.resolve(resolver({ error: null })),
      update: (patch: Record<string, unknown>) => {
        atualizacoes.push(patch);
        return builder;
      },
    };
    return builder;
  };

  return { atualizacoes, sb: { from } as unknown as SupabaseClient };
}

/** O duplo da porta HTTP. Ver a nota de `PortaDaClicksign`. */
function portaDeTeste(respostas: Record<string, unknown> = {}) {
  const chamadas: { caminho: string; metodo: string }[] = [];

  const porta = async <T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> => {
    const metodo = opcoes.metodo ?? "GET";
    chamadas.push({ caminho, metodo });

    // ⚠️ O PADRÃO CASA MÉTODO + CAMINHO, e não só o caminho: `DELETE /envelopes/x/signers/y` e
    // `POST /envelopes/x/signers` compartilham o prefixo, e uma resposta armada para o cadastro
    // derrubaria a remoção junto — fazendo o teste provar o contrário do que ele diz provar.
    for (const [padrao, resposta] of Object.entries(respostas)) {
      if (`${metodo} ${caminho}`.includes(padrao)) {
        if (resposta instanceof Error) throw resposta;
        return resposta as T;
      }
    }

    if (caminho.endsWith("/signers")) return { data: { id: "sig-novo" } } as T;
    return {} as T;
  };

  return { chamadas, porta };
}

/** A linha de `temis_envelopes` do envio que já rodou — com as duas pessoas do caso real. */
const envelopeGravado = {
  envelope_id: "env-30",
  id: "reg-1",
  proposta_id: "prop-1",
  provedor_documento_id: "doc-30",
  signatarios: [
    { chave: "sig-titular", email: "titular@x.com", nome: "Henrique Sales do Vale", ordem: 1, papel: "comprador" },
    { chave: "sig-conjuge", email: "conjug@x.com", nome: "Maria Souza Lima", ordem: 1, papel: "conjuge" },
  ],
};

const pedidoDaTroca = { email: "maria@x.com", envelopeId: "env-30", signerId: "sig-conjuge" };

describe("a troca de e-mail, do começo ao fim", () => {
  it("remove, cria com o MESMO nome, faz os dois requisitos e convida só ele", async () => {
    const { atualizacoes, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.email).toBe("maria@x.com");
    expect(r.nome).toBe("Maria Souza Lima");
    expect(r.signerId).toBe("sig-novo");
    expect(r.aviso).toBeNull();

    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      "DELETE /envelopes/env-30/signers/sig-conjuge",
      "POST /envelopes/env-30/signers",
      "POST /envelopes/env-30/requirements",
      "POST /envelopes/env-30/requirements",
      "POST /envelopes/env-30/signers/sig-novo/notifications",
    ]);

    // ⚠️ MESCLADO, NUNCA SUBSTITUÍDO: o titular continua na lista, intacto. A casa já perdeu a
    // esteira de 122 CADs com um update que trocou o jsonb inteiro (20/07/2026).
    expect(atualizacoes).toHaveLength(1);
    expect(atualizacoes[0]?.signatarios).toEqual([
      { chave: "sig-titular", email: "titular@x.com", nome: "Henrique Sales do Vale", ordem: 1, papel: "comprador" },
      { chave: "sig-novo", email: "maria@x.com", nome: "Maria Souza Lima", ordem: 1, papel: "conjuge" },
    ]);
  });

  // ⚠️ A TRAVA PRINCIPAL É DA CLICKSIGN, E CHEGA COMO 403. A tela tem de ler português, e o caminho
  // de quem já assinou não é trocar o e-mail.
  it("403 no remover para tudo, e ninguém é criado", async () => {
    const { atualizacoes, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste({
      "DELETE /envelopes/env-30/signers/sig-conjuge": new FalhaDaClicksign("Clicksign devolveu 403.", {
        detalhes: ["Já assinou um documento. Não pode ser excluído"],
        requestId: null,
        status: 403,
      }),
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe(RECUSA_DE_QUEM_JA_ASSINOU);
    expect(r.removido).toBe(false);
    expect(r.status).toBe(409);
    expect(chamadas.map((c) => c.metodo)).toEqual(["DELETE"]);
    expect(atualizacoes).toEqual([]);
  });

  // ⚠️ O DESFECHO PIOR: removido e não recriado. A pessoa FICOU DE FORA do envelope, e a mensagem
  // tem de dizer isso — não "falhou ao trocar o e-mail".
  it("falha no cadastro depois de remover: diz o passo, que já removeu, e o que fazer", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { porta } = portaDeTeste({
      "POST /envelopes/env-30/signers": new FalhaDaClicksign("Clicksign devolveu 422.", {
        detalhes: [],
        requestId: null,
        status: 422,
      }),
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.removido).toBe(true);
    expect(r.erro).toContain("JÁ FOI REMOVIDO");
    expect(r.erro).toContain("Tente a troca de novo");
  });

  // ⚠️ O CADASTRO SEM REQUISITO É DESFEITO, E ISSO ABRE O ÚNICO CAMINHO DE CONSERTO. Deixá-lo lá
  // pendurava a pessoa num envelope sem nada para assinar E travava a retentativa: a lista congelada
  // ainda guarda o e-mail ANTIGO, então o signatário novo não casa com ninguém dela.
  it("requisito que falha desfaz o cadastro novo, e a frase manda tentar de novo", async () => {
    const { atualizacoes, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste({
      "POST /envelopes/env-30/requirements": new FalhaDaClicksign("Clicksign devolveu 500.", {
        detalhes: [],
        requestId: null,
        status: 500,
      }),
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.removido).toBe(true);
    expect(r.erro).toContain("DESFEITO");
    expect(r.erro).toContain("Tente a troca de novo");

    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      "DELETE /envelopes/env-30/signers/sig-conjuge",
      "POST /envelopes/env-30/signers",
      "POST /envelopes/env-30/requirements",
      "DELETE /envelopes/env-30/signers/sig-novo",
    ]);

    // ⚠️ E O NOSSO REGISTRO NÃO É TOCADO: nada valeu, e gravar o e-mail novo faria a tela mentir.
    expect(atualizacoes).toEqual([]);
  });

  // ⚠️ O CONVITE QUE NÃO SAI NÃO DERRUBA A TROCA: a pessoa já está no envelope com os requisitos.
  // Responder "falhou" faria o operador clicar de novo e REMOVER quem acabou de entrar.
  it("convite que não sai vira aviso, e a troca continua feita", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { porta } = portaDeTeste({
      "/notifications": new FalhaDaClicksign("Clicksign devolveu 429.", {
        detalhes: [],
        requestId: null,
        status: 429,
      }),
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.aviso).toContain("reenviar convite");
  });

  it("e-mail inválido não chega a chamar a Clicksign", async () => {
    const { atualizacoes, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, { ...pedidoDaTroca, email: "maria@" }, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.removido).toBe(false);
    expect(chamadas).toEqual([]);
    expect(atualizacoes).toEqual([]);
  });

  // ⚠️ SEM O ID DO DOCUMENTO OS REQUISITOS NÃO TÊM PARA ONDE APONTAR, e descobrir isso depois da
  // remoção deixaria a pessoa fora do envelope sem conserto. A coluna fica nula quando o envio
  // falhou antes de carimbar o sucesso.
  it("envelope sem o id do documento é recusado antes de remover", async () => {
    const { sb } = bancoDeTeste({
      envelope: { ...envelopeGravado, provedor_documento_id: null },
    });
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.removido).toBe(false);
    expect(chamadas).toEqual([]);
  });

  it("envelope que o Panteon não conhece é recusado sem chamar nada", async () => {
    const { sb } = bancoDeTeste({ envelope: null });
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
    expect(chamadas).toEqual([]);
  });

  // ⚠️ A PRIMEIRA TROCA DE UM ENVELOPE NÃO TEM CHAVE NO JSONB: ela só é gravada depois de uma troca.
  // A ponte entre a `signer.key` da Clicksign e a nossa lista é o diário, e é ele que dá o nome e a
  // ordem do signatário recriado.
  it("sem chave gravada, acha a pessoa pelo diário do envelope", async () => {
    const semChave = {
      ...envelopeGravado,
      signatarios: envelopeGravado.signatarios.map((s) => ({ ...s, chave: undefined })),
    };
    const { atualizacoes, sb } = bancoDeTeste({
      envelope: semChave,
      payload: {
        document: {
          events: [],
          key: "doc-30",
          signers: [
            { email: "titular@x.com", key: "sig-titular", name: "Henrique Sales do Vale" },
            { email: "conjug@x.com", key: "sig-conjuge", name: "Maria Souza Lima" },
          ],
        },
      },
    });
    const { porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nome).toBe("Maria Souza Lima");
    expect(atualizacoes[0]?.signatarios).toEqual([
      { email: "titular@x.com", nome: "Henrique Sales do Vale", ordem: 1, papel: "comprador" },
      { chave: "sig-novo", email: "maria@x.com", nome: "Maria Souza Lima", ordem: 1, papel: "conjuge" },
    ]);
  });
});
