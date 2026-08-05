// Persistencia do cadastro manual do Apolo: cria uma ENTIDADE (PF/PJ) a partir de um PAPEL de
// nascimento. Hoje o unico processo ligado e o do PROSPECT; os demais papeis (imobiliaria,
// corretor, fornecedor...) reusam esta camada depois. Escreve coordenadamente nas tabelas
// apolo_* (via service role; RLS so libera SELECT), espelhando o que o sync do C2X ja faz.
// Ver [[project_apolo_cadastro_prospect]], [[project_apolo_crm_grafo]].
import { lerCadsDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
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
  // Liga o DEDUP por documento: se o CPF/CNPJ já tem ficha, NÃO cria uma segunda — retorna
  // ok:false com entityIdExistente. Ligado nos fluxos de PROSPECT (cadastro manual + portal CAD),
  // onde não pode haver ficha dupla. Os fluxos de imobiliária/corretor têm dedup próprio por papel
  // (reaproveitam a entidade), então NÃO ligam este — senão o "mesma pessoa, outro papel" quebra.
  dedupPorDocumento?: boolean;
  // Empreendimento desta CAD (id do C2X). A duplicidade é POR EMPREENDIMENTO: com ele, o dedup
  // barra só quem já tem CAD NO MESMO loteamento e libera quem quer comprar em outro. SEM ele o
  // dedup não tem como distinguir as duas coisas e volta a barrar tudo — é o ramo conservador,
  // documentado no bloco de decisão lá embaixo.
  enterpriseId?: null | number | string;
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
    cnae?: string;
    cnpj?: string;
    // CRECI Jurídico (só imobiliária). Opcional.
    creci?: string;
    dataAbertura?: string;
    dataAtualizacao?: string;
    email?: string;
    naturezaJuridica?: string;
    nomeFantasia?: string;
    porte?: string;
    razaoSocial?: string;
    situacaoCadastral?: string;
    socios?: Array<{ nome: string; qualificacao: string }>;
    telefone?: string;
  } | null;
  // Corretores da imobiliária (papel imobiliaria) → relacionamento de CONTATO. Cadastro simples.
  corretores?: Array<{
    cpf?: string;
    creci?: string;
    email?: string;
    nome?: string;
    telefone?: string;
  }>;
  // Empreendimentos vinculados à imobiliária → relacionamento de TRABALHO. id = enterprise do C2X.
  empreendimentos?: Array<{ id?: string; label?: string }>;
  // Socios CADASTRADOS (PJ): pessoas fisicas com ficha propria. Por ora ficam na metadata do
  // cadastro (a ficha corrida registra quem sao); virar entidade PF vinculada e o modelo de
  // grafo, decisao a parte.
  socios?: Array<{
    cpf?: string;
    dataNascimento?: string;
    email?: string;
    estadoCivilId?: string;
    nacionalidade?: string;
    naturalidade?: string;
    nome?: string;
    nomeMae?: string;
    representanteLegal?: boolean;
    sexoId?: string;
    telefone?: string;
    endereco?: {
      bairro?: string;
      cep?: string;
      cidade?: string;
      logradouro?: string;
      numero?: string;
      uf?: string;
    };
  }>;
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
  // entityIdExistente presente = o documento JÁ tem ficha; o caller pode redirecionar para ela em
  // vez de criar uma segunda (dedup — ver o incidente dos "dois Pedro Alexandro").
  | { entityIdExistente?: string; error: string; ok: false };

// Codigo de autenticacao da CAD. A forca dele NAO esta no segredo: esta em ser gerado no
// SERVIDOR e ficar registrado na entidade -- conferir uma CAD e perguntar ao banco se o codigo
// existe e bate com aquela ficha. CAD forjada com codigo inventado nao acha par no banco.
// (Gerar isso no browser nao autenticaria nada: o forjador roda o mesmo codigo.)
export function gerarCodigoAutenticacao(entityId: string, criadoEm: Date): string {
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
  // Imobiliária: corretores válidos (nome + CPF) e empreendimentos vinculados (id do C2X).
  const corretores = (input.corretores ?? []).filter(
    (c) => text(c?.nome) && onlyDigits(c?.cpf).length === 11,
  );
  const empreendimentos = (input.empreendimentos ?? []).filter((e) => text(e?.id));

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

  // Modo anexo: id da ficha EXISTENTE (sem esteira) que vai receber esta CAD em vez de nascer
  // uma entidade nova. Preenchido pelo dedup abaixo.
  let anexarEm: string | null = null;

  // DEDUP por documento (opt-in via input.dedupPorDocumento): a migration 0026 dropou o índice
  // único de document_hash e o INSERT abaixo é cego. Sem esta checagem o mesmo CPF/CNPJ vira DUAS
  // entidades — foi o incidente dos "dois Pedro Alexandro" (cadastro manual duplicando quem já
  // estava credenciado). Casa nas DUAS fontes: document_hash (quem nasce no Apolo) e
  // apolo_entity_identifiers (quem veio do sync/import).
  if (input.dedupPorDocumento) {
    const docHash = hashIdentifier(docKind, digits);
    const [{ data: porIdentificador }, { data: porDocumento }] = await Promise.all([
      adminClient
        .from("apolo_entity_identifiers")
        .select("entity_id")
        .eq("identifier_type", docKind)
        .eq("value_hash", docHash)
        .limit(1)
        .maybeSingle<{ entity_id: string }>(),
      adminClient
        .from("apolo_entities")
        .select("id")
        .eq("document_hash", docHash)
        .limit(1)
        .maybeSingle<{ id: string }>(),
    ]);
    const entityIdExistente = porIdentificador?.entity_id ?? porDocumento?.id ?? null;
    if (entityIdExistente) {
      // FICHA EXISTIR não é CAD EXISTIR (achado da revisão de 03/08): 3.920 CPFs vivem na base
      // vindos do sync C2X/backfill do Asana SEM nenhuma CAD — e o corretor tomava um 409 falso
      // ("já existe uma CAD") no último passo. A prova de CAD em andamento é a ESTEIRA:
      //   • com esteira  -> recusa VERDADEIRA (CAD em andamento; central resolve);
      //   • sem esteira  -> a CAD nova ANEXA na ficha existente (modo anexo, abaixo).
      // FAIL-CLOSED: se a leitura da esteira falhar (blip de rede, RLS), NÃO dá para afirmar que a
      // pessoa não tem CAD. Seguir em frente liberaria o upsert POR CIMA de uma CAD viva. "Não sei"
      // é tratado como "não libere": barra e pede pra tentar de novo, nunca segue às cegas.
      let cadsExistentes: {
        empreendimento: null | string;
        enterprise_id: null | string;
        entity_id: string;
      }[];
      try {
        cadsExistentes = await lerCadsDaEsteira<{
          empreendimento: null | string;
          enterprise_id: null | string;
          entity_id: string;
        }>(adminClient, entityIdExistente, "empreendimento, enterprise_id, entity_id");
      } catch {
        return {
          entityIdExistente,
          error:
            "Não foi possível verificar cadastros existentes agora. Tente novamente em instantes.",
          ok: false,
        };
      }

      // ✅ A CAD É POR EMPREENDIMENTO (regra do Lucas), e desde a migration 0080 a esteira
      // comporta isso: a chave passou de `entity_id` para `(entity_id, enterprise_id)`. Quem já
      // comprou no Vale do Ouro pode abrir CAD em outro loteamento sem passar pela central.
      //
      // O que a trava barra AGORA é só a duplicata de verdade: a MESMA pessoa mandando a MESMA
      // CAD para o MESMO empreendimento. CAD em outro loteamento passa direto e nasce como linha
      // própria — não sobrescreve nada da primeira.
      //
      // (Até 04/08 a trava era GLOBAL de propósito: com `entity_id` como chave primária, a
      // segunda CAD entrava por cima da primeira em silêncio — empreendimento, corretor,
      // imobiliária, origem e etapa da CAD antiga eram substituídos, e ela sumia do relatório do
      // empreendimento dela. Aquele motivo acabou junto com a chave antiga.)
      const alvoEnterpriseId = normalizarEnterpriseId(input.enterpriseId);
      const jaTemNesteEmpreendimento = alvoEnterpriseId
        ? cadsExistentes.find(
            (cad) => normalizarEnterpriseId(cad.enterprise_id) === alvoEnterpriseId,
          )
        : // SEM empreendimento no pedido não dá para dizer se é a mesma CAD ou outra, e liberar às
          // cegas recriaria o problema antigo por outro caminho. Aqui a trava continua global, de
          // propósito — mas este ramo é raro: o portal público exige o empreendimento (derivado do
          // token) e o wizard interno só grava esteira quando o operador escolheu um.
          (cadsExistentes[0] ?? null);

      if (jaTemNesteEmpreendimento) {
        const onde = jaTemNesteEmpreendimento.empreendimento?.trim();
        return {
          entityIdExistente,
          error:
            `Este ${docKind === "cnpj" ? "CNPJ" : "CPF"} já tem CAD cadastrada` +
            `${onde ? ` no empreendimento ${onde}` : ""}. ` +
            "Não precisa reenviar. Qualquer dúvida, fale com a central.",
          ok: false,
        };
      }

      // Tem ficha e pode ter CAD em OUTRO empreendimento (ou nenhuma CAD): a CAD nova ANEXA na
      // ficha existente, em vez de nascer uma segunda entidade para o mesmo CPF.
      anexarEm = entityIdExistente;
    }
  }

  const ownerUserId =
    input.ownerUserId && UUID_RE.test(input.ownerUserId) ? input.ownerUserId : null;
  // No PJ o contato é da EMPRESA (empresa.email/telefone); no PF, do perfil. Sem isto o telefone
  // e o e-mail digitados no PJ não viravam contato e a ficha mostrava "-".
  const email = text(isPj ? empresa.email : perfil.email);
  const telefone = text(isPj ? empresa.telefone : perfil.telefone);
  const location = { city: text(endereco.cidade), state: text(endereco.uf) };

  // Guarda o demografico/PJ que nao tem coluna propria no core do Apolo (o CAD detalhado vai
  // pro drive; aqui fica o essencial pra ficha e pro futuro write-back ao C2X).
  const cadastro = pruneEmpty({
    atividade: text(empresa.atividade),
    cnae: text(empresa.cnae),
    // CRECI Jurídico (imobiliária). corretores/empreendimentos ficam na metadata pra ficha corrida.
    creci: text(empresa.creci),
    corretores: corretores.map((c) => ({
      cpf: text(c.cpf),
      creci: text(c.creci),
      email: text(c.email),
      nome: text(c.nome),
      telefone: text(c.telefone),
    })),
    empreendimentos: empreendimentos.map((e) => ({ id: text(e.id), label: text(e.label) })),
    dataAbertura: text(empresa.dataAbertura),
    dataAtualizacaoCadastral: text(empresa.dataAtualizacao),
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
    // QSA lido do enriquecimento (informativo).
    qsa: (empresa.socios ?? []).filter((s) => text(s?.nome)),
    // Socios cadastrados de verdade (ficha + endereco + quem assina).
    socios: (input.socios ?? [])
      .filter((s) => text(s?.nome) || text(s?.cpf))
      .map((s) => ({
        cpf: text(s.cpf),
        dataNascimento: text(s.dataNascimento),
        email: text(s.email),
        endereco: pruneEmpty({
          bairro: text(s.endereco?.bairro),
          cep: text(s.endereco?.cep),
          cidade: text(s.endereco?.cidade),
          logradouro: text(s.endereco?.logradouro),
          numero: text(s.endereco?.numero),
          uf: text(s.endereco?.uf),
        }),
        estadoCivilId: text(s.estadoCivilId),
        nacionalidade: text(s.nacionalidade),
        naturalidade: text(s.naturalidade),
        nome: text(s.nome),
        nomeMae: text(s.nomeMae),
        representanteLegal: Boolean(s.representanteLegal),
        sexoId: text(s.sexoId),
        telefone: text(s.telefone),
      })),
  });

  const entityRow = {
    display_name: displayName,
    document_hash: hashIdentifier(docKind, digits),
    document_kind: docKind,
    document_masked: formatDocument(digits),
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

  let entityId: string;
  if (anexarEm) {
    // MODO ANEXO: a ficha já existe (veio do sync C2X / backfill, SEM CAD). A CAD entra nela.
    // O merge do metadata é OBRIGATÓRIO ler-antes-de-gravar (armadilha conhecida: update
    // substitui o jsonb INTEIRO): preserva `source`, `c2xSynced`, `c2xUserId` e tudo que a
    // ficha já carregava; só o `cadastro` novo entra por cima (é mais completo) e a origem
    // pública fica registrada.
    const { data: atual } = await adminClient
      .from("apolo_entities")
      .select("display_name, metadata")
      .eq("id", anexarEm)
      .maybeSingle<{ display_name: string | null; metadata: Record<string, unknown> | null }>();
    const metaAtual = atual?.metadata ?? {};
    const cadastroAtual =
      typeof metaAtual.cadastro === "object" && metaAtual.cadastro !== null
        ? (metaAtual.cadastro as Record<string, unknown>)
        : {};
    const { error: anexoError } = await adminClient
      .from("apolo_entities")
      .update({
        display_name: atual?.display_name?.trim() ? atual.display_name : displayName,
        metadata: {
          ...metaAtual,
          cadastro: { ...cadastroAtual, ...cadastro },
          origemCadPublica: input.origem || "cadastro",
        },
      })
      .eq("id", anexarEm);
    if (anexoError) {
      return {
        error: `Nao foi possivel anexar a CAD na ficha existente: ${anexoError.message}`,
        ok: false,
      };
    }
    entityId = anexarEm;
  } else {
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

    entityId = created.id;
  }
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
    identifierRow(entityId, docKind, digits, formatDocument(digits), true),
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
  // Cada sócio (PJ) vira um relacionamento de CONTATO — aparece na aba Relacionamentos. Quem
  // assina pela empresa é marcado no nível.
  for (const socio of input.socios ?? []) {
    const nome = text(socio.nome);
    if (!nome) continue;
    relationshipRows.push({
      entity_id: entityId,
      label: nome,
      metadata: {
        cpf: text(socio.cpf) || null,
        createdBy: ownerUserId,
        email: text(socio.email) || null,
        kind: "contato",
        phone: text(socio.telefone) || null,
        role: socio.representanteLegal ? "representante legal" : "socio",
        source: "apolo",
      },
      related_entity_id: null,
      relationship_type: socio.representanteLegal ? "representante_legal" : "socio",
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

  // Cada corretor da imobiliária vira um relacionamento de CONTATO (aparece na aba Relacionamentos).
  for (const corretor of corretores) {
    relationshipRows.push({
      entity_id: entityId,
      label: text(corretor.nome),
      metadata: {
        cpf: text(corretor.cpf) || null,
        createdBy: ownerUserId,
        creci: text(corretor.creci) || null,
        email: text(corretor.email) || null,
        kind: "contato",
        phone: text(corretor.telefone) || null,
        role: "corretor",
        source: "apolo",
      },
      related_entity_id: null,
      relationship_type: "corretor",
      status: "verified",
    });
  }

  // Cada empreendimento vinculado vira um relacionamento de TRABALHO. O empreendimento é do C2X
  // (não é entidade Apolo), então guardamos o id/rótulo na metadata e related_entity_id fica null.
  for (const emp of empreendimentos) {
    relationshipRows.push({
      entity_id: entityId,
      label: text(emp.label) || "Empreendimento",
      metadata: {
        createdBy: ownerUserId,
        enterpriseId: text(emp.id) || null,
        kind: "trabalho",
        role: "empreendimento",
        source: "apolo",
      },
      related_entity_id: null,
      relationship_type: "empreendimento",
      status: "verified",
    });
  }

  const searchRow = {
    display_name: displayName,
    document_masked: formatDocument(digits),
    entity_id: entityId,
    entity_kind: isPj ? "pj" : "pf",
    last_synced_at: new Date().toISOString(),
    location_label: [location.city, location.state].filter(Boolean).join(" - ") || null,
    metadata: { source: "apolo" },
    normalized_text: normalizeSearchText(
      [
        displayName,
        isPj ? text(empresa.nomeFantasia) : null,
        formatDocument(digits),
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

// Documento COMPLETO formatado (não mascarado). O Serasa consulta a partir de
// `document_masked` e a esteira inteira (crédito -> pré-venda) depende disso; guardar só os 2
// últimos dígitos travava a análise ("A ficha nao tem CPF completo", incidente 22/jul com a
// primeira CAD real do portal). Decisão do Lucas 22/jul: o CPF/CNPJ fica legível na ficha, no
// mesmo formato das CADs importadas do Asana. O nome `document_masked` da coluna é histórico;
// o conteúdo agora é o número inteiro.
function formatDocument(digits: string): string {
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
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
