import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloCoordenacao } from "@/lib/apolo/auth";
import { habilitarAutonomoNoEmpreendimento } from "@/lib/apolo/autonomo-cadastro";
import { createApoloAdminClient } from "@/lib/apolo/server";

// HABILITA O CORRETOR AUTÔNOMO NUM EMPREENDIMENTO — a decisão da coordenação, um produto por vez.
//
// Lucas (27/09/2026), perguntado se o autônomo vende em tudo ou só onde a coordenação liberar:
// *"Sim, empreendimento a empreendimento"*, igual à imobiliária.
//
// ⚠️ O AVISO AO COORDENADOR E A AUDITORIA SAEM DAQUI, e é por isso que esta rota existe em vez de
// reusar `/api/apolo/relationships/create`. Aquele ramo grava o vínculo para qualquer entidade, mas
// `habilitacaoPeloVinculo` exige papel `imobiliaria` ativo para avisar: o autônomo seria habilitado em
// SILÊNCIO, que é exatamente o que a decisão do Lucas de 24/09/2026 ("3 - Isso ae") proibiu depois de a
// LUNA não saber de três imobiliárias habilitadas no 43 dela.
//
// ⚠️ `authorizeApoloCoordenacao`: admin e líder (segunda rodada de revisão, 01/10/2026). Com o botão na
// tela Autônomos, o operador, inclusive o externo, habilitaria autônomo em empreendimento; antes a rota
// não tinha botão e ninguém dependia do recorte mais aberto. `viewer` e `operator` não habilitam.
//
// ⚠️ O QUE ESTA ROTA NÃO FAZ: desabilitar. Tirar a habilitação é arquivar o vínculo, pelo caminho que
// já existe (`/api/apolo/relationships/archive`), e a leitura da habilitação só aceita `verified`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Corpo = { enterpriseId?: unknown; label?: unknown };

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloCoordenacao(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Escrita no Apolo indisponível." }, { status: 503 });
  }

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const resultado = await habilitarAutonomoNoEmpreendimento(client, {
    autorNome: auth.nome,
    autorUserId: auth.userId,
    enterpriseId: typeof corpo.enterpriseId === "string" ? corpo.enterpriseId : "",
    entityId: id,
    label: typeof corpo.label === "string" ? corpo.label : "",
  });

  if (!resultado.ok) {
    // `falha` é indisponibilidade (a leitura ou a gravação caiu), não pedido errado: 503, e a frase
    // já diz que nada foi gravado. As outras são o corpo que não serve: 400.
    return NextResponse.json(
      { error: resultado.mensagem },
      { status: resultado.motivo === "falha" ? 503 : 400 },
    );
  }

  return NextResponse.json({
    data: {
      codigo: resultado.autonomo.codigo,
      coordenadores: resultado.coordenadores,
      jaHabilitado: resultado.jaHabilitado,
      nome: resultado.autonomo.nome,
    },
    ok: true,
  });
}
