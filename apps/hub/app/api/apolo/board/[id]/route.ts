import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Ficha COMPLETA de um item da esteira, pro operador validar com o documento ao lado. Devolve os
// dados crus salvos no cadastro (metadata.cadastro + endereço + contatos); quem monta as seções
// é a tela, que já tem os catálogos (sexo, estado civil, profissão) e os formatadores.
// Ver [[project_esteira_credenciamento_venda]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EntityRow = {
  created_at: string;
  display_name: string;
  document_masked: string | null;
  entity_kind: string;
  id: string;
  legal_name: string | null;
  metadata: { bornRole?: string; cadastro?: Record<string, unknown> } | null;
  trade_name: string | null;
};

type AddressRow = {
  city: string | null;
  complement: string | null;
  district: string | null;
  number: string | null;
  postal_code: string | null;
  state: string | null;
  street: string | null;
};

type ContactRow = { contact_type: string; value: string };

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;

  const { data: entity } = await adminClient
    .from("apolo_entities")
    .select(
      "id, display_name, legal_name, trade_name, document_masked, entity_kind, metadata, created_at",
    )
    .eq("id", id)
    .maybeSingle<EntityRow>();

  if (!entity) {
    return NextResponse.json({ error: "Entidade nao encontrada." }, { status: 404 });
  }

  const [{ data: enderecos }, { data: contatos }] = await Promise.all([
    adminClient
      .from("apolo_addresses")
      .select("street, number, complement, district, city, state, postal_code")
      .eq("entity_id", id)
      .limit(5),
    adminClient
      .from("apolo_contacts")
      .select("contact_type, value")
      .eq("entity_id", id)
      .limit(20),
  ]);

  const endereco = ((enderecos ?? []) as AddressRow[])[0] ?? null;
  const lista = (contatos ?? []) as ContactRow[];

  return NextResponse.json(
    {
      data: {
        cadastro: entity.metadata?.cadastro ?? {},
        contato: {
          email: lista.find((c) => c.contact_type === "email")?.value ?? "",
          telefone: lista.find((c) => c.contact_type === "phone")?.value ?? "",
        },
        endereco: endereco
          ? {
              bairro: endereco.district ?? "",
              cep: endereco.postal_code ?? "",
              cidade: endereco.city ?? "",
              complemento: endereco.complement ?? "",
              logradouro: endereco.street ?? "",
              numero: endereco.number ?? "",
              uf: endereco.state ?? "",
            }
          : null,
        entidade: {
          criadoEm: entity.created_at,
          documento: entity.document_masked ?? "",
          nome: entity.legal_name || entity.display_name,
          nomeFantasia: entity.trade_name ?? "",
          papel: entity.metadata?.bornRole ?? "",
          tipo: entity.entity_kind,
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
