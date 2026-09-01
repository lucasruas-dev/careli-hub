import { createApoloAdminClient } from "@/lib/apolo/server";

// OS DOCUMENTOS CADASTRADOS — a leitura da tabela `boletos_documentos`, num lugar só.
//
// ⚠️ SÓ NO SERVIDOR. A tabela guarda CPF de ~200 pessoas com RLS ligada e sem policy de select:
// quem lê é a service role. Nenhuma tela toca nela direto — passam todas pelas rotas, que
// autorizam por papel.
//
// ⚠️ O CPF NÃO VOLTA INTEIRO PARA A TELA. A tabela é a fonte para o Asaas, não para exibição: a
// tela mostra os últimos dígitos para o operador conferir a pessoa, e o documento completo só
// viaja de `prepararLote` para a chamada do Asaas, dentro do servidor.

export type DocumentoCadastrado = {
  contato: null | string;
  documento: string;
  nome: string;
  unidade: string;
};

/**
 * Os documentos de um empreendimento, indexados pela unidade.
 *
 * ⚠️ INDEXADO PELA UNIDADE, e não pelo nome. O MARCELO SALDANHA NUNES tem dois apartamentos no Ed.
 * Rubi com o mesmo CPF; o nome não distingue as duas cobranças.
 */
export async function documentosDoEmpreendimento(
  empreendimento: string,
): Promise<Map<string, DocumentoCadastrado>> {
  const supabase = createApoloAdminClient();
  if (!supabase) return new Map();

  const { data, error } = await supabase
    .from("boletos_documentos")
    .select("contato, documento, nome, unidade")
    .eq("workspace_id", "careli")
    .eq("empreendimento", empreendimento);

  if (error || !data) return new Map();

  const mapa = new Map<string, DocumentoCadastrado>();
  for (const linha of data as DocumentoCadastrado[]) {
    mapa.set(String(linha.unidade).trim(), {
      contato: linha.contato,
      documento: String(linha.documento).replace(/\D/g, ""),
      nome: linha.nome,
      unidade: String(linha.unidade).trim(),
    });
  }
  return mapa;
}

/**
 * Os documentos de vários empreendimentos de uma vez, indexados por `empreendimento|unidade`.
 *
 * A tela da CER mostra quatro edifícios lado a lado; buscar um por vez seriam quatro idas ao banco
 * para montar uma tabela só.
 */
export async function documentosDeVarios(
  empreendimentos: string[],
): Promise<Map<string, DocumentoCadastrado & { empreendimento: string }>> {
  const mapa = new Map<string, DocumentoCadastrado & { empreendimento: string }>();
  if (empreendimentos.length === 0) return mapa;

  const supabase = createApoloAdminClient();
  if (!supabase) return mapa;

  const { data, error } = await supabase
    .from("boletos_documentos")
    .select("contato, documento, empreendimento, nome, unidade")
    .eq("workspace_id", "careli")
    .in("empreendimento", empreendimentos);

  if (error || !data) return mapa;

  for (const linha of data as (DocumentoCadastrado & { empreendimento: string })[]) {
    const unidade = String(linha.unidade).trim();
    mapa.set(`${linha.empreendimento}|${unidade}`, {
      contato: linha.contato,
      documento: String(linha.documento).replace(/\D/g, ""),
      empreendimento: linha.empreendimento,
      nome: linha.nome,
      unidade,
    });
  }
  return mapa;
}

/** Quantos documentos existem por empreendimento — o que o painel de prontidão conta. */
export async function contagemDeDocumentos(): Promise<Map<string, number>> {
  const supabase = createApoloAdminClient();
  if (!supabase) return new Map();

  const { data, error } = await supabase
    .from("boletos_documentos")
    .select("empreendimento")
    .eq("workspace_id", "careli");

  if (error || !data) return new Map();

  const contagem = new Map<string, number>();
  for (const linha of data as { empreendimento: string }[]) {
    contagem.set(linha.empreendimento, (contagem.get(linha.empreendimento) ?? 0) + 1);
  }
  return contagem;
}

/**
 * Os últimos dígitos do documento, para a tela conferir a pessoa sem receber o CPF inteiro.
 *
 * `12345678901` → `•••.456.789-01` para CPF, `•••.977/0001-93` para CNPJ.
 */
export function documentoMascarado(documento: string): string {
  const d = String(documento ?? "").replace(/\D/g, "");
  if (d.length === 11) return `•••.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `•••.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return "•••";
}
