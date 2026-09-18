// O GRUPO TRABALHO DA TÊMIS — o board, os empreendimentos e a tela de um card, num código só.
//
// Decisões do Lucas (16/09/2026), sobre o portal da Cecílio Rocha: a venda feita pelo time dela é
// confeccionada POR ELA, no portal (*"a Cecilio quem vai fazer é o proprio time deles"*), e a
// venda da Gurgel continua na Têmis da Careli. Mesmo banco, mesmas tabelas, mesmo código: o que
// separa é o DONO do trabalho (`temis_trabalhos.operado_por`, migration 0172) e o ESCOPO de
// empreendimento da sessão.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE. As rotas `/api/temis/{trabalhos,board,empreendimentos,trabalho,
// trabalho/conversa,trabalho/historico,trabalho/documentos}` tinham a lógica inteira dentro delas e
// nenhuma conferia escopo: o jurídico da Careli enxerga tudo por desenho. O portal precisa da
// MESMA operação, e copiar a rota para `/api/incorporador/temis/*` daria duas versões da mesma
// regra, que divergiriam no primeiro conserto. Então a lógica mora aqui, recebe o ATOR
// (`ator.ts`), e as duas rotas viram portas finas: cada uma confere a própria credencial, monta o
// ator e chama a função.
//
// ⚠️ O RECORTE VEM ANTES DA LEITURA, SEMPRE. Todo id que chega pela URL ou pelo corpo (trabalho,
// proposta, documento, empreendimento) passa por `trabalhoNoAlcance` / `enterpriseNoAlcance` ANTES
// de o dado sair do banco — a mesma regra de `unidadeNoEscopo`: conferir com o dado em mãos é o
// mesmo que não conferir. Fora do alcance é `foraDoEscopo()` (404, sem dizer por quê).
//
// ⚠️ PARA O HUB, O ALCANCE É SEMPRE "SIM" E NÃO CUSTA CONSULTA. `trabalhoNoAlcance` devolve `true`
// para o ator do hub sem olhar a linha, então as conferências abaixo só vão ao banco quando a
// resposta pode ser "não". É isso que mantém a Têmis da Careli com as mesmas consultas, na mesma
// ordem e com as mesmas respostas de antes.
//
// ⚠️ ESCREVER NO PORTAL PEDE O PRODUTO OPERADO POR ELE (decisão do Lucas, 16/09/2026: escrita só no
// que a Cecílio opera). Abrir solicitação, marcar atividade, indeferir, voltar para análise e
// escrever na conversa passam pelo alcance de sempre e, DEPOIS, pela régua de quem opera o produto
// (`alcanceParaEscrever`, em `alcance-da-estrutura.ts`). O card antigo do portal num produto que ele
// só consulta (VOC, VOR) continua abrindo, e responde 403 só consulta a quem tenta mexer.

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import type { ApoloDocumentItem } from "@/lib/apolo/documentos";
import { documentosDoApoloParaPortal } from "@/lib/apolo/incorporador/documentos-do-portal";
import { foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
import { comIdsDoGrupo } from "@/lib/apolo/incorporador/resumo-do-produto";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { diarioDaProposta } from "@/lib/assinatura/diario-do-envelope-db";
import { type EnvelopeDaProposta, envelopeQueSegura } from "@/lib/assinatura/envio-db";
import type { EstadoDaAssinatura } from "@/lib/assinatura/tipos";
import { rotuloDoEstado } from "@/lib/assinatura/traduzir";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import { concluirCancelamentoDoCard } from "@/lib/hercules/concluir-cancelamento-server";
import { ehIdDoPai, expandirIdDoPainel } from "@/lib/hercules/expandir-id-do-painel";
import {
  type EventoDaUnidade,
  type EventoImportado,
  historicoDaUnidade,
  type MovimentoDoHistorico,
  type PropostaDoHistorico,
} from "@/lib/hercules/historico-da-unidade";
import { devolverVendaNoIndeferimento } from "@/lib/hercules/indeferimento-na-venda-server";

import {
  alcanceParaEscrever,
  alcanceParaEscreverNosEmpreendimentos,
  respostaDoAlcance,
} from "./alcance-da-estrutura";
import { analiseDoTrabalho } from "./analise-do-trabalho";
import {
  type AtorDaTemis,
  type AtorDoPortal,
  enterpriseNoAlcance,
  idDoAutor,
  nomeDoAutor,
  operadoPorDoAtor,
  trabalhoNoAlcance,
} from "./ator";
import { registrarAtoDoPortal } from "./autoria-dos-modelos";
import { contratosDaProposta } from "./contrato-guardado-db";
import {
  type CardDoHistorico,
  historicoDeEtapas,
  type PassagemGravada,
} from "./historico-de-etapas";
import { conferirIndeferimento } from "./indeferimento";
import { registrarPassagemDeEtapa } from "./passagem-de-etapa-db";
import { retornarParaAnalise } from "./retorno-para-correcao";
import { ehTabelaAusente } from "./tabela-ausente";
import { ATIVIDADES, ESTAGIOS, NOME_DO_TIPO, type TipoDeTrabalho } from "./trabalhos";
import {
  type CanalDoTrabalho,
  type OperadoPorDoBoard,
  abrirTrabalho,
  donoDoTrabalho,
  ehColunaDoDonoAusente,
  marcarAtividade,
  trabalhosDoBoard,
} from "./trabalhos-db";

const WORKSPACE = "careli";
type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// ── O ATOR E O RECORTE (PURO) ───────────────────────────────────────────────

/**
 * O ator do hub. ⚠️ MORA EM `ator.ts` (arrumação da onda 3): as rotas do contrato e da assinatura
 * montavam o mesmo objeto à mão, cada uma. Reexportado daqui para as rotas que já o importavam.
 */
export { atorDoHub } from "./ator";

/**
 * Os empreendimentos a que a LEITURA deste ator se restringe. `null` = sem recorte (o hub).
 *
 * ⚠️ LISTA VAZIA NÃO É "SEM RECORTE". Para o portal, nenhum empreendimento quer dizer nada a
 * mostrar — e quem recebe `[]` responde vazio ou 404, nunca "tudo".
 */
export function recorteDeEmpreendimentos(ator: AtorDaTemis): null | string[] {
  if (ator.tipo === "hub") return null;
  const ids = ator.enterpriseIds
    .map((id) => (typeof id === "string" ? id.trim() : ""))
    .filter(Boolean);
  return [...new Set(ids)];
}

export type FiltroDoBoard = {
  comAssinaturas: true;
  enterpriseId?: string;
  enterpriseIds?: string[];
  operadoPor: OperadoPorDoBoard;
};

/**
 * O filtro de `trabalhosDoBoard` que este ator pode pedir. `null` = fora do alcance (404).
 *
 * Hub: exatamente o de antes — um empreendimento por vez (`?empreendimento=`) e o dono padrão
 * `careli`; `?incluir=incorporadores` é a supervisão (decisão do Lucas, 16/09/2026, na fundação).
 *
 * Portal: SÓ os trabalhos do próprio incorporador (`operado_por = incorporadorId`), dentro dos
 * empreendimentos da sessão. ⚠️ O PARÂMETRO SÓ REDUZ: `?empreendimento=` fora da lista é 404, e
 * `?incluir=` é ignorado — o portal nunca vê o trabalho da Careli (nulo) nem o de outro
 * incorporador, nem pedindo.
 *
 * `expandidos` são os ids reais de um "pai:<uuid>" do painel (ver `idsDoPaiNoPortal`). Mesmo assim
 * cada um passa de novo por `enterpriseNoAlcance`: quem expandiu já recortou, e a regra de que o
 * parâmetro só reduz não pode depender de quem chamou ter feito certo.
 */
export function filtroDoBoard(
  ator: AtorDaTemis,
  pedido: { empreendimento?: string; expandidos?: string[]; incluir?: string },
): FiltroDoBoard | null {
  const empreendimento = pedido.empreendimento?.trim() || undefined;

  if (ator.tipo === "hub") {
    return {
      comAssinaturas: true,
      enterpriseId: empreendimento,
      operadoPor: pedido.incluir?.trim() === "incorporadores" ? "todos" : "careli",
    };
  }

  if (pedido.expandidos) {
    const ids = [...new Set(pedido.expandidos.map((id) => String(id).trim()))].filter((id) =>
      enterpriseNoAlcance(ator, id),
    );
    if (ids.length === 0) return null;
    return { comAssinaturas: true, enterpriseIds: ids, operadoPor: ator.incorporadorId };
  }

  if (empreendimento && !enterpriseNoAlcance(ator, empreendimento)) return null;

  const enterpriseIds = empreendimento ? [empreendimento] : recorteDeEmpreendimentos(ator) ?? [];
  if (enterpriseIds.length === 0) return null;

  return { comAssinaturas: true, enterpriseIds, operadoPor: ator.incorporadorId };
}

/**
 * Os ids REAIS de um "pai:<uuid>" do painel de produtos, dentro do que a sessão do portal alcança.
 *
 * ⚠️ POR QUE EXISTE (revisão da onda 3, 16/09/2026). O filtro de produto da TelaContratos e o `emp`
 * da ficha do produto mandam o id do PAINEL: o VOC aparece debaixo do pai do cadastro do Panteon
 * (VLO), com id "pai:<uuid>". `enterpriseNoAlcance` não conhece esse formato, e o quadro operável
 * respondia 404 para um produto que É da Cecílio. É a MESMA expansão de
 * `/api/incorporador/contratos` (cadastro → `expandirIdDoPainel` dentro da lista expandida da
 * sessão → o grupo do catálogo que os ids cobrem por inteiro), e ela só reduz.
 *
 * Cadastro fora do ar é 503, e não 404: sem cadastro não dá para provar que o pai é dele.
 */
export async function idsDoPaiNoPortal(
  ator: AtorDoPortal,
  pedido: string,
): Promise<{ ids: string[]; ok: true } | { ok: false; response: NextResponse }> {
  let cadastro: Awaited<ReturnType<typeof carregarCadastroDeEmpreendimentos>>;
  try {
    cadastro = await carregarCadastroDeEmpreendimentos();
  } catch (erro) {
    console.error("[temis][portal] falha ao carregar o cadastro para expandir o pai", erro);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Não foi possível carregar os empreendimentos agora." },
        { status: 503 },
      ),
    };
  }

  const permitidos = new Set(recorteDeEmpreendimentos(ator) ?? []);
  const idsReais = expandirIdDoPainel(pedido, cadastro, permitidos);
  if (idsReais.length === 0) return { ids: [], ok: true };

  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  return { ids: comIdsDoGrupo(idsReais, catalogo, permitidos), ok: true };
}

/**
 * Por onde este ator pode dizer que a solicitação veio.
 *
 * ⚠️ O PORTAL NÃO ABRE PELO CANAL `iris`. A Iris é o atendimento da Careli: o ticket e a evidência
 * que o canal exige são de lá, e o portal não tem nem um nem outro. Aceitar o canal deixaria um
 * card do incorporador apontando para o ticket de um cliente qualquer da Careli.
 */
export function canaisDoAtor(ator: AtorDaTemis): CanalDoTrabalho[] {
  return ator.tipo === "hub" ? ["coordenador", "hercules", "iris"] : ["coordenador", "hercules"];
}

// ── AS CONFERÊNCIAS DE ALCANCE (ANTES DE LER) ───────────────────────────────

/**
 * O trabalho está no alcance deste ator? Roda ANTES de ler o card.
 *
 * ⚠️ PARA O HUB NÃO HÁ CONSULTA: `trabalhoNoAlcance` já responde `true` sem olhar a linha, e
 * perguntar ao banco só mudaria a resposta de "trabalho não encontrado" (a frase do hub) para
 * "não encontrado". Para o portal, `donoDoTrabalho` nulo (não existe, id torto, leitura falhou) é
 * 404 igual ao de fora do escopo.
 */
export async function trabalhoAlcancavel(ator: AtorDaTemis, id: string): Promise<boolean> {
  if (ator.tipo === "hub") return true;
  const dono = await donoDoTrabalho(id);
  return dono !== null && trabalhoNoAlcance(ator, dono);
}

/**
 * A PROPOSTA está no alcance deste ator? Roda ANTES de ler conversa, documentos ou histórico dela.
 *
 * ⚠️ A PROPOSTA NÃO TEM DONO; O TRABALHO TEM. Quem responde é `temis_trabalhos`: a proposta é do
 * portal quando ALGUM trabalho dela é do incorporador e está no escopo. Uma proposta pode ter dois
 * cards (a venda e o pedido de cancelamento, medido em 10/09/2026 na do Henrique), e basta um ser
 * dele para a coluna fixa daquele card abrir.
 *
 * ⚠️ O FILTRO DO DONO VAI NA CONSULTA, E NÃO SÓ NA CONFERÊNCIA. Com ele, o `limit` não tem como
 * esconder a linha que autoriza atrás de linhas da Careli.
 *
 * ⚠️ FALHA FECHADA: 0172 pendente (sem a coluna, nada é do portal), id que não é uuid (`22P02`) e
 * erro de leitura respondem "não".
 */
export async function propostaAlcancavel(
  ator: AtorDaTemis,
  sb: SupabaseClient,
  propostaId: string,
): Promise<boolean> {
  if (ator.tipo === "hub") return true;
  return (await cardsDoPortalNaProposta(ator, sb, propostaId)).length > 0;
}

/** Os cards da proposta que são deste incorporador E estão no escopo da sessão. Falha = nenhum. */
async function cardsDoPortalNaProposta(
  ator: AtorDoPortal,
  sb: SupabaseClient,
  propostaId: string,
): Promise<Array<{ enterprise_id: unknown; operado_por: unknown }>> {
  const alvo = propostaId.trim();
  if (!alvo) return [];

  const { data, error } = await sb
    .from("temis_trabalhos")
    .select("enterprise_id, operado_por")
    .eq("workspace_id", WORKSPACE)
    .eq("proposta_id", alvo)
    .eq("operado_por", ator.incorporadorId)
    .limit(50);

  if (error) {
    const codigo = (error as { code?: unknown }).code;
    if (!ehColunaDoDonoAusente(error) && codigo !== "22P02") {
      console.error("[temis][portal] falha ao conferir o dono da proposta", error);
    }
    return [];
  }

  return ((data ?? []) as Array<{ enterprise_id: unknown; operado_por: unknown }>).filter((linha) =>
    trabalhoNoAlcance(ator, linha),
  );
}

/**
 * O trabalho pode receber ESCRITA deste ator (marcar atividade, indeferir, voltar para análise)?
 * `null` = pode seguir. Roda ANTES de ler o card.
 *
 * Hub: sempre, sem consulta. Portal: o card precisa estar no alcance (`trabalhoNoAlcance`, senão
 * 404) e o produto dele precisa ser operado pelo portal (`alcanceParaEscrever`, senão 403 só
 * consulta, ou 503 sem conseguir conferir).
 */
export async function recusaDoTrabalhoParaEscrever(
  ator: AtorDaTemis,
  id: string,
): Promise<NextResponse | null> {
  if (ator.tipo === "hub") return null;

  const dono = await donoDoTrabalho(id);
  if (dono === null || !trabalhoNoAlcance(ator, dono)) return foraDoEscopo();

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });

  return respostaDoAlcance(await alcanceParaEscrever(admin, ator, dono.enterprise_id));
}

/**
 * A PROPOSTA pode receber ESCRITA deste ator (a nota na conversa)? `null` = pode seguir.
 *
 * Portal: algum card dela é dele e está no escopo (a mesma régua de `propostaAlcancavel`, senão
 * 404), e o produto de CADA card dele passa pela régua de quem opera (senão 403 só consulta).
 */
export async function recusaDaPropostaParaEscrever(
  ator: AtorDaTemis,
  sb: SupabaseClient,
  propostaId: string,
): Promise<NextResponse | null> {
  if (ator.tipo === "hub") return null;

  const cards = await cardsDoPortalNaProposta(ator, sb, propostaId);
  if (cards.length === 0) return foraDoEscopo();

  return respostaDoAlcance(
    await alcanceParaEscreverNosEmpreendimentos(
      sb,
      ator,
      cards.map((card) => card.enterprise_id),
    ),
  );
}

// O registro de QUEM, VINDO DE ONDE, fez um ato de escrita pelo portal é `registrarAtoDoPortal`, a
// função única da Têmis (`autoria-dos-modelos.ts`). As tabelas que este grupo grava não têm coluna
// de origem (`temis_trabalho_etapas.quem`, `temis_trabalhos.indeferido_por`,
// `hercules_conversas.autor`); o id gravado já distingue, e a linha de log deixa a ORIGEM escrita.

// ── GET /trabalhos ──────────────────────────────────────────────────────────

/**
 * OS TRABALHOS DO BOARD — e o catálogo junto.
 *
 * ⚠️ O CATÁLOGO VIAJA JUNTO COM OS CARDS. A tela precisa das atividades e dos prazos de cada tipo
 * para desenhar o checklist, e duplicar essa lista no cliente faria as duas divergirem no dia em que
 * alguém acrescentasse uma atividade — a tela mostraria quatro itens e o servidor exigiria cinco
 * para o card andar.
 *
 * ⚠️ `comAssinaturas` É O QUE PÕE O "1/5" NO CARD (Lucas, 12/09/2026: *"no card, gostaria de ter
 * essa visão de quantas assinaturas já foram feitas, tipo 1/5"*). O portal que confecciona pede
 * também: é a mesma tela, e quem manda o contrato para assinatura lá é o time dele. A aba Contratos
 * do portal comercial (`/api/incorporador/contratos`) continua sem pedir.
 */
export async function listarTrabalhosDoBoard(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const url = new URL(request.url);
  const empreendimento = url.searchParams.get("empreendimento") ?? undefined;

  // O filtro de produto do portal manda o id do PAINEL ("pai:<uuid>" do cadastro do Panteon), que
  // não é id de empreendimento nenhum: expande antes de recortar.
  let expandidos: string[] | undefined;
  if (ator.tipo === "portal" && ehIdDoPai(empreendimento)) {
    const idsDoPai = await idsDoPaiNoPortal(ator, String(empreendimento));
    if (!idsDoPai.ok) return idsDoPai.response;
    expandidos = idsDoPai.ids;
  }

  const filtro = filtroDoBoard(ator, {
    empreendimento,
    expandidos,
    incluir: url.searchParams.get("incluir") ?? undefined,
  });
  if (!filtro) return foraDoEscopo();

  const trabalhos = await trabalhosDoBoard(filtro);

  return NextResponse.json(
    { data: { atividades: ATIVIDADES, estagios: ESTAGIOS, nomes: NOME_DO_TIPO, trabalhos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── POST /trabalhos ─────────────────────────────────────────────────────────

type CorpoDosTrabalhos = {
  acao?: unknown;
  atividade?: unknown;
  canal?: unknown;
  clienteCpf?: unknown;
  clienteNome?: unknown;
  empreendimentoCodigo?: unknown;
  empreendimentoId?: unknown;
  empreendimentoNome?: unknown;
  evidenciaPath?: unknown;
  feita?: unknown;
  id?: unknown;
  irisTicketId?: unknown;
  observacao?: unknown;
  tipo?: unknown;
  trabalhoOrigemId?: unknown;
  unidade?: unknown;
};

const TIPOS: TipoDeTrabalho[] = [
  "cancelamento",
  "cancelamento_correcao",
  "cessao",
  "contrato",
  "distrato",
];

/**
 * MARCAR UMA ATIVIDADE ou ABRIR UMA SOLICITAÇÃO.
 *
 * ⚠️ NO PORTAL, A ABERTURA É DE QUALQUER CONTA DO PORTAL QUE CONFECCIONA (decisão do Lucas,
 * 16/09/2026: o time inteiro da Cecílio opera). O card nasce com `operado_por` do incorporador
 * (`operadoPorDoAtor`), então cai na fila dele e sai da da Careli; o do hub nasce nulo, como sempre.
 *
 * ⚠️ `aberto_por` VAI PREENCHIDO NOS DOIS (`idDoAutor`). A coluna existe desde a 0120 e ninguém a
 * preenchia (a nota de `NovoTrabalho.abertoPor`); esta rota não tem tela chamando no hub hoje.
 */
export async function agirNosTrabalhos(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  let corpo: CorpoDosTrabalhos;
  try {
    corpo = (await request.json()) as CorpoDosTrabalhos;
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  // ── MARCAR UMA ATIVIDADE ───────────────────────────────────────────────────
  //
  // ⚠️ É AQUI QUE O CARD ANDA SOZINHO: a camada de dados avança o estágio quando a última atividade
  // do estágio é marcada, na mesma chamada.
  if (String(corpo.acao ?? "") === "atividade") {
    const id = String(corpo.id ?? "").trim();
    const atividade = String(corpo.atividade ?? "").trim();
    if (!id || !atividade) {
      return NextResponse.json({ error: "informe o trabalho e a atividade" }, { status: 400 });
    }
    // Marcar faz o card andar: é escrita, e no portal só no produto que ele opera.
    const recusaDoCard = await recusaDoTrabalhoParaEscrever(ator, id);
    if (recusaDoCard) return recusaDoCard;

    const r = await marcarAtividade({
      atividade,
      feita: corpo.feita === true,
      id,
      quem: idDoAutor(ator),
      quemNome: nomeDoAutor(ator),
    });
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
    registrarAtoDoPortal(ator, "atividade marcada", { atividade, trabalhoId: id });
    return NextResponse.json({ andou: r.andou, estagio: r.estagio, ok: true });
  }

  // ── ABRIR UMA SOLICITAÇÃO ──────────────────────────────────────────────────
  const tipo = String(corpo.tipo ?? "") as TipoDeTrabalho;
  if (!TIPOS.includes(tipo)) {
    return NextResponse.json({ error: `tipo desconhecido: ${String(corpo.tipo)}` }, { status: 400 });
  }

  const canal = String(corpo.canal ?? "") as CanalDoTrabalho;
  if (!canaisDoAtor(ator).includes(canal)) {
    return NextResponse.json({ error: "informe de onde veio a solicitação" }, { status: 400 });
  }

  const clienteNome = String(corpo.clienteNome ?? "").trim();
  const unidade = String(corpo.unidade ?? "").trim();
  const empreendimentoId = String(corpo.empreendimentoId ?? "").trim();
  if (!clienteNome || !unidade || !empreendimentoId) {
    return NextResponse.json(
      { error: "empreendimento, unidade e cliente são obrigatórios" },
      { status: 400 },
    );
  }

  // ⚠️ A CORREÇÃO NASCE LIGADA A UM CONTRATO, e sem ele ninguém sabe o que está sendo corrigido.
  const trabalhoOrigemId = String(corpo.trabalhoOrigemId ?? "").trim() || null;
  if (tipo === "cancelamento_correcao" && !trabalhoOrigemId) {
    return NextResponse.json(
      { error: "o cancelamento por correção precisa apontar o contrato que está sendo corrigido" },
      { status: 400 },
    );
  }

  // ⚠️ OS DOIS IDS DO CORPO PASSAM PELO ALCANCE ANTES DO INSERT: o empreendimento (o card nasceria
  // num produto de outro dono) e o contrato de origem (o card apontaria para o trabalho da Careli
  // ou de outro incorporador, e a tela o abriria pelo elo).
  if (!enterpriseNoAlcance(ator, empreendimentoId)) return foraDoEscopo();
  if (trabalhoOrigemId && !(await trabalhoAlcancavel(ator, trabalhoOrigemId))) {
    return foraDoEscopo();
  }

  // ⚠️ E O CARD SÓ NASCE EM PRODUTO QUE O PORTAL OPERA (decisão do Lucas, 16/09/2026). O VOC está no
  // escopo da Cecílio e é da Careli: abrir solicitação nele é escrita num produto só consulta.
  if (ator.tipo === "portal") {
    const admin = createApoloAdminClient();
    if (!admin) return NextResponse.json({ error: "Não foi possível abrir agora." }, { status: 503 });
    const recusaDoProduto = respostaDoAlcance(
      await alcanceParaEscrever(admin, ator, empreendimentoId),
    );
    if (recusaDoProduto) return recusaDoProduto;
  }

  // ⚠️ O TICKET E A EVIDÊNCIA SÃO DA IRIS, e o portal não abre pelo canal dela (`canaisDoAtor`). Sem
  // descartar aqui, os dois campos entravam do corpo mesmo assim e o card do incorporador apontaria
  // para o ticket e o arquivo de um cliente qualquer da Careli.
  const doAtendimento = ator.tipo === "hub";

  // ⚠️ SEM A 0172, O CARD DO PORTAL NÃO NASCE (revisão da onda 3, 16/09/2026). `abrirTrabalho` só
  // grava sem dono quando quem chama pede, e a abertura livre não pede: cairia calada na fila da
  // Careli, e o portal não a abriria mais.
  const r = await abrirTrabalho({
    abertoPor: idDoAutor(ator),
    canal,
    clienteCpf: String(corpo.clienteCpf ?? "").replace(/\D/g, "") || null,
    clienteNome,
    empreendimentoCodigo: String(corpo.empreendimentoCodigo ?? "").trim(),
    empreendimentoId,
    empreendimentoNome: String(corpo.empreendimentoNome ?? "").trim(),
    evidenciaPath: doAtendimento ? String(corpo.evidenciaPath ?? "").trim() || null : null,
    irisTicketId: doAtendimento ? String(corpo.irisTicketId ?? "").trim() || null : null,
    observacao: String(corpo.observacao ?? "").trim() || null,
    operadoPor: operadoPorDoAtor(ator),
    tipo,
    trabalhoOrigemId,
    unidade,
  });

  if (!r.ok && r.colunaDoDonoAusente) {
    return NextResponse.json({ error: "Não foi possível abrir agora." }, { status: 503 });
  }
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 400 });
  registrarAtoDoPortal(ator, "trabalho aberto", {
    enterpriseId: empreendimentoId,
    tipo,
    trabalhoId: r.id,
  });
  return NextResponse.json({ id: r.id, ok: true });
}

// ── GET /board ──────────────────────────────────────────────────────────────

type Contagem = {
  minutasPublicadas: number;
  minutasRascunho: number;
  planosAtivos: number;
  planosSemMinuta: number;
};

const TAMANHO_DA_PAGINA = 1000;
/** 50 páginas = 50 mil linhas. Passar disso é sinal de defeito, e o board falha fechado. */
const MAXIMO_DE_PAGINAS = 50;

type PaginaLida<T> = { data: null | T[]; error: null | { message: string } };

/**
 * Lê TODAS as linhas, de mil em mil.
 *
 * ⚠️ O `.limit(5000)` DE ANTES NÃO ENTREGAVA 5000: o PostgREST corta cada resposta em 1.000 linhas
 * (`max-rows`), calado. Passando de mil planos, o board contaria só os primeiros mil e pintaria
 * empreendimento com minuta como "sem minuta". Hoje são poucas centenas e o resultado é o mesmo; a
 * paginação é o que impede o corte silencioso de chegar.
 */
async function lerEmPaginas<T>(
  pagina: (de: number, ate: number) => PromiseLike<PaginaLida<T>>,
): Promise<PaginaLida<T>> {
  const linhas: T[] = [];
  for (let n = 0; n < MAXIMO_DE_PAGINAS; n += 1) {
    const de = n * TAMANHO_DA_PAGINA;
    const { data, error } = await pagina(de, de + TAMANHO_DA_PAGINA - 1);
    if (error) return { data: null, error };
    const lote = data ?? [];
    linhas.push(...lote);
    if (lote.length < TAMANHO_DA_PAGINA) return { data: linhas, error: null };
  }
  return { data: null, error: { message: "mais linhas que o teto de páginas do board" } };
}

type LinhaDePlano = { ativo: boolean | null; enterprise_id: string; minuta_id: null | string };
type LinhaDeMinuta = { enterprise_id: string; situacao: null | string };

/**
 * O BOARD DA TÊMIS — o que cada empreendimento consegue contratar hoje.
 *
 * Uma chamada devolve a contagem de TODOS os empreendimentos (do alcance). Fazer uma consulta por
 * empreendimento seriam 35 requisições para desenhar uma tela de resumo.
 *
 * ⚠️ A PERGUNTA QUE O BOARD RESPONDE É "O QUE TRAVA", e não "quantos planos existem". Um
 * empreendimento com dez planos e nenhuma minuta publicada não vende: a venda acontece e o contrato
 * não sai. Por isso o número que aparece em destaque é o de planos ATIVOS SEM MINUTA.
 *
 * ⚠️ MINUTA E PLANO SÃO DO PRODUTO, NÃO DO DONO DO TRABALHO. Careli e Cecílio dividem os modelos do
 * produto; o que o portal recorta aqui é só o EMPREENDIMENTO (as três leituras levam o `in` da
 * sessão, e a contagem de outro produto nem sai do banco).
 */
export async function contarOBoard(ator: AtorDaTemis): Promise<NextResponse> {
  const recorte = recorteDeEmpreendimentos(ator);
  if (recorte && recorte.length === 0) return foraDoEscopo();

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const [planosRes, minutasRes, recepcaoRes] = await Promise.all([
    lerEmPaginas<LinhaDePlano>((de, ate) => {
      let consulta = admin
        .from("temis_planos")
        .select("enterprise_id, ativo, minuta_id")
        .eq("workspace_id", WORKSPACE);
      if (recorte) consulta = consulta.in("enterprise_id", recorte);
      return consulta.order("id", { ascending: true }).range(de, ate);
    }),
    lerEmPaginas<LinhaDeMinuta>((de, ate) => {
      let consulta = admin
        .from("temis_minutas")
        .select("enterprise_id, situacao")
        .eq("workspace_id", WORKSPACE);
      if (recorte) consulta = consulta.in("enterprise_id", recorte);
      return consulta.order("id", { ascending: true }).range(de, ate);
    }),
    // ⚠️ SÓ OS EMPREENDIMENTOS QUE RECEBEM CAD. Regra do Lucas (02/09/2026): *"os empreendimentos
    // que vamos ter ali no setup será habilitados para aqueles que temos recepção de cad ativo, o
    // resto não precisa mostrar"*. São 11 dos 27 — os outros dezesseis apareciam como "nada
    // cadastrado" e empurravam para baixo justamente os que precisam de atenção. Lista longa de
    // pendência falsa é o mesmo que lista nenhuma.
    (() => {
      let consulta = admin
        .from("apolo_enterprise_settings")
        .select("enterprise_id")
        .eq("workspace_id", WORKSPACE)
        .eq("recepcao_cad", true);
      if (recorte) consulta = consulta.in("enterprise_id", recorte);
      return consulta.limit(500);
    })(),
  ]);

  // ⚠️ FALHA FECHADA. Devolver contagem zerada num erro de leitura pintaria TODOS os
  // empreendimentos como "nada cadastrado" — e alguém cadastraria tudo de novo por cima.
  if (planosRes.error || minutasRes.error || recepcaoRes.error) {
    return NextResponse.json({ error: "Não consegui montar o board." }, { status: 502 });
  }

  // ⚠️ FALHA FECHADA TAMBÉM AQUI: sem recorte, lista vazia significaria "nenhum empreendimento
  // recebe CAD", e a tela abriria sem nada. Se a leitura inteira não trouxe nenhum, é sinal de
  // problema, não de configuração. ⚠️ COM RECORTE (o portal) O VAZIO É REAL: os produtos do
  // incorporador podem simplesmente não estar recebendo CAD, e isso não é defeito de leitura.
  const recebemCad = new Set(
    (recepcaoRes.data ?? [])
      .map((r) => String((r as { enterprise_id: unknown }).enterprise_id))
      .filter((id) => enterpriseNoAlcance(ator, id)),
  );
  if (!recorte && recebemCad.size === 0) {
    return NextResponse.json(
      { error: "Não consegui ler quais empreendimentos recebem CAD." },
      { status: 502 },
    );
  }

  const porEmpreendimento = new Map<string, Contagem>();
  const garantir = (id: string): Contagem => {
    const atual = porEmpreendimento.get(id);
    if (atual) return atual;
    const novo: Contagem = {
      minutasPublicadas: 0,
      minutasRascunho: 0,
      planosAtivos: 0,
      planosSemMinuta: 0,
    };
    porEmpreendimento.set(id, novo);
    return novo;
  };

  // ⚠️ `enterpriseNoAlcance` DE NOVO, EM MEMÓRIA: o `in` da consulta é o recorte; esta é a rede
  // para o dia em que alguém mexer na consulta e esquecer o filtro. Para o hub é sempre `true`.
  for (const plano of planosRes.data ?? []) {
    if (!plano.ativo || !enterpriseNoAlcance(ator, plano.enterprise_id)) continue;
    const conta = garantir(plano.enterprise_id);
    conta.planosAtivos += 1;
    if (!plano.minuta_id) conta.planosSemMinuta += 1;
  }

  for (const minuta of minutasRes.data ?? []) {
    if (!enterpriseNoAlcance(ator, minuta.enterprise_id)) continue;
    const conta = garantir(minuta.enterprise_id);
    if (minuta.situacao === "publicada") conta.minutasPublicadas += 1;
    else if (minuta.situacao === "rascunho") conta.minutasRascunho += 1;
  }

  // ⚠️ A LISTA DE QUEM RECEBE CAD VIAJA JUNTO, e a tela filtra por ela em vez de decidir sozinha:
  // a regra de quem aparece no Setup é a mesma que o board usa para contar, e duas cópias dela
  // divergiriam no dia em que alguém habilitasse a recepção de um empreendimento novo.
  return NextResponse.json({
    data: {
      contagens: Object.fromEntries(porEmpreendimento),
      recebemCad: [...recebemCad],
    },
  });
}

// ── GET /empreendimentos ────────────────────────────────────────────────────

type LinhaDoPortao = { code: string; enterprise_id: null | string };

/**
 * OS EMPREENDIMENTOS DA TÊMIS — só os que estão recebendo CAD (e, no portal, só os da sessão).
 *
 * Lucas (07/09/2026): *"na temis, pode deixar somente os empreendimentos que estamos recebendo
 * cads"*. A FONTE É O PORTÃO, NÃO O CATÁLOGO: `apolo_enterprise_settings.recepcao_cad` já é a
 * decisão de "este produto está recebendo cadastro", e é a mesma que governa a recepção no Apolo.
 *
 * ⚠️ E ELE JÁ FALA A LÍNGUA DOS VÍNCULOS. O `enterprise_id` desta tabela é exatamente a chave com
 * que minuta, plano e categoria se amarram ao empreendimento — inclusive o `group:Lagoa Bonita`, que
 * é rótulo e não id de tabela nenhuma ([[reference_lagoa_bonita_pai_e_filhos]]).
 *
 * ⚠️ NO PORTAL, O RECORTE É O DA SESSÃO JÁ EXPANDIDA, com a assimetria do portal: quem tem só a
 * divisão NÃO recebe a linha do consolidado (`enterpriseNoAlcance`). A minuta gravada no grupo vale
 * também para as glebas de outros donos.
 */
export async function listarEmpreendimentosDaTemis(ator: AtorDaTemis): Promise<NextResponse> {
  const recorte = recorteDeEmpreendimentos(ator);

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });
  }

  // Sem nenhum empreendimento na sessão não há o que perguntar: a lista sai vazia sem consulta.
  if (recorte && recorte.length === 0) {
    return NextResponse.json({ data: { rows: [] } }, { headers: { "Cache-Control": "no-store" } });
  }

  let consulta = admin
    .from("apolo_enterprise_settings")
    .select("enterprise_id,code")
    .eq("workspace_id", WORKSPACE)
    .eq("recepcao_cad", true);
  if (recorte) consulta = consulta.in("enterprise_id", recorte);

  const { data, error } = await consulta.returns<LinhaDoPortao[]>();

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
    .filter((l): l is LinhaDoPortao & { enterprise_id: string } => Boolean(l.enterprise_id))
    // A rede em memória, igual à do board: o `in` recorta, esta linha garante.
    .filter((l) => enterpriseNoAlcance(ator, l.enterprise_id))
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

// ── GET /trabalho ───────────────────────────────────────────────────────────

/**
 * A TELA DE TRABALHO DE UM CARD — o que abre quando o operador clica no quadro.
 *
 * Lucas (09/09/2026): *"ao clicar no card abrisse uma tela de trabalho. primeiro, na primeira
 * etapa, acho que deveria trazer os dados dos proponentes, imobiliaria, a proposta"*.
 *
 * `podeEmitir` é da PORTA, e por isso chega pronto: no hub é o recorte da coordenação
 * (`autorizarEmissaoDeContrato`), no portal é "sim" (o time inteiro opera). Ele é preguiçoso de
 * propósito: só roda depois de o card ter sido lido, na mesma ordem de antes.
 */
export async function abrirCardDoTrabalho(
  ator: AtorDaTemis,
  request: Request,
  opcoes: { podeEmitir: () => Promise<boolean> },
): Promise<NextResponse> {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Informe o trabalho." }, { status: 400 });
  }

  if (!(await trabalhoAlcancavel(ator, id))) return foraDoEscopo();

  const sb = createApoloAdminClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { data: card, error } = await sb
    .from("temis_trabalhos")
    .select(
      // ⚠️ OS NOMES SÃO `enterprise_*` E `cliente_cpf`, conferidos no schema. A primeira versão
      // pediu `empreendimento_codigo`, `empreendimento_nome` e `cliente_documento` — nomes que não
      // existem —, e o PostgREST devolveu erro para a linha inteira: a tela abria dizendo "Nao foi
      // possivel abrir" sem dizer por quê. O `select` é string, então o typecheck não alcança;
      // quem confere é o schema.
      // ⚠️ `observacao` É O PEDIDO INTEIRO, e faltava. Num cancelamento ela guarda o motivo, o
      // COD do contrato, o que o sistema apurou sobre assinatura e pagamento e a classificação
      // que decidiu entre cancelamento e distrato. Lucas (10/09/2026): *"faltou o motivo do
      // cancelamento e eu preciso saber o que é"*.
      "id, tipo, estagio, estagio_desde, proposta_id, cliente_nome, cliente_cpf, unidade, enterprise_codigo, enterprise_nome, indeferido_em, indeferido_motivo, indeferido_observacao, indeferido_por_nome, arrependimento_inicio, observacao",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[temis][trabalho] falha ao ler o card", error);
    // ⚠️ A MENSAGEM DO BANCO VAI JUNTO SÓ PARA O HUB. Lá a rota é interna, e uma frase muda como
    // "Nao foi possivel abrir" custou uma investigação inteira (o erro real era nome de coluna
    // errado). Para quem vem de fora, o texto do Postgres é detalhe de schema da casa: a frase é
    // a mesma sem ele, e o log acima guarda o motivo.
    return NextResponse.json(
      {
        error:
          ator.tipo === "hub"
            ? `Não foi possível abrir: ${error.message}`
            : "Não foi possível abrir o trabalho.",
      },
      { status: 503 },
    );
  }
  if (!card) return NextResponse.json({ error: "Trabalho nao encontrado." }, { status: 404 });

  // ⚠️ CARD SEM PROPOSTA NÃO É ERRO. Os quatro cards antigos (Garden e Lavra) nasceram antes da
  // migration 0134 e têm `proposta_id` nulo: a tela abre com o cabeçalho e diz que não há venda
  // ligada. A análise, os contratos e o diário vão juntos: a etapa 1 usa a primeira, a etapa 2 a
  // segunda, a etapa 3 o terceiro, e a tela troca de painel sem ir buscar de novo.
  //
  // ⚠️ O CAMPO SE CHAMA `assinatura`, E NÃO `diario`: o que sai daqui é o objeto INTEIRO de
  // `diarioDaProposta` — `assinaram`, `total`, `envelope` e, dentro dele, a lista `diario`.
  const [analise, contratos, assinatura, envelopeVivo] = card.proposta_id
    ? await Promise.all([
        analiseDoTrabalho(sb, String(card.proposta_id)).catch((e: unknown) => {
          console.error("[temis][trabalho] falha ao montar a analise", e);
          return null;
        }),
        contratosDaProposta(sb, String(card.proposta_id)).catch((e: unknown) => {
          console.error("[temis][trabalho] falha ao ler os contratos", e);
          return [];
        }),
        // ⚠️ O DIÁRIO (Lucas, 12/09/2026: *"na tela de assinatura ... seria legal ter um painel de
        // log, tipo, contrato enviado, contrato não enviado - e-mail inválido"*) E O ENVELOPE VIVO
        // TÊM O MESMO PORTÃO POR TIPO, e pela mesma razão: `temis_envelopes` casa por
        // `proposta_id` e não tem `trabalho_id`, então o card de cancelamento leria o diário e o
        // envelope DA VENDA — e a tela avisaria de um cancelamento que a volta dele não faz. O
        // `catch` é a rede do inesperado: um erro solto derrubaria o GET inteiro por um painel.
        String(card.tipo).trim() === "contrato"
          ? diarioDaProposta(sb, String(card.proposta_id)).catch((e: unknown) => {
              console.error("[temis][trabalho] falha ao montar o diário do envelope", e);
              return null;
            })
          : Promise.resolve(null),
        String(card.tipo).trim() === "contrato"
          ? envelopeVivoDaProposta(sb, String(card.proposta_id))
          : Promise.resolve(null),
      ])
    : [null, [], null, null];

  // ⚠️ SEM ISTO, O PAINEL DE ASSINATURA NASCE MOSTRANDO ERRO PARA QUEM SÓ LÊ. Aqui só se decide o
  // que a tela pode oferecer; quem fecha a porta continua sendo cada rota de escrita. O molde é
  // `/api/temis/contrato/previa`, que já faz exatamente isto.
  const podeEmitir = await opcoes.podeEmitir();

  // ⚠️ SÓ NO PEDIDO DE CANCELAMENTO OU DISTRATO: é o que acende a RETOMADA na tela (o card concluído
  // com o lote ainda preso, ou com a venda viva). Falha de leitura = `null`, e a tela não oferece.
  const tipoDoCard = String(card.tipo).trim();
  const situacaoDoPedido =
    card.proposta_id && (tipoDoCard === "cancelamento" || tipoDoCard === "distrato")
      ? await lerSituacaoDoPedido(sb, String(card.proposta_id))
      : null;

  return NextResponse.json(
    {
      data: {
        analise,
        assinatura,
        card: { ...card, contratos },
        envelopeVivo,
        podeEmitir,
        situacaoDoPedido,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * A venda do pedido caiu? O lote dela está livre no cadastro? É o que decide se o card concluído
 * ainda oferece "Tentar liberar a unidade".
 */
async function lerSituacaoDoPedido(
  sb: SupabaseClient,
  propostaId: string,
): Promise<null | { unidadeLivre: boolean; vendaDesfeita: boolean }> {
  const { data: venda, error } = await sb
    .from("hercules_propostas")
    .select("etapa, unidade_id")
    .eq("id", propostaId)
    .maybeSingle<{ etapa: null | string; unidade_id: null | string }>();
  if (error || !venda) return null;
  const etapa = String(venda.etapa ?? "").trim();
  const vendaDesfeita = etapa === "cancelado" || etapa === "distrato";
  if (!venda.unidade_id) return { unidadeLivre: true, vendaDesfeita };
  const [unidade, reservasVivas, propostasVivas] = await Promise.all([
    sb.from("hercules_unidades").select("situacao").eq("id", venda.unidade_id).maybeSingle<{ situacao: null | string }>(),
    sb
      .from("hercules_reservas")
      .select("id")
      .eq("unidade_id", venda.unidade_id)
      .in("situacao", ["ativa", "proposta"])
      .limit(1),
    sb
      .from("hercules_propostas")
      .select("id")
      .eq("unidade_id", venda.unidade_id)
      .neq("id", propostaId)
      .in("etapa", ["reservado", "proposta", "contrato", "assinatura", "faturado"])
      .limit(1),
  ]);
  if (unidade.error || !unidade.data || reservasVivas.error || propostasVivas.error) return null;
  // ⚠️ LOTE QUE JÁ TEM DONO NOVO NÃO É "PRESO" (revisão de 18/09/2026): o lote foi revendido, e
  // oferecer "Tentar liberar a unidade" ali convidaria alguém a mexer na venda nova. Conta como livre
  // para a tela, que então não oferece a retomada.
  const temDonoNovo = (reservasVivas.data ?? []).length > 0 || (propostasVivas.data ?? []).length > 0;
  return {
    unidadeLivre: temDonoNovo || String(unidade.data.situacao ?? "") === "disponivel",
    vendaDesfeita,
  };
}

/**
 * O ENVELOPE VIVO DESTA VENDA, como a tela precisa dele.
 *
 * ⚠️ ELE EXISTE PARA A TELA PARAR DE ADIVINHAR PELO NOME DA ETAPA. Até 12/09/2026 a confirmação de
 * "voltar para análise" escolhia a frase por `estagio !== "contrato"`, e o servidor cancelava o
 * envelope SEM olhar estágio nenhum (`lib/temis/retorno-para-correcao.ts`). Quando o envio falha no
 * passo `notificar`, a linha fica com `envelope_id` e estado `aguardando` e o card NÃO é movido —
 * ele fica em "Contrato" com um envelope ATIVO na conta de PRODUÇÃO.
 *
 * ⚠️ A RÉGUA É `envelopeQueSegura`, A MESMA DO SERVIDOR — e é o ponto inteiro: uma segunda escrita
 * aqui voltaria a divergir no dia em que um estado mudasse de lado.
 *
 * ⚠️ LEITURA QUE FALHA NÃO VIRA `null`: `null` quer dizer "não há envelope vivo", e a tela
 * escreveria a frase NEUTRA. `conferido: false` diz a única coisa verdadeira ("não consegui
 * perguntar") e faz a tela avisar pelo pior caso.
 */
async function envelopeVivoDaProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<EnvelopeVivoDoCard | null> {
  const { data, error } = await sb
    .from("temis_envelopes")
    // As mesmas colunas que a guarda do envio e a volta leem — é a mesma régua.
    .select("criado_em, envelope_id, estado, falha, id, provedor")
    .eq("proposta_id", propostaId)
    .order("criado_em", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[temis][trabalho] falha ao ler o envelope da proposta", error);
    return { conferido: false, estado: "desconhecido", id: null, rotulo: "Não deu para conferir" };
  }

  const vivo = envelopeQueSegura((data ?? []) as EnvelopeDaProposta[]);
  if (!vivo) return null;

  return {
    conferido: true,
    estado: vivo.estado,
    id: vivo.envelope_id,
    rotulo: comoSeEscreveOEstado(vivo.estado),
  };
}

/** O envelope vivo da venda, do jeito que a tela de trabalho o consome. */
type EnvelopeVivoDoCard = {
  /**
   * A leitura de `temis_envelopes` deu certo?
   *
   * ⚠️ `false` NÃO É "NÃO TEM ENVELOPE", é "não deu para perguntar" — e a diferença é o aviso que
   * antecede o cancelamento de um envelope pago.
   */
  conferido: boolean;
  /** O estado CRU de `temis_envelopes` — é por ele que a tela decide qual frase mostrar. */
  estado: string;
  /**
   * O id do envelope na Clicksign.
   *
   * ⚠️ `null` É UM CASO REAL: a linha viva sem `envelope_id` quer dizer que um envio começou e o
   * Panteon nunca soube como terminou. Ela SEGURA a volta, e a tela avisa pelo pior caso.
   */
  id: null | string;
  /** O mesmo estado em palavra da casa, pronto para a tela ESCREVER. */
  rotulo: string;
};

/**
 * Os oito estados, escritos como `Record` total DE PROPÓSITO: estado novo em `EstadoDaAssinatura`
 * sem linha aqui NÃO COMPILA. O texto continua saindo de `rotuloDoEstado`; este `Record` só serve
 * para estreitar a `string` gravada no banco sem `as`.
 */
const ESTADOS_DO_ENVELOPE: Record<EstadoDaAssinatura, true> = {
  aguardando: true,
  assinado: true,
  cancelado: true,
  desconhecido: true,
  expirado: true,
  parcial: true,
  rascunho: true,
  recusado: true,
};

function ehEstadoDoEnvelope(gravado: string): gravado is EstadoDaAssinatura {
  return Object.prototype.hasOwnProperty.call(ESTADOS_DO_ENVELOPE, gravado);
}

/** O rótulo da casa para o estado gravado; valor que o código não conhece sai como ele mesmo. */
function comoSeEscreveOEstado(gravado: string): string {
  return ehEstadoDoEnvelope(gravado) ? rotuloDoEstado(gravado) : gravado;
}

// ── POST /trabalho ──────────────────────────────────────────────────────────

/** O que as duas decisões precisam saber do card antes de mexer nele. */
type CardDaDecisao = {
  estagio: string;
  id: string;
  proposta_id: null | string;
  tipo: string;
};

/**
 * AS TRÊS DECISÕES SOBRE UM CARD: `indeferir`, `voltar_para_analise` e `concluir`.
 *
 * `indeferir` — a Têmis recusa o TRABALHO e devolve a quem vendeu. ⚠️ NÃO É REPROVA DE CRÉDITO
 * (Lucas, 10/09/2026: *"credito? não tem credito na temis"*). O aviso para corretor e imobiliária
 * ainda não sai daqui: esta função GRAVA a decisão com motivo e, desde 18/09/2026, leva a decisão
 * para a venda (`devolverVendaNoIndeferimento`): pedido de cancelamento recusado limpa a marca do
 * pedido, contrato indeferido devolve a venda de `contrato` para `proposta`.
 *
 * `concluir` — só no card de cancelamento e no de distrato: desfaz a venda e devolve o lote pela
 * trava (`lib/hercules/concluir-cancelamento-server.ts`).
 *
 * `voltar_para_analise` — o contrato volta para a Análise para ser corrigido (Lucas, 11/09/2026).
 * ⚠️ ELA MEXE FORA DA CASA: confere o envelope na Clicksign e o cancela antes de mover o card. A
 * regra inteira está em `lib/temis/retorno-para-correcao.ts`; aqui só se abre a porta e se traduz o
 * desfecho. E O QUE DECIDE É O ENVELOPE, NÃO A ETAPA (Lucas, 12/09/2026).
 *
 * ⚠️ AÇÃO AUSENTE É `indeferir`, e isso é compatibilidade deliberada com a tela que manda
 * `{ id, motivo, observacao }` sem `acao`.
 *
 * ⚠️ NO PORTAL, QUALQUER CONTA DO PORTAL QUE CONFECCIONA DECIDE (o time inteiro opera, decisão do
 * Lucas de 16/09/2026); no hub a porta continua sendo a coordenação. O alcance do card é conferido
 * ANTES de qualquer leitura, e as duas decisões gravam `idDoAutor` + `nomeDoAutor`.
 *
 * ⚠️ O NOME DE QUEM CLICOU É O DO ATOR, E NÃO UMA SEGUNDA LEITURA DE `hub_users`. No hub, o ator
 * leva o `display_name` que o próprio portão já leu (`ApoloAuthResult.nome`): mesma coluna, mesma
 * linha, uma consulta a menos. Nome ausente vira `null`, nunca "Sistema".
 */
export async function decidirSobreOTrabalho(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const corpo = (await request.json().catch(() => ({}))) as {
    acao?: string;
    /** As duas declarações do distrato (`DECLARACOES_DO_DISTRATO`), só na ação `concluir`. */
    declaracoes?: unknown;
    id?: string;
    motivo?: string;
    observacao?: string;
  };

  const id = String(corpo.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Informe o trabalho." }, { status: 400 });

  const acao = String(corpo.acao ?? "").trim() || "indeferir";
  if (acao !== "indeferir" && acao !== "voltar_para_analise" && acao !== "concluir") {
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  }

  // Indeferir, voltar para análise e concluir são escrita: no portal, só no produto que ele opera.
  const recusaDoCard = await recusaDoTrabalhoParaEscrever(ator, id);
  if (recusaDoCard) return recusaDoCard;

  const sb = createApoloAdminClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const quem = idDoAutor(ator);
  const quemNome = nomeDoAutor(ator);

  // ⚠️ A VOLTA NÃO LÊ O CARD AQUI: ler, conferir o envelope, cancelar, mover e registrar é uma regra
  // inteira, com leituras próprias (`retornarParaAnalise`).
  if (acao === "voltar_para_analise") {
    const feito = await retornarParaAnalise(sb, {
      observacao: String(corpo.observacao ?? "").trim() || null,
      trabalhoId: id,
      usuarioId: quem,
      usuarioNome: quemNome,
    });

    if (!feito.ok) {
      return NextResponse.json({ error: feito.erro }, { status: feito.status });
    }

    registrarAtoDoPortal(ator, "voltou para análise", {
      envelopeCancelado: feito.envelopeCancelado,
      trabalhoId: id,
    });
    // ⚠️ A RESPOSTA DIZ O QUE ACONTECEU, não só que deu certo: `envelopeCancelado` é o que permite à
    // tela contar que o contrato saiu da mão de quem ia assinar.
    return NextResponse.json(
      { de: feito.de, envelopeCancelado: feito.envelopeCancelado, ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ⚠️ CONCLUIR O CANCELAMENTO OU O DISTRATO (18/09/2026) — a ação que faz a coisa. Lucas: *"o time
  // administrativo quando finaliza um cancelamento de contrato, a unidade nao esta voltando para
  // disponibilidade"*. Não havia botão de concluir, e o único que havia (Indeferir) RECUSAVA o
  // pedido. A regra inteira (ler, reapurar os fatos, cancelar o envelope, derrubar a venda, a
  // reserva e o card de contrato, fechar o card e devolver o lote pela trava) mora em
  // `lib/hercules/concluir-cancelamento-server.ts`; aqui só se abre a porta e se traduz o desfecho.
  if (acao === "concluir") {
    const feito = await concluirCancelamentoDoCard(sb, {
      declaracoes: corpo.declaracoes,
      trabalhoId: id,
      usuarioId: quem,
      usuarioNome: quemNome,
    });

    if (!feito.ok) {
      return NextResponse.json({ error: feito.erro }, { status: feito.status });
    }

    registrarAtoDoPortal(ator, `${feito.tipo} concluído`, {
      trabalhoId: id,
      unidadeVoltou: feito.unidade.voltou,
    });
    // ⚠️ A RESPOSTA DIZ SE O LOTE VOLTOU, E POR QUE NÃO: a tela mostra o recado inteiro, e "concluído"
    // sem dizer que a trava segurou o lote faria alguém procurar a unidade livre no espelho.
    return NextResponse.json(
      {
        avisos: feito.avisos,
        cardConcluido: feito.cardConcluido,
        codigo: feito.codigo,
        contratosIndeferidos: feito.contratosIndeferidos,
        envelopeCancelado: feito.envelopeCancelado,
        jaEstavaDesfeita: feito.jaEstavaDesfeita,
        ok: true,
        recado: feito.recado,
        tipo: feito.tipo,
        unidade: feito.unidade,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ⚠️ LER ANTES DE ESCREVER. O estágio de ONDE o card sai é o que o histórico grava — e ele deixa
  // de existir no banco no instante do `update`.
  // O workspace vai na leitura, como em toda leitura de card da Têmis (arrumação da onda 3).
  const { data: card, error: erroDaLeitura } = await sb
    .from("temis_trabalhos")
    .select("estagio, id, proposta_id, tipo")
    .eq("workspace_id", WORKSPACE)
    .eq("id", id)
    .maybeSingle<CardDaDecisao>();

  if (erroDaLeitura) {
    console.error("[temis][trabalho] falha ao ler o card antes da decisão", erroDaLeitura);
    return NextResponse.json({ error: "Nao foi possivel abrir o trabalho." }, { status: 503 });
  }
  if (!card) return NextResponse.json({ error: "Trabalho nao encontrado." }, { status: 404 });

  const conferido = conferirIndeferimento({
    motivo: String(corpo.motivo ?? ""),
    observacao: String(corpo.observacao ?? ""),
  });
  if (!conferido.ok) {
    return NextResponse.json({ error: conferido.erro }, { status: 400 });
  }

  // ⚠️ SÓ SE INDEFERE CARD QUE AINDA ANDA (revisão de 18/09/2026). Indeferir de novo um card já
  // indeferido regravava o motivo e o autor do primeiro indeferimento e, agora que o indeferimento
  // chega na venda, puxava para Proposta a venda cujo contrato NOVO já andava (aba antiga aberta).
  if (card.estagio === "indeferido" || card.estagio === "faturado") {
    return NextResponse.json(
      {
        error:
          card.estagio === "indeferido"
            ? "Este trabalho já foi indeferido."
            : "Este trabalho já foi concluído e não pode ser indeferido.",
      },
      { status: 409 },
    );
  }

  // ⚠️ PEDIDO CUJA VENDA JÁ CAIU NÃO SE INDEFERE (revisão de 18/09/2026). É a conclusão que parou no
  // meio (a venda caiu, a reserva ou o lote não): indeferir agora deixaria a venda morta com a
  // reserva viva e o card recusado, sem nenhuma saída pela tela. O caminho é concluir de novo.
  if ((card.tipo === "cancelamento" || card.tipo === "distrato") && card.proposta_id) {
    const { data: vendaLida, error: erroDaVenda } = await sb
      .from("hercules_propostas")
      .select("etapa")
      .eq("id", card.proposta_id)
      .maybeSingle<{ etapa: null | string }>();
    if (erroDaVenda) {
      console.error("[temis][trabalho] falha ao ler a venda antes de indeferir", erroDaVenda);
      return NextResponse.json({ error: "Nao foi possivel conferir a venda. Nada foi indeferido." }, { status: 503 });
    }
    const etapaDaVenda = String(vendaLida?.etapa ?? "").trim();
    if (etapaDaVenda === "cancelado" || etapaDaVenda === "distrato") {
      return NextResponse.json(
        {
          error:
            "A venda deste pedido já foi desfeita pela conclusão, que parou no meio. Não indefira: clique em concluir de novo para terminar (o que já foi feito não se repete).",
        },
        { status: 409 },
      );
    }
  }

  const agora = new Date().toISOString();
  const { data: mexidos, error } = await sb
    .from("temis_trabalhos")
    .update({
      atualizado_em: agora,
      estagio: "indeferido",
      // ⚠️ `estagio_desde` ANDA AQUI: indeferir é um movimento de verdade, e o relógio da situação
      // nova começa agora.
      estagio_desde: agora,
      indeferido_em: agora,
      indeferido_motivo: conferido.motivo,
      indeferido_observacao: conferido.observacao,
      indeferido_por: quem,
      indeferido_por_nome: quemNome,
    })
    .eq("id", card.id)
    // ⚠️ COMPARAÇÃO E TROCA COM O ESTÁGIO LIDO: se o card andou (outra pessoa indeferiu, concluiu ou
    // o envelope o moveu) entre a leitura e aqui, nada se grava. O `.select()` diz se pegou linha.
    .eq("estagio", card.estagio)
    .select("id");

  if (error) {
    console.error("[temis][trabalho] falha ao indeferir", error);
    return NextResponse.json({ error: "Nao foi possivel indeferir." }, { status: 503 });
  }

  if (!mexidos || mexidos.length === 0) {
    return NextResponse.json(
      { error: "Este trabalho mudou enquanto a tela estava aberta. Nada foi indeferido; abra de novo." },
      { status: 409 },
    );
  }

  await registrarPassagemDeEtapa(sb, {
    de: card.estagio,
    motivo: conferido.motivo,
    observacao: conferido.observacao,
    origem: "indeferimento",
    para: "indeferido",
    propostaId: card.proposta_id,
    quem,
    quemNome,
    trabalhoId: card.id,
    trabalhoTipo: card.tipo,
  });

  // ⚠️ O INDEFERIMENTO CHEGA NA VENDA (18/09/2026). O pedido de cancelamento indeferido é o pedido
  // RECUSADO: a marca sai da venda e o Hércules volta a oferecer o pedido. O contrato indeferido
  // volta a quem vendeu: a venda sai de `contrato` para `proposta`. Antes disso, nos dois casos, a
  // venda ficava parada para sempre (VOL1106 e VOC0306, medidos em produção). Nunca derruba o
  // indeferimento, que já aconteceu: o que não deu certo vira `aviso` na resposta.
  const naVenda = await devolverVendaNoIndeferimento(sb, card, {
    motivo: conferido.motivo,
    observacao: conferido.observacao,
    usuarioNome: quemNome,
  });

  registrarAtoDoPortal(ator, "trabalho indeferido", {
    motivo: conferido.motivo,
    trabalhoId: card.id,
    venda: naVenda.feito,
  });
  return NextResponse.json(
    {
      // ⚠️ O AVISO VIAJA SEPARADO: é o que o quadro mostra em âmbar e só fecha no clique.
      aviso: naVenda.aviso,
      ok: true,
      recado: [naVenda.recado, naVenda.aviso].filter(Boolean).join(" ") || null,
      venda: naVenda.feito,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── /trabalho/conversa ──────────────────────────────────────────────────────

/**
 * A CONVERSA DA VENDA, VISTA PELA TÊMIS (Lucas, 09/09/2026: *"chat - documento - historico ficam
 * em todas as etapas"*).
 *
 * ⚠️ O RECORTE É `proposta_id`, NÃO `unidade_id`. Um lote passa por várias negociações (o 01 04 do
 * Portal dos Vales teve proposta de sete clientes em quatro dias): num card, que é de UMA venda,
 * filtrar pelo lote traria a conversa do comprador anterior misturada à do atual.
 *
 * ⚠️ NO PORTAL, A PROPOSTA PRECISA SER DE UM TRABALHO DELE (`propostaAlcancavel`), antes da leitura.
 */
export async function lerConversaDoTrabalho(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const propostaId = (new URL(request.url).searchParams.get("proposta") ?? "").trim();
  if (!propostaId) {
    return NextResponse.json({ error: "Proposta não informada." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  if (!(await propostaAlcancavel(ator, admin, propostaId))) return foraDoEscopo();

  try {
    // As mais recentes primeiro no banco, invertidas depois: ler `ascending` com `limit` traria as
    // 500 MAIS ANTIGAS, e a conversa congelaria no passado sem erro nenhum.
    const { data, error } = await admin
      .from("hercules_conversas")
      .select("id, protocolo_numero, tipo, texto, autor_nome, criado_em")
      .eq("workspace_id", WORKSPACE)
      .eq("proposta_id", propostaId)
      .order("criado_em", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);

    const mensagens = ((data ?? []) as Array<{ protocolo_numero: null | number }>)
      .map((m) => ({ ...m, codigo: codigoDaVenda(m.protocolo_numero) || null }))
      .reverse();

    return NextResponse.json({ data: { mensagens } }, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    console.error("[temis][conversa] falha ao listar", erro);
    return NextResponse.json(
      { error: "Não foi possível carregar a conversa." },
      { status: 503 },
    );
  }
}

/**
 * Escrever na conversa — ato de quem trabalha o contrato (coordenação no hub; o time no portal).
 *
 * ⚠️ A MENSAGEM PRECISA DA UNIDADE E DO PROTOCOLO. `hercules_conversas` guarda os três (unidade,
 * protocolo e proposta), e a tela do Hércules lê pelo LOTE: gravar só `proposta_id` faria a nota
 * escrita aqui sumir de lá.
 *
 * ⚠️ O AUTOR É O ATOR: `autor` = `idDoAutor` (o mesmo que a conversa do portal já grava,
 * `sessao.usuarioId`) e `autor_nome` = `nomeDoAutor`. No hub é o `display_name` que o portão já leu
 * — a mesma coluna que esta rota relia em `hub_users`.
 */
export async function escreverNaConversaDoTrabalho(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const corpo = (await request.json().catch(() => ({}))) as {
    proposta?: string;
    texto?: string;
  };

  const propostaId = String(corpo.proposta ?? "").trim();
  const texto = String(corpo.texto ?? "").trim();

  if (!propostaId) {
    return NextResponse.json({ error: "Proposta não informada." }, { status: 400 });
  }
  if (!texto) {
    return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  // Escrever na conversa é escrita: no portal, só na venda de produto que ele opera.
  const recusaDaProposta = await recusaDaPropostaParaEscrever(ator, admin, propostaId);
  if (recusaDaProposta) return recusaDaProposta;

  const { data: proposta } = await admin
    .from("hercules_propostas")
    .select("empreendimento_codigo, protocolo_numero, unidade_id")
    .eq("id", propostaId)
    .maybeSingle<{
      empreendimento_codigo: null | string;
      protocolo_numero: null | number;
      unidade_id: null | string;
    }>();

  if (!proposta) {
    return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });
  }

  try {
    const { error } = await admin.from("hercules_conversas").insert({
      autor: idDoAutor(ator),
      autor_nome: nomeDoAutor(ator),
      empreendimento_codigo: proposta.empreendimento_codigo,
      proposta_id: propostaId,
      protocolo_numero: proposta.protocolo_numero,
      texto,
      tipo: "nota",
      unidade_id: proposta.unidade_id,
      workspace_id: WORKSPACE,
    });

    if (error) throw new Error(error.message);

    registrarAtoDoPortal(ator, "nota na conversa", { propostaId });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    console.error("[temis][conversa] falha ao gravar", erro);
    return NextResponse.json(
      { error: "Não foi possível enviar a mensagem." },
      { status: 503 },
    );
  }
}

// ── GET /trabalho/historico ─────────────────────────────────────────────────

/**
 * O HISTÓRICO DA VENDA, VISTO PELA TÊMIS — a terceira aba da coluna fixa.
 *
 * ⚠️ A MONTAGEM É A MESMA DO HÉRCULES (`historicoDaUnidade`, lib pura e testada). O RECORTE É A
 * PROPOSTA, não o lote: num card, o histórico das propostas anteriores seria a história de outro
 * comprador.
 *
 * ⚠️ DUAS FONTES NA MESMA LISTA, ORDENADA PELA DATA. `?proposta=` traz o funil do Hércules;
 * `?trabalho=` traz as passagens de etapa do card (0153). Lucas (11/09/2026): *"o historico nao
 * esta trazendo essas aprovacoes de analise - contrato - contrato para assinatura, tem que trazer"*.
 *
 * ⚠️ NO PORTAL, OS DOIS IDS PASSAM PELO ALCANCE, CADA UM PELO SEU: a proposta por
 * `propostaAlcancavel`, o trabalho por `trabalhoAlcancavel`. Um só fora já é 404.
 */
export async function lerHistoricoDoTrabalho(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const parametros = new URL(request.url).searchParams;
  const propostaId = (parametros.get("proposta") ?? "").trim();
  const trabalhoId = (parametros.get("trabalho") ?? "").trim();

  // ⚠️ A FRASE CONTINUA A MESMA quando não vem nem um nem outro.
  if (!propostaId && !trabalhoId) {
    return NextResponse.json({ error: "Proposta não informada." }, { status: 400 });
  }

  const sb = createApoloAdminClient();
  if (!sb) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  if (trabalhoId && !(await trabalhoAlcancavel(ator, trabalhoId))) return foraDoEscopo();
  if (propostaId && !(await propostaAlcancavel(ator, sb, propostaId))) return foraDoEscopo();

  try {
    // ⚠️ CARD SEM PROPOSTA NÃO É ERRO: os quatro cards antigos (Garden e Lavra) têm `proposta_id`
    // nulo, e a aba mostra o caminho do card, que é o que existe.
    const proposta = propostaId ? await lerPropostaDoHistorico(sb, propostaId) : null;
    if (propostaId && !proposta) {
      return NextResponse.json({ error: "Proposta não encontrada." }, { status: 404 });
    }

    const [movimentos, importados, daTemis] = await Promise.all([
      propostaId
        ? movimentosDaProposta(sb, propostaId)
        : Promise.resolve<MovimentoDoHistorico[]>([]),
      propostaId ? eventosImportados(sb, propostaId) : Promise.resolve<EventoImportado[]>([]),
      trabalhoId ? etapasDoCard(sb, trabalhoId) : Promise.resolve<EventoDaUnidade[]>([]),
    ]);

    const doHercules = proposta ? historicoDaUnidade([proposta], movimentos, importados) : [];

    const eventos: EventoDaUnidade[] = [...doHercules, ...daTemis].sort((a, b) =>
      a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0,
    );

    return NextResponse.json({ data: { eventos } }, { headers: { "Cache-Control": "no-store" } });
  } catch (erro) {
    console.error("[temis][historico] falha ao montar", erro);
    return NextResponse.json(
      { error: "Não foi possível carregar o histórico." },
      { status: 503 },
    );
  }
}

async function lerPropostaDoHistorico(
  sb: SupabaseClient,
  propostaId: string,
): Promise<null | PropostaDoHistorico> {
  const { data, error } = await sb
    .from("hercules_propostas")
    .select(
      "id, codigo, etapa, etapa_c2x, etapa_desde, criado_em, criado_em_c2x, cliente_nome, valor, unidade_nome, corretor_nome, imobiliaria_nome, plano_nome, aberta, cancelada_em, cancelada_motivo",
    )
    .eq("id", propostaId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as null | PropostaDoHistorico) ?? null;
}

async function movimentosDaProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<MovimentoDoHistorico[]> {
  const { data, error } = await sb
    .from("hercules_proposta_etapas")
    .select("proposta_id,de_c2x,para_c2x,de,para,quando,autor_nome,motivo,observacao")
    .eq("proposta_id", propostaId)
    .order("quando", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);
  return (data ?? []) as MovimentoDoHistorico[];
}

async function eventosImportados(
  sb: SupabaseClient,
  propostaId: string,
): Promise<EventoImportado[]> {
  const { data, error } = await sb
    .from("hercules_proposta_eventos")
    .select("proposta_id,tipo,quando,quem,documento,valor,descricao")
    .eq("proposta_id", propostaId)
    .order("quando", { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);
  return (data ?? []) as EventoImportado[];
}

/**
 * As passagens de etapa do card, mais o próprio card para o caso de não haver nenhuma.
 *
 * ⚠️ ESTA LEITURA NÃO DERRUBA A ABA, e é a única das três assim: a tabela `temis_trabalho_etapas`
 * só existe depois da 0153, e um `throw` aqui apagaria o histórico do Hércules — que funciona — por
 * causa de uma pendência conhecida. Quem decide o que é "ausente" é `ehTabelaAusente` (o
 * `PGRST205` não casa com `42P01`).
 */
async function etapasDoCard(sb: SupabaseClient, trabalhoId: string): Promise<EventoDaUnidade[]> {
  const { data: card, error: erroDoCard } = await sb
    .from("temis_trabalhos")
    .select("estagio, estagio_desde, id, proposta_id, tipo")
    .eq("id", trabalhoId)
    .maybeSingle<CardDoHistorico>();

  if (erroDoCard) throw new Error(erroDoCard.message);
  // Card que não existe não tem linha do tempo — e quem responde 404 é a rota do card, não esta.
  if (!card) return [];

  const { data, error } = await sb
    .from("temis_trabalho_etapas")
    .select(
      "de, motivo, observacao, origem, para, proposta_id, quando, quem_nome, trabalho_id, trabalho_tipo",
    )
    .eq("trabalho_id", trabalhoId)
    .order("quando", { ascending: false })
    .limit(500);

  if (error) {
    if (!ehTabelaAusente(error, "temis_trabalho_etapas")) {
      console.error("[temis][historico] falha ao ler as passagens de etapa", error.message);
    }
    return historicoDeEtapas([], card);
  }

  return historicoDeEtapas((data ?? []) as PassagemGravada[], card);
}

// ── GET /trabalho/documentos ────────────────────────────────────────────────

const BUCKET = "apolo-documents";
/** Dez minutos: tempo de abrir e ler, não de guardar o link. */
const VALIDADE_SEGUNDOS = 600;

/** O que a coluna fixa usa de um documento da pessoa (as duas leituras entregam isso). */
type DocumentoDoProponente = Pick<ApoloDocumentItem, "createdAt" | "documentType" | "id" | "label">;

type DocumentoNaTela = {
  criadoEm: string;
  /** `venda` ou `proponente` — a tela separa em dois blocos. */
  fonte: "proponente" | "venda";
  id: string;
  nome: string;
  quem: null | string;
  tipo: null | string;
};

/**
 * Os documentos DA PESSOA (o proponente da proposta), pela peça canônica.
 *
 * Hub: `listApoloDocuments`, tudo o que a pessoa tem — quem opera a Têmis da Careli enxerga a casa.
 *
 * Portal: `documentosDoApoloParaPortal`, que é `listApoloDocuments` filtrado pela régua de TODA
 * porta de portal (`lib/apolo/incorporador/documentos-do-portal.ts`): o COMPROVANTE DO SERASA e a
 * APROVAÇÃO COM RESTRIÇÃO saem só pela régua de quem opera sozinho (`operaSozinho`), e só das CADs
 * do escopo, porque a Cecílio faz a análise de crédito dos clientes dela; o dossiê jurídico da
 * Careli nunca sai; CAD e PA só quando dá para provar que são deste produto.
 * `imobiliaria: false` porque aqui a pessoa é o COMPRADOR da proposta, nunca a ficha da imobiliária.
 *
 * ⚠️ NO HUB, A LEITURA QUE FALHA LANÇA (revisão da onda 3, 16/09/2026). `listApoloDocuments` ignora o
 * `error` do Supabase e devolve lista vazia; com ela, uma oscilação na leitura virava "o comprador não
 * mandou documento nenhum", sem aviso, e o jurídico indeferia ou pedia de novo. A rota da Careli
 * sempre respondeu 503 nesse caso, e continua respondendo: a leitura do hub é a de antes (as mesmas
 * colunas, a mesma ordem, sem teto próprio) e o erro sobe para o `catch` de quem chama.
 */
async function documentosDoProponente(
  ator: AtorDaTemis,
  admin: AdminClient,
  entityId: string,
): Promise<DocumentoDoProponente[]> {
  if (ator.tipo === "hub") {
    const { data, error } = await admin
      .from("apolo_documents")
      .select("id, document_type, label, created_at")
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<Record<string, null | string>>).map((linha) => ({
      createdAt: String(linha.created_at),
      documentType: linha.document_type as string,
      id: String(linha.id),
      label: linha.label as string,
    }));
  }
  // ⚠️ `operaSozinho: true`, E NÃO É SUPOSIÇÃO: o ator do portal só existe para quem passou por
  // `portalConfeccionaContrato` (`autorizarTemisDoPortal`). A Cecílio faz a análise de crédito dos
  // clientes dela (decisão do Lucas, 16/09/2026), e o comprovante do Serasa das CADs do escopo sai
  // no card que ela confecciona, pela mesma régua do CRM e do board dela. `comercial: false`: a
  // Gurgel não chega a esta porta.
  return documentosDoApoloParaPortal(admin, entityId, {
    comercial: false,
    imobiliaria: false,
    operaSozinho: true,
    recorte: new Set(recorteDeEmpreendimentos(ator) ?? []),
  });
}

async function clienteDaProposta(admin: AdminClient, propostaId: string): Promise<null | string> {
  const { data: proposta } = await admin
    .from("hercules_propostas")
    .select("cliente_entity_id")
    .eq("id", propostaId)
    .maybeSingle<{ cliente_entity_id: null | string }>();
  return proposta?.cliente_entity_id ?? null;
}

/**
 * OS DOCUMENTOS DA VENDA, VISTOS PELA TÊMIS — a segunda aba da coluna fixa.
 *
 * Lucas (09/09/2026): *"chat - documentos - (trazer os documentos dos propronentes) historico"*.
 *
 * ⚠️ DUAS FONTES, E ELE PEDIU AS DUAS. `hercules_documentos` guarda o que foi trocado NA VENDA e
 * tem `proposta_id`; `apolo_documents` guarda os documentos DA PESSOA, colhidos na CAD, e é
 * chaveado por `entity_id`.
 *
 * ⚠️ O ARQUIVO NÃO VIAJA NA LISTA. Abrir é `?abrir=<id>`, que devolve URL assinada de 10 minutos.
 *
 * ⚠️ ABRIR CONFERE O ID CONTRA A LISTA, NOS DOIS LADOS. Até 16/09/2026 `?abrir=` lia o documento
 * só pelo id, sem olhar a proposta: qualquer id de `hercules_documentos` ou `apolo_documents` virava
 * link assinado. Agora o documento da venda precisa ser DA proposta (e não removido, a mesma régua
 * da lista), e o do proponente precisa estar na lista que esta mesma função devolve para este ator
 * — no portal, a lista FILTRADA: esconder da lista e deixar abrir pelo id seria só esconder o botão.
 * A tela só abre o que listou, então no hub nada muda para quem clica.
 */
export async function lerDocumentosDoTrabalho(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const url = new URL(request.url);
  const propostaId = (url.searchParams.get("proposta") ?? "").trim();
  const abrir = (url.searchParams.get("abrir") ?? "").trim();
  const fonte = (url.searchParams.get("fonte") ?? "venda").trim();

  if (!propostaId) {
    return NextResponse.json({ error: "Proposta não informada." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  if (!(await propostaAlcancavel(ator, admin, propostaId))) return foraDoEscopo();

  // ── ABRIR UM DOCUMENTO ────────────────────────────────────────────────────
  if (abrir) {
    let caminho: null | string = null;
    try {
      caminho =
        fonte === "proponente"
          ? await caminhoDoDocumentoDoProponente(ator, admin, propostaId, abrir)
          : await caminhoDoDocumentoDaVenda(admin, propostaId, abrir);
    } catch (erro) {
      console.error("[temis][documentos] falha ao conferir o documento", erro);
      return NextResponse.json({ error: "Não foi possível abrir." }, { status: 503 });
    }

    if (!caminho) {
      return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
    }

    const { data: assinada, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(caminho, VALIDADE_SEGUNDOS);

    if (error || !assinada?.signedUrl) {
      console.error("[temis][documentos] falha ao assinar", error);
      return NextResponse.json({ error: "Não foi possível abrir." }, { status: 503 });
    }

    return NextResponse.json(
      { data: { url: assinada.signedUrl } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── LISTAR ────────────────────────────────────────────────────────────────
  try {
    const daVenda = await admin
      .from("hercules_documentos")
      .select("id, tipo, nome, enviado_por_nome, criado_em")
      .eq("workspace_id", WORKSPACE)
      .eq("proposta_id", propostaId)
      // ⚠️ REMOVIDO CONTINUA NA TABELA. Sem este filtro a lista mostra o que alguém apagou de
      // propósito — inclusive versão de contrato substituída.
      .is("removido_em", null)
      .order("criado_em", { ascending: false });

    if (daVenda.error) throw new Error(daVenda.error.message);

    // Os documentos DA PESSOA: chegam pelo cliente da proposta, não pela proposta.
    const entityId = await clienteDaProposta(admin, propostaId);
    const doProponente = entityId ? await documentosDoProponente(ator, admin, entityId) : [];

    const documentos: DocumentoNaTela[] = [
      ...((daVenda.data ?? []) as Array<Record<string, null | string>>).map((d) => ({
        criadoEm: String(d.criado_em),
        fonte: "venda" as const,
        id: String(d.id),
        nome: String(d.nome ?? "Documento"),
        quem: d.enviado_por_nome ?? null,
        tipo: d.tipo ?? null,
      })),
      ...doProponente.map((d) => ({
        criadoEm: String(d.createdAt),
        fonte: "proponente" as const,
        id: String(d.id),
        // `label` e `document_type` podem vir nulos do banco mesmo tipados como texto.
        nome: String((d.label as null | string) ?? (d.documentType as null | string) ?? "Documento"),
        quem: null,
        tipo: (d.documentType as null | string) ?? null,
      })),
    ];

    return NextResponse.json(
      { data: { documentos } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    console.error("[temis][documentos] falha ao listar", erro);
    return NextResponse.json(
      { error: "Não foi possível carregar os documentos." },
      { status: 503 },
    );
  }
}

/** O caminho do documento DA VENDA, só se ele é desta proposta e não foi removido. */
async function caminhoDoDocumentoDaVenda(
  admin: AdminClient,
  propostaId: string,
  documentoId: string,
): Promise<null | string> {
  const { data, error } = await admin
    .from("hercules_documentos")
    .select("caminho")
    .eq("workspace_id", WORKSPACE)
    .eq("id", documentoId)
    .eq("proposta_id", propostaId)
    .is("removido_em", null)
    .maybeSingle<{ caminho: null | string }>();

  // Id que não é uuid (`22P02`) é alguém mexendo na URL: "não encontrado", sem alarde.
  if (error) {
    if ((error as { code?: unknown }).code === "22P02") return null;
    throw new Error(error.message);
  }
  return data?.caminho ?? null;
}

/** O caminho do documento DO PROPONENTE, só se ele está na lista que este ator recebe. */
async function caminhoDoDocumentoDoProponente(
  ator: AtorDaTemis,
  admin: AdminClient,
  propostaId: string,
  documentoId: string,
): Promise<null | string> {
  const entityId = await clienteDaProposta(admin, propostaId);
  if (!entityId) return null;

  const lista = await documentosDoProponente(ator, admin, entityId);
  if (!lista.some((d) => d.id === documentoId)) return null;

  const { data, error } = await admin
    .from("apolo_documents")
    .select("storage_path")
    .eq("id", documentoId)
    .eq("entity_id", entityId)
    .maybeSingle<{ storage_path: null | string }>();

  if (error) throw new Error(error.message);
  return data?.storage_path ?? null;
}
