import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
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

  // A ficha vive em `apolo_esteira.ficha` (tabela própria) — o que o OCR leu, o que veio do
  // formulário do Asana e o que o OPERADOR digitou. Não pode ficar no metadata da entidade:
  // o sync do C2X substitui o metadata inteiro a cada rodada e apagaria o trabalho dele.
  const { data: esteiraRow } = await adminClient
    .from("apolo_esteira")
    .select("ficha, ficha_editada_em")
    .eq("entity_id", id)
    .maybeSingle();

  const daEsteira = ((esteiraRow as { ficha: Record<string, unknown> } | null)?.ficha ??
    {}) as Record<string, unknown>;

  // O que o FORMULÁRIO do Asana diz sobre esta CAD (último laudo do diagnóstico). É a
  // referência que o operador usa para decidir: o Asana separa proponente de cônjuge e diz
  // se é PF ou PJ. Sem isso na tela, ele teria que abrir o Asana a cada ficha.
  const { data: laudoRow } = await adminClient
    .from("apolo_audit_events")
    .select("metadata, created_at")
    .eq("entity_id", id)
    .eq("action", "diagnostico_cad")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const laudo = ((laudoRow as { metadata: Record<string, unknown> } | null)?.metadata ??
    null) as Record<string, unknown> | null;
  // O que o operador editou GANHA do que veio da importação.
  const cadastro = { ...(entity.metadata?.cadastro ?? {}), ...daEsteira };

  return NextResponse.json(
    {
      data: {
        cadastro,
        contato: {
          email: lista.find((c) => c.contact_type === "email")?.value ?? "",
          // ⚠️ O C2X grava o telefone como 'whatsapp' (4.064 registros) e quase nunca como
          // 'phone' (248). Procurar só por 'phone' deixava 94% das fichas sem telefone na
          // validação — o operador via um traço e ia atrás de um dado que já estava no banco.
          telefone:
            lista.find((c) => c.contact_type === "whatsapp")?.value ??
            lista.find((c) => c.contact_type === "phone")?.value ??
            "",
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
        // Referência do Asana + divergências, para a tela avisar em vez de o operador adivinhar.
        asana: laudo
          ? {
              conjuge: (laudo.conjugeAsana as string) ?? null,
              perfil: (laudo.perfilAsana as string) ?? null,
              proponente: (laudo.proponenteAsana as string) ?? null,
              tipoDiverge: Boolean(laudo.divergeTipo),
              tipoNoAsana: (laudo.tipoNoAsana as string) ?? null,
              veredito: (laudo.veredito as string) ?? null,
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

// Salva o que o OPERADOR completou na validação.
//
// Grava em `apolo_esteira.ficha`, não no metadata da entidade: o sync do C2X substitui o
// metadata inteiro a cada rodada e apagaria o trabalho dele — foi o que aconteceu com a
// esteira em 20/jul. Aqui o prejuízo seria pior, porque é digitação humana.
//
// Faz MERGE, nunca replace: o operador salva um campo por vez e não pode zerar o resto.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    campos?: Record<string, unknown>;
  };

  const campos = body.campos ?? {};
  if (Object.keys(campos).length === 0) {
    return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });
  }

  const { data: atual } = await adminClient
    .from("apolo_esteira")
    .select("ficha")
    .eq("entity_id", id)
    .maybeSingle();

  const fichaAtual = ((atual as { ficha: Record<string, unknown> } | null)?.ficha ??
    {}) as Record<string, unknown>;

  // Campo apagado pelo operador (string vazia) some da ficha, em vez de virar "" — assim ele
  // consegue LIMPAR um dado que o OCR leu errado.
  const mesclada: Record<string, unknown> = { ...fichaAtual };
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor === "" || valor === null) delete mesclada[chave];
    else mesclada[chave] = valor;
  }

  const { error } = await adminClient.from("apolo_esteira").upsert(
    {
      entity_id: id,
      ficha: mesclada,
      ficha_editada_em: new Date().toISOString(),
      ficha_editada_por: auth.userId,
    },
    { onConflict: "entity_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: { ficha: mesclada, ok: true } });
}
