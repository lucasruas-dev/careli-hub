import { describe, expect, it, vi } from "vitest";

// O ANEXO DA RESERVA DE PJ APARECE NA FICHA DA EMPRESA — a volta completa do elo.
//
// Lucas (26/09/2026): *"na hora da reserva, dentro do hercules, temos que habilitar pessoa fisica e
// pessoa juridica, hoje só atende pessoa fisica"*.
//
// ⚠️ ESTE É O TESTE DA JUNTA, e não de uma ponta só. `app/api/incorporador/venda/documentos/route.ts`
// GRAVA `cliente_documento_hash` a partir do titular da reserva, e `lerDocumentosDaVenda` (aqui)
// PROCURA por `cliente_entity_id` OU por `hashesDaPessoa`. No ramo da reserva a entidade é nula, ou
// seja o hash é o ÚNICO elo: se as duas pontas não hashearem no MESMO namespace, o contrato social
// anexado desaparece da ficha da empresa no CRM e na esteira, sem erro nenhum no log — que é
// exatamente o defeito que este lote existe para fechar.
//
// MEDIDO em 26/09/2026 (produção, só SELECT): as 11 CADs de entidade `pj` da esteira têm
// identificador `cnpj` cujo `value_hash` é igual ao `document_hash` da entidade em 11 de 11 casos, e
// ZERO delas casa com um hash de namespace `cpf`. E `hercules_documentos` tem 51 linhas, ZERO com
// `reserva_id`: o defeito nasceria na primeira reserva de PJ que anexasse documento.

type Linha = Record<string, unknown>;

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => null,
  hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
}));

import { hashIdentifier } from "@/lib/apolo/server";
import { hashDoDocumentoDoComprador } from "@/lib/hercules/hash-do-documento";

import { lerDocumentosDaVenda } from "./documentos";

const CNPJ = "12345678000195";
const EMPRESA = "ent-acme";

/**
 * Banco falso que RESPEITA os filtros: é isso que faz o teste notar quando a busca pergunta pela
 * coluna errada ou pelo hash errado. Um dublê que ignorasse os filtros passaria com o elo quebrado.
 */
function clienteFalso(cfg: { documentos: Linha[]; identificadores: Linha[] }) {
  const from = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    const base = () => {
      if (tabela === "hercules_documentos") return cfg.documentos;
      if (tabela === "apolo_entity_identifiers") return cfg.identificadores;
      return [];
    };
    const resultado = () => ({ data: base().filter((l) => filtros.every((f) => f(l))), error: null });
    const cadeia: Record<string, unknown> = {
      then: (aceitar: (r: unknown) => unknown) => Promise.resolve(resultado()).then(aceitar),
    };
    cadeia.eq = (coluna: string, valor: unknown) => {
      filtros.push((l) => l[coluna] === valor);
      return cadeia;
    };
    cadeia.in = (coluna: string, valores: unknown[]) => {
      filtros.push((l) => valores.includes(l[coluna]));
      return cadeia;
    };
    cadeia.is = (coluna: string, valor: unknown) => {
      filtros.push((l) => (l[coluna] ?? null) === valor);
      return cadeia;
    };
    cadeia.limit = () => cadeia;
    cadeia.order = () => cadeia;
    cadeia.select = () => cadeia;
    // `apolo_entities` é consultada com `.maybeSingle()`: a entidade veio do sync do C2X, então
    // `document_hash` é NULO e o documento mora só em `apolo_entity_identifiers` (era 153 de 4.286).
    cadeia.maybeSingle = () => ({
      then: (aceitar: (r: unknown) => unknown) =>
        Promise.resolve({ data: { document_hash: null }, error: null }).then(aceitar),
    });
    return cadeia;
  };
  return { from } as never;
}

const documento = (hash: null | string): Linha => ({
  cliente_documento_hash: hash,
  // ⚠️ NULO DE PROPÓSITO: no ramo da RESERVA não existe entidade, e é por isso que o hash é o único
  // elo. Com entidade preenchida o teste passaria mesmo com o hash errado, e não provaria nada.
  cliente_entity_id: null,
  criado_em: "2026-09-26T12:00:00.000Z",
  empreendimento_codigo: null,
  id: "doc-1",
  nome: "Contrato social.pdf",
  protocolo_numero: 123,
  removido_em: null,
  tipo: "documento",
  workspace_id: "careli",
});

describe("lerDocumentosDaVenda com titular pessoa jurídica", () => {
  it("⚠️ o anexo gravado sob reserva de PJ é achado pela ficha da empresa", async () => {
    // O hash gravado é o que a ROTA grava, calculado pela mesma peça — não um literal reescrito à
    // mão aqui, que provaria a aritmética do teste em vez da costura.
    const gravadoPelaRota = hashDoDocumentoDoComprador(CNPJ);
    expect(gravadoPelaRota).toBe(hashIdentifier("cnpj", CNPJ));

    const admin = clienteFalso({
      documentos: [documento(gravadoPelaRota)],
      identificadores: [{ entity_id: EMPRESA, value_hash: hashIdentifier("cnpj", CNPJ) }],
    });

    const achados = await lerDocumentosDaVenda(admin, EMPRESA);
    expect(achados.map((d) => d.id)).toEqual(["doc-1"]);
  });

  it("⚠️ hasheado como CPF, o mesmo anexo NÃO aparece — era este o defeito", async () => {
    // `hashIdentifier` concatena "apolo-identifier:TIPO:valor": um CNPJ hasheado como "cpf" gera
    // uma chave que não existe em lugar nenhum do banco, e o `.in(...)` nunca casa. Sem erro nenhum
    // no log, o RG, o comprovante e o contrato social somem da ficha do cliente.
    const admin = clienteFalso({
      documentos: [documento(hashIdentifier("cpf", CNPJ))],
      identificadores: [{ entity_id: EMPRESA, value_hash: hashIdentifier("cnpj", CNPJ) }],
    });

    expect(await lerDocumentosDaVenda(admin, EMPRESA)).toEqual([]);
  });

  it("⚠️ com hash NULO o anexo também some, e é o que a leitura antiga produzia", async () => {
    // Era o caminho exato da falha: a rota lia SÓ a chave `cpf` do jsonb, que numa reserva de PJ não
    // existe, `hashDoDocumentoDoComprador("")` devolvia null, e os DOIS elos nasciam nulos.
    expect(hashDoDocumentoDoComprador("")).toBeNull();

    const admin = clienteFalso({
      documentos: [documento(null)],
      identificadores: [{ entity_id: EMPRESA, value_hash: hashIdentifier("cnpj", CNPJ) }],
    });

    expect(await lerDocumentosDaVenda(admin, EMPRESA)).toEqual([]);
  });
});
