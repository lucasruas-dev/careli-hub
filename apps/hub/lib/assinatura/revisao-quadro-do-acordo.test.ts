import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { assinanteDeTermosDaVendedora, assinantesDoQuadro } from "./quadro-db";

// REVISÃO DO QUADRO PELA LENTE DO ENVIO DO ACORDO — quem o Panteon escolhe pelo incorporador, lido
// contra um duplo do Supabase em vez de um mock da própria função.
//
// ⚠️ O QUE ESTE ARQUIVO MEDE É A CADEIA QUE O ENVIO USA, degrau a degrau: o apontado para TERMOS,
// depois a VENDEDORA DO QUADRO, e só então o representante legal da PJ. Até 20/09/2026 a TELA do
// quadro (`lerQuadroDeAssinatura`, em `lib/temis/estrutura-servico.ts`) descrevia uma queda
// diferente, mostrando o representante legal da PJ como linha herdada mesmo quando havia vendedora
// digitada — o nome lido não era o nome que assinava. Quem espelha a cadeia na tela agora é
// `filaDosTermos`, no cartão.
//
// ⚠️ NADA AQUI TOCA A CLICKSIGN NEM O BANCO: o Supabase é um duplo que devolve as linhas do caso.

/**
 * Um duplo do PostgREST: um builder thenable com `eq`, `order` e `limit` de verdade.
 *
 * ⚠️ `order` E `limit` PRECISAM FUNCIONAR AQUI, e não é capricho: `assinanteDeTermosDaVendedora`
 * escolhe uma pessoa entre várias por `order("posicao").limit(1)`. Um duplo que devolvesse as
 * linhas na ordem em que o teste as escreveu faria a escolha parecer certa (ou errada) por acaso.
 */
function bancoComLinhas(tabelas: Record<string, Record<string, unknown>[]>): SupabaseClient {
  const from = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    const ordens: { coluna: string; crescente: boolean }[] = [];
    let teto: null | number = null;

    const linhas = () => {
      const todas = (tabelas[tabela] ?? []).filter((l) =>
        Object.entries(filtros).every(([coluna, valor]) =>
          coluna in l ? l[coluna] === valor : true,
        ),
      );

      const ordenadas = [...todas].sort((a, b) => {
        for (const { coluna, crescente } of ordens) {
          const x = String(a[coluna] ?? "");
          const y = String(b[coluna] ?? "");
          if (x !== y) return (x < y ? -1 : 1) * (crescente ? 1 : -1);
        }
        return 0;
      });

      return teto === null ? ordenadas : ordenadas.slice(0, teto);
    };

    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      eq: (coluna: string, valor: unknown) => {
        filtros[coluna] = valor;
        return builder;
      },
      limit: (n: number) => {
        teto = n;
        return builder;
      },
      maybeSingle: () => Promise.resolve({ data: linhas()[0] ?? null, error: null }),
      order: (coluna: string, opcoes: { ascending?: boolean } = {}) => {
        ordens.push({ coluna, crescente: opcoes.ascending !== false });
        return builder;
      },
      select: () => builder,
      then: (resolver: (r: { data: unknown; error: null }) => unknown) =>
        Promise.resolve(resolver({ data: linhas(), error: null })),
    });
    return builder;
  };

  return { from } as unknown as SupabaseClient;
}

const linhaDoQuadro = (patch: Record<string, unknown>) => ({
  ativo: true,
  cpf: null,
  email: "linha@incorporadora.test",
  enterprise_id: "31",
  nome: "Pessoa Do Quadro",
  ordem_assinatura: null,
  papel: "vendedora",
  posicao: 1,
  telefone: null,
  workspace_id: "careli",
  ...patch,
});

const CADASTRO_DA_PJ = {
  apolo_contacts: [
    { contact_type: "email", entity_id: "pessoa-rep", value: "representante@incorporadora.test" },
  ],
  apolo_entities: [
    { display_name: "Fulana Representante Legal", document_masked: "111.222.333-44", id: "pessoa-rep" },
  ],
  apolo_relationships: [
    {
      entity_id: "ent-vendedora",
      related_entity_id: "pessoa-rep",
      relationship_type: "representante_legal",
    },
  ],
};

describe("a queda do envio quando ninguém foi apontado para os termos", () => {
  // ⚠️ ESTE É O CASO QUE A TELA DESCREVE CERTO: sem linha nenhuma no quadro, o representante legal
  // é quem assina pelo incorporador, e é ele que a tela mostra herdado no campo dos termos.
  it("sem nenhuma linha no quadro, o representante legal é quem assina", async () => {
    const sb = bancoComLinhas({ ...CADASTRO_DA_PJ, temis_assinantes: [] });

    const apontado = await assinanteDeTermosDaVendedora(sb, "31");
    const doQuadro = await assinantesDoQuadro(sb, {
      enterpriseId: "31",
      vendedoraEntityId: "ent-vendedora",
    });

    expect(apontado).toBeNull();
    expect(doQuadro.find((p) => p.papel === "vendedora")?.nome).toBe("Fulana Representante Legal");
  });

  /**
   * O DEGRAU DO MEIO: A VENDEDORA DO CONTRATO, E A TELA PASSOU A DIZER ISSO (corrigido em
   * 20/09/2026).
   *
   * Com uma linha de `vendedora` cadastrada (a pessoa que assina o CONTRATO pela empresa) e nenhuma
   * de `termos_vendedora`, `assinantesDoQuadro` NÃO herda o representante legal — a linha digitada
   * já ocupa o papel — e o envio manda o termo para a pessoa do CONTRATO. A tela mostrava, naquele
   * campo, a linha HERDADA do cadastro da PJ: o nome lido antes de clicar não era o nome que
   * recebia o convite, e envelope é pago, permanente e chega na caixa do cliente.
   *
   * ⚠️ O CONSERTO FOI NA TELA, E NÃO AQUI, e essa escolha tem custo zero de comportamento: a outra
   * saída seria o envio passar a cair direto no representante legal, o que mudaria para quem vai o
   * termo em 35 empreendimentos (medido em 20/09/2026: 35 das 40 configurações têm vendedora e
   * ZERO das 23 incorporadoras tem representante legal). `filaDosTermos`, no cartão, espelha a
   * cadeia desta função; quem prende isso é
   * `modules/apolo/blocks/empreendimentos/quadro-de-assinatura.termos.revisao.comportamento.test.tsx`.
   */
  it("com vendedora cadastrada, o termo vai para ela, e não para o representante", async () => {
    const sb = bancoComLinhas({
      ...CADASTRO_DA_PJ,
      temis_assinantes: [
        linhaDoQuadro({
          email: "vendas@incorporadora.test",
          nome: "Procurador Da Compra E Venda",
          papel: "vendedora",
        }),
      ],
    });

    const apontado = await assinanteDeTermosDaVendedora(sb, "31");
    const doQuadro = await assinantesDoQuadro(sb, {
      enterpriseId: "31",
      vendedoraEntityId: "ent-vendedora",
    });

    // Ninguém foi apontado para termos: é o degrau do meio que responde.
    expect(apontado).toBeNull();
    expect(doQuadro.find((p) => p.papel === "vendedora")?.nome).toBe(
      "Procurador Da Compra E Venda",
    );
    // E o representante legal NÃO entra: quem digitou a linha decidiu quem assina pela empresa.
    expect(doQuadro.map((p) => p.nome)).not.toContain("Fulana Representante Legal");
  });
});

describe("o apontado para os termos, quando existe", () => {
  // ⚠️ DUAS LINHAS DE TERMOS É O OPERADOR TROCANDO DE PESSOA SEM APAGAR A ANTIGA. A menor `posicao`
  // é a que ele vê primeiro no quadro, e o termo tem uma linha só para a vendedora.
  it("com duas linhas, vence a de menor posição", async () => {
    const sb = bancoComLinhas({
      ...CADASTRO_DA_PJ,
      temis_assinantes: [
        linhaDoQuadro({
          email: "segundo@incorporadora.test",
          nome: "Segundo Apontado Silva",
          papel: "termos_vendedora",
          posicao: 2,
        }),
        linhaDoQuadro({
          email: "juridico@incorporadora.test",
          nome: "Analista Do Juridico",
          papel: "termos_vendedora",
          posicao: 1,
        }),
      ],
    });

    const apontado = await assinanteDeTermosDaVendedora(sb, "31");

    expect(apontado?.nome).toBe("Analista Do Juridico");
  });

  // ⚠️ E O PAPEL SAI COMO `vendedora`, que é o que `ORDEM_DO_ACORDO` numera e o rótulo que a tela do
  // acordo escreve como "Incorporador". Um papel novo aqui obrigaria a renumerar todo mundo.
  it("sai com o papel vendedora, e sem ordem própria", async () => {
    const sb = bancoComLinhas({
      ...CADASTRO_DA_PJ,
      temis_assinantes: [
        linhaDoQuadro({
          nome: "Analista Do Juridico",
          ordem_assinatura: 1,
          papel: "termos_vendedora",
        }),
      ],
    });

    const apontado = await assinanteDeTermosDaVendedora(sb, "31");

    expect(apontado?.papel).toBe("vendedora");
    // A fila do acordo é a do Lucas (comprador, incorporador, Careli): um número digitado na tela do
    // CONTRATO não pode adiantar o incorporador.
    expect(apontado).not.toHaveProperty("ordemPropria");
  });

  // ⚠️ E O PAPEL NOVO NÃO ATRAVESSA PARA O CONTRATO: `assinantesDoQuadro` descarta a linha porque
  // `termos_vendedora` não está em `PAPEL_DO_QUADRO`.
  it("a linha de termos não vira signatário do contrato", async () => {
    const sb = bancoComLinhas({
      apolo_contacts: [],
      apolo_entities: [],
      apolo_relationships: [],
      temis_assinantes: [
        linhaDoQuadro({ nome: "Analista Do Juridico", papel: "termos_vendedora" }),
      ],
    });

    const doQuadro = await assinantesDoQuadro(sb, { enterpriseId: "31" });

    expect(doQuadro).toEqual([]);
  });
});
