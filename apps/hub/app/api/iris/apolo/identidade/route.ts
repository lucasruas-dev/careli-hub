import { NextResponse, type NextRequest } from "next/server";

import { identidadeDoContato } from "@/lib/iris/apolo/identidade-contato";
import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

// "Quem é este contato no Apolo?" — a pergunta que o cockpit faz ao abrir um atendimento.
//
// Responde um ESTADO (entidade | vinculo | nenhum | indisponivel), nunca um booleano. A diferença
// importa na tela: "não tem cadastro" convida a cadastrar, "não consegui verificar" convida a
// tentar de novo, e hoje as duas viram o mesmo traço no painel — o que faz o operador duplicar
// ficha de gente que já existe.
//
// Mesmo perfil de acesso do phone-match: quem atende na Iris pode consultar.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
    "viewer",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const telefone = new URL(request.url).searchParams.get("telefone");

  if (!telefone?.trim()) {
    return NextResponse.json({ error: "Informe o telefone do contato." }, { status: 400 });
  }

  const identidade = await identidadeDoContato(authorization.client, telefone);

  // LOG DE ACESSO A DADO PESSOAL. Esta rota devolve o documento COMPLETO — `document_masked`
  // guarda o CPF por extenso, apesar do nome (lib/apolo/cadastro-persist.ts, formatDocument). A
  // escrita no Apolo já deixa rastro em `apolo_audit_events`; a leitura não deixava nenhum. Se o
  // CPF integral aparece na tela do operador, o mínimo é saber quem olhou qual ficha e quando.
  // Sem o corpo da resposta: registrar as linhas seria copiar o CPF para o log.
  if (identidade.estado === "entidade") {
    console.log(
      "[iris][apolo][identidade][acesso]",
      JSON.stringify({
        em: new Date().toISOString(),
        entidadeId: identidade.entidadeId,
        operador: authorization.user?.id ?? "desconhecido",
        via: identidade.via,
      }),
    );
  }

  return NextResponse.json(
    { data: identidade },
    {
      headers: {
        // Dado de pessoa não fica em CDN. O cockpit já não repete a chamada sem trocar de ticket.
        "Cache-Control": "no-store, private",
      },
    },
  );
}
