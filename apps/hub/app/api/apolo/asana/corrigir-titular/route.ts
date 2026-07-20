import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { acharDocumentosDoCasal } from "@/lib/apolo/corrigir-titular";
import { atualizarIdentidade } from "@/lib/apolo/identidade-persist";
import { custoOcrImagem } from "@/lib/apolo/most-precos";
import { createApoloAdminClient } from "@/lib/apolo/server";

// CORRIGIR O TITULAR das fichas que ficaram com o cônjuge no lugar do proponente.
//
// GET  = ORÇAMENTO, custo ZERO: quantas fichas, quantos documentos e o TETO em reais.
// POST = EXECUTA, e é cobrado por imagem lida. Exige `confirmado`.
//
// A fonte de quem é quem é o laudo do diagnóstico (apolo_audit_events, action
// 'diagnostico_cad'), que já comparou cada ficha com o formulário do Asana. Aqui não se
// decide nada de novo: lê-se o documento do proponente e põe-se cada um no seu lugar.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// Lote pequeno de propósito: o gasto aparece aos poucos em vez de uma chamada longa que pode
// estourar no meio já tendo pago.
const MAXIMO_POR_LOTE = 5;

type Laudo = {
  conjugeAsana: string | null;
  entity_id: string;
  proponenteAsana: string | null;
  tituloApolo: string | null;
};

// Último laudo de cada ficha com o veredito pedido.
async function laudos(
  client: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  veredito: string,
): Promise<Laudo[]> {
  const { data } = await client
    .from("apolo_audit_events")
    .select("entity_id, metadata, created_at")
    .eq("action", "diagnostico_cad")
    .order("created_at", { ascending: false })
    .limit(2000);

  const vistos = new Set<string>();
  const saida: Laudo[] = [];
  for (const linha of (data ?? []) as {
    entity_id: string;
    metadata: Record<string, unknown>;
  }[]) {
    if (!linha.entity_id || vistos.has(linha.entity_id)) continue;
    vistos.add(linha.entity_id);
    if (String(linha.metadata?.veredito ?? "") !== veredito) continue;
    saida.push({
      conjugeAsana: (linha.metadata?.conjugeAsana as string) ?? null,
      entity_id: linha.entity_id,
      proponenteAsana: (linha.metadata?.proponenteAsana as string) ?? null,
      tituloApolo: (linha.metadata?.tituloApolo as string) ?? null,
    });
  }
  return saida;
}

export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const url = new URL(request.url);
  const veredito = url.searchParams.get("veredito") ?? "trocado";
  const alvos = await laudos(client, veredito);

  let documentos = 0;
  for (const alvo of alvos) {
    const { count } = await client
      .from("apolo_documents")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", alvo.entity_id)
      .not("storage_path", "is", null);
    documentos += count ?? 0;
  }

  return NextResponse.json(
    {
      data: {
        // TETO: assume que todo documento seria lido e nenhum estaria em cache. O real fica
        // bem abaixo — a busca para no documento do proponente e o que já foi lido não recobra.
        custoTeto: Number((documentos * custoOcrImagem()).toFixed(2)),
        documentos,
        fichas: alvos.length,
        itens: alvos.map((a) => ({
          conjuge: a.conjugeAsana,
          entityId: a.entity_id,
          estaComo: a.tituloApolo,
          proponente: a.proponenteAsana,
        })),
        veredito,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    confirmado?: boolean;
    entityIds?: string[];
  };

  if (!body.confirmado) {
    return NextResponse.json(
      { error: "Esta acao LE DOCUMENTOS na MOST e e cobrada por imagem. Confirme o orcamento." },
      { status: 428 },
    );
  }

  const pedidos = body.entityIds ?? [];
  if (pedidos.length === 0) {
    return NextResponse.json({ error: "Nenhuma ficha no lote." }, { status: 400 });
  }
  if (pedidos.length > MAXIMO_POR_LOTE) {
    return NextResponse.json(
      { error: `Envie no maximo ${MAXIMO_POR_LOTE} fichas por lote.` },
      { status: 400 },
    );
  }

  const todos = await laudos(client, "trocado");
  const porId = new Map(todos.map((l) => [l.entity_id, l]));

  const resultado = {
    corrigidas: 0,
    custoBrl: 0,
    detalhes: [] as { erro?: string; ficha: string; ok: boolean }[],
    imagensPagas: 0,
    pendentes: 0,
  };

  for (const entityId of pedidos) {
    const laudo = porId.get(entityId);
    if (!laudo?.proponenteAsana) {
      resultado.pendentes += 1;
      resultado.detalhes.push({
        erro: "Sem laudo de troca para esta ficha.",
        ficha: entityId,
        ok: false,
      });
      continue;
    }

    const achado = await acharDocumentosDoCasal({
      client,
      conjugeNome: laudo.conjugeAsana,
      entityId,
      lidoPor: auth.userId,
      proponenteNome: laudo.proponenteAsana,
    });

    resultado.custoBrl += achado.custoBrl;
    resultado.imagensPagas += achado.imagensPagas;

    // Sem o documento do proponente não se troca nada: trocar o nome mantendo o CPF do
    // cônjuge deixaria a ficha PIOR do que está (nome de um, documento de outro).
    if (!achado.proponenteEncontrado?.cpf) {
      resultado.pendentes += 1;
      resultado.detalhes.push({
        erro: achado.motivo,
        ficha: laudo.proponenteAsana,
        ok: false,
      });
      continue;
    }

    const trocada = await atualizarIdentidade({
      autorUserId: auth.userId,
      client,
      documento: achado.proponenteEncontrado.cpf,
      entityId,
      motivo:
        `Correcao automatica: o formulario do Asana aponta ${laudo.proponenteAsana} como ` +
        `proponente, e a ficha estava como ${laudo.tituloApolo}.`,
      nome: achado.proponenteEncontrado.nome ?? laudo.proponenteAsana,
      tipo: "pf",
    });

    if (!trocada.ok) {
      resultado.pendentes += 1;
      resultado.detalhes.push({ erro: trocada.erro, ficha: laudo.proponenteAsana, ok: false });
      continue;
    }

    // A ficha (jsonb) passa a ser do proponente: o que estava lá era do cônjuge.
    const doProponente = achado.proponenteEncontrado;
    const { data: esteira } = await client
      .from("apolo_esteira")
      .select("ficha")
      .eq("entity_id", entityId)
      .maybeSingle();

    const fichaAtual = ((esteira as { ficha: Record<string, unknown> } | null)?.ficha ??
      {}) as Record<string, unknown>;

    // Os campos de IDENTIDADE da ficha eram do CÔNJUGE e passam a ser do proponente.
    //
    // ⚠️ Aqui o campo que o documento novo NÃO trouxe tem que ficar VAZIO, não preservado.
    // Preservar seria manter nascimento e nome da mãe de OUTRA PESSOA numa ficha que agora é
    // do proponente — foi o que aconteceu com o Mateus, que ficou com a data e a mãe da Karla
    // porque a CNH dele não devolveu esses campos. Campo em branco o operador preenche; campo
    // com o dado de outra pessoa ele não tem como desconfiar.
    //
    // O resto da ficha (profissão, renda, escolaridade, telefone) NÃO é tocado: veio do
    // formulário e já era do proponente desde o início.
    const ficha: Record<string, unknown> = { ...fichaAtual };
    for (const [chave, valor] of Object.entries({
      dataNascimento: doProponente.dataNascimento,
      nacionalidade: doProponente.nacionalidade,
      naturalidade: doProponente.naturalidade,
      nomeMae: doProponente.nomeMae,
      rg: doProponente.rg,
    })) {
      if (valor) ficha[chave] = valor;
      else delete ficha[chave];
    }

    await client.from("apolo_esteira").update({ ficha }).eq("entity_id", entityId);

    // O cônjuge ganha os dados do documento DELE, quando encontrado.
    if (laudo.conjugeAsana) {
      const doConjuge = achado.conjugeEncontrado;

      // ⚠️ O relacionamento atual guarda e-mail e telefone do cônjuge, que vieram do
      // formulário do Asana e NÃO são relidos aqui. Um delete+insert cru os jogaria fora.
      // Por isso lemos o metadata antigo e mesclamos por cima.
      const { data: relAtual } = await client
        .from("apolo_relationships")
        .select("id, metadata")
        .eq("entity_id", entityId)
        .eq("relationship_type", "conjuge")
        .limit(1)
        .maybeSingle();

      const metadataAntigo = ((relAtual as { metadata: Record<string, unknown> } | null)
        ?.metadata ?? {}) as Record<string, unknown>;

      const doDocumento: Record<string, unknown> = {};
      for (const [chave, valor] of Object.entries({
        cpf: doConjuge?.cpf,
        dataNascimento: doConjuge?.dataNascimento,
        nomeMae: doConjuge?.nomeMae,
      })) {
        if (valor) doDocumento[chave] = valor;
      }

      const conteudo = {
        label: doConjuge?.nome ?? laudo.conjugeAsana,
        metadata: {
          ...metadataAntigo,
          ...doDocumento,
          kind: "contato",
          origem: "correcao-titular",
          source: "apolo",
        },
      };

      if (relAtual) {
        await client
          .from("apolo_relationships")
          .update(conteudo)
          .eq("id", (relAtual as { id: string }).id);
      } else {
        await client.from("apolo_relationships").insert({
          ...conteudo,
          entity_id: entityId,
          relationship_type: "conjuge",
          status: "active",
        });
      }
    }

    resultado.corrigidas += 1;
    resultado.detalhes.push({ ficha: laudo.proponenteAsana, ok: true });
  }

  resultado.custoBrl = Number(resultado.custoBrl.toFixed(2));
  return NextResponse.json({ data: resultado });
}
