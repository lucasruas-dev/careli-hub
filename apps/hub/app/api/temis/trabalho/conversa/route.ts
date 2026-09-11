import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import {
  autorizarEmissaoDeContrato,
  autorizarLeituraDeContrato,
} from "@/lib/temis/autorizacao";

// A CONVERSA DA VENDA, VISTA PELA TÊMIS.
//
// Lucas (09/09/2026): *"chat - documento - historico ficam em todas as etapas"* — a coluna fixa da
// tela de trabalho.
//
// ⚠️ ROTA GÊMEA, E NÃO A MESMA. A do portal (`/api/incorporador/venda/conversa`) autoriza pelo
// cookie `apolo_inc` e recorta pelo escopo do coordenador; ela IGNORA o Bearer do hub, então a
// tela da Têmis levaria 401 seco. E o inverso é pior: se o operador tivesse o cookie por acaso, a
// chamada passaria com o escopo do INCORPORADOR — leitura errada com cara de certa.
//
// ⚠️ E O RECORTE É `proposta_id`, NÃO `unidade_id`. A rota do portal filtra pelo LOTE, e um lote
// passa por várias negociações (o 01 04 do Portal dos Vales teve proposta de sete clientes em
// quatro dias): num card da Têmis, que é de UMA venda, isso traria a conversa do comprador
// anterior misturada à do atual. `hercules_conversas` tem `proposta_id`, que é justamente a chave
// do card — o recorte certo estava lá o tempo todo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";

export async function GET(request: Request) {
  const auth = await autorizarLeituraDeContrato(request);
  if (!auth.ok) return auth.response;

  const propostaId = (new URL(request.url).searchParams.get("proposta") ?? "").trim();
  if (!propostaId) {
    return NextResponse.json({ error: "Proposta não informada." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  try {
    // As mais recentes primeiro no banco, invertidas depois: ler `ascending` com `limit` traria as
    // 500 MAIS ANTIGAS, e a conversa congelaria no passado sem erro nenhum.
    const { data, error } = await admin
      .from("hercules_conversas")
      .select("id, protocolo_numero, tipo, texto, autor_nome, criado_em")
      .eq("workspace_id", WORKSPACE)
      .eq("proposta_id", propostaId)
      .order("criado_em", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const mensagens = ((data ?? []) as Array<{ protocolo_numero: null | number }>)
      .map((m) => ({ ...m, codigo: codigoDaVenda(m.protocolo_numero) || null }))
      .reverse();

    return NextResponse.json(
      { data: { mensagens } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    console.error("[temis][conversa] falha ao listar", erro);
    return NextResponse.json(
      { error: "Não foi possível carregar a conversa." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  // Escrever na conversa é ato de quem trabalha o contrato, não de quem consulta.
  const auth = await autorizarEmissaoDeContrato(request);
  if (!auth.ok) return auth.response;

  const corpo = (await request.json().catch(() => ({}))) as {
    proposta?: string;
    texto?: string;
  };

  const propostaId = String(corpo.proposta ?? "").trim();
  const texto = String(corpo.texto ?? "").trim();

  if (!propostaId) {
    return NextResponse.json({ error: "Proposta não informada." }, { status: 400 });
  }
  if (!texto) {
    return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  // ⚠️ A MENSAGEM PRECISA DA UNIDADE E DO PROTOCOLO. `hercules_conversas` guarda os três (unidade,
  // protocolo e proposta), e a tela do Hércules lê pelo LOTE: gravar só `proposta_id` faria a nota
  // escrita aqui sumir de lá. Os dois lados falam da mesma venda, e o registro tem de servir aos
  // dois.
  const { data: proposta } = await admin
    .from("hercules_propostas")
    .select("empreendimento_codigo, protocolo_numero, unidade_id")
    .eq("id", propostaId)
    .maybeSingle<{
      empreendimento_codigo: null | string;
      protocolo_numero: null | number;
      unidade_id: null | string;
    }>();

  if (!proposta) {
    return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });
  }

  // ⚠️ O NOME VEM DE `hub_users`, e não da sessão. `ApoloAuthResult` devolve só `{ ok, userId }` —
  // a sessão do PORTAL é que carrega `usuarioNome`, e ela não existe aqui. Mesmo padrão de
  // `nomeDoUsuario` em `/api/temis/contrato/gerar`.
  // ⚠️ `try/catch`, e não `.catch()`: o builder do Supabase é `PromiseLike` e não tem `.catch`.
  let autor: null | string = null;
  try {
    const r = await admin
      .from("hub_users")
      .select("display_name")
      .eq("id", auth.userId)
      .maybeSingle<{ display_name: null | string }>();
    autor = r.data?.display_name ?? null;
  } catch {
    // Nome acessório: a nota é gravada mesmo sem ele.
  }

  try {
    const { error } = await admin.from("hercules_conversas").insert({
      autor: auth.userId,
      autor_nome: autor,
      empreendimento_codigo: proposta.empreendimento_codigo,
      proposta_id: propostaId,
      protocolo_numero: proposta.protocolo_numero,
      texto,
      tipo: "nota",
      unidade_id: proposta.unidade_id,
      workspace_id: WORKSPACE,
    });

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    console.error("[temis][conversa] falha ao gravar", erro);
    return NextResponse.json(
      { error: "Não foi possível enviar a mensagem." },
      { status: 503 },
    );
  }
}
