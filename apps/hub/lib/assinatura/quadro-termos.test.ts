import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  descreverRegra,
  gruposDaRegra,
  lerRegraDeOrdem,
  ORDEM_PADRAO,
} from "./ordem";
import {
  assinanteDeTermosDaVendedora,
  assinantesDoQuadro,
  PAPEL_DE_TERMOS_DA_VENDEDORA,
} from "./quadro-db";
import { PAPEIS, PAPEIS_DO_CONTRATO, rotuloDoPapel } from "./tipos";

// QUEM ASSINA OS TERMOS PELA VENDEDORA — e por que ele NÃO entra no contrato de venda.
//
// Lucas (20/09/2026): *"essa tela determina os assinantes, vamos ter o comprador e a vendedora,
// então temos uma fonte de busca para quem vai assinar os acordos. (nessa tela vc pode abrir mais um
// campo para assinatura de termos vendedora, ae eu posso apontar quem vai assinar os termos, não
// precisa necessariamente ser os representantes legais, pode ser o juridico, analista, enfim)"*.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ O QUE ESTES TESTES PROTEGEM: que um ANALISTA apontado para despachar termos não apareça, no
// dia seguinte, assinando uma COMPRA E VENDA.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// O papel novo mora na mesma tabela dos três do contrato (`temis_assinantes`, migration 0158, papel
// liberado na 0180). Essa economia é boa — uma tabela, uma tela, uma rota — e tem um preço exato: a
// única coisa que separa os dois mundos é o mapa `PAPEL_DO_QUADRO` de `quadro-db.ts`. Uma linha a
// mais naquele mapa, feita por distração, poria a pessoa dentro do envelope de todo contrato do
// empreendimento sem erro nenhum e sem ninguém para ligar as duas coisas. É isso que os testes
// abaixo prendem.

/** O duplo do PostgREST: guarda os filtros e devolve as linhas que casarem. */
function bancoCom(linhas: Record<string, unknown>[], erro: null | { message: string } = null) {
  const filtros: Record<string, unknown> = {};

  const builder: Record<string, unknown> = {};
  const resultado = () => ({
    data: erro
      ? null
      : linhas.filter((l) =>
          Object.entries(filtros).every(
            ([coluna, valor]) => coluna === "workspace_id" || l[coluna] === valor,
          ),
        ),
    error: erro,
  });

  Object.assign(builder, {
    eq: (coluna: string, valor: unknown) => {
      filtros[coluna] = valor;
      return builder;
    },
    limit: () => Promise.resolve(resultado()),
    order: () => builder,
    select: () => builder,
    // Sem `.limit()`, a cadeia do `assinantesDoQuadro` termina no `await` do próprio builder.
    then: (resolver: (r: unknown) => unknown) => Promise.resolve(resolver(resultado())),
  });

  return { from: () => builder } as unknown as SupabaseClient;
}

const linhaDoApontado = {
  ativo: true,
  cpf: "111.222.333-44",
  email: "juridico@incorporadora.test",
  enterprise_id: "4",
  nome: "Analista Do Juridico",
  ordem_assinatura: 1,
  papel: PAPEL_DE_TERMOS_DA_VENDEDORA,
  posicao: 1,
  telefone: null,
};

const linhaDaVendedoraDoContrato = {
  ativo: true,
  cpf: "555.666.777-88",
  email: "socio@incorporadora.test",
  enterprise_id: "4",
  nome: "Socio Administrador Exemplo",
  ordem_assinatura: null,
  papel: "vendedora",
  posicao: 1,
  telefone: null,
};

describe("o apontado para os termos", () => {
  it("volta com os dados que a Clicksign precisa, no papel de vendedora do termo", async () => {
    const pessoa = await assinanteDeTermosDaVendedora(bancoCom([linhaDoApontado]), "4");

    expect(pessoa).toEqual({
      cpf: "111.222.333-44",
      email: "juridico@incorporadora.test",
      nome: "Analista Do Juridico",
      papel: "vendedora",
      telefone: null,
    });
  });

  // ⚠️ A FILA DO TERMO É DO LUCAS E TEM TRÊS DEGRAUS FIXOS (*"na ordem comprador, incorporador e
  // nivea careli"*). `ordem_assinatura` é um campo do CONTRATO, onde a testemunha pode furar a fila
  // do próprio papel; deixá-lo viajar daqui permitiria, por um número digitado numa tela sobre
  // contrato, o incorporador assinar ANTES do comprador. E é o comprador quem pode não aceitar o
  // acordo: colher a assinatura da outra parte primeiro é gastar formalidade à toa.
  it("não carrega ordem própria, mesmo com a coluna preenchida na linha", async () => {
    const pessoa = await assinanteDeTermosDaVendedora(bancoCom([linhaDoApontado]), "4");

    expect(pessoa).not.toHaveProperty("ordemPropria");
  });

  it("sem ninguém apontado, devolve nulo e deixa a queda para quem chamou", async () => {
    const pessoa = await assinanteDeTermosDaVendedora(
      bancoCom([linhaDaVendedoraDoContrato]),
      "4",
    );

    expect(pessoa).toBeNull();
  });

  // ⚠️ FALHA DE LEITURA NÃO DERRUBA O ENVIO — a mesma disciplina de `assinantesDoQuadro`. Um timeout
  // do PostgREST vira "ninguém apontado", o envio cai no representante legal e, se nem ele existir,
  // o operador lê a frase de impedimento em vez de uma tela de erro sobre um cadastro que está
  // certo.
  it("falha de leitura devolve nulo, não exceção", async () => {
    const pessoa = await assinanteDeTermosDaVendedora(
      bancoCom([linhaDoApontado], { message: "timeout" }),
      "4",
    );

    expect(pessoa).toBeNull();
  });

  it("sem empreendimento não vai ao banco nem devolve ninguém", async () => {
    expect(await assinanteDeTermosDaVendedora(bancoCom([linhaDoApontado]), null)).toBeNull();
    expect(await assinanteDeTermosDaVendedora(bancoCom([linhaDoApontado]), "   ")).toBeNull();
  });
});

describe("o contrato de venda NÃO enxerga este papel", () => {
  // ⚠️ ESTE É O TESTE QUE VALE O ARQUIVO. `assinantesDoQuadro` é quem monta o envelope do CONTRATO:
  // se a linha dos termos passasse por aqui, o analista apontado para despachar acordos entraria na
  // compra e venda de todo lote daquele empreendimento.
  it("a linha dos termos não vira signatário do contrato", async () => {
    const pessoas = await assinantesDoQuadro(
      bancoCom([linhaDoApontado, linhaDaVendedoraDoContrato]),
      { enterpriseId: "4" },
    );

    expect(pessoas.map((p) => p.nome)).toEqual(["Socio Administrador Exemplo"]);
    expect(pessoas.every((p) => p.papel === "vendedora")).toBe(true);
  });

  it("e sozinha ela não produz signatário nenhum", async () => {
    const pessoas = await assinantesDoQuadro(bancoCom([linhaDoApontado]), { enterpriseId: "4" });

    expect(pessoas).toEqual([]);
  });

  // ⚠️ A ORDEM DE ASSINATURA DO CONTRATO É POR PAPEL, e os papéis são `PapelNoContrato`. O papel dos
  // termos não está lá: o cartão de ordem do empreendimento e a aba de categorias iteram
  // `PAPEIS_DO_CONTRATO` e nunca teriam como mostrá-lo.
  it("não é papel de contrato: não aparece na ordem nem na tela de categorias", () => {
    expect(PAPEIS).not.toContain(PAPEL_DE_TERMOS_DA_VENDEDORA);
    expect(PAPEIS_DO_CONTRATO).not.toContain(PAPEL_DE_TERMOS_DA_VENDEDORA);
    expect(gruposDaRegra(ORDEM_PADRAO).flat()).not.toContain(PAPEL_DE_TERMOS_DA_VENDEDORA);
    expect(descreverRegra({ ...ORDEM_PADRAO, ordenada: true }, rotuloDoPapel)).not.toContain(
      "termos",
    );
  });

  // ⚠️ E O JSONB GRAVADO NÃO CONSEGUE INTRODUZI-LO. `assinatura_ordem` é coluna livre: se alguém
  // (uma rota nova, um script) escrevesse o papel dos termos ali, `lerRegraDeOrdem` o descartaria
  // por não estar em `PAPEIS`. O envelope do contrato não tem como aprender este papel por acidente.
  it("gravar o papel no jsonb da ordem não o faz existir", () => {
    const regra = lerRegraDeOrdem({
      ordenada: true,
      ordens: { comprador: 1, [PAPEL_DE_TERMOS_DA_VENDEDORA]: 2 },
    });

    expect(Object.keys(regra.ordens)).not.toContain(PAPEL_DE_TERMOS_DA_VENDEDORA);
    expect(regra.ordens.comprador).toBe(1);
  });
});
