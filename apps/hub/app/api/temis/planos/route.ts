import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  conferirPlano,
  descontoParaGravar,
  ehColunaDaRessalvaAusente,
  ehColunaDoDescontoAusente,
  type EntradaDePlano,
  limparRessalva,
} from "@/lib/temis/planos";

// PLANOS COMERCIAIS DO EMPREENDIMENTO — Temis.
//
//   GET    → os planos e as categorias de um empreendimento
//   POST   → cria um plano
//   PATCH  → edita um plano
//   DELETE → desativa (não apaga)
//
// ⚠️ DESATIVAR, NUNCA APAGAR. Um plano com venda feita explica um contrato assinado; sumir com ele
// deixaria o contrato sem origem. O banco já impede pelo `on delete restrict`, e aqui a rota nem
// oferece o caminho: DELETE marca `ativo = false`. Índice parcial no banco garante que plano
// desativado libera o slot para outro ocupar.
//
// AUTORIZAÇÃO: leitura no GET, ESCRITA nos demais. O plano decide qual minuta o contrato usa e
// quanto o comprador paga — quem só visualiza não mexe nisso.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** O empreendimento é TEXT porque convive com id numérico e agrupamento (`group:Nome`). */
function empreendimentoDaUrl(request: Request): null | string {
  const valor = new URL(request.url).searchParams.get("enterpriseId")?.trim();
  return valor || null;
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // ⚠️ A RESSALVA (migration 0168) E O DESCONTO (0178) PODEM AINDA NÃO EXISTIR NO BANCO. O código
  // sobe antes delas, e uma coluna a mais no select derrubaria a aba de planos inteira com 502. Por
  // isso a leitura tenta com as colunas e, SÓ se o erro for de uma delas
  // (`ehColunaDaRessalvaAusente`, `ehColunaDoDescontoAusente`), repete sem aquela.
  //
  // ⚠️ A STRING É MONTADA, e por isso a linha é tipada à mão (`LinhaDoCadastro`). Com duas colunas
  // opcionais seriam quatro literais para o supabase-js inferir a forma; um tipo declarado é o
  // mesmo contrato, num lugar só.
  const lerPlanos = (comRessalva: boolean, comDesconto: boolean) =>
    admin
      .from("temis_planos")
      .select(
        [
          // ⚠️ AS ANUAIS (0138) ENTRAM NA LEITURA (18/09/2026). A aba confere o plano contra o preço
          // de uma unidade, e sem as anuais a conferência do Investidor Parcelado do Garden dizia
          // R$ 4.383,14 enquanto a Mesa dizia outro número. As colunas existem desde a 0138 (a Mesa e
          // o espelho já as leem), então não precisam da tolerância da ressalva e do desconto.
          "id, nome, parcelas, entrada_percentual, juros_taxa, juros_periodicidade, juros_convencao, indice_correcao, sistema_amortizacao, slot, ativo, ordem, observacao, categoria_id, minuta_id, criado_em, anuais_quantidade, anuais_valor",
          comRessalva ? "ressalva" : null,
          comDesconto ? "desconto_percentual" : null,
        ]
          .filter(Boolean)
          .join(", "),
      )
      .eq("workspace_id", "careli")
      .eq("enterprise_id", enterpriseId)
      .order("ordem", { ascending: true })
      .order("parcelas", { ascending: true });

  type LinhaDoCadastro = {
    anuais_quantidade: null | number | string;
    anuais_valor: null | number | string;
    ativo: boolean;
    categoria_id: null | string;
    criado_em: string;
    desconto_percentual?: null | number | string;
    entrada_percentual: number | string;
    id: string;
    indice_correcao: string;
    juros_convencao: string;
    juros_periodicidade: string;
    juros_taxa: null | number | string;
    minuta_id: null | string;
    nome: string;
    observacao: null | string;
    ordem: number;
    parcelas: number;
    ressalva?: null | string;
    sistema_amortizacao: string;
    slot: null | string;
  };

  const [primeiraLeitura, categoriasRes, minutasRes, pisoRes] = await Promise.all([
    lerPlanos(true, true),
    admin
      .from("temis_categorias")
      .select("id, nome, ordem, ativa")
      .eq("workspace_id", "careli")
      .eq("enterprise_id", enterpriseId)
      .order("ordem", { ascending: true }),
    admin
      .from("temis_minutas")
      .select("id, nome, situacao, versao")
      .eq("workspace_id", "careli")
      .eq("enterprise_id", enterpriseId)
      .neq("situacao", "arquivada")
      .order("nome", { ascending: true }),
    // ⚠️ O PISO DE ENTRADA DO EMPREENDIMENTO, o mesmo que a Mesa entrega ao simulador
    // (`apolo_enterprise_settings.entrada_minima_percentual`). A conferência da aba usa a conta da
    // Mesa (`conferenciaDoPlano`), e sem o piso ela partiria do padrão da casa (10%): o Investidor
    // Parcelado do Garden (8%) apareceria com a entrada de outro número.
    admin
      .from("apolo_enterprise_settings")
      .select("entrada_minima_percentual")
      .eq("enterprise_id", enterpriseId)
      .maybeSingle<{ entrada_minima_percentual: null | number | string }>(),
  ]);
  // No máximo duas repetições: uma por coluna que pode faltar. Qualquer outro erro sai como veio.
  let planosRes = primeiraLeitura;
  let comRessalva = true;
  let comDesconto = true;
  for (let tentativa = 0; tentativa < 2 && planosRes.error; tentativa += 1) {
    if (comRessalva && ehColunaDaRessalvaAusente(planosRes.error)) comRessalva = false;
    else if (comDesconto && ehColunaDoDescontoAusente(planosRes.error)) comDesconto = false;
    else break;
    planosRes = await lerPlanos(comRessalva, comDesconto);
  }

  // ⚠️ FALHA FECHADA. Devolver lista vazia num erro de leitura faria a tela dizer "este
  // empreendimento não tem plano" — uma afirmação de negócio a partir de uma falha técnica, e o
  // operador cadastraria tudo de novo por cima. É o mesmo cuidado da aba de política comercial.
  const erro = planosRes.error ?? categoriasRes.error ?? minutasRes.error;
  if (erro) {
    return NextResponse.json(
      { error: "Não consegui ler os planos deste empreendimento." },
      { status: 502 },
    );
  }

  const categorias = categoriasRes.data ?? [];
  const minutas = minutasRes.data ?? [];
  const porCategoria = new Map(categorias.map((c) => [c.id, c.nome]));
  const porMinuta = new Map(minutas.map((m) => [m.id, m.nome]));
  const planos = (planosRes.data ?? []) as unknown as LinhaDoCadastro[];

  // ⚠️ FALHA NA LEITURA DO PISO NÃO DERRUBA A ABA, e vira "não cadastrado" (padrão da casa), nunca
  // zero: é a mesma escolha da Mesa (`incorporador/venda`). O piso só alimenta a conferência.
  if (pisoRes.error) console.error("[temis/planos] piso de entrada", pisoRes.error);
  const pisoCru = pisoRes.error ? null : pisoRes.data?.entrada_minima_percentual;
  const pisoNumero = pisoCru === null || pisoCru === undefined || pisoCru === "" ? null : Number(pisoCru);
  const entradaMinimaPercentual =
    pisoNumero !== null && Number.isFinite(pisoNumero) ? pisoNumero : null;

  /** `numeric` chega como texto do PostgREST; meia configuração de anual não é anual nenhuma. */
  const anuais = (p: LinhaDoCadastro) => {
    const quantidade = Number(p.anuais_quantidade ?? 0);
    const valor = Number(p.anuais_valor ?? 0);
    return Number.isFinite(quantidade) && Number.isFinite(valor) && quantidade > 0 && valor > 0
      ? { anuaisQuantidade: quantidade, anuaisValor: valor }
      : { anuaisQuantidade: null, anuaisValor: null };
  };

  return NextResponse.json({
    data: {
      entradaMinimaPercentual,
      categorias: categorias.map((c) => ({
        ativa: c.ativa,
        id: c.id,
        nome: c.nome,
        ordem: c.ordem,
        planos: planos.filter((p) => p.categoria_id === c.id).length,
      })),
      minutas: minutas.map((m) => ({
        id: m.id,
        nome: m.nome,
        publicada: m.situacao === "publicada",
        versao: m.versao,
      })),
      planos: planos.map((p) => ({
        ...anuais(p),
        ativo: p.ativo,
        categoriaId: p.categoria_id,
        categoriaNome: p.categoria_id ? (porCategoria.get(p.categoria_id) ?? null) : null,
        criadoEm: p.criado_em,
        // Sem a 0178 a linha chega sem o campo: zero, que é "sem desconto", e não `undefined`.
        descontoPercentual: descontoParaGravar(p.desconto_percentual),
        entradaPercentual: Number(p.entrada_percentual),
        id: p.id,
        indiceCorrecao: p.indice_correcao,
        jurosConvencao: p.juros_convencao,
        jurosPeriodicidade: p.juros_periodicidade,
        jurosTaxa: p.juros_taxa === null ? null : Number(p.juros_taxa),
        minutaId: p.minuta_id,
        minutaNome: p.minuta_id ? (porMinuta.get(p.minuta_id) ?? null) : null,
        nome: p.nome,
        observacao: p.observacao,
        ordem: p.ordem,
        parcelas: p.parcelas,
        // Sem a 0168 a linha chega sem o campo: nulo, e não `undefined`, para a tela não distinguir.
        ressalva: limparRessalva(p.ressalva),
        sistemaAmortizacao: p.sistema_amortizacao,
        slot: p.slot,
      })),
    },
  });
}

/**
 * Traduz a entrada da tela para as colunas do banco. Um lugar só, para não divergir.
 *
 * ⚠️ `ressalva` SÓ ENTRA QUANDO A TELA FALOU DELA (chave presente no corpo). Um cliente antigo, que
 * não conhece o campo, salvaria o plano apagando a etiqueta que outra pessoa escreveu; e, com a
 * migration 0168 pendente, a chave a mais derrubaria todo salvamento com PGRST204.
 */
function paraColunas(entrada: EntradaDePlano, enterpriseId: string) {
  return {
    ...("ressalva" in entrada ? { ressalva: limparRessalva(entrada.ressalva) } : {}),
    // ⚠️ O DESCONTO (0178) SEGUE A MESMA REGRA DA RESSALVA: só entra quando a tela falou dele.
    // Cliente antigo sem o campo não apaga o desconto do Investidor do Garden ao salvar os juros.
    ...("descontoPercentual" in entrada
      ? { desconto_percentual: descontoParaGravar(entrada.descontoPercentual) }
      : {}),
    ativo: entrada.ativo ?? true,
    categoria_id: entrada.categoriaId ?? null,
    entrada_percentual: entrada.entradaPercentual,
    enterprise_id: enterpriseId,
    indice_correcao: entrada.indiceCorrecao,
    juros_convencao: entrada.jurosConvencao ?? "equivalente",
    juros_periodicidade: entrada.jurosPeriodicidade ?? "anual",
    juros_taxa: entrada.jurosTaxa,
    minuta_id: entrada.minutaId ?? null,
    nome: entrada.nome.trim(),
    observacao: entrada.observacao ?? null,
    ordem: entrada.ordem ?? 0,
    parcelas: entrada.parcelas,
    sistema_amortizacao: entrada.sistemaAmortizacao,
    slot: entrada.slot ?? null,
    workspace_id: "careli",
  };
}

/**
 * Traduz o erro do Postgres para o que o operador precisa fazer.
 *
 * ⚠️ Sem isto, o slot duplicado devolveria "duplicate key value violates unique constraint
 * temis_planos_slot_unico_por_empreendimento" na cara de quem só queria cadastrar um plano.
 */
function explicarErro(codigo: string, mensagem: string): string {
  if (codigo === "23505" && mensagem.includes("slot")) {
    return "Já existe um plano ativo nessa posição da proposta. Troque a posição ou desative o outro.";
  }
  // ⚠️ O NOME DEIXOU DE SER ÚNICO na migration 0143 (Lucas: dois planos "Normal" no Veredas, um em
  // Price e outro em SACOC, são legítimos — a diferença entre eles é a TABELA). Se um 23505 chegar
  // aqui sem ser do slot, é uma trava que ninguém previu: melhor dizer isso do que repetir uma
  // explicação que virou mentira.
  if (codigo === "23505") return "Esse plano conflita com outro já cadastrado.";
  if (codigo === "23514" && mensagem.includes("entrada")) {
    return "A entrada é um percentual de 0 a 100 — 20 significa 20%.";
  }
  if (codigo === "23514" && mensagem.includes("ressalva")) {
    return "A ressalva de disponibilidade tem no máximo 80 caracteres e não pode ser só espaços.";
  }
  if (codigo === "23514" && mensagem.includes("desconto")) {
    return "O desconto do plano é um percentual de 0 a menos de 100: 8 significa 8%.";
  }
  if (codigo === "23514") return "Algum valor está fora do permitido. Confira parcelas, juros e entrada.";
  return "Não consegui gravar o plano.";
}

/** A frase de quando alguém tenta GRAVAR uma ressalva com a migration 0168 ainda por aplicar. */
const RESSALVA_SEM_COLUNA =
  "A ressalva de disponibilidade ainda não foi liberada no banco. Salve o plano sem ela por enquanto.";

/** A frase de quando alguém tenta GRAVAR um desconto com a migration 0178 ainda por aplicar. */
const DESCONTO_SEM_COLUNA =
  "O desconto do plano ainda não foi liberado no banco. Salve o plano sem desconto por enquanto.";

/**
 * Grava, e se o banco ainda não tem a coluna `ressalva` (0168) ou `desconto_percentual` (0178),
 * decide o que fazer.
 *
 * ⚠️ SEM VALOR PARA GRAVAR NAQUELA COLUNA, REPETE SEM A CHAVE: não há nada a perder, e o operador
 * que só trocou os juros não pode ser barrado por uma migration que não é dele. COM VALOR, RECUSA:
 * gravar o plano e descartar a frase ou o desconto calado diria "salvo" para uma condição que nunca
 * vai aparecer na venda — e um desconto de plano que some é preço de tabela cobrado de quem devia
 * pagar 8% menos.
 */
async function gravarTolerandoColunasNovas<
  R extends { error: { code?: string; message?: string } | null },
>(
  colunas: ReturnType<typeof paraColunas>,
  gravar: (linha: ReturnType<typeof paraColunas>) => PromiseLike<R>,
): Promise<{ resposta: R; semColuna: null | string }> {
  const linha: Record<string, unknown> = { ...colunas };

  // No máximo três idas: a original e uma por coluna que pode faltar.
  for (let tentativa = 0; ; tentativa += 1) {
    const resposta = await gravar(linha as ReturnType<typeof paraColunas>);
    if (tentativa >= 2) return { resposta, semColuna: null };

    if (ehColunaDaRessalvaAusente(resposta.error) && "ressalva" in linha) {
      if (linha.ressalva) return { resposta, semColuna: RESSALVA_SEM_COLUNA };
      delete linha.ressalva;
      continue;
    }
    if (ehColunaDoDescontoAusente(resposta.error) && "desconto_percentual" in linha) {
      if (linha.desconto_percentual) return { resposta, semColuna: DESCONTO_SEM_COLUNA };
      delete linha.desconto_percentual;
      continue;
    }
    return { resposta, semColuna: null };
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });

  const entrada = (await request.json().catch(() => null)) as EntradaDePlano | null;
  if (!entrada) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const problemas = conferirPlano(entrada);
  if (problemas.length) return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { resposta, semColuna } = await gravarTolerandoColunasNovas(
    paraColunas(entrada, enterpriseId),
    (linha) => admin.from("temis_planos").insert(linha).select("id").single(),
  );

  if (semColuna) return NextResponse.json({ error: semColuna }, { status: 400 });
  const { data, error } = resposta;
  if (error) {
    return NextResponse.json({ error: explicarErro(error.code ?? "", error.message ?? "") }, { status: 400 });
  }
  return NextResponse.json({ data: { id: data.id } });
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!enterpriseId || !id) {
    return NextResponse.json({ error: "Informe o empreendimento e o plano." }, { status: 400 });
  }

  const entrada = (await request.json().catch(() => null)) as EntradaDePlano | null;
  if (!entrada) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const problemas = conferirPlano(entrada);
  if (problemas.length) return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { resposta, semColuna } = await gravarTolerandoColunasNovas(
    paraColunas(entrada, enterpriseId),
    (linha) =>
      admin
        .from("temis_planos")
        .update({ ...linha, atualizado_em: new Date().toISOString() })
        .eq("workspace_id", "careli")
        .eq("enterprise_id", enterpriseId)
        .eq("id", id),
  );

  if (semColuna) return NextResponse.json({ error: semColuna }, { status: 400 });
  const { error } = resposta;
  if (error) {
    return NextResponse.json({ error: explicarErro(error.code ?? "", error.message ?? "") }, { status: 400 });
  }
  return NextResponse.json({ data: { id } });
}

export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!enterpriseId || !id) {
    return NextResponse.json({ error: "Informe o empreendimento e o plano." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // Desativa. Ver a nota do topo: plano com venda explica um contrato assinado.
  const { error } = await admin
    .from("temis_planos")
    .update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq("workspace_id", "careli")
    .eq("enterprise_id", enterpriseId)
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Não consegui desativar o plano." }, { status: 400 });
  return NextResponse.json({ data: { id } });
}
