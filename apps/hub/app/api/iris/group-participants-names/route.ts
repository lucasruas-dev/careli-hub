import { NextResponse, type NextRequest } from "next/server";

import { fetchEvolutionContatos } from "@/lib/iris/evolution-api";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// PREENCHE O NOME dos participantes de grupo a partir da AGENDA da instância.
//
// O número do Relacionamento espelha um WhatsApp real, com os contatos salvos no aparelho. O
// backfill anterior semeou só os NÚMEROS (o `findGroupInfos` não devolve nome), então a menção
// listava telefone. Aqui buscamos a agenda inteira e casamos por número.
//
// `dryRun: true` (padrão) NÃO grava: devolve quantos casariam e uma amostra. Assim dá pra
// conferir que os nomes vêm certos antes de escrever em cima de 1.400 participantes.
export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request);

  if (!authorization.ok) {
    return authorization.response;
  }

  const { client } = authorization;

  let dryRun = true;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.dryRun === false) dryRun = false;
  } catch {
    // corpo opcional: sem corpo, é simulação
  }

  const contatos = await fetchEvolutionContatos();

  if (contatos.length === 0) {
    return NextResponse.json(
      { error: "A Evolution nao devolveu contatos." },
      { status: 502 },
    );
  }

  // Casamento por número. O WhatsApp brasileiro varia o 9º dígito entre o que está salvo na
  // agenda e o que aparece no grupo, então indexamos pelos ÚLTIMOS 8 dígitos — o miolo do
  // número, que não muda. Ver [[project-iris-duplicate-tickets-9digit]].
  const nomePorFinal = new Map<string, string>();
  for (const contato of contatos) {
    if (!contato.name) continue;
    const final = contato.phone.slice(-8);
    if (final.length === 8 && !nomePorFinal.has(final)) {
      nomePorFinal.set(final, contato.name);
    }
  }

  const { data: participantes } = await client
    .from("caredesk_whatsapp_group_participants")
    .select("id,phone,display_name")
    .is("display_name", null)
    .limit(5000);

  const alvos = (participantes ?? []) as {
    display_name: string | null;
    id: string;
    phone: string;
  }[];

  const casados: { nome: string; phone: string }[] = [];
  for (const alvo of alvos) {
    const nome = nomePorFinal.get(alvo.phone.replace(/\D/g, "").slice(-8));
    if (nome) casados.push({ nome, phone: alvo.phone });
  }

  if (dryRun) {
    return NextResponse.json({
      data: {
        amostra: casados.slice(0, 12),
        contatosNaAgenda: contatos.length,
        contatosComNome: nomePorFinal.size,
        dryRun: true,
        semNomeNoBanco: alvos.length,
        vaoGanharNome: casados.length,
      },
    });
  }

  // Grava um por um: são poucos milhares e um `upsert` em massa aqui exigiria remontar a linha
  // inteira — justamente o tipo de remonte que já apagou campo em silêncio neste projeto.
  let gravados = 0;
  for (const alvo of alvos) {
    const nome = nomePorFinal.get(alvo.phone.replace(/\D/g, "").slice(-8));
    if (!nome) continue;

    const { error } = await client
      .from("caredesk_whatsapp_group_participants")
      .update({ display_name: nome, updated_at: new Date().toISOString() })
      .eq("id", alvo.id);

    if (!error) gravados += 1;
  }

  return NextResponse.json({
    data: {
      contatosNaAgenda: contatos.length,
      dryRun: false,
      gravados,
      semNomeNoBanco: alvos.length,
    },
  });
}
