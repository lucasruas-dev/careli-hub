import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { avisarEtapa, etapaTemAviso } from "@/lib/apolo/esteira-avisos";
import { createApoloAdminClient } from "@/lib/apolo/server";

// AVISO EM LOTE das CADs de um empreendimento — pôr o coordenador (ou o corretor) em dia com o
// que já está gravado na esteira.
//
// Pedido do Lucas (21/08/2026): *"quando subir, dispara por favor todas as mensagens do villa
// paris para o coordenador"*. Perguntei se preferia um resumo agrupado, ele escolheu **todas,
// uma a uma**.
//
// ⚠️ POR QUE UMA ROTA, E NÃO O SCRIPT. O envio sai pelo gateway do Relacionamento, cujas
// credenciais (`EVOLUTION_API_*`) só existem no ambiente da Vercel — rodando da máquina de
// alguém, as 44 mensagens falham todas com "Gateway Evolution nao configurado" (medido, com uma
// mensagem, antes de soltar o lote). Aqui o código roda onde as credenciais estão.
//
// ⚠️ `dryRun` É O PADRÃO. Isto escreve no WhatsApp de pessoas reais e não tem desfazer: sem
// `dryRun:false` explícito, devolve o que SERIA enviado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Dezenas de envios seriais, com pausa entre eles. O teto é o da função.
export const maxDuration = 300;

// Ordem de envio: o que está PARADO primeiro. Quem recebe 44 mensagens lê as primeiras com
// atenção e as últimas na diagonal — então as que pedem ação chegam antes das que são histórico.
const PRIORIDADE: Record<string, number> = {
  correcao: 0,
  revisao: 1,
  validacao: 2,
  credito: 3,
  prevenda: 4,
  credenciado: 5,
  indeferido: 6,
};

// Pausa entre mensagens. São dezenas para o MESMO número, pelo celular do Relacionamento — em
// rajada, é o padrão que marca conta como spam, e o número é o que fala com corretor e
// imobiliária o dia inteiro.
const PAUSA_MS = 3500;

function autorizadoPorSecret(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && token === secret);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: NextRequest) {
  if (!autorizadoPorSecret(request)) {
    const auth = await authorizeApoloWrite(request);
    if (!auth.ok) return auth.response;
  }

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const corpo = (await request.json().catch(() => null)) as null | {
    apenas?: "coordenador" | "corretor";
    dryRun?: boolean;
    enterpriseId?: number | string;
    // Continua um lote interrompido sem repetir quem já recebeu (o `maxDuration` corta lotes
    // longos, e mandar tudo de novo dobraria as mensagens de quem já foi avisado).
    pular?: number;
    limite?: number;
  };

  const enterpriseId = String(corpo?.enterpriseId ?? "").trim();
  if (!/^\d+$/.test(enterpriseId)) {
    return NextResponse.json({ error: "enterpriseId obrigatorio." }, { status: 400 });
  }

  const dryRun = corpo?.dryRun !== false;

  const { data, error } = await client
    .from("apolo_esteira")
    .select("entity_id, etapa")
    .eq("enterprise_id", enterpriseId);

  if (error) {
    return NextResponse.json({ error: "Falha ao ler a esteira." }, { status: 500 });
  }

  const ordenadas = ((data ?? []) as { entity_id: string; etapa: string }[])
    .filter((l) => etapaTemAviso(l.etapa))
    .sort(
      (a, b) =>
        (PRIORIDADE[a.etapa] ?? 9) - (PRIORIDADE[b.etapa] ?? 9) ||
        a.entity_id.localeCompare(b.entity_id),
    );

  const inicio = Number(corpo?.pular ?? 0) > 0 ? Number(corpo?.pular) : 0;
  const limite = Number(corpo?.limite ?? 0) > 0 ? Number(corpo?.limite) : null;
  const restantes = ordenadas.slice(inicio);
  const alvo = limite ? restantes.slice(0, limite) : restantes;

  const porEtapa = alvo.reduce<Record<string, number>>((acc, l) => {
    acc[l.etapa] = (acc[l.etapa] ?? 0) + 1;
    return acc;
  }, {});

  if (dryRun) {
    return NextResponse.json({
      data: { dryRun: true, porEtapa, total: alvo.length, totalNoEmpreendimento: ordenadas.length },
    });
  }

  const resultados: { erro?: string; etapa: string; ok: boolean }[] = [];

  for (const [i, l] of alvo.entries()) {
    const r = await avisarEtapa(client, {
      apenas: corpo?.apenas,
      enterpriseId,
      entityId: l.entity_id,
      etapa: l.etapa,
      // A etapa não mudou agora: é backfill do que já está gravado, então a trava de repetição
      // (que existe para o fluxo automático) precisa ser dispensada de propósito.
      forcar: true,
      origem: "board",
    });

    const alvoDoAviso = corpo?.apenas === "corretor" ? r?.corretor : r?.coordenador;
    resultados.push({
      erro: alvoDoAviso?.erro,
      etapa: l.etapa,
      ok: alvoDoAviso?.ok ?? false,
    });

    if (i < alvo.length - 1) await dormir(PAUSA_MS);
  }

  return NextResponse.json({
    data: {
      enviados: resultados.filter((r) => r.ok).length,
      falhas: resultados.filter((r) => !r.ok).length,
      porEtapa,
      resultados,
      total: alvo.length,
    },
  });
}
