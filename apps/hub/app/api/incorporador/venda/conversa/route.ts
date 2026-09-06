import { NextResponse } from "next/server";

import { autorizarComercial } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import { type TipoDaMensagem, textoDaMensagem } from "@/lib/hercules/documentos-da-venda";

// A CONVERSA DE UMA VENDA — o registro interno do que foi combinado.
//
// Lucas (06/09/2026): *"terei que ter um chat para relatar, tirar dúvidas, informar de forma
// formalizada (...) o chat é onde vai ficar os registros de conversas, formalizações,
// observações"*.
//
// ⚠️ ISTO NÃO É A IRIS, e não deve virar. A Iris fala COM O CLIENTE, por WhatsApp e e-mail, com
// fila, dono e fechamento automático. Aqui é o registro INTERNO da venda: o que o coordenador
// combinou com o corretor, o que o jurídico respondeu, a observação que explica por que o desconto
// saiu daquele tamanho. Nada daqui sai para fora — e é justamente por isso que serve de prova.
//
// ⚠️ MENSAGEM NÃO SE EDITA NEM SE APAGA. Um registro que muda depois não registra nada. O que se
// corrige, corrige-se com mensagem nova — e a errada continua lá, com a hora em que foi escrita.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";
const TIPOS: TipoDaMensagem[] = ["formalizacao", "mensagem", "observacao"];

async function unidadeDoEscopo(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  sessao: Parameters<typeof idsDaSessao>[0],
  unidadeId: string,
) {
  const permitidos = new Set(await idsDaSessao(sessao));
  const { data } = await admin
    .from("hercules_unidades")
    .select("id,enterprise_id")
    .eq("workspace_id", WORKSPACE)
    .eq("id", unidadeId)
    .maybeSingle();

  const unidade = data as null | { enterprise_id: string; id: string };
  if (!unidade || !permitidos.has(String(unidade.enterprise_id))) return null;
  return unidade;
}

/** A venda viva do lote: é dela que a mensagem herda protocolo e empreendimento. */
async function vendaDoLote(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  unidadeId: string,
) {
  const { data: daProposta } = await admin
    .from("hercules_propostas")
    .select("id,protocolo_numero,empreendimento_codigo")
    .eq("workspace_id", WORKSPACE)
    .eq("unidade_id", unidadeId)
    .eq("origem", "panteon")
    .is("cancelada_em", null)
    .in("etapa", ["assinatura", "contrato", "faturado", "proposta"])
    .order("etapa_desde", { ascending: false })
    .limit(1)
    .maybeSingle();

  const proposta = daProposta as null | {
    empreendimento_codigo: null | string;
    id: string;
    protocolo_numero: null | number;
  };
  if (proposta) {
    return {
      empreendimentoCodigo: proposta.empreendimento_codigo,
      propostaId: proposta.id,
      protocolo: proposta.protocolo_numero,
    };
  }

  const { data: daReserva } = await admin
    .from("hercules_reservas")
    .select("protocolo_numero")
    .eq("workspace_id", WORKSPACE)
    .eq("unidade_id", unidadeId)
    .eq("situacao", "ativa")
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    empreendimentoCodigo: null,
    propostaId: null as null | string,
    protocolo: (daReserva as null | { protocolo_numero: null | number })?.protocolo_numero ?? null,
  };
}

export async function GET(request: Request) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  const unidadeId = (new URL(request.url).searchParams.get("unidade") ?? "").trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Unidade não informada." }, { status: 400 });
  }

  try {
    const unidade = await unidadeDoEscopo(admin, auth.sessao, unidadeId);
    if (!unidade) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    const { data, error } = await admin
      .from("hercules_conversas")
      .select("id,protocolo_numero,tipo,texto,autor_nome,criado_em")
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      // ⚠️ A CONVERSA LÊ-SE DE CIMA PARA BAIXO, ao contrário do histórico. Chat com a mensagem mais
      // nova no topo obriga a ler de trás para frente para entender o que foi combinado.
      .order("criado_em", { ascending: true })
      .limit(500);

    if (error) throw new Error(error.message);

    const mensagens = ((data ?? []) as Array<{ protocolo_numero: null | number }>).map((m) => ({
      ...m,
      codigo: codigoDaVenda(m.protocolo_numero) || null,
    }));

    return NextResponse.json(
      { data: { mensagens } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    console.error("[hercules][conversa] falha ao listar", erro);
    return NextResponse.json({ error: "Não foi possível carregar a conversa." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: { texto?: unknown; tipo?: unknown; unidadeId?: unknown };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const unidadeId = String(corpo.unidadeId ?? "").trim();
  const texto = textoDaMensagem(corpo.texto);
  // ⚠️ TIPO DESCONHECIDO VIRA `mensagem`, e não erro. Ele muda como a linha aparece, não o que ela
  // guarda: recusar o registro por causa do rótulo perderia o conteúdo, que é o que importa.
  const tipo = TIPOS.includes(corpo.tipo as TipoDaMensagem)
    ? (corpo.tipo as TipoDaMensagem)
    : "mensagem";

  if (!unidadeId) return NextResponse.json({ error: "Unidade não informada." }, { status: 400 });
  if (!texto) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 422 });

  try {
    const unidade = await unidadeDoEscopo(admin, auth.sessao, unidadeId);
    if (!unidade) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    const venda = await vendaDoLote(admin, unidade.id);

    const { data: criada, error } = await admin
      .from("hercules_conversas")
      .insert({
        autor: auth.sessao.usuarioId ?? null,
        autor_nome: auth.sessao.usuarioNome ?? null,
        empreendimento_codigo: venda.empreendimentoCodigo,
        proposta_id: venda.propostaId,
        protocolo_numero: venda.protocolo,
        texto,
        tipo,
        unidade_id: unidade.id,
        workspace_id: WORKSPACE,
      })
      .select("id,protocolo_numero,tipo,texto,autor_nome,criado_em")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!criada) {
      return NextResponse.json({ error: "Não foi possível registrar." }, { status: 503 });
    }

    const linha = criada as { protocolo_numero: null | number };
    return NextResponse.json({
      data: { mensagem: { ...linha, codigo: codigoDaVenda(linha.protocolo_numero) || null } },
    });
  } catch (erro) {
    console.error("[hercules][conversa] falha ao registrar", erro);
    return NextResponse.json({ error: "Não foi possível registrar a mensagem." }, { status: 503 });
  }
}
