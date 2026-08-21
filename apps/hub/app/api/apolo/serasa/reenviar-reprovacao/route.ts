import { NextResponse } from "next/server";

import { authorizeApoloAdmin } from "@/lib/apolo/auth";
import { avisarEtapa } from "@/lib/apolo/esteira-avisos";
import { lerCadDaEsteira } from "@/lib/apolo/esteira-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";

// REENVIO MANUAL do aviso de reprovação de crédito — SÓ ADMIN.
//
// O disparo automático já acontece na hora que o crédito reprova (/serasa/consultar). Esta rota é
// o botão de "reenviar" na etapa de crédito do Board: o Lucas usa para os CADs que já subiram
// antes do disparo automático existir, e para reforçar um envio que falhou.
//
// `destinatario` limita a quem reenviar ("coordenador" | "corretor"); ausente = os dois (regra
// padrão: coordenador sempre, corretor só se tiver telefone). Cada envio é registrado no
// histórico da ficha, com o admin que disparou.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Corpo = {
  destinatario?: "coordenador" | "corretor";
  // De qual CAD é a reprovação (0080). Sem ele, a CAD mais recente.
  enterpriseId?: null | number | string;
  entityId?: string;
};

export async function POST(request: Request) {
  const auth = await authorizeApoloAdmin(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const corpo = (await request.json().catch(() => ({}))) as Corpo;
  if (!corpo.entityId) {
    return NextResponse.json({ error: "Informe a ficha." }, { status: 400 });
  }

  // GUARD: só reenvia aviso de reprovação de uma ficha REALMENTE reprovada no crédito. A fonte da
  // verdade é a ETAPA persistida ("revisao"), não o veredito recomputado na tela — que oscila com
  // o limite do empreendimento e a disponibilidade do C2X. Sem isto, um clique num painel exibido
  // por engano dispararia um WhatsApp de reprovação para um cliente aprovado.
  // Guard por CAD: a etapa "revisao" é de uma CAD, não da pessoa. Sem `enterpriseId` no corpo,
  // a CAD mais recente — o mesmo default do Board, de onde este botão é clicado.
  const esteira = await lerCadDaEsteira<{ etapa: string | null }>(
    client,
    corpo.entityId,
    "etapa",
    { enterpriseId: corpo.enterpriseId },
  );

  if (esteira?.etapa !== "revisao") {
    return NextResponse.json(
      { error: "A ficha nao esta com credito reprovado (em revisao). Reenvio nao permitido." },
      { status: 409 },
    );
  }

  // ⚠️ REENVIO PELO NÚMERO DO RELACIONAMENTO, igual ao aviso automático.
  //
  // Regra do Lucas (21/08): *"reforço que os disparos têm que ser feitos pelo número do
  // relacionamento"*. Este botão saía pela Meta (`dispararReprovacao`, template no 4143), e
  // manter os dois caminhos significaria que o mesmo aviso chegaria de um número quando a máquina
  // manda e de outro quando alguém reenvia — sem contar que o ramo do corretor na Meta era morto
  // (lia um campo vazio em 718 de 718 CADs).
  //
  // `forcar` porque reenviar É pedir a repetição: a trava de "etapa não mudou" existe para o
  // automático, não para quem clica sabendo que o primeiro envio falhou.
  const resultado = await avisarEtapa(client, {
    apenas: corpo.destinatario,
    enterpriseId: corpo.enterpriseId ?? null,
    entityId: corpo.entityId,
    etapa: "revisao",
    forcar: true,
    origem: "board",
  });

  return NextResponse.json({ data: resultado });
}
