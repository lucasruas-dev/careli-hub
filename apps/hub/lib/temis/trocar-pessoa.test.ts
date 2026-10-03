import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FalhaDaClicksign, type Opcoes } from "@/lib/assinatura/clicksign/cliente";
import { RECUSA_DE_TROCA_DE_PARTE_DO_CONTRATO } from "@/lib/assinatura/recusa-de-reenvio";

import {
  conferirNomeDeQuemAssina,
  conferirPessoaDaTroca,
  RECUSA_DE_TROCA_DE_PESSOA_QUE_JA_ASSINOU,
  type SignatarioCongelado,
  semCpfNoTexto,
  trocarPessoaDoSignatario,
} from "./trocar-signatario";

// TROCAR QUEM ASSINA, COM O CONTRATO JÁ ENVIADO (03/10/2026).
//
// Lucas, 03/10/2026: *"é basicamente eu tirar uma pessoa e colocar outra para assinar, não precisa
// mudar em nada no cadastro"*. O caso típico é a testemunha ou a vendedora que não pode assinar.
//
// ⚠️ O QUE ESTES TESTES PRENDEM:
//   - comprador e cônjuge não se trocam (são as partes do contrato);
//   - nome com sobrenome e sem número, e-mail que não é de outro, CPF com os dígitos certos;
//   - o nível da autenticação não cai: quem sai assinava com CPF, quem entra também;
//   - o mesmo caminho da troca de e-mail: cria antes de remover, desfaz no 403, relê na dúvida;
//   - o quadro recebe o nome novo e a posição do fim da fila, e NUNCA o CPF;
//   - nenhum CPF em log, em resposta ou no quadro.
//
// ⚠️ NADA AQUI TOCA A CLICKSIGN: a porta HTTP é um duplo, como em `trocar-signatario.test.ts`.

const CPF = "529.982.247-25";
const DIGITOS_DO_CPF = "52998224725";

const pessoa = (patch: Partial<SignatarioCongelado> = {}): SignatarioCongelado => ({
  assinadoEm: null,
  chave: "sig-titular",
  email: "titular@x.com",
  nome: "Henrique Sales do Vale",
  ordem: 1,
  papel: "comprador",
  recusadoEm: null,
  ...patch,
});

const titular = pessoa();
const conjuge = pessoa({ chave: "sig-conjuge", email: "conjuge@x.com", nome: "Maria Souza Lima", papel: "conjuge" });
const testemunha = pessoa({
  chave: "sig-test",
  email: "rafael@x.com",
  nome: "Rafael Gomes Pinto",
  ordem: 2,
  papel: "testemunha",
});
const vendedora = pessoa({ chave: "sig-vend", email: "rita@x.com", nome: "Rita Alves Prado", ordem: 3, papel: "vendedora" });
const TODOS = [titular, conjuge, testemunha, vendedora];

describe("o nome de quem vai assinar", () => {
  it("pede nome e sobrenome, sem números, e apara os espaços", () => {
    expect(conferirNomeDeQuemAssina("  Ana   Paula  Dias ")).toEqual({ nome: "Ana Paula Dias", ok: true });
    expect(conferirNomeDeQuemAssina("Ana").ok).toBe(false);
    expect(conferirNomeDeQuemAssina("").ok).toBe(false);
    expect(conferirNomeDeQuemAssina("Ana Paula 2").ok).toBe(false);
    expect(conferirNomeDeQuemAssina("Ana 3Dias").ok).toBe(false);
  });
});

describe("o que se confere na pessoa nova, antes de qualquer chamada", () => {
  const conferir = (patch: Partial<Parameters<typeof conferirPessoaDaTroca>[0]> = {}) =>
    conferirPessoaDaTroca({
      atual: testemunha,
      cpf: "",
      email: "ana@x.com",
      nome: "Ana Paula Dias",
      todos: TODOS,
      ...patch,
    });

  // ⚠️ DECISÃO PADRÃO DO PEDIDO (03/10/2026), QUE O LUCAS PODE MUDAR: comprador e cônjuge estão no
  // texto do contrato, e trocá-los é contrato novo.
  it("comprador e cônjuge são recusados com a frase das partes do contrato", () => {
    for (const atual of [titular, conjuge]) {
      const r = conferir({ atual });
      expect(r).toEqual({ erro: RECUSA_DE_TROCA_DE_PARTE_DO_CONTRATO, ok: false, status: 409 });
    }
  });

  it("vendedora e testemunha passam", () => {
    expect(conferir({ atual: vendedora }).ok).toBe(true);
    expect(conferir().ok).toBe(true);
  });

  it("nome sem sobrenome e nome com número são recusados", () => {
    for (const nome of ["Ana", "Ana Paula 2"]) {
      const r = conferir({ nome });
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.status).toBe(400);
      expect(r.erro).toContain("Nada foi mexido");
    }
  });

  it("e-mail que não é e-mail é recusado", () => {
    const r = conferir({ email: "ana@" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });

  it("e-mail de outro signatário do envelope é recusado, com 409", () => {
    const r = conferir({ email: "RITA@x.com" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("Rita Alves Prado");
    expect(r.erro).toContain("Nada foi mexido");
  });

  // ⚠️ O E-MAIL DE QUEM SAI PODE SER O DE QUEM ENTRA: é o coordenador que assina com a caixa da
  // empresa (`contrato@fgurgel.com.br`), e quem entra no lugar costuma usar a mesma.
  it("o mesmo e-mail de quem sai, com outra pessoa, passa", () => {
    const r = conferir({ email: "rafael@x.com" });
    expect(r.ok).toBe(true);
  });

  it("a mesma pessoa com o mesmo e-mail não é troca nenhuma", () => {
    const r = conferir({ email: "RAFAEL@x.com", nome: " rafael  gomes pinto " });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.erro).toContain("reenviar o convite");
  });

  it("CPF com os dígitos verificadores errados é recusado, e a frase não repete o número", () => {
    const r = conferir({ cpf: "529.982.247-26" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.erro).not.toContain("529");
    expect(r.erro).toContain("CPF");
  });

  it("CPF válido volta só em dígitos; em branco volta nulo", () => {
    const com = conferir({ cpf: CPF });
    expect(com).toEqual({ cpf: DIGITOS_DO_CPF, email: "ana@x.com", nome: "Ana Paula Dias", ok: true });
    const sem = conferir({ cpf: "  " });
    expect(sem.ok && sem.cpf).toBeNull();
  });
});

describe("a rede da resposta: nada com forma de CPF sobe", () => {
  it("tira o CPF com e sem máscara, e deixa o id do envelope", () => {
    const envelope = "0384000d-5299-4dcb-abeb-075123456789";
    expect(semCpfNoTexto(`documentation ${CPF} inválido`)).toBe("documentation [CPF] inválido");
    expect(semCpfNoTexto(`doc ${DIGITOS_DO_CPF}.`)).toBe("doc [CPF].");
    expect(semCpfNoTexto(`o envelope é o ${envelope}`)).toBe(`o envelope é o ${envelope}`);
  });
});

// ── O CAMINHO INTEIRO ───────────────────────────────────────────────────────

/** A linha de `temis_envelopes` do envio que já rodou: comprador, testemunha e vendedora. */
const envelopeGravado = {
  atualizado_em: "2026-10-01T12:00:00.000Z",
  envelope_id: "env-40",
  estado: "parcial",
  id: "reg-40",
  proposta_id: "prop-40",
  provedor_documento_id: "doc-40",
  signatarios: [
    { chave: "sig-titular", email: "titular@x.com", nome: "Henrique Sales do Vale", ordem: 1, papel: "comprador" },
    { chave: "sig-test", email: "rafael@x.com", nome: "Rafael Gomes Pinto", ordem: 2, papel: "testemunha" },
    { chave: "sig-vend", email: "rita@x.com", nome: "Rita Alves Prado", ordem: 3, papel: "vendedora" },
  ],
};

/** O duplo do Supabase: a linha do envelope e o que foi pedido à função da 0195. */
function bancoDeTeste(envelope: Record<string, unknown>) {
  const chamadasDaFuncao: Record<string, unknown>[] = [];
  const builder = {
    eq: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve({ data: envelope, error: null }),
    order: () => builder,
    select: () => builder,
  };
  const rpc = (_nome: string, args: Record<string, unknown>) => {
    chamadasDaFuncao.push(args);
    const quadro = (args.p_quadro ?? []) as unknown[];
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
  return { chamadasDaFuncao, sb: { from: () => builder, rpc } as unknown as SupabaseClient };
}

/** O que a Clicksign responde a `GET /envelopes/{id}/signers`: id, degrau e e-mail. */
const lista = (pessoas: Array<[string, number, string]>) => ({
  data: pessoas.map(([id, group, email]) => ({ attributes: { email, group }, id, type: "signers" })),
});

const DEGRAUS = lista([
  ["sig-titular", 1, "titular@x.com"],
  ["sig-test", 2, "rafael@x.com"],
  ["sig-vend", 3, "rita@x.com"],
]);

const LER_DEGRAUS = "GET /envelopes/env-40/signers?page[size]=50";
const LER_QUEM_SAI = "GET /envelopes/env-40/signers/sig-test";

/** O duplo da porta HTTP: guarda método, caminho e corpo, e responde pelo padrão "MÉTODO caminho". */
function portaDeTeste(opcoes: { assinavaComCpf?: boolean | null; respostas?: Record<string, unknown> } = {}) {
  const chamadas: { caminho: string; corpo: unknown; metodo: string }[] = [];
  const porta = async <T = unknown>(caminho: string, op: Opcoes = {}): Promise<T> => {
    const metodo = op.metodo ?? "GET";
    chamadas.push({ caminho, corpo: op.corpo, metodo });
    for (const [padrao, resposta] of Object.entries(opcoes.respostas ?? {})) {
      if (`${metodo} ${caminho}` === padrao || (padrao.endsWith("*") && `${metodo} ${caminho}`.startsWith(padrao.slice(0, -1)))) {
        if (resposta instanceof Error) throw resposta;
        return resposta as T;
      }
    }
    if (metodo === "GET" && caminho.includes("/signers?")) return DEGRAUS as T;
    if (metodo === "GET" && caminho.includes("/signers/")) {
      const bandeira = opcoes.assinavaComCpf === undefined ? false : opcoes.assinavaComCpf;
      return { data: { attributes: bandeira === null ? {} : { has_documentation: bandeira }, id: "sig-test" } } as T;
    }
    if (metodo === "POST" && caminho.endsWith("/signers")) return { data: { id: "sig-ana" } } as T;
    return {} as T;
  };
  const passos = () => chamadas.map((c) => `${c.metodo} ${c.caminho}`);
  const cadastro = () =>
    (chamadas.find((c) => c.metodo === "POST" && c.caminho.endsWith("/signers"))?.corpo as {
      data: { attributes: Record<string, unknown> };
    }) ?? null;
  return { cadastro, chamadas, passos, porta };
}

const falha = (status: number, detalhes: string[] = []) =>
  new FalhaDaClicksign(`Clicksign devolveu ${status}.`, { detalhes, requestId: null, status });

const pedidoDaAna = {
  email: "ana@x.com",
  envelopeId: "env-40",
  nome: "Ana Paula Dias",
  signerId: "sig-test",
};

/** Tudo o que foi escrito no console durante o teste, para conferir que nenhum CPF passou por lá. */
let escritoNoConsole: string[] = [];

beforeEach(() => {
  escritoNoConsole = [];
  for (const nivel of ["error", "info", "log", "warn"] as const) {
    vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
      escritoNoConsole.push(JSON.stringify(args));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("trocar quem assina, do começo ao fim", () => {
  it("lê degraus e o CPF de quem sai, cria a Ana, SÓ ENTÃO tira o Rafael, e convida só ela", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste(envelopeGravado);
    const { cadastro, passos, porta } = portaDeTeste({ assinavaComCpf: false });

    const r = await trocarPessoaDoSignatario(sb, pedidoDaAna, porta);

    expect(r).toEqual({
      aviso: null,
      email: "ana@x.com",
      nome: "Ana Paula Dias",
      ok: true,
      papel: "testemunha",
      signerId: "sig-ana",
    });
    expect(passos()).toEqual([
      LER_DEGRAUS,
      LER_QUEM_SAI,
      "POST /envelopes/env-40/signers",
      "POST /envelopes/env-40/bulk_requirements",
      // ⚠️ A REMOÇÃO VEM DEPOIS DO CADASTRO: o envelope nunca fica sem ninguém no lugar.
      "DELETE /envelopes/env-40/signers/sig-test",
      "POST /envelopes/env-40/signers/sig-ana/notifications",
    ]);

    // Quem sai não assinava com CPF, e nenhum CPF foi informado: a Ana entra do mesmo jeito.
    const atributos = cadastro()?.data.attributes ?? {};
    expect(atributos).toMatchObject({ email: "ana@x.com", has_documentation: false, name: "Ana Paula Dias" });
    expect("documentation" in atributos).toBe(false);
    // ⚠️ SEM `group`: com o envelope rodando a Clicksign recusa, e a pessoa cai no fim da fila.
    expect("group" in atributos).toBe(false);

    // ⚠️ O QUADRO RECEBE O NOME NOVO, O MESMO PAPEL E O FIM DA FILA (último degrau 3 + 1).
    expect(chamadasDaFuncao).toHaveLength(1);
    expect(chamadasDaFuncao[0]).toMatchObject({
      p_envelope: "reg-40",
      p_quadro: [
        { chave: "sig-titular", email: "titular@x.com", nome: "Henrique Sales do Vale", ordem: 1, papel: "comprador" },
        { chave: "sig-ana", email: "ana@x.com", nome: "Ana Paula Dias", ordem: 4, papel: "testemunha" },
        { chave: "sig-vend", email: "rita@x.com", nome: "Rita Alves Prado", ordem: 3, papel: "vendedora" },
      ],
      p_quadro_de: "2026-10-01T12:00:00.000Z",
    });
  });

  // ⚠️ O NÍVEL DA AUTENTICAÇÃO NÃO CAI: quem entra no lugar de alguém que assinava com CPF, também.
  it("quem sai assinava com CPF e o CPF não veio: recusa, e nada é criado nem removido", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste(envelopeGravado);
    const { passos, porta } = portaDeTeste({ assinavaComCpf: true });

    const r = await trocarPessoaDoSignatario(sb, pedidoDaAna, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.removido).toBe(false);
    expect(r.erro).toContain("Rafael Gomes Pinto assina este contrato com CPF");
    expect(r.erro).toContain("Informe o CPF de Ana Paula Dias");
    expect(passos()).toEqual([LER_DEGRAUS, LER_QUEM_SAI]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  it("a Clicksign não informou a bandeira: o CPF é exigido, pelo lado seguro", async () => {
    const { sb } = bancoDeTeste(envelopeGravado);
    const { passos, porta } = portaDeTeste({ assinavaComCpf: null });

    const r = await trocarPessoaDoSignatario(sb, pedidoDaAna, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(passos()).not.toContain("POST /envelopes/env-40/signers");
  });

  it("quem sai assinava com CPF e o CPF veio: a Ana entra com CPF, e ele não aparece em lugar nenhum além da Clicksign", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste(envelopeGravado);
    const { cadastro, porta } = portaDeTeste({ assinavaComCpf: true });

    const r = await trocarPessoaDoSignatario(sb, { ...pedidoDaAna, cpf: DIGITOS_DO_CPF }, porta);

    expect(r.ok).toBe(true);
    // Para a Clicksign, com a máscara que ela exige.
    expect(cadastro()?.data.attributes).toMatchObject({ documentation: CPF, has_documentation: true });

    // ⚠️ NEM NO QUADRO, NEM NA RESPOSTA, NEM NO LOG.
    const quadro = JSON.stringify(chamadasDaFuncao);
    expect(quadro).not.toContain(DIGITOS_DO_CPF);
    expect(quadro).not.toContain(CPF);
    expect(quadro).not.toMatch(/cpf|documentation/i);
    expect(JSON.stringify(r)).not.toContain("529");
    expect(escritoNoConsole.join(" ")).not.toContain("529");
  });

  it("quem sai não assinava com CPF e o CPF veio: a Ana entra com CPF (o nível sobe, não desce)", async () => {
    const { sb } = bancoDeTeste(envelopeGravado);
    const { cadastro, porta } = portaDeTeste({ assinavaComCpf: false });

    const r = await trocarPessoaDoSignatario(sb, { ...pedidoDaAna, cpf: CPF }, porta);

    expect(r.ok).toBe(true);
    expect(cadastro()?.data.attributes).toMatchObject({ documentation: CPF, has_documentation: true });
  });

  it("comprador não se troca: recusa sem nenhuma chamada", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste(envelopeGravado);
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarPessoaDoSignatario(sb, { ...pedidoDaAna, signerId: "sig-titular" }, porta);

    expect(r).toEqual({ erro: RECUSA_DE_TROCA_DE_PARTE_DO_CONTRATO, ok: false, removido: false, status: 409 });
    expect(chamadas).toEqual([]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  it("quem já assinou não sai: recusa sem nenhuma chamada", async () => {
    const assinou = {
      ...envelopeGravado,
      signatarios: envelopeGravado.signatarios.map((s) =>
        s.chave === "sig-test" ? { ...s, assinado_em: "2026-10-01T13:00:00.000Z" } : s,
      ),
    };
    const { sb } = bancoDeTeste(assinou);
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarPessoaDoSignatario(sb, pedidoDaAna, porta);

    expect(r).toEqual({ erro: RECUSA_DE_TROCA_DE_PESSOA_QUE_JA_ASSINOU, ok: false, removido: false, status: 409 });
    expect(chamadas).toEqual([]);
  });

  it("e-mail de outro signatário: recusa sem nenhuma chamada", async () => {
    const { sb } = bancoDeTeste(envelopeGravado);
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarPessoaDoSignatario(sb, { ...pedidoDaAna, email: "titular@x.com" }, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(chamadas).toEqual([]);
  });

  it("CPF inválido: recusa sem nenhuma chamada, e a frase não repete o número", async () => {
    const { sb } = bancoDeTeste(envelopeGravado);
    const { chamadas, porta } = portaDeTeste();

    const r = await trocarPessoaDoSignatario(sb, { ...pedidoDaAna, cpf: "529.982.247-26" }, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.erro).not.toContain("529");
    expect(chamadas).toEqual([]);
  });

  it("a Clicksign não respondeu sobre o CPF de quem sai: nada é mexido", async () => {
    const { sb } = bancoDeTeste(envelopeGravado);
    const { passos, porta } = portaDeTeste({ respostas: { [LER_QUEM_SAI]: falha(500) } });

    const r = await trocarPessoaDoSignatario(sb, pedidoDaAna, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.removido).toBe(false);
    expect(r.erro).toContain("Nada foi mexido");
    expect(passos()).toEqual([LER_DEGRAUS, LER_QUEM_SAI]);
  });
});

describe("trocar quem assina quando algo falha no meio", () => {
  // ⚠️ O 403 É A TRAVA DA CLICKSIGN PARA QUEM JÁ COMEÇOU A ASSINAR: a Ana, que acabou de entrar, sai.
  it("403 ao tirar o Rafael: a Ana é desfeita, e o envelope fica como estava", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste(envelopeGravado);
    const { passos, porta } = portaDeTeste({
      respostas: { "DELETE /envelopes/env-40/signers/sig-test": falha(403, ["Já assinou um documento. Não pode ser excluído"]) },
    });

    const r = await trocarPessoaDoSignatario(sb, pedidoDaAna, porta);

    expect(r).toEqual({ erro: RECUSA_DE_TROCA_DE_PESSOA_QUE_JA_ASSINOU, ok: false, removido: false, status: 409 });
    expect(passos()).toEqual([
      LER_DEGRAUS,
      LER_QUEM_SAI,
      "POST /envelopes/env-40/signers",
      "POST /envelopes/env-40/bulk_requirements",
      "DELETE /envelopes/env-40/signers/sig-test",
      "DELETE /envelopes/env-40/signers/sig-ana",
    ]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  // ⚠️ A CLICKSIGN PODE DEVOLVER O CPF NO DETALHE DO ERRO, e é o detalhe que sobe para a tela.
  it("o cadastro da Ana é recusado: ninguém sai, a frase fala da Ana, e o CPF do detalhe some", async () => {
    const { sb } = bancoDeTeste(envelopeGravado);
    const { passos, porta } = portaDeTeste({
      respostas: { "POST /envelopes/env-40/signers": falha(422, [`/data/attributes/documentation ${CPF} inválido`]) },
    });

    const r = await trocarPessoaDoSignatario(sb, { ...pedidoDaAna, cpf: CPF }, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.removido).toBe(false);
    expect(r.erro).toContain("recusou o cadastro de Ana Paula Dias");
    expect(r.erro).toContain("Rafael Gomes Pinto continua no envelope env-40");
    expect(r.erro).not.toContain("e-mail antigo");
    expect(r.erro).toContain("[CPF]");
    expect(r.erro).not.toContain("529");
    expect(passos()).not.toContain("DELETE /envelopes/env-40/signers/sig-test");
  });

  it("os requisitos da Ana falham: o cadastro dela é desfeito, e o Rafael fica", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste(envelopeGravado);
    const { passos, porta } = portaDeTeste({
      respostas: { "POST /envelopes/env-40/bulk_requirements": falha(500) },
    });

    const r = await trocarPessoaDoSignatario(sb, pedidoDaAna, porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.removido).toBe(false);
    expect(r.erro).toContain("A troca não foi feita");
    expect(passos()).toEqual([
      LER_DEGRAUS,
      LER_QUEM_SAI,
      "POST /envelopes/env-40/signers",
      "POST /envelopes/env-40/bulk_requirements",
      "DELETE /envelopes/env-40/signers/sig-ana",
    ]);
    expect(chamadasDaFuncao).toEqual([]);
  });

  // ⚠️ TIMEOUT NA REMOÇÃO NÃO DIZ SE ELA ACONTECEU: a lista é relida antes de decidir.
  it("a remoção do Rafael não respondeu e a releitura mostra que ele saiu: a troca vale, com aviso", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste(envelopeGravado);
    let leituras = 0;
    const { porta } = portaDeTeste({
      respostas: { "DELETE /envelopes/env-40/signers/sig-test": falha(504) },
    });
    const portaQueRelê = async <T = unknown>(caminho: string, op: Opcoes = {}): Promise<T> => {
      if ((op.metodo ?? "GET") === "GET" && caminho.includes("/signers?")) {
        leituras += 1;
        if (leituras > 1) {
          await porta(caminho, op);
          return lista([
            ["sig-titular", 1, "titular@x.com"],
            ["sig-vend", 3, "rita@x.com"],
            ["sig-ana", 4, "ana@x.com"],
          ]) as T;
        }
      }
      return porta<T>(caminho, op);
    };

    const r = await trocarPessoaDoSignatario(sb, pedidoDaAna, portaQueRelê);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.aviso).toContain("saiu do envelope");
    expect(leituras).toBe(2);
    expect(chamadasDaFuncao).toHaveLength(1);
  });

  it("a remoção não respondeu e a releitura também não: a Ana fica, e a frase manda conferir a linha do Rafael", async () => {
    const { sb } = bancoDeTeste(envelopeGravado);
    let leituras = 0;
    const { porta } = portaDeTeste({
      respostas: { "DELETE /envelopes/env-40/signers/sig-test": falha(504) },
    });
    const portaQueFalhaNaReleitura = async <T = unknown>(caminho: string, op: Opcoes = {}): Promise<T> => {
      if ((op.metodo ?? "GET") === "GET" && caminho.includes("/signers?")) {
        leituras += 1;
        if (leituras > 1) throw falha(503);
      }
      return porta<T>(caminho, op);
    };

    const r = await trocarPessoaDoSignatario(sb, pedidoDaAna, portaQueFalhaNaReleitura);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.erro).toContain("O cadastro de Ana Paula Dias ficou no envelope env-40");
    expect(r.erro).toContain("a linha de Rafael Gomes Pinto");
  });

  // ⚠️ UMA TENTATIVA ANTERIOR JÁ TROCOU NA CLICKSIGN E A RESPOSTA SE PERDEU: a troca é adotada, e só o
  // nosso registro é atualizado, com o nome novo.
  it("a Ana já está no envelope e o Rafael já saiu: adota, sem criar nem remover ninguém", async () => {
    const { chamadasDaFuncao, sb } = bancoDeTeste(envelopeGravado);
    const { passos, porta } = portaDeTeste({
      respostas: {
        [LER_DEGRAUS]: lista([
          ["sig-titular", 1, "titular@x.com"],
          ["sig-vend", 3, "rita@x.com"],
          ["sig-ana", 4, "ana@x.com"],
        ]),
      },
    });

    const r = await trocarPessoaDoSignatario(sb, pedidoDaAna, porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signerId).toBe("sig-ana");
    expect(passos()).toEqual([LER_DEGRAUS]);
    expect(chamadasDaFuncao[0]?.p_quadro).toContainEqual({
      chave: "sig-ana",
      email: "ana@x.com",
      nome: "Ana Paula Dias",
      ordem: 4,
      papel: "testemunha",
    });
  });
});
