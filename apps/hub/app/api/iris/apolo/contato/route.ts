import { NextResponse, type NextRequest } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  atualizarContatoDoContato,
  corrigirIdentidadeDoContato,
  vincularContato,
} from "@/lib/iris/apolo/escrita-contato";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

// ESCRITA DO CADASTRO PELO COCKPIT DA IRIS.
//
// Uma rota com a AÇÃO no corpo, em vez de quatro rotas: a autorização, o log e o gate de papel
// ficam num lugar só. Quatro cópias do mesmo cabeçalho é como uma delas nasce sem o gate — e a
// que nascer errada vai ser justamente a que grava documento.
//
// ⚠️ QUEM PODE ESCREVER: admin, leader e operator. `viewer` fica de fora — ele acompanha
// atendimento, não corrige cadastro. O gate do Apolo (`authorizeApoloWrite`) lê a mesma tabela
// `hub_users`, então esta lista é a régua efetiva.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Corpo = {
  acao?: string;
  documento?: string;
  email?: string;
  entidadeId?: string;
  /** "trabalho" ou "contato" — as duas famílias de vínculo do CRM. */
  kind?: string;
  motivo?: string;
  nome?: string;
  relacionadaId?: string;
  telefone?: string;
  tipo?: string;
};

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Apolo não configurado." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as Corpo | null;
  const acao = corpo?.acao?.trim();
  const autorUserId = authorization.user?.id ?? null;

  if (!corpo || !acao) {
    return NextResponse.json({ error: "Informe a ação." }, { status: 400 });
  }

  const exigeEntidade = () => {
    const id = corpo.entidadeId?.trim();
    return id && id.length > 10 ? id : null;
  };

  try {
    // ⚠️ NÃO EXISTE ação "criar" — ficha nova é no Apolo (decisão do Lucas, 14/08). Se alguém
    // mandar `acao: "criar"` para esta rota, cai no "Ação desconhecida" lá embaixo, e é o certo.
    if (acao === "corrigir") {
      const entidadeId = exigeEntidade();
      if (!entidadeId) {
        return NextResponse.json({ error: "Ficha não informada." }, { status: 400 });
      }

      // O motivo é exigido pelo caminho auditado do Apolo, e é ele que dá sentido ao histórico:
      // "documento trocado" sem porquê não ajuda ninguém seis meses depois.
      const resultado = await corrigirIdentidadeDoContato(client, {
        autorUserId,
        documento: corpo.documento ?? "",
        entidadeId,
        motivo: corpo.motivo ?? "",
        nome: corpo.nome ?? "",
      });

      return resultado.ok
        ? NextResponse.json({ data: { entidadeId } })
        : NextResponse.json({ error: resultado.erro }, { status: 400 });
    }

    if (acao === "contato") {
      const entidadeId = exigeEntidade();
      if (!entidadeId) {
        return NextResponse.json({ error: "Ficha não informada." }, { status: 400 });
      }

      const resultado = await atualizarContatoDoContato(client, {
        email: corpo.email,
        entidadeId,
        telefone: corpo.telefone,
      });

      return resultado.ok
        ? NextResponse.json({ data: { entidadeId } })
        : NextResponse.json({ error: resultado.erro }, { status: 400 });
    }

    if (acao === "vincular") {
      const entidadeId = exigeEntidade();
      const relacionadaId = corpo.relacionadaId?.trim();

      if (!entidadeId || !relacionadaId) {
        return NextResponse.json(
          { error: "Informe as duas fichas do vínculo." },
          { status: 400 },
        );
      }

      const resultado = await vincularContato(client, {
        autorUserId,
        entidadeId,
        kind: corpo.kind ?? "",
        relacionadaId,
        tipo: corpo.tipo ?? "",
      });

      return resultado.ok
        ? NextResponse.json({ data: { entidadeId } })
        : NextResponse.json({ error: resultado.erro }, { status: 400 });
    }

    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    console.error("[iris][apolo][contato] falha", error);
    return NextResponse.json(
      { error: "Não foi possível gravar no Apolo agora." },
      { status: 500 },
    );
  }
}
