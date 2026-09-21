import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// NENHUMA SENTINELA DE TEXTO EM COLUNA UUID — a armadilha que voltou.
//
// TI-000135 (Isac, 25/08/2026): *"Iris deu erro"*, na tela /hades/cobranca.
//
// ⚠️ ELA JÁ TINHA SIDO CORRIGIDA UMA VEZ, e a segunda cópia sobreviveu. O comentário de
// `iris-data-client.ts` conta a primeira: `.eq("queue_id", "__iris_sem_fila_visivel__")` numa coluna
// UUID faz o Postgres recusar a consulta inteira (22P02) em vez de devolver lista vazia. Dez linhas
// abaixo, o filtro por slug de fila fazia exatamente o mesmo com
// `__iris_queue_scope_not_found__` — e quem abrisse a tela de cobrança sem enxergar a fila Cobrança
// perdia a tela INTEIRA do atendimento, não um pedaço.
//
// ⚠️ O JEITO CERTO ESTÁ NA LINHA DE CIMA: `.in()` com lista vazia devolve zero linhas sem inventar
// valor. Este teste existe para a terceira cópia não nascer.

const CLIENTE = readFileSync(join(__dirname, "iris-data-client.ts"), "utf8");

/**
 * O arquivo SEM os comentários.
 *
 * ⚠️ AS NOTAS CITAM AS SENTINELAS DE PROPÓSITO, para explicar a armadilha a quem for mexer ali. É o
 * CÓDIGO que não pode mais tê-las; varrer o texto inteiro acusaria a própria documentação.
 */
const CODIGO = CLIENTE.split("\n")
  .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha))
  .join("\n");

describe("a régua de acesso aos tickets", () => {
  it("não compara queue_id com texto nenhum", () => {
    // Qualquer `.eq("queue_id", "…")` com literal de texto é a armadilha de volta. O id real
    // sempre vem de variável (`queue.id`, `scopedQueueIds`), nunca escrito à mão.
    const comparacoesComTexto = CODIGO.match(/\.eq\(\s*"queue_id"\s*,\s*"/g) ?? [];
    expect(comparacoesComTexto).toHaveLength(0);
  });

  it("filtra por lista, que aceita vazia", () => {
    expect(CLIENTE).toContain('comRegua = comRegua.in("queue_id", scopedQueueIds);');
  });

  it("as sentinelas antigas não existem mais em lugar nenhum do arquivo", () => {
    expect(CODIGO).not.toContain('"__iris_queue_scope_not_found__"');
    expect(CODIGO).not.toContain('"__iris_sem_fila_visivel__"');
  });
});
