import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

// O CADASTRO DOS PRODUTOS, COM QUEM OPERA CADA UM — para os testes da régua de escrita da Têmis.
//
// Decisão do Lucas (16/09/2026): no portal que confecciona, a escrita só vale no produto que ele
// opera (`hercules_empreendimentos.operado_por`, 0170). A régua é `escritaNoProduto`
// (`lib/apolo/incorporador/operacao-do-produto-servidor.ts`), e ela lê o cadastro por
// `lerCadastroDeEmpreendimentos`. Os testes trocam SÓ essa leitura (o banco) e deixam a régua de
// verdade decidir: assim o que se prova é a regra que roda em produção, e não uma cópia dela.
//
// ⚠️ SÓ PARA TESTE. Sem import de valor: a fábrica do `vi.mock` de `@/lib/hercules/cadastro` importa
// este arquivo, e um import de valor de lá voltaria ao módulo que está sendo trocado.

/** `apolo_incorporadores.id` da Cecílio Rocha nos testes da Têmis do portal. */
export const INCORPORADOR_DA_CECILIO = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";

export type ProdutoDoTeste = {
  /** `c2x_enterprise_id`. */
  c2x: string;
  /** `apolo_incorporadores.id` de quem opera. Nulo = a Careli. */
  operadoPor: null | string;
  /** O `c2x` do pai, quando é divisão. */
  pai?: string;
};

/**
 * O cadastro medido em 16/09/2026 com a decisão do Lucas: o VLO (35) é o pai do VOC (37), do VOL (36)
 * e do VOR (41), todos da Careli; o Garden (39) é da Cecílio.
 */
export const PRODUTOS_DE_16_DE_SETEMBRO: readonly ProdutoDoTeste[] = [
  { c2x: "35", operadoPor: null },
  { c2x: "37", operadoPor: null, pai: "35" },
  { c2x: "36", operadoPor: null, pai: "35" },
  { c2x: "41", operadoPor: null, pai: "35" },
  { c2x: "39", operadoPor: INCORPORADOR_DA_CECILIO },
];

/** Todos os produtos acima operados pela Cecílio: o cenário dos testes escritos antes da régua. */
export const TUDO_DA_CECILIO: readonly ProdutoDoTeste[] = PRODUTOS_DE_16_DE_SETEMBRO.map((p) => ({
  ...p,
  operadoPor: INCORPORADOR_DA_CECILIO,
}));

/** As linhas como `lerCadastroDeEmpreendimentos` as devolve (já mapeadas). */
export function cadastroDosProdutos(produtos: readonly ProdutoDoTeste[]): LinhaDoCadastro[] {
  return produtos.map((produto, ordem) => ({
    c2xEnterpriseId: produto.c2x,
    cidade: null,
    codigo: `P${produto.c2x}`,
    id: `h-${produto.c2x}`,
    nome: `Produto ${produto.c2x}`,
    operadoPor: produto.operadoPor,
    ordem,
    paiId: produto.pai ? `h-${produto.pai}` : null,
    tipoProduto: "loteamento",
    uf: null,
    vendendo: true,
  }));
}
