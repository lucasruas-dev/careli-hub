import { NextResponse } from "next/server";

import { asanaConfigurado, escanearCads } from "@/lib/apolo/asana-import";
import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// COMPARATIVO Asana x Board do Apolo — de que lado está cada CAD.
//
// O Asana é onde o time trabalha as fichas; o Apolo é onde elas viram esteira, crédito e PIX. Os
// dois divergem naturalmente (CAD que chegou e ainda não subiu, ficha criada direto no Apolo), e
// até agora não havia como ver o tamanho da diferença sem contar na mão.
//
// DUPLICADAS e CAD INCORRETA ficam FORA da conta dos dois lados: são refugo do processo, não
// trabalho pendente. O total delas aparece à parte, só para o número fechar com o que o Asana
// mostra na tela.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Seções que não são trabalho: refugo declarado pelo time.
function ehRefugo(secao: string): boolean {
  const s = secao
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return s.includes("duplic") || s.includes("incorret");
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  if (!asanaConfigurado()) {
    return NextResponse.json({ error: "Asana não configurado." }, { status: 503 });
  }
  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });
  }

  const url = new URL(request.url);
  const empreendimento = url.searchParams.get("empreendimento")?.trim() || "Vale do Ouro";

  // Seções vazias = varre o projeto inteiro daquele empreendimento.
  const { cads, secoesEncontradas } = await escanearCads({ empreendimento, secoes: [] });

  const validas = cads.filter((c) => !ehRefugo(c.secao));
  const refugo = cads.length - validas.length;

  // Quem já subiu: o vínculo task -> entidade é o que prova a importação.
  const gids = validas.map((c) => c.gid);
  const vinculo = new Map<string, string>();
  for (let i = 0; i < gids.length; i += 200) {
    const { data } = await client
      .from("apolo_source_links")
      .select("source_id, entity_id")
      .eq("source_system", "asana")
      .eq("source_table", "cad_task")
      .in("source_id", gids.slice(i, i + 200));

    for (const l of (data ?? []) as { entity_id: string; source_id: string }[]) {
      vinculo.set(l.source_id, l.entity_id);
    }
  }

  // Etapa de cada ficha já importada.
  // ⚠️ Uma linha por CAD (0080): quem tem CAD em outro loteamento volta duas vezes. O comparativo
  // é DESTE empreendimento, então só a etapa da CAD dele interessa — o filtro por
  // `empreendimento` abaixo é a mesma regra, aplicada aqui.
  const etapaPorEntidade = new Map<string, string>();
  const entityIds = [...vinculo.values()];
  for (let i = 0; i < entityIds.length; i += 200) {
    const { data } = await client
      .from("apolo_esteira")
      .select("entity_id, etapa")
      // `.ilike`, não `.eq`: a esteira grava o nome como o time digitou ("VALE DO OURO", 637 linhas
      // em prod), mas o default deste filtro é "Vale do Ouro". `.eq` é case-sensitive e casaria
      // ZERO linha — a tela de conferência voltava vazia. `.ilike` compara sem caixa.
      .ilike("empreendimento", empreendimento)
      .in("entity_id", entityIds.slice(i, i + 200));

    for (const e of (data ?? []) as { entity_id: string; etapa: string | null }[]) {
      etapaPorEntidade.set(e.entity_id, e.etapa ?? "sem etapa");
    }
  }

  // Do lado do Apolo: a esteira inteira do empreendimento, para achar quem existe lá SEM task.
  const { data: esteiraToda } = await client
    .from("apolo_esteira")
    .select("entity_id, etapa")
    // `.ilike` pelo mesmo motivo: "VALE DO OURO" (prod) x "Vale do Ouro" (default) é só caixa.
    .ilike("empreendimento", empreendimento);

  const fichasApolo = (esteiraToda ?? []) as { entity_id: string; etapa: string | null }[];

  // NOMES das fichas que já estão na esteira. É o que permite reconhecer a PESSOA quando a ficha
  // existe no Board mas a task não foi vinculada (CAD criada à mão / pelo portal). Sem isto ela
  // aparecia como "falta importar" mesmo já estando na fila — e o número do Asana nunca fechava
  // com o do Board.
  const normalizarNomeCad = (valor: string | null | undefined): string =>
    String(valor ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const nomesNaEsteira = new Set<string>();
  const idsEsteira = fichasApolo.map((f) => f.entity_id);
  for (let i = 0; i < idsEsteira.length; i += 300) {
    const { data } = await client
      .from("apolo_entities")
      .select("display_name, legal_name")
      .in("id", idsEsteira.slice(i, i + 300));
    for (const e of (data ?? []) as { display_name: string | null; legal_name: string | null }[]) {
      const nome = normalizarNomeCad(e.legal_name || e.display_name);
      if (nome) nomesNaEsteira.add(nome);
    }
  }

  // Por seção: quanto já subiu, quanto falta e QUEM falta. O gid vai junto do nome porque a tela
  // deixa escolher quem importar — e é pelo gid que a leitura sabe qual task ler.
  const porSecao = new Map<
    string,
    {
      faltantes: { gid: string; nome: string }[];
      importadas: number;
      // Está no Board (mesma pessoa na esteira) mas a task não está vinculada: não é trabalho
      // pendente, é só vínculo faltando. Contar como "falta" inflava a diferença.
      noBoardSemVinculo: number;
      naAsana: number;
    }
  >();

  for (const cad of validas) {
    const atual = porSecao.get(cad.secao) ?? {
      faltantes: [],
      importadas: 0,
      naAsana: 0,
      noBoardSemVinculo: 0,
    };
    atual.naAsana += 1;
    // O nome do PROPONENTE é o do cliente; o título da task é digitado à mão.
    const nomeCad = cad.nomeProponente || cad.nome;
    if (vinculo.has(cad.gid)) {
      atual.importadas += 1;
    } else if (nomesNaEsteira.has(normalizarNomeCad(nomeCad))) {
      atual.noBoardSemVinculo += 1;
    } else if (atual.faltantes.length < 400) {
      atual.faltantes.push({ gid: cad.gid, nome: nomeCad });
    }
    porSecao.set(cad.secao, atual);
  }
  const comTask = new Set(vinculo.values());
  const soNoApolo = fichasApolo.filter((f) => !comTask.has(f.entity_id));

  // Etapas do Apolo (só o que veio do Asana e está na esteira).
  const porEtapa: Record<string, number> = {};
  for (const etapa of etapaPorEntidade.values()) {
    porEtapa[etapa] = (porEtapa[etapa] ?? 0) + 1;
  }

  const importadas = [...vinculo.keys()].length;
  // Já estão no Board, só sem o vínculo da task (CAD criada à mão / pelo portal). Não é pendência:
  // sem separar isso, o "faltam importar" contava gente que já está na fila.
  const noBoardSemVinculo = [...porSecao.values()].reduce((a, s) => a + s.noBoardSemVinculo, 0);

  return NextResponse.json(
    {
      data: {
        empreendimento,
        porEtapa,
        porSecao: [...porSecao.entries()]
          .map(([secao, v]) => ({ secao, ...v }))
          .sort((a, b) => b.naAsana - a.naAsana),
        resumo: {
          // Fecha a conta: naAsanaValidas = importadas + noBoardSemVinculo + faltamImportar.
          faltamImportar: validas.length - importadas - noBoardSemVinculo,
          importadas,
          // Ficha que existe no Apolo e não tem task no Asana (cadastro manual, portal público).
          naAsanaValidas: validas.length,
          naAsanaTotal: cads.length,
          noApoloSemTask: soNoApolo.length,
          noApoloTotal: fichasApolo.length,
          noBoardSemVinculo,
          refugo,
        },
        secoesEncontradas,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
