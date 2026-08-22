import { NextResponse, type NextRequest } from "next/server";

import { createPrometeuClient, eventoOperavelId, getEvento, listCredenciados } from "@/lib/prometeu/data";
import { autorizarOperacao } from "@/lib/prometeu/operador-server";
import {
  agruparPorCliente,
  reservasVivasDoC2x,
  unidadesVivasDoC2x,
} from "@/lib/prometeu/reservas-c2x";

// AS RESERVAS DO DIA, LIDAS DO C2X. O hub não registra reserva nenhuma (regra do Lucas, 01/08):
// o corretor lança o pedido de aquisição lá e esta rota só reflete, cruzando por CPF com quem
// está na fila do evento para trazer imobiliária e etapa do salão.
//
// Só leitura, dos dois lados.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Mesma porta das outras telas do evento: sessão do hub OU cookie do operador do posto.
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const params = new URL(request.url).searchParams;
  let eventoId = (params.get("eventoId") ?? "").trim();
  // Sem id, descobre o evento do dia — `eventoOperavelId` entende `em_andamento` E `ativo`. Filtrar
  // só por "ativo" na mão foi a causa de três bugs em 01/08; não repetir.
  if (!eventoId) eventoId = (await eventoOperavelId(client)) ?? "";
  if (!eventoId) {
    return NextResponse.json({ error: "Nenhum evento em andamento." }, { status: 404 });
  }

  const evento = await getEvento(client, eventoId);
  const enterpriseId = Number(evento?.enterpriseId ?? 0);
  if (!enterpriseId) {
    return NextResponse.json(
      { error: "O evento nao esta ligado a um empreendimento do C2X." },
      { status: 400 },
    );
  }

  // As duas leituras do C2X saem juntas: a aba precisa das RESERVAS PARADAS e o resto da Central
  // (coluna Unidades, "UN" da mesa, funil, card de vendas) precisa de TODAS as unidades vivas.
  // Uma chamada só de ida ao legado para os dois, que é conexão escassa lá.
  const [{ error, reservas }, { error: erroUnidades, porCpf: unidadesPorCpf }] = await Promise.all([
    reservasVivasDoC2x(enterpriseId),
    unidadesVivasDoC2x(enterpriseId),
  ]);
  if (error) {
    return NextResponse.json({ error }, { headers: { "Cache-Control": "no-store" }, status: 502 });
  }

  // Cruza por CPF com a fila do evento: é o que traz imobiliária, etapa no salão e a informação
  // de que a pessoa está (ou não) credenciada aqui.
  const credenciados = await listCredenciados(client, eventoId);
  const soDigitos = (v: string | null) => String(v ?? "").replace(/\D/g, "");
  const porCpf = new Map(credenciados.map((c) => [soDigitos(c.documento), c]));

  const clientes = agruparPorCliente(reservas).map((c) => {
    const noEvento = porCpf.get(c.cpf);
    return {
      ...c,
      // Nome do evento quando existe: é o que o time reconhece nas outras telas.
      cliente: noEvento?.nome ?? c.cliente,
      // ⚠️ O CORRETOR SAI DAQUI, resolvido contra a fila INTEIRA do evento — não pode ficar para a
      // tela resolver. O C2X não preenche `acquisition_requests.corretor_id` (35 de 35 nulos no
      // Villa Paris), então o nome só existe do lado do Apolo, na CAD. E a tela cruzava com a
      // lista que ela já tinha em mão, que é recortada por quem está presente: como quem reserva
      // costuma estar em `recepcao` (reservou pelo corretor sem ter passado pelo salão), o
      // cruzamento falhava justamente para as 14 linhas da aba e a coluna vinha toda com "—".
      corretor: noEvento?.corretor ?? c.corretor ?? null,
      credenciadoId: noEvento?.id ?? null,
      etapaNoEvento: noEvento?.etapa ?? null,
      imobiliaria: noEvento?.imobiliaria ?? null,
      // Reservou no C2X mas não passou pelo credenciamento do evento. Acontece e não é erro —
      // a tela mostra, marcado, em vez de esconder.
      naFilaDoEvento: Boolean(noEvento),
    };
  });

  return NextResponse.json(
    {
      data: {
        atualizadoEm: new Date().toISOString(),
        clientes,
        // Mapa CPF -> unidades na mão da pessoa AGORA, em qualquer etapa. É o que preenche a
        // coluna "Unidades" da lista, o "UN" de cada mesa e o funil — todos liam
        // `prometeu_unidades`, que nunca foi escrita.
        unidadesPorCpf: erroUnidades ? {} : unidadesPorCpf,
        resumo: {
          clientes: clientes.length,
          foraDaFila: clientes.filter((c) => !c.naFilaDoEvento).length,
          unidades: reservas.length,
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
