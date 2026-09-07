import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";

// OS EMPREENDIMENTOS DA TÊMIS — só os que estão recebendo CAD.
//
// Lucas (07/09/2026): *"na temis, pode deixar somente os empreendimentos que estamos recebendo
// cads"*. Antes disso ele tinha apontado o que faltava: *"o empreendimento teste não aparece para
// gente fazer minuta"* e *"o empreendimento que eu estou falando é o que estamos testando no
// hércules, zz"*.
//
// ⚠️ O ZZ NUNCA ESTEVE FILTRADO — ele não existe no C2X. O "ZZ TESTE" (código TST,
// `enterprise_id` 9001) nasceu em `hercules_empreendimentos` em 04/09/2026, quando o Lucas decidiu
// *"a partir de hoje vamos cadastrar os empreendimentos dentro do panteon"*. A tela lia
// `/api/apolo/empreendimentos`, que consulta o C2X, e lá o TST não tem linha. Cheguei a liberar o
// empreendimento de teste ERRADO (o TSC, do C2X) antes de ele me corrigir.
//
// A FONTE É O PORTÃO, NÃO O CATÁLOGO: `apolo_enterprise_settings.recepcao_cad`. Ele já é a decisão
// de "este produto está recebendo cadastro", tomada na tela do empreendimento, e é a mesma que
// governa a recepção no Apolo — usar qualquer outro critério aqui criaria uma segunda definição de
// "ativo" para a mesma pergunta.
//
// ⚠️ E ELE JÁ FALA A LÍNGUA DOS VÍNCULOS. O `enterprise_id` desta tabela é exatamente a chave com
// que minuta, plano e categoria se amarram ao empreendimento — inclusive o `group:Lagoa Bonita`, que
// é rótulo e não id de tabela nenhuma ([[reference_lagoa_bonita_pai_e_filhos]]). Montar a lista a
// partir do cadastro do Panteon traria LBF, LBP e LBR separados, e as minutas vinculadas ao
// consolidado deixariam de ser encontradas — em silêncio.
//
// Medido em 07/09/2026: 12 empreendimentos com o portão aberto, entre eles o TST e o Lagoa Bonita.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";

type Linha = { code: string; enterprise_id: null | string };

export async function GET(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  const { data, error } = await admin
    .from("apolo_enterprise_settings")
    .select("enterprise_id,code")
    .eq("workspace_id", WORKSPACE)
    .eq("recepcao_cad", true)
    .returns<Linha[]>();

  if (error) {
    console.error("[temis][empreendimentos] falha ao ler os portões", error.message);
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos." },
      { status: 503 },
    );
  }

  // O NOME BONITO vem do cadastro do Panteon, casando pelo CÓDIGO. O portão guarda o código
  // (inclusive "LBF + LBR + LBP" no consolidado), e código sozinho não é o que se lê numa lista.
  const nomePorCodigo = new Map<string, string>();
  try {
    for (const e of await carregarCadastroDeEmpreendimentos()) {
      if (e.codigo && e.nome) nomePorCodigo.set(e.codigo.toUpperCase(), e.nome);
    }
  } catch (erro) {
    // Best-effort: sem o cadastro, a lista sai com o código no lugar do nome — feia, mas viva.
    console.error("[temis][empreendimentos] cadastro do Panteon indisponível", erro);
  }

  const rows = (data ?? [])
    .filter((l): l is Linha & { enterprise_id: string } => Boolean(l.enterprise_id))
    .map((l) => {
      const codigo = (l.code ?? "").trim();
      // O consolidado guarda "LBF + LBR + LBP" no código: o nome dele está no id (`group:Nome`).
      const doGrupo = l.enterprise_id.startsWith("group:")
        ? l.enterprise_id.slice("group:".length)
        : null;
      return {
        code: codigo,
        id: l.enterprise_id,
        name: doGrupo ?? nomePorCodigo.get(codigo.toUpperCase()) ?? (codigo || l.enterprise_id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return NextResponse.json({ data: { rows } }, { headers: { "Cache-Control": "no-store" } });
}
