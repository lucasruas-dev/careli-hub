#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import mysql from "mysql2/promise";
import pg from "pg";

const batchSize = readNumberArg("--batch-size", 400);
const envFile = readArg("--env-file");
const target = readArg("--target") ?? "local";

loadEnvFile(".env");
loadEnvFile(".env.local");
loadEnvFile("apps/hub/.env.local");

if (envFile) {
  loadEnvFile(envFile, { override: true });
}

const supabaseUrl = resolveSupabaseUrl();
const serviceRoleKey = normalizeSupabaseJwt(resolveSupabaseServiceRoleKey());
const postgresUrl = resolvePostgresUrl();
const usePostgresWriter = !serviceRoleKey && Boolean(postgresUrl);

const missing = [
  supabaseUrl
    ? null
    : target === "homolog"
      ? "HOMOLOG_SUPABASE_URL or --env-file"
      : "NEXT_PUBLIC_SUPABASE_URL",
  serviceRoleKey || usePostgresWriter
    ? null
    : target === "homolog"
      ? "HOMOLOG_SUPABASE_SERVICE_ROLE_KEY or --env-file"
      : "SUPABASE_SERVICE_ROLE_KEY or POSTGRES_URL",
  readEnv("GUARDIAN_DB_HOST") ? null : "GUARDIAN_DB_HOST",
  readEnv("GUARDIAN_DB_NAME") ? null : "GUARDIAN_DB_NAME",
  readEnv("GUARDIAN_DB_USER") ? null : "GUARDIAN_DB_USER",
  readEnv("GUARDIAN_DB_PASSWORD") ? null : "GUARDIAN_DB_PASSWORD",
].filter(Boolean);

if (missing.length > 0) {
  fail(`Missing required env vars: ${missing.join(", ")}. No secret values were printed.`);
}

const supabase = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

let pool;
let postgresClient;
let syncRun;

try {
  if (usePostgresWriter) {
    const { Client } = pg;
    postgresClient = new Client({
      connectionString: postgresUrl,
      ssl: { rejectUnauthorized: false },
    });
    await postgresClient.connect();
  }

  pool = await mysql.createPool({
    charset: "utf8mb4",
    connectTimeout: 8000,
    connectionLimit: 4,
    database: readEnv("GUARDIAN_DB_NAME"),
    host: readEnv("GUARDIAN_DB_HOST"),
    password: readEnv("GUARDIAN_DB_PASSWORD"),
    port: Number(readEnv("GUARDIAN_DB_PORT") ?? 3306),
    ssl: readEnv("GUARDIAN_DB_SSL") === "true" ? { rejectUnauthorized: false } : undefined,
    timezone: "Z",
    user: readEnv("GUARDIAN_DB_USER"),
    waitForConnections: true,
  });

  syncRun = await startSyncRun();

  const [users] = await pool.query(c2xUsersQuery());
  const syncedAt = new Date().toISOString();
  let rowsWritten = 0;

  for (let index = 0; index < users.length; index += batchSize) {
    const batch = users.slice(index, index + batchSize);
    rowsWritten += await persistBatch(batch, syncRun.id, syncedAt);
  }

  await updateSyncRun(syncRun.id, {
    finished_at: syncedAt,
    scanned_count: users.length,
    status: "completed",
    upserted_count: rowsWritten,
    updated_at: syncedAt,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        rowsScanned: users.length,
        rowsWritten,
        syncRunId: syncRun.id,
        target,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = safeErrorMessage(error);

  if (syncRun?.id) {
    await updateSyncRun(syncRun.id, {
      error_message: message,
      failed_count: 1,
      finished_at: new Date().toISOString(),
      status: "failed",
      updated_at: new Date().toISOString(),
    }).catch(() => undefined);
  }

  console.error(
    JSON.stringify(
      {
        error: message,
        ok: false,
        syncRunId: syncRun?.id ?? null,
        target,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
  await postgresClient?.end();
}

async function startSyncRun() {
  if (postgresClient) {
    const { rows } = await postgresClient.query(
      `
        insert into public.apolo_sync_runs (metadata, source_system, status)
        values ($1::jsonb, 'c2x', 'running')
        returning id;
      `,
      [
        {
          runner: "scripts/apolo-sync-c2x.mjs",
          strategy: "apolo-c2x-users-initial",
          writer: "postgres",
        },
      ],
    );

    if (!rows[0]?.id) {
      throw new Error("Sync run sem ID.");
    }

    return rows[0];
  }

  const { data, error } = await supabase
    .from("apolo_sync_runs")
    .insert({
      metadata: {
        runner: "scripts/apolo-sync-c2x.mjs",
        strategy: "apolo-c2x-users-initial",
      },
      source_system: "c2x",
      status: "running",
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw error ?? new Error("Sync run sem ID.");
  }

  return data;
}

async function updateSyncRun(id, values) {
  if (postgresClient) {
    await updatePostgresRow("apolo_sync_runs", values, "id", id);
    return;
  }

  const { error } = await supabase
    .from("apolo_sync_runs")
    .update(values)
    .eq("id", id);

  if (error) {
    throw error;
  }
}

async function persistBatch(users, syncRunId, syncedAt) {
  const entityRows = users.map((user) => buildEntityRow(user, syncedAt));
  const profileRows = users.flatMap((user) => buildProfileRows(user, syncedAt));
  const identifierRows = users.flatMap((user) =>
    buildIdentifierRows(user, syncRunId, syncedAt),
  );
  const contactRows = users.flatMap((user) => buildContactRows(user, syncedAt));
  const addressRows = users.flatMap((user) => buildAddressRows(user, syncedAt));
  const relationshipRows = users.flatMap((user) => buildRelationshipRows(user, syncedAt));
  const commercialRows = users.flatMap((user) => buildCommercialRows(user, syncedAt));
  const moduleRows = users.map((user) => buildModuleRow(user, syncRunId, syncedAt));
  const sourceRows = users.map((user) => buildSourceRow(user, syncRunId, syncedAt));
  const searchRows = users.map((user) => buildSearchRow(user, syncedAt));

  return (
    (await upsertRows("apolo_entities", entityRows, "id")) +
    (await upsertRows("apolo_entity_profiles", profileRows, "entity_id,profile")) +
    (await upsertRows(
      "apolo_entity_identifiers",
      identifierRows,
      "entity_id,identifier_type,value_hash",
    )) +
    (await upsertRows("apolo_contacts", contactRows, "id")) +
    (await upsertRows("apolo_addresses", addressRows, "id")) +
    (await upsertRows("apolo_relationships", relationshipRows, "id")) +
    (await upsertRows("apolo_commercial_links", commercialRows, "id")) +
    (await upsertRows("apolo_module_records", moduleRows, "module_key,record_type,record_id")) +
    (await upsertRows("apolo_source_links", sourceRows, "source_system,source_table,source_id")) +
    (await upsertRows("apolo_search_entries", searchRows, "entity_id"))
  );
}

async function upsertRows(table, rows, onConflict) {
  if (rows.length === 0) {
    return 0;
  }

  const uniqueRows = dedupeRows(rows, onConflict);

  if (postgresClient) {
    await upsertPostgresRows(table, uniqueRows, onConflict);
    return uniqueRows.length;
  }

  const { error } = await supabase.from(table).upsert(uniqueRows, { onConflict });

  if (error) {
    throw error;
  }

  return uniqueRows.length;
}

async function updatePostgresRow(table, values, conflictKey, conflictValue) {
  const columns = Object.keys(values);

  if (columns.length === 0) {
    return;
  }

  const assignments = columns
    .map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`)
    .join(", ");
  const params = columns.map((column) => values[column]);

  await postgresClient.query(
    `
      update public.${quoteIdentifier(table)}
      set ${assignments}
      where ${quoteIdentifier(conflictKey)} = $${columns.length + 1};
    `,
    [...params, conflictValue],
  );
}

async function upsertPostgresRows(table, rows, onConflict) {
  if (rows.length === 0) {
    return;
  }

  const columns = Array.from(
    rows.reduce((columnSet, row) => {
      Object.keys(row).forEach((column) => columnSet.add(column));
      return columnSet;
    }, new Set()),
  ).sort();
  const conflictColumns = onConflict.split(",").map((column) => column.trim());
  const updateColumns = columns.filter(
    (column) => !conflictColumns.includes(column),
  );
  const rowPlaceholders = [];
  const params = [];

  for (const row of rows) {
    const valuePlaceholders = [];

    for (const column of columns) {
      params.push(row[column] ?? null);
      valuePlaceholders.push(`$${params.length}`);
    }

    rowPlaceholders.push(`(${valuePlaceholders.join(", ")})`);
  }

  const updateClause =
    updateColumns.length > 0
      ? `do update set ${updateColumns
          .map(
            (column) =>
              `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`,
          )
          .join(", ")}`
      : "do nothing";

  await postgresClient.query(
    `
      insert into public.${quoteIdentifier(table)}
        (${columns.map(quoteIdentifier).join(", ")})
      values ${rowPlaceholders.join(", ")}
      on conflict (${conflictColumns.map(quoteIdentifier).join(", ")})
      ${updateClause};
    `,
    params,
  );
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function dedupeRows(rows, onConflict) {
  const keys = onConflict.split(",").map((key) => key.trim());
  const uniqueByConflict = new Map();

  for (const row of rows) {
    uniqueByConflict.set(
      keys.map((key) => String(row[key] ?? "")).join("|"),
      row,
    );
  }

  return Array.from(uniqueByConflict.values());
}

function buildEntityRow(user, syncedAt) {
  const document = user.cpf ?? user.cnpj ?? null;
  const relationships = buildC2xRelationships(user);
  const documentMasked = maskDocument(document);
  const status = deriveStatus(user, documentMasked, relationships);

  return {
    display_name: user.display_name?.trim() || `Cadastro ${user.id}`,
    document_hash: null,
    document_kind: documentKind(document),
    document_masked: documentMasked,
    entity_kind: deriveEntityKind(user),
    id: entityId(user.id),
    metadata: {
      profileNames: [user.profile_name].filter(Boolean),
    },
    next_action: deriveNextAction(user, status),
    primary_city: splitLocation(user.location_label).city,
    primary_state: splitLocation(user.location_label).state,
    quality_score: deriveConfidenceScore(user, documentMasked, relationships),
    status,
    updated_at: syncedAt,
    workspace_id: "careli",
  };
}

function buildProfileRows(user, syncedAt) {
  return mapProfiles(user.profile_id, user.person_type_id).map((profile) => ({
    entity_id: entityId(user.id),
    profile,
    status: "active",
    updated_at: syncedAt,
  }));
}

function buildIdentifierRows(user, syncRunId, syncedAt) {
  const identifiers = [
    {
      identifier_type: "legacy_id",
      maskedValue: String(user.id),
      rawValue: String(user.id),
    },
  ];
  const document = user.cpf ?? user.cnpj;

  if (document && documentKind(document)) {
    identifiers.push({
      identifier_type: documentKind(document),
      maskedValue: maskDocument(document),
      rawValue: onlyDigits(document),
    });
  }

  if (user.email) {
    identifiers.push({
      identifier_type: "email",
      maskedValue: maskEmail(user.email),
      rawValue: user.email.trim().toLowerCase(),
    });
  }

  for (const phone of [user.cellphone, user.phone]) {
    if (phone) {
      identifiers.push({
        identifier_type: "phone",
        maskedValue: maskPhone(phone),
        rawValue: onlyDigits(phone),
      });
    }
  }

  return identifiers
    .filter((identifier) => identifier.rawValue)
    .map((identifier) => ({
      confidence_score: identifier.identifier_type === "legacy_id" ? 100 : 80,
      entity_id: entityId(user.id),
      identifier_type: identifier.identifier_type,
      is_primary:
        identifier.identifier_type === "legacy_id" ||
        identifier.identifier_type === "cpf" ||
        identifier.identifier_type === "cnpj",
      metadata: {
        syncRunId,
      },
      source_system: "c2x",
      updated_at: syncedAt,
      value_hash: hashIdentifier(identifier.identifier_type, identifier.rawValue),
      value_masked: identifier.maskedValue,
    }));
}

function buildContactRows(user, syncedAt) {
  const contacts = [
    {
      contact_type: "whatsapp",
      label: "Celular",
      rawValue: user.cellphone,
    },
    {
      contact_type: "phone",
      label: "Telefone",
      rawValue: user.phone && user.phone !== user.cellphone ? user.phone : null,
    },
    {
      contact_type: "email",
      label: "E-mail",
      rawValue: user.email,
    },
  ];

  return contacts
    .filter((contact) => contact.rawValue)
    .map((contact) => ({
      contact_type: contact.contact_type,
      entity_id: entityId(user.id),
      id: deterministicUuid(
        `apolo:c2x:users:${user.id}:contact:${contact.contact_type}:${contact.rawValue}`,
      ),
      is_primary: contact.contact_type === "whatsapp" || contact.contact_type === "email",
      label: contact.label,
      normalized_value: hashIdentifier(contact.contact_type, contact.rawValue),
      status: "pending",
      updated_at: syncedAt,
      value: contact.rawValue,
    }));
}

function buildAddressRows(user, syncedAt) {
  const location = splitLocation(user.location_label);

  if (!location.city && !location.state) {
    return [];
  }

  return [
    {
      city: location.city,
      entity_id: entityId(user.id),
      id: deterministicUuid(`apolo:c2x:users:${user.id}:address:primary`),
      is_primary: true,
      label: "Principal",
      state: location.state,
      status: "pending",
      street: "Endereco cadastral",
      updated_at: syncedAt,
    },
  ];
}

function buildRelationshipRows(user, syncedAt) {
  return buildC2xRelationships(user).map((relationship) => ({
    entity_id: entityId(user.id),
    id: deterministicUuid(
      `apolo:c2x:users:${user.id}:relationship:${relationship.relation}:${relationship.label}`,
    ),
    label: relationship.label,
    relationship_type: relationship.relation,
    status: relationship.status,
    updated_at: syncedAt,
  }));
}

function buildCommercialRows(user, syncedAt) {
  return buildCommercialLinks(user).map((link) => ({
    entity_id: entityId(user.id),
    enterprise_name: link.enterprise,
    id: deterministicUuid(`apolo:c2x:users:${user.id}:commercial:${link.role}:${link.unit}`),
    reference_label: link.referenceLabel,
    relationship_role: link.role,
    stage_label: link.stage,
    status: "active",
    unit_label: link.unit,
    updated_at: syncedAt,
  }));
}

function buildModuleRow(user, syncRunId, syncedAt) {
  return {
    entity_id: entityId(user.id),
    id: deterministicUuid(`apolo:c2x:users:${user.id}:module-record`),
    metadata: {
      syncRunId,
    },
    module_key: "c2x",
    record_id: String(user.id),
    record_type: "users",
    relationship_label: user.profile_name ?? "Cadastro",
    status: "active",
    updated_at: syncedAt,
  };
}

function buildSourceRow(user, syncRunId, syncedAt) {
  return {
    entity_id: entityId(user.id),
    last_seen_at: syncedAt,
    metadata: {
      syncRunId,
    },
    source_id: String(user.id),
    source_system: "c2x",
    source_table: "users",
    sync_run_id: syncRunId,
    updated_at: syncedAt,
  };
}

function buildSearchRow(user, syncedAt) {
  const profiles = mapProfiles(user.profile_id, user.person_type_id);
  const profileLabels = profiles.map((profile) => profileLabel(profile));
  const document = user.cpf ?? user.cnpj ?? null;
  const documentMasked = maskDocument(document);
  const relationships = buildC2xRelationships(user);
  const status = deriveStatus(user, documentMasked, relationships);
  const displayName = user.display_name?.trim() || `Cadastro ${user.id}`;
  const location = normalizeLocationLabel(user.location_label);

  return {
    display_name: displayName,
    document_masked: documentMasked,
    entity_id: entityId(user.id),
    entity_kind: deriveEntityKind(user),
    last_synced_at: syncedAt,
    location_label: location,
    metadata: {
      sourceSystem: "c2x",
    },
    normalized_text: normalizeSearchText(
      [
        displayName,
        documentMasked,
        location,
        user.linked_party_name,
        user.profile_name,
        ...profileLabels,
      ].join(" "),
    ),
    profile_labels: profileLabels,
    quality_score: deriveConfidenceScore(user, documentMasked, relationships),
    status,
    updated_at: syncedAt,
  };
}

function c2xUsersQuery() {
  return `
    select
      u.id,
      u.profile_id,
      coalesce(p.name, 'Sem perfil') as profile_name,
      u.person_type_id,
      pt.name as person_type_name,
      coalesce(
        nullif(trim(u.fantasy_name), ''),
        nullif(trim(u.social_name), ''),
        nullif(trim(u.name), ''),
        concat('Cadastro ', u.id)
      ) as display_name,
      u.cpf,
      u.cnpj,
      u.email,
      u.phone,
      u.cellphone,
      u.vinculed_by_id,
      coalesce(
        nullif(trim(linked.fantasy_name), ''),
        nullif(trim(linked.social_name), ''),
        nullif(trim(linked.name), '')
      ) as linked_party_name,
      (
        select concat_ws(' / ', nullif(trim(city.name), ''), nullif(trim(state.acronym), ''))
        from addresses addr
        left join cities city on city.id = addr.city_id
        left join states state on state.id = coalesce(addr.state_id, city.state_id)
        where addr.ownertable_type = 'User'
          and addr.ownertable_id = u.id
        order by addr.updated_at desc, addr.id desc
        limit 1
      ) as location_label,
      u.updated_at
    from users u
    left join profiles p on p.id = u.profile_id
    left join person_types pt on pt.id = u.person_type_id
    left join users linked on linked.id = u.vinculed_by_id
    order by u.id asc
  `;
}

function mapProfiles(profileId, personTypeId) {
  const profiles = [];

  if (profileId === 1 || profileId === 5) profiles.push("colaborador");
  else if (profileId === 2) profiles.push("usuario");
  else if (profileId === 3) profiles.push("incorporador");
  else if (profileId === 4) profiles.push("acesso_incorporador");
  else if (profileId === 6) profiles.push("imobiliaria");
  else if (profileId === 7) profiles.push("corretor");

  if (personTypeId === 1) profiles.push("pessoa_fisica");
  else if (personTypeId === 2) profiles.push("pessoa_juridica");

  return Array.from(new Set(profiles));
}

function deriveEntityKind(user) {
  if (user.profile_id === 1 || user.profile_id === 5) return "internal";
  if (user.person_type_id === 2) return "pj";
  if (user.person_type_id === 1) return "pf";
  return user.profile_id === 3 || user.profile_id === 6 ? "organization" : "pf";
}

function deriveStatus(user, documentMasked, relationships) {
  if (user.profile_id === 2 && !user.vinculed_by_id) return "attention";
  if (documentMasked === "Documento em revisao") return "review";
  if (relationships.some((relationship) => relationship.status !== "verified")) return "review";
  return "active";
}

function deriveNextAction(user, status) {
  if (user.profile_id === 2 && !user.vinculed_by_id) return "Confirmar vinculo comercial";
  if (status === "review") return "Revisar completude cadastral";
  return "Cadastro operacional ativo";
}

function deriveConfidenceScore(user, documentMasked, relationships) {
  let score = 45;
  if (user.display_name) score += 15;
  if (documentMasked !== "Documento em revisao") score += 15;
  if (user.cellphone || user.phone || user.email) score += 10;
  if (user.location_label) score += 5;
  if (user.profile_id === 2) {
    score += relationships.some((relationship) => relationship.status === "verified") ? 10 : 0;
  } else {
    score += 10;
  }
  return Math.min(100, Math.max(0, Math.trunc(score)));
}

function buildC2xRelationships(user) {
  if (user.profile_id === 2) {
    return [
      {
        label: user.linked_party_name || "Vinculo comercial pendente",
        relation: "Imobiliaria ou responsavel comercial",
        status: user.vinculed_by_id ? "verified" : "attention",
      },
    ];
  }
  if (user.profile_id === 6) {
    return [{ label: "Usuarios vinculados", relation: "Origem comercial", status: "pending" }];
  }
  if (user.profile_id === 7) {
    return [{ label: "Carteira comercial", relation: "Corretagem", status: "pending" }];
  }
  return [];
}

function buildCommercialLinks(user) {
  if (user.profile_id === 2) {
    return [
      {
        enterprise: "Carteira comercial",
        referenceLabel: user.linked_party_name ? "Vinculo identificado" : "Vinculo pendente",
        role: "Usuario comprador",
        stage: "Relacionamento ativo",
        unit: user.linked_party_name || "Sem vinculo cadastral",
      },
    ];
  }
  return [
    {
      enterprise: "Relacionamento Careli",
      referenceLabel: user.profile_name || "Perfil cadastral",
      role: profileLabel(mapProfiles(user.profile_id, null)[0] ?? "usuario"),
      stage: "Cadastro ativo",
      unit: normalizeLocationLabel(user.location_label),
    },
  ];
}

function profileLabel(profile) {
  return {
    acesso_incorporador: "Acesso incorporador",
    colaborador: "Colaborador",
    corretor: "Corretor",
    fornecedor: "Fornecedor",
    imobiliaria: "Imobiliaria",
    incorporador: "Incorporador",
    parceiro: "Parceiro",
    pessoa_fisica: "Pessoa fisica",
    pessoa_juridica: "Pessoa juridica",
    usuario: "Usuario",
  }[profile] ?? "Relacionamento";
}

function entityId(id) {
  return deterministicUuid(`apolo:c2x:users:${id}`);
}

function deterministicUuid(seed) {
  const chars = createHash("sha1").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = (8 + (Number.parseInt(chars[16] ?? "0", 16) % 4)).toString(16);
  const hex = chars.join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}

function hashIdentifier(type, value) {
  return createHash("sha256")
    .update(`apolo-identifier:${type}:${value.trim().toLowerCase()}`)
    .digest("hex");
}

function documentKind(value) {
  const digits = onlyDigits(value);
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return null;
}

function maskDocument(value) {
  const digits = onlyDigits(value);
  if (digits.length === 11) return `***.***.***-${digits.slice(-2)}`;
  if (digits.length === 14) return `**.***.***/****-${digits.slice(-2)}`;
  return "Documento em revisao";
}

function maskPhone(value) {
  const digits = onlyDigits(value);
  if (!digits) return "Telefone em revisao";
  return `(**) *****-**${digits.slice(-2)}`;
}

function maskEmail(value) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "E-mail em revisao";
  return `${local.slice(0, 1)}***@${domain}`;
}

function onlyDigits(value) {
  return value?.replace(/\D/g, "") ?? "";
}

function splitLocation(value) {
  const [city, state] = (value ?? "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  return { city: city ?? null, state: state ?? null };
}

function normalizeLocationLabel(value) {
  const location = splitLocation(value);
  return [location.city, location.state].filter(Boolean).join(" / ") || "Localizacao em revisao";
}

function normalizeSearchText(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function safeErrorMessage(error) {
  if (error && typeof error === "object") {
    const candidate = error;
    if (candidate.code === "PGRST205") {
      return "Tabelas apolo_* nao encontradas no Supabase configurado. Rode a migration 0026 nesse projeto ou use o env do projeto onde a migration foi aplicada.";
    }
    return candidate.message ?? candidate.sqlMessage ?? "Falha no sync Apolo.";
  }
  return "Falha no sync Apolo.";
}

function loadEnvFile(path, options = {}) {
  const absolutePath = resolve(process.cwd(), path);
  if (!existsSync(absolutePath)) return;
  const content = readFileSync(absolutePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (!value && process.env[key]) continue;
    if (options.override || !process.env[key]) process.env[key] = value;
  }
}

function readNumberArg(name, fallback) {
  const raw = readArg(name);
  const parsed = Number(raw ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function readArg(name) {
  const prefix = `${name}=`;
  const rawArg = process.argv.find((arg) => arg.startsWith(prefix));
  return rawArg ? rawArg.slice(prefix.length) : undefined;
}

function readEnv(key) {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

function resolveSupabaseUrl() {
  if (target === "homolog") {
    return (
      readEnv("HOMOLOG_SUPABASE_URL") ??
      readEnv("NEXT_PUBLIC_HOMOLOG_SUPABASE_URL") ??
      (envFile ? readEnv("NEXT_PUBLIC_SUPABASE_URL") ?? readEnv("SUPABASE_URL") : undefined)
    );
  }

  return readEnv("NEXT_PUBLIC_SUPABASE_URL") ?? readEnv("SUPABASE_URL");
}

function resolveSupabaseServiceRoleKey() {
  if (target === "homolog") {
    return (
      readEnv("HOMOLOG_SUPABASE_SERVICE_ROLE_KEY") ??
      readEnv("HOMOLOG_SUPABASE_SECRET_KEY") ??
      (envFile ? readEnv("SUPABASE_SERVICE_ROLE_KEY") ?? readEnv("SUPABASE_SECRET_KEY") : undefined)
    );
  }

  return readEnv("SUPABASE_SERVICE_ROLE_KEY") ?? readEnv("SUPABASE_SECRET_KEY");
}

function resolvePostgresUrl() {
  return (
    readEnv("POSTGRES_URL") ??
    readEnv("POSTGRES_URL_NON_POOLING") ??
    readEnv("POSTGRES_PRISMA_URL") ??
    readEnv("DATABASE_URL") ??
    readEnv("HOMOLOG_POSTGRES_URL")
  );
}

function normalizeSupabaseJwt(value) {
  if (!value || value.startsWith("sb_secret_")) {
    return undefined;
  }

  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
