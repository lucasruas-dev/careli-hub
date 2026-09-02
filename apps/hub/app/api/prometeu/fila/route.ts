import { NextResponse } from "next/server";

import {
  createPrometeuClient,
  filaDaRecepcao,
  filaDaSecretaria,
  filaDoSalao,
  getEvento,
  listAtividadeRecente,
  listChamadasRecentes,
  listEmTransito,
  listCredenciados,
  listMesas,
  resumoDaMesa,
  resumoDeTodasAsMesas,
} from "@/lib/prometeu/data";
import {
  autorizarOperacaoComCoordenador,
  eventoNoEscopo,
  respostaForaDoEscopo,
} from "@/lib/prometeu/operador-server";

// A fila do evento: credenciados (ja ordenados pela hora do PIX) + mesas. E o que a Central,
// o Atendente e o Telao leem.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  // Leitura da fila: aceita a sessao do hub OU o cookie do operador do evento (a Central, o
  // Atendente e o Telao do posto leem daqui sem serem usuarios do hub) OU o coordenador do portal
  // comercial — este preso ao recorte dele por `eventoNoEscopo`, logo abaixo.
  const auth = await autorizarOperacaoComCoordenador(request);
  if (!auth.ok) return auth.response;

  const parametros = new URL(request.url).searchParams;
  const eventoId = parametros.get("eventoId")?.trim() ?? "";
  if (!eventoId) {
    return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
  }

  // MESA OPCIONAL: só a tela do atendente sabe em que mesa está sentada, e só ela usa os
  // indicadores "Atendimentos hoje" e "Tempo médio". A Central, o Telão e a Fila leem esta mesma
  // rota a cada 10s — cobrar deles duas consultas que ninguém olha seria pagar polling à toa.
  const mesaId = parametros.get("mesaId")?.trim() ?? "";
  // Só a Central (Mapa do salão) pede os indicadores de TODAS as mesas: é agregação a mais, e o
  // Atendente/Telão leem esta rota a cada 10s. Sem a flag, não paga o custo.
  const querResumoMesas = parametros.get("resumoMesas") === "1";

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const evento = await getEvento(client, eventoId);
  if (!evento) {
    return NextResponse.json({ error: "Evento nao encontrado." }, { status: 404 });
  }
  if (!eventoNoEscopo(auth, evento)) return respostaForaDoEscopo();

  const [credenciadosCrus, mesas, chamadas, atividade, emTransito, resumo, resumoMesas] =
    await Promise.all([
      listCredenciados(client, eventoId),
      listMesas(client, eventoId),
      listChamadasRecentes(client, eventoId),
      listAtividadeRecente(client, eventoId),
      listEmTransito(client, eventoId),
      mesaId ? resumoDaMesa(client, { eventoId, mesaId }) : Promise.resolve(null),
      querResumoMesas
        ? resumoDeTodasAsMesas(client, eventoId)
        : Promise.resolve({} as Record<string, never>),
    ]);

  // ── AUTO-REPARO DE MESA ÓRFÃ ──────────────────────────────────────────────
  // Mesa `ocupada` cujo cliente NÃO tem chamada aberta é um estado morto: o overlay do atendente
  // exige a chamada, o card de atendimento exige estado `atendimento`, e "Chamar" trava porque a
  // mesa "tem cliente". Ninguém consegue sair dele pela tela. Hoje isso nasceu de caminhos que
  // fecham a chamada por fora (aconteceu 3x em 01/08, com a fila parada e eu soltando na mão).
  //
  // As causas conhecidas foram fechadas uma a uma, mas esta rede existe para as DESCONHECIDAS:
  // esta rota roda a cada 10s em todas as telas do evento, então qualquer mesa que caia no
  // estado morto se solta sozinha na volta seguinte do polling. A tolerância de 45s no
  // `updated_at` evita colisão com uma chamada em criação (a mesa é ocupada logo após a chamada
  // nascer; 45s depois, ocupada-sem-chamada só pode ser defeito).
  const idsComChamadaAberta = new Set(emTransito.map((t) => t.credenciadoId));
  const corteMs = Date.now() - 45_000;
  const orfas = mesas.filter(
    (m) =>
      m.estado === "ocupada" &&
      m.credenciadoId &&
      !idsComChamadaAberta.has(m.credenciadoId) &&
      new Date(m.updatedAt ?? 0).getTime() < corteMs,
  );
  if (orfas.length > 0) {
    await client
      .from("prometeu_mesas")
      .update({ credenciado_id: null, estado: "livre", updated_at: new Date().toISOString() })
      .in("id", orfas.map((m) => m.id));
    // A resposta desta volta já sai com as mesas soltas — sem esperar o próximo poll.
    for (const m of mesas) {
      if (orfas.some((o) => o.id === m.id)) {
        m.estado = "livre";
        m.credenciadoId = null;
      }
    }
  }

  // TELEFONE: não existe coluna em prometeu_credenciados — o contato mora na ficha do Apolo. A
  // tela da Fila precisa dele pra falar com quem está esperando. Best-effort: sem contato, null.
  const idsFicha = credenciadosCrus
    .map((c) => c.entityId)
    .filter((id): id is string => Boolean(id));
  const telefonePorFicha = new Map<string, string>();
  // EM LOTES DE 300: um `.in()` com 1000 UUIDs estoura o limite de URL do PostgREST (400) — a
  // armadilha que derrubou a Iris com 700 ids. Acima de ~600 fichas TODOS os telefones sumiam
  // de uma vez, em silêncio. Mesmo padrão do chegadaDasFichas.
  for (let i = 0; i < idsFicha.length; i += 300) {
    const { data: contatos, error: erroContatos } = await client
      .from("apolo_contacts")
      .select("entity_id, value, contact_type")
      .in("entity_id", idsFicha.slice(i, i + 300))
      // O C2X grava telefone como 'whatsapp' na maioria dos registros e raramente como 'phone'.
      .in("contact_type", ["whatsapp", "phone"]);
    if (erroContatos) {
      console.error("[prometeu/fila] telefones da ficha falharam:", erroContatos.message);
    }
    for (const row of (contatos ?? []) as Array<{
      entity_id: string | null;
      value: string | null;
    }>) {
      const chave = row.entity_id ?? "";
      if (chave && row.value?.trim() && !telefonePorFicha.has(chave)) {
        telefonePorFicha.set(chave, row.value.trim());
      }
    }
  }

  const credenciados = credenciadosCrus.map((c) => ({
    ...c,
    telefone: c.entityId ? telefonePorFicha.get(c.entityId) ?? null : null,
  }));

  // Quem ja foi chamado nao pode continuar na fila de espera: ele esta A CAMINHO.
  const idsEmTransito = new Set(emTransito.map((t) => t.credenciadoId));

  // E QUEM ESTÁ SENTADO NUMA MESA TAMBÉM NÃO É FILA. O "Compareceu" fecha a chamada (sai de
  // idsEmTransito) mas a etapa segue `secretaria` até o Finalizar — então quem estava EM
  // ATENDIMENTO voltava para a fila das outras 17 mesas, no topo (etapaDesde antigo), durante o
  // atendimento inteiro. Era uma das causas centrais do "chamam quem já está sendo atendido".
  const idsSentados = new Set(
    mesas.filter((m) => m.estado !== "livre" && m.credenciadoId).map((m) => m.credenciadoId),
  );
  const foraDasFilas = (c: { id: string }) =>
    !idsEmTransito.has(c.id) && !idsSentados.has(c.id);

  // Duas ordens diferentes, de proposito:
  //   credenciados  -> a FILA DO EVENTO (ordem do PIX / ajuste do admin), todos.
  //   filaRecepcao  -> quem JA CHEGOU, no regime do check-in (ligado = PIX na frente; desligado =
  //                    ordem de chegada). O regime vem do liga/desliga do evento.
  // A tela precisa da segunda pra saber quem chamar; a primeira e o que foi vendido na
  // pre-venda. Confundir as duas inverte a fila no dia.
  return NextResponse.json(
    {
      data: {
        atividade,
        chamadas,
        credenciados,
        evento,
        // Chamados que nao apareceram. Lista propria: se reaparecerem, o organizador chama de novo.
        noShow: credenciados.filter((c) => c.noShow),
        // O PAINEL "aguardando chegar" É POR POSTO. Só as chamadas SEM MESA entram: essas são as
        // do salão, feitas pelo organizador para trazer a pessoa da fila. As chamadas COM mesa
        // pertencem ao atendente daquela mesa e não podem aparecer — nem serem encerradas — na
        // tela de outro posto.
        //
        // Sem este filtro, o organizador do salão via os chamados das 18 mesas da secretaria e um
        // toque em "Não veio" fechava a chamada da mesa alheia, deixando o atendente com a mesa
        // `ocupada`, sem chamada e sem nenhum botão. Travou a fila da secretaria três vezes em
        // 01/08, a última com 50 pessoas esperando.
        emTransito: emTransito.filter((t) => !t.mesaId),
        // A lista COMPLETA continua indo à parte: a Central e a gestão precisam enxergar tudo,
        // e é `idsEmTransito` (montado com todas) que tira da fila quem já foi chamado.
        emTransitoTodos: emTransito,
        // A REGRA VALE PARA AS TRÊS FILAS, e a da secretaria estava de fora — o pior lugar para
        // ficar, porque ali são 18 mesas lendo a MESMA lista. Chamar não muda a etapa, então quem
        // a Mesa 03 acabou de chamar continuava em 1º na tela das outras 17, com o botão Chamar
        // ativo; e o servidor não recusa a segunda chamada, só troca o `mesa_id` e deixa as duas
        // mesas com o mesmo cliente. A pessoa vai para uma, a outra fica com um atendimento
        // fantasma que nem dá para liberar pela tela. (Achado em 01/08, evento rodando.)
        filaSecretaria: filaDaSecretaria(credenciados).filter(foraDasFilas),
        filaSalao: filaDoSalao(credenciados).filter(foraDasFilas),
        // QUEM FOI CHAMADO SAI DA FILA e passa a viver no painel de trânsito (regra do Lucas,
        // 27/07: "quando eu chamar ele tem que sair da fila e ir pro trânsito, assim eu evito
        // chamar o cliente duas vezes sem querer"). Rechamar existe lá, no painel.
        filaRecepcao: filaDaRecepcao(
          credenciados,
          evento?.config?.checkinHabilitado ?? true,
        ).filter(foraDasFilas),
        mesas,
        // Nulo quando a tela não informou a mesa: é "não perguntei", não "zero atendimentos".
        resumoDaMesa: resumo,
        // Indicadores por mesa (só quando resumoMesas=1): {mesaId -> {atendimentos, unidades, ...}}.
        resumoDeMesas: resumoMesas,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
