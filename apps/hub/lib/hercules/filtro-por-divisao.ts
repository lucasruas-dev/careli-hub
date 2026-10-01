// A PROPOSTA E O DOCUMENTO LIDOS PELO ID DA DIVISÃO, E NÃO PELA SIGLA (PAN-124, fatia F5).
//
// O portal achava `hercules_propostas` e `hercules_documentos` por `empreendimento_codigo in (codes)`,
// a SIGLA gravada, com os codes vindos do catálogo do C2X. No próximo renome de sigla no C2X (o 43 teve
// três em cinco dias), as propostas antigas somem da Mesa sem erro. A migration 0205 grava em cada
// linha o id do C2X da DIVISÃO onde a unidade mora (`enterprise_id`), que não muda com renome.
//
// A LEITURA, EM DUAS PARTES, UNIDAS PELO `id` DA LINHA:
//   1. `enterprise_id in (ids)`: as linhas que já têm o id;
//   2. `enterprise_id is null and empreendimento_codigo in (codes)`: a TRANSIÇÃO, para as linhas que o
//      preenchimento (0205 .dados.sql) ainda não alcançou. Depois dele, esta parte volta vazia.
// Sem a 0205 (coluna ausente), só a sigla, como antes, e a memória de 60 s evita repetir a tentativa a
// cada requisição. É o molde de `lerComChaveDoGrupo` (./chave-do-grupo) e da 0170 (./cadastro).
//
// ⚠️ DUAS CONSULTAS, E NÃO UM `.or()` COM `and(...)`. É o precedente da casa
// (lib/apolo/incorporador/documentos.ts): o `.or()` monta o filtro em texto, e os dublês dos testes não
// imitam `and(...)` dentro dele. A união por `id` não repete linha.
//
// ⚠️ OS IDS SAEM DOS MESMOS CODES. Quem chama traduz a lista de siglas que já usava
// (`idsDosCodigosNoCadastro`, lib/apolo/incorporador/escopo.ts), e não monta um escopo novo: o conjunto
// de linhas é IDÊNTICO ao de hoje (medido em 01/10/2026: a sigla de 4.899 de 4.899 propostas com
// cadastro casa com o id da unidade). A diferença só aparece no próximo renome, que é o ponto.
//
// ⚠️ EM LOTES DE 100: um `in` com centenas de valores estoura a URL do PostgREST.

export const LOTE_DO_FILTRO = 100;

export type FiltroDaDivisao =
  /** `enterprise_id in (valores)`. */
  | { tipo: "ids"; valores: string[] }
  /** `enterprise_id is null and empreendimento_codigo in (valores)`: a transição. */
  | { tipo: "sigla-sem-id"; valores: string[] }
  /** `empreendimento_codigo in (valores)`: sem a 0205, como antes. */
  | { tipo: "sigla"; valores: string[] };

/** O pedaço do query builder do Supabase que o filtro usa. */
export type ConsultaFiltravel<Q> = {
  in(coluna: string, valores: readonly string[]): Q;
  is(coluna: string, valor: null): Q;
};

/**
 * Aplica o filtro a uma consulta já montada (tabela, workspace e o resto do `where`).
 *
 * ⚠️ O TIPO `Q` É LIVRE DE PROPÓSITO. Restringir `Q` ao formato do query builder do Supabase faz o
 * TypeScript instanciar o tipo dele inteiro, e o compilador desiste ("excessively deep") quando o
 * `select` é um literal longo. O formato é conferido aqui dentro.
 */
export function aplicarFiltroDaDivisao<Q>(consulta: Q, filtro: FiltroDaDivisao): Q {
  const c = consulta as unknown as ConsultaFiltravel<Q>;
  switch (filtro.tipo) {
    case "ids":
      return c.in("enterprise_id", filtro.valores);
    case "sigla-sem-id":
      return (c.is("enterprise_id", null) as unknown as ConsultaFiltravel<Q>).in(
        "empreendimento_codigo",
        filtro.valores,
      );
    case "sigla":
      return c.in("empreendimento_codigo", filtro.valores);
  }
}

/** O erro do Supabase é "a coluna enterprise_id ainda não existe" (0205 não aplicada)? */
export function ehColunaDaDivisaoAusente(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const { code, message } = erro as { code?: unknown; message?: unknown };
  if (code !== "42703" && code !== "PGRST204") return false;
  return typeof message === "string" && message.toLowerCase().includes("enterprise_id");
}

const MEMORIA_DA_0205_MS = 60 * 1000;
let sem0205Ate = 0;

/** Esquece a memória da 0205 pendente (para o teste; e para quem acabou de aplicar a migration). */
export function limparMemoriaDaMigration0205(): void {
  sem0205Ate = 0;
}

function lotes(valores: readonly string[], tamanho: number): string[][] {
  const limpos = [...new Set(valores.map((v) => String(v ?? "").trim()).filter(Boolean))];
  const saida: string[][] = [];
  for (let i = 0; i < limpos.length; i += tamanho) saida.push(limpos.slice(i, i + tamanho));
  return saida;
}

export type RespostaDaDivisao<T> = { data: T[] | null; error: unknown };

/**
 * Lê pelas duas partes (ou só pela sigla, sem a 0205) e une pelo `id`. `ler` recebe um filtro de UM
 * lote, aplica-o (com `aplicarFiltroDaDivisao`) à consulta dele e faz a paginação que já fazia.
 * Primeiro erro que não é de coluna ausente: devolve o erro, como a leitura antiga devolveria.
 */
export async function lerPelaDivisao<T extends { id: unknown }>(
  { codes, ids, lote = LOTE_DO_FILTRO }: { codes: readonly string[]; ids: readonly string[]; lote?: number },
  ler: (filtro: FiltroDaDivisao) => PromiseLike<RespostaDaDivisao<T>>,
): Promise<RespostaDaDivisao<T>> {
  const porId = new Map<string, T>();
  const juntar = (linhas: T[] | null) => {
    for (const linha of linhas ?? []) {
      const chave = String(linha.id);
      if (!porId.has(chave)) porId.set(chave, linha);
    }
  };

  const soPelaSigla = async (): Promise<RespostaDaDivisao<T>> => {
    for (const valores of lotes(codes, lote)) {
      const { data, error } = await ler({ tipo: "sigla", valores });
      if (error) return { data: null, error };
      juntar(data);
    }
    return { data: [...porId.values()], error: null };
  };

  if (Date.now() < sem0205Ate) return soPelaSigla();

  for (const valores of lotes(ids, lote)) {
    const { data, error } = await ler({ tipo: "ids", valores });
    if (error) {
      if (!ehColunaDaDivisaoAusente(error)) return { data: null, error };
      sem0205Ate = Date.now() + MEMORIA_DA_0205_MS;
      porId.clear();
      return soPelaSigla();
    }
    juntar(data);
  }

  for (const valores of lotes(codes, lote)) {
    const { data, error } = await ler({ tipo: "sigla-sem-id", valores });
    if (error) {
      if (!ehColunaDaDivisaoAusente(error)) return { data: null, error };
      sem0205Ate = Date.now() + MEMORIA_DA_0205_MS;
      porId.clear();
      return soPelaSigla();
    }
    juntar(data);
  }

  return { data: [...porId.values()], error: null };
}
