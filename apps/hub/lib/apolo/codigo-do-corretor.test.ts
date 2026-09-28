import { describe, expect, it, vi } from "vitest";

import {
  MENSAGEM_SEM_SEQUENCIA_DO_CODIGO,
  proximoCodigoDoCorretor,
} from "./codigo-do-corretor";

// O CÓDIGO DO CORRETOR AUTÔNOMO — sequência do BANCO, nunca contagem.
//
// Lucas (27/09/2026): *"a minha ideia e gerar um codigo para esses corretores, assim saberemos que ele
// e autonomo"*, e o código *"somente no CRM"*.
//
// ⚠️ SEQUÊNCIA, E NÃO `count(*) + 1`: dois cadastros ao mesmo tempo tirariam o mesmo número. Quem
// gera é `nextval` no banco, que é atômico. O buraco na numeração quando um cadastro é recusado é o
// preço, e é barato: o código serve para ACHAR o autônomo, não para contar quantos são.
//
// ⚠️ ENQUANTO A MIGRATION NÃO RODAR, O CADASTRO RECUSA COM FRASE CLARA. Inventar um número seria o
// único jeito de gerar código repetido, e código repetido é o que este arquivo existe para impedir.
// (O RESTO do Apolo continua de pé: a leitura da ficha tolera a coluna não existir, e isso tem teste
// próprio em lib/apolo/server.coluna-do-codigo.test.ts.)
//
// ⚠️ O FORMATO ("CA-0001") NÃO É TESTADO AQUI, PORQUE NÃO MORA AQUI. Ele mora na função da 0193, que
// devolve a string pronta; o app só repassa. Havia um `formatarCodigoDoCorretor` espelhando o formato
// sem nenhum chamador de produção, e o teste dele dava a impressão de cobertura de ponta a ponta que
// não existia: mudar o prefixo no TypeScript deixaria os testes verdes e o banco gerando "CA-0001".
// Por isso a função e o teste dela saíram (27/09/2026).

function clienteComSequencia(...respostas: Array<{ data?: unknown; error?: unknown }>) {
  const chamadas: string[] = [];
  const fila = [...respostas];
  const client = {
    rpc: vi.fn(async (nome: string) => {
      chamadas.push(nome);
      return fila.shift() ?? { data: null, error: null };
    }),
  };
  return { chamadas, client: client as never, rpc: client.rpc };
}

describe("proximoCodigoDoCorretor", () => {
  it("devolve o código que o BANCO gerou, pela função da sequência", () => {
    const { client, chamadas, rpc } = clienteComSequencia({ data: "CA-0007", error: null });

    return proximoCodigoDoCorretor(client).then((r) => {
      expect(r).toEqual({ codigo: "CA-0007", ok: true });
      expect(chamadas).toEqual(["next_apolo_codigo_do_corretor"]);
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  });

  it("dois cadastros seguidos recebem números DIFERENTES (é a sequência que decide)", async () => {
    const { client } = clienteComSequencia(
      { data: "CA-0007", error: null },
      { data: "CA-0008", error: null },
    );

    const primeiro = await proximoCodigoDoCorretor(client);
    const segundo = await proximoCodigoDoCorretor(client);

    expect(primeiro).toEqual({ codigo: "CA-0007", ok: true });
    expect(segundo).toEqual({ codigo: "CA-0008", ok: true });
  });

  it("sequência ausente no banco: recusa com frase clara e NENHUM código inventado", async () => {
    const { client } = clienteComSequencia({
      data: null,
      error: { code: "42883", message: "function public.next_apolo_codigo_do_corretor() does not exist" },
    });

    const r = await proximoCodigoDoCorretor(client);

    expect(r).toEqual({ mensagem: MENSAGEM_SEM_SEQUENCIA_DO_CODIGO, ok: false });
    expect(JSON.stringify(r)).not.toContain("CA-");
  });

  it("banco respondeu vazio: recusa igual (sem número não há cadastro de autônomo)", async () => {
    const { client } = clienteComSequencia({ data: "   ", error: null });
    expect(await proximoCodigoDoCorretor(client)).toEqual({
      mensagem: MENSAGEM_SEM_SEQUENCIA_DO_CODIGO,
      ok: false,
    });
  });

  it("a frase diz o que o operador tem de fazer, sem jargão de banco", () => {
    expect(MENSAGEM_SEM_SEQUENCIA_DO_CODIGO).toContain("código");
    expect(MENSAGEM_SEM_SEQUENCIA_DO_CODIGO.toLowerCase()).not.toContain("sequence");
    expect(MENSAGEM_SEM_SEQUENCIA_DO_CODIGO.toLowerCase()).not.toContain("migration");
  });
});
