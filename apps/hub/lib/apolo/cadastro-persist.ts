// Persistencia do cadastro manual do Apolo: cria uma ENTIDADE (PF/PJ) a partir de um PAPEL de
// nascimento. Hoje o unico processo ligado e o do PROSPECT; os demais papeis (imobiliaria,
// corretor, fornecedor...) reusam esta camada depois. Escreve coordenadamente nas tabelas
// apolo_* (via service role; RLS so libera SELECT), espelhando o que o sync do C2X ja faz.
// Ver [[project_apolo_cadastro_prospect]], [[project_apolo_crm_grafo]].
import { createApoloAdminClient, hashIdentifier } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// Papel de nascimento da entidade. So 'prospect' esta ligado por enquanto; os outros ja existem
// no enum de apolo_entity_profiles e entram quando cada processo for construido.
export type ApoloBirthRole =
  | "prospect"
  | "imobiliaria"
  | "corretor"
  | "fornecedor"
  | "incorporador"
  | "parceiro"
  | "colaborador";

export type CreateApoloEntityInput = {
  role: ApoloBirthRole;
  persona: "pf" | "pj";
  origem?: string;
  ownerUserId?: string | null;
  identidade?: {
    cpf?: string;
    dataNascimento?: string;
    nacionalidade?: string;
    naturalidade?: string;
    nome?: string;
    nomeMae?: string;
    nomePai?: string;
    orgaoEmissor?: string;
  } | null;
  empresa?: {
    atividade?: string;
    capitalSocial?: string;
    cnae?: string;
    cnpj?: string;
    dataAbertura?: string;
    naturezaJuridica?: string;
    nomeFantasia?: string;
    porte?: string;
    razaoSocial?: string;
    situacaoCadastral?: string;
    socios?: Array<{ nome: string; qualificacao: string }>;
  } | null;
  perfil?: {
    email?: string;
    escolaridadeId?: string;
    estadoCivilId?: string;
    imobiliariaId?: string;
    imobiliariaLabel?: string;
    patrimonio?: string;
    profissaoId?: string;
    // Regime de bens (property_regimes do C2X) — só casado / união estável.
    regimeBensId?: string;
    rendaId?: string;
    sexoId?: string;
    telefone?: string;
  } | null;
  endereco?: {
    bairro?: string;
    cep?: string;
    cidade?: string;
    complemento?: string;
    logradouro?: string;
    numero?: string;
    uf?: string;
  } | null;
  conjuge?: {
    cpf?: string;
    dataNascimento?: string;
    email?: string;
    nome?: string;
    nomeMae?: string;
    telefone?: string;
  } | null;
};

export type CreateApoloEntityResult =
  | { autenticacao: string; entityId: string; ok: true; warnings: string[] }
  | { error: string; ok: false };

// Codigo de autenticacao da CAD. A forca dele NAO esta no segredo: esta em ser gerado no
// SERVIDOR e ficar registrado na entidade -- conferir uma CAD e perguntar ao banco se o codigo
// existe e bate com aquela ficha. CAD forjada com codigo inventado nao acha par no banco.
// (Gerar isso no browser nao autenticaria nada: o forjador roda o mesmo codigo.)
function gerarCodigoAutenticacao(entityId: string, criadoEm: Date): string {
  const hash = hashIdentifier("cad-autenticacao", entityId).slice(0, 8).toUpperCase();
  return `CAD-${criadoEm.getFullYear()}-${hash}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createApoloEntity(
  adminClient: AdminClient,
  input: CreateApoloEntityInput,
): Promise<CreateApoloEntityResult> {
  const isPj = input.persona === "pj";
  const identidade = input.identidade ?? {};
  const empresa = input.empresa ?? {};
  const perfil = input.perfil ?? {};
  const endereco = input.endereco ?? {};

  const rawDoc = isPj ? empresa.cnpj : identidade.cpf;
  const digits = onlyDigits(rawDoc);
  const docKind = documentKind(digits); // 'cpf' | 'cnpj' | null

  const displayName = text(
    isPj ? empresa.razaoSocial || empresa.nomeFantasia : identidade.nome,
  );
  if (!displayName) {
    return { error: "Sem nome/razao social para criar a entidade.", ok: false };
  }
  if (!docKind) {
    return { error: "Documento (CPF/CNPJ) invalido ou ausente.", ok: false };
  }

  const ownerUserId =
    input.ownerUserId && UUID_RE.test(input.ownerUserId) ? input.ownerUserId : null;
  const email = text(perfil.email);
  const telefone = text(perfil.telefone);
  const location = { city: text(endereco.cidade), state: text(endereco.uf) };

  // Guarda o demografico/PJ que nao tem coluna propria no core do Apolo (o CAD detalhado vai
  // pro drive; aqui fica o essencial pra ficha e pro futuro write-back ao C2X).
  const cadastro = pruneEmpty({
    atividade: text(empresa.atividade),
    capitalSocial: text(empresa.capitalSocial),
    cnae: text(empresa.cnae),
    dataAbertura: text(empresa.dataAbertura),
    dataNascimento: text(identidade.dataNascimento),
    escolaridadeId: text(perfil.escolaridadeId),
    estadoCivilId: text(perfil.estadoCivilId),
    nacionalidade: text(identidade.nacionalidade),
    naturalidade: text(identidade.naturalidade),
    naturezaJuridica: text(empresa.naturezaJuridica),
    nomeMae: text(identidade.nomeMae),
    nomePai: text(identidade.nomePai),
    orgaoEmissor: text(identidade.orgaoEmissor),
    patrimonio: text(perfil.patrimonio),
    porte: text(empresa.porte),
    profissaoId: text(perfil.profissaoId),
    regimeBensId: text(perfil.regimeBensId),
    rendaId: text(perfil.rendaId),
    sexoId: text(perfil.sexoId),
    situacaoCadastral: text(empresa.situacaoCadastral),
    socios: (empresa.socios ?? []).filter((s) => text(s?.nome)),
  });

  const entityRow = {
    display_name: displayName,
    document_hash: hashIdentifier(docKind, digits),
    document_kind: docKind,
    document_masked: maskDocument(digits),
    entity_kind: isPj ? "pj" : "pf",
    legal_name: isPj ? text(empresa.razaoSocial) || null : null,
    metadata: {
      bornRole: input.role,
      c2xSynced: false,
      cadastro,
      imobiliariaId: text(perfil.imobiliariaId) || null,
      origem: input.origem || "cadastro",
      source: "apolo",
    },
    owner_user_id: ownerUserId,
    primary_city: location.city || null,
    primary_state: location.state || null,
    quality_score: 0,
    status: "review",
    trade_name: isPj ? text(empresa.nomeFantasia) || null : null,
    workspace_id: "careli",
  };

  const { data: created, error: entityError } = await adminClient
    .from("apolo_entities")
    .insert(entityRow)
    .select("id")
    .single<{ id: string }>();

  if (entityError || !created?.id) {
    return {
      error: `Nao foi possivel criar a entidade: ${entityError?.message ?? "sem id"}`,
      ok: false,
    };
  }

  const entityId = created.id;
  const autenticacao = gerarCodigoAutenticacao(entityId, new Date());
  const warnings: string[] = [];
  const warn = (label: string, error: { message?: string } | null) => {
    if (error) {
      warnings.push(`${label}: ${error.message ?? "falha"}`);
    }
  };

  // Papel de nascimento (prospect etc). Precisa do enum atualizado (migration 0051 pra prospect).
  const profileRows = [
    { entity_id: entityId, profile: input.role, status: "active" },
  ];

  // Identificadores (doc + email + telefone) com o MESMO hash do sync (dedup por documento).
  const identifierRows: Array<Record<string, unknown>> = [
    identifierRow(entityId, docKind, digits, maskDocument(digits), true),
  ];
  if (email) {
    identifierRows.push(
      identifierRow(entityId, "email", email.toLowerCase(), maskEmail(email), false),
    );
  }
  if (onlyDigits(telefone)) {
    identifierRows.push(
      identifierRow(entityId, "phone", onlyDigits(telefone), maskPhone(telefone), false),
    );
  }

  const contactRows: Array<Record<string, unknown>> = [];
  if (email) {
    contactRows.push({
      contact_type: "email",
      entity_id: entityId,
      is_primary: true,
      metadata: { source: "apolo" },
      normalized_value: email.toLowerCase(),
      status: "pending",
      value: email,
    });
  }
  if (telefone) {
    contactRows.push({
      contact_type: "phone",
      entity_id: entityId,
      is_primary: true,
      metadata: { source: "apolo" },
      normalized_value: onlyDigits(telefone),
      status: "pending",
      value: telefone,
    });
  }

  const addressRows: Array<Record<string, unknown>> = [];
  if (text(endereco.logradouro) || text(endereco.cep) || location.city) {
    addressRows.push({
      city: location.city || null,
      complement: text(endereco.complemento) || null,
      country: "BR",
      district: text(endereco.bairro) || null,
      entity_id: entityId,
      is_primary: true,
      label: "Principal",
      metadata: { source: "apolo" },
      number: text(endereco.numero) || null,
      postal_code: text(endereco.cep) || null,
      state: location.state || null,
      status: "pending",
      street: text(endereco.logradouro) || null,
    });
  }

  const relationshipRows: Array<Record<string, unknown>> = [];
  const conjugeNome = text(input.conjuge?.nome);
  if (conjugeNome) {
    relationshipRows.push({
      entity_id: entityId,
      label: conjugeNome,
      metadata: {
        cpf: text(input.conjuge?.cpf) || null,
        createdBy: ownerUserId,
        email: text(input.conjuge?.email) || null,
        kind: "contato",
        phone: text(input.conjuge?.telefone) || null,
        source: "apolo",
      },
      related_entity_id: null,
      relationship_type: "conjuge",
      status: "verified",
    });
  }
  const imobiliariaId = text(perfil.imobiliariaId);
  const imobiliariaLabel = text(perfil.imobiliariaLabel);
  if (imobiliariaId || imobiliariaLabel) {
    relationshipRows.push({
      entity_id: entityId,
      label: imobiliariaLabel || "Imobiliaria",
      metadata: { createdBy: ownerUserId, kind: "trabalho", role: "imobiliaria", source: "apolo" },
      related_entity_id: UUID_RE.test(imobiliariaId) ? imobiliariaId : null,
      relationship_type: "imobiliaria",
      status: "verified",
    });
  }

  const searchRow = {
    display_name: displayName,
    document_masked: maskDocument(digits),
    entity_id: entityId,
    entity_kind: isPj ? "pj" : "pf",
    last_synced_at: new Date().toISOString(),
    location_label: [location.city, location.state].filter(Boolean).join(" - ") || null,
    metadata: { source: "apolo" },
    normalized_text: normalizeSearchText(
      [
        displayName,
        isPj ? text(empresa.nomeFantasia) : null,
        maskDocument(digits),
        location.city,
        location.state,
        ROLE_SEARCH_LABEL[input.role],
        email,
        telefone,
        imobiliariaLabel,
      ]
        .filter(Boolean)
        .join(" "),
    ),
    profile_labels: [ROLE_LABEL[input.role]],
    quality_score: 0,
    status: "review",
  };

  // Secundarios: best-effort (a entidade ja existe em status 'review'; falhas viram warning pra
  // o operador revisar, sem perder o cadastro). Espelha o estilo best-effort do sync.
  const [profileRes, identifierRes, contactRes, addressRes, relationshipRes, searchRes] =
    await Promise.all([
      adminClient.from("apolo_entity_profiles").upsert(profileRows, { onConflict: "entity_id,profile" }),
      adminClient.from("apolo_entity_identifiers").upsert(identifierRows, {
        onConflict: "entity_id,identifier_type,value_hash",
      }),
      contactRows.length ? adminClient.from("apolo_contacts").insert(contactRows) : noop(),
      addressRows.length ? adminClient.from("apolo_addresses").insert(addressRows) : noop(),
      relationshipRows.length
        ? adminClient.from("apolo_relationships").insert(relationshipRows)
        : noop(),
      adminClient.from("apolo_search_entries").upsert([searchRow], { onConflict: "entity_id" }),
    ]);

  warn("papel", profileRes.error);
  warn("identificadores", identifierRes.error);
  warn("contatos", contactRes.error);
  warn("endereco", addressRes.error);
  warn("relacionamentos", relationshipRes.error);
  warn("indice de busca", searchRes.error);

  // Registra o codigo na entidade: e o que permite conferir a CAD depois.
  const { error: autenticacaoError } = await adminClient
    .from("apolo_entities")
    .update({
      metadata: {
        ...entityRow.metadata,
        autenticacao: { codigo: autenticacao, geradoEm: new Date().toISOString() },
      },
    })
    .eq("id", entityId);
  warn("codigo de autenticacao", autenticacaoError);

  return { autenticacao, entityId, ok: true, warnings };
}

// Rotulo de papel para busca/exibicao (o enum nao carrega label).
const ROLE_LABEL: Record<ApoloBirthRole, string> = {
  colaborador: "Colaborador",
  corretor: "Corretor",
  fornecedor: "Fornecedor",
  imobiliaria: "Imobiliaria",
  incorporador: "Incorporador",
  parceiro: "Parceiro",
  prospect: "Prospect",
};
const ROLE_SEARCH_LABEL = ROLE_LABEL;

function identifierRow(
  entityId: string,
  type: string,
  rawValue: string,
  masked: string,
  isPrimary: boolean,
): Record<string, unknown> {
  return {
    confidence_score: 90,
    entity_id: entityId,
    identifier_type: type,
    is_primary: isPrimary,
    metadata: { source: "apolo" },
    source_system: "apolo",
    value_hash: hashIdentifier(type, rawValue),
    value_masked: masked,
  };
}

async function noop(): Promise<{ error: null }> {
  return { error: null };
}

// ---- helpers (espelham o sync; masks/normalize sao so display/busca) -----------------------

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pruneEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) ? value.length : value) {
      out[key] = value;
    }
  }
  return out as Partial<T>;
}

function onlyDigits(value: string | null | undefined): string {
  return value?.replace(/\D/g, "") ?? "";
}

function documentKind(digits: string): "cnpj" | "cpf" | null {
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return null;
}

function maskDocument(digits: string): string {
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  return "Documento em revisao";
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "E-mail em revisao";
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskPhone(value: string): string {
  const digits = onlyDigits(value);
  if (!digits) return "Telefone em revisao";
  return `(**) *****-**${digits.slice(-2)}`;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
