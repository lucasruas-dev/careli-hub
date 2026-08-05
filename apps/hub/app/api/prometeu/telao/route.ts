import { NextResponse } from "next/server";

import {
  createPrometeuClient,
  eventoOperavelId,
  filaDaSecretaria,
  filaDoSalao,
  getEvento,
  listCredenciados,
} from "@/lib/prometeu/data";
import { topicoDaFila } from "@/lib/prometeu/fila-topic";
import { validarTokenDoTelao } from "@/lib/prometeu/link-do-telao";
import { nomeDoLancamento } from "@/lib/prometeu/lancamento";
import { autorizarOperacao } from "@/lib/prometeu/operador-server";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

// O TELÃO por canal (salão ou secretaria). Uma TV escuta o broadcast do evento
// (prometeu:fila:<eventoId>, o mesmo do celular do cliente) e, ao ser avisada, pergunta a esta rota
// QUEM foi chamado no SEU canal + próximos + já chamados. O nome do cliente aparece numa TV pública
// de propósito (é a chamada), mas trafega por aqui atrás do login do operador, não pelo broadcast.
// Ver [[project_prometeu_gestao_fila]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CANAIS = new Set(["salao", "secretaria"]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // TRÊS portas, na ordem: token da TV (`?tv=`, o modo independente — a TV liga com o link e
  // nunca pede login), sessão do hub, cookie do operador. O token só vale se apontar para o
  // evento OPERÁVEL de hoje: lançamento encerrado ou trocado mata o link sozinho.
  // (Pedido do Lucas, 02/08: "vamos tirar o operador da TV" — o cookie de 14h expirava no meio
  // do evento e o telão morria mudo.)
  const eventoDoToken = validarTokenDoTelao(params.get("tv"));
  if (!eventoDoToken) {
    const auth = await autorizarOperacao(request);
    if (!auth.ok) return auth.response;
  }

  const canal = (params.get("canal") ?? "").trim().toLowerCase();
  if (!CANAIS.has(canal)) {
    return NextResponse.json(
      { error: "Informe canal=salao|secretaria." },
      { status: 400 },
    );
  }

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  // O telão liga sem saber o id: usa o eventoId informado ou descobre o evento do dia.
  //
  // ⚠️ ERA `.eq("status", "ativo")` — e isso apagava o telão no exato momento em que o evento
  // COMEÇAVA: "Iniciar evento" muda o status de `ativo` para `em_andamento`, a busca não achava
  // nada e a rota respondia "Nenhum evento ativo". Quem tinha aberto o telão com o eventoId na
  // URL não sentia; quem abriu sem o id ficou cego o dia inteiro. Agora usa `eventoOperavelId`,
  // a mesma função das outras telas, que prioriza `em_andamento` e cai para `ativo`.
  // (Achado no dia do lançamento, 01/08, com o evento rodando.)
  let eventoId = (params.get("eventoId") ?? "").trim();
  if (!eventoId) eventoId = (await eventoOperavelId(client)) ?? "";
  if (!eventoId) {
    return NextResponse.json({ error: "Nenhum evento ativo." }, { status: 404 });
  }

  // TV por token: o link só vale para o evento para o qual foi emitido. Evento novo = link novo
  // (impresso no Setup). É o que "revoga" o token sem precisar de expiração.
  if (eventoDoToken && eventoDoToken !== eventoId) {
    return NextResponse.json(
      { error: "Este link de TV e' de outro lancamento. Gere o link novo no Setup." },
      { status: 401 },
    );
  }

  const evento = await getEvento(client, eventoId);
  if (!evento) {
    return NextResponse.json({ error: "Evento nao encontrado." }, { status: 404 });
  }

  const credenciados = await listCredenciados(client, eventoId);

  // Chamadas do canal (a zona da chamada = salao|secretaria), mais recentes primeiro.
  const { data: chamadasRaw } = await client
    .from("prometeu_chamadas")
    .select("id, credenciado_id, mesa_id, chamado_em")
    .eq("evento_id", eventoId)
    .eq("zona", canal)
    .order("chamado_em", { ascending: false })
    .limit(12);
  const chamadas = (chamadasRaw ?? []) as Array<{
    chamado_em: string;
    credenciado_id: string;
    id: string;
    mesa_id: string | null;
  }>;

  // Nome/imob/corretor de QUEM foi chamado. Inclui excluídos/no-show/arquivados: a linha da chamada
  // continua existindo, mas essas pessoas já saíram de listCredenciados (que filtra encerrado_em) —
  // sem isto, o card da chamada sairia EM BRANCO na TV pública.
  const infoChamado = new Map<
    string,
    { corretor: string | null; imob: string | null; nome: string }
  >();
  for (const c of credenciados) {
    infoChamado.set(c.id, {
      corretor: c.corretor ?? null,
      imob: c.imobiliaria ?? null,
      nome: c.nome,
    });
  }
  const faltantes = [...new Set(chamadas.map((c) => c.credenciado_id))].filter(
    (id) => id && !infoChamado.has(id),
  );
  if (faltantes.length) {
    const { data: extras } = await client
      .from("prometeu_credenciados")
      .select("id, nome, imobiliaria, corretor")
      .in("id", faltantes);
    for (const e of (extras ?? []) as Array<{
      corretor: string | null;
      id: string;
      imobiliaria: string | null;
      nome: string;
    }>) {
      infoChamado.set(e.id, {
        corretor: e.corretor ?? null,
        imob: e.imobiliaria ?? null,
        nome: e.nome,
      });
    }
  }

  // Mesas: id -> número (pra mostrar "Mesa 07").
  const mesaIds = chamadas
    .map((c) => c.mesa_id)
    .filter((v): v is string => Boolean(v));
  const numeroPorMesa = new Map<string, string>();
  if (mesaIds.length) {
    const { data: mesas } = await client
      .from("prometeu_mesas")
      .select("id, numero")
      .in("id", mesaIds);
    for (const m of (mesas ?? []) as Array<{
      id: string;
      numero: number | string;
    }>) {
      numeroPorMesa.set(m.id, String(m.numero));
    }
  }

  const cardChamada = (c: (typeof chamadas)[number]) => {
    const cred = infoChamado.get(c.credenciado_id);

    return {
      chamadoEm: c.chamado_em,
      corretor: canal === "salao" ? cred?.corretor ?? null : null,
      // QUEM é o chamado. O telão precisa disto para a RECHAMADA: chamar de novo reaproveita a
      // mesma linha (o id e a hora NÃO mudam, de propósito — o cronômetro de espera não pode
      // zerar), então o id não serve de gatilho. O aviso em tempo real traz este mesmo id e é ele
      // que diz "anuncie de novo esta pessoa".
      credenciadoId: c.credenciado_id,
      id: c.id,
      imob: cred?.imob ?? null,
      mesa: c.mesa_id ? numeroPorMesa.get(c.mesa_id) ?? null : null,
      nome: cred?.nome ?? "",
    };
  };

  const atual = chamadas[0] ? cardChamada(chamadas[0]) : null;
  const jaChamados = chamadas.slice(1, 5).map(cardChamada);

  // O CARD DO ALVO DO BROADCAST, buscado DIRETO. A rechamada reaproveita a linha original (sem
  // mudar `chamado_em`), então minutos depois ela está fora das 12 recentes — o telão não a
  // achava em [atual]+jaChamados e ficava MUDO: o atendente via "Chamado!", o cliente não ouvia
  // o nome. Quase toda rechamada da secretaria caía nisso. Agora a TV pergunta pelo alvo.
  const alvoId = (params.get("alvo") ?? "").trim();
  let alvo: ReturnType<typeof cardChamada> | null = null;
  if (alvoId) {
    const jaNaJanela = chamadas.find((c) => c.credenciado_id === alvoId);
    if (jaNaJanela) {
      alvo = cardChamada(jaNaJanela);
    } else {
      const { data: chamadaAlvo } = await client
        .from("prometeu_chamadas")
        .select("id, credenciado_id, mesa_id, chamado_em")
        .eq("evento_id", eventoId)
        .eq("zona", canal)
        .eq("credenciado_id", alvoId)
        .is("atendido_em", null)
        .order("chamado_em", { ascending: false })
        .limit(1)
        .maybeSingle<(typeof chamadas)[number]>();
      if (chamadaAlvo) {
        if (chamadaAlvo.mesa_id && !numeroPorMesa.has(chamadaAlvo.mesa_id)) {
          const { data: m } = await client
            .from("prometeu_mesas")
            .select("id, numero")
            .eq("id", chamadaAlvo.mesa_id)
            .maybeSingle<{ id: string; numero: number | string }>();
          if (m) numeroPorMesa.set(m.id, String(m.numero));
        }
        if (!infoChamado.has(chamadaAlvo.credenciado_id)) {
          const { data: e } = await client
            .from("prometeu_credenciados")
            .select("id, nome, imobiliaria, corretor")
            .eq("id", chamadaAlvo.credenciado_id)
            .maybeSingle<{
              corretor: string | null;
              id: string;
              imobiliaria: string | null;
              nome: string;
            }>();
          if (e) {
            infoChamado.set(e.id, {
              corretor: e.corretor ?? null,
              imob: e.imobiliaria ?? null,
              nome: e.nome,
            });
          }
        }
        alvo = cardChamada(chamadaAlvo);
      }
    }
  }

  // "PRÓXIMOS" COM A MESMA REGRA DA FILA REAL: sem quem está a caminho (chamada aberta) e sem
  // quem está sentado numa mesa. A TV pública mostrava como "próximo" quem a mesa acabou de
  // chamar — o cliente se via na lista de espera e continuava sentado enquanto a mesa o
  // aguardava — e quem estava em pleno atendimento (etapa segue `secretaria` até finalizar).
  const { data: chamadasAbertas } = await client
    .from("prometeu_chamadas")
    .select("credenciado_id")
    .eq("evento_id", eventoId)
    .is("atendido_em", null);
  const idsEmTransito = new Set(
    ((chamadasAbertas ?? []) as Array<{ credenciado_id: string }>).map(
      (c) => c.credenciado_id,
    ),
  );
  const { data: mesasOcupadas } = await client
    .from("prometeu_mesas")
    .select("credenciado_id")
    .eq("evento_id", eventoId)
    .neq("estado", "livre")
    .not("credenciado_id", "is", null);
  const idsSentados = new Set(
    ((mesasOcupadas ?? []) as Array<{ credenciado_id: string | null }>).map(
      (m) => m.credenciado_id,
    ),
  );

  const fila =
    canal === "salao" ? filaDoSalao(credenciados) : filaDaSecretaria(credenciados);
  const proximos = fila
    .filter((c) => !idsEmTransito.has(c.id) && !idsSentados.has(c.id))
    .slice(0, 4)
    .map((c) => ({
      corretor: canal === "salao" ? c.corretor ?? null : null,
      imob: c.imobiliaria ?? null,
      nome: c.nome,
    }));

  const cfg = getServerSupabaseConfig();

  return NextResponse.json(
    {
      data: {
        // O card do credenciado pedido em ?alvo= (rechamada fora da janela das 12 recentes).
        alvo,
        atual,
        eventoId,
        jaChamados,
        // O estado do MAESTRO (fundo sincronizado): telão que liga/recarrega entra no mesmo
        // vídeo/volume que os outros, sem depender de ter ouvido o broadcast.
        palco:
          (evento.config as { palco?: Record<string, unknown> } | null)?.palco ?? null,
        lancamento: nomeDoLancamento(evento),
        proximos,
        // Config pública pra TV subscrever o Realtime (a publishable key já vive no bundle).
        realtime: {
          evento: "chamado",
          key: cfg.anonKey ?? "",
          topico: topicoDaFila(eventoId),
          url: cfg.url ?? "",
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
