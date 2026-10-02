import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { FalhaDaClicksign, type Opcoes } from "@/lib/assinatura/clicksign/cliente";

import {
  conferirDegrauDaTroca,
  conferirEmailDaTroca,
  fraseDaFalhaAntesDeRemover,
  fraseDaFalhaDepoisDeRemover,
  AVISO_DE_LINK_QUE_AINDA_NAO_CHEGOU,
  lerSignatariosCongelados,
  linkDeAssinatura,
  RECUSA_DE_CHAVE_QUE_NAO_E_DA_CLICKSIGN,
  RECUSA_DE_CONVITE_DE_QUEM_JA_ASSINOU,
  RECUSA_DE_CONVITE_DE_QUEM_RECUSOU,
  RECUSA_DE_EMAIL_REPETIDO_NO_QUADRO,
  RECUSA_DE_ID_QUE_NAO_E_DESTE_ENVELOPE,
  RECUSA_DE_LINK_DE_QUEM_JA_ASSINOU,
  RECUSA_DE_LINK_SEM_ID,
  RECUSA_DE_QUEM_JA_ASSINOU,
  RECUSA_DE_QUEM_NAO_ESTA_NO_QUADRO,
  RECUSA_DE_TROCA_DE_QUEM_JA_ASSINOU,
  reenviarConvite,
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
  assinadoEm: null,
  chave: null,
  recusadoEm: null,
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
      {
        assinadoEm: null,
        chave: "sig-1",
        email: "a@x.com",
        nome: "Ana Paula Dias",
        ordem: 2,
        papel: "conjuge",
        recusadoEm: null,
      },
    ]);
  });

  // ⚠️ AS DUAS MARCAS VÊM JUNTAS, E NÃO SÃO ENFEITE: são elas que recusam o convite de quem já
  // acabou com o documento. Medido em produção em 01/10/2026 (só SELECT) nos 18 envelopes vivos sem
  // id da Clicksign: 87 linhas, 17 com `assinado_em` e 0 com `recusado_em`. A segunda entra porque a
  // função da 0195 carrega `assinado_em` e `recusado_em` NO MESMO NÍVEL (parte (a) de
  // `0195_o_contrato_mora_no_panteon.sql`), e ler só uma seria tratar o recusado como pendente.
  it("carrega `assinado_em` e `recusado_em`, que são as travas do convite", () => {
    const lida = lerSignatariosCongelados([
      { assinado_em: "2026-09-30T12:00:00.000Z", email: "a@x.com", nome: "Ana", papel: "conjuge" },
      { email: "b@x.com", nome: "Bia", papel: "comprador", recusado_em: "2026-09-30T13:00:00.000Z" },
      { email: "c@x.com", nome: "Cida", papel: "comprador" },
    ]);
    expect(lida[0]?.assinadoEm).toBe("2026-09-30T12:00:00.000Z");
    expect(lida[0]?.recusadoEm).toBeNull();
    expect(lida[1]?.recusadoEm).toBe("2026-09-30T13:00:00.000Z");
    expect(lida[2]?.assinadoEm).toBeNull();
    expect(lida[2]?.recusadoEm).toBeNull();
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

/** Uma resposta da função da 0195: o que ela devolve numa linha. */
type RespostaDaFuncao = { data: unknown; error: null | { code: string; message: string } };

/**
 * O duplo do Supabase: a linha do envelope, o payload do webhook, o que foi escrito e o que foi
 * pedido à função da 0195 (`temis_envelope_registrar_assinaturas`).
 *
 * ⚠️ A FUNÇÃO É UMA FILA DE RESPOSTAS (`funcao`), e sem fila ela devolve o quadro que recebeu, com as
 * marcas de quem já tinha: é o recorte da regra de verdade (a chave casa, a marca não se perde) que
 * basta para provar que a troca MANDA o que a função precisa. A regra inteira é do banco, provada no
 * ensaio SQL da 0195.
 */
function bancoDeTeste(dados: {
  envelope: null | Record<string, unknown>;
  funcao?: RespostaDaFuncao[];
  payload?: unknown;
}) {
  const atualizacoes: Record<string, unknown>[] = [];
  const chamadasDaFuncao: Record<string, unknown>[] = [];
  const filtros: Array<[string, unknown]> = [];
  let leiturasDoEnvelope = 0;

  const rpc = (_nome: string, args: Record<string, unknown>) => {
    chamadasDaFuncao.push(args);
    const daFila = dados.funcao?.shift();
    if (daFila) return Promise.resolve(daFila);
    const antigo = (dados.envelope?.signatarios ?? []) as Array<Record<string, unknown>>;
    const quadro = ((args.p_quadro ?? []) as Array<Record<string, unknown>>).map((novo) => {
      const velho = antigo.find((a) => a.chave === novo.chave);
      return velho?.assinado_em ? { ...novo, assinado_em: velho.assinado_em } : novo;
    });
    return Promise.resolve({
      data: [
        {
          assinaram: 0,
          estado_antes: "parcial",
          estado_depois: "parcial",
          fechado: null,
          mudou_estado: false,
          quadro,
          recusa: null,
          total: quadro.length,
        },
      ],
      error: null,
    });
  };

  const from = (tabela: string) => {
    const builder = {
      eq: (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return builder;
      },
      limit: () => builder,
      maybeSingle: () => {
        if (tabela === "temis_envelopes") leiturasDoEnvelope += 1;
        return Promise.resolve(
          tabela === "temis_envelopes"
            ? { data: dados.envelope, error: null }
            : { data: dados.payload === undefined ? null : { payload: dados.payload }, error: null },
        );
      },
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

  return {
    atualizacoes,
    chamadasDaFuncao,
    filtros,
    leituras: () => leiturasDoEnvelope,
    sb: { from, rpc } as unknown as SupabaseClient,
  };
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

    if (metodo === "GET" && caminho.includes("/signers?")) return DEGRAUS_DO_ENVELOPE_GRAVADO as T;
    if (caminho.endsWith("/signers")) return { data: { id: "sig-novo" } } as T;
    return {} as T;
  };

  return { chamadas, porta };
}

/** O que a Clicksign responde a `GET /envelopes/{id}/signers`: id e degrau (`group`). */
const listaDeDegraus = (degraus: Record<string, unknown>) => ({
  data: Object.entries(degraus).map(([id, group]) => ({ attributes: { group }, id, type: "signers" })),
});

/** As duas pessoas do envelope gravado, as duas no degrau 1: o último, e a troca passa. */
const DEGRAUS_DO_ENVELOPE_GRAVADO = listaDeDegraus({ "sig-conjuge": 1, "sig-titular": 1 });

const LER_DEGRAUS = "GET /envelopes/env-30/signers?page[size]=50";

/** A linha de `temis_envelopes` do envio que já rodou — com as duas pessoas do caso real. */
const envelopeGravado = {
  atualizado_em: "2026-09-28T12:00:00.000Z",
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
  it("lê o degrau, cria com o MESMO nome e os dois requisitos, SÓ ENTÃO remove o antigo, e convida só ele", async () => {
    const { atualizacoes, chamadasDaFuncao, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.email).toBe("maria@x.com");
    expect(r.nome).toBe("Maria Souza Lima");
    expect(r.signerId).toBe("sig-novo");
    expect(r.aviso).toBeNull();

    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      LER_DEGRAUS,
      "POST /envelopes/env-30/signers",
      // ⚠️ UMA chamada em massa, e não dois POST /requirements: no envelope já ativado a Clicksign
      // recusa o POST /requirements com 403 "envelope não está com status draft" (Maura, 01/10/2026).
      "POST /envelopes/env-30/bulk_requirements",
      // ⚠️ A REMOÇÃO VEM DEPOIS DO CADASTRO: o envelope nunca fica sem a pessoa, e com `auto_close`
      // ligado tirar a última pendente antes poderia fechar o contrato sem ela.
      "DELETE /envelopes/env-30/signers/sig-conjuge",
      "POST /envelopes/env-30/signers/sig-novo/notifications",
    ]);

    // ⚠️ MESCLADO, NUNCA SUBSTITUÍDO: o titular continua na lista, intacto. A casa já perdeu a
    // esteira de 122 CADs com um update que trocou o jsonb inteiro (20/07/2026). E desde a F1 da
    // fonte única quem grava é a função da 0195, com a VERSÃO lida (`p_quadro_de`): nada de update
    // direto no jsonb.
    expect(atualizacoes).toEqual([]);
    expect(chamadasDaFuncao).toHaveLength(1);
    expect(chamadasDaFuncao[0]).toMatchObject({
      p_envelope: "reg-1",
      p_quadro: [
        { chave: "sig-titular", email: "titular@x.com", nome: "Henrique Sales do Vale", ordem: 1, papel: "comprador" },
        // ⚠️ ORDEM 2, E NÃO 1: os dois estavam no degrau 1 (o último), e quem é recadastrado num
        // envelope rodando vai para o último + 1.
        { chave: "sig-novo", email: "maria@x.com", nome: "Maria Souza Lima", ordem: 2, papel: "conjuge" },
      ],
      p_quadro_de: "2026-09-28T12:00:00.000Z",
    });
  });

  // ⚠️ A TRAVA PRINCIPAL É DA CLICKSIGN, E CHEGA COMO 403. A tela tem de ler português, e o caminho
  // de quem já assinou não é trocar o e-mail.
  it("403 no remover: o cadastro novo é desfeito, e o envelope fica como estava", async () => {
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
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      LER_DEGRAUS,
      "POST /envelopes/env-30/signers",
      "POST /envelopes/env-30/bulk_requirements",
      "DELETE /envelopes/env-30/signers/sig-conjuge",
      "DELETE /envelopes/env-30/signers/sig-novo",
    ]);
    expect(atualizacoes).toEqual([]);
  });

  // ⚠️ ATÉ 02/10/2026 ESTE ERA O DESFECHO PIOR: removido e não recriado, a pessoa FORA do envelope.
  // Criando antes de remover, a falha no cadastro deixa o antigo onde estava.
  it("falha no cadastro: ninguém é removido, e a frase manda tentar de novo", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste({
      "POST /envelopes/env-30/signers": new FalhaDaClicksign("Clicksign devolveu 422.", {
        detalhes: [],
        requestId: null,
        status: 422,
      }),
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.removido).toBe(false);
    expect(r.erro).toContain("continua no envelope env-30 com o e-mail antigo");
    expect(r.erro).toContain("Pode tentar de novo");
    expect(chamadas.map((c) => c.metodo)).not.toContain("DELETE");
  });

  // ⚠️ O CADASTRO SEM REQUISITO É DESFEITO, E ISSO ABRE O ÚNICO CAMINHO DE CONSERTO. Deixá-lo lá
  // pendurava a pessoa num envelope sem nada para assinar E travava a retentativa: a lista congelada
  // ainda guarda o e-mail ANTIGO, então o signatário novo não casa com ninguém dela.
  it("requisito que falha desfaz o cadastro novo, e a frase manda tentar de novo", async () => {
    const { atualizacoes, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste({
      "POST /envelopes/env-30/bulk_requirements": new FalhaDaClicksign("Clicksign devolveu 500.", {
        detalhes: [],
        requestId: null,
        status: 500,
      }),
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.removido).toBe(false);
    expect(r.erro).toContain("continua no envelope env-30 com o e-mail antigo");
    expect(r.erro).toContain("Pode tentar de novo");

    // O antigo nunca foi tocado: só o cadastro novo, que ficou sem requisito, saiu.
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      LER_DEGRAUS,
      "POST /envelopes/env-30/signers",
      "POST /envelopes/env-30/bulk_requirements",
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
    const { chamadasDaFuncao, sb } = bancoDeTeste({
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
    // ⚠️ CORREÇÃO DE 01/10/2026: QUEM NÃO TEM ID DA CLICKSIGN SAI SEM O CAMPO `chave`, E NÃO COM
    // `tmp:<posição>`. Esta assertiva prendia o contrário, e a 0195 NÃO exige `chave` em todo item —
    // ela só testa `nullif(item->>'chave','') is not null` e, sem chave, casa a linha antiga pelo
    // e-mail ÚNICO. Medido em produção em 01/10/2026 (só SELECT): 104 das 159 linhas dos 29 envelopes
    // da Clicksign NÃO têm o campo `chave`, e zero têm `tmp:`. A chave inventada é posicional, então
    // numa reescrita seguinte com o quadro em outra ordem ela cai na linha de OUTRA pessoa — e a 0195
    // casa pela chave ANTES do e-mail, levando o `assinado_em` para quem nunca assinou.
    expect(chamadasDaFuncao[0]?.p_quadro).toEqual([
      { email: "titular@x.com", nome: "Henrique Sales do Vale", ordem: 1, papel: "comprador" },
      { chave: "sig-novo", email: "maria@x.com", nome: "Maria Souza Lima", ordem: 2, papel: "conjuge" },
    ]);
  });
});

// ── O DEGRAU DA TROCA (02/10/2026) ──────────────────────────────────────────
//
// ⚠️ O QUE ISTO MEDE FOI LIDO NA CLICKSIGN, POR GET, COM AUTORIZAÇÃO DO LUCAS ("pode ler pela api").
// Quem é recadastrado num envelope já enviado cai num degrau NOVO, no fim da fila: a Maura
// (compradora do VOC0306, degrau 3) voltou no degrau 6; a Rita (vendedora do VOL, degrau 4, o último)
// voltou no 5. E o Lucas aceitou: *"não tem problema da pessoa ir para o ultimo degrau"*. A troca
// segue em qualquer degrau, e o número do fim da fila é o que vai para o quadro.
describe("o degrau da troca: a pessoa vai para o último + 1", () => {
  const conferir = (degraus: Record<string, unknown>, signerId: string) =>
    conferirDegrauDaTroca({
      degraus: Object.entries(degraus).map(([id, grupo]) => ({ grupo, id })),
      envelopeId: "env-30",
      signerId,
    });

  it("a Maura do VOC0306: compradora no degrau 3 de 5 vai para o 6", () => {
    expect(
      conferir({ coord1: 1, coord2: 1, corretor: 2, maura: 3, test1: 4, test2: 4, vend1: 5, vend2: 5 }, "maura"),
    ).toEqual({ degrauNovo: 6, ok: true, presente: true, ultimo: 5 });
  });

  it("a Rita do VOL: vendedora no último degrau, dividido com outras duas, vai para o 5", () => {
    expect(conferir({ comprador: 2, helena: 4, rita: 4, test: 3, vitor: 4 }, "rita")).toEqual({
      degrauNovo: 5,
      ok: true,
      presente: true,
      ultimo: 4,
    });
  });

  it("envelope sem ordem (todos no degrau 1): a pessoa vai para o 2, depois de todos", () => {
    expect(conferir({ a: 1, b: 1 }, "b")).toEqual({ degrauNovo: 2, ok: true, presente: true, ultimo: 1 });
  });

  it("quem já saiu do envelope numa tentativa anterior volta no fim, e não é recusado", () => {
    expect(conferir({ test: 4, vend: 5 }, "maura")).toEqual({ degrauNovo: 6, ok: true, presente: false, ultimo: 5 });
  });

  it("degrau 0 ou vazio é recusado: gravar o fim da fila sobre um degrau que não se sabe é chutar", () => {
    for (const ruim of [0, null, undefined, "3", 2.5]) {
      const v = conferir({ maura: 3, outro: ruim }, "maura");
      expect(v.ok).toBe(false);
      if (v.ok) return;
      expect(v.status).toBe(502);
      expect(v.erro).toContain("Nada foi mexido");
    }
  });

  it("lista vazia é recusada", () => {
    expect(conferir({}, "maura").ok).toBe(false);
  });
});

describe("a frase de quando a troca para com o antigo ainda no envelope", () => {
  const base = { detalhe: "Clicksign devolveu 500.", envelopeId: "env-30", nome: "Maria Souza Lima" };

  it("cadastro recusado: nada mudou, pode tentar de novo", () => {
    const frase = fraseDaFalhaAntesDeRemover({ ...base, desfeito: false, passo: "signatario" });
    expect(frase).toContain("A troca não foi feita");
    expect(frase).toContain("continua no envelope env-30 com o e-mail antigo");
    expect(frase).toContain("Pode tentar de novo");
  });

  it("remoção recusada e o novo desfeito: nada mudou", () => {
    const frase = fraseDaFalhaAntesDeRemover({ ...base, desfeito: true, passo: "remocao" });
    expect(frase).toContain("não deixou tirar o cadastro antigo");
    expect(frase).toContain("Pode tentar de novo");
  });

  it("nada desfeito: as duas linhas ficaram, e a frase manda a mão no painel", () => {
    const frase = fraseDaFalhaAntesDeRemover({ ...base, desfeito: false, passo: "remocao" });
    expect(frase).toContain("as duas linhas");
    expect(frase).toContain("painel da Clicksign");
    expect(frase).not.toContain("Pode tentar de novo");
  });
});

describe("a troca de e-mail lê o degrau na Clicksign antes de tudo", () => {
  // ⚠️ ATÉ A DECISÃO DO LUCAS (02/10/2026) ISTO ERA RECUSADO, e o caminho era voltar o card para a
  // análise, o que cancela o envelope e faz todo mundo assinar de novo. Agora a troca segue, e o
  // quadro grava a pessoa no degrau em que a Clicksign a pôs: o último + 1.
  it("quem não está no último degrau troca, e o quadro grava a pessoa no fim da fila", async () => {
    const { atualizacoes, chamadasDaFuncao, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste({
      [LER_DEGRAUS]: listaDeDegraus({ "sig-conjuge": 1, "sig-titular": 2 }),
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      LER_DEGRAUS,
      "POST /envelopes/env-30/signers",
      "POST /envelopes/env-30/bulk_requirements",
      "DELETE /envelopes/env-30/signers/sig-conjuge",
      "POST /envelopes/env-30/signers/sig-novo/notifications",
    ]);
    expect(atualizacoes).toEqual([]);
    expect(chamadasDaFuncao[0]?.p_quadro).toEqual([
      { chave: "sig-titular", email: "titular@x.com", nome: "Henrique Sales do Vale", ordem: 1, papel: "comprador" },
      { chave: "sig-novo", email: "maria@x.com", nome: "Maria Souza Lima", ordem: 3, papel: "conjuge" },
    ]);
  });

  // ⚠️ A ORDEM GRAVADA NUMA TROCA SOBREVIVE À SEGUINTE: a 0195 só herda as marcas de assinatura, e
  // quem reescreve o quadro reenvia a `ordem` de cada um. A Maura que foi para o 6 continua no 6.
  it("a segunda troca no mesmo envelope mantém a ordem que a primeira gravou", async () => {
    const jaTrocado = {
      ...envelopeGravado,
      signatarios: [{ ...envelopeGravado.signatarios[0], ordem: 6 }, envelopeGravado.signatarios[1]],
    };
    const { chamadasDaFuncao, sb } = bancoDeTeste({ envelope: jaTrocado });
    const { porta } = portaDeTeste({
      [LER_DEGRAUS]: listaDeDegraus({ "sig-conjuge": 1, "sig-titular": 6 }),
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    const quadro = chamadasDaFuncao[0]?.p_quadro as Array<{ chave: string; ordem: number }>;
    expect(quadro.map((p) => [p.chave, p.ordem])).toEqual([
      ["sig-titular", 6],
      ["sig-novo", 7],
    ]);
  });

  it("leitura que falha: a troca não começa", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste({
      [LER_DEGRAUS]: new FalhaDaClicksign("Clicksign devolveu 503.", { detalhes: [], requestId: null, status: 503 }),
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.removido).toBe(false);
    expect(r.erro).toContain("Nada foi mexido");
    expect(chamadas).toHaveLength(1);
  });

  it("resposta sem lista: a troca não começa", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste({ [LER_DEGRAUS]: { data: { id: "x" } } });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    expect(chamadas).toHaveLength(1);
  });

  // ⚠️ O CASO DA RETENTATIVA: uma troca anterior tirou o cadastro e não conseguiu pôr de volta. Se a
  // pessoa era do último degrau, voltar no fim é voltar no lugar dela, e não há o que remover.
  it("o antigo já fora e do último degrau: só cadastra o novo, sem DELETE", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste({ [LER_DEGRAUS]: listaDeDegraus({ "sig-titular": 1 }) });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.aviso).toContain("tentativa anterior");
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
      LER_DEGRAUS,
      "POST /envelopes/env-30/signers",
      "POST /envelopes/env-30/bulk_requirements",
      "POST /envelopes/env-30/signers/sig-novo/notifications",
    ]);
  });

  it("o antigo já fora e NÃO era do último degrau: volta no fim, sem DELETE", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste({ [LER_DEGRAUS]: listaDeDegraus({ "sig-titular": 2 }) });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    expect(chamadas.map((c) => c.metodo)).not.toContain("DELETE");
    const quadro = chamadasDaFuncao[0]?.p_quadro as Array<{ chave: string; ordem: number }>;
    expect(quadro.find((p) => p.chave === "sig-novo")?.ordem).toBe(3);
  });

  it("o antigo já fora e o cadastro falha: a frase diz que a pessoa continua fora", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { porta } = portaDeTeste({
      [LER_DEGRAUS]: listaDeDegraus({ "sig-titular": 1 }),
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
  });

  it("remoção que falha (500): o novo é desfeito e nada muda", async () => {
    const { atualizacoes, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste({
      "DELETE /envelopes/env-30/signers/sig-conjuge": new FalhaDaClicksign("Clicksign devolveu 500.", {
        detalhes: [],
        requestId: null,
        status: 500,
      }),
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.removido).toBe(false);
    expect(r.erro).toContain("não deixou tirar o cadastro antigo");
    expect(r.erro).toContain("Pode tentar de novo");
    expect(chamadas.at(-1)).toEqual({ caminho: "/envelopes/env-30/signers/sig-novo", metodo: "DELETE" });
    expect(atualizacoes).toEqual([]);
  });

  it("403 na remoção E o desfazer falha: a frase conta as duas linhas", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { porta } = portaDeTeste({
      "DELETE /envelopes/env-30/signers/sig-conjuge": new FalhaDaClicksign("Clicksign devolveu 403.", {
        detalhes: [],
        requestId: null,
        status: 403,
      }),
      "DELETE /envelopes/env-30/signers/sig-novo": new FalhaDaClicksign("Clicksign devolveu 500.", {
        detalhes: [],
        requestId: null,
        status: 500,
      }),
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("as duas linhas");
  });
});

// ── A TROCA PELA FUNÇÃO DA 0195 (F1 da fonte única, bug 8.6) ────────────────
//
// ⚠️ O QUE ERA: `gravarTrocaNoRegistro` reescrevia o jsonb inteiro, sem trava. Um webhook que
// gravasse a assinatura do titular entre a leitura do envelope e esta escrita perdia a marca, e o
// contador do card voltava para "0/2" com o titular já assinado.
describe("a troca grava pela função, com a versão lida", () => {
  it("preserva o assinado_em de quem continua no quadro (a chave casa)", async () => {
    const comAssinatura = {
      ...envelopeGravado,
      signatarios: [
        { ...envelopeGravado.signatarios[0], assinado_em: "2026-09-27T10:00:00.000-03:00" },
        envelopeGravado.signatarios[1],
      ],
    };
    const { chamadasDaFuncao, sb } = bancoDeTeste({ envelope: comAssinatura });
    const { porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    // A troca manda a CHAVE de quem continua, e é por ela que a função leva a marca junto.
    const mandado = chamadasDaFuncao[0]?.p_quadro as Array<{ chave: string }>;
    expect(mandado.map((p) => p.chave)).toEqual(["sig-titular", "sig-novo"]);
    expect(chamadasDaFuncao[0]?.p_quadro_de).toBe(comAssinatura.atualizado_em);
  });

  it("quadro_mudou: relê o envelope e tenta UMA vez", async () => {
    const { chamadasDaFuncao, leituras, sb } = bancoDeTeste({
      envelope: envelopeGravado,
      funcao: [
        {
          data: [
            {
              assinaram: null,
              estado_antes: "parcial",
              estado_depois: "parcial",
              fechado: null,
              mudou_estado: false,
              quadro: null,
              recusa: "quadro_mudou",
              total: null,
            },
          ],
          error: null,
        },
      ],
    });
    const { porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.aviso).toBeNull();
    expect(chamadasDaFuncao).toHaveLength(2);
    // Uma leitura antes da troca e a releitura depois da recusa.
    expect(leituras()).toBe(2);
  });

  it("quadro_mudou duas vezes: não insiste, e vira aviso (a troca na Clicksign está feita)", async () => {
    const recusa: RespostaDaFuncao = {
      data: [
        {
          assinaram: null,
          estado_antes: "parcial",
          estado_depois: "parcial",
          fechado: null,
          mudou_estado: false,
          quadro: null,
          recusa: "quadro_mudou",
          total: null,
        },
      ],
      error: null,
    };
    const { chamadasDaFuncao, sb } = bancoDeTeste({
      envelope: envelopeGravado,
      funcao: [recusa, { ...recusa }],
    });
    const { porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(chamadasDaFuncao).toHaveLength(2);
    expect(r.aviso).toContain("não conseguiu atualizar o registro");
  });

  // ⚠️ SEM CAMINHO DE RESERVA (plano, F1). O update antigo do jsonb inteiro é o próprio bug 8.6; a
  // F1 só sobe com a 0195 aplicada, e se ela faltar a troca vira aviso, sem gesto por fora.
  it("sem a 0195 no banco, NÃO grava por update direto: vira aviso", async () => {
    const { atualizacoes, sb } = bancoDeTeste({
      envelope: envelopeGravado,
      funcao: [
        {
          data: null,
          error: { code: "PGRST202", message: "Could not find the function public.temis_envelope_registrar_assinaturas" },
        },
      ],
    });
    const { porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(atualizacoes).toEqual([]);
    expect(r.aviso).toContain("não conseguiu atualizar o registro");
  });

  // ⚠️ SÓ A CLICKSIGN (0.15 do plano). A mesma tabela passa a guardar os envelopes da D4Sign (F3), e
  // trocar signatário é ação da Clicksign: a leitura do envelope filtra pelo provedor.
  it("lerEnvelope filtra provedor = clicksign", async () => {
    const { filtros, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { porta } = portaDeTeste();

    await reenviarConvite(sb, { envelopeId: "env-30", signerId: "sig-titular" }, porta);

    expect(filtros).toContainEqual(["provedor", "clicksign"]);
    expect(filtros).toContainEqual(["envelope_id", "env-30"]);
  });
});

// ── O REENVIO DO CONVITE ────────────────────────────────────────────────────
//
// ⚠️ O ID QUE A TELA MANDA SEMPRE FOI O ID CERTO — ERA A NOSSA RECUSA QUE ESTAVA ERRADA. Lucas,
// 01/10/2026: *"Nao consigo reenviar os contratos. Precisamos sentar e resolver os pontos pendentes
// da Temis."* Medido em produção em 01/10/2026 (só SELECT, projeto bxgukywoxgivlrhjkwjx): a `chave`
// que o envio congela e a `signer.key` que o webhook manda são O MESMO VALOR em 54 de 54 pares
// (8 envelopes, zero diferenças), e nos 18 envelopes vivos sem nenhuma `chave` congelada as 70
// pessoas sem `assinado_em` no quadro TODAS têm `signer.key` no payload do webhook (87 linhas, 17
// com `assinado_em`, 0 sem key) — e 68 delas precisam de convite, porque o payload tem 19 eventos
// `sign` e o quadro só 17 marcas. Ou seja: o `signer.key` do webhook É o `signer_id` que
// `POST /envelopes/{id}/signers/{signer_id}/notifications` aceita, e ele já estava no nosso banco.
//
//   with ev as (select distinct on (provedor_documento_id) provedor_documento_id, payload
//                 from temis_assinatura_eventos where assinatura_conferida
//                order by provedor_documento_id, recebido_em desc)
//   -- pares: 54 | identicas: 54 | diferentes: 0 | envelopes: 8
//   -- 18 vivos sem chave: pessoas 87 | sem assinado_em 70 | com key uuid 70 | sem key 0
//   -- e o payload sabe de 19 `sign` contra 17 `assinado_em`: 68 precisam de convite, nao 70
//
// ⚠️ O 422 DE 24/09/2026 ERA DO OUTRO CASO, E É ELE QUE SOBRA. Quando a pessoa só existe na lista
// congelada (sem linha no payload), `juntarComOsCongelados` põe o PRÓPRIO E-MAIL na `chave`
// (`diario-do-envelope-db.ts`), e e-mail nunca é id. Medido no mesmo dia: das 55 chaves congeladas e
// das 160 `signer.key` dos envelopes da Clicksign, 55 e 160 têm forma de uuid, ZERO têm "@" e ZERO
// começam com `tmp:` ou `c2x:`.
describe("o reenvio do convite", () => {
  const doEnvelope = { envelopeId: "env-30", signerId: "sig-titular" };

  // ⚠️ COM A CHAVE CONGELADA NADA MUDA, E ELE NÃO GANHA LEITURA NENHUMA: 8 dos 29 envelopes da
  // Clicksign têm o id de todo mundo (01/10/2026), o da MAURA MARIA PASSOS entre eles.
  it("o convite que sai continua saindo, com UMA chamada só", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(sb, doEnvelope, porta);

    expect(r.ok).toBe(true);
    expect(chamadas).toEqual([
      { caminho: "/envelopes/env-30/signers/sig-titular/notifications", metodo: "POST" },
    ]);
  });

  it("o 429 da Clicksign vira “espere um minuto”, e não erro", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { porta } = portaDeTeste({
      "/notifications": new FalhaDaClicksign("Clicksign devolveu 429.", {
        detalhes: [],
        requestId: "req-9",
        status: 429,
      }),
    });

    const r = await reenviarConvite(sb, doEnvelope, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(429);
    expect(r.erro).toContain("Aguarde um minuto");
  });

  // ⚠️ A FRASE DO 422 NÃO PODE MAIS DIZER "O PANTEON NÃO TEM O ID", porque ele tem: o id que foi
  // mandado saiu do quadro congelado ou do payload de webhook DESTE envelope, conferido antes da
  // chamada. Dizer o contrário manda a operadora ao painel da Clicksign procurar um id que ela vai
  // encontrar lá certinho.
  it("o 422 diz que a Clicksign não aceitou o signatário, e não que falta id aqui", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { porta } = portaDeTeste({
      "POST /envelopes/env-30/signers/sig-titular/notifications": new FalhaDaClicksign(
        "Clicksign devolveu 422.",
        { detalhes: [], requestId: "req-7", status: 422 },
      ),
    });

    const r = await reenviarConvite(sb, doEnvelope, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.erro).not.toContain("não tem o id");
    expect(r.erro).toContain("não aceitou");
    expect(r.erro).toContain("painel da Clicksign");
    expect(r.erro).toContain("O envelope continua como estava");
  });
});

// ── O REENVIO NOS 18 ENVELOPES QUE NUNCA CONGELARAM A CHAVE ─────────────────
//
// ⚠️ SÃO 18 ENVELOPES, E O ID DELES JÁ ESTÁ NO NOSSO BANCO. Medido em produção em 01/10/2026 (só
// SELECT): dos 29 envelopes da Clicksign em `temis_envelopes`, 21 estão sem nenhuma `chave` no
// quadro e 18 deles seguem VIVOS (12 `aguardando` e 6 `parcial` — 14 termos de acordo do Hades e 4
// contratos da Têmis), com 87 pessoas, 17 marcadas como assinadas no quadro e 70 sem a marca (68
// pendentes de verdade: o payload tem 19 `sign`); os outros 3 estão
// `cancelado`. Nenhuma das 87 linhas tem o campo `chave`. O que a tela manda nessas linhas é a
// `signer.key` do payload do webhook, que é exatamente o `signer_id` do endpoint de notificação —
// então o reenvio destrava SEM NENHUMA CHAMADA NOVA e sem reescrever o quadro.
describe("o reenvio nos 18 envelopes que nunca congelaram a chave", () => {
  /**
   * A linha dos 18, NA FORMA DO BANCO: nenhum item tem o campo `chave`.
   *
   * ⚠️ A FORMA AQUI É MEDIDA, NÃO IMAGINADA. Medido em 01/10/2026 (só SELECT): das 87 linhas dos 18
   * envelopes vivos sem id, 87 estão SEM o campo `chave` (as chaves do item são só `assinado_em`,
   * `email`, `nome`, `ordem`, `papel`), zero têm `tmp:` e zero têm `c2x:`. Semear `chave: "tmp:1"`
   * aqui esconderia justamente o defeito que esta suíte existe para pegar.
   */
  const envelopeSemAsChaves = {
    atualizado_em: "2026-09-29T16:06:00.000Z",
    envelope_id: "env-40",
    estado: "parcial",
    id: "reg-40",
    proposta_id: null,
    provedor_documento_id: "doc-40",
    signatarios: [
      {
        assinado_em: "2026-09-30T12:00:00.000Z",
        email: "nivea@careli.test",
        nome: "Nivea Careli",
        ordem: 1,
        papel: "careli",
      },
      { email: "maura@exemplo.test", nome: "Maura Maria Passos", ordem: 2, papel: "comprador" },
      {
        email: "huber@exemplo.test",
        nome: "Huber de Andrade Lustosa Junior",
        ordem: 3,
        papel: "testemunha",
      },
      {
        email: "recusou@exemplo.test",
        nome: "Quem Recusou o Documento",
        ordem: 4,
        papel: "conjuge",
        recusado_em: "2026-09-30T14:00:00.000Z",
      },
    ],
  };

  // Os ids na forma MEDIDA: uuid. 55 de 55 chaves congeladas e 160 de 160 `signer.key` (01/10/2026).
  const ID_NIVEA = "11111111-1111-4111-8111-111111111111";
  const ID_MAURA = "22222222-2222-4222-8222-222222222222";
  const ID_HUBER = "33333333-3333-4333-8333-333333333333";
  const ID_RECUSOU = "44444444-4444-4444-8444-444444444444";

  /**
   * O payload do último webhook deste envelope — a fonte do id, e ela já está no nosso banco.
   *
   * ⚠️ O E-MAIL VEM COM CAIXA DIFERENTE DE PROPÓSITO (`Nivea@Careli.test`): o casamento com o quadro
   * é por e-mail normalizado, e a Clicksign devolve o endereço como foi digitado.
   */
  const payloadDoWebhook = {
    document: {
      events: [],
      key: "doc-40",
      signers: [
        { email: "Nivea@Careli.test", key: ID_NIVEA, name: "Nivea Careli" },
        { email: "maura@exemplo.test", key: ID_MAURA, name: "Maura Maria Passos" },
        { email: "huber@exemplo.test", key: ID_HUBER, name: "Huber de Andrade Lustosa Junior" },
        { email: "recusou@exemplo.test", key: ID_RECUSOU, name: "Quem Recusou o Documento" },
      ],
    },
  };

  const banco = (patch: Record<string, unknown> = {}) =>
    bancoDeTeste({
      envelope: { ...envelopeSemAsChaves, ...patch },
      payload: payloadDoWebhook,
    });

  // ⚠️ ESTE É O TESTE DA FATIA. As 68 pessoas pendentes passam por aqui, e o que elas custam é UMA
  // notificação: nenhuma leitura nova na Clicksign e nenhuma escrita em `temis_envelopes`.
  it("pendente com key do webhook recebe o convite, sem leitura nova na Clicksign", async () => {
    const { chamadasDaFuncao, sb } = banco();
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(
      sb,
      { envelopeId: "env-40", signerId: ID_MAURA },
      porta,
    );

    expect(r.ok).toBe(true);
    expect(chamadas).toEqual([
      { caminho: `/envelopes/env-40/signers/${ID_MAURA}/notifications`, metodo: "POST" },
    ]);
    // ⚠️ E O QUADRO NÃO É REESCRITO. Reescrevê-lo para "aproveitar" o id lido é o que custou duas
    // rodadas de revisão e foi recusado: a 0195 só reencontra a linha sem `chave` pelo e-mail ÚNICO,
    // e a casa já perdeu marca de esteira assim (122 CADs, 20/07/2026).
    expect(chamadasDaFuncao).toEqual([]);
  });

  /**
   * ⚠️ O PAYLOAD SABE MAIS QUE O QUADRO SOBRE QUEM ASSINOU, E JOGAR ISSO FORA MANDAVA CONVITE PARA
   * QUEM JÁ ASSINOU.
   *
   * `noPayloadDesteEnvelope` chama `quemAssinou`, que calcula o `assinouEm` de cada pessoa a partir
   * dos eventos `sign` do documento, e devolvia só o e-mail. Depois disso a única pergunta sobre
   * assinatura era o `assinado_em` do nosso quadro.
   *
   * Medido em produção em 01/10/2026 (só SELECT, projeto bxgukywoxgivlrhjkwjx, reproduzindo a leitura
   * deste código — evento mais recente com `assinatura_conferida = true`, por `provedor_documento_id`
   * e, na falta, por `envelope_id`): nos 18 envelopes vivos sem chave há 19 eventos `sign` no payload
   * mais recente e apenas 17 `assinado_em` nas 87 linhas do quadro. As 2 de diferença são pessoas
   * reais de termos de acordo do Hades — envelope 9eafed62-4451-4ba2-b76f-c552f47c5f8a (assinou
   * 23/09/2026 15:37:41Z) e envelope f76d7af0-1f51-4161-a094-abeee04a5829 (assinou 24/09/2026
   * 17:58:32Z) —, as duas com `assinado_em` NULO no quadro. Ou seja: dos 70 "pendentes" do recorte, 2
   * já assinaram, e quem deve receber convite são 68.
   */
  it("o payload diz que assinou e o quadro não: recusa com 409, antes de qualquer chamada", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste({
      envelope: envelopeSemAsChaves,
      payload: {
        document: {
          // A forma dos 2 casos medidos: o `sign` está nos eventos, e a linha do quadro ficou atrás.
          events: [
            {
              data: { signer: { email: "maura@exemplo.test", key: ID_MAURA } },
              name: "sign",
              occurred_at: "2026-09-23T15:37:41.002Z",
            },
          ],
          key: "doc-40",
          signers: [{ email: "maura@exemplo.test", key: ID_MAURA, name: "Maura Maria Passos" }],
        },
      },
    });
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(sb, { envelopeId: "env-40", signerId: ID_MAURA }, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toBe(RECUSA_DE_CONVITE_DE_QUEM_JA_ASSINOU);
    expect(chamadas).toEqual([]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  /**
   * ⚠️ QUEM CASA A LINHA DO QUADRO É O E-MAIL DO PAYLOAD, E NUNCA NADA QUE O PEDIDO TRAGA.
   *
   * Havia um `|| pedido.email` de última saída, e ele era o ÚNICO ponto em que o navegador
   * influenciava a trava de quem já assinou: no payload "pobre" (`document.signers` VAZIO, as pessoas
   * saindo dos eventos — medido em 01/10/2026, 28 dos 283 payloads conferidos têm `signers` vazio) a
   * `signer.key` pode chegar sem e-mail, e aí o endereço do navegador decidia QUAL linha do quadro era
   * auditada. Mandando a key de quem JÁ ASSINOU com o e-mail de um pendente, a trava não disparava e o
   * convite saía. O campo foi removido do pedido inteiro (rota, serviço e as duas telas): sem e-mail no
   * payload não se sabe de quem é a linha, e a resposta é recusa.
   *
   * Medido no mesmo dia: das 104 `signer.key` dos envelopes sem chave congelada, ZERO chegam sem
   * e-mail — isto não tira nada dos 68 pendentes.
   */
  it("key no payload SEM e-mail não casa linha nenhuma: recusa, sem chamada", async () => {
    const { sb } = bancoDeTeste({
      envelope: envelopeSemAsChaves,
      payload: {
        document: {
          // O formato "mais enxuto": a key vem no evento, sem endereço nenhum.
          events: [{ data: { signer: { key: ID_NIVEA } } }],
          key: "doc-40",
          signers: [],
        },
      },
    });
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(sb, { envelopeId: "env-40", signerId: ID_NIVEA }, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toBe(RECUSA_DE_QUEM_NAO_ESTA_NO_QUADRO);
    expect(chamadas).toEqual([]);
  });

  // ⚠️ E O PEDIDO NÃO TEM MAIS CAMPO DE E-MAIL: quem diz de quem é a linha é o payload deste
  // envelope, não o navegador.
  it("sem o e-mail no pedido, o payload do envelope diz de quem é a linha", async () => {
    const { sb } = banco();
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(sb, { envelopeId: "env-40", signerId: ID_HUBER }, porta);

    expect(r.ok).toBe(true);
    expect(chamadas.map((c) => c.caminho)).toEqual([
      `/envelopes/env-40/signers/${ID_HUBER}/notifications`,
    ]);
  });

  // ⚠️ QUEM JÁ ASSINOU NÃO RECEBE CONVITE DE NOVO. São 17 assinaturas nas 87 linhas dos 18
  // envelopes, 3 delas num contrato da Têmis de 11 signatários: um convite de documento já assinado
  // é o tipo de e-mail que gera ligação para o atendimento. A guarda é do SERVIDOR porque o pedido
  // chega por HTTP, com um id que está visível no payload.
  it("quem já assinou é recusado com 409, antes de qualquer chamada", async () => {
    const { chamadasDaFuncao, sb } = banco();
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(
      sb,
      { envelopeId: "env-40", signerId: ID_NIVEA },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toBe(RECUSA_DE_CONVITE_DE_QUEM_JA_ASSINOU);
    expect(chamadas).toEqual([]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  // ⚠️ E QUEM RECUSOU O DOCUMENTO TAMBÉM, NO MESMO NÍVEL. A função da 0195 carrega `assinado_em` e
  // `recusado_em` lado a lado (parte (a) da `0195_o_contrato_mora_no_panteon.sql`): tratar só a
  // primeira faria o recusado passar por pendente e receber convite de um documento que ele negou.
  // Medido em 01/10/2026: 0 das 87 linhas têm `recusado_em` hoje — a marca existe no modelo e a
  // trava não espera o primeiro caso.
  it("quem RECUSOU o documento é recusado com 409, antes de qualquer chamada", async () => {
    const { chamadasDaFuncao, sb } = banco();
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(
      sb,
      { envelopeId: "env-40", signerId: ID_RECUSOU },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toBe(RECUSA_DE_CONVITE_DE_QUEM_RECUSOU);
    expect(chamadas).toEqual([]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  // ⚠️ O NAVEGADOR NÃO ESCOLHE QUEM RECEBE CONVITE DENTRO DE UM ENVELOPE PAGO, e esta é a guarda que
  // o caminho novo exige. O id tem de constar no quadro congelado OU no payload de webhook DESTE
  // envelope; um id de outro contrato da conta de produção é recusado sem nenhuma chamada.
  it("id que não está nem no quadro nem no payload deste envelope é recusado, sem chamada", async () => {
    const { chamadasDaFuncao, sb } = banco();
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(
      sb,
      { envelopeId: "env-40", signerId: "99999999-9999-4999-8999-999999999999" },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toBe(RECUSA_DE_ID_QUE_NAO_E_DESTE_ENVELOPE);
    expect(chamadas).toEqual([]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  // ⚠️ ENVELOPE EM ESTADO TERMINAL NÃO RECEBE CONVITE, e isto não é hipótese: medido em 01/10/2026
  // (só SELECT), 3 dos 21 envelopes da Clicksign sem `chave` estão `cancelado`, e eles entrariam no
  // caminho novo porque nada aqui olhava o estado. Convite de envelope cancelado é um link morto na
  // caixa de entrada do cliente.
  it("envelope cancelado é recusado antes de notificar", async () => {
    const { chamadasDaFuncao, sb } = banco({ estado: "cancelado" });
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(
      sb,
      { envelopeId: "env-40", signerId: ID_MAURA },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("cancelado");
    expect(chamadas).toEqual([]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  it("envelope assinado também é recusado antes de notificar", async () => {
    const { sb } = banco({ estado: "assinado" });
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(
      sb,
      { envelopeId: "env-40", signerId: ID_MAURA },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(chamadas).toEqual([]);
  });

  // ⚠️ E-MAIL REPETIDO NO NOSSO QUADRO NÃO IDENTIFICA NINGUÉM: escolher a primeira linha mandaria o
  // convite sem saber se aquela pessoa já assinou. É a mesma régua que a 0195 usa para casar o quadro
  // por e-mail (só quando ele é único). Medido em 01/10/2026 (só SELECT): nenhum dos 29 envelopes da
  // Clicksign tem e-mail repetido hoje, mas 23 dos 2.231 da D4Sign têm — a forma existe em contrato
  // real.
  it("e-mail repetido no quadro recusa, sem chamada", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste({
      envelope: {
        ...envelopeSemAsChaves,
        signatarios: [
          { assinado_em: "2026-09-30T12:00:00.000Z", email: "casal@x.test", nome: "Um", ordem: 1, papel: "comprador" },
          { email: "casal@x.test", nome: "Dois", ordem: 1, papel: "conjuge" },
        ],
      },
      payload: {
        document: {
          events: [],
          key: "doc-40",
          signers: [
            { email: "casal@x.test", key: ID_MAURA, name: "Um" },
            { email: "casal@x.test", key: ID_HUBER, name: "Dois" },
          ],
        },
      },
    });
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(
      sb,
      { envelopeId: "env-40", signerId: ID_HUBER },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toBe(RECUSA_DE_EMAIL_REPETIDO_NO_QUADRO);
    expect(chamadas).toEqual([]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  // ⚠️ E-MAIL NUNCA É ID, E ESSE É O 422 DE 24/09/2026 QUE SOBRA. Quem só existe na lista congelada
  // não tem linha no payload, e `juntarComOsCongelados` põe o próprio e-mail na `chave` da tela. A
  // recusa vem antes da chamada que cobra, com a frase que manda ao painel da Clicksign.
  it("e-mail no lugar do id é recusado ANTES de qualquer chamada", async () => {
    const { chamadasDaFuncao, sb } = banco();
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(
      sb,
      { envelopeId: "env-40", signerId: "so-na-lista@exemplo.test" },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.erro).toContain("painel da Clicksign");
    expect(chamadas).toEqual([]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  // ⚠️ `tmp:` E `c2x:` TAMBÉM NÃO SÃO ID. `abrirRegistro` grava `tmp:<posição>` em todo mundo antes
  // do carimbo do envio (`lib/assinatura/envio-db.ts`), e `c2x:` é do espelho da D4Sign.
  it("chave provisória e chave do espelho não viram convite", async () => {
    const { sb } = banco();
    const { chamadas, porta } = portaDeTeste();

    for (const chave of ["tmp:2", "c2x:4711"]) {
      const r = await reenviarConvite(sb, { envelopeId: "env-40", signerId: chave }, porta);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.status).toBe(400);
    }
    expect(chamadas).toEqual([]);
  });

  // ⚠️ SEM PAYLOAD NENHUM NÃO SE AFIRMA NADA. O envelope que nunca recebeu webhook não tem de onde
  // provar que o id é dele; notificar ali seria deixar o navegador escolher a quem o e-mail vai.
  it("envelope sem webhook nenhum recusa o id que não está no quadro", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeSemAsChaves });
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(
      sb,
      { envelopeId: "env-40", signerId: ID_MAURA },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toBe(RECUSA_DE_ID_QUE_NAO_E_DESTE_ENVELOPE);
    expect(chamadas).toEqual([]);
  });

  // ⚠️ A CHAVE CONGELADA DISPENSA O PAYLOAD. Nos 8 envelopes que têm o id de todo mundo a conferência
  // acaba no nosso próprio quadro, e nenhuma leitura de evento é feita.
  it("chave congelada no quadro não precisa do payload do webhook", async () => {
    const { sb } = bancoDeTeste({
      envelope: {
        ...envelopeSemAsChaves,
        signatarios: [
          { chave: ID_MAURA, email: "maura@exemplo.test", nome: "Maura Maria Passos", ordem: 2, papel: "comprador" },
        ],
      },
    });
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(
      sb,
      { envelopeId: "env-40", signerId: ID_MAURA },
      porta,
    );

    expect(r.ok).toBe(true);
    expect(chamadas.map((c) => c.caminho)).toEqual([
      `/envelopes/env-40/signers/${ID_MAURA}/notifications`,
    ]);
  });

  // ⚠️ ID DO PAYLOAD CUJO E-MAIL NÃO ESTÁ NO NOSSO QUADRO É RECUSA. Sem a linha não se sabe se a
  // pessoa já assinou, e a marca de assinatura mora no quadro — é a fonte única da casa.
  it("pessoa que está só no payload, e não no nosso quadro, é recusada", async () => {
    const { sb } = bancoDeTeste({
      envelope: {
        ...envelopeSemAsChaves,
        signatarios: [
          { email: "maura@exemplo.test", nome: "Maura Maria Passos", ordem: 2, papel: "comprador" },
        ],
      },
      payload: payloadDoWebhook,
    });
    const { chamadas, porta } = portaDeTeste();

    const r = await reenviarConvite(sb, { envelopeId: "env-40", signerId: ID_HUBER }, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(chamadas).toEqual([]);
  });
});

// ── A TROCA DE E-MAIL NOS ENVELOPES SEM ID ──────────────────────────────────
//
// ⚠️ É AQUI QUE A LINHA DE QUEM ASSINOU E A CHAVE QUE NÃO É ID DA CLICKSIGN SE CRUZAM. Medido em
// produção em 01/10/2026 (só SELECT): nos 18 envelopes vivos sem id são 87 linhas, NENHUMA com o
// campo `chave`, e 17 com `assinado_em` — 3 delas num contrato da Têmis de 11 signatários.
describe("a troca de e-mail não encosta em quem assinou nem manda chave inventada", () => {
  const comQuemAssinou = {
    atualizado_em: "2026-09-29T16:06:00.000Z",
    envelope_id: "env-50",
    id: "reg-50",
    proposta_id: null,
    provedor_documento_id: "doc-50",
    signatarios: [
      {
        assinado_em: "2026-09-30T12:00:00.000Z",
        chave: "sig-nivea",
        email: "nivea@careli.test",
        nome: "Nivea Careli",
        ordem: 1,
        papel: "careli",
      },
      { chave: "tmp:2", email: "maura@exemplo.test", nome: "Maura Maria Passos", ordem: 2, papel: "comprador" },
    ],
  };

  // ⚠️ A TRAVA É NOSSA, E NÃO O 403 DO PROVEDOR. Nem `podeMexer` na tela nem `conferirEmailDaTroca`
  // olham assinatura: até aqui o único "não" vinha da Clicksign, e ele só vem quando o id mandado é
  // o da pessoa certa. Quando não é, vem 404, e o 404 SEGUE EM FRENTE de propósito.
  it("quem já assinou não tem e-mail trocado, e nada é chamado", async () => {
    const { atualizacoes, sb } = bancoDeTeste({ envelope: comQuemAssinou });
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(
      sb,
      { email: "outro@exemplo.test", envelopeId: "env-50", signerId: "sig-nivea" },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toBe(RECUSA_DE_TROCA_DE_QUEM_JA_ASSINOU);
    expect(r.removido).toBe(false);
    expect(chamadas).toEqual([]);
    expect(atualizacoes).toEqual([]);
  });

  // ⚠️ `tmp:` NO DELETE É O ESTRAGO CALADO: a Clicksign devolve 404 (não 403), o 404 segue em frente,
  // o signatário antigo FICA no envelope e um duplicado nasce com o e-mail novo — e a tela escreve
  // "a Clicksign não achou o signatário antigo", que é verdade sobre uma chave que nunca foi dele.
  it("chave provisória não vai para o DELETE: a troca recusa antes de qualquer chamada", async () => {
    const { atualizacoes, sb } = bancoDeTeste({ envelope: comQuemAssinou });
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(
      sb,
      { email: "outro@exemplo.test", envelopeId: "env-50", signerId: "tmp:2" },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe(RECUSA_DE_CHAVE_QUE_NAO_E_DA_CLICKSIGN);
    expect(r.removido).toBe(false);
    expect(chamadas).toEqual([]);
    expect(atualizacoes).toEqual([]);
  });

  /**
   * ⚠️ A TROCA NÃO CUNHA `tmp:<posição>` NA LINHA DE QUEM NÃO TEM `chave`, E ISSO MOVERIA ASSINATURA.
   *
   * Medido em produção em 01/10/2026 (só SELECT): ZERO das 87 linhas dos 18 envelopes vivos sem id
   * têm o campo `chave`. A parte (a) da `0195_o_contrato_mora_no_panteon.sql` (perto da 251) casa a
   * linha antiga PELA CHAVE antes de casar pelo e-mail: gravado um `tmp:1` POSICIONAL na linha de
   * quem assinou, uma reescrita seguinte em que a ordem do quadro mudou põe esse mesmo `tmp:1` na
   * linha de OUTRA pessoa — e a função leva o `assinado_em` junto, para quem nunca assinou. Sem o
   * campo, a 0195 reencontra a linha pelo e-mail ÚNICO, que é o caminho que o banco já usa hoje nas
   * 104 de 159 linhas sem `chave`.
   */
  it("quem não tem chave sai do quadro gravado SEM o campo chave", async () => {
    const semChaveNenhuma = {
      atualizado_em: "2026-09-29T16:06:00.000Z",
      envelope_id: "env-51",
      id: "reg-51",
      proposta_id: null,
      provedor_documento_id: "doc-51",
      signatarios: [
        {
          assinado_em: "2026-09-30T12:00:00.000Z",
          email: "nivea@careli.test",
          nome: "Nivea Careli",
          ordem: 1,
          papel: "careli",
        },
        { chave: "sig-maura", email: "maura@exemplo.test", nome: "Maura Maria Passos", ordem: 2, papel: "comprador" },
      ],
    };
    const { chamadasDaFuncao, sb } = bancoDeTeste({ envelope: semChaveNenhuma });
    const { porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(
      sb,
      { email: "nova@exemplo.test", envelopeId: "env-51", signerId: "sig-maura" },
      porta,
    );

    expect(r.ok).toBe(true);
    expect(chamadasDaFuncao[0]?.p_quadro).toEqual([
      // A linha de quem assinou sai EXATAMENTE como entrou: sem o campo `chave`.
      { email: "nivea@careli.test", nome: "Nivea Careli", ordem: 1, papel: "careli" },
      { chave: "sig-novo", email: "nova@exemplo.test", nome: "Maura Maria Passos", ordem: 2, papel: "comprador" },
    ]);
  });

  /**
   * ⚠️ ENVELOPE ENCERRADO NÃO RECEBE TROCA, E ESTA ERA A OUTRA PORTA DO MESMO DANO.
   *
   * A trava de estado nasceu só no reenvio, e a troca é o gesto IRREVERSÍVEL que TAMBÉM NOTIFICA (o
   * passo 4 chama `notificarSignatario`): sem esta guarda, o convite de um envelope morto continuava
   * alcançável por aqui, com uma remoção de signatário por cima. Medido em produção em 01/10/2026 (só
   * SELECT, projeto bxgukywoxgivlrhjkwjx): dos 29 envelopes da Clicksign, 4 estão `cancelado` e 3
   * deles não têm nenhuma `chave` no quadro — e nesses 3 a tela da Têmis habilitava "Corrigir o
   * e-mail", porque `podeTrocarEmail` só olhava o "@" e a chave que o diário entrega é o uuid do
   * webhook.
   */
  it("envelope cancelado não tem troca de e-mail: recusa antes da remoção", async () => {
    const { atualizacoes, sb } = bancoDeTeste({
      envelope: { ...envelopeGravado, estado: "cancelado" },
    });
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("foi cancelado");
    expect(r.removido).toBe(false);
    expect(chamadas).toEqual([]);
    expect(atualizacoes).toEqual([]);
  });

  it("envelope assinado também não tem troca de e-mail", async () => {
    const { sb } = bancoDeTeste({ envelope: { ...envelopeGravado, estado: "assinado" } });
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(chamadas).toEqual([]);
  });

  /**
   * ⚠️ E-MAIL REPETIDO NO QUADRO RECUSA DIZENDO O MOTIVO CERTO — E A REMOÇÃO NUNCA CHEGOU A ACONTECER.
   *
   * MEDIDO NO PRÓPRIO CÓDIGO, desfazendo a guarda e rodando este teste: o desfecho ANTES já era 409 e
   * ZERO chamada, porque `conferirEmailDaTroca` projeta o quadro com o e-mail novo em TODA linha cujo
   * endereço é o antigo — as duas viram o mesmo endereço, e `conferirSignatarios` recusa. Ou seja: a
   * remoção de quem assinou NÃO era alcançável por aqui. O que estava errado era a FRASE, que
   * culpava o endereço NOVO (*"Um do Casal e Dois do Casal usam o MESMO e-mail (corrigido@x.test)...
   * cadastre um e-mail próprio para cada um"*) quando a causa é o endereço ANTIGO estar repetido — e o
   * operador ia corrigir o campo errado.
   *
   * ⚠️ E SOBRAVAM DUAS ARMADILHAS LATENTES, que esta recusa antecipada desarma: `acharOSignatario`
   * escolhia a PRIMEIRA linha com aquele endereço (e é dela que a trava de `assinadoEm` lê a marca,
   * então a key de quem assinou casava na linha pendente), e `quadroComATroca` gravava a mesma
   * `chaveNova` e o mesmo e-mail novo em TODAS as linhas que casassem. Qualquer reordenação futura
   * dessas três conferências transformaria as duas em remoção de quem assinou.
   *
   * Medido em produção em 01/10/2026 (só SELECT): nenhum dos 29 envelopes da Clicksign tem e-mail
   * repetido hoje, mas 23 dos 2.231 da D4Sign têm — a forma existe em contrato real.
   */
  it("e-mail repetido no quadro recusa a troca antes da remoção, culpando o endereço CERTO", async () => {
    const CHAVE_DA_SEGUNDA = "77777777-7777-4777-8777-777777777777";
    const { atualizacoes, sb } = bancoDeTeste({
      envelope: {
        atualizado_em: "2026-09-29T16:06:00.000Z",
        envelope_id: "env-52",
        id: "reg-52",
        proposta_id: "prop-52",
        provedor_documento_id: "doc-52",
        signatarios: [
          // A PRIMEIRA está pendente, e era ela que o `find` devolvia.
          { email: "casal@x.test", nome: "Um do Casal", ordem: 1, papel: "comprador" },
          {
            assinado_em: "2026-09-30T12:00:00.000Z",
            email: "casal@x.test",
            nome: "Dois do Casal",
            ordem: 1,
            papel: "conjuge",
          },
        ],
      },
      payload: {
        document: {
          events: [],
          key: "doc-52",
          signers: [
            { email: "casal@x.test", key: "66666666-6666-4666-8666-666666666666", name: "Um do Casal" },
            { email: "casal@x.test", key: CHAVE_DA_SEGUNDA, name: "Dois do Casal" },
          ],
        },
      },
    });
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarEmailDoSignatario(
      sb,
      { email: "corrigido@x.test", envelopeId: "env-52", signerId: CHAVE_DA_SEGUNDA },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toBe(RECUSA_DE_EMAIL_REPETIDO_NO_QUADRO);
    expect(r.removido).toBe(false);
    expect(chamadas).toEqual([]);
    expect(atualizacoes).toEqual([]);
  });
});

// ── O LINK DE ASSINATURA PARA O ATENDIMENTO (02/10/2026) ────────────────────
//
// ⚠️ É LEITURA DO NOSSO BANCO, E NADA AQUI FALA COM A CLICKSIGN. O link vem do aviso conferido mais
// recente deste envelope; o id do navegador tem de ser de uma pessoa DESTE envelope, e quem já
// assinou não recebe link.
describe("o link de assinatura de uma pessoa", () => {
  const LINK = "https://app.clicksign.com/notarial/widget/signatures/aaaa-1111/redirect";
  const comLink = (extra: Array<Record<string, unknown>> = []) => ({
    document: {
      events: [
        ...extra,
        {
          data: { signers: [{ email: "conjug@x.com", key: "sig-conjuge", name: "Maria Souza Lima", url: LINK }] },
          name: "add_signer",
          occurred_at: "2026-09-28T09:00:00-03:00",
        },
      ],
      key: "doc-30",
      signers: [{ email: "conjug@x.com", key: "sig-conjuge", name: "Maria Souza Lima" }],
    },
  });

  it("acha o link de quem ainda não assinou", async () => {
    const { atualizacoes, chamadasDaFuncao, sb } = bancoDeTeste({ envelope: envelopeGravado, payload: comLink() });

    const r = await linkDeAssinatura(sb, { envelopeId: "env-30", signerId: "sig-conjuge" });

    expect(r).toEqual({ link: LINK, ok: true });
    expect(atualizacoes).toEqual([]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  it("quem já assinou pelo payload não recebe link, mesmo com o quadro atrasado", async () => {
    const assinou = {
      data: { signer: { email: "conjug@x.com", key: "sig-conjuge", name: "Maria Souza Lima" } },
      name: "sign",
      occurred_at: "2026-09-29T10:00:00-03:00",
    };
    const { sb } = bancoDeTeste({ envelope: envelopeGravado, payload: comLink([assinou]) });

    const r = await linkDeAssinatura(sb, { envelopeId: "env-30", signerId: "sig-conjuge" });

    expect(r).toEqual({ erro: RECUSA_DE_LINK_DE_QUEM_JA_ASSINOU, ok: false, status: 409 });
  });

  it("quem já assinou pelo quadro também não", async () => {
    const assinado = {
      ...envelopeGravado,
      signatarios: [envelopeGravado.signatarios[0], { ...envelopeGravado.signatarios[1], assinado_em: "2026-09-29T10:00:00-03:00" }],
    };
    const { sb } = bancoDeTeste({ envelope: assinado, payload: comLink() });

    const r = await linkDeAssinatura(sb, { envelopeId: "env-30", signerId: "sig-conjuge" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toBe(RECUSA_DE_LINK_DE_QUEM_JA_ASSINOU);
  });

  it("o link que ainda não chegou diz o que fazer, e não é erro de sistema", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado, payload: { document: { events: [] } } });

    const r = await linkDeAssinatura(sb, { envelopeId: "env-30", signerId: "sig-conjuge" });

    expect(r).toEqual({ erro: AVISO_DE_LINK_QUE_AINDA_NAO_CHEGOU, ok: false, status: 404 });
  });

  it("id que não é de ninguém deste envelope é recusado", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado, payload: comLink() });

    const r = await linkDeAssinatura(sb, { envelopeId: "env-30", signerId: "sig-de-outro-envelope" });

    expect(r).toEqual({ erro: RECUSA_DE_ID_QUE_NAO_E_DESTE_ENVELOPE, ok: false, status: 409 });
  });

  it("e-mail no lugar do id é recusado antes de qualquer leitura de payload", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado, payload: comLink() });

    const r = await linkDeAssinatura(sb, { envelopeId: "env-30", signerId: "conjug@x.com" });

    expect(r).toEqual({ erro: RECUSA_DE_LINK_SEM_ID, ok: false, status: 400 });
  });

  it("envelope cancelado não tem link que sirva", async () => {
    const { sb } = bancoDeTeste({ envelope: { ...envelopeGravado, estado: "cancelado" }, payload: comLink() });

    const r = await linkDeAssinatura(sb, { envelopeId: "env-30", signerId: "sig-conjuge" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
  });
});

// ── A TROCA QUE CAI NO MEIO (revisão de 02/10/2026) ─────────────────────────
//
// ⚠️ TIMEOUT E 5xx NÃO DIZEM SE A CLICKSIGN FEZ O QUE SE PEDIU. Desfazer às cegas deixava a pessoa
// fora do envelope; criar de novo às cegas deixava dois cadastros com o mesmo e-mail.
describe("a troca que cai no meio", () => {
  /** Uma porta em que cada padrão responde, em sequência, o que está na fila dele. */
  function portaEmSequencia(filas: Record<string, unknown[]>) {
    const chamadas: { caminho: string; metodo: string }[] = [];
    const porta = async <T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> => {
      const metodo = opcoes.metodo ?? "GET";
      chamadas.push({ caminho, metodo });
      for (const [padrao, fila] of Object.entries(filas)) {
        if (`${metodo} ${caminho}`.includes(padrao) && fila.length > 0) {
          const resposta = fila.length > 1 ? fila.shift() : fila[0];
          if (resposta instanceof Error) throw resposta;
          return resposta as T;
        }
      }
      if (metodo === "GET" && caminho.includes("/signers?")) return DEGRAUS_DO_ENVELOPE_GRAVADO as T;
      if (caminho.endsWith("/signers")) return { data: { id: "sig-novo" } } as T;
      return {} as T;
    };
    return { chamadas, porta };
  }
  const falha = (status: number) =>
    new FalhaDaClicksign(`Clicksign devolveu ${status}.`, { detalhes: [], requestId: null, status });
  const comEmail = (itens: Array<[string, number, string]>) => ({
    data: itens.map(([id, group, email]) => ({ attributes: { email, group }, id, type: "signers" })),
  });

  it("remoção que expira e o antigo SAIU: o novo fica, e a troca termina", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaEmSequencia({
      [LER_DEGRAUS]: [DEGRAUS_DO_ENVELOPE_GRAVADO, listaDeDegraus({ "sig-novo": 2, "sig-titular": 1 })],
      "DELETE /envelopes/env-30/signers/sig-conjuge": [falha(504)],
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.aviso).toContain("demorou a responder");
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).not.toContain("DELETE /envelopes/env-30/signers/sig-novo");
    expect(chamadasDaFuncao).toHaveLength(1);
  });

  it("remoção que expira e o antigo FICOU: o novo é desfeito", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaEmSequencia({
      [LER_DEGRAUS]: [DEGRAUS_DO_ENVELOPE_GRAVADO, listaDeDegraus({ "sig-conjuge": 1, "sig-novo": 2, "sig-titular": 1 })],
      "DELETE /envelopes/env-30/signers/sig-conjuge": [falha(503)],
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.removido).toBe(false);
    expect(chamadas.at(-1)).toEqual({ caminho: "/envelopes/env-30/signers/sig-novo", metodo: "DELETE" });
  });

  it("remoção que expira e nem a releitura responde: o novo FICA, e a frase manda conferir antes de tentar", async () => {
    const { atualizacoes, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaEmSequencia({
      [LER_DEGRAUS]: [DEGRAUS_DO_ENVELOPE_GRAVADO, falha(503)],
      "DELETE /envelopes/env-30/signers/sig-conjuge": [falha(0)],
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.erro).toContain("Não tente a troca de novo antes disso");
    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).not.toContain("DELETE /envelopes/env-30/signers/sig-novo");
    expect(atualizacoes).toEqual([]);
  });

  it("o e-mail novo já está no envelope ao lado do antigo: duas linhas, nada é mexido", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaEmSequencia({
      [LER_DEGRAUS]: [
        comEmail([
          ["sig-titular", 1, "titular@x.com"],
          ["sig-conjuge", 1, "conjug@x.com"],
          ["sig-fantasma", 2, "Maria@X.com"],
        ]),
      ],
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("já tem um cadastro com o e-mail maria@x.com");
    expect(chamadas).toHaveLength(1);
    expect(chamadasDaFuncao).toEqual([]);
  });

  it("o antigo já saiu e o novo já está lá: a troca é adotada, sem cadastrar nem remover", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { chamadas, porta } = portaEmSequencia({
      [LER_DEGRAUS]: [
        comEmail([
          ["sig-titular", 1, "titular@x.com"],
          ["sig-de-antes", 2, "maria@x.com"],
        ]),
      ],
    });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signerId).toBe("sig-de-antes");
    expect(r.aviso).toContain("já tinha sido feita na Clicksign");
    expect(chamadas).toHaveLength(1);
    const quadro = chamadasDaFuncao[0]?.p_quadro as Array<{ chave: string; ordem: number }>;
    expect(quadro.find((p) => p.chave === "sig-de-antes")?.ordem).toBe(2);
  });

  it("cadastro que não responde avisa que pode ter entrado, e a próxima tentativa confere", async () => {
    const { sb } = bancoDeTeste({ envelope: envelopeGravado });
    const { porta } = portaEmSequencia({ "POST /envelopes/env-30/signers": [falha(0)] });

    const r = await trocarEmailDoSignatario(sb, pedidoDaTroca, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("pode ter entrado mesmo assim");
  });
});

describe("o link segue a régua do reenvio", () => {
  const LINK = "https://app.clicksign.com/notarial/widget/signatures/bbbb-2222/redirect";
  const payloadCom = (pessoa: Record<string, unknown>) => ({
    document: {
      events: [{ data: { signers: [{ ...pessoa, url: LINK }] }, name: "add_signer", occurred_at: "2026-09-28T09:00:00-03:00" }],
      signers: [pessoa],
    },
  });
  const semChave = {
    ...envelopeGravado,
    signatarios: envelopeGravado.signatarios.map((s) => ({ ...s, chave: undefined })),
  };

  it("quem só existe no payload (fora do quadro) não recebe link", async () => {
    const { sb } = bancoDeTeste({
      envelope: semChave,
      payload: payloadCom({ email: "de-fora@x.com", key: "sig-de-fora", name: "De Fora" }),
    });

    const r = await linkDeAssinatura(sb, { envelopeId: "env-30", signerId: "sig-de-fora" });

    expect(r).toEqual({ erro: RECUSA_DE_QUEM_NAO_ESTA_NO_QUADRO, ok: false, status: 409 });
  });

  it("quadro sem chave: a linha é achada pelo e-mail do payload, e quem já assinou ali não recebe link", async () => {
    const assinado = {
      ...semChave,
      signatarios: [semChave.signatarios[0], { ...semChave.signatarios[1], assinado_em: "2026-09-29T10:00:00-03:00" }],
    };
    const { sb } = bancoDeTeste({
      envelope: assinado,
      payload: payloadCom({ email: "conjug@x.com", key: "sig-conjuge", name: "Maria Souza Lima" }),
    });

    const r = await linkDeAssinatura(sb, { envelopeId: "env-30", signerId: "sig-conjuge" });

    expect(r).toEqual({ erro: RECUSA_DE_LINK_DE_QUEM_JA_ASSINOU, ok: false, status: 409 });
  });

  it("quem recusou também não", async () => {
    const recusou = {
      ...envelopeGravado,
      signatarios: [envelopeGravado.signatarios[0], { ...envelopeGravado.signatarios[1], recusado_em: "2026-09-29T10:00:00-03:00" }],
    };
    const { sb } = bancoDeTeste({
      envelope: recusou,
      payload: payloadCom({ email: "conjug@x.com", key: "sig-conjuge", name: "Maria Souza Lima" }),
    });

    const r = await linkDeAssinatura(sb, { envelopeId: "env-30", signerId: "sig-conjuge" });

    expect(r).toEqual({ erro: RECUSA_DE_CONVITE_DE_QUEM_RECUSOU, ok: false, status: 409 });
  });
});
