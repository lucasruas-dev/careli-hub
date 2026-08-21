import { NextResponse } from "next/server";

import { popularFilaDoLancamento } from "@/lib/apolo/popular-fila-lancamento";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { authorizePrometeuWrite } from "@/lib/prometeu/auth";
import { createPrometeuClient, getEvento } from "@/lib/prometeu/data";

// TRAZ PARA A FILA as CADs que já estavam CREDENCIADAS antes do lançamento existir.
//
// Pedido do Lucas (21/08/2026), logo depois de criar o lançamento do Villa Paris: *"criei o
// lançamento, agora todas as cads do vila paris que estão em credenciado tem que aparecer na fila
// e nas etiquetas"*.
//
// ⚠️ POR QUE ISTO PRECISA EXISTIR. A fila é alimentada por EVENTO: `garantirNaFilaDoLancamento` é
// chamada quando a CAD MUDA de etapa. Quem já estava em `credenciado` há semanas nunca mais muda
// de etapa — então, para um lançamento criado hoje, essas pessoas simplesmente não entram. Era o
// caso das 20 CADs do Villa Paris: credenciadas, e invisíveis para o evento recém-criado.
//
// ⚠️ O EVENTO PODE ESTAR EM RASCUNHO, e normalmente está: o operador cria o lançamento, traz as
// CADs, confere as etiquetas e só então ativa. Por isso o `eventoId` vai explícito, em vez de
// depender de `eventoOperavel` (que só enxerga ativo/em_andamento).
//
// A amarra de empreendimento continua valendo: `garantirNaFilaDoLancamento` recusa CAD de outro
// loteamento comparando `enterprise_id`. Aqui a consulta já nasce filtrada, então a amarra é a
// segunda tranca, não a primeira.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Centenas de fichas, uma inserção cada.
export const maxDuration = 300;

// A etapa que entra na fila. O Lucas foi explícito ("que estão em credenciado"), e é a etapa que
// significa "pode comprar": quem está em validação ou revisão ainda não pode ser atendido no
// salão.
const ETAPA_ALVO = "credenciado";

export async function POST(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const prometeu = createPrometeuClient();
  const apolo = createApoloAdminClient();
  if (!prometeu || !apolo) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as null | {
    dryRun?: boolean;
    eventoId?: string;
  };

  const eventoId = (corpo?.eventoId ?? "").trim();
  if (!eventoId) {
    return NextResponse.json({ error: "Informe o lancamento." }, { status: 400 });
  }

  const evento = await getEvento(prometeu, eventoId);
  if (!evento) {
    return NextResponse.json({ error: "Lancamento nao encontrado." }, { status: 404 });
  }

  // SEM EMPREENDIMENTO NÃO DÁ PARA SABER QUEM TRAZER. Um lançamento antigo pode estar sem, e
  // varrer "todas as CADs credenciadas" jogaria o Garden e o Lagoa Bonita na fila do Villa Paris.
  const enterpriseId = (evento.enterpriseId ?? "").trim();
  if (!enterpriseId) {
    return NextResponse.json(
      {
        error:
          "Este lancamento esta sem empreendimento. Escolha o empreendimento no Setup antes de trazer as CADs.",
      },
      { status: 409 },
    );
  }

  // ENSAIO: só conta, não insere.
  if (corpo?.dryRun !== false) {
    const { count, error } = await apolo
      .from("apolo_esteira")
      .select("entity_id", { count: "exact", head: true })
      .eq("enterprise_id", enterpriseId)
      .eq("etapa", ETAPA_ALVO);

    if (error) {
      return NextResponse.json({ error: "Falha ao ler a esteira." }, { status: 500 });
    }

    return NextResponse.json({
      data: { credenciadas: count ?? 0, dryRun: true, empreendimento: evento.enterpriseCode },
    });
  }

  // ⚠️ MESMA ROTINA DA ATIVAÇÃO, e não uma cópia dela. Ativar um lançamento já faz isto sozinho
  // (regra do Lucas: *"toda vez que eu habilitar um lançamento, o sistema já tem que buscar as
  // cads do credenciado, entender se tem pix, fazer toda essa rotina"*). Este botão é o
  // REPROCESSO: serve para quando CADs novas foram credenciadas depois da ativação, ou quando a
  // rotina da ativação falhou. Duas implementações divergiriam na primeira mudança de regra.
  const r = await popularFilaDoLancamento(apolo, eventoId);

  if (r.erro) return NextResponse.json({ error: r.erro }, { status: 409 });

  return NextResponse.json({ data: r });
}
