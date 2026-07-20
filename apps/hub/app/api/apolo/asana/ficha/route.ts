import { NextResponse } from "next/server";

import {
  asanaConfigurado,
  camposDaFicha,
  escanearCads,
  gravarChegadaDoLote,
  gravarFichaDoLote,
} from "@/lib/apolo/asana-import";
import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// BACKFILL da ficha a partir do formulário do Asana — CUSTO ZERO.
//
// As CADs importadas antes de 20/jul entraram com o que o OCR leu do documento (nome da mãe,
// RG, nascimento) mas SEM o que o formulário respondeu: profissão, renda, escolaridade e
// estado civil. Esses quatro campos entram na análise de crédito, e estavam de graça na
// descrição da task o tempo todo.
//
// Não consulta a MOST e não cria entidade: só lê o Asana e completa a ficha de quem já está
// vinculado. Preenche apenas campo VAZIO — o que o operador digitou na validação sempre ganha.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  if (!asanaConfigurado()) {
    return NextResponse.json(
      { error: "ASANA_ACCESS_TOKEN nao configurado neste ambiente." },
      { status: 503 },
    );
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    empreendimento?: string | null;
    secoes?: string[];
  };

  const empreendimento = body.empreendimento?.trim() || "Vale do Ouro";
  const secoes = body.secoes?.length ? body.secoes : ["Finalizado", "Em Cadastro"];

  try {
    const { cads } = await escanearCads({ empreendimento, secoes });

    // gid da task → entidade já criada. Quem não tem vínculo não foi importado ainda e não é
    // problema deste endpoint.
    const gids = cads.map((cad) => cad.gid);
    const entidadePorGid = new Map<string, string>();

    for (let i = 0; i < gids.length; i += 200) {
      const { data } = await client
        .from("apolo_source_links")
        .select("source_id, entity_id")
        .eq("source_system", "asana")
        .eq("source_table", "cad_task")
        .in("source_id", gids.slice(i, i + 200));

      for (const linha of (data ?? []) as { entity_id: string; source_id: string }[]) {
        entidadePorGid.set(linha.source_id, linha.entity_id);
      }
    }

    const itens = cads
      .filter((cad) => entidadePorGid.has(cad.gid))
      .map((cad) => ({
        campos: camposDaFicha({
          escolaridade: cad.escolaridade,
          estadoCivil: cad.estadoCivil,
          profissao: cad.profissao,
          renda: cad.renda,
        }),
        entityId: entidadePorGid.get(cad.gid)!,
      }));

    const resultado = await gravarFichaDoLote({ client, itens });

    // DATA DE CHEGADA: a esteira nasceu sem `chegou_em` e o Board mostrava a hora da
    // importação para todo mundo. O created_at da task é a chegada de verdade.
    const chegada = await gravarChegadaDoLote({
      client,
      itens: cads
        .filter((cad) => entidadePorGid.has(cad.gid))
        .map((cad) => ({
          criadoEm: cad.criadoEm,
          entityId: entidadePorGid.get(cad.gid)!,
        })),
    });

    return NextResponse.json({
      data: {
        atualizados: resultado.atualizados,
        cads: cads.length,
        datasPreenchidas: chegada.atualizados,
        erros: resultado.erros,
        semVinculo: cads.length - itens.length,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
