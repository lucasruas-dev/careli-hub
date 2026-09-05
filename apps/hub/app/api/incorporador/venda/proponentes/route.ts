import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { autorizarComercial } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { comIdsDoGrupo } from "@/lib/apolo/incorporador/resumo-do-produto";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  type CandidatoDaBase,
  casa,
  MAXIMO_DE_CANDIDATOS,
  ordenar,
  type ProponenteEncontrado,
  termoDaBusca,
} from "@/lib/hercules/busca-de-proponente";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { decidirPelasLinhas, type LinhaDaEsteira } from "@/lib/hercules/cliente-credenciado";
import { familiaDoEmpreendimento } from "@/lib/hercules/quem-pode-vender";

// A BUSCA DE PROPONENTE — quem pode entrar na proposta junto com o titular.
//
// Lucas (05/09/2026), digitando o nome de um proponente na modal: *"os demais proponentes têm que
// ser buscados; eu digitei o nome da Larissa, deveria puxar a CAD dela caso a mesma tenha uma CAD
// credenciada (nome, CPF); se não estiver credenciada, fala que CAD não encontrada"*.
//
// ⚠️ DIGITAR CRIAVA UMA PESSOA QUE NÃO EXISTE. O campo antigo aceitava qualquer nome com qualquer
// CPF válido — bastava o dígito verificador fechar. Quem escrevesse "Larissa Fontes" com um CPF
// certo criava um comprador que o Apolo nunca viu: sem CAD, sem crédito analisado, sem entidade — e
// ele entrava no PDF, na minuta e no contrato como se fosse cadastrado. A régua do titular era dura
// (CAD credenciada no empreendimento) e a do segundo comprador não existia, no MESMO papel.
//
// ⚠️ A DECISÃO É A MESMA DO TITULAR, e literalmente a mesma função: `decidirPelasLinhas`, extraída
// de `credenciadoParaVender` justamente para isto. Uma segunda régua "parecida" aqui liberaria, no
// mesmo empreendimento e no mesmo dia, quem a primeira barra.
//
// ⚠️ A BUSCA É DENTRO DO ESCOPO, e isso é privacidade, não preguiça. Procurar na base inteira do
// Apolo devolveria nome e CPF de qualquer pessoa da casa para qualquer corretor com acesso ao
// portal. Aqui só aparece quem tem CAD NESTE empreendimento (ou na família dele) — o mesmo recorte
// que a tela Venda já lê para contar o funil.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";

/** Teto da leitura da esteira. A família de um empreendimento tem centenas, não milhares. */
const TETO_DA_ESTEIRA = 2000;

export async function GET(request: Request) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  const url = new URL(request.url);
  const unidadeId = (url.searchParams.get("unidade") ?? "").trim();
  const termo = termoDaBusca(url.searchParams.get("q") ?? "");

  if (!unidadeId) {
    return NextResponse.json({ error: "Informe a unidade." }, { status: 400 });
  }

  // ⚠️ TERMO CURTO NÃO É ERRO, É "AINDA NÃO". A tela busca a cada tecla; responder 400 faria a
  // caixa piscar vermelho enquanto a pessoa digita as duas primeiras letras.
  if (termo.tipo === "curto") {
    return NextResponse.json({ data: { encontrados: [], termoCurto: true } });
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

    // O MESMO escopo expandido do portão do titular: família (pai e filhos) mais o `group:` que as
    // divisões cobrem. Sem a expansão, uma CAD gravada no grupo some da busca.
    const [cadastro, catalogo] = await Promise.all([
      carregarCadastroDeEmpreendimentos(),
      catalogoDeEmpreendimentos(Date.now()),
    ]);
    const familia = familiaDoEmpreendimento(cadastro, String(unidade.enterprise_id));
    const escopo = comIdsDoGrupo(familia, catalogo, permitidos);

    if (escopo.length === 0) {
      return NextResponse.json({ data: { encontrados: [] } });
    }

    const { data: esteira, error: erroDaEsteira } = await admin
      .from("apolo_esteira")
      .select("atualizado_em, chegou_em, created_at, enterprise_id, entity_id, etapa")
      .in("enterprise_id", escopo)
      .limit(TETO_DA_ESTEIRA);

    if (erroDaEsteira) throw new Error(erroDaEsteira.message);

    const linhas = (esteira ?? []) as LinhaDaEsteira[];
    const entityIds = [...new Set(linhas.map((l) => l.entity_id))];
    if (entityIds.length === 0) {
      return NextResponse.json({ data: { encontrados: [] } });
    }

    // ⚠️ O FILTRO POR NOME/CPF ACONTECE AQUI, e não no `.in()`: são centenas de pessoas, e a régua
    // de casamento (sem acento, palavras em qualquer ordem, CPF por prefixo) é a mesma que o teste
    // guarda. Empurrá-la para o PostgREST significaria escrevê-la duas vezes, em duas linguagens.
    const { data: entidades, error: erroDasEntidades } = await admin
      .from("apolo_entities")
      .select("id, display_name, legal_name, trade_name, document_masked")
      .in("id", entityIds);

    if (erroDasEntidades) throw new Error(erroDasEntidades.message);

    const candidatos: CandidatoDaBase[] = ((entidades ?? []) as Array<{
      display_name: null | string;
      document_masked: null | string;
      id: string;
      legal_name: null | string;
      trade_name: null | string;
    }>).map((e) => ({
      documento: e.document_masked,
      id: e.id,
      nome: (e.display_name || e.legal_name || e.trade_name || "").trim() || null,
    }));

    const porEntidade = new Map<string, LinhaDaEsteira[]>();
    for (const l of linhas) {
      porEntidade.set(l.entity_id, [...(porEntidade.get(l.entity_id) ?? []), l]);
    }

    const encontrados: ProponenteEncontrado[] = candidatos
      .filter((c) => casa(c, termo))
      .map((c) => {
        const decisao = decidirPelasLinhas(porEntidade.get(c.id) ?? [], [c.id]);
        return {
          credenciado: decisao.credenciado,
          cpf: c.documento ?? "",
          etapa: decisao.etapa,
          id: c.id,
          motivo: decisao.motivo,
          nome: c.nome ?? "—",
        };
      })
      .sort(ordenar)
      .slice(0, MAXIMO_DE_CANDIDATOS);

    return NextResponse.json({ data: { encontrados } });
  } catch (erro) {
    console.error("[hercules][proponentes] falha ao buscar", erro);
    return NextResponse.json({ error: "Não foi possível buscar agora." }, { status: 503 });
  }
}
