import { NextResponse } from "next/server";

import { ehUuid, type RecorteDaFila } from "@/lib/apolo/board-do-servidor";
import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { ehIdDoPai, expandirIdDoPainel } from "@/lib/hercules/expandir-id-do-painel";
import type { AutorDoCredito } from "@/lib/serasa/consulta-servico";

import { autorizar, foraDoEscopo, idsDaSessao } from "./escopo";
import { ehPortalComercial, portalConfeccionaContrato, portalOperaVenda } from "./perfis-de-portal";
import type { SessaoIncorporador } from "./sessao";

// O BOARD DO APOLO DENTRO DO PORTAL COMERCIAL — o recorte que TODA rota `/api/incorporador/board/**`
// faz antes de tocar em qualquer CAD.
//
// Pedido do Lucas (02/09/2026), sobre a aba Cadastro do produto no Hércules: *"deixa cadastro
// mesmo e traz a mesma visão do apolo, imobiliária e cads"*. É o Board do Apolo por outra porta:
// cookie do coordenador no lugar do Bearer do hub, e SÓ as CADs e imobiliárias do produto dele.
//
// ⚠️ O ESCOPO VEM DO COOKIE, NUNCA DA URL — a mesma régua de vendas/route.ts, copiada daqui para
// não divergir: `idsDaSessao` é a única fonte dos ids; o `emp` da query apenas ESCOLHE um dos
// produtos que a sessão já alcança e só consegue REDUZIR. Produto que não é dele não dá erro
// revelador: 404, o mesmo de um produto inexistente (`foraDoEscopo`).
//
// ⚠️ SÓ QUEM OPERA A VENDA (`portalOperaVenda`): o portal comercial e o incorporador que opera a
// própria venda (hoje só o Cecílio). O cookie do incorporador comum (o dono do loteamento que só lê
// a carteira) também passa em `sessaoDoRequest`, mas o Board carrega CPF, endereço e documento do
// comprador, e a regra das rotas do incorporador é "documento pessoal nunca sai daqui". Para ele
// estas rotas não existem.

export type RecorteDoProduto = {
  /**
   * Os enterprise_ids que o produto cobre, em TODOS os formatos vivos no banco: as divisões
   * reais ("33", "27", "32") e, quando o produto cobre o grupo inteiro, o id do grupo
   * ("group:Lagoa Bonita") — porque `apolo_esteira.enterprise_id` e o vínculo da imobiliária
   * podem estar gravados em qualquer um dos dois (medido em 17/08: 150 com divisão, 1 com grupo).
   */
  ids: Set<string>;
  /** Os nomes do catálogo cobertos: vira a lista `empreendimentos` da fila (rótulo da tela). */
  nomes: string[];
  sessao: SessaoIncorporador;
};

type Autorizacao =
  | { ok: false; response: NextResponse }
  | { ok: true; sessao: SessaoIncorporador };

/**
 * Porta de entrada de TODA rota `/api/incorporador/board/**` e `/api/incorporador/venda/**`:
 * sessão válida E portal que opera a venda. Incorporador comum: 404, como se não existisse.
 *
 * Pedido do Lucas (16/09/2026) para o Cecílio: *"quero replicar esse portal do coordenador (...)
 * a unica coisa que não teremos é o lançamento"* · *"a Cecilio quem vai fazer é o proprio time
 * deles"*. O Cecílio passa a reservar, propor, mexer no board de cadastro e ler contratos sobre o
 * recorte do PRÓPRIO portal, com a mesma casca do Hércules.
 *
 * ⚠️ ERA `autorizarComercial` (tipo === "comercial") E VIROU ESTA, EM TODAS AS ROTAS DE BOARD E
 * VENDA DE UMA VEZ. Trocar rota a rota deixaria o Cecílio com a reserva aberta e a proposta
 * fechada: a tela acende o botão e o servidor responde 404. A lista de quem opera mora em
 * `perfis-de-portal.ts`, e é a ÚNICA: se cada rota decidisse por conta própria, a primeira a
 * divergir abriria escrita para um portal que não devia tê-la.
 *
 * ⚠️ O 404 CONTINUA IGUAL AO DE ANTES para todos os demais portais de incorporador (cer,
 * vistaalegre, lagoabonita...): o furo que esta porta fechou já foi pago em produção (um usuário
 * de portal de incorporador cancelou proposta do comercial por HTTP). Só a lista explícita passa;
 * o escopo de cada rota (`idsDaSessao`, `recorteDoProduto`, `cadNoEscopo`) continua valendo por
 * inteiro.
 */
export function autorizarOperacaoDeVenda(request: Request): Autorizacao {
  const auth = autorizar(request);
  if (!auth.ok) return auth;
  if (!portalOperaVenda(auth.sessao.slug, auth.sessao.tipo)) {
    return { ok: false, response: foraDoEscopo() };
  }
  return { ok: true, sessao: auth.sessao };
}

/**
 * A porta do que o portal só faz quando OPERA SOZINHO: a análise de crédito (consulta paga ao
 * Serasa e aprovação com restrição) e as etapas de decisão da esteira (pré-venda, credenciado e
 * indeferido). Roda DEPOIS de `autorizarOperacaoDeVenda`, que continua sendo a porta de toda rota de
 * board (a varredura do teste confere).
 *
 * Decisão do Lucas (16/09/2026): *"A Cecílio, no portal"* faz o crédito e o credenciamento dos
 * clientes dela, com a consulta paga na conta da Careli e o registro de quem consultou. A Gurgel
 * (comercial) NÃO ganha isso: o crédito das vendas dela continua com a Careli no Apolo.
 *
 * ⚠️ DUAS CAMADAS, DA MAIS BARATA PARA A MAIS CARA:
 *   1. `portalConfeccionaContrato(slug, tipo)`, a lista no código: comercial e incorporador padrão
 *      morrem aqui com o 404 de sempre, sem ida ao banco;
 *   2. a REVALIDAÇÃO da conta e do incorporador a cada chamada (`autorizarTemisDoPortal`, a mesma
 *      régua do CRM e da Têmis do portal). O cookie vale 12 horas: sem isto, a conta desligada às 9h
 *      seguiria gastando consulta do Serasa na conta da Careli até o cookie vencer. A sessão que sai
 *      daqui é a VIGENTE (empreendimentos do cookie cruzados com os da conta agora), e é ela que
 *      deve alimentar `recorteDoProduto`.
 *
 * O import é dinâmico de propósito: este arquivo é lido por toda rota de board e venda, e a porta da
 * Têmis puxa o cadastro do incorporador. Só quem chega nesta função paga esse carregamento.
 */
export async function autorizarPortalQueOperaSozinho(
  request: Request,
  sessao: Pick<SessaoIncorporador, "slug" | "tipo">,
): Promise<Autorizacao> {
  if (!portalConfeccionaContrato(sessao.slug, sessao.tipo)) {
    return { ok: false, response: foraDoEscopo() };
  }
  const { autorizarTemisDoPortal } = await import("@/lib/temis/portao-do-portal");
  const vigente = await autorizarTemisDoPortal(request);
  if (!vigente.ok) return { ok: false, response: vigente.response };
  return { ok: true, sessao: vigente.sessao };
}

/** O autor da consulta e da aprovação de crédito quando quem age é o portal que opera sozinho. */
export function autorDoCreditoNoPortal(
  sessao: Pick<SessaoIncorporador, "incorporadorId" | "slug" | "usuarioId" | "usuarioNome">,
): Extract<AutorDoCredito, { tipo: "portal" }> {
  return {
    incorporadorId: sessao.incorporadorId,
    nome: sessao.usuarioNome,
    slug: sessao.slug,
    tipo: "portal",
    usuarioId: sessao.usuarioId,
  };
}

/**
 * O `metadata.origem` da auditoria do board quando quem age é o portal (`AutorDoBoard.origem`).
 *
 * (16/09/2026, revisão) O comercial grava "portal-comercial", como sempre; o incorporador que opera a
 * própria venda grava "portal-incorporador". Texto livre no jsonb, sem CHECK no banco.
 */
export function origemDoAutorNoPortal(
  sessao: Pick<SessaoIncorporador, "tipo">,
): "portal-comercial" | "portal-incorporador" {
  return ehPortalComercial(sessao.tipo) ? "portal-comercial" : "portal-incorporador";
}

/** O vocabulário de `hercules_reservas.origem` (CHECK da migration 0125, ampliada pela 0167). */
export type OrigemDaReserva = "coordenador" | "incorporador";

/**
 * De onde a reserva feita PELO PORTAL veio, para gravar em `hercules_reservas.origem`.
 *
 * ⚠️ NÃO É MAIS "coordenador" FIXO. No comercial quem reserva é o coordenador da Careli; no
 * Cecílio é o time do PRÓPRIO incorporador (*"eles meio que vão andar sozinhos sem o time
 * administrativo da Careli"*). Gravar "coordenador" para os dois apagaria justamente a pergunta
 * que a coluna responde, e a reserva do Cecílio contaria como trabalho do comercial em qualquer
 * relatório por origem. Quem chega aqui já passou por `autorizarOperacaoDeVenda`.
 *
 * ⚠️ DEPENDE DA MIGRATION 0167: antes dela a CHECK recusa 'incorporador' e o insert do Cecílio
 * morre com 23514. A migration vai para o banco ANTES deste código.
 */
export function origemDaReserva(sessao: Pick<SessaoIncorporador, "tipo">): OrigemDaReserva {
  return ehPortalComercial(sessao.tipo) ? "coordenador" : "incorporador";
}

/**
 * O insert da reserva morreu porque a CHECK ainda não conhece 'incorporador' (a 0167 não foi
 * aplicada)?
 *
 * (16/09/2026, revisão) ⚠️ A REDE PARA A ORDEM DE DEPLOY ESQUECIDA. O deploy é automático no push da
 * `main`: se o código subir antes da migration, TODA reserva do Cecílio respondia 503 "Não foi
 * possível reservar agora", sem nenhuma pista na tela. Reconhecida a recusa (código 23514 citando a
 * constraint `hercules_reservas_origem`, e só quando a origem pedida era 'incorporador'), a rota
 * grava de novo com a origem antiga e deixa um erro no log. A reserva não se perde, e a origem é
 * recuperável depois: `criado_por` é a conta do portal. A migration CONTINUA obrigatória.
 */
export function origemRecusadaSemA0167(
  erro: null | undefined | { code?: unknown; message?: unknown },
  origemPedida: OrigemDaReserva,
): boolean {
  if (origemPedida !== "incorporador" || !erro) return false;
  return erro.code === "23514" && String(erro.message ?? "").includes("hercules_reservas_origem");
}

/** A origem que a CHECK antiga (0125) aceita, usada só pela rede de `origemRecusadaSemA0167`. */
export const ORIGEM_ACEITA_SEM_A_0167: OrigemDaReserva = "coordenador";

/**
 * Traduz o `?emp=` da query no recorte do produto, DENTRO do que a sessão autoriza.
 *
 * O `emp` chega em DOIS formatos (mesma convenção de vendas/route.ts):
 *   • "pai:<uuid>", o PAI do cadastro do Panteon (hercules_empreendimentos) — o que a ficha do
 *     produto manda. Expande para os c2x ids dos filhos autorizados (ou o espelho do pai, quando
 *     não tem filho) pela MESMA regra que montou os cards do painel (`alcanceDoPai`);
 *   • o id do catálogo do C2X ("group:Lagoa Bonita" ou "37"). O id de GRUPO abre as divisões
 *     (é a assimetria de `idsDaSessao`: o grupo abre as divisões; a divisão vale só por ela).
 * Sem `emp`: tudo o que a sessão alcança.
 *
 * ⚠️ FAIL-CLOSED EM DUAS CAMADAS: a expansão cruza com `idsDaSessao` e o resultado ainda é
 * filtrado por ele. Cadastro fora do ar responde 503, não 404: sem cadastro não dá para provar
 * que o pai é dele, e "não encontrado" para um produto que É dele vira ligação.
 */
export async function recorteDoProduto(
  request: Request,
  sessao: SessaoIncorporador,
): Promise<{ ok: false; response: NextResponse } | { ok: true; recorte: RecorteDoProduto }> {
  const pedido = new URL(request.url).searchParams.get("emp");

  const permitidos = new Set(await idsDaSessao(sessao));
  // A sessão só existe com empreendimento (a leitura do token recusa lista vazia), então zero id
  // aqui é catálogo fora do ar, não falta de permissão.
  if (permitidos.size === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Não foi possível carregar os empreendimentos agora." },
        { status: 503 },
      ),
    };
  }

  const catalogo = await catalogoDeEmpreendimentos(Date.now());

  let reais: string[];

  if (ehIdDoPai(pedido)) {
    let cadastro;
    try {
      cadastro = await carregarCadastroDeEmpreendimentos();
    } catch {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Não foi possível carregar os empreendimentos agora." },
          { status: 503 },
        ),
      };
    }
    reais = expandirIdDoPainel(pedido, cadastro, permitidos);
  } else if (pedido?.trim()) {
    const alvo = pedido.trim();
    reais = permitidos.has(alvo) ? [alvo] : [];
    // Id de GRUPO do catálogo: as divisões vêm junto (a sessão com o grupo alcança todas).
    const grupo = catalogo.find((emp) => emp.id === alvo);
    if (grupo && reais.length > 0) reais.push(...grupo.stageIds.map(String));
  } else {
    reais = [...permitidos];
  }

  // Segunda camada: nada sai daqui que a sessão não alcance.
  const ids = new Set(
    reais.map((id) => String(id).trim()).filter((id) => id && permitidos.has(id)),
  );

  // Pedido que não sobra nada = produto que não é dele (ou que saiu do catálogo). Nunca cai na
  // visão consolidada.
  if (ids.size === 0) {
    return { ok: false, response: foraDoEscopo() };
  }

  // O ID DO GRUPO ENTRA QUANDO O PRODUTO COBRE O GRUPO INTEIRO. A CAD gravada como
  // "group:Lagoa Bonita" (o portal público grava assim, porque lá fora não existe divisão) é de
  // um produto que este coordenador cobre por inteiro — sem isto ela sumiria do recorte. Quem
  // cobre só uma divisão NÃO ganha o grupo: a CAD gravada no grupo não diz de qual gleba é.
  const nomes: string[] = [];
  for (const emp of catalogo) {
    const divisoes = emp.stageIds.map(String);
    const cobreTudo = divisoes.length > 0 && divisoes.every((d) => ids.has(d));
    if (cobreTudo || ids.has(emp.id)) {
      ids.add(emp.id);
      // O grupo no recorte traz as divisões, mas só as que a sessão alcança (fail-closed).
      for (const d of divisoes) if (permitidos.has(d)) ids.add(d);
    }
    if (ids.has(emp.id) || divisoes.some((d) => ids.has(d))) nomes.push(emp.name);
  }

  return { ok: true, recorte: { ids, nomes, sessao } };
}

/** O recorte no formato que `montarFilaDoBoard` recebe. */
export function recorteParaFila(recorte: RecorteDoProduto): RecorteDaFila {
  return {
    ids: recorte.ids,
    nomes: recorte.nomes,
    usuario: { id: recorte.sessao.usuarioId, nome: recorte.sessao.usuarioNome },
  };
}

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type CadNoEscopo = {
  /**
   * A CAD desta pessoa DENTRO do recorte: a pedida (`enterpriseIdPedido`) ou, sem pedido, a mais
   * recente entre as que o produto cobre. `null` = a entidade entrou pelo vínculo de imobiliária
   * (não tem esteira).
   */
  enterpriseId: null | string;
  imobiliaria: boolean;
};

/**
 * A CAD (entity_id + enterprise_id) está no escopo do produto?
 *
 * ⚠️ RODA ANTES DE QUALQUER LEITURA OU ESCRITA POR `[id]`. Sem isto, trocar o uuid na URL abriria
 * a ficha (CPF, endereço, documento) de um comprador de outro loteamento, ou moveria a etapa da
 * CAD que a pessoa tem em outro produto.
 *
 * Duas portas, e as duas fecham sozinhas:
 *   • CAD: alguma linha de `apolo_esteira` desta pessoa com `enterprise_id` no recorte. Com
 *     `enterpriseIdPedido`, tem que ser exatamente aquela — pedir uma CAD fora do recorte é 404,
 *     nunca "a mais recente" por baixo dos panos.
 *   • IMOBILIÁRIA: algum vínculo de empreendimento (pendente ou habilitado) no recorte. Pendente
 *     conta: é a imobiliária que PEDIU o produto e espera a habilitação.
 * Falha de leitura NÃO autoriza (fail-closed).
 *
 * ⚠️ A PORTA DO VÍNCULO EXIGE O PERFIL DE IMOBILIÁRIA. O vínculo `relationship_type =
 * 'empreendimento'` NÃO é só dela: o cliente da CAD também ganha um, `verified`, ao salvar
 * (publico/cad/salvar e cadastro-persist; memória: "vínculo empreendimento não é só de
 * imobiliária"). Sem esta régua, um cliente cuja CAD neste produto foi removida/mesclada (dedup
 * por document_hash de 22/08) mas que tem CAD viva em OUTRO produto entrava por aqui com
 * `enterpriseId: null`, e a ficha/histórico/PATCH caíam no default "CAD mais recente" — a de
 * outro loteamento. Imobiliária tem zero esteira (medido em 15/08 e de novo em 16/09: 0 de 473), e
 * desde 16/09 isso é CONFERIDO, não suposto: com qualquer CAD na esteira, a porta do vínculo fecha.
 * Mesma régua do `noRecorte` da fila (`papel === 'imobiliaria'`).
 */
export async function cadNoEscopo(
  adminClient: AdminClient,
  entityId: string,
  recorte: RecorteDoProduto,
  enterpriseIdPedido?: unknown,
): Promise<{ ok: false; response: NextResponse } | { escopo: CadNoEscopo; ok: true }> {
  if (!ehUuid(entityId)) return { ok: false, response: foraDoEscopo() };

  const pedido = normalizarEnterpriseId(enterpriseIdPedido);
  if (pedido && !recorte.ids.has(pedido)) return { ok: false, response: foraDoEscopo() };

  try {
    // Poucos ids (as divisões de UM produto): cabe num `.in()` sem estourar a URL do PostgREST.
    const { data: cads, error } = await adminClient
      .from("apolo_esteira")
      .select("enterprise_id")
      .eq("entity_id", entityId)
      .in("enterprise_id", [...recorte.ids].slice(0, 100))
      .order("atualizado_em", { ascending: false })
      .order("created_at", { ascending: false })
      .order("enterprise_id", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);

    const linhas = (cads ?? []) as Array<{ enterprise_id: null | string }>;
    const escolhida = pedido
      ? linhas.find((linha) => linha.enterprise_id === pedido)
      : linhas[0];
    if (escolhida?.enterprise_id) {
      return { escopo: { enterpriseId: escolhida.enterprise_id, imobiliaria: false }, ok: true };
    }

    // Sem CAD no recorte, a única outra porta é a da IMOBILIÁRIA — e só para quem tem o perfil.
    const { data: perfil, error: erroPerfil } = await adminClient
      .from("apolo_entity_profiles")
      .select("entity_id")
      .eq("entity_id", entityId)
      .eq("profile", "imobiliaria")
      .maybeSingle();
    if (erroPerfil) throw new Error(erroPerfil.message);
    if (!perfil) return { ok: false, response: foraDoEscopo() };

    const { data: vinculos, error: erroVinculos } = await adminClient
      .from("apolo_relationships")
      .select("metadata")
      .eq("entity_id", entityId)
      .eq("relationship_type", "empreendimento")
      .limit(500);
    if (erroVinculos) throw new Error(erroVinculos.message);

    const temVinculo = ((vinculos ?? []) as Array<{ metadata: { enterpriseId?: unknown } | null }>)
      .map((linha) => normalizarEnterpriseId(linha.metadata?.enterpriseId))
      .some((id) => id !== null && recorte.ids.has(id));

    if (temVinculo) {
      // (16/09/2026, revisão) ⚠️ E ELA NÃO PODE TER CAD EM LUGAR NENHUM. Com `enterpriseId: null`,
      // a ficha, o histórico e o PATCH caem no default "CAD mais recente" (`lerCadDaEsteira` sem
      // empreendimento), e a CAD mais recente de quem tem perfil de imobiliária E comprou lote em
      // outro produto é a daquele produto: renda, cônjuge e endereço de outro loteamento, lidos e
      // gravados por aqui. A CAD no recorte já foi descartada acima, então QUALQUER linha na
      // esteira é de fora. Medido em 16/09/2026: 0 das 473 imobiliárias têm esteira, então hoje
      // ninguém perde a porta; no dia em que uma tiver, ela é decidida pela Careli (404 aqui).
      const { data: alguma, error: erroEsteira } = await adminClient
        .from("apolo_esteira")
        .select("enterprise_id")
        .eq("entity_id", entityId)
        .limit(1);
      if (erroEsteira) throw new Error(erroEsteira.message);
      if ((alguma ?? []).length === 0) {
        return { escopo: { enterpriseId: null, imobiliaria: true }, ok: true };
      }
    }
  } catch {
    // Sem conseguir provar que a CAD é dele, ela não é dele.
  }

  return { ok: false, response: foraDoEscopo() };
}

/** Cliente admin ou a resposta 503 padrão do board. */
export function adminOu503(): { client: AdminClient; ok: true } | { ok: false; response: NextResponse } {
  const client = createApoloAdminClient();
  if (!client) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 }),
    };
  }
  return { client, ok: true };
}
