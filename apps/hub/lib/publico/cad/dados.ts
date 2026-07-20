// Superfície FECHADA de dados do formulário público de CAD.
//
// ⚠️ REGRA: as rotas de /api/publico/* importam SÓ este módulo. Elas nunca chamam
// `createApoloAdminClient()` e saem fazendo `.from(...)` livre. O service role ignora RLS e
// alcança o banco inteiro; numa rota anônima o único limite é o código, então o limite tem que
// ser auditável lendo UM arquivo. Cada função aqui só consegue responder por um documento
// específico: não existe caminho para listar a base.
//
// Toda escrita checa `error` e aborta. Já houve falha SILENCIOSA por upsert do PostgREST em
// coluna NOT NULL sem default (21/jul, 11 fichas ficaram indexadas pelo nome antigo).
import { createApoloEntity } from "@/lib/apolo/cadastro-persist";
import { listEmpreendimentosAtivos } from "@/lib/apolo/credenciamento";
import { hashIdentifier, type createApoloAdminClient } from "@/lib/apolo/server";
import {
  filtrarEmpreendimentosHabilitados,
  normalizarCnpj,
  normalizarCpf,
  type DadosCorretor,
  type EmpreendimentoPublico,
  type VinculoCorretor,
} from "@/lib/publico/cad/regras";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// Papel que marca a imobiliária como NOSSA PARCEIRA, e o status que significa "credenciada".
// Existir na base não é estar credenciada: o sync do C2X traz PJ que nunca falou conosco.
const PERFIL_IMOBILIARIA = "imobiliaria";
const PERFIL_CORRETOR = "corretor";
const STATUS_CREDENCIADA = "active";

// ---------------------------------------------------------------------------
// S0 — identificação do corretor pelo CPF
// ---------------------------------------------------------------------------

export type CorretorEncontrado = {
  candidatos: VinculoCorretor[];
  // Desempate do corretor (o nome não serve como chave). Vem do relacionamento com a
  // imobiliária, que é onde o cadastro público o grava.
  email: string;
  entityId: string;
  nome: string;
};

// Lookup INDEXADO: `apolo_entity_identifiers_lookup_idx (identifier_type, value_hash)`.
// É por isso que o corretor nasce ENTIDADE e não relationship: como relationship o CPF mora em
// `metadata->>'cpf'`, sem índice nenhum, e esta é a rota que todo corretor atravessa.
export async function buscarCorretorPorCpf(
  adminClient: AdminClient,
  cpf: string,
): Promise<CorretorEncontrado | null> {
  const digits = normalizarCpf(cpf);
  if (digits.length !== 11) return null;

  const { data: ids, error: idsError } = await adminClient
    .from("apolo_entity_identifiers")
    .select("entity_id")
    .eq("identifier_type", "cpf")
    .eq("value_hash", hashIdentifier("cpf", digits))
    .limit(20);

  // Erro de leitura NÃO pode virar "não encontrado": mandaria um corretor já cadastrado para
  // o fluxo de auto-cadastro e criaria uma segunda entidade com o mesmo CPF.
  if (idsError) throw new Error(`Falha ao consultar identificadores: ${idsError.message}`);
  const entityIds = (ids ?? []).map((row) => (row as { entity_id: string }).entity_id);
  if (!entityIds.length) return null;

  const { data: perfis, error: perfisError } = await adminClient
    .from("apolo_entity_profiles")
    .select("entity_id")
    .in("entity_id", entityIds)
    .eq("profile", PERFIL_CORRETOR)
    .limit(20);
  if (perfisError) throw new Error(`Falha ao consultar papéis: ${perfisError.message}`);

  const corretorId = (perfis ?? [])[0] as { entity_id: string } | undefined;
  if (!corretorId?.entity_id) return null;

  const { data: entidade, error: entidadeError } = await adminClient
    .from("apolo_entities")
    .select("id, display_name")
    .eq("id", corretorId.entity_id)
    .maybeSingle<{ display_name: string | null; id: string }>();
  if (entidadeError) throw new Error(`Falha ao ler o corretor: ${entidadeError.message}`);
  if (!entidade?.id) return null;

  const { candidatos, email } = await imobiliariasDoCorretor(adminClient, entidade.id);
  return { candidatos, email, entityId: entidade.id, nome: entidade.display_name ?? "" };
}

// As imobiliárias a que o corretor está pendurado. O relacionamento é ENTRE ENTIDADES
// (`related_entity_id` real), o que é a diferença para o corretor-de-texto do wizard interno:
// lá o vínculo seria por nome, e nome não desempata dois Henriques.
async function imobiliariasDoCorretor(
  adminClient: AdminClient,
  corretorEntityId: string,
): Promise<{ candidatos: VinculoCorretor[]; email: string }> {
  const { data, error } = await adminClient
    .from("apolo_relationships")
    .select("entity_id, metadata")
    .eq("related_entity_id", corretorEntityId)
    .eq("relationship_type", PERFIL_CORRETOR)
    .limit(50);
  if (error) throw new Error(`Falha ao ler vínculos: ${error.message}`);

  const linhas = (data ?? []) as { entity_id: string; metadata: { email?: string } | null }[];
  const email = linhas.map((row) => row.metadata?.email).find(Boolean) ?? "";

  const imobIds = Array.from(new Set(linhas.map((row) => row.entity_id))).filter(Boolean);
  if (!imobIds.length) return { candidatos: [], email };

  const [{ data: entidades, error: entidadesError }, { data: perfis, error: perfisError }] =
    await Promise.all([
      adminClient
        .from("apolo_entities")
        .select("id, display_name, legal_name")
        .in("id", imobIds)
        .limit(50),
      adminClient
        .from("apolo_entity_profiles")
        .select("entity_id, status")
        .in("entity_id", imobIds)
        .eq("profile", PERFIL_IMOBILIARIA)
        .limit(50),
    ]);
  if (entidadesError) throw new Error(`Falha ao ler imobiliárias: ${entidadesError.message}`);
  if (perfisError) throw new Error(`Falha ao ler credenciamento: ${perfisError.message}`);

  const ativaPorId = new Map(
    ((perfis ?? []) as { entity_id: string; status: string | null }[]).map((row) => [
      row.entity_id,
      row.status === STATUS_CREDENCIADA,
    ]),
  );

  const candidatos = (
    (entidades ?? []) as { display_name: string | null; id: string; legal_name: string | null }[]
  ).map((row) => ({
    imobiliariaAtiva: ativaPorId.get(row.id) ?? false,
    imobiliariaEntityId: row.id,
    imobiliariaNome: row.legal_name || row.display_name || "Imobiliária",
  }));

  return { candidatos, email };
}

// ---------------------------------------------------------------------------
// S1 — a imobiliária está credenciada?
// ---------------------------------------------------------------------------

export type ImobiliariaCredenciada = {
  credenciada: boolean;
  entityId: string | null;
  nome: string | null;
};

// Versão endurecida de `consultarImobiliariaPorCnpj`, que não serve aqui por dois motivos:
//  1. ela não checa `error` do `.maybeSingle()` — dois CNPJs com o mesmo hash devolvem erro e a
//     função responde "não encontrada" em silêncio (a armadilha de 21/jul);
//  2. `encontrada: true` só prova que existe alguma PJ com esse CNPJ no read-model, o que
//     inclui PJ trazida pelo sync do C2X que nunca se credenciou conosco.
export async function consultarImobiliariaCredenciada(
  adminClient: AdminClient,
  cnpj: string,
): Promise<ImobiliariaCredenciada> {
  const vazio: ImobiliariaCredenciada = { credenciada: false, entityId: null, nome: null };
  const digits = normalizarCnpj(cnpj);
  if (digits.length !== 14) return vazio;

  const hash = hashIdentifier("cnpj", digits);

  // ⚠️ O CNPJ MORA EM DOIS LUGARES, e só um deles está preenchido para quem interessa.
  //
  // `apolo_entities.document_hash` só é gravado por quem NASCE no Apolo (o wizard). As
  // imobiliárias reais vieram do sync do C2X e têm esse campo NULO — o CNPJ delas está em
  // `apolo_entity_identifiers.value_hash`. Medido em produção 20/jul: **0 de 412** imobiliárias
  // com document_hash, **395** com identificador de CNPJ.
  //
  // Buscar só por document_hash reprovava TODAS as imobiliárias de verdade. Foi exatamente o que
  // o Lucas viu no primeiro teste: digitou o CNPJ da RAIANE IMOBILIARIA, que é parceira e tem CAD
  // nossa, e o portal respondeu "não credenciada".
  const { data: ident, error: identError } = await adminClient
    .from("apolo_entity_identifiers")
    .select("entity_id")
    .eq("identifier_type", "cnpj")
    .eq("value_hash", hash)
    .limit(5);
  if (identError) throw new Error(`Falha ao consultar o CNPJ: ${identError.message}`);

  const idsPorIdentificador = ((ident ?? []) as { entity_id: string }[]).map((r) => r.entity_id);

  // Fallback para quem nasceu no Apolo (wizard), que grava o hash na própria entidade.
  const { data: porDocumento, error } = await adminClient
    .from("apolo_entities")
    .select("id")
    .eq("document_hash", hash)
    .limit(5);
  if (error) throw new Error(`Falha ao consultar o CNPJ: ${error.message}`);

  const ids = Array.from(
    new Set([...idsPorIdentificador, ...((porDocumento ?? []) as { id: string }[]).map((r) => r.id)]),
  );
  if (!ids.length) return vazio;

  const { data, error: entidadesError } = await adminClient
    .from("apolo_entities")
    .select("id, display_name, legal_name")
    .in("id", ids)
    .limit(5);
  if (entidadesError) throw new Error(`Falha ao consultar o CNPJ: ${entidadesError.message}`);

  const linhas = (data ?? []) as { display_name: string | null; id: string; legal_name: string | null }[];
  if (!linhas.length) return vazio;

  const { data: perfis, error: perfisError } = await adminClient
    .from("apolo_entity_profiles")
    .select("entity_id, status")
    .in("entity_id", linhas.map((l) => l.id))
    .eq("profile", PERFIL_IMOBILIARIA)
    .eq("status", STATUS_CREDENCIADA)
    .limit(5);
  if (perfisError) throw new Error(`Falha ao consultar credenciamento: ${perfisError.message}`);

  const credenciadaId = ((perfis ?? []) as { entity_id: string }[])[0]?.entity_id;
  if (!credenciadaId) return vazio;

  const entidade = linhas.find((l) => l.id === credenciadaId);
  return {
    credenciada: true,
    entityId: credenciadaId,
    nome: entidade?.legal_name || entidade?.display_name || "Imobiliária",
  };
}

// ---------------------------------------------------------------------------
// S5 — empreendimentos habilitados
// ---------------------------------------------------------------------------

export async function empreendimentosHabilitados(
  adminClient: AdminClient,
  imobiliariaEntityId: string,
): Promise<EmpreendimentoPublico[]> {
  const [credenciados, ativos] = await Promise.all([
    empreendimentosCredenciados(adminClient, imobiliariaEntityId),
    listEmpreendimentosAtivos(adminClient),
  ]);
  return filtrarEmpreendimentosHabilitados(credenciados, ativos);
}

// Só o vínculo EXPLÍCITO (relationship 'empreendimento'), nunca o histórico de vendas do C2X.
async function empreendimentosCredenciados(
  adminClient: AdminClient,
  imobiliariaEntityId: string,
): Promise<string[]> {
  const { data, error } = await adminClient
    .from("apolo_relationships")
    .select("metadata, status")
    .eq("entity_id", imobiliariaEntityId)
    .eq("relationship_type", "empreendimento")
    .limit(500);
  if (error) throw new Error(`Falha ao ler habilitações: ${error.message}`);

  return ((data ?? []) as { metadata: { enterpriseId?: string } | null; status: string | null }[])
    // 'verified' = habilitação aprovada por nós. 'pending' é pedido em análise e NÃO autoriza
    // envio de CAD (ver a pendência 2 do relatório: o auto-cadastro passa a nascer 'pending').
    .filter((row) => row.status === "verified")
    .map((row) => row.metadata?.enterpriseId)
    .filter((id): id is string => Boolean(id));
}

// ---------------------------------------------------------------------------
// S4 — criação do corretor
// ---------------------------------------------------------------------------

export type CriarCorretorResultado =
  | { entityId: string; ok: true }
  | { error: string; ok: false };

// Idempotente por CPF: duplo-toque no celular (que é a regra, não a exceção, num botão de
// envio em 4G) não pode gerar dois corretores.
export async function criarCorretor(
  adminClient: AdminClient,
  input: { dados: DadosCorretor; imobiliariaEntityId: string; imobiliariaNome: string },
): Promise<CriarCorretorResultado> {
  const existente = await buscarCorretorPorCpf(adminClient, input.dados.cpf);
  if (existente) {
    const jaLigado = existente.candidatos.some(
      (c) => c.imobiliariaEntityId === input.imobiliariaEntityId,
    );
    if (!jaLigado) {
      const ligacao = await ligarCorretorNaImobiliaria(adminClient, {
        corretorEntityId: existente.entityId,
        corretorNome: existente.nome || input.dados.nome,
        creci: input.dados.creci,
        email: input.dados.email,
        imobiliariaEntityId: input.imobiliariaEntityId,
        telefone: input.dados.telefone,
      });
      if (!ligacao.ok) return ligacao;
    }
    return { entityId: existente.entityId, ok: true };
  }

  // A entidade PF do corretor. `createApoloEntity` já grava documento hasheado,
  // identificadores, contatos e o índice de busca — o CPF nunca fica em claro.
  const criado = await createApoloEntity(adminClient, {
    identidade: { cpf: input.dados.cpf, nome: input.dados.nome },
    origem: "publico-cad",
    // Sem operador logado: o corretor se cadastrou sozinho. `ownerUserId` null já é caminho
    // suportado (o UUID_RE de cadastro-persist descarta o que não for uuid).
    ownerUserId: null,
    perfil: { email: input.dados.email, telefone: input.dados.telefone },
    persona: "pf",
    role: "corretor",
  });

  if (!criado.ok) return { error: criado.error, ok: false };

  const ligacao = await ligarCorretorNaImobiliaria(adminClient, {
    corretorEntityId: criado.entityId,
    corretorNome: input.dados.nome,
    creci: input.dados.creci,
    email: input.dados.email,
    imobiliariaEntityId: input.imobiliariaEntityId,
    telefone: input.dados.telefone,
  });
  if (!ligacao.ok) return ligacao;

  return { entityId: criado.entityId, ok: true };
}

// O grafo: imobiliária --corretor--> corretor, com `related_entity_id` REAL.
async function ligarCorretorNaImobiliaria(
  adminClient: AdminClient,
  input: {
    corretorEntityId: string;
    corretorNome: string;
    creci: string;
    email: string;
    imobiliariaEntityId: string;
    telefone: string;
  },
): Promise<{ error: string; ok: false } | { ok: true }> {
  const { error } = await adminClient.from("apolo_relationships").insert({
    entity_id: input.imobiliariaEntityId,
    label: input.corretorNome,
    metadata: {
      // ⚠️ SEM `cpf` em texto puro aqui. O wizard interno grava, e é passivo de PII que o
      // fluxo público não replica: o CPF já está hasheado em apolo_entity_identifiers.
      creci: input.creci || null,
      email: input.email || null,
      kind: "trabalho",
      phone: input.telefone || null,
      role: "corretor",
      source: "publico-cad",
    },
    related_entity_id: input.corretorEntityId,
    relationship_type: "corretor",
    status: "verified",
  });

  if (error) {
    return { error: `Não foi possível vincular o corretor: ${error.message}`, ok: false };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// S10 — vínculo da CAD (à prova do sync do C2X)
// ---------------------------------------------------------------------------

export type VinculoCad = {
  corretorEntityId: string;
  corretorEmail: string;
  corretorNome: string;
  empreendimentoNome: string;
  enterpriseId: string;
  imobiliariaEntityId: string;
  imobiliariaNome: string;
  prospectEntityId: string;
  sessaoId: string;
};

// Grava em `apolo_esteira`, que existe EXATAMENTE porque o sync do C2X faz upsert
// SUBSTITUINDO `apolo_entities.metadata` inteiro (incidente 20/jul: 122 CADs perderam etapa).
// Estado operacional nunca vai em metadata.
//
// ⚠️ Esta escrita NÃO é best-effort: se falhar, o cadastro falha. É o oposto do upload de
// documento, e é intencional: documento que falta pode ser reenviado; CAD órfã de vínculo é
// dado corrompido, e foi para impedir isso que a CHECK constraint da 0061 existe.
//
// ⚠️⚠️ DEPENDE DAS MIGRATIONS 0060 (corretor_email) E 0061 (corretor_entity_id,
// imobiliaria_entity_id, enterprise_id) ESTAREM APLICADAS. Enquanto não estiverem, as colunas
// não existem e este upsert falha, derrubando o envio com a mensagem genérica. Isso é
// PROPOSITAL: o alternativo seria gravar a CAD sem vínculo, que é exatamente o dado corrompido
// que estamos impedindo. Ver as pendências de OK no relatório.
export async function gravarVinculoEsteira(
  adminClient: AdminClient,
  vinculo: VinculoCad,
): Promise<{ error: string; ok: false } | { ok: true }> {
  const { error } = await adminClient.from("apolo_esteira").upsert(
    {
      chegou_em: new Date().toISOString(),
      corretor: vinculo.corretorNome,
      corretor_email: vinculo.corretorEmail || null,
      corretor_entity_id: vinculo.corretorEntityId,
      empreendimento: vinculo.empreendimentoNome,
      enterprise_id: vinculo.enterpriseId,
      entity_id: vinculo.prospectEntityId,
      // A CAD pública entra na mesma fila das demais; o que a distingue é `origem`, que é o
      // que permite a Torre saber que veio de fora sem criar etapa nova.
      etapa: "validacao",
      imobiliaria: vinculo.imobiliariaNome,
      imobiliaria_entity_id: vinculo.imobiliariaEntityId,
      origem: "publico-cad",
    },
    { onConflict: "entity_id" },
  );

  if (error) {
    return { error: `Não foi possível registrar o vínculo da CAD: ${error.message}`, ok: false };
  }
  return { ok: true };
}

// Trilha de auditoria: quem enviou, por qual sessão. Best-effort de propósito (a CAD e o
// vínculo já estão gravados; perder a trilha não justifica derrubar o envio do corretor).
export async function registrarOrigemPublica(
  adminClient: AdminClient,
  vinculo: VinculoCad,
  protocolo: string,
): Promise<string | null> {
  const { error } = await adminClient.from("apolo_source_links").insert({
    entity_id: vinculo.prospectEntityId,
    metadata: {
      corretorEntityId: vinculo.corretorEntityId,
      corretorEmail: vinculo.corretorEmail || null,
      enterpriseId: vinculo.enterpriseId,
      imobiliariaEntityId: vinculo.imobiliariaEntityId,
      protocolo,
      sessaoId: vinculo.sessaoId,
    },
    source_id: protocolo,
    source_system: "publico-cad",
    source_table: "formulario_corretor",
  });
  return error ? `trilha de origem: ${error.message}` : null;
}

// Nome do empreendimento para imprimir na CAD e na fila do Board.
export async function nomeDoEmpreendimento(
  adminClient: AdminClient,
  enterpriseId: string,
): Promise<string> {
  const ativos = await listEmpreendimentosAtivos(adminClient);
  return ativos.find((emp) => String(emp.id) === String(enterpriseId))?.name ?? "";
}
