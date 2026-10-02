// A LEITURA DA CONTA E DO PIX DO FORNECEDOR, para a ficha do CRM (02/10/2026).
//
// A gravação mora no salvar do cadastro (lib/apolo/cadastro-salvar.ts); a regra, em
// lib/apolo/dados-bancarios.ts. Aqui só se lê `apolo_entity_bank_accounts` (migration 0211), que só o
// service role alcança: a rota que chama esta função confere o acesso antes.
//
// ⚠️ TABELA QUE AINDA NÃO EXISTE NÃO É ERRO DE TELA. Enquanto a 0211 não roda, a ficha mostra
// "indisponível" na seção do fornecedor, e nada mais na ficha muda. É por isso que `sem-tabela` é um
// motivo próprio, separado da falha de leitura.
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type ContaDoFornecedor = {
  agencia: null | string;
  bancoCodigo: null | string;
  bancoNome: null | string;
  cadastradaEm: string;
  conta: null | string;
  documentoTitular: null | string;
  id: string;
  pixChave: null | string;
  pixTipo: null | string;
  tipoConta: null | string;
  titular: null | string;
};

export type LeituraDasContas =
  | { contas: ContaDoFornecedor[]; ok: true }
  | { motivo: "falha" | "sem-tabela"; ok: false };

type LinhaDaConta = {
  account_number: null | string;
  account_type: null | string;
  agency: null | string;
  bank_code: null | string;
  bank_name: null | string;
  created_at: string;
  holder_document: null | string;
  holder_name: null | string;
  id: string;
  pix_key: null | string;
  pix_key_type: null | string;
};

// 42P01 é o Postgres dizendo que a relação não existe; PGRST205 é o PostgREST dizendo que ela não está
// no cache de schema. As duas querem dizer "a migration ainda não rodou".
function ehTabelaAusente(erro: { code?: string; message?: string }): boolean {
  return (
    erro.code === "42P01" ||
    erro.code === "PGRST205" ||
    /does not exist|could not find the table/i.test(erro.message ?? "")
  );
}

/** As contas ATIVAS da ficha, a mais nova primeiro. */
export async function lerContasDaEntidade(
  adminClient: AdminClient,
  entityId: string,
): Promise<LeituraDasContas> {
  const { data, error } = await adminClient
    .from("apolo_entity_bank_accounts")
    .select(
      "id, bank_code, bank_name, agency, account_number, account_type, pix_key_type, pix_key, holder_name, holder_document, created_at",
    )
    .eq("entity_id", entityId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return { motivo: ehTabelaAusente(error) ? "sem-tabela" : "falha", ok: false };
  }

  return {
    contas: ((data ?? []) as LinhaDaConta[]).map((linha) => ({
      agencia: linha.agency,
      bancoCodigo: linha.bank_code,
      bancoNome: linha.bank_name,
      cadastradaEm: linha.created_at,
      conta: linha.account_number,
      documentoTitular: linha.holder_document,
      id: linha.id,
      pixChave: linha.pix_key,
      pixTipo: linha.pix_key_type,
      tipoConta: linha.account_type,
      titular: linha.holder_name,
    })),
    ok: true,
  };
}
