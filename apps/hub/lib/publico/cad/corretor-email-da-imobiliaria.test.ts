import { describe, expect, it, vi } from "vitest";

// O DONO DA IMOBILIÁRIA USANDO O E-MAIL DA EMPRESA — a trava de e-mail único não pode barrá-lo.
//
// Caso real (26/09/2026): ISRAEL PEREIRA, da CASAVISTA IMOVEIS LTDA (CNPJ 51.054.981/7-87 na ficha
// da imobiliária), tentou entrar no CAD público OITO vezes seguidas — 13:36, 13:36, 13:40, 13:45,
// 13:46, 14:03, 14:07 e 14:07 — e tomou 500 em todas. Lucas: *"olha o porque desse erro"*.
//
// A causa MEDIDA: o e-mail dele, `israel@casavistaimoveis.com.br`, já estava em `apolo_contacts`
// como contato da ficha da CASAVISTA (criada em 11/09/2026 12:30), e a trava de e-mail único
// (lib/apolo/email-unico.ts) leu a empresa como se fosse "outra pessoa" usando aquele endereço.
//
// ⚠️ A EMPRESA NÃO É OUTRA PESSOA. A regra do Lucas (07/09/2026) é *"não podemos ter o mesmo
// e-mail para duas pessoas"*, e o risco que ela evita é o do D4Sign, onde o signatário É o e-mail:
// dois signatários com o mesmo endereço produzem contrato sem se saber quem assinou. O dono
// assinando com o e-mail da própria imobiliária não é esse caso — é a MESMA pessoa. Lucas
// (26/09/2026), ao decidir: a ficha da própria imobiliária não conta contra o corretor dela.
//
// ⚠️ MEDIDO EM PRODUÇÃO (26/09/2026): dos 55 corretores que uma imobiliária declarou sem ficha
// própria e com e-mail, 26 batiam nesta recusa, e em 17 deles o e-mail é o da PRÓPRIA imobiliária
// que os declarou. Não era um caso: era metade da porta.

vi.mock("@/lib/apolo/server", () => ({
  hashIdentifier: (tipo: string, valor: string) => `h:${tipo}:${valor}`,
}));
vi.mock("@/lib/apolo/credenciamento", () => ({
  listEmpreendimentosAtivos: async () => [],
  listEmpreendimentosParaCad: async () => [],
}));

const chamadas: { input: unknown; opcoes: unknown }[] = [];

vi.mock("@/lib/apolo/cadastro-persist", () => ({
  createApoloEntity: async (_cliente: unknown, input: unknown, opcoes: unknown) => {
    chamadas.push({ input, opcoes });
    return { autenticacao: "CAD-2026-TESTE", entityId: "corretor-novo", ok: true, warnings: [] };
  },
}));

import { criarCorretor } from "./dados";
import { recusaPublicaDoCorretor } from "./regras";

const IMOBILIARIA = "ab27d000-0ff5-4b1e-a30a-d62e022a1ca2";

// O pedaço do PostgREST que `criarCorretor` usa. Nada é encontrado: o corretor é novo, que é o
// caminho em que a trava de e-mail entra.
function bancoVazio() {
  const construtor: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "in", "is", "limit", "or"]) {
    construtor[metodo] = () => construtor;
  }
  construtor.maybeSingle = async () => ({ data: null, error: null });
  construtor.then = (resolver: (v: unknown) => unknown) => resolver({ data: [], error: null });
  construtor.insert = async () => ({ data: null, error: null });
  return { from: () => construtor };
}

function pedido() {
  return {
    dados: {
      cpf: "51054981787",
      creci: "MG 5695",
      email: "israel@casavistaimoveis.com.br",
      nome: "Israel Pereira",
      telefone: "31991942489",
    },
    imobiliariaEntityId: IMOBILIARIA,
    imobiliariaNome: "CASAVISTA IMOVEIS LTDA",
  };
}

describe("o corretor que usa o e-mail da própria imobiliária", () => {
  it("manda a ficha da imobiliária como do MESMO DONO, para o e-mail dela não contar contra ele", async () => {
    chamadas.length = 0;

    const resultado = await criarCorretor(
      bancoVazio() as never,
      pedido(),
    );

    expect(resultado.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    // É ISTO que destrava o Israel: sem este campo, `createApoloEntity` pergunta ao banco quem usa
    // aquele e-mail, encontra a ficha da CASAVISTA e recusa.
    expect((chamadas[0]?.opcoes as { fichaDoMesmoDono?: string }).fichaDoMesmoDono).toBe(IMOBILIARIA);
  });

  it("⚠️ NÃO afrouxa a trava: quem decide é a ficha, e só a da imobiliária que declarou entra", async () => {
    chamadas.length = 0;

    await criarCorretor(bancoVazio() as never, pedido());

    const opcoes = chamadas[0]?.opcoes as { fichaDoMesmoDono?: string };
    // Uma ficha QUALQUER continua contando: a trava entre duas pessoas diferentes fica de pé.
    expect(opcoes.fichaDoMesmoDono).not.toBe("outra-ficha-qualquer");
  });
});

// A SEGUNDA METADE DO INCIDENTE: a porta transformava TODA recusa em 500 mudo, e o Israel tentou
// oito vezes sem nunca saber o que corrigir. A recusa que tem conserta na mão do corretor passa a
// dizer o que fazer.
describe("o que o corretor lê quando o cadastro é recusado", () => {
  it("e-mail já em uso: diz o que fazer, e NÃO diz de quem é o e-mail", () => {
    const recusa = recusaPublicaDoCorretor("email-repetido");

    expect(recusa.status).toBe(409);
    expect(recusa.mensagem).toMatch(/e-mail/i);
    // ⚠️ SEM O NOME DO DONO, e sem o endereço. A mensagem interna (lib/apolo/email-unico.ts) diz de
    // quem é o e-mail de propósito, para o operador resolver; aqui do lado de fora isso viraria um
    // oráculo: quem digitasse endereços descobriria quem está na base da Careli.
    expect(recusa.mensagem).not.toMatch(/casavista/i);
    expect(recusa.mensagem).not.toMatch(/@/);
  });

  it("o que o corretor NÃO resolve sozinho continua genérico, como a casa manda", () => {
    // `rotas.ts` abre dizendo que três mensagens diferentes são três bits para quem enumera. Só o
    // que o próprio corretor conserta ganha texto próprio; falha de gravação, não.
    for (const motivo of ["falha-ao-gravar", "verificacao-indisponivel", undefined] as const) {
      const recusa = recusaPublicaDoCorretor(motivo);
      expect(recusa.status).toBe(500);
      expect(recusa.mensagem).toBeUndefined();
    }
  });
});
