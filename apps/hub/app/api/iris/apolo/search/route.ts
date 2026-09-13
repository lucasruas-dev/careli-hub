import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";
import {
  contatoQueCasou,
  contatosDoVinculo,
  escolherTelefone,
  filtrarVinculosPorTermo,
  mesclarContatos,
  ordenarPorRelevancia,
  type ContatoDaEntidade,
  type VinculoDeContato,
} from "@/lib/iris/apolo/busca-de-contato";
import {
  interpretarDigitos,
  type TipoDeNumero,
} from "@/lib/iris/apolo/busca-por-numero";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApoloSearchEntryRow = {
  display_name?: string | null;
  entity_id: string;
};

type SearchCandidate = {
  displayName?: string | null;
  id: string;
};

type ApoloIdentifierRow = {
  entity_id: string;
};

type ApoloEntityRow = {
  display_name: string;
  document_masked: string | null;
  entity_kind: string;
  id: string;
  legal_name: string | null;
  primary_city: string | null;
  primary_state: string | null;
  trade_name: string | null;
};

type ApoloProfileRow = {
  entity_id: string;
  profile: string;
  status: string | null;
};

type ApoloContactRow = {
  contact_type: string;
  entity_id: string;
  is_primary: boolean | null;
  label: string | null;
  status: string | null;
  value: string;
};

type EntityIdLookupResult = {
  entries: SearchCandidate[];
  error?: unknown;
  ids: string[];
};

type IrisApoloSearchResult = {
  contacts: ContatoDaEntidade[];
  displayName: string;
  documentMasked: string | null;
  id: string;
  kind: string;
  locationLabel: string;
  matchedContactLabel: string | null;
  phone: string;
  profiles: string[];
};

const MAX_LIMIT = 30;

export async function GET(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
    "viewer",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const url = new URL(request.url);
  const rawQuery = url.searchParams.get("q") ?? "";
  const query = normalizeSearchText(rawQuery);
  const digits = onlyDigits(rawQuery);
  const limit = parseLimit(url.searchParams.get("limit"));

  if (query.length < 2 && digits.length < 2) {
    return jsonResults([]);
  }

  // O que a pessoa está digitando quando digita só números. Sem `tipo`, 11 dígitos seguem
  // valendo como TELEFONE — é o que já funcionava, e a tela é quem pergunta pelo CPF.
  const tipoPedido = normalizeTipoDeNumero(url.searchParams.get("tipo"));
  const leitura = interpretarDigitos(rawQuery);
  const tipoDoNumero =
    tipoPedido ?? (leitura.ambiguo ? "telefone" : leitura.opcoes[0]?.tipo ?? null);

  const [searchEntityIds, phoneEntityIds, contatoEntityIds] = await Promise.all([
    fetchEntityIdsBySearch(authorization.client, query, limit),
    tipoDoNumero === "cpf" || tipoDoNumero === "cnpj"
      ? fetchEntityIdsByDocument(authorization.client, digits, tipoDoNumero)
      : fetchEntityIdsByPhone(authorization.client, digits),
    fetchEntityIdsByContatoDeVinculo(authorization.client, query, digits),
  ]);

  // ⚠️ A FONTE NOVA NÃO DERRUBA A BUSCA. Os contatos de vínculo são um acréscimo: se aquela
  // consulta falhar, o operador ainda precisa achar a entidade pelo nome. Só as duas fontes
  // originais são fatais.
  if (searchEntityIds.error || phoneEntityIds.error) {
    return NextResponse.json(
      { error: "Nao foi possivel consultar a base CRM 360 do Apolo." },
      { status: 500 },
    );
  }

  // ⚠️ O CORTE TEM QUE VIR DEPOIS DO RANQUEAMENTO, NUNCA ANTES. Antes daqui a rota lia 48 ids
  // em ordem FÍSICA do heap e cortava em 36 e depois em 12 — e a imobiliária, cujo nome está
  // copiado no índice de cada cliente dela, era sempre a última da fila. Medido: "rr solucoes"
  // casa 170 linhas, a própria RR Soluções é a 170ª, e 82 de 472 imobiliárias sumiam assim.
  const entityIds = unique([
    ...phoneEntityIds.ids,
    ...contatoEntityIds.ids,
    ...ordenarPorRelevancia(searchEntityIds.entries, rawQuery).map(
      (entry) => entry.id,
    ),
  ]).slice(0, limit * 3);

  if (!entityIds.length) {
    return jsonResults([]);
  }

  const [entitiesResult, profilesResult, contactsResult, contatosDeVinculo] =
    await Promise.all([
      authorization.client
        .from("apolo_entities")
        .select(
          "id,display_name,legal_name,trade_name,document_masked,entity_kind,primary_city,primary_state",
        )
        .in("id", entityIds)
        .neq("status", "archived")
        .returns<ApoloEntityRow[]>(),
      authorization.client
        .from("apolo_entity_profiles")
        .select("entity_id,profile,status")
        .in("entity_id", entityIds)
        .returns<ApoloProfileRow[]>(),
      authorization.client
        .from("apolo_contacts")
        .select("entity_id,contact_type,label,value,status,is_primary")
        .in("entity_id", entityIds)
        .in("contact_type", ["whatsapp", "phone"])
        .returns<ApoloContactRow[]>(),
      fetchContatosDeVinculo(authorization.client, entityIds),
    ]);

  if (
    entitiesResult.error ||
    profilesResult.error ||
    contactsResult.error
  ) {
    return NextResponse.json(
      { error: "Nao foi possivel montar o resultado CRM 360 do Apolo." },
      { status: 500 },
    );
  }

  const order = new Map(entityIds.map((entityId, index) => [entityId, index]));
  const profilesByEntity = groupRowsBy(
    (profilesResult.data ?? []).filter((row) => row.status !== "archived"),
    "entity_id",
  );
  const contactsByEntity = groupRowsBy(contactsResult.data ?? [], "entity_id");
  const results = (entitiesResult.data ?? [])
    .map((entity): IrisApoloSearchResult | null => {
      // Os contatos da ficha primeiro, os do card "Contatos" do CRM depois — sem repetir
      // número, porque 62 dos 258 já existem nos dois lugares.
      const contacts = mesclarContatos(
        (contactsByEntity.get(entity.id) ?? [])
          .map(mapApoloContact)
          .sort(sortApoloContacts),
        contatosDeVinculo.get(entity.id) ?? [],
      );
      const phone = escolherTelefone(contacts);

      if (!phone) {
        return null;
      }

      const viaContato = contatoQueCasou(contacts, rawQuery, digits);

      return {
        contacts,
        // Por que esta entidade apareceu, quando quem casou foi uma pessoa ligada a ela.
        matchedContactLabel: viaContato?.label ?? null,
        displayName:
          entity.display_name ?? entity.trade_name ?? entity.legal_name ?? "Cliente",
        documentMasked: entity.document_masked,
        id: entity.id,
        kind: entity.entity_kind,
        locationLabel: [entity.primary_city, entity.primary_state]
          .filter(Boolean)
          .join(" / "),
        phone,
        profiles: unique(
          (profilesByEntity.get(entity.id) ?? [])
            .map((profile) => profile.profile)
            .filter(Boolean),
        ),
      };
    })
    .filter((result): result is IrisApoloSearchResult => Boolean(result))
    .sort((first, second) => {
      return (
        (order.get(first.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(second.id) ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .slice(0, limit);

  return jsonResults(results);
}

// ⚠️ LÊ LARGO PARA RANQUEAR, ENTREGA ESTREITO PARA NÃO ESTOURAR A URL. Medido com EXPLAIN
// ANALYZE: varrer as 5.118 linhas do índice custa ~4ms, então o teto antigo de 48 não comprava
// desempenho nenhum — só cortava a entidade certa antes de qualquer ordenação. O corte de
// verdade acontece depois, sobre ids já ranqueados, porque `.in()` com muitos uuid estoura a URL.
const TETO_DE_CANDIDATOS = 400;

async function fetchEntityIdsBySearch(
  client: SupabaseClient,
  query: string,
  limit: number,
): Promise<EntityIdLookupResult> {
  if (query.length < 2) {
    return { entries: [] as SearchCandidate[], ids: [] as string[] };
  }

  const { data, error } = await client
    .from("apolo_search_entries")
    .select("entity_id,display_name")
    .ilike("normalized_text", `%${query}%`)
    .limit(Math.max(limit * 4, TETO_DE_CANDIDATOS))
    .returns<ApoloSearchEntryRow[]>();

  const entries: SearchCandidate[] = [];
  const vistos = new Set<string>();

  for (const row of data ?? []) {
    if (vistos.has(row.entity_id)) {
      continue;
    }

    vistos.add(row.entity_id);
    entries.push({ displayName: row.display_name, id: row.entity_id });
  }

  return {
    entries,
    error,
    ids: entries.map((entry) => entry.id),
  };
}

// A TERCEIRA FONTE: o contato que o Apolo guarda como vínculo, não como telefone da ficha.
// O card "Contatos" da aba Relacionamentos grava em `apolo_relationships` com metadata.kind
// "contato" — nome no label, telefone no metadata.phone. Medido: 356 contatos em 253 entidades,
// e 196 dos 258 telefones não existem em `apolo_contacts`. Sem isto, procurar pelo nome do
// contato (ou pelo número dele) não achava nada.
async function fetchEntityIdsByContatoDeVinculo(
  client: SupabaseClient,
  query: string,
  digits: string,
): Promise<EntityIdLookupResult> {
  if (query.length < 2 && digits.length < 8) {
    return { entries: [] as SearchCandidate[], ids: [] as string[] };
  }

  // ⚠️ CARREGA E FILTRA EM MEMÓRIA, de propósito. O telefone mora no metadata COM máscara
  // (194 dos 258 têm pontuação, 111 têm hífen), então `ilike` com dígitos crus erraria 43%
  // deles. São 356 vínculos hoje — folgado diante do teto de 1.000 linhas do PostgREST.
  // ⚠️ SE ESTE NÚMERO CHEGAR PERTO DE 1.000, o corte volta calado: aí é hora de gravar um
  // telefone normalizado na própria linha e filtrar no banco.
  const { data, error } = await client
    .from("apolo_relationships")
    .select("entity_id,label,metadata")
    .eq("metadata->>kind", "contato")
    .neq("status", "archived")
    .limit(1000)
    .returns<VinculoDeContato[]>();

  const casaram = filtrarVinculosPorTermo(data ?? [], query, digits);

  return {
    entries: [] as SearchCandidate[],
    error,
    ids: unique(casaram.map((row) => row.entity_id)),
  };
}

// ⚠️ O DOCUMENTO JÁ ESTÁ INDEXADO — o que faltava era a Íris procurar por ele. O sync grava
// `apolo_entity_identifiers` com identifier_type cpf/cnpj e o hash dos DÍGITOS CRUS
// (lib/apolo/server.ts:3909, rawValue = onlyDigits). Conferido em produção: o hash gravado
// bate com sha256("apolo-identifier:cpf:"+digitos) em 500 de 500 amostras. São 4.520 CPFs e
// 502 CNPJs. Antes daqui, digitar o documento sem máscara não achava ninguém: o número ia
// para o caminho do TELEFONE, e o texto do índice guarda o documento COM máscara.
async function fetchEntityIdsByDocument(
  client: SupabaseClient,
  digits: string,
  tipo: "cnpj" | "cpf",
): Promise<EntityIdLookupResult> {
  const esperado = tipo === "cpf" ? 11 : 14;

  if (digits.length !== esperado) {
    return { entries: [] as SearchCandidate[], ids: [] as string[] };
  }

  const { data, error } = await client
    .from("apolo_entity_identifiers")
    .select("entity_id")
    .eq("identifier_type", tipo)
    .eq("value_hash", hashIdentifier(tipo, digits))
    .limit(30)
    .returns<ApoloIdentifierRow[]>();

  return {
    entries: [] as SearchCandidate[],
    error,
    ids: unique((data ?? []).map((row) => row.entity_id)),
  };
}

function normalizeTipoDeNumero(valor: string | null): TipoDeNumero | null {
  return valor === "cpf" || valor === "cnpj" || valor === "telefone"
    ? valor
    : null;
}

async function fetchContatosDeVinculo(
  client: SupabaseClient,
  entityIds: string[],
) {
  if (!entityIds.length) {
    return new Map<string, ContatoDaEntidade[]>();
  }

  const { data } = await client
    .from("apolo_relationships")
    .select("entity_id,label,metadata")
    .in("entity_id", entityIds)
    .eq("metadata->>kind", "contato")
    .neq("status", "archived")
    .returns<VinculoDeContato[]>();

  return contatosDoVinculo(data ?? []);
}

async function fetchEntityIdsByPhone(
  client: SupabaseClient,
  digits: string,
): Promise<EntityIdLookupResult> {
  if (digits.length < 8) {
    return { entries: [] as SearchCandidate[], ids: [] as string[] };
  }

  const hashes = buildBrazilPhoneVariants(digits).map((variant) =>
    hashIdentifier("phone", variant),
  );

  if (!hashes.length) {
    return { entries: [] as SearchCandidate[], ids: [] as string[] };
  }

  const { data, error } = await client
    .from("apolo_entity_identifiers")
    .select("entity_id")
    .eq("identifier_type", "phone")
    .in("value_hash", hashes)
    .limit(30)
    .returns<ApoloIdentifierRow[]>();

  return {
    entries: [] as SearchCandidate[],
    error,
    ids: unique((data ?? []).map((row) => row.entity_id)),
  };
}

function mapApoloContact(row: ApoloContactRow): ContatoDaEntidade {
  return {
    label: row.label,
    origem: "cadastro",
    primary: Boolean(row.is_primary),
    type: row.contact_type,
    value: row.value,
  };
}

function sortApoloContacts(first: ReturnType<typeof mapApoloContact>, second: ReturnType<typeof mapApoloContact>) {
  if (first.type !== second.type) {
    return first.type === "whatsapp" ? -1 : 1;
  }

  if (first.primary !== second.primary) {
    return first.primary ? -1 : 1;
  }

  return 0;
}

// `pickPreferredPhone` saiu daqui: ele olhava só o primeiro contato e, se o whatsapp estivesse
// quebrado, descartava a entidade inteira sem tentar o telefone seguinte. Agora é
// `escolherTelefone`, em lib/iris/apolo/busca-de-contato.ts, que percorre todos e tem teste.

function jsonResults(results: unknown[]) {
  return NextResponse.json(
    {
      data: {
        results,
        source: "apolo",
        total: results.length,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

function parseLimit(value: string | null) {
  const parsed = Number(value ?? 12);

  if (!Number.isFinite(parsed)) {
    return 12;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_LIMIT);
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[%_]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function onlyDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

function buildBrazilPhoneVariants(value: string) {
  const digits = onlyDigits(value);
  const variants = new Set<string>();

  if (digits.length >= 8) {
    variants.add(digits);
  }

  const national = digits.startsWith("55") ? digits.slice(2) : digits;

  if (national.length >= 8) {
    variants.add(national);
    variants.add(`55${national}`);
  }

  if (national.length === 11 && national[2] === "9") {
    const withoutNinthDigit = `${national.slice(0, 2)}${national.slice(3)}`;
    variants.add(withoutNinthDigit);
    variants.add(`55${withoutNinthDigit}`);
  }

  if (national.length === 10) {
    const withNinthDigit = `${national.slice(0, 2)}9${national.slice(2)}`;
    variants.add(withNinthDigit);
    variants.add(`55${withNinthDigit}`);
  }

  return Array.from(variants).filter((variant) => variant.length >= 8);
}

function hashIdentifier(type: string, value: string) {
  return createHash("sha256")
    .update(`apolo-identifier:${type}:${value.trim().toLowerCase()}`)
    .digest("hex");
}

function groupRowsBy<T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
) {
  const grouped = new Map<string, T[]>();

  rows.forEach((row) => {
    const value = row[key];

    if (typeof value !== "string") {
      return;
    }

    grouped.set(value, [...(grouped.get(value) ?? []), row]);
  });

  return grouped;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}
