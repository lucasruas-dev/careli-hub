import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  setEnterpriseComissaoCoordenadora,
  setEnterpriseComissaoImobiliaria,
  setEnterpriseCoordenadora,
  setEnterpriseEntradaMinima,
  setEnterpriseGestaoCarteira,
} from "@/lib/apolo/enterprise-settings";
import { type DadosDoApolo, loadPoliticaComercial } from "@/lib/apolo/politica-comercial";
import { createApoloAdminClient } from "@/lib/apolo/server";

// POLÍTICA COMERCIAL DO EMPREENDIMENTO — as duas fontes, com a precedência do Lucas (17/08/2026):
//
//   GET   → junta o que vem do C2X (comissão total, entrada mínima, parcelas do sinal, split da
//           cadeia por papel) com o que mora no Apolo (gestão de carteira, entrada mínima e, desde
//           a migration 0145, o rateio da corretagem), e devolve os avisos quando a política do
//           legado está furada.
//   PATCH → grava SÓ o que é do Apolo. O resto é do C2X, que é read-only.
//
// AUTORIZAÇÃO: leitura no GET; ESCRITA no PATCH. Os percentuais definem quanto o incorporador
// recebe, se a aba Carteira aparece para ele e o que o contrato de corretagem imprime — quem só
// visualiza não muda isso.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const codes = (new URL(request.url).searchParams.get("codes") ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  if (codes.length === 0) {
    return NextResponse.json(
      { error: "Informe ao menos um codigo de empreendimento." },
      { status: 400 },
    );
  }

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  // A % do Apolo vem primeiro: é ela que a leitura do C2X recebe para montar os avisos.
  //
  // ⚠️ O ERRO É CHECADO, e a rota FALHA em vez de seguir com o Map vazio. Sem isto, qualquer
  // problema de leitura (timeout, 5xx do PostgREST) faria a tela dizer "a Careli não administra a
  // carteira deste empreendimento" — uma AFIRMAÇÃO DE NEGÓCIO — a partir de uma falha técnica. E o
  // operador estaria a um clique de gravar esse vazio falso por cima do percentual real.
  const { data: settings, error: erroSettings } = await adminClient
    .from("apolo_enterprise_settings")
    .select(
      "enterprise_id, gestao_carteira_percentual, entrada_minima_percentual, comissao_coordenadora_percentual, comissao_imobiliaria_percentual, coordenadora_entity_id",
    )
    .limit(2000);

  if (erroSettings) {
    return NextResponse.json(
      { error: `Nao foi possivel ler a gestao de carteira: ${erroSettings.message}` },
      { status: 503 },
    );
  }

  // numeric do Postgres pode voltar string; e `undefined` (coluna ausente numa leitura antiga)
  // conta como nulo, que é "não cadastrado".
  const pct = (v: null | number | string | undefined): null | number =>
    v === null || v === undefined || v === "" ? null : Number(v);

  const doApolo = new Map<string, DadosDoApolo>(
    ((settings ?? []) as Array<{
      comissao_coordenadora_percentual: null | number | string;
      comissao_imobiliaria_percentual: null | number | string;
      coordenadora_entity_id: null | string;
      entrada_minima_percentual: null | number | string;
      enterprise_id: string;
      gestao_carteira_percentual: null | number | string;
    }>).map((linha) => [
      String(linha.enterprise_id),
      {
        comissaoCoordenadoraPercentual: pct(linha.comissao_coordenadora_percentual),
        comissaoImobiliariaPercentual: pct(linha.comissao_imobiliaria_percentual),
        coordenadoraEntityId: (linha.coordenadora_entity_id ?? "").trim() || null,
        entradaMinimaPercentual: pct(linha.entrada_minima_percentual),
        gestaoCarteiraPercentual: pct(linha.gestao_carteira_percentual),
      },
    ]),
  );

  const resultado = await loadPoliticaComercial(codes, doApolo);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 502 });
  }

  const nomes = await lerNomesDasCoordenadoras(
    adminClient,
    resultado.politicas.map((p) => p.coordenadoraEntityId),
  );

  const politicas = resultado.politicas.map((p) => ({
    ...p,
    // Id que não resolve (entidade arquivada ou fundida — a 0145 não criou FK de propósito) fica
    // com nome nulo, e a tela mostra a mesma lacuna de "coordenadora não cadastrada".
    coordenadoraNome: p.coordenadoraEntityId ? (nomes.get(p.coordenadoraEntityId) ?? null) : null,
  }));

  return NextResponse.json(
    { data: { politicas } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Resolve o `display_name` das coordenadoras apontadas, numa consulta só.
 *
 * ⚠️ EM LOTES DE 100, e não num `.in()` gigante: o PostgREST manda o filtro na URL, e algumas
 * centenas de uuid estouram o limite do servidor — a leitura volta como erro de rede, sem dizer
 * por quê. São poucos empreendimentos por chamada hoje, mas o lote é o que impede a surpresa
 * quando a tela passar a pedir todos de uma vez.
 *
 * ⚠️ FALHA AQUI NÃO DERRUBA O GET, ao contrário da leitura das settings acima: um nome que não veio
 * é uma LACUNA (o operador vê "coordenadora não cadastrada" e vai apontar de novo), enquanto uma
 * settings que não veio viraria uma AFIRMAÇÃO falsa sobre o negócio — e o operador estaria a um
 * clique de gravar esse vazio por cima do percentual real. As duas coisas são diferentes.
 */
async function lerNomesDasCoordenadoras(
  adminClient: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  ids: Array<null | string>,
): Promise<Map<string, string>> {
  const alvos = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const nomes = new Map<string, string>();
  if (alvos.length === 0) return nomes;

  for (let inicio = 0; inicio < alvos.length; inicio += 100) {
    const lote = alvos.slice(inicio, inicio + 100);
    const { data, error } = await adminClient
      .from("apolo_entities")
      .select("id, display_name")
      .in("id", lote);

    if (error) continue;

    for (const linha of (data ?? []) as Array<{ display_name: null | string; id: string }>) {
      const nome = (linha.display_name ?? "").trim();
      if (nome) nomes.set(String(linha.id), nome);
    }
  }

  return nomes;
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  let corpo: {
    code?: null | string;
    // Rateio da corretagem (migration 0145). Mesma regra dos dois de baixo: ausente = não mexeu;
    // null = limpou ("não cadastrado", que é diferente de zero).
    comissaoCoordenadoraPercentual?: null | number | string;
    comissaoImobiliariaPercentual?: null | number | string;
    // A entidade da coordenadora de vendas. null = "não há coordenadora apontada".
    coordenadoraEntityId?: null | string;
    /** Uma divisão (compatível) ou várias, quando o empreendimento tem fases/glebas. */
    enterpriseId?: string;
    enterpriseIds?: string[];
    // `null` APAGA, e apagar tem significado: "não fazemos a gestão de carteira deste
    // empreendimento". Por isso o campo distingue ausente (não mexeu) de null (limpou).
    gestaoCarteiraPercentual?: null | number | string;
    // Mesma regra do campo acima: ausente = não mexeu; null = limpou ("volta ao padrão da casa").
    entradaMinimaPercentual?: null | number | string;
  };

  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  // ⚠️ AS DIVISÕES GRAVAM NUMA CHAMADA SÓ, e isso é o que impede estado meio-feito. A tela fazia
  // um PATCH por divisão em sequência: se a segunda falhasse, a Lagoa Bonita ficaria com uma gleba
  // em 97% e outra em 96% — exatamente o que a regra "uma % por empreendimento" proíbe —, e a tela
  // ainda diria "a política NÃO mudou", afirmação que ela não tinha como honrar.
  const ids = [
    ...(Array.isArray(corpo.enterpriseIds) ? corpo.enterpriseIds : []),
    ...(corpo.enterpriseId ? [corpo.enterpriseId] : []),
  ]
    .map((id) => String(id).trim())
    .filter(Boolean);

  const enterpriseIds = [...new Set(ids)];

  if (enterpriseIds.length === 0) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  // Os campos graváveis, na ordem em que a tela os mostra. `in` (e não `!== undefined`) porque
  // ausente e `null` significam coisas diferentes: não mexeu × limpou.
  const CAMPOS = [
    "gestaoCarteiraPercentual",
    "entradaMinimaPercentual",
    "comissaoCoordenadoraPercentual",
    "comissaoImobiliariaPercentual",
    "coordenadoraEntityId",
  ] as const;

  const tocados = CAMPOS.filter((campo) => campo in corpo);

  if (tocados.length === 0) {
    return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });
  }

  // ⚠️ UM CAMPO POR VEZ. A tela salva cada linha da política sozinha, e mandar dois juntos
  // significaria sobrescrever o que o operador não tocou com o valor que a tela tinha em memória.
  if (tocados.length > 1) {
    return NextResponse.json(
      { error: "Salve um campo por vez." },
      { status: 400 },
    );
  }

  const campo = tocados[0];
  // Redundante para o negócio, obrigatório para o TypeScript (`noUncheckedIndexedAccess`): a
  // checagem de tamanho acima já garante exatamente um campo.
  if (!campo) {
    return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });
  }

  const gravados: string[] = [];

  // ⚠️ RELATA O QUE JÁ GRAVOU. Uma falha no meio deixa o empreendimento inconsistente, e o operador
  // precisa saber disso para corrigir — não pode ler "não salvou" e ir embora.
  const relatarFalha = (erro: string | undefined) =>
    NextResponse.json(
      {
        error:
          gravados.length > 0
            ? `${erro} Atenção: ${gravados.length} de ${enterpriseIds.length} divisões já foram salvas (${gravados.join(", ")}). Tente de novo para igualar as demais.`
            : erro,
        gravados,
      },
      { status: 400 },
    );

  // A COORDENADORA não é percentual: é um uuid (ou o vazio, que apaga o apontamento). Caminho
  // próprio, mesma disciplina de laço e de relato das divisões.
  if (campo === "coordenadoraEntityId") {
    const bruto = corpo.coordenadoraEntityId;

    if (bruto !== null && bruto !== undefined && typeof bruto !== "string") {
      return NextResponse.json({ error: "Coordenadora invalida." }, { status: 400 });
    }

    const entityId = (bruto ?? "").trim() || null;

    for (const enterpriseId of enterpriseIds) {
      const gravado = await setEnterpriseCoordenadora({
        adminClient,
        code: corpo.code ?? null,
        enterpriseId,
        entityId,
        updatedBy: auth.userId,
      });

      if (!gravado.ok) return relatarFalha(gravado.error);
      gravados.push(enterpriseId);
    }

    return NextResponse.json({
      data: {
        campo,
        coordenadoraEntityId: entityId,
        divisoes: gravados.length,
      },
    });
  }

  const lerPercentual = (bruto: null | number | string | undefined): null | number =>
    bruto === null || bruto === undefined || bruto === ""
      ? null
      : typeof bruto === "string"
        ? Number(bruto.replace(",", "."))
        : Number(bruto);

  const percentual = lerPercentual(corpo[campo]);

  if (percentual !== null && !Number.isFinite(percentual)) {
    return NextResponse.json(
      { error: "Percentual invalido: informe um numero entre 0 e 100." },
      { status: 400 },
    );
  }

  const SETTER_DO_CAMPO = {
    comissaoCoordenadoraPercentual: setEnterpriseComissaoCoordenadora,
    comissaoImobiliariaPercentual: setEnterpriseComissaoImobiliaria,
    entradaMinimaPercentual: setEnterpriseEntradaMinima,
    gestaoCarteiraPercentual: setEnterpriseGestaoCarteira,
  } as const;

  for (const enterpriseId of enterpriseIds) {
    const gravado = await SETTER_DO_CAMPO[campo]({
      adminClient,
      code: corpo.code ?? null,
      enterpriseId,
      percentual,
      updatedBy: auth.userId,
    });

    if (!gravado.ok) return relatarFalha(gravado.error);

    gravados.push(enterpriseId);
  }

  return NextResponse.json({
    data: {
      campo,
      divisoes: gravados.length,
      // ⚠️ O NOME DA CHAVE É HISTÓRICO: ela sempre carregou o valor DO CAMPO GRAVADO, qualquer que
      // fosse ele (a entrada mínima já saía por aqui). Mantida como está para não quebrar quem lê;
      // o `campo` acima é quem diz de que percentual se trata.
      gestaoCarteiraPercentual: percentual,
      // A tela usa isto para dizer "sem gestão de carteira" em vez de mostrar 0%.
      semGestao: percentual === null,
    },
  });
}
