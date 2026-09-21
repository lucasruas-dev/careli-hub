// O CRECI SAI DO C2X E PASSA A MORAR NO PANTEON.
//
// Lucas, 21/09/2026: *"tudo que precisa estar dentro do contrato (ou seja as variaveis) tem que
// estar dentro do panteon"* e *"preciso enviar contrato hoje"*.
//
// ⚠️ A TELA MOSTRAVA E O CONTRATO NÃO ACHAVA. O CRM 360 exibe o CRECI lendo o C2X AO VIVO — a
// própria `lib/apolo/server.ts` diz, no comentário da ficha: *"não alimenta envio"*. O gerador de
// documento lê só o Panteon, onde o número nunca foi gravado. Resultado medido em 21/09/2026: o
// contrato do Vale do Ouro imprimiu "CRECI: [creci_vinculado]" para a FLAT IMOBILIARIA enquanto a
// tela mostrava 53964 do lado.
//
// ⚠️ O CASAMENTO É PELO VÍNCULO, NÃO PELO DOCUMENTO. `apolo_source_links` já liga 4.778 entidades
// ao `users` do C2X (medido em 21/09/2026); casar por CPF/CNPJ exigiria normalizar máscara dos dois
// lados e erraria em documento repetido. O vínculo é a chave que o sync já mantém.
//
// ⚠️ E A CONSULTA COMEÇA PELO C2X, não pelas entidades. São ~431 usuários com CRECI no legado
// contra 4.778 entidades vinculadas: perguntar "quem tem CRECI" e depois casar custa um lote; o
// contrário custaria 48.
import type { SupabaseClient } from "@supabase/supabase-js";

/** Uma linha de `users` do C2X, como o legado a devolve. */
export type CreciDoC2x = {
  creci_number: null | string;
  creci_validate: Date | null | string;
  id: number | string;
};

/** O que gravar numa entidade do Apolo. */
export type CreciParaGravar = {
  creci: string;
  creciValidade: null | string;
  sourceId: string;
};

/**
 * O número do CRECI, limpo, ou `null` quando não há nada aproveitável.
 *
 * ⚠️ O LEGADO GUARDA LIXO NESSE CAMPO: medido, há valores "0", "-", "NAO TEM" e espaços. Gravar
 * qualquer um deles faria o contrato imprimir um CRECI que não existe — pior do que o colchete,
 * que ao menos avisa. Só passa o que tem dígito.
 */
export function creciLimpo(valor: unknown): null | string {
  const texto = String(valor ?? "").trim();
  if (texto === "") return null;
  if (!/\d/.test(texto)) return null;
  // Um número sozinho, sem dígito diferente de zero, é o "vazio" do legado.
  if (/^[0\s.\-/]+$/.test(texto)) return null;
  return texto;
}

/** A data em `AAAA-MM-DD`, ou `null`. Sem `new Date()` sobre texto: fuso não pode mover validade. */
export function validadeLimpa(valor: unknown): null | string {
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString().slice(0, 10);
  }
  const texto = String(valor ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}

/** As linhas do C2X que valem uma gravação. */
export function creciParaGravar(linhas: readonly CreciDoC2x[]): CreciParaGravar[] {
  const saida: CreciParaGravar[] = [];

  for (const linha of linhas) {
    const creci = creciLimpo(linha.creci_number);
    if (!creci) continue;
    saida.push({
      creci,
      creciValidade: validadeLimpa(linha.creci_validate),
      sourceId: String(linha.id).trim(),
    });
  }

  return saida;
}

/** Lotes de 100: `.in()` com centenas de ids estoura o tamanho da URL do PostgREST. */
export function emLotes<T>(itens: readonly T[], tamanho = 100): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

export type ResultadoDaImportacao = {
  comCreciNoC2x: number;
  entidadesAtualizadas: number;
  semVinculo: number;
};

/**
 * Traz o CRECI do C2X para a coluna `apolo_entities.creci`.
 *
 * ⚠️ SÓ PREENCHE O QUE ESTÁ VAZIO. Quem editou o CRECI no Panteon mandou mais do que o legado: o
 * `.is("creci", null)` no update existe para a importação nunca sobrescrever cadastro feito à mão.
 */
export async function importarCreciDoC2x(entrada: {
  adminClient: SupabaseClient;
  consultarC2x: () => Promise<CreciDoC2x[]>;
}): Promise<ResultadoDaImportacao> {
  const linhas = await entrada.consultarC2x();
  const paraGravar = creciParaGravar(linhas);
  const resultado: ResultadoDaImportacao = {
    comCreciNoC2x: paraGravar.length,
    entidadesAtualizadas: 0,
    semVinculo: 0,
  };

  if (paraGravar.length === 0) return resultado;

  const porSourceId = new Map(paraGravar.map((item) => [item.sourceId, item]));

  for (const lote of emLotes([...porSourceId.keys()])) {
    const { data: vinculos } = await entrada.adminClient
      .from("apolo_source_links")
      .select("entity_id,source_id")
      .eq("source_system", "c2x")
      .eq("source_table", "users")
      .in("source_id", lote);

    const achados = new Set<string>();

    for (const vinculo of (vinculos ?? []) as { entity_id: string; source_id: string }[]) {
      const item = porSourceId.get(String(vinculo.source_id));
      if (!item) continue;
      achados.add(item.sourceId);

      const { error } = await entrada.adminClient
        .from("apolo_entities")
        .update({ creci: item.creci, creci_validade: item.creciValidade })
        .eq("id", vinculo.entity_id)
        .is("creci", null);

      if (!error) resultado.entidadesAtualizadas += 1;
    }

    resultado.semVinculo += lote.filter((id) => !achados.has(id)).length;
  }

  return resultado;
}
