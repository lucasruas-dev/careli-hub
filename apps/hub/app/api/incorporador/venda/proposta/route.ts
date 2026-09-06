import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { soDigitos } from "@/lib/apolo/documento";
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { chaveDaLogo } from "@/lib/apolo/enterprise-logos";
import { autorizarComercial } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { comIdsDoGrupo } from "@/lib/apolo/incorporador/resumo-do-produto";
import type { PlanoComercial } from "@/lib/apolo/planos-comerciais";
import { lerPlanosDoC2x } from "@/lib/apolo/planos-comerciais-c2x";
import { createApoloAdminClient, hashIdentifier } from "@/lib/apolo/server";
import { avisarSobreAVenda, destinatariosDaVenda } from "@/lib/hercules/avisos-da-venda";
import { carregarCadastroDeEmpreendimentos, type LinhaDoCadastro } from "@/lib/hercules/cadastro";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import {
  credenciadoParaVender,
  FalhaAoLerCredenciamento,
} from "@/lib/hercules/cliente-credenciado";
import { montarCronograma } from "@/lib/hercules/cronograma";
import { nomeDaUnidade } from "@/lib/hercules/nome-da-unidade";
import {
  lerPlanosDoPanteon,
  planosPreferindoOPanteon,
} from "@/lib/hercules/planos-do-panteon";
import {
  avisosDaProposta,
  avisosDeCancelamentoDaProposta,
  type CompradorDoPedido,
  conferirCancelamentoDaProposta,
  diaDoCalendario,
  type PedidoDeCancelamentoDaProposta,
  type PedidoDeProposta,
  PRAZO_PADRAO_DA_PROPOSTA,
  PRAZOS_DA_PROPOSTA,
  conferirProposta,
} from "@/lib/hercules/proposta";
import { montarPropostaPdf } from "@/lib/hercules/proposta-pdf";
import { montarFolhaDaProposta } from "@/lib/hercules/proposta-para-pdf";
import { familiaDoEmpreendimento } from "@/lib/hercules/quem-pode-vender";
// ⚠️ O PRAZO DA PROPOSTA USA O CÁLCULO DA RESERVA de propósito: `vencimentoEmDias` já põe o fim no
// último segundo do dia no fuso da operação (−03:00), que é o que a pessoa entende por "vale até
// quinta". Uma segunda conta aqui daria dois vencimentos diferentes na mesma venda.
import { motivoEscrito, vencimentoEmDias } from "@/lib/hercules/reserva";

// A PROPOSTA DA UNIDADE — o segundo passo da venda, saindo da reserva que já existe.
//
// Lucas (04/09/2026): *"da reserva eu tenho dois caminhos, gerar proposta ou cancelar"*, *"o
// cliente é o da reserva e não se troca"*, *"dá para adicionar proponentes, cada um informa a % de
// participação"*, *"para virar proposta a CAD do titular tem que estar credenciada naquele
// empreendimento"*, *"depois vem a montagem no simulador"* e *"ao gerar, a proposta fica cadastrada
// e o PDF vai por WhatsApp para coordenador, imobiliária e corretor"*.
//
// ⚠️ O ESQUELETO É O DA ROTA DE RESERVA, e de propósito: `autorizarComercial`, escopo do COOKIE por
// `idsDaSessao` (nunca do corpo), unidade fora do escopo respondendo 404 igual a inexistente — o
// 403 não pode virar oráculo de "existe, mas não é sua" —, e o aviso que NÃO derruba a gravação.
//
// ⚠️ O TITULAR É O DA RESERVA, SEMPRE, e qualquer titular que venha no corpo é IGNORADO. A tela
// não oferece a troca; aceitar o do corpo abriria por HTTP a porta que ela fechou, e a proposta
// sairia no nome de quem o POST disse, sobre uma unidade travada por outra pessoa.
//
// ⚠️ A GRAVAÇÃO PREENCHE AS COLUNAS DESNORMALIZADAS, e não é redundância: a rota `/venda` filtra
// por `empreendimento_codigo` (sem ele a proposta some da tela inteira, sem erro nenhum) e o mapa
// pinta o lote pela proposta viva de maior `etapa_desde` (sem ele o lote continua reservado e o
// botão continua oferecendo "Cancelar reserva"). `unidade_nome`, `cliente_nome`, `valor` e
// companhia existem pelo mesmo motivo que existiam na carga: a tela lista milhares de linhas sem
// join.
//
// ⚠️ E A RESERVA CONTINUA VIVA, agora em `proposta`. É ela que trava a unidade — o índice parcial
// da 0125 cobre `ativa` e `proposta` —, e é por isso que a leitura do funil (`lerReservasVivas`,
// em `/venda`) passou a considerar linha do fluxo SÓ a reserva `ativa`: a partir daqui quem
// representa a venda é a proposta, e as duas juntas contariam a mesma unidade duas vezes.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// O POST monta PDF, sobe para o storage e dispara três mensagens. 60s é o mesmo teto da reserva.
export const maxDuration = 60;

const WORKSPACE = "careli";

/** Onde o PDF gerado fica guardado, no bucket privado que o Apolo já usa para documento. */
const PASTA_DAS_PROPOSTAS = "hercules-propostas";

/** Folga para o gateway do WhatsApp baixar o anexo. O mesmo prazo do aviso da CAD. */
const VALIDADE_DO_LINK_EM_SEGUNDOS = 60 * 60;

type UnidadeDaProposta = {
  area: null | number | string;
  codigo: string;
  enterprise_id: string;
  id: string;
  lote: null | string;
  preco_tabela: null | number | string;
  quadra: null | string;
  situacao: string;
};

type ReservaViva = {
  corretor_entity_id: null | string;
  criado_em: string;
  id: string;
  imobiliaria_entity_id: null | string;
  proponentes: unknown;
  protocolo_numero: null | number;
  situacao: string;
  validade_em: null | string;
};

type Proponente = { cpf: string; nome: string; telefone: string };

/**
 * O comprador como ele fica GRAVADO em `hercules_propostas.compradores` (jsonb).
 *
 * ⚠️ O TELEFONE É GRAVADO, e não descartado — era o que acontecia: a tela mandava o telefone (o do
 * titular sempre, o do proponente adicional quando houver), o corpo o aceitava e o `map` de
 * `CompradorDoPedido` o jogava fora, porque a régua pura não precisa dele. O jsonb dos compradores
 * é o ÚNICO lugar onde o contato de um proponente que não é o titular existe: ele não tem reserva
 * (o telefone da reserva é o do titular), pode não ter CAD e pode não ter entidade no Apolo. Quem
 * for montar a minuta na Têmis, ou ligar para o segundo comprador para assinar, procura aqui.
 *
 * ⚠️ POR ISSO O TIPO É DAQUI, e não de `lib/hercules/proposta.ts`: `CompradorDoPedido` é o que a
 * RÉGUA confere (CPF, participação, titular), e telefone não entra em regra nenhuma. Este é o
 * formato da GRAVAÇÃO — um superconjunto, aceito por tudo que consome o outro.
 */
type CompradorGravado = CompradorDoPedido & { telefone: null | string };

/** O telefone como ele vai para o jsonb: texto aparado, e `null` quando não veio. */
function telefoneEscrito(valor: unknown): null | string {
  const t = typeof valor === "string" ? valor.trim() : "";
  return t || null;
}

/** `numeric` do Postgres chega como STRING no PostgREST: somar sem converter concatena. */
function numeroDoBanco(valor: null | number | string | undefined): null | number {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * O número que veio do corpo, com "ausente" preservado.
 *
 * ⚠️ `Number("")` É ZERO, e é assim que uma entrada vazia viraria entrada de R$ 0,00 aprovada pela
 * régua (que só recusa NaN e valores abaixo do mínimo — zero abaixo do mínimo é recusado, mas
 * `entradaVezes` vazio viraria 0 e `parcelasMensais` vazio viraria 0 sem ninguém reclamar). Campo
 * ausente tem que chegar em `conferirProposta` como NaN, que é o que ela sabe recusar.
 */
/**
 * A entrada montada à mão, como ela chega do corpo.
 *
 * ⚠️ NÃO CONFIA NO QUE VEIO: cada item vira número, o que não for número finito e positivo cai
 * fora, e lista sem nada sobrando volta `null` — que é "divide igual", o caminho de sempre. Um
 * `["10000"]` de um cliente desatualizado, ou um `[null, 0]` de uma tela em preenchimento, não
 * podem virar cronograma.
 */
function parcelasDoCorpo(valor: unknown): null | number[] {
  if (!Array.isArray(valor)) return null;
  const limpas = valor
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
  return limpas.length > 0 ? limpas : null;
}

function numeroDoCorpo(valor: unknown): number {
  if (valor === null || valor === undefined || valor === "") return Number.NaN;
  return Number(valor);
}

/** O primeiro proponente da reserva é o titular. É ele, e só ele, que a proposta aceita. */
function titularDaReserva(proponentes: unknown): null | Proponente {
  const lista = Array.isArray(proponentes) ? proponentes : [];
  const primeiro = lista[0] as null | undefined | Record<string, unknown>;
  if (!primeiro || typeof primeiro !== "object") return null;

  const cpf = typeof primeiro.cpf === "string" ? primeiro.cpf : "";
  const nome = typeof primeiro.nome === "string" ? primeiro.nome.trim() : "";
  const telefone = typeof primeiro.telefone === "string" ? primeiro.telefone : "";
  if (!cpf && !nome) return null;
  return { cpf, nome, telefone };
}

/**
 * O empreendimento do cadastro que responde por esta unidade.
 *
 * ⚠️ O PAI GANHA. As unidades moram no espelho (o pai do cadastro), e é o `id` dele que as
 * reservas e as propostas referenciam; um filho pode compartilhar o mesmo id do C2X.
 */
function empreendimentoDaUnidade(
  cadastro: LinhaDoCadastro[],
  c2xEnterpriseId: string,
): null | LinhaDoCadastro {
  const doC2x = cadastro.filter((l) => l.c2xEnterpriseId === c2xEnterpriseId);
  return doC2x.find((l) => l.paiId === null) ?? doC2x[0] ?? null;
}

/**
 * O CÓDIGO com que a tela Venda filtra as propostas.
 *
 * ⚠️ O CATÁLOGO DO C2X MANDA, e o cadastro do Panteon é o segundo. A rota `/venda` monta o `codes`
 * do filtro a partir do catálogo (`codigosDaSessao`); gravar aqui um código que só existe no
 * cadastro daqui faria a proposta nascer INVISÍVEL — ela não entraria no `in(empreendimento_codigo,
 * codes)` e sumiria do funil, do mapa e da lista, sem erro nenhum. O cadastro cobre o
 * empreendimento que ainda não existe no legado, que é justamente onde o catálogo não tem resposta.
 */
function codigoDoEmpreendimento(
  catalogo: Array<{ codes: string[]; stageIds: string[] }>,
  cadastro: null | LinhaDoCadastro,
  c2xEnterpriseId: string,
): null | string {
  for (const emp of catalogo) {
    const posicao = emp.stageIds.findIndex((id) => String(id) === c2xEnterpriseId);
    const code = posicao >= 0 ? emp.codes[posicao] : null;
    if (code) return code.toUpperCase();
  }
  return cadastro?.codigo || null;
}

/** Os planos que o simulador oferece para esta unidade: Panteon primeiro, C2X depois. */
async function planosDaUnidade(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  familia: string[],
  codigo: null | string,
): Promise<PlanoComercial[]> {
  // ⚠️ FALHA NÃO DERRUBA A TELA, dos dois lados — a mesma escolha da rota `/venda`: sem plano o
  // simulador cai na conta simples, que é o que ele já fazia. Perder a proposta inteira porque o
  // legado não respondeu seria pior.
  const [doC2x, doPanteon] = await Promise.all([
    codigo
      ? lerPlanosDoC2x([codigo]).catch(() => ({ ok: false }) as const)
      : Promise.resolve({ ok: false } as const),
    lerPlanosDoPanteon(admin, familia).catch((erro) => {
      console.error("[hercules][proposta] planos do panteon", erro);
      return [];
    }),
  ]);

  return planosPreferindoOPanteon(
    doC2x.ok ? doC2x.empreendimentos : [],
    doPanteon,
  ).flatMap((e) => e.planos);
}

/** A % mínima de entrada DESTE empreendimento. Nulo = a tela cai no padrão da casa. */
async function pisoDaEntrada(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  c2xEnterpriseId: string,
): Promise<null | number> {
  const { data, error } = await admin
    .from("apolo_enterprise_settings")
    .select("entrada_minima_percentual")
    .eq("enterprise_id", c2xEnterpriseId)
    .maybeSingle();

  if (error) {
    // ⚠️ AUSENTE ≠ ZERO. Falha de leitura devolve nulo, e nulo cai no padrão da casa (10%);
    // devolver 0 liberaria venda sem entrada porque o banco piscou.
    console.error("[hercules][proposta] entrada minima", error);
    return null;
  }
  return numeroDoBanco((data as null | { entrada_minima_percentual: null | number | string })?.entrada_minima_percentual);
}

/** Nome de imobiliária e corretor, para a tela e para o papel. */
async function nomesDasEntidades(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  ids: string[],
): Promise<Map<string, string>> {
  const alvos = [...new Set(ids.filter(Boolean))];
  const nomes = new Map<string, string>();
  if (alvos.length === 0) return nomes;

  const { data } = await admin
    .from("apolo_entities")
    .select("id, display_name, legal_name, trade_name")
    .in("id", alvos);

  for (const e of (data ?? []) as Array<{
    display_name: null | string;
    id: string;
    legal_name: null | string;
    trade_name: null | string;
  }>) {
    nomes.set(e.id, (e.trade_name || e.display_name || e.legal_name || "").trim());
  }
  return nomes;
}

export async function GET(request: Request) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  const unidadeId = (new URL(request.url).searchParams.get("unidade") ?? "").trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Informe a unidade." }, { status: 400 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));
    const { data } = await admin
      .from("hercules_unidades")
      .select("id,codigo,quadra,lote,situacao,preco_tabela,area,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle();

    const unidade = data as null | UnidadeDaProposta;
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    const reserva = await reservaDaUnidade(admin, unidade.id);
    if (!reserva) {
      return NextResponse.json({ error: "Não há reserva ativa nesta unidade." }, { status: 409 });
    }
    if (reserva.situacao !== "ativa") {
      return NextResponse.json(
        { error: "Esta reserva já virou proposta." },
        { status: 409 },
      );
    }

    const titular = titularDaReserva(reserva.proponentes);
    if (!titular) {
      // Reserva sem proponente é dado quebrado, não "reserva inexistente": a unidade está travada
      // por uma linha que ninguém consegue transformar em proposta.
      return NextResponse.json(
        { error: "Esta reserva está sem o cliente titular. Cancele e reserve de novo." },
        { status: 409 },
      );
    }

    const cadastro = await carregarCadastroDeEmpreendimentos();
    const catalogo = await catalogoDeEmpreendimentos(Date.now());
    const c2xId = String(unidade.enterprise_id);
    const empreendimento = empreendimentoDaUnidade(cadastro, c2xId);

    // ⚠️ A FAMÍLIA E O GRUPO, e não só o id da unidade. `apolo_esteira.enterprise_id` guarda
    // "35" e "group:Vale do Ouro" — e há CAD viva nas duas formas. Sem `familiaDoEmpreendimento`
    // (pai e filhos) e `comIdsDoGrupo` (o grupo que as divisões cobrem), a CAD credenciada some e
    // a resposta vira "não credenciado" na cara do corretor. É a mesma expansão que a rota
    // `/venda` faz antes de `lerEsteiraDoEscopo`.
    const familia = familiaDoEmpreendimento(cadastro, c2xId);
    const escopoDaEsteira = comIdsDoGrupo(familia, catalogo, permitidos);

    const [credenciamento, planos, entradaMinimaPercentual, nomes] = await Promise.all([
      credenciadoParaVender(admin, { cpf: titular.cpf, enterpriseIds: escopoDaEsteira }),
      planosDaUnidade(admin, familia, codigoDoEmpreendimento(catalogo, empreendimento, c2xId)),
      pisoDaEntrada(admin, c2xId),
      nomesDasEntidades(admin, [
        reserva.imobiliaria_entity_id ?? "",
        reserva.corretor_entity_id ?? "",
      ]),
    ]);

    return NextResponse.json(
      {
        data: {
          credenciamento: {
            credenciado: credenciamento.credenciado,
            desde: credenciamento.desde,
            etapa: credenciamento.etapa,
            motivo: credenciamento.motivo,
          },
          entradaMinimaPercentual,
          planos,
          reserva: {
            codigo: codigoDaVenda(reserva.protocolo_numero),
            corretor: reserva.corretor_entity_id
              ? {
                  id: reserva.corretor_entity_id,
                  nome: nomes.get(reserva.corretor_entity_id) || "Corretor",
                }
              : null,
            criadoEm: reserva.criado_em,
            id: reserva.id,
            imobiliaria: reserva.imobiliaria_entity_id
              ? {
                  id: reserva.imobiliaria_entity_id,
                  nome: nomes.get(reserva.imobiliaria_entity_id) || "Imobiliária",
                }
              : null,
            titular,
            validadeEm: reserva.validade_em,
          },
          unidade: {
            enterpriseId: c2xId,
            id: unidade.id,
            nome: nomeDaUnidade(unidade),
            preco: numeroDoBanco(unidade.preco_tabela) ?? 0,
            produto: empreendimento?.nome ?? "Empreendimento",
          },
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    // ⚠️ ERRO DE LEITURA DO CREDENCIAMENTO NÃO É RECUSA. `FalhaAoLerCredenciamento` chega aqui e
    // vira 503, nunca "este cliente não está credenciado": a diferença entre "o sistema não sabe" e
    // "a resposta é não" é a diferença entre um retry e um telefonema para a coordenação.
    console.error("[hercules][proposta] falha ao carregar", erro);
    return NextResponse.json(
      { error: "Não foi possível carregar a proposta agora." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: {
    anuaisQuantidade?: unknown;
    anuaisValor?: unknown;
    compradores?: unknown;
    diaDeVencimento?: unknown;
    entradaValor?: unknown;
    entradaParcelas?: unknown;
    entradaVezes?: unknown;
    observacao?: unknown;
    parcelasMensais?: unknown;
    planoNome?: unknown;
    /** Pede o PDF de prévia e para antes de gravar — ver o passo 6.5. */
    previa?: unknown;
    primeiraParcelaEm?: unknown;
    unidadeId?: unknown;
    prazoEmDias?: unknown;
    valorNegociado?: unknown;
  };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const unidadeId = String(corpo.unidadeId ?? "").trim();
  const planoNome = String(corpo.planoNome ?? "").trim();

  try {
    // ── 1. Escopo e unidade ────────────────────────────────────────────────
    const permitidos = new Set(await idsDaSessao(auth.sessao));
    const { data } = await admin
      .from("hercules_unidades")
      .select("id,codigo,quadra,lote,situacao,preco_tabela,area,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle();

    const unidade = data as null | UnidadeDaProposta;
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ── 2. A reserva viva ──────────────────────────────────────────────────
    const reserva = await reservaDaUnidade(admin, unidade.id);
    if (!reserva) {
      return NextResponse.json({ error: "Não há reserva ativa nesta unidade." }, { status: 409 });
    }
    if (reserva.situacao !== "ativa") {
      return NextResponse.json(
        { error: "Esta reserva já virou proposta." },
        { status: 409 },
      );
    }

    // ── 3. O TITULAR É O DA RESERVA ────────────────────────────────────────
    const titular = titularDaReserva(reserva.proponentes);
    if (!titular) {
      return NextResponse.json(
        { error: "Esta reserva está sem o cliente titular. Cancele e reserve de novo." },
        { status: 409 },
      );
    }

    const cadastro = await carregarCadastroDeEmpreendimentos();
    const catalogo = await catalogoDeEmpreendimentos(Date.now());
    const c2xId = String(unidade.enterprise_id);
    const empreendimento = empreendimentoDaUnidade(cadastro, c2xId);
    if (!empreendimento) {
      return NextResponse.json(
        { error: "Este empreendimento ainda não está no cadastro do Hércules." },
        { status: 409 },
      );
    }

    const familia = familiaDoEmpreendimento(cadastro, c2xId);
    const escopoDaEsteira = comIdsDoGrupo(familia, catalogo, permitidos);

    // ── 4. A CAD do titular, credenciada NESTE empreendimento ──────────────
    const credenciamento = await credenciadoParaVender(admin, {
      cpf: titular.cpf,
      enterpriseIds: escopoDaEsteira,
    });
    if (!credenciamento.credenciado) {
      // A frase vem da lib: ela é quem sabe dizer "em análise de crédito desde 02/09", que é uma
      // conversa; "não credenciado" seria um muro.
      return NextResponse.json(
        { error: credenciamento.motivo ?? "A CAD deste cliente não está credenciada." },
        { status: 403 },
      );
    }

    // ── 5. A régua da proposta ─────────────────────────────────────────────
    //
    // ⚠️ OS COMPRADORES DO CORPO ENTRAM SEM O TÍTULO. Quem é titular é decidido AQUI, pelo CPF que
    // está na reserva: a tela manda a lista com as participações, e o nome e o documento do titular
    // são os da reserva, não os que vieram no JSON. Um cliente diferente no corpo simplesmente não
    // vira titular — e sem titular a régua recusa a proposta inteira.
    const cpfDoTitular = soDigitos(titular.cpf);
    let jaMarcouTitular = false;
    const compradores: CompradorGravado[] = (
      Array.isArray(corpo.compradores) ? corpo.compradores : []
    ).map((bruto) => {
      const c = (bruto ?? {}) as Record<string, unknown>;
      const cpf = String(c.cpf ?? "");
      const ehOTitular = !jaMarcouTitular && soDigitos(cpf) === cpfDoTitular && cpfDoTitular !== "";
      if (ehOTitular) jaMarcouTitular = true;
      return {
        cpf: ehOTitular ? titular.cpf : cpf,
        nome: ehOTitular ? titular.nome : String(c.nome ?? "").trim(),
        participacao: numeroDoCorpo(c.participacao),
        // ⚠️ O TELEFONE DO TITULAR É O DA RESERVA, pela mesma razão do nome e do CPF: ele não se
        // troca por HTTP. O do proponente adicional é o único contato que a casa vai ter dele.
        telefone: ehOTitular ? telefoneEscrito(titular.telefone) : telefoneEscrito(c.telefone),
        titular: ehOTitular,
      };
    });

    const entradaMinimaPercentual = await pisoDaEntrada(admin, c2xId);
    const primeiraParcelaEm = String(corpo.primeiraParcelaEm ?? "").trim();

    // ── ATÉ QUANDO ESTA PROPOSTA VALE ──────────────────────────────────────
    //
    // ⚠️ QUEM CONFERE A DATA É `conferirProposta`, E POR ISSO ELA TEM QUE ENTRAR NO PEDIDO. A régua
    // já recusa data ilegível, data no passado e prazo acima de `PRAZO_MAXIMO_DA_PROPOSTA` — mas só
    // roda sobre o que está no objeto: um campo esquecido aqui não vira erro, vira coluna nula, e a
    // proposta nasce sem prazo com o PDF anunciando preço sem data de fim.
    //
    // ⚠️ AUSENTE CAI NO PRAZO PADRÃO; ILEGÍVEL, NÃO. A tela manda a data escolhida nos chips, mas um
    // cliente que ainda não conhece o campo (a tela em cache do navegador, ou uma chamada antiga)
    // continuaria gerando proposta — e recusá-lo por 422 pararia a venda por causa de um campo que
    // ele não sabe existir. O padrão de 7 dias é o mesmo prazo que o papel já imprimia antes da
    // 0132, então o silêncio de quem não manda nada continua valendo o que sempre valeu. Já
    // "quinta que vem" é uma escolha ERRADA, não uma ausência: cair no padrão aí seria corrigir em
    // silêncio o que a pessoa digitou e prometer ao cliente uma data que ninguém escolheu.
    //
    // ⚠️ `??` NÃO TROCA STRING VAZIA — o campo vazio do formulário chega como `""`, e `"" ?? padrão`
    // continua `""`. Por isso o teste é explícito.
    // ⚠️ QUEM CONTA OS DIAS É O SERVIDOR, e a tela manda só QUANTOS. A versão anterior recebia a
    // data pronta, e isso punha o relógio do navegador para decidir quando a proposta vence: quem
    // abrisse a modal às 23h55 e enviasse às 00h05 gravaria o prazo contado a partir de ONTEM — três
    // dias de chip virando dois e pouco —, e uma aba deixada aberta além do prazo passava a receber
    // 422 numa data que ninguém digitou, sem jeito de consertar clicando no mesmo prazo. Com o
    // número de dias, a data nasce do relógio de quem valida, e o formato deixa de existir como
    // problema: nada de data curta ancorando em meia-noite UTC e gravando um dia a menos do que o
    // papel imprime.
    const prazoPedido = numeroDoCorpo(corpo.prazoEmDias);
    const prazoEmDias = (PRAZOS_DA_PROPOSTA as readonly number[]).includes(prazoPedido)
      ? prazoPedido
      : PRAZO_PADRAO_DA_PROPOSTA;
    const validadeEm = vencimentoEmDias(new Date().toISOString(), prazoEmDias);

    const pedido: PedidoDeProposta = {
      anuaisQuantidade:
        corpo.anuaisQuantidade === null || corpo.anuaisQuantidade === undefined
          ? 0
          : numeroDoCorpo(corpo.anuaisQuantidade),
      anuaisValor:
        corpo.anuaisValor === null || corpo.anuaisValor === undefined
          ? 0
          : numeroDoCorpo(corpo.anuaisValor),
      compradores,
      entradaMinimaPercentual,
      entradaValor: numeroDoCorpo(corpo.entradaValor),
      entradaParcelas: parcelasDoCorpo(corpo.entradaParcelas),
      entradaVezes: numeroDoCorpo(corpo.entradaVezes),
      parcelas: numeroDoCorpo(corpo.parcelasMensais),
      primeiraParcelaEm,
      reservaId: reserva.id,
      unidadeId: unidade.id,
      validadeEm,
      valorNegociado: numeroDoCorpo(corpo.valorNegociado),
      vencimentoDia: numeroDoCorpo(corpo.diaDeVencimento),
    };

    // ⚠️ O PLANO NÃO É CONFERIDO POR `conferirProposta`, e não é esquecimento: qual plano existe
    // neste empreendimento é fato do BANCO (C2X + Panteon), do mesmo jeito que o credenciamento —
    // e a lib pura não toca banco. Por isso o erro dele é montado aqui e ENTRA na mesma lista, para
    // a tela mostrar tudo o que falta de uma vez, e não um problema por clique.
    const planos = await planosDaUnidade(
      admin,
      familia,
      codigoDoEmpreendimento(catalogo, empreendimento, c2xId),
    );
    const plano = planos.find((p) => p.nome.trim() === planoNome) ?? null;

    // ⚠️ A TABELA VAI JUNTO PARA A RÉGUA, e é o que faz a faixa do prazo VALER. Sem estes planos,
    // `conferirProposta` só conhece o piso da casa (10%) e uma proposta de 30 parcelas com entrada
    // de 10% passa inteira — a regra que o Lucas ditou existiria só como texto vermelho na tela.
    // Os planos já estão carregados aqui para conferir o `planoNome`; é a mesma leitura.
    pedido.planosDaTabela = planos.map((p) => ({
      entradaPercentual: p.entradaPercentual,
      nome: p.nome,
      parcelas: p.parcelas,
    }));

    const erros: Array<{ campo: string; mensagem: string }> = [
      ...conferirProposta(pedido, new Date().toISOString()),
    ];
    if (!plano) {
      erros.push({
        campo: "plano",
        mensagem: planoNome
          ? `O plano "${planoNome}" não está disponível neste empreendimento.`
          : "Escolha o plano da proposta.",
      });
    }
    if (erros.length > 0 || !plano) {
      return NextResponse.json({ erros }, { status: 422 });
    }

    // ── 6. O cronograma ────────────────────────────────────────────────────
    //
    // ⚠️ O LANÇO DELE VIRA 422, NUNCA 500. `montarCronograma` quebra de propósito quando a
    // composição não fecha (entrada + valor presente dos balões maior do que o negociado) ou
    // quando a data é impossível: é uma correção que quem está montando a proposta consegue fazer
    // na tela, e um 500 diria "erro no sistema" para um pedido que só precisa de outro número.
    let cronograma;
    try {
      cronograma = montarCronograma({
        anuaisQuantidade: pedido.anuaisQuantidade ?? 0,
        anuaisValor: pedido.anuaisValor ?? 0,
        diaDeVencimento: pedido.vencimentoDia,
        entradaValor: pedido.entradaValor,
        entradaParcelas: pedido.entradaParcelas,
        entradaVezes: pedido.entradaVezes,
        parcelasMensais: pedido.parcelas,
        plano,
        primeiraParcelaDaEntrada: pedido.primeiraParcelaEm,
        valorNegociado: pedido.valorNegociado,
      });
    } catch (erro) {
      return NextResponse.json(
        {
          erros: [
            {
              campo: "entrada",
              mensagem:
                erro instanceof Error ? erro.message : "Não foi possível montar o fluxo de pagamento.",
            },
          ],
        },
        { status: 422 },
      );
    }

    // ── 7. A gravação ──────────────────────────────────────────────────────
    const agora = new Date().toISOString();
    const codigo = codigoDaVenda(reserva.protocolo_numero);
    const nomes = await nomesDasEntidades(admin, [
      reserva.imobiliaria_entity_id ?? "",
      reserva.corretor_entity_id ?? "",
    ]);
    const nomeDaImobiliaria = reserva.imobiliaria_entity_id
      ? nomes.get(reserva.imobiliaria_entity_id) || "Imobiliária"
      : null;
    const nomeDoCorretor = reserva.corretor_entity_id
      ? nomes.get(reserva.corretor_entity_id) || null
      : null;
    const unidadeEscrita = nomeDaUnidade(unidade);

    // ── 6½. A PRÉVIA PARA AQUI ─────────────────────────────────────────────
    //
    // Lucas (05/09/2026): *"podia ter um botão para ter uma prévia da proposta"*.
    //
    // ⚠️ É A MESMA ROTA, E ESSE É O PONTO. Escopo, reserva viva, titular, CAD credenciada, régua da
    // proposta (com a faixa do prazo), plano e cronograma já rodaram — todos exatamente como no
    // caminho que grava. Uma rota separada teria de repetir os sete passos, e no dia em que um
    // deles mudasse a prévia passaria a mostrar um papel que o "Gerar" não produz mais.
    //
    // ⚠️ E ELA PARA ANTES DA PRIMEIRA ESCRITA. Daqui para baixo é `insert`, unidade ocupada,
    // reserva consumida e três WhatsApps; a prévia devolve o papel e encerra. Se a régua recusar,
    // ela recusa igual — quem não pode gerar também não precisa de prévia de uma proposta que não
    // vai existir, e o coordenador vê o mesmo 422 que veria ao gerar.
    if (corpo.previa === true) {
      // ⚠️ O RODAPÉ SAI DA MESMA FONTE DO PDF DEFINITIVO, e não de atalhos daqui. A primeira versão
      // montava o atendimento à mão e errava duas linhas do papel que o coordenador está
      // conferindo: punha o nome de QUEM CLICOU no lugar do coordenador da venda, e imprimia o
      // TELEFONE DO CLIENTE onde o documento traz o da imobiliária — um dado do comprador num papel
      // que circula por WhatsApp. `destinatariosDaVenda` é leitura pura (não dispara nada) e é ela
      // que o `guardarOPdf` usa; sem imobiliária na reserva, o rodapé sai sem a linha, que é o
      // mesmo que aconteceria lá.
      const paraORodape = reserva.imobiliaria_entity_id
        ? await destinatariosDaVenda(admin, {
            corretorId: reserva.corretor_entity_id,
            empreendimento: { c2xId, nome: empreendimento.nome },
            imobiliariaId: reserva.imobiliaria_entity_id,
          }).catch(() => null)
        : null;

      const bytes = await bytesDoPdfDaProposta(
        admin,
        {
          atendimento: {
            coordenador: paraORodape?.coordenadores[0]?.nome ?? null,
            corretor: paraORodape?.corretor?.nome ?? nomeDoCorretor,
            imobiliaria: paraORodape?.imobiliaria.nome ?? nomeDaImobiliaria,
            telefone: paraORodape?.imobiliaria.telefone ?? null,
          },
          codigo,
          compradores,
          cronograma,
          diaDeVencimento: pedido.vencimentoDia,
          empreendimento,
          enterpriseId: c2xId,
          plano,
          propostaId: null,
          unidade,
          unidadeEscrita,
          validadeEmIso: validadeEm,
          valorNegociado: pedido.valorNegociado,
        },
        true,
      );

      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `inline; filename="Previa-${codigo || "proposta"}.pdf"`,
          "Content-Type": "application/pdf",
        },
      });
    }

    const { data: criada, error } = await admin
      .from("hercules_propostas")
      .insert({
        // A carga do C2X preenche esta coluna e ninguem a le hoje; gravada aqui para a proposta
        // nativa nao ser a unica linha da tabela com o campo em branco.
        aberta: true,
        cliente_documento: cpfDoTitular,
        // A CAD que DECIDIU o credenciamento — é por ela que se abre a ficha do cliente depois.
        cliente_entity_id: credenciamento.entityId,
        cliente_nome: titular.nome,
        compradores,
        // O cronograma inteiro, como ele foi impresso: é o que responde "o que a proposta
        // prometeu" quando o plano do empreendimento mudar no ano que vem.
        condicoes: cronograma,
        // ⚠️ O PRAZO CONTRATADO É ESTE, e é ele que a tela mostra. `fluxoDoPlano`
        // (lib/hercules/fluxo-de-venda.ts) prefere `contrato_parcelas` e só cai em
        // `plano_parcelas` quando o contrato não tem o dele — deixar esta coluna nula fazia a
        // proposta de 120x que o coordenador acabou de montar aparecer como "180x" na lista,
        // porque 180 é o tamanho do MOLDE. É exatamente o erro que já estampou "144x" no extrato
        // de um contrato de 62 parcelas, e a lição está escrita: `commercial_plans.parcels` é
        // molde, `payments.total_parcels` é contrato.
        contrato_parcelas: pedido.parcelas,
        corretor_entity_id: reserva.corretor_entity_id,
        corretor_nome: nomeDoCorretor,
        criado_por: auth.sessao.usuarioId,
        criado_por_nome: auth.sessao.usuarioNome,
        dia_vencimento: pedido.vencimentoDia,
        // ⚠️ SEM ESTE CÓDIGO A PROPOSTA NASCE INVISÍVEL: a rota `/venda` filtra por ele.
        empreendimento_codigo: codigoDoEmpreendimento(catalogo, empreendimento, c2xId),
        empreendimento_id: empreendimento.id,
        etapa: "proposta",
        // ⚠️ SEM ESTA DATA O MAPA CONTINUA PINTANDO "RESERVADO": é o `etapa_desde` mais recente
        // que decide a cor da unidade e as ações que a tela oferece.
        etapa_desde: agora,
        imobiliaria_entity_id: reserva.imobiliaria_entity_id,
        imobiliaria_nome: nomeDaImobiliaria,
        observacao: String(corpo.observacao ?? "").trim() || null,
        origem: "panteon",
        parcelas_sinal: pedido.entradaVezes,
        plano_nome: plano.nome,
        // ⚠️ ESTE É O MOLDE, E FICA — não é o prazo desta venda (esse é `contrato_parcelas`, acima).
        // Ele existe para responder "de que produto esta proposta saiu": as 4.857 linhas importadas
        // do C2X só têm este número, e apagá-lo aqui faria a proposta nativa ser a única sem a
        // referência do plano que a originou. Quem lê os dois lado a lado enxerga o desconto de
        // prazo que o coordenador deu.
        plano_parcelas: plano.parcelas,
        primeiro_sinal: diaDoCalendario(pedido.primeiraParcelaEm),
        // O COD é o MESMO da reserva, copiado: um número novo aqui quebraria a única coisa que
        // amarra a venda do primeiro telefonema ao contrato assinado.
        protocolo_numero: reserva.protocolo_numero,
        reserva_id: reserva.id,
        unidade_id: unidade.id,
        unidade_nome: unidadeEscrita,
        // ⚠️ A VALIDADE FICA GRAVADA, e é ela que o documento repete depois. Antes da 0132 o PDF
        // somava sete dias na hora de imprimir: a mesma proposta reimpressa em dezembro dizia que
        // valia até dezembro, e o papel do cliente deixava de bater com o que foi prometido.
        validade_em: pedido.validadeEm,
        valor: pedido.valorNegociado,
        workspace_id: WORKSPACE,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      // 23505 = `hercules_propostas_uma_viva_por_unidade`: alguém gerou primeiro.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Esta unidade já tem uma proposta gerada." },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    const propostaId = (criada as null | { id: string })?.id ?? null;

    // ── 8. A reserva passa a `proposta` ────────────────────────────────────
    //
    // ⚠️ ELA CONTINUA TRAVANDO A UNIDADE (o índice parcial cobre `ativa` e `proposta`), e continua
    // sendo o histórico de quem reservou. O `.eq("situacao", "ativa")` repete a condição de
    // propósito: dois cliques no mesmo segundo não podem converter a mesma reserva duas vezes.
    // ⚠️ O `.select()` NÃO É ENFEITE: sem ele, update que casa ZERO linhas devolve `error: null` e
    // passa por sucesso. E o zero-linhas aqui tem um cenário real — a reserva foi CANCELADA por
    // outra pessoa nos segundos entre a leitura (passo 2) e este ponto, que demora o quanto levam
    // o credenciamento, o cadastro, o catálogo do C2X e os planos. Nesse caso a reserva já saiu de
    // `ativa`, a unidade já voltou para `disponivel`, os três já receberam "reserva cancelada" —
    // e seguir daqui gravaria uma proposta viva sobre um lote livre, que aceitaria reserva de
    // outro cliente enquanto o primeiro anda com um PDF de preço na mão.
    const { data: movida, error: erroDaReserva } = await admin
      .from("hercules_reservas")
      .update({ atualizado_em: agora, situacao: "proposta" })
      .eq("id", reserva.id)
      .eq("situacao", "ativa")
      .select("id");

    if (erroDaReserva) {
      // Não derruba: a proposta já existe e é ela que representa a venda. O funil não duplica
      // porque `/venda` descarta a reserva da unidade que já tem proposta viva.
      console.error("[hercules][proposta] falha ao mover a reserva", erroDaReserva);
    } else if (!movida || movida.length === 0) {
      // ⚠️ DESFAZ A PROPOSTA QUE ACABOU DE NASCER. Ela é de segundos atrás, ninguém foi avisado
      // ainda (o passo 9 vem depois) e nenhum PDF saiu: apagá-la é mais honesto do que deixar uma
      // venda viva sobre um lote que a tela mostra livre. O `delete` é seguro justamente porque
      // esta linha não teve tempo de virar referência de nada.
      console.error("[hercules][proposta] a reserva saiu de 'ativa' durante a geração", {
        propostaId,
        reservaId: reserva.id,
      });
      if (propostaId) {
        await admin.from("hercules_propostas").delete().eq("id", propostaId);
      }
      return NextResponse.json(
        { error: "A reserva desta unidade foi cancelada enquanto a proposta era montada." },
        { status: 409 },
      );
    }

    // ── 9. O PDF e os três avisos ──────────────────────────────────────────
    //
    // ⚠️ DAQUI PARA BAIXO NADA DERRUBA A PROPOSTA, que já está gravada. Um WhatsApp que não sai
    // volta como aviso na resposta; uma exceção aqui viraria 503 numa operação que deu certo, e o
    // coordenador tentaria de novo por cima do índice único.
    const avisos = await avisar(admin, {
      c2xId,
      // O elo do PDF com a ficha do cliente no Apolo — a mesma entidade que decidiu o
      // credenciamento, e o hash do CPF do titular. Ver a 0136.
      clienteDocumentoHash: hashIdentifier("cpf", cpfDoTitular),
      clienteEntityId: credenciamento.entityId,
      codigo,
      compradores,
      corretorId: reserva.corretor_entity_id,
      cronograma,
      empreendimento,
      imobiliariaId: reserva.imobiliaria_entity_id,
      pedido,
      plano,
      propostaId,
      protocolo: reserva.protocolo_numero,
      titular,
      unidade,
      unidadeEscrita,
    });

    return NextResponse.json({ data: { avisos, codigo, id: propostaId } });
  } catch (erro) {
    if (erro instanceof FalhaAoLerCredenciamento) {
      console.error("[hercules][proposta] credenciamento ilegível", erro);
      return NextResponse.json(
        { error: "Não foi possível conferir o credenciamento agora. Tente de novo." },
        { status: 503 },
      );
    }
    console.error("[hercules][proposta] falha ao gerar", erro);
    return NextResponse.json({ error: "Não foi possível gerar a proposta agora." }, { status: 503 });
  }
}

/**
 * A reserva que trava esta unidade — `ativa` ou já convertida.
 *
 * ⚠️ AS DUAS SITUAÇÕES VÊM JUNTAS DE PROPÓSITO, e quem chama separa. "Não há reserva" e "a reserva
 * já virou proposta" são coisas diferentes para quem está na tela: a primeira manda reservar, a
 * segunda diz que o trabalho já foi feito. Buscar só a `ativa` faria as duas responderem a mesma
 * frase, e o coordenador reservaria de novo por cima do índice único.
 */
async function reservaDaUnidade(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  unidadeId: string,
): Promise<null | ReservaViva> {
  const { data, error } = await admin
    .from("hercules_reservas")
    .select(
      "id, situacao, protocolo_numero, proponentes, imobiliaria_entity_id, corretor_entity_id, criado_em, validade_em",
    )
    .eq("workspace_id", WORKSPACE)
    .eq("unidade_id", unidadeId)
    .in("situacao", ["ativa", "proposta"])
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as null | ReservaViva) ?? null;
}

type ResultadoDoAviso = { motivo?: string; ok: boolean; para: string };

/**
 * Monta o PDF, guarda e manda para corretor, imobiliária e coordenador.
 *
 * ⚠️ NUNCA LANÇA. Ver o aviso do passo 9.
 *
 * ⚠️ O PDF FICA GUARDADO no bucket privado `apolo-documents`, sob `hercules-propostas/`, e não é
 * só para o gateway baixar: é a peça que o comprador recebeu. Quando ele voltar em dezembro
 * dizendo "a proposta falava em 120 parcelas", a resposta é o arquivo, não uma reimpressão com o
 * plano de hoje.
 *
 * ⚠️ E SE O PDF NÃO SAIR, O TEXTO SAI ASSIM MESMO. A proposta já está gravada; segurar o aviso
 * porque o storage falhou deixaria os três sem saber que a venda andou. O resultado diz que o
 * anexo não seguiu.
 */
async function avisar(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  dados: {
    c2xId: string;
    /** O elo do PDF com a ficha do cliente no Apolo. Ver a 0136. */
    clienteDocumentoHash: null | string;
    clienteEntityId: null | string;
    codigo: string;
    compradores: CompradorDoPedido[];
    corretorId: null | string;
    cronograma: ReturnType<typeof montarCronograma>;
    empreendimento: LinhaDoCadastro;
    imobiliariaId: null | string;
    pedido: PedidoDeProposta;
    plano: PlanoComercial;
    propostaId: null | string;
    /** O COD em número — é ele que agrupa o documento na aba. */
    protocolo: null | number;
    titular: Proponente;
    unidade: UnidadeDaProposta;
    unidadeEscrita: string;
  },
): Promise<ResultadoDoAviso[]> {
  // Sem imobiliária não há para quem mandar pelo caminho do Relacionamento (o `entity_id` do
  // registro do disparo é o dela, inclusive o do coordenador). A proposta continua gravada.
  if (!dados.imobiliariaId) {
    return [{ motivo: "reserva sem imobiliária", ok: false, para: "imobiliaria" }];
  }

  try {
    const destinatarios = await destinatariosDaVenda(admin, {
      corretorId: dados.corretorId,
      empreendimento: { c2xId: dados.c2xId, nome: dados.empreendimento.nome },
      imobiliariaId: dados.imobiliariaId,
    });

    const primeiraMensal = dados.cronograma.mensais[0] ?? null;
    // ⚠️ "PARCELA FIXA" É A PROMESSA MAIS CARA DA MENSAGEM, e ela só vale quando NADA muda: nem
    // degrau do SACOC (mais de uma faixa de reajuste) nem índice no aniversário. Na dúvida, a
    // mensagem promete de menos.
    const parcelaFixa =
      dados.cronograma.reajustes.length <= 1 && dados.plano.indiceCorrecao === "SEM_CORRECAO";

    const anexo = await guardarOPdf(admin, {
      atendimento: {
        coordenador: destinatarios.coordenadores[0]?.nome ?? null,
        corretor: destinatarios.corretor?.nome ?? null,
        imobiliaria: destinatarios.imobiliaria.nome,
        telefone: destinatarios.imobiliaria.telefone,
      },
      clienteDocumentoHash: dados.clienteDocumentoHash,
      clienteEntityId: dados.clienteEntityId,
      codigo: dados.codigo,
      compradores: dados.compradores,
      cronograma: dados.cronograma,
      diaDeVencimento: dados.pedido.vencimentoDia,
      empreendimento: dados.empreendimento,
      enterpriseId: dados.c2xId,
      protocolo: dados.protocolo,
      propostaId: dados.propostaId,
      unidade: dados.unidade,
      unidadeEscrita: dados.unidadeEscrita,
      // A MESMA data que acabou de ir para `validade_em`: o papel repete o que ficou gravado.
      validadeEmIso: dados.pedido.validadeEm,
      valorNegociado: dados.pedido.valorNegociado,
      plano: dados.plano,
    });

    const textos = avisosDaProposta({
      cliente: dados.titular.nome,
      codigo: dados.codigo,
      compradores: dados.compradores.length,
      corretor: destinatarios.corretor?.nome ?? null,
      cpf: dados.titular.cpf,
      empreendimento: dados.empreendimento.nome,
      entradaTotal: dados.cronograma.totais.entrada,
      // A primeira parcela da entrada, para a mensagem não prometer parcelas iguais numa entrada
      // montada à mão. Sai do cronograma, que é a série de verdade.
      entradaPrimeira: dados.cronograma.entrada[0]?.valor ?? null,
      entradaVezes: dados.cronograma.entrada.length,
      imobiliaria: destinatarios.imobiliaria.nome,
      parcela: primeiraMensal?.valor ?? 0,
      parcelaFixa,
      parcelas: dados.cronograma.mensais.length,
      primeiraParcelaEm: dados.pedido.primeiraParcelaEm,
      unidade: dados.unidadeEscrita,
      validadeEm: dados.pedido.validadeEm,
      valorNegociado: dados.pedido.valorNegociado,
      vencimentoDia: dados.pedido.vencimentoDia,
    });

    const resultados = await avisarSobreAVenda(admin, {
      anexo,
      corretorId: dados.corretorId,
      destinatarios,
      imobiliariaId: dados.imobiliariaId,
      origem: "proposta:whatsapp",
      textos,
      tipo: "hercules_proposta",
    });

    // ⚠️ O AVISO DIZ QUANDO O PDF NÃO FOI. Sem isto, "enviado" cobriria o caso em que os três
    // receberam só o texto — e ninguém iria atrás do documento que o cliente precisa assinar.
    return anexo
      ? resultados
      : [
          ...resultados,
          {
            motivo: "não foi possível gerar o PDF; os três receberam só o texto",
            ok: false,
            // ⚠️ "documento" E NÃO "pdf": esta lista vira frase na tela por `comoFoiOAviso`, e ela
            // escreve o `para` cru — "falhou para documento" se lê, "falhou para pdf" não.
            para: "documento",
          },
        ];
  } catch (erro) {
    console.error("[hercules][proposta] falha ao avisar", erro);
    return [];
  }
}

/** Tudo o que a folha precisa saber. O mesmo objeto serve à prévia e ao documento definitivo. */
type DadosDoPdfDaProposta = {
  atendimento: {
    coordenador: null | string;
    corretor: null | string;
    imobiliaria: null | string;
    telefone: null | string;
  };
  codigo: string;
  compradores: CompradorDoPedido[];
  cronograma: ReturnType<typeof montarCronograma>;
  diaDeVencimento: number;
  empreendimento: LinhaDoCadastro;
  enterpriseId: string;
  plano: PlanoComercial;
  /** O elo com o Apolo, para o PDF aparecer na ficha do cliente. Ver a 0136. */
  clienteDocumentoHash?: null | string;
  clienteEntityId?: null | string;
  propostaId: null | string;
  /** O COD em número — é ele que agrupa o documento na aba. */
  protocolo?: null | number;
  unidade: UnidadeDaProposta;
  unidadeEscrita: string;
  /** O ISO gravado em `hercules_propostas.validade_em`, não um prazo recontado na impressão. */
  validadeEmIso: string;
  valorNegociado: number;
};

/**
 * OS BYTES DO PDF — a mesma montagem para a prévia e para o documento que vai por WhatsApp.
 *
 * ⚠️ UMA MONTAGEM SÓ, DE PROPÓSITO. Uma prévia montada por outro caminho seria um papel que
 * concorda com o definitivo até o dia em que um dos dois mudar — e quem confere a prévia está
 * justamente conferindo o que o cliente vai receber. `previa` muda só a tarja.
 */
async function bytesDoPdfDaProposta(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  dados: DadosDoPdfDaProposta,
  previa = false,
): Promise<Uint8Array> {
  const folha = montarFolhaDaProposta({
    atendimento: dados.atendimento,
    codigo: dados.codigo,
    compradores: dados.compradores.map((c) => ({
      cpf: c.cpf,
      nome: c.nome,
      participacao: c.participacao,
    })),
    cronograma: dados.cronograma,
    diaDeVencimento: dados.diaDeVencimento,
    emitidaEmIso: new Date().toISOString(),
    empreendimento: dados.empreendimento.nome,
    logoC2x: logoDoC2x(),
    logoEmpreendimento: await logoDoEmpreendimento(admin, dados.enterpriseId),
    plano: dados.plano,
    unidade: {
      area: numeroDoBanco(dados.unidade.area),
      cidade: dados.empreendimento.cidade,
      nome: dados.unidadeEscrita,
      uf: dados.empreendimento.uf,
    },
    validadeEmIso: dados.validadeEmIso,
    valorNegociado: dados.valorNegociado,
  });

  return montarPropostaPdf({ ...folha, previa });
}

/** O PDF montado, guardado no storage e com link assinado. `null` quando qualquer etapa falha. */
async function guardarOPdf(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  dados: DadosDoPdfDaProposta,
): Promise<null | { fileName: string; url: string }> {
  try {
    const bytes = await bytesDoPdfDaProposta(admin, dados);
    // O id da proposta é o nome do arquivo: um por proposta, sem sobrescrever a do vizinho. Sem
    // id (gravação que não devolveu a linha) o COD serve, porque ele também é único.
    const nome = dados.propostaId || dados.codigo || `${Date.now()}`;
    const caminho = `${PASTA_DAS_PROPOSTAS}/${nome}.pdf`;

    const up = await admin.storage
      .from(APOLO_DOCS_BUCKET)
      .upload(caminho, bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) {
      console.error("[hercules][proposta] falha ao guardar o PDF", up.error);
      return null;
    }

    // ⚠️ O PDF DA PROPOSTA ENTRA NA ABA DOCUMENTOS (Lucas, 06/09/2026: *"a proposta, bem como o
    // contrato, boletos também podem ser guardados nessa aba de documentos"*). O arquivo já estava
    // no bucket desde a v1.282.0; o que faltava era a linha que o torna ACHÁVEL — sem ela, o papel
    // que o cliente recebeu por WhatsApp só existia no histórico do disparo.
    //
    // ⚠️ NÃO DERRUBA A PROPOSTA SE FALHAR. A proposta está gravada, a unidade andou e o WhatsApp vai
    // sair; recusar aqui desfaria uma venda por causa de um registro de conveniência. E o `upsert`
    // do arquivo é por COD, então gerar de novo não duplica o objeto — a linha, sim, é conferida
    // antes, para o mesmo COD não virar dois documentos na aba.
    if (dados.propostaId) {
      try {
        const { data: jaTem } = await admin
          .from("hercules_documentos")
          .select("id")
          .eq("workspace_id", WORKSPACE)
          .eq("proposta_id", dados.propostaId)
          .eq("tipo", "proposta")
          .is("removido_em", null)
          .limit(1);

        if (!((jaTem ?? []) as unknown[]).length) {
          await admin.from("hercules_documentos").insert({
            caminho,
            cliente_documento_hash: dados.clienteDocumentoHash ?? null,
            cliente_entity_id: dados.clienteEntityId ?? null,
            empreendimento_codigo: dados.empreendimento.codigo ?? null,
            enviado_por_nome: dados.atendimento.coordenador,
            mime: "application/pdf",
            nome: `Proposta ${dados.codigo}.pdf`,
            proposta_id: dados.propostaId,
            protocolo_numero: dados.protocolo ?? null,
            tamanho_bytes: bytes.byteLength,
            tipo: "proposta",
            unidade_id: dados.unidade.id,
            workspace_id: WORKSPACE,
          });
        }
      } catch (erro) {
        console.error("[hercules][proposta] falha ao registrar o PDF como documento", erro);
      }
    }

    const assinada = await admin.storage
      .from(APOLO_DOCS_BUCKET)
      .createSignedUrl(caminho, VALIDADE_DO_LINK_EM_SEGUNDOS);
    const url = assinada.data?.signedUrl;
    if (!url) return null;

    return { fileName: `Proposta-${dados.codigo || nome}.pdf`, url };
  } catch (erro) {
    console.error("[hercules][proposta] falha ao montar o PDF", erro);
    return null;
  }
}

/**
 * A marca do C2X do rodapé, lida do repositório.
 *
 * ⚠️ `public/` NÃO VAI SOZINHO PARA O FILESYSTEM DA FUNÇÃO — ele é servido pelo CDN, e o
 * rastreador do Next só inclui o que vê importado. Por isso a rota está em
 * `outputFileTracingIncludes` (next.config.ts). Falhar aqui NÃO derruba a proposta: o PDF aceita
 * logo nula e sai sem a marca, que é infinitamente melhor do que não sair.
 */
function logoDoC2x(): null | Uint8Array {
  try {
    return new Uint8Array(fs.readFileSync(path.join(process.cwd(), "public", "c2x-logo.png")));
  } catch {
    return null;
  }
}

/** A logo do empreendimento, do mesmo lugar em que o Apolo a guarda (`enterprise-logos/{id}`). */
async function logoDoEmpreendimento(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  enterpriseId: string,
): Promise<null | Uint8Array> {
  try {
    // ⚠️ `chaveDaLogo` É OBRIGATÓRIA: quem gravou usou a mesma transformação, e o id do grupo
    // ("group:Lagoa Bonita") vira `group_Lagoa_Bonita` no storage. Procurar o id cru nunca acha.
    const { data, error } = await admin.storage
      .from(APOLO_DOCS_BUCKET)
      .download(`enterprise-logos/${chaveDaLogo(enterpriseId)}`);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}

// ── O CANCELAMENTO DA PROPOSTA ──────────────────────────────────────────────
//
// Lucas (05/09/2026), escolhendo construir isto antes de subir o Gerar proposta: *"da reserva eu
// tenho dois caminhos"* — e a proposta também precisa dos dois.
//
// ⚠️ SEM ESTA ROTA, CADA "GERAR PROPOSTA" TIRAVA UM LOTE DO ESTOQUE PARA SEMPRE. Com a unidade em
// `proposta` os quatro botões da tela apagam, e o PATCH da reserva responde "o cancelamento é o da
// proposta" — apontando para uma rota que não existia. Cliente desiste, crédito reprova, o
// coordenador errou o plano: a rotina do comercial deixava o lote preso, com o PDF e o preço já na
// mão de três pessoas de fora, e o único jeito de soltar era UPDATE na mão no banco.
//
// ⚠️ TRÊS LINHAS MUDAM JUNTAS, e nenhuma é opcional: a PROPOSTA vira `cancelado`, a RESERVA que ela
// consumiu sai de `proposta` para `cancelada`, e a UNIDADE volta para `disponivel`. Esquecer a
// reserva prenderia o lote de outro jeito, mais difícil de enxergar: o índice
// `hercules_reservas_uma_viva_por_unidade` barra nova reserva enquanto a situação for 'ativa' ou
// 'proposta', então a unidade apareceria disponível na tela e recusaria a próxima reserva com erro
// de banco.
//
// ⚠️ PATCH, E NÃO DELETE — a mesma razão da reserva. A proposta cancelada continua respondendo
// "quem tinha este lote e por quê", e o histórico da unidade lê `cancelada_em` para montar o evento.
export async function PATCH(request: Request) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: Partial<PedidoDeCancelamentoDaProposta>;
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const pedido: PedidoDeCancelamentoDaProposta = {
    detalhe: typeof corpo.detalhe === "string" ? corpo.detalhe : null,
    motivo: String(corpo.motivo ?? "").trim(),
    propostaId: typeof corpo.propostaId === "string" ? corpo.propostaId.trim() || null : null,
    unidadeId: String(corpo.unidadeId ?? "").trim(),
  };

  const erros = conferirCancelamentoDaProposta(pedido);
  if (erros.length > 0) {
    return NextResponse.json({ erros }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const { data } = await admin
      .from("hercules_unidades")
      .select("id,codigo,quadra,lote,situacao,preco_tabela,enterprise_id,area")
      .eq("workspace_id", WORKSPACE)
      .eq("id", pedido.unidadeId)
      .maybeSingle();

    const unidade = data as null | UnidadeDaProposta;
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ⚠️ SÓ A PROPOSTA NATIVA E ABERTA. `origem = 'panteon'` mantém de fora as 4.857 importadas do
    // C2X — cancelar por aqui uma venda que mora no legado escreveria no Panteon um cancelamento
    // que o C2X nunca saberia, e os dois passariam a discordar sobre o mesmo lote.
    const { data: linha } = await admin
      .from("hercules_propostas")
      .select(
        "id, etapa, protocolo_numero, codigo, compradores, cliente_nome, reserva_id, imobiliaria_entity_id, corretor_entity_id, empreendimento_id",
      )
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      .eq("origem", "panteon")
      .eq("etapa", "proposta")
      .maybeSingle();

    const proposta = linha as null | {
      cliente_nome: null | string;
      codigo: null | string;
      compradores: unknown;
      corretor_entity_id: null | string;
      empreendimento_id: null | string;
      etapa: string;
      id: string;
      imobiliaria_entity_id: null | string;
      protocolo_numero: null | number;
      reserva_id: null | string;
    };

    if (!proposta) {
      return NextResponse.json({ error: "Não há proposta aberta nesta unidade." }, { status: 409 });
    }

    // ⚠️ A TELA DIZ QUAL PROPOSTA ELA ESTÁ VENDO, e aqui as duas têm que ser a mesma. Ver o aviso
    // em `PedidoDeCancelamentoDaProposta`: sem esta conferência, uma aba aberta desde cedo cancela
    // a proposta que nasceu depois — de outro cliente, com outro corretor, e os três recebem o
    // aviso com o nome errado. Opcional para não quebrar quem já tem a tela carregada sem o campo.
    if (pedido.propostaId && pedido.propostaId !== proposta.id) {
      return NextResponse.json(
        { error: "Esta unidade já tem outra proposta. Recarregue a tela antes de cancelar." },
        { status: 409 },
      );
    }

    const motivo = motivoEscrito(pedido.motivo, pedido.detalhe);
    const agora = new Date().toISOString();

    const { data: cancelada, error } = await admin
      .from("hercules_propostas")
      .update({
        atualizado_em: agora,
        cancelada_em: agora,
        cancelada_motivo: motivo,
        cancelada_por: auth.sessao.usuarioId,
        cancelada_por_nome: auth.sessao.usuarioNome,
        etapa: "cancelado",
        // ⚠️ O MAPA PINTA PELA PROPOSTA DE `etapa_desde` MAIS RECENTE. Sem mexer nesta data, o
        // cancelamento entraria no histórico com o carimbo da geração e o lote poderia continuar
        // pintado como proposto.
        etapa_desde: agora,
      })
      .eq("id", proposta.id)
      // ⚠️ A CONDIÇÃO REPETIDA É A TRAVA DO CLIQUE DUPLO, igual à da reserva: sem ela, dois
      // coordenadores no mesmo lote cancelam duas vezes e saem dois WhatsApps de cancelamento.
      .eq("etapa", "proposta")
      .select("id");

    if (error) throw new Error(error.message);

    // ⚠️ SEM LINHA CASADA, NINGUÉM AVISA NINGUÉM. Outra sessão chegou primeiro: a proposta já não
    // está em `proposta`, e seguir daqui mandaria o segundo aviso e devolveria "cancelado" para
    // quem não cancelou nada.
    if (!cancelada || cancelada.length === 0) {
      return NextResponse.json(
        { error: "Esta proposta acabou de ser cancelada em outra tela." },
        { status: 409 },
      );
    }

    // A reserva que virou esta proposta volta a ser história. Ver o aviso do topo: sem isto a
    // unidade aparece livre e recusa a próxima reserva.
    //
    // ⚠️ A RESERVA CAI ANTES DA UNIDADE, E O ERRO É LIDO. Esta ordem não é estética: são três
    // gravações sem transação (o cliente do Supabase não tem uma), e a única forma de nenhuma
    // falha deixar lote preso é soltar a unidade POR ÚLTIMO, depois que as duas linhas que a
    // travam já caíram. Engolir o erro daqui — que era o que este bloco fazia — produzia o pior
    // estado possível: unidade `disponivel` com a reserva parada em `proposta`, que a tela Venda
    // NÃO ENXERGA (ela só lê reserva `ativa`) e que o índice
    // `hercules_reservas_uma_viva_por_unidade` continua ocupando. O lote aparecia verde, o botão
    // Reservar acendia, e o insert morria em 23505 traduzido como "acabou de ser reservada por
    // outra pessoa" — mandando o coordenador procurar um colega que não existe. Sem log, sem
    // saída pela tela, para sempre: exatamente o lote preso que esta rota veio acabar.
    if (proposta.reserva_id) {
      // ⚠️ SÓ A SITUAÇÃO, SEM OS CAMPOS `cancelada_*` — e a diferença é o que a ficha do lote conta.
      // Esta reserva não foi cancelada por ninguém: ela foi CONSUMIDA pela proposta lá atrás, e
      // agora cai junto com ela. Preenchendo `cancelada_em` aqui, `eventosDaReserva` passava a
      // emitir "Reserva cancelada" ao lado de "Proposta cancelada" — duas linhas vermelhas no
      // MESMO segundo, com o mesmo motivo, o mesmo COD e o mesmo autor, para um clique só. A
      // segunda registra um ato que ninguém praticou, na tela cuja regra é justamente não atribuir
      // ato a quem não o praticou. O que aconteceu tem um nome, e ele já está na linha de cima.
      const { error: erroDaReserva } = await admin
        .from("hercules_reservas")
        .update({ atualizado_em: agora, situacao: "cancelada" })
        .eq("id", proposta.reserva_id)
        .in("situacao", ["ativa", "proposta"]);

      if (erroDaReserva) {
        console.error("[hercules][proposta] falha ao cancelar a reserva de origem", erroDaReserva);
        // ⚠️ PARA AQUI, COM A UNIDADE AINDA PRESA — e isso é de propósito. A proposta já está
        // `cancelado`, então este mesmo botão funciona de novo assim que a pessoa tentar outra
        // vez; parar antes de soltar a unidade mantém o estado CONSISTENTE (lote travado, os três
        // ainda sem aviso) em vez de deixá-lo travado e anunciado como livre.
        return NextResponse.json(
          { error: "A proposta foi cancelada, mas a reserva não. Tente de novo em instantes." },
          { status: 503 },
        );
      }
    }

    // ⚠️ A UNIDADE VOLTA ANTES DO AVISO, como no cancelamento da reserva: se o WhatsApp falhar, o
    // lote já está livre para vender. O contrário — lote preso porque uma mensagem não saiu —
    // custaria uma venda. Mas o erro é LIDO: unidade parada em `reservada` sem reserva nem
    // proposta viva vira etapa `reservada` no funil e apaga os quatro botões da tela — outro lote
    // preso, pela outra ponta.
    const { error: erroDaUnidade } = await admin
      .from("hercules_unidades")
      .update({ atualizado_em: agora, situacao: "disponivel" })
      .eq("id", unidade.id);

    if (erroDaUnidade) {
      console.error("[hercules][proposta] falha ao liberar a unidade", erroDaUnidade);
      return NextResponse.json(
        { error: "A proposta foi cancelada, mas a unidade não foi liberada. Chame o suporte." },
        { status: 503 },
      );
    }

    const cadastro = await carregarCadastroDeEmpreendimentos();
    const nomeDoEmpreendimento =
      cadastro.find((l) => l.id === proposta.empreendimento_id)?.nome ??
      // Proposta sem `empreendimento_id` gravado ainda tem o id do C2X na unidade: o nome vai na
      // mensagem que três pessoas leem, e "empreendimento" no lugar dele é um recado sem endereço.
      cadastro.find((l) => String(l.c2xEnterpriseId) === String(unidade.enterprise_id))?.nome ??
      "empreendimento";

    const titular = Array.isArray(proposta.compradores)
      ? (proposta.compradores[0] as null | { nome?: unknown })
      : null;
    const cliente =
      (typeof titular?.nome === "string" && titular.nome.trim()) ||
      proposta.cliente_nome ||
      "cliente";
    const codigo = proposta.codigo || codigoDaVenda(proposta.protocolo_numero);

    // Proposta sem imobiliária não tem para quem avisar: o registro do disparo pendura na ficha
    // dela, inclusive o do coordenador. É a mesma regra do cancelamento da reserva.
    let avisos: ResultadoDoAviso[] = [];
    const imobiliariaId = proposta.imobiliaria_entity_id;
    if (imobiliariaId) {
      const destinatarios = await destinatariosDaVenda(admin, {
        corretorId: proposta.corretor_entity_id,
        empreendimento: { c2xId: String(unidade.enterprise_id), nome: nomeDoEmpreendimento },
        imobiliariaId,
      });
      avisos = await avisarSobreAVenda(admin, {
        corretorId: proposta.corretor_entity_id,
        destinatarios,
        imobiliariaId,
        origem: "proposta:cancelamento",
        textos: avisosDeCancelamentoDaProposta({
          cliente,
          codigo,
          corretor: destinatarios.corretor?.nome ?? null,
          empreendimento: nomeDoEmpreendimento,
          imobiliaria: destinatarios.imobiliaria.nome,
          motivo,
          unidade: nomeDaUnidade(unidade),
        }),
        tipo: "hercules_proposta",
      });
    }

    return NextResponse.json({ data: { avisos, codigo, id: proposta.id } });
  } catch (erro) {
    console.error("[hercules][proposta] falha ao cancelar", erro);
    return NextResponse.json({ error: "Não foi possível cancelar agora." }, { status: 503 });
  }
}
