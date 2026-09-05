import { NextResponse } from "next/server";

import { autorizarComercial } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";

// A PROPOSTA VIRA CONTRATO — o terceiro passo da venda.
//
// Lucas (05/09/2026): *"depois da proposta gerada, tenho dois caminhos, cancelar e enviar para
// contrato, pode habilitar"*.
//
// ⚠️ ESTE PASSO NÃO PRODUZ DOCUMENTO NENHUM, e é importante que fique claro: ele MARCA que a
// proposta foi aceita e entrou na fila do jurídico. A minuta é da Têmis, e ela ainda não está
// ligada aqui — prometer "contrato gerado" seria anunciar um papel que ninguém consegue abrir.
//
// ⚠️ E POR ISSO NÃO DISPARA WHATSAPP. A reserva, a proposta e os dois cancelamentos avisam os três
// porque cada um deles muda o que o cliente TEM na mão: um lote segurado, um preço com prazo, um
// papel que deixou de valer. "Entrou na fila do jurídico" não muda nada para ele hoje, e uma
// mensagem a mais por etapa interna transforma o WhatsApp da venda em ruído — o dia em que a minuta
// sair de verdade, ela é que merece o aviso. A tela mostra o resultado; o histórico do lote guarda
// quem mandou e quando.
//
// ⚠️ SÓ A PROPOSTA NATIVA E ABERTA. `origem = 'panteon'` mantém de fora as 4.857 importadas do
// C2X: mover para contrato aqui uma venda que corre no legado faria os dois sistemas discordarem
// sobre a mesma unidade, e o Panteon não tem como escrever a mudança de volta lá.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";

type PedidoDeContrato = {
  /** A proposta que a TELA está vendo — a mesma trava do cancelamento. */
  propostaId?: null | string;
  unidadeId: string;
};

export async function POST(request: Request) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: Partial<PedidoDeContrato>;
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const unidadeId = String(corpo.unidadeId ?? "").trim();
  const propostaId =
    typeof corpo.propostaId === "string" ? corpo.propostaId.trim() || null : null;

  if (!unidadeId) {
    return NextResponse.json({ error: "Escolha a unidade." }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const { data: linhaDaUnidade } = await admin
      .from("hercules_unidades")
      .select("id,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle();

    const unidade = linhaDaUnidade as null | { enterprise_id: string; id: string };
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    const { data: linha } = await admin
      .from("hercules_propostas")
      .select("id, codigo, protocolo_numero, cliente_nome")
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      .eq("origem", "panteon")
      .eq("etapa", "proposta")
      .maybeSingle();

    const proposta = linha as null | {
      cliente_nome: null | string;
      codigo: null | string;
      id: string;
      protocolo_numero: null | number;
    };

    if (!proposta) {
      return NextResponse.json({ error: "Não há proposta aberta nesta unidade." }, { status: 409 });
    }

    // A mesma trava do cancelamento: uma aba velha não move a proposta que nasceu depois.
    if (propostaId && propostaId !== proposta.id) {
      return NextResponse.json(
        { error: "Esta unidade já tem outra proposta. Recarregue a tela antes de seguir." },
        { status: 409 },
      );
    }

    const agora = new Date().toISOString();

    const { data: movida, error } = await admin
      .from("hercules_propostas")
      .update({
        atualizado_em: agora,
        etapa: "contrato",
        // ⚠️ O MAPA PINTA PELA PROPOSTA DE `etapa_desde` MAIS RECENTE: sem esta data o lote
        // continuaria pintado como proposta e o funil não andaria.
        etapa_desde: agora,
      })
      .eq("id", proposta.id)
      // Trava de clique duplo, como nas irmãs: sem ela, dois coordenadores movem a mesma proposta
      // duas vezes e a segunda resposta diz "feito" sobre um passo que já era.
      .eq("etapa", "proposta")
      .select("id");

    if (error) throw new Error(error.message);

    if (!movida || movida.length === 0) {
      return NextResponse.json(
        { error: "Esta proposta acabou de mudar de etapa em outra tela." },
        { status: 409 },
      );
    }

    // ⚠️ A UNIDADE NÃO MUDA. Ela já está ocupada desde a reserva, e continua: `hercules_unidades`
    // não distingue proposta de contrato — quem sabe em que passo a venda está é a proposta viva,
    // e é ela que a grade lê para pintar o lote.

    return NextResponse.json({
      data: {
        codigo: proposta.codigo || codigoDaVenda(proposta.protocolo_numero),
        id: proposta.id,
      },
    });
  } catch (erro) {
    console.error("[hercules][contrato] falha ao enviar para contrato", erro);
    return NextResponse.json({ error: "Não foi possível enviar para contrato agora." }, {
      status: 503,
    });
  }
}
