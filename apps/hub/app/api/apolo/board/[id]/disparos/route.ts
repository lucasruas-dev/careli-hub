import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  avisoDoEstado,
  descreverDisparo,
  descricaoDoAviso,
  ehPrimeiroAviso,
  type LinhaDeDisparo,
  formatarTelefone,
} from "@/lib/apolo/credenciamento-disparos";
import { contatoDaEntidadeImobiliaria } from "@/lib/apolo/disparo-imobiliaria";
import {
  avisarCredenciamentoAprovado,
  avisarCredenciamentoCorrecao,
  avisarCredenciamentoIndeferido,
  representanteDaImobiliaria,
  telefoneDaImobiliaria,
} from "@/lib/apolo/disparo-credenciamento";
import { createApoloAdminClient } from "@/lib/apolo/server";

// STATUS DOS DISPAROS de uma ficha do Board, e o REENVIO da mensagem.
//
// Pedido do Lucas (17/08/2026): *"seria ótimo trazer os status do envio das mensagens, se foi
// enviado, hora, se recebeu, quem recebeu, para a gente não ficar no escuro"*. Até aqui o
// operador habilitava a imobiliária e não tinha como saber se o WhatsApp saiu: os avisos de
// credenciamento falham com frequência (número que não é WhatsApp, ficha sem telefone), e a
// única prova ficava no banco.
//
// ⚠️ "RECEBEU" NÃO EXISTE PARA ESTE CANAL. `delivered_at`/`read_at` só são preenchidos pelo
// webhook da Meta, casando por `wa_message_id`; os avisos de credenciamento saem pelo Evolution
// (número do Relacionamento), que não devolve recibo. Medido em 17/08: os 24 disparos
// `relacionamento:whatsapp` estão com os três campos nulos. A tela diz isso com todas as letras
// em vez de mostrar um "entregue" que ninguém confirmou.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const PERFIL = "imobiliaria";
const ehUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const CAMPOS =
  "id, tipo, origem, destinatario, telefone, status, erro, created_at, delivered_at, read_at, wa_message_id";

// O estado da imobiliária vive em DUAS colunas (ver credenciamento-etapa.ts): o papel diz
// habilitada/em validação/recusada, a entidade diz se está esperando correção.
async function lerEstado(
  client: ReturnType<typeof createApoloAdminClient>,
  id: string,
): Promise<{ entidadeStatus: null | string; papelStatus: null | string }> {
  if (!client) return { entidadeStatus: null, papelStatus: null };

  const [papel, entidade] = await Promise.all([
    client
      .from("apolo_entity_profiles")
      .select("status")
      .eq("entity_id", id)
      .eq("profile", PERFIL)
      .maybeSingle<{ status: null | string }>(),
    client
      .from("apolo_entities")
      .select("status")
      .eq("id", id)
      .maybeSingle<{ status: null | string }>(),
  ]);

  return {
    entidadeStatus: entidade.data?.status ?? null,
    papelStatus: papel.data?.status ?? null,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  if (!ehUuid(id)) {
    return NextResponse.json({ error: "Ficha invalida." }, { status: 400 });
  }

  // ⚠️ O `error` do PostgREST é CHECADO. Sem isto, uma consulta recusada devolveria lista vazia e
  // a tela afirmaria "nenhuma mensagem enviada" para uma ficha que recebeu cinco.
  const { data, error } = await adminClient
    .from("apolo_disparos")
    .select(CAMPOS)
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: "Falha ao ler os disparos." }, { status: 500 });
  }

  const linhas = (data ?? []) as LinhaDeDisparo[];
  const estado = await lerEstado(adminClient, id);
  const aviso = avisoDoEstado(estado);

  // PARA QUEM O REENVIO VAI. Mesma régua do disparo automático (representante legal primeiro, o
  // contato da empresa como plano B), para a tela não prometer um destino e o envio usar outro.
  let destino: { contato: null | string; nome: null | string } = { contato: null, nome: null };
  if (estado.papelStatus) {
    const [contato, representante] = await Promise.all([
      contatoDaEntidadeImobiliaria(adminClient, id),
      representanteDaImobiliaria(adminClient, id),
    ]);
    destino = {
      contato: formatarTelefone(
        telefoneDaImobiliaria([representante.telefone, contato.telefone]),
      ),
      nome: representante.nome ?? contato.nome,
    };
  }

  const motivo = !estado.papelStatus
    ? "O reenvio do aviso de credenciamento é só para imobiliária."
    : !aviso
      ? "Esta imobiliária ainda não foi decidida: não há aviso para reenviar."
      : !destino.contato
        ? "A ficha não tem telefone: cadastre o celular do representante antes de reenviar."
        : null;

  return NextResponse.json({
    data: {
      disparos: linhas.map(descreverDisparo),
      reenvio: {
        aviso,
        descricao: aviso ? descricaoDoAviso(aviso) : null,
        destino,
        motivo,
        pode: motivo === null,
      },
    },
  });
}

// REENVIAR o aviso da situação ATUAL da imobiliária.
//
// ⚠️ SÓ PARA A IMOBILIÁRIA, nunca para o coordenador. O coordenador precisa saber que entrou
// parceiro novo na praça dele uma vez; reenviar para ele a cada tentativa transformaria o
// WhatsApp do time em varal de repetição. Foi clique repetido redisparando os dois lados que
// motivou a trava do botão de habilitar.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  if (!ehUuid(id)) {
    return NextResponse.json({ error: "Ficha invalida." }, { status: 400 });
  }

  const estado = await lerEstado(adminClient, id);
  if (!estado.papelStatus) {
    return NextResponse.json(
      { error: "Esta ficha nao tem cadastro de imobiliaria." },
      { status: 409 },
    );
  }

  const aviso = avisoDoEstado(estado);
  if (!aviso) {
    return NextResponse.json(
      { error: "Esta imobiliaria ainda nao foi decidida: nao ha aviso para reenviar." },
      { status: 409 },
    );
  }

  const [contato, representante] = await Promise.all([
    contatoDaEntidadeImobiliaria(adminClient, id),
    representanteDaImobiliaria(adminClient, id),
  ]);
  // ⚠️ `telefoneDaImobiliaria` E NÃO `??`: as fontes devolvem string VAZIA quando não acham, e
  // `"" ?? x` continua "". É a regra que já existe; duplicá-la aqui é que seria o defeito.
  const telefone = telefoneDaImobiliaria([representante.telefone, contato.telefone]);
  if (!telefone) {
    return NextResponse.json(
      { error: "A ficha nao tem telefone: cadastre o celular do representante antes de reenviar." },
      { status: 409 },
    );
  }

  const ORIGEM = "reenvio:whatsapp";

  if (aviso === "aprovado") {
    // Os empreendimentos que ela DE FATO trabalha hoje: é a lista que a mensagem promete.
    const { data: vinculos, error: vinculosError } = await adminClient
      .from("apolo_relationships")
      .select("label")
      .eq("entity_id", id)
      .eq("relationship_type", "empreendimento")
      .eq("status", "verified")
      .limit(500);

    if (vinculosError) {
      return NextResponse.json({ error: "Falha ao ler os empreendimentos." }, { status: 500 });
    }

    const empreendimentos = ((vinculos ?? []) as Array<{ label: null | string }>).map((linha) => ({
      label: linha.label ?? "Empreendimento",
    }));

    if (empreendimentos.length === 0) {
      return NextResponse.json(
        { error: "Nenhum empreendimento liberado: nao ha o que avisar." },
        { status: 409 },
      );
    }

    // "Cadastro aprovado" ou "mais um empreendimento"? Sai do histórico, não de chute.
    const { data: anteriores } = await adminClient
      .from("apolo_disparos")
      .select("tipo, status")
      .eq("entity_id", id)
      .eq("tipo", "credenciamento_aprovado")
      .limit(50);

    const envio = await avisarCredenciamentoAprovado(adminClient, {
      // SEM coordenadores de propósito: reenvio é para a imobiliária.
      corretores: 0,
      empreendimentos,
      entityId: id,
      imobiliaria: contato.nome,
      imobiliariaTelefone: telefone,
      origem: ORIGEM,
      primeiraVez: ehPrimeiroAviso(
        (anteriores ?? []) as Array<{ status: null | string; tipo: null | string }>,
      ),
      representante: representante.nome,
    });

    return await responder(adminClient, {
      aviso,
      entityId: id,
      erro: envio.imobiliaria.erro,
      ok: envio.imobiliaria.ok,
      telefone,
      userId: auth.userId,
    });
  }

  // CORREÇÃO e RECUSA carregam MOTIVO, e o motivo é o conteúdo da mensagem. Ele foi gravado na
  // auditoria no momento da decisão (`apolo_audit_events.metadata.motivos`); sem ele o reenvio
  // mandaria uma recusa sem dizer o que houve, que é exatamente a queixa que criou a ação de
  // correção (a FN Consultoria refez o cadastro duas vezes por não receber o motivo).
  const acao = aviso === "correcao" ? "credenciamento_correcao" : "credenciamento_indeferido";
  const { data: eventos } = await adminClient
    .from("apolo_audit_events")
    .select("metadata")
    .eq("entity_id", id)
    .eq("action", acao)
    .order("created_at", { ascending: false })
    .limit(1);

  const metadata = ((eventos ?? [])[0] as { metadata?: Record<string, unknown> } | undefined)
    ?.metadata;
  const motivos = Array.isArray(metadata?.motivos)
    ? (metadata.motivos as unknown[]).filter((m): m is string => typeof m === "string" && m.trim() !== "")
    : [];
  const observacao = typeof metadata?.observacao === "string" ? metadata.observacao.trim() : "";

  if (motivos.length === 0 && !observacao) {
    return NextResponse.json(
      {
        error:
          "Nao encontrei o motivo registrado desta decisao. Use a acao de novo, informando o motivo.",
      },
      { status: 409 },
    );
  }

  const envio =
    aviso === "correcao"
      ? await avisarCredenciamentoCorrecao(adminClient, {
          entityId: id,
          imobiliaria: contato.nome,
          imobiliariaTelefone: telefone,
          motivos,
          observacao: observacao || null,
          origem: ORIGEM,
          representante: representante.nome,
        })
      : await avisarCredenciamentoIndeferido(adminClient, {
          empreendimentos: [],
          entityId: id,
          imobiliaria: contato.nome,
          imobiliariaTelefone: telefone,
          motivos: observacao ? [...motivos, observacao] : motivos,
          origem: ORIGEM,
          representante: representante.nome,
        });

  return await responder(adminClient, {
    aviso,
    entityId: id,
    erro: envio.imobiliaria.erro,
    ok: envio.imobiliaria.ok,
    telefone,
    userId: auth.userId,
  });
}

// Registra na auditoria e devolve a mesma resposta para os três avisos.
async function responder(
  client: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  input: {
    aviso: string;
    entityId: string;
    erro?: string;
    ok: boolean;
    telefone: string;
    userId: string;
  },
) {
  await client.from("apolo_audit_events").insert({
    action: "credenciamento_reenvio",
    actor_user_id: ehUuid(input.userId) ? input.userId : null,
    entity_id: input.entityId,
    field_name: "credenciamento",
    metadata: {
      aviso: input.aviso,
      erro: input.ok ? null : (input.erro ?? null),
      origem: "board",
      telefone: formatarTelefone(input.telefone),
    },
    status: "mapped",
  });

  return NextResponse.json({
    data: {
      erro: input.ok ? null : (input.erro ?? "Falha no envio."),
      ok: input.ok,
      para: formatarTelefone(input.telefone),
      resumo: input.ok ? "Mensagem reenviada." : "Nao consegui reenviar.",
    },
  });
}
