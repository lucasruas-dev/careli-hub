// EDIÇÃO DE IDENTIDADE de uma ficha do Apolo: nome, documento e tipo PF/PJ.
//
// Por que isto existe: as CADs do Vale do Ouro foram importadas antes da triagem que o
// formulário novo faz. A leitura de documentos para no primeiro anexo com CPF válido — no PDF
// do casal esse costuma ser o do CÔNJUGE — e a JFL (pessoa jurídica) entrou como física com o
// CPF do representante. O operador precisa poder colocar cada um no seu lugar.
//
// ⚠️ Este é o caminho mais destrutivo do módulo: troca a identidade de um cliente real. A
// ordem das operações abaixo NÃO é estilo, é o que impede quatro estragos concretos que uma
// auditoria adversarial do código levantou. Cada passo diz qual.
import {
  cnpjValido,
  cpfValido,
  documentoCombinaComTipo,
  formatarDocumento,
  soDigitos,
  tipoDoDocumento,
} from "@/lib/apolo/documento";
import { hashIdentifier, type createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type ResultadoIdentidade =
  | { erro: string; motivo: "bloqueado" | "colisao" | "invalido" | "nao_encontrada"; ok: false }
  | { ok: true };

// Mesma normalização que o índice de busca do Apolo usa (server.ts:4950).
function normalizarBusca(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function ehUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}

export async function atualizarIdentidade(input: {
  autorUserId: string | null;
  client: AdminClient;
  documento: string;
  entityId: string;
  motivo: string;
  nome: string;
  // Só PJ: nome fantasia.
  nomeFantasia?: string | null;
  tipo: "pf" | "pj";
}): Promise<ResultadoIdentidade> {
  const nome = input.nome.trim();
  const motivo = input.motivo.trim();
  const digitos = soDigitos(input.documento);

  if (!nome) return { erro: "Nome obrigatorio.", motivo: "invalido", ok: false };
  if (!motivo) {
    return { erro: "Informe o motivo da correcao.", motivo: "invalido", ok: false };
  }

  // (1) ORIGEM. Entidade vinda do C2X é ESPELHO: tem id determinístico e o resync completo
  // (cron de 6 em 6 horas) reescreve a linha inteira — display_name, legal_name, entity_kind,
  // document_* e metadata. Gravar aqui é trabalho jogado fora, e o pior tipo: some sem erro,
  // horas depois, e ninguém liga uma coisa à outra. A correção dessas é no legado.
  const { data: origem } = await input.client
    .from("apolo_source_links")
    .select("source_system")
    .eq("entity_id", input.entityId)
    .eq("source_system", "c2x")
    .limit(1)
    .maybeSingle();

  if (origem) {
    return {
      erro:
        "Esta ficha e espelho do C2X: a correcao tem que ser feita no legado, senao o sync " +
        "desfaz em ate 6 horas.",
      motivo: "bloqueado",
      ok: false,
    };
  }

  const { data: entidade } = await input.client
    .from("apolo_entities")
    .select("id, display_name, document_masked, entity_kind")
    .eq("id", input.entityId)
    .maybeSingle<{
      display_name: string;
      document_masked: string | null;
      entity_kind: string;
      id: string;
    }>();

  if (!entidade) {
    return { erro: "Ficha nao encontrada.", motivo: "nao_encontrada", ok: false };
  }

  // (2) DÍGITO VERIFICADOR e (3) COERÊNCIA com o tipo. O banco não tem CHECK que impeça PJ
  // com CPF — foi exatamente assim que a JFL entrou.
  const combina = documentoCombinaComTipo(input.tipo, digitos);
  if (!combina.ok) {
    return { erro: combina.erro ?? "Documento invalido.", motivo: "invalido", ok: false };
  }

  const tipoDoc = tipoDoDocumento(digitos);
  if (!tipoDoc) return { erro: "Documento invalido.", motivo: "invalido", ok: false };

  const hash = hashIdentifier(tipoDoc, digitos);

  // (4) COLISÃO. Não existe índice único em document_hash (a migration 0026 dropou), então
  // duas fichas com o mesmo CPF são possíveis no banco — e já aconteceu. Checar em código é a
  // única barreira. Consulta as DUAS fontes porque as entidades do C2X têm document_hash nulo
  // e guardam o CPF só em apolo_entity_identifiers.
  const [{ data: porColuna }, { data: porIdentificador }] = await Promise.all([
    input.client
      .from("apolo_entities")
      .select("id, display_name")
      .eq("document_hash", hash)
      .neq("id", input.entityId)
      .limit(1)
      .maybeSingle(),
    input.client
      .from("apolo_entity_identifiers")
      .select("entity_id")
      .in("identifier_type", ["cpf", "cnpj"])
      .eq("value_hash", hash)
      .neq("entity_id", input.entityId)
      .limit(1)
      .maybeSingle(),
  ]);

  const donoId =
    (porColuna as { display_name: string; id: string } | null)?.id ??
    (porIdentificador as { entity_id: string } | null)?.entity_id ??
    null;

  if (donoId) {
    const { data: dono } = await input.client
      .from("apolo_entities")
      .select("display_name")
      .eq("id", donoId)
      .maybeSingle<{ display_name: string }>();
    return {
      erro: `Este documento ja pertence a outra ficha (${dono?.display_name ?? donoId}).`,
      motivo: "colisao",
      ok: false,
    };
  }

  const documentoCompleto = formatarDocumento(digitos);
  const ehPj = input.tipo === "pj";

  // (5) A ENTIDADE. `update` de colunas nomeadas, nunca do metadata inteiro (substituiria o
  // jsonb e apagaria o que o sync e o cadastro escreveram lá).
  const { error: erroEntidade } = await input.client
    .from("apolo_entities")
    .update({
      display_name: nome,
      document_hash: hash,
      document_kind: tipoDoc,
      // Formato COMPLETO: é como o sync do C2X grava (4.133 registros) e como a busca indexa.
      document_masked: documentoCompleto,
      entity_kind: input.tipo,
      legal_name: ehPj ? nome : null,
      trade_name: ehPj ? (input.nomeFantasia?.trim() || null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.entityId);

  if (erroEntidade) {
    return { erro: erroEntidade.message, motivo: "invalido", ok: false };
  }

  // (6) IDENTIFICADORES: DELETE e depois INSERT. **Nunca upsert.** A chave única é
  // (entity_id, identifier_type, value_hash), então um upsert com o CPF novo NÃO apaga o
  // antigo: a pessoa ficaria com dois CPFs, ambos is_primary. E a CACÁ procura cliente por
  // essa tabela (lookupApoloByDocument) — ela passaria a atender a pessoa errada.
  await input.client
    .from("apolo_entity_identifiers")
    .delete()
    .eq("entity_id", input.entityId)
    .in("identifier_type", ["cpf", "cnpj"]);

  await input.client.from("apolo_entity_identifiers").insert({
    confidence_score: 100,
    entity_id: input.entityId,
    identifier_type: tipoDoc,
    is_primary: true,
    metadata: { source: "apolo", origem: "board-validacao" },
    source_system: "apolo",
    value_hash: hash,
    value_masked: documentoCompleto,
    verified_at: new Date().toISOString(),
  });

  // (7) ÍNDICE DE BUSCA. Sem recalcular `normalized_text`, a ficha continua indexada pelo nome
  // ANTIGO: o Apolo, a Iris e a CACÁ fazem ilike nesse campo. O cliente existiria e ninguém
  // conseguiria achar.
  await input.client.from("apolo_search_entries").upsert(
    {
      display_name: nome,
      document_masked: documentoCompleto,
      entity_id: input.entityId,
      entity_kind: input.tipo,
      last_synced_at: new Date().toISOString(),
      normalized_text: normalizarBusca(
        [nome, ehPj ? input.nomeFantasia : null, documentoCompleto].filter(Boolean).join(" "),
      ),
    },
    { onConflict: "entity_id" },
  );

  // (8) AUDITORIA. `insert` puro — id determinístico seria sobrescrito pelo sync, que usa
  // esse padrão para os eventos dele. O documento vai MASCARADO no registro: auditoria não é
  // lugar de guardar CPF por extenso.
  await input.client.from("apolo_audit_events").insert({
    action: "edit_identity",
    actor_user_id: input.autorUserId && ehUuid(input.autorUserId) ? input.autorUserId : null,
    entity_id: input.entityId,
    field_name: "identidade",
    metadata: {
      de: {
        documento: entidade.document_masked,
        nome: entidade.display_name,
        tipo: entidade.entity_kind,
      },
      motivo,
      origem: "board-validacao",
      para: {
        documento: documentoCompleto.replace(/\d(?=\d{2})/g, "*"),
        nome,
        tipo: input.tipo,
      },
    },
    status: "mapped",
  });

  // (9) A esteira guarda o motivo, para a fila mostrar por que a ficha foi mexida.
  await input.client
    .from("apolo_esteira")
    .update({ motivo })
    .eq("entity_id", input.entityId);

  return { ok: true };
}

export { cnpjValido, cpfValido };
