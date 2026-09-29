import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { atualizarIdentidade } from "@/lib/apolo/identidade-persist";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Correção de IDENTIDADE da ficha: nome, documento e tipo PF/PJ.
//
// Rota separada do PATCH da ficha de propósito. O PATCH grava campo a campo num jsonb e é
// reversível; isto troca quem a pessoa É — mexe em apolo_entities, nos identificadores e no
// índice de busca. Exige motivo e é auditado.
//
// ⚠️ NÃO RECUSA MAIS FICHA ESPELHO DO C2X (28/09/2026). A recusa dizia "o resync desfaria em até 6
// horas", e isso deixou de ser verdade em 04/08/2026: as 7 tabelas de identidade do sync vão com ON
// CONFLICT DO NOTHING (`lib/apolo/server.ts:3917-3949`), então quem já existe fica INTOCADO. Lucas,
// 28/09/2026: *"TUDO PRECISA MORAR DENTRO DO PANTEON, não tem mais cadastro vindo do c2x"*, *"TODOS
// eu poderia alterar, atualizar"*. Ver `lib/apolo/identidade-persist.ts` para a medição.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    documento?: string;
    motivo?: string;
    nome?: string;
    nomeFantasia?: string | null;
    tipo?: "pf" | "pj";
  };

  // ⚠️ O DOCUMENTO DEIXOU DE SER OBRIGATÓRIO NO CORPO (29/09/2026). A ficha PJ sem CNPJ no legado
  // tem `document_masked` nulo, e a tela manda `documento: docNovo ?? ficha.entidade.documento` —
  // ou seja, string vazia. Esta guarda respondia 400 "Nome, documento e tipo sao obrigatorios" e a
  // razão social dessas fichas nunca gravava, com o CNPJ sem input para o operador arrumar. Sem
  // documento no corpo, `atualizarIdentidade` mantém o que a ficha já tem e não mexe no documento.
  if (!body.nome || !body.tipo) {
    return NextResponse.json({ error: "Nome e tipo sao obrigatorios." }, { status: 400 });
  }
  if (body.tipo !== "pf" && body.tipo !== "pj") {
    return NextResponse.json({ error: "Tipo invalido." }, { status: 400 });
  }

  const resultado = await atualizarIdentidade({
    autorUserId: auth.userId,
    client,
    documento: body.documento,
    entityId: id,
    motivo: body.motivo ?? "",
    nome: body.nome,
    // ⚠️ `undefined` ATRAVESSA DE PROPÓSITO: a tela manda um DIFF, e `?? null` fazia a correção da
    // razão social APAGAR o nome fantasia da empresa. Só mexe em `trade_name` quando o campo vem.
    nomeFantasia: body.nomeFantasia,
    tipo: body.tipo,
  });

  if (!resultado.ok) {
    // 409 para colisão: é conflito de estado, não erro de entrada. (O 409 de "ficha espelho do C2X"
    // não existe mais desde 28/09/2026.)
    //
    // ⚠️ 500 PARA `parcial`: a ficha JÁ FOI GRAVADA e o que falhou veio depois (identificador ou
    // índice de busca). 400 dizia ao cliente "sua entrada é inválida, nada foi feito", e era com
    // base nisso que a tela escrevia "Nada foi salvo" em cima de um erro cujo texto diz
    // "Identidade gravada, mas...". O `motivo` vai no corpo para a tela ecoar a frase certa.
    const status =
      resultado.motivo === "colisao"
        ? 409
        : resultado.motivo === "nao_encontrada"
          ? 404
          : resultado.motivo === "parcial"
            ? 500
            : 400;
    return NextResponse.json({ error: resultado.erro, motivo: resultado.motivo }, { status });
  }

  return NextResponse.json({ data: { ok: true } });
}
