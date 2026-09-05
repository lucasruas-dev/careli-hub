import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { soDigitos } from "@/lib/apolo/documento";
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { chaveDaLogo } from "@/lib/apolo/enterprise-logos";
import { autorizar, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { comIdsDoGrupo } from "@/lib/apolo/incorporador/resumo-do-produto";
import type { PlanoComercial } from "@/lib/apolo/planos-comerciais";
import { lerPlanosDoC2x } from "@/lib/apolo/planos-comerciais-c2x";
import { createApoloAdminClient } from "@/lib/apolo/server";
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
  type CompradorDoPedido,
  diaDoCalendario,
  type PedidoDeProposta,
  conferirProposta,
} from "@/lib/hercules/proposta";
import { montarPropostaPdf } from "@/lib/hercules/proposta-pdf";
import { montarFolhaDaProposta } from "@/lib/hercules/proposta-para-pdf";
import { familiaDoEmpreendimento } from "@/lib/hercules/quem-pode-vender";

// A PROPOSTA DA UNIDADE — o segundo passo da venda, saindo da reserva que já existe.
//
// Lucas (04/09/2026): *"da reserva eu tenho dois caminhos, gerar proposta ou cancelar"*, *"o
// cliente é o da reserva e não se troca"*, *"dá para adicionar proponentes, cada um informa a % de
// participação"*, *"para virar proposta a CAD do titular tem que estar credenciada naquele
// empreendimento"*, *"depois vem a montagem no simulador"* e *"ao gerar, a proposta fica cadastrada
// e o PDF vai por WhatsApp para coordenador, imobiliária e corretor"*.
//
// ⚠️ O ESQUELETO É O DA ROTA DE RESERVA, e de propósito: `autorizar`, escopo do COOKIE por
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
  const auth = autorizar(request);
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
  const auth = autorizar(request);
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
    entradaVezes?: unknown;
    observacao?: unknown;
    parcelasMensais?: unknown;
    planoNome?: unknown;
    primeiraParcelaEm?: unknown;
    unidadeId?: unknown;
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
      entradaVezes: numeroDoCorpo(corpo.entradaVezes),
      parcelas: numeroDoCorpo(corpo.parcelasMensais),
      primeiraParcelaEm,
      reservaId: reserva.id,
      unidadeId: unidade.id,
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
    const { error: erroDaReserva } = await admin
      .from("hercules_reservas")
      .update({ atualizado_em: agora, situacao: "proposta" })
      .eq("id", reserva.id)
      .eq("situacao", "ativa");

    if (erroDaReserva) {
      // Não derruba: a proposta já existe e é ela que representa a venda. O funil não duplica
      // porque `/venda` descarta a reserva da unidade que já tem proposta viva.
      console.error("[hercules][proposta] falha ao mover a reserva", erroDaReserva);
    }

    // ── 9. O PDF e os três avisos ──────────────────────────────────────────
    //
    // ⚠️ DAQUI PARA BAIXO NADA DERRUBA A PROPOSTA, que já está gravada. Um WhatsApp que não sai
    // volta como aviso na resposta; uma exceção aqui viraria 503 numa operação que deu certo, e o
    // coordenador tentaria de novo por cima do índice único.
    const avisos = await avisar(admin, {
      c2xId,
      codigo,
      compradores,
      corretorId: reserva.corretor_entity_id,
      cronograma,
      empreendimento,
      imobiliariaId: reserva.imobiliaria_entity_id,
      pedido,
      plano,
      propostaId,
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
    codigo: string;
    compradores: CompradorDoPedido[];
    corretorId: null | string;
    cronograma: ReturnType<typeof montarCronograma>;
    empreendimento: LinhaDoCadastro;
    imobiliariaId: null | string;
    pedido: PedidoDeProposta;
    plano: PlanoComercial;
    propostaId: null | string;
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
      codigo: dados.codigo,
      compradores: dados.compradores,
      cronograma: dados.cronograma,
      diaDeVencimento: dados.pedido.vencimentoDia,
      empreendimento: dados.empreendimento,
      enterpriseId: dados.c2xId,
      propostaId: dados.propostaId,
      unidade: dados.unidade,
      unidadeEscrita: dados.unidadeEscrita,
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
      entradaVezes: dados.cronograma.entrada.length,
      imobiliaria: destinatarios.imobiliaria.nome,
      parcela: primeiraMensal?.valor ?? 0,
      parcelaFixa,
      parcelas: dados.cronograma.mensais.length,
      primeiraParcelaEm: dados.pedido.primeiraParcelaEm,
      unidade: dados.unidadeEscrita,
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

/** O PDF montado, guardado no storage e com link assinado. `null` quando qualquer etapa falha. */
async function guardarOPdf(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  dados: {
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
    propostaId: null | string;
    unidade: UnidadeDaProposta;
    unidadeEscrita: string;
    valorNegociado: number;
  },
): Promise<null | { fileName: string; url: string }> {
  try {
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
      valorNegociado: dados.valorNegociado,
    });

    const bytes = await montarPropostaPdf(folha);
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
