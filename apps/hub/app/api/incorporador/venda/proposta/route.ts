import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { soDigitos } from "@/lib/apolo/documento";
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { chaveDaLogo } from "@/lib/apolo/enterprise-logos";
import { autorizarOperacaoDeVenda } from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { autorizarEscritaNoProduto } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import {
  credenciamentoParaOPortal,
  escopoDaEsteiraDoPortal,
  escopoDoTitular,
} from "@/lib/apolo/incorporador/familia-no-portal";
import { ehPortalComercial } from "@/lib/apolo/incorporador/perfis-de-portal";
import type { PlanoComercial } from "@/lib/apolo/planos-comerciais";
import { lerPlanosDoC2x } from "@/lib/apolo/planos-comerciais-c2x";
import { createApoloAdminClient, hashIdentifier } from "@/lib/apolo/server";
import { descontoDoPlano, type ModoDoAjuste } from "@/lib/hercules/ajuste-de-preco";

import {
  avisarSobreAVenda,
  destinatariosDaVenda,
  registrarAvisoNaoEnviado,
  vendaAvisaPeloWhatsapp,
} from "@/lib/hercules/avisos-da-venda";
// ⚠️ O TIPO VEM DE LÁ, E NÃO É REESCRITO AQUI. `bens-e-permutas.ts` não importa ninguém de
// propósito (é a conta que a régua, o cronograma e a tela compartilham), então esta rota pode
// depender dele sem ciclo. Uma segunda definição do mesmo objeto é como a rota passaria a aceitar
// um `entraComo` que a régua não conhece, sem o typecheck dizer nada.
import {
  type BemOuPermuta,
  conferirBensEPermutasDoCorpo,
} from "@/lib/hercules/bens-e-permutas";
import {
  carregarCadastroDeEmpreendimentos,
  type LinhaDoCadastro,
} from "@/lib/hercules/cadastro";
import { desfechoDaUnidade, soltarLoteDaVendaDesfeita } from "@/lib/hercules/cancelar-reserva-server";
import { lerSituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";
import { fraseDoConflito, outrosDonosDoLote } from "@/lib/hercules/trava-do-lote";
import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";
import {
  credenciadoParaVender,
  FalhaAoLerCredenciamento,
} from "@/lib/hercules/cliente-credenciado";
import { montarCronograma } from "@/lib/hercules/cronograma";
import {
  lerComColunasDoApartamento,
  nomeDaUnidade,
  tipoDaUnidade,
} from "@/lib/hercules/nome-da-unidade";
import type { TipoProduto } from "@/lib/hercules/produto-novo";
import { lerFaixasDoPanteon } from "@/lib/hercules/planos-do-panteon";
import type { FaixaDePrazo } from "@/lib/hercules/premissa-do-prazo";
import { descontoDoPlanoNoPrazo } from "@/lib/hercules/tabela-do-lote";
import { rotuloDoIndice } from "@/lib/temis/planos";
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
import {
  motivoEscrito,
  SEM_PRECO_PARA_PROPOSTA,
  semPrecoDeTabela,
  vencimentoEmDias,
} from "@/lib/hercules/reserva";

// A PROPOSTA DA UNIDADE — o segundo passo da venda, saindo da reserva que já existe.
//
// Lucas (04/09/2026): *"da reserva eu tenho dois caminhos, gerar proposta ou cancelar"*, *"o
// cliente é o da reserva e não se troca"*, *"dá para adicionar proponentes, cada um informa a % de
// participação"*, *"para virar proposta a CAD do titular tem que estar credenciada naquele
// empreendimento"*, *"depois vem a montagem no simulador"* e *"ao gerar, a proposta fica cadastrada
// e o PDF vai por WhatsApp para coordenador, imobiliária e corretor"*.
//
// ⚠️ O ESQUELETO É O DA ROTA DE RESERVA, e de propósito: `autorizarOperacaoDeVenda`, escopo do
// COOKIE por `idsDaSessao` (nunca do corpo), unidade fora do escopo respondendo 404 igual a inexistente — o
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
  /** Só no prédio (0171). Ausente quando a coluna ainda não existe. */
  apartamento?: null | string;
  area: null | number | string;
  codigo: string;
  enterprise_id: string;
  id: string;
  lote: null | string;
  preco_tabela: null | number | string;
  quadra: null | string;
  situacao: string;
  /** Só no prédio. Nulo = torre única. */
  torre?: null | string;
};

/**
 * A unidade pelo id, com as colunas do prédio quando a 0171 já existe.
 *
 * ⚠️ UMA LEITURA PARA OS TRÊS VERBOS (16/09/2026). É desta linha que `nomeDaUnidade` escreve o
 * WhatsApp e o PDF: sem apartamento e torre, a proposta de um apto sairia com o código cru. Sem a
 * 0171, repete sem as colunas (`lerComColunasDoApartamento`), e o loteamento sai como sempre.
 */
async function unidadePorId(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  unidadeId: string,
): Promise<null | UnidadeDaProposta> {
  const { data } = await lerComColunasDoApartamento((extras) =>
    admin
      .from("hercules_unidades")
      .select(`id,codigo,quadra,lote,situacao,preco_tabela,area,enterprise_id${extras}`)
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle(),
  );
  return (data ?? null) as unknown as null | UnidadeDaProposta;
}

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

// ⚠️ O TETO, O TAMANHO DA DESCRIÇÃO E A CONFERÊNCIA DA LISTA MUDARAM DE CASA (23/09/2026): vivem
// em `lib/hercules/bens-e-permutas.ts`. O teto e o tamanho saíram daqui porque a TELA precisa deles
// para apagar o botão "Acrescentar" no décimo item e cortar a digitação na descrição; a CONFERÊNCIA
// saiu porque o espelho público passou a aceitar permuta e agora são duas rotas lendo a mesma lista
// — uma com login e outra sem nenhum. Os números e a régua são os mesmos: nada aqui afrouxou.

/**
 * O banco ainda sem a 0187: o PostgREST não conhece a coluna `bens_e_permutas`.
 *
 * ⚠️ SÃO DOIS CÓDIGOS PORQUE SÃO DUAS CAMADAS. `42703` é o Postgres dizendo "undefined column"
 * (quando a consulta chega ao banco) e `PGRST204` é o PostgREST barrando antes, pelo cache de
 * schema dele — que continua desatualizado por um tempo mesmo DEPOIS de a migration rodar. Tratar
 * só um dos dois deixa metade dos minutos seguintes ao deploy derrubando proposta.
 *
 * ⚠️ E O NOME DA COLUNA ENTRA NA CONTA, como em `semAColunaDoTerreno` (`criar-reserva.ts`). Sem
 * ele, qualquer outra coluna que faltasse nesta tabela viraria "refaz sem os bens" — a rota
 * esconderia um erro de schema de verdade gravando uma proposta incompleta.
 */
function semAColunaDeBens(erro: { code?: string; message?: string }): boolean {
  return (
    (erro.code === "PGRST204" || erro.code === "42703") &&
    /bens_e_permutas/.test(String(erro.message ?? ""))
  );
}

/** `numeric` do Postgres chega como STRING no PostgREST: somar sem converter concatena. */
function numeroDoBanco(
  valor: null | number | string | undefined,
): null | number {
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
  const telefone =
    typeof primeiro.telefone === "string" ? primeiro.telefone : "";
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
    const posicao = emp.stageIds.findIndex(
      (id) => String(id) === c2xEnterpriseId,
    );
    const code = posicao >= 0 ? emp.codes[posicao] : null;
    if (code) return code.toUpperCase();
  }
  return cadastro?.codigo || null;
}

/**
 * O plano como a Mesa o recebe: o `PlanoComercial` da conta, mais o id da linha que o originou.
 *
 * ⚠️ O ID SÓ EXISTE DO LADO DO PANTEON, e é por isso que ele é opcional. `comoPlano` carrega
 * `temis_planos.id` em todo plano cadastrado aqui; os que vêm do C2X (`commercial_plans`, lidos por
 * slot) não têm id nenhum para carregar. `PlanosDoEmpreendimento.planos` é tipado como
 * `PlanoComercial` porque as duas fontes se misturam ali, e o id se perde no TIPO — não no objeto.
 */
type PlanoDaMesa = PlanoComercial & { id?: null | string };

/** Os planos que o simulador oferece para esta unidade: Panteon primeiro, C2X depois. */
async function planosDaUnidade(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  familia: string[],
  codigo: null | string,
): Promise<PlanoDaMesa[]> {
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

  // ⚠️ A LISTA É A DA FAMÍLIA ACHATADA, E É UMA SÓ PARA OS DOIS USOS. `familia` traz o pai e os
  // irmãos (a mesma expansão da esteira), e desta lista saem tanto o plano da proposta quanto
  // `pedido.planosDaTabela`, que a régua confere. Em 22/09/2026 este `flatMap` chegou a carimbar o
  // `enterpriseId` de cada plano para um recorte por empreendimento que foi desfeito no mesmo dia:
  // com ele, a rota escolhia o plano numa lista e conferia a proposta noutra, e uma proposta do LBF
  // gravava `plano.entradaPercentual = 20` ao lado de uma entrada de 12%, no mesmo objeto.
  return planosPreferindoOPanteon(
    doC2x.ok ? doC2x.empreendimentos : [],
    doPanteon,
  ).flatMap((e) => e.planos as PlanoDaMesa[]);
}

/**
 * O plano desta proposta: pelo ID da linha de `temis_planos`, com o nome como reserva.
 *
 * ⚠️ O NOME NÃO É CHAVE, E ISSO CUSTA DINHEIRO DE VERDADE. Até 22/09/2026 a rota casava o plano por
 * `p.nome.trim() === planoNome`, e os nomes dos planos são texto que o cadastro edita. No dia em que
 * o Garden trocou NORMAL por INVESTIDOR, INVESTIDOR PARCELADO por PROMOÇÃO PARCELADO e INVESTIDOR
 * por PROMOÇÃO À VISTA, um simulador que já estava aberto continuou mandando `planoNome:
 * "INVESTIDOR"` querendo o plano de 36 parcelas — e o nome passou a casar com a linha de 60. O
 * objeto ia inteiro para `montarCronograma` e congelava na gravação: medido no banco, o de 36x tem
 * `juros_taxa` 0,000000 e o de 60x tem 6,000000 ao ano. São 6% ao ano gravados numa proposta de
 * verdade, num cronograma que alimenta o contrato. Não é tela errada, é dinheiro errado que fica.
 *
 * ⚠️ OS DOIS SÃO ACEITOS DE PROPÓSITO. O id é a chave; o nome é a reserva para quem não o manda —
 * qualquer aba aberta antes desta subida, e o C2X, que não tem o que mandar (`commercial_plans` é
 * lido por slot e não tem id que sobreviva à leitura, então lá o nome é a única chave que existe).
 * Recusar tudo o que chega sem id pararia a venda de todo mundo no minuto do deploy.
 *
 * ⚠️ ID QUE NÃO CASA NÃO CAI NO NOME. Seria reabrir exatamente o buraco: a tela velha manda o id
 * certo E o nome velho, e um fallback silencioso a levaria de volta para a linha renomeada. Id que
 * não existe mais é uma frase para o coordenador, não um palpite.
 *
 * ⚠️ E O CAMINHO SEM ID É O `find` DE SEMPRE, DESFEITO E DEVOLVIDO NO MESMO DIA EM QUE SAIU
 * (22/09/2026). Duas regras nasceram aqui junto com o casamento por id, e as duas saíram por
 * medição, porque mudavam regra de venda de quem não pediu nada:
 *
 *   • A TRAVA DO NOME AMBÍGUO (recusar com 422 quando dois planos de mesmo nome discordavam no
 *     dinheiro) PARAVA A VENDA DO LAGOA BONITA INTEIRA, hoje e sem rename nenhum. `planosDaUnidade`
 *     achata a família (pai e irmãos), e medido em 22/09/2026 no banco: o "NORMAL 01" do LBR
 *     (enterprise 27) pede 12% de entrada e o do LBF (enterprise 33) pede 20%, os dois cadastrados
 *     de propósito; o "INVESTIDOR 02" tem a mesma diferença. São cadastros CERTOS, de produtos
 *     diferentes, que a trava comparava como se fossem candidatos ao mesmo lote.
 *
 *   • O RECORTE POR EMPREENDIMENTO DA UNIDADE, criado para consertar a trava, GRAVAVA PROPOSTA QUE
 *     SE CONTRADIZIA: ele escolhia o plano numa lista recortada enquanto a tela e
 *     `pedido.planosDaTabela` continuavam olhando a família inteira. Medido: uma proposta do LBF
 *     congelava `plano.entradaPercentual = 20` ao lado de uma entrada de 12%, no mesmo objeto.
 *
 * O nome repetido escolhe o PRIMEIRO da lista, como sempre escolheu. Quem fecha esse buraco é o id,
 * que a tela passou a mandar — e não uma recusa que para venda legítima para todo mundo.
 */
function escolherPlanoDaProposta(
  planos: PlanoDaMesa[],
  escolhido: { id: string; nome: string },
): { motivo: string; plano: null } | { motivo: null; plano: PlanoDaMesa } {
  if (escolhido.id) {
    const porId = planos.find(
      (p) => String(p.id ?? "").trim() === escolhido.id,
    );
    return porId
      ? { motivo: null, plano: porId }
      : {
          motivo:
            "O plano escolhido não está mais disponível neste empreendimento. Abra a proposta de novo e escolha o plano na lista.",
          plano: null,
        };
  }

  if (!escolhido.nome) return { motivo: "Escolha o plano da proposta.", plano: null };

  // ⚠️ ESTE `find` É O DE SEMPRE, LETRA POR LETRA — ver o cabeçalho. Mexer nele é mexer na regra de
  // venda de todo empreendimento servido pelo C2X e de toda aba que ainda não manda o id.
  const porNome = planos.find((p) => p.nome.trim() === escolhido.nome);
  return porNome
    ? { motivo: null, plano: porNome }
    : {
        motivo: `O plano "${escolhido.nome}" não está disponível neste empreendimento.`,
        plano: null,
      };
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
  return numeroDoBanco(
    (data as null | { entrada_minima_percentual: null | number | string })
      ?.entrada_minima_percentual,
  );
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
    nomes.set(
      e.id,
      (e.trade_name || e.display_name || e.legal_name || "").trim(),
    );
  }
  return nomes;
}

export async function GET(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Configuração indisponível." },
      { status: 503 },
    );
  }

  const unidadeId = (
    new URL(request.url).searchParams.get("unidade") ?? ""
  ).trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Informe a unidade." }, { status: 400 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));
    const unidade = await unidadePorId(admin, unidadeId);
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json(
        { error: "Unidade não encontrada." },
        { status: 404 },
      );
    }

    const reserva = await reservaDaUnidade(admin, unidade.id);
    if (!reserva) {
      return NextResponse.json(
        { error: "Não há reserva ativa nesta unidade." },
        { status: 409 },
      );
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
        {
          error:
            "Esta reserva está sem o cliente titular. Cancele e reserve de novo.",
        },
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
    //
    // (16/09/2026) ⚠️ FORA DO COMERCIAL, SÓ A FAMÍLIA DA SESSÃO MAIS O ESPELHO DO PAI
    // (`escopoDaEsteiraDoPortal`): o irmão de outro dono (o 36 do Lino) não entra, e a frase de
    // "CPF sem cadastro no Apolo" vira a de "sem CAD neste empreendimento" para não dizer ao
    // Cecílio se um CPF existe na base da Careli. O comercial segue igual.
    const familia = familiaDoEmpreendimento(cadastro, c2xId);
    const comercial = ehPortalComercial(auth.sessao.tipo);
    const escopoDaEsteira = escopoDoTitular(
      escopoDaEsteiraDoPortal({ c2xId, cadastro, catalogo, comercial, permitidos }),
    );

    const [credenciamentoCru, planos, entradaMinimaPercentual, faixas, nomes] =
      await Promise.all([
        credenciadoParaVender(admin, {
          cpf: titular.cpf,
          enterpriseIds: escopoDaEsteira,
        }),
        planosDaUnidade(
          admin,
          familia,
          codigoDoEmpreendimento(catalogo, empreendimento, c2xId),
        ),
        pisoDaEntrada(admin, c2xId),
        // ⚠️ AS FAIXAS DESTE EMPREENDIMENTO, e falha não derruba a modal: sem elas o simulador cai
        // no comportamento de sempre, que é o de todos os empreendimentos enquanto ninguém
        // cadastrar a primeira faixa (a tabela nasceu vazia na 0155).
        lerFaixasDoPanteon(admin, [String(c2xId)]).catch((erro) => {
          console.error("[venda/proposta] faixas de prazo", erro);
          return {} as Record<string, FaixaDePrazo[]>;
        }),
        nomesDasEntidades(admin, [
          reserva.imobiliaria_entity_id ?? "",
          reserva.corretor_entity_id ?? "",
        ]),
      ]);
    const credenciamento = credenciamentoParaOPortal(credenciamentoCru, {
      comercial,
      cpf: titular.cpf,
    });

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
          faixasDePrazo: faixas[String(c2xId)] ?? [],
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
                  nome:
                    nomes.get(reserva.imobiliaria_entity_id) || "Imobiliária",
                }
              : null,
            titular,
            validadeEm: reserva.validade_em,
          },
          unidade: {
            enterpriseId: c2xId,
            id: unidade.id,
            nome: nomeDaUnidade({ ...unidade, tipoProduto: empreendimento?.tipoProduto }),
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
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Configuração indisponível." },
      { status: 503 },
    );
  }

  let corpo: {
    /**
     * O desconto (ou acréscimo) que o coordenador deu, na moeda em que ele o pensou.
     *
     * ⚠️ ELE É GRAVADO, e não só aplicado. `valorNegociado` já vem com o ajuste embutido; sem
     * guardar de onde saiu, ninguém depois sabe se R$ 142.500 foram desconto de 5%, tabela
     * desatualizada ou erro de digitação — e a Têmis não tem como apontar desconto na análise.
     * Ver a 0151.
     */
    ajusteModo?: unknown;
    ajusteValor?: unknown;
    anuaisQuantidade?: unknown;
    anuaisValor?: unknown;
    /**
     * Os bens e permutas recebidos na aquisição (0187). Lucas (22/09/2026): *"Abate, como uma
     * entrada"*, *"Vários"*. Ausente = proposta só em dinheiro.
     */
    bensEPermutas?: unknown;
    compradores?: unknown;
    diaDeVencimento?: unknown;
    entradaValor?: unknown;
    entradaDatas?: unknown;
    entradaParcelas?: unknown;
    entradaVezes?: unknown;
    /** A tabela de reajuste entra na PA? Ausente = não entra (é o padrão novo). */
    incluirReajuste?: unknown;
    observacao?: unknown;
    parcelasMensais?: unknown;
    /**
     * O id da linha de `temis_planos` — a chave do plano desta proposta.
     *
     * ⚠️ ELE MANDA, E O NOME É A RESERVA. Ver `escolherPlanoDaProposta`: nome é texto que o cadastro
     * edita, e casar por nome faz a proposta trocar de plano quando alguém renomeia. A modal o manda
     * desde 22/09/2026 (`ModalDeProposta.corpoDoPedido`); vem ausente da aba aberta antes da subida,
     * e ausente SEMPRE nos empreendimentos servidos pelo C2X, que não têm id para mandar.
     */
    planoId?: unknown;
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
  const planoId = String(corpo.planoId ?? "").trim();
  const planoNome = String(corpo.planoNome ?? "").trim();

  // ⚠️ O AJUSTE É LIDO AQUI E NÃO INFLUENCIA O PREÇO — `valorNegociado` já chega com ele
  // embutido, calculado por `aplicarAjuste` na mesma tela que o digitou. Recalcular aqui abriria
  // a chance de o número gravado discordar do que o coordenador viu e o cliente leu no PDF.
  // O que se guarda é a INTENÇÃO: em que moeda foi pensado e quanto foi dado.
  //
  // ⚠️ MODO INVÁLIDO VIRA "SEM AJUSTE", e não erro: o CHECK da 0151 só aceita 'percentual' ou
  // 'reais', e deixar passar texto livre derrubaria a gravação da proposta inteira por causa de
  // um campo acessório. Ajuste zerado também é nulo — "sem desconto" e "desconto de zero" são a
  // mesma coisa para quem lê depois.
  //
  // ⚠️ E `Number.isFinite` NÃO É ENFEITE: `numeroDoCorpo` devolve NaN quando o campo não vem, e
  // `NaN !== 0` é verdadeiro — sem esta trava, toda proposta sem ajuste tentaria gravar NaN na
  // coluna numérica.
  const modoDoAjuste = String(corpo.ajusteModo ?? "").trim();
  const valorDoAjuste = numeroDoCorpo(corpo.ajusteValor);
  const ajuste: null | { modo: ModoDoAjuste; valor: number } =
    (modoDoAjuste === "percentual" || modoDoAjuste === "reais") &&
    Number.isFinite(valorDoAjuste) &&
    valorDoAjuste !== 0
      ? { modo: modoDoAjuste, valor: valorDoAjuste }
      : null;

  try {
    // ── 1. Escopo e unidade ────────────────────────────────────────────────
    const permitidos = new Set(await idsDaSessao(auth.sessao));
    const unidade = await unidadePorId(admin, unidadeId);
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json(
        { error: "Unidade não encontrada." },
        { status: 404 },
      );
    }

    // ── 1½. Quem opera o produto decide a escrita ──────────────────────────
    //
    // ⚠️ DECISÃO DO LUCAS (16/09/2026): no portal que confecciona (o Cecílio) a proposta só nasce no
    // produto operado por ele. No VOC e no VOR a resposta é 403 com `soConsulta`; sem a 0170, 503. A
    // Gurgel passa sem ida ao banco. Vem antes da prévia também: quem não pode gerar a proposta não
    // precisa do papel dela.
    const escrita = await autorizarEscritaNoProduto(request, auth.sessao, [unidade.enterprise_id]);
    if (!escrita.ok) return escrita.response;
    const sessao = escrita.sessao;

    // ⚠️ SEM PREÇO DE TABELA NÃO HÁ PROPOSTA (achado 15 da onda 2). O `?? 0` lá embaixo congelaria
    // "preço de tabela R$ 0" na proposta e no PDF, e com a venda andando ninguém corrige o preço.
    if (semPrecoDeTabela(unidade.preco_tabela)) {
      return NextResponse.json({ error: SEM_PRECO_PARA_PROPOSTA }, { status: 409 });
    }

    // ── 2. A reserva viva ──────────────────────────────────────────────────
    const reserva = await reservaDaUnidade(admin, unidade.id);
    if (!reserva) {
      return NextResponse.json(
        { error: "Não há reserva ativa nesta unidade." },
        { status: 409 },
      );
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
        {
          error:
            "Esta reserva está sem o cliente titular. Cancele e reserve de novo.",
        },
        { status: 409 },
      );
    }

    const cadastro = await carregarCadastroDeEmpreendimentos();
    const catalogo = await catalogoDeEmpreendimentos(Date.now());
    const c2xId = String(unidade.enterprise_id);
    const empreendimento = empreendimentoDaUnidade(cadastro, c2xId);
    if (!empreendimento) {
      return NextResponse.json(
        {
          error: "Este empreendimento ainda não está no cadastro do Hércules.",
        },
        { status: 409 },
      );
    }

    // Mesma régua do GET: fora do comercial, a família da sessão mais o espelho do pai.
    const familia = familiaDoEmpreendimento(cadastro, c2xId);
    const comercial = ehPortalComercial(sessao.tipo);
    const escopoDaEsteira = escopoDoTitular(
      escopoDaEsteiraDoPortal({ c2xId, cadastro, catalogo, comercial, permitidos }),
    );

    // ── 4. A CAD do titular, credenciada NESTE empreendimento ──────────────
    const credenciamento = credenciamentoParaOPortal(
      await credenciadoParaVender(admin, {
        cpf: titular.cpf,
        enterpriseIds: escopoDaEsteira,
      }),
      { comercial, cpf: titular.cpf },
    );
    if (!credenciamento.credenciado) {
      // A frase vem da lib: ela é quem sabe dizer "em análise de crédito desde 02/09", que é uma
      // conversa; "não credenciado" seria um muro.
      return NextResponse.json(
        {
          error:
            credenciamento.motivo ??
            "A CAD deste cliente não está credenciada.",
        },
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
      const ehOTitular =
        !jaMarcouTitular &&
        soDigitos(cpf) === cpfDoTitular &&
        cpfDoTitular !== "";
      if (ehOTitular) jaMarcouTitular = true;
      return {
        cpf: ehOTitular ? titular.cpf : cpf,
        nome: ehOTitular ? titular.nome : String(c.nome ?? "").trim(),
        participacao: numeroDoCorpo(c.participacao),
        // ⚠️ O TELEFONE DO TITULAR É O DA RESERVA, pela mesma razão do nome e do CPF: ele não se
        // troca por HTTP. O do proponente adicional é o único contato que a casa vai ter dele.
        telefone: ehOTitular
          ? telefoneEscrito(titular.telefone)
          : telefoneEscrito(c.telefone),
        titular: ehOTitular,
      };
    });

    // ── OS BENS E AS PERMUTAS ──────────────────────────────────────────────
    //
    // ⚠️ CONFERIDO AQUI, E NÃO NA RÉGUA. `conferirProposta` é função PURA da composição do
    // pagamento; isto é conferência de FORMATO do que chegou por HTTP, e o 400 dela precisa dizer
    // qual campo de qual item está errado — coisa que a régua, que fala de entrada e parcela, não
    // tem como nomear.
    //
    // ⚠️ E ANTES DO PDF DE PRÉVIA, de propósito: a prévia imprime a proposta, e imprimir uma
    // permuta sem valor (ou com o valor que `Number("")` inventaria) põe no papel do cliente um
    // número que ninguém combinou.
    const bensEPermutas = conferirBensEPermutasDoCorpo(corpo.bensEPermutas);
    if (bensEPermutas.erros.length > 0) {
      return NextResponse.json({ erros: bensEPermutas.erros }, { status: 400 });
    }

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
    /**
     * A tabela de reajuste vai no papel?
     *
     * ⚠️ NÃO ENTRA EM `PedidoDeProposta` DE PROPÓSITO. Aquele tipo é a CONDIÇÃO da venda — o que
     * `conferirProposta` valida e o que o contrato promete —, e isto é uma escolha de como IMPRIMIR
     * o documento. Misturar as duas faria a régua da proposta ter opinião sobre layout.
     *
     * ⚠️ E `=== true` DE PROPÓSITO: ausente, nulo ou qualquer outra coisa é NÃO. O padrão pedido
     * pelo Lucas é a caixa desmarcada, e um corpo antigo (ou um cliente que não conhece o campo)
     * tem que cair no padrão, nunca no contrário.
     */
    const incluirReajuste = corpo.incluirReajuste === true;

    const prazoPedido = numeroDoCorpo(corpo.prazoEmDias);
    const prazoEmDias = (PRAZOS_DA_PROPOSTA as readonly number[]).includes(
      prazoPedido,
    )
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
      // ⚠️ A LISTA ENTRA NO PEDIDO, E É O QUE FAZ O BEM VIRAR CONTA. Até 22/09/2026 ela era
      // conferida acima e gravada na coluna, e NÃO chegava aqui: `conferirProposta` recusava por
      // entrada mínima um carro apontado na entrada (o piso só via dinheiro), e quando o
      // coordenador subia a entrada para passar, o cronograma saía financiando o lote INTEIRO —
      // num lote de R$ 200.000 com carro de R$ 80.000, 120 boletos sobre R$ 180.000. O bem
      // cobrado de novo, em boleto, de quem já o entregou. Meio ligada é pior que desligada.
      bensEPermutas: bensEPermutas.lista,
      compradores,
      entradaMinimaPercentual,
      entradaValor: numeroDoCorpo(corpo.entradaValor),
      // ⚠️ SÓ O FORMATO `AAAA-MM-DD` PASSA, e o resto vira nulo — que quer dizer "use a data
      // calculada". O cronograma refaz essa conferência (`diaEscolhido`), e é ele quem manda; aqui
      // só se evita levar lixo do corpo até lá.
      entradaDatas: Array.isArray(corpo.entradaDatas)
        ? corpo.entradaDatas.map((d) =>
            typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null,
          )
        : null,
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
    // ⚠️ PELO ID DA LINHA, COM O NOME COMO RESERVA — ver `escolherPlanoDaProposta`. O `find` por
    // nome que morava aqui é o que fazia uma proposta de verdade nascer com o plano errado assim
    // que alguém renomeasse a tabela comercial.
    const escolha = escolherPlanoDaProposta(planos, {
      id: planoId,
      nome: planoNome,
    });
    const plano = escolha.plano;

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
    if (!escolha.plano) {
      // ⚠️ A FRASE VEM DA ESCOLHA, e cada caso tem a sua: id que sumiu do cadastro, nome que não
      // existe, nenhum plano escolhido. "Não está disponível" para os três deixaria o coordenador
      // reclicando no mesmo botão sem saber que o problema é o CADASTRO.
      erros.push({ campo: "plano", mensagem: escolha.motivo });
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
        // ⚠️ SAI DO `pedido`, E NÃO DE `bensEPermutas.lista` DIRETO. É a mesma lista, e é de
        // propósito: o cronograma tem que ser o da composição que a régua acabou de APROVAR. Duas
        // origens para o mesmo dado é como a régua passa a conferir uma venda e o papel a imprimir
        // outra no dia em que um dos dois ganhar um filtro.
        bensEPermutas: pedido.bensEPermutas,
        diaDeVencimento: pedido.vencimentoDia,
        entradaValor: pedido.entradaValor,
        entradaDatas: pedido.entradaDatas,
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
                erro instanceof Error
                  ? erro.message
                  : "Não foi possível montar o fluxo de pagamento.",
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
    // ⚠️ O TIPO DO PRODUTO VEM DO CADASTRO, e a unidade confirma. É ele que escreve "Torre A · Apto
    // 304" no WhatsApp e no PDF, e que troca "o lote" por "a unidade" na folha (C6, onda 2). Sem o
    // tipo, a unidade decide pelas próprias colunas (`tipoDaUnidade`).
    const unidadeComTipo = { ...unidade, tipoProduto: empreendimento.tipoProduto };
    const unidadeEscrita = nomeDaUnidade(unidadeComTipo);
    const tipoProduto = tipoDaUnidade(unidadeComTipo);

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
          incluirReajuste,
          atendimento: {
            coordenador: paraORodape?.coordenadores[0]?.nome ?? null,
            corretor: paraORodape?.corretor?.nome ?? nomeDoCorretor,
            imobiliaria: paraORodape?.imobiliaria.nome ?? nomeDaImobiliaria,
            telefone: paraORodape?.imobiliaria.telefone ?? null,
          },
          // A prévia é o papel que o coordenador confere ANTES de gerar: sem os bens aqui, ele
          // aprovaria um documento diferente do que o cliente vai receber.
          bensEPermutas: bensEPermutas.lista,
          codigo,
          compradores,
          cronograma,
          diaDeVencimento: pedido.vencimentoDia,
          empreendimento,
          enterpriseId: c2xId,
          plano,
          propostaId: null,
          tipoProduto,
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

    // ⚠️ A TRAVA DO LOTE TAMBÉM NA PROPOSTA (Lucas, 18/09/2026: *"eu não posso vender dois lotes
    // para pessoas diferentes"*). A proposta nasce da reserva desta unidade, e é ela que o comprador
    // assina: antes de gravar, o terreno inteiro não pode ter OUTRO dono vivo além desta reserva e
    // das propostas filhas dela. Pega o caso que a reserva sozinha não pegava: proposta importada do
    // legado viva no mesmo lote, ou reserva em outra linha do terreno (a do pai, a da outra gleba).
    // Sem conseguir conferir, não grava.
    {
      let outros: Awaited<ReturnType<typeof outrosDonosDoLote>> = null;
      try {
        const situacoes = await lerSituacaoDasUnidades(admin, [c2xId]);
        outros = await outrosDonosDoLote(admin, situacoes, unidade.id, { reservaId: reserva.id });
      } catch (erro) {
        console.error("[incorporador][proposta] trava do lote falhou", erro);
        outros = null;
      }
      if (outros === null || outros.length > 0) {
        return NextResponse.json(
          { erros: [{ campo: "unidade", mensagem: fraseDoConflito(outros) }] },
          { status: 409 },
        );
      }
    }

    // ⚠️ A LINHA VIROU UMA FUNÇÃO POR CAUSA DE UMA COLUNA SÓ, e o molde é o da reserva com
    // `terreno_chave` (0176, `lib/hercules/criar-reserva.ts`): tenta COM a coluna nova e, se o
    // banco não a conhecer, refaz SEM ela. Medido em produção em 22/09/2026:
    // `information_schema.columns` não devolve `bens_e_permutas` em `hercules_propostas` — a 0187
    // está escrita e NÃO aplicada, porque aplicar migration exige OK do Lucas, a cada vez. Sem
    // este desvio, o código no ar antes da migration derruba TODA proposta, com permuta ou sem, num
    // 503 que parece falha do sistema e para a venda da casa inteira. E nada precisa ser mexido no
    // dia em que a coluna nascer: a primeira tentativa passa e a lista grava sozinha.
    const linhaDaProposta = (comBens: boolean) => ({
      // A carga do C2X preenche esta coluna e ninguem a le hoje; gravada aqui para a proposta
      // nativa nao ser a unica linha da tabela com o campo em branco.
      aberta: true,
      // ⚠️ O DESCONTO FICA REGISTRADO, E OS DOIS ANDAM JUNTOS (a constraint da 0151 exige):
      // modo sem valor não diz quanto, valor sem modo não diz de quê. Ajuste ausente ou zerado
      // grava NULO nos dois — "sem desconto" e "desconto de zero" são a mesma coisa para quem
      // lê, e nulo é o que as 4.857 propostas importadas têm.
      ajuste_modo: ajuste ? ajuste.modo : null,
      ajuste_valor: ajuste ? ajuste.valor : null,
      // ⚠️ O QUE O CLIENTE DEU EM BEM FICA REGISTRADO, e não só embutido no valor negociado.
      // Sem esta coluna o carro e o lote dados em pagamento só existiriam na `observacao`, em
      // texto corrido: a Têmis não teria como imprimir "recebe em permuta o Ford Ka placa
      // ABC1D23, R$ 32.000" no contrato, e a análise não teria como separar quanto da entrada
      // foi dinheiro e quanto foi bem. Lucas (22/09/2026): *"Já no contrato também"*.
      //
      // ⚠️ LISTA VAZIA, NUNCA NULO — a coluna é NOT NULL com default `'[]'` (0187), e quem lê
      // nunca precisa distinguir "não tem bem" de "não foi preenchido".
      //
      // ⚠️ E O CAMPO SAI DA LINHA INTEIRA QUANDO `comBens` É FALSO, em vez de ir nulo: o
      // PostgREST recusa a coluna que não conhece, e mandar `null` não resolveria nada — não é
      // o VALOR que ele não aceita, é o NOME.
      ...(comBens ? { bens_e_permutas: bensEPermutas.lista } : {}),
      cliente_documento: cpfDoTitular,
      // A CAD que DECIDIU o credenciamento — é por ela que se abre a ficha do cliente depois.
      cliente_entity_id: credenciamento.entityId,
      cliente_nome: titular.nome,
      compradores,
      // O cronograma inteiro, como ele foi impresso: é o que responde "o que a proposta
      // prometeu" quando o plano do empreendimento mudar no ano que vem.
      //
      // ⚠️ E AGORA A PREMISSA VAI JUNTO, e não só o resultado dela. Até 13/09/2026 a proposta
      // congelava o CRONOGRAMA e nunca a PREMISSA: guardava as 120 parcelas com data e valor, e
      // não guardava com que taxa, com que índice nem com que sistema aquilo tinha sido gerado.
      // Quem quisesse saber depois reencontrava o plano PELO NOME — e a 0143 tirou a unicidade
      // do nome, então "Normal - Price" pode ser dois planos diferentes daqui a um ano.
      //
      // ⚠️ POR QUE AQUI DENTRO, e não em colunas novas: as colunas planas `plano_juros` e
      // `plano_correcao` existem, mas `plano_juros` JÁ MISTURA DUAS UNIDADES — medido em
      // 13/09/2026 nas 4.857 linhas importadas do C2X: 1.662 delas guardam 8 ou 6 (que é % ao
      // ANO) e ~848 guardam 0,7207 / 0,6434 / 0,5 / 0,8 (que é % ao MÊS), na mesma coluna, sem
      // marcador. 8% a.a. e 0,6434% a.m. são a MESMA taxa e a coluna não sabe distinguir. Um
      // número sozinho ali não congela nada; o objeto abaixo congela.
      condicoes: {
        ...cronograma,
        // ⚠️ GRAVADA, e não só usada na hora. Sem isto, reimprimir a mesma proposta daqui a três
        // meses devolveria um documento diferente do que o cliente recebeu — e o documento
        // reimpresso é justamente o que alguém vai buscar quando houver discussão.
        incluirReajuste,
        plano: {
          // ⚠️ O DESCONTO DO PLANO FICA CONGELADO JUNTO (18/09/2026). `ajuste_modo`/`ajuste_valor`
          // guardam o desconto que foi DADO; este guarda o que o plano PREVIA. Com os dois lado a
          // lado, a Têmis distingue "8% do Investidor Parcelado" de "8% à mão". Zero = sem desconto.
          //
          // ⚠️ E SÓ NO PRAZO DO PLANO (`descontoDoPlanoNoPrazo`): o Investidor escolhido e levado a
          // 84 parcelas não previa os 12% dele nesse prazo, e o que ficou no campo é exceção do
          // coordenador (a modal pediu a nota). É a mesma régua do simulador.
          descontoPercentual: descontoDoPlanoNoPrazo({
            descontoDoPlano: (plano as { descontoPercentual?: unknown }).descontoPercentual,
            parcelasDoPlano: plano.parcelas,
            parcelasEfetivas: pedido.parcelas,
          }),
          entradaPercentual: plano.entradaPercentual,
          indiceCorrecao: plano.indiceCorrecao,
          jurosConvencao: plano.jurosConvencao,
          jurosPeriodicidade: plano.jurosPeriodicidade,
          jurosTaxa: plano.jurosTaxa,
          nome: plano.nome,
          /** O prazo do MOLDE. O prazo contratado está em `contrato_parcelas`. */
          parcelas: plano.parcelas,
          sistemaAmortizacao: plano.sistemaAmortizacao,
        },
      },
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
      criado_por: sessao.usuarioId,
      criado_por_nome: sessao.usuarioNome,
      dia_vencimento: pedido.vencimentoDia,
      // ⚠️ SEM ESTE CÓDIGO A PROPOSTA NASCE INVISÍVEL: a rota `/venda` filtra por ele.
      empreendimento_codigo: codigoDoEmpreendimento(
        catalogo,
        empreendimento,
        c2xId,
      ),
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
      // ⚠️ A TAXA VAI CRUA, na MESMA convenção que a coluna já usa. A carga do C2X gravou aqui o
      // número do cadastro sem converter (8 para o plano anual, 0,6434 para o mensal), e
      // converter só as linhas novas para % ao mês faria a tela da Têmis comparar 0,64 com 8
      // achando que são taxas diferentes. A periodicidade que desfaz a ambiguidade está em
      // `condicoes.plano.jurosPeriodicidade`.
      //
      // ⚠️ E ELA PRECISA EXISTIR: até hoje a proposta nativa não gravava nenhum dos dois, e por
      // isso TODA proposta do Panteon chegava na análise da Têmis dizendo "Juros: não informado"
      // (comercial-da-analise.ts lê `plano_juros` e cai no texto de ausência com nulo). Medido em
      // 13/09/2026: as 5 propostas nativas têm plano_juros e plano_correcao NULOS, as duas.
      plano_juros: plano.jurosTaxa,
      // ⚠️ O RÓTULO, e não o código. Esta coluna é lida como TEXTO para mostrar na tela em dois
      // lugares (fluxo-de-venda.ts:340 e comercial-da-analise.ts:252) e a carga do C2X encheu-a
      // com o rótulo do legado ("IPCA ANUAL", "POUPANÇA"). Gravar `IPCA_ANUAL` aqui colocaria um
      // segundo idioma na mesma coluna e o operador leria o nome da constante.
      plano_correcao: rotuloDoIndice(plano.indiceCorrecao),
      plano_nome: plano.nome,
      // ⚠️ ESTE É O MOLDE, E FICA — não é o prazo desta venda (esse é `contrato_parcelas`, acima).
      // Ele existe para responder "de que produto esta proposta saiu": as 4.857 linhas importadas
      // do C2X só têm este número, e apagá-lo aqui faria a proposta nativa ser a única sem a
      // referência do plano que a originou. Quem lê os dois lado a lado enxerga o desconto de
      // prazo que o coordenador deu.
      plano_parcelas: plano.parcelas,
      // ⚠️ CONGELADO, NÃO CONSULTADO. É o preço do lote NESTE instante. Ler o cadastro depois,
      // na hora de analisar, faria o passado mudar toda vez que alguém corrigisse o preço da
      // unidade — a proposta de agosto passaria a "ter desconto" porque o preço subiu em
      // outubro. Ver a 0151.
      preco_tabela: numeroDoBanco(unidade.preco_tabela),
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
    });

    const inserirProposta = (comBens: boolean) =>
      admin
        .from("hercules_propostas")
        .insert(linhaDaProposta(comBens))
        .select("id")
        .maybeSingle();

    let { data: criada, error } = await inserirProposta(true);
    if (error && semAColunaDeBens(error)) {
      // ⚠️ SÓ A LISTA VAZIA REFAZ SEM A COLUNA. Regravar sem ela uma proposta QUE TEM BEM deixaria
      // a venda com o cronograma já abatido em R$ 80.000 e sem uma linha dizendo por quê: a Têmis
      // imprimiria um contrato que cobra o lote menos um desconto sem causa, e a análise não teria
      // como separar o que foi dinheiro do que foi carro. O insert é a PRIMEIRA escrita da rota,
      // então recusar aqui não deixa nada pela metade — nem proposta, nem reserva movida, nem
      // WhatsApp. É o mesmo princípio do 409 da trava do lote: na dúvida sobre dinheiro, não grava.
      if (bensEPermutas.lista.length > 0) {
        console.error(
          "[hercules][proposta] 0187 pendente: proposta com bens recusada",
          { unidade: unidade.id },
        );
        return NextResponse.json(
          {
            error:
              "Esta proposta tem bens ou permutas, e o registro deles ainda não está disponível neste ambiente. Nada foi gravado.",
          },
          { status: 503 },
        );
      }
      ({ data: criada, error } = await inserirProposta(false));
    }

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
      console.error(
        "[hercules][proposta] falha ao mover a reserva",
        erroDaReserva,
      );
    } else if (!movida || movida.length === 0) {
      // ⚠️ DESFAZ A PROPOSTA QUE ACABOU DE NASCER. Ela é de segundos atrás, ninguém foi avisado
      // ainda (o passo 9 vem depois) e nenhum PDF saiu: apagá-la é mais honesto do que deixar uma
      // venda viva sobre um lote que a tela mostra livre. O `delete` é seguro justamente porque
      // esta linha não teve tempo de virar referência de nada.
      console.error(
        "[hercules][proposta] a reserva saiu de 'ativa' durante a geração",
        {
          propostaId,
          reservaId: reserva.id,
        },
      );
      if (propostaId) {
        await admin.from("hercules_propostas").delete().eq("id", propostaId);
      }
      return NextResponse.json(
        {
          error:
            "A reserva desta unidade foi cancelada enquanto a proposta era montada.",
        },
        { status: 409 },
      );
    }

    // ── 9. O PDF e os três avisos ──────────────────────────────────────────
    //
    // ⚠️ DAQUI PARA BAIXO NADA DERRUBA A PROPOSTA, que já está gravada. Um WhatsApp que não sai
    // volta como aviso na resposta; uma exceção aqui viraria 503 numa operação que deu certo, e o
    // coordenador tentaria de novo por cima do índice único.
    const avisos = await avisar(admin, {
      // ⚠️ A PROPOSTA DO PORTAL QUE OPERA SOZINHO NÃO AVISA NINGUÉM (Lucas, 16/09/2026). O PDF é
      // montado e guardado igual (é o papel da venda, e vai para a aba Documentos); só o WhatsApp
      // não sai, e o histórico de disparos diz que não saiu por decisão.
      avisaPeloWhatsapp: vendaAvisaPeloWhatsapp(sessao),
      bensEPermutas: bensEPermutas.lista,
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
      incluirReajuste,
      imobiliariaId: reserva.imobiliaria_entity_id,
      pedido,
      plano,
      propostaId,
      protocolo: reserva.protocolo_numero,
      tipoProduto,
      titular,
      unidade,
      unidadeEscrita,
    });

    return NextResponse.json({ data: { avisos, codigo, id: propostaId } });
  } catch (erro) {
    if (erro instanceof FalhaAoLerCredenciamento) {
      console.error("[hercules][proposta] credenciamento ilegível", erro);
      return NextResponse.json(
        {
          error:
            "Não foi possível conferir o credenciamento agora. Tente de novo.",
        },
        { status: 503 },
      );
    }
    console.error("[hercules][proposta] falha ao gerar", erro);
    return NextResponse.json(
      { error: "Não foi possível gerar a proposta agora." },
      { status: 503 },
    );
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
    /**
     * Falso na venda do portal que opera sozinho (`vendaAvisaPeloWhatsapp`): o PDF é guardado igual,
     * mas nenhum WhatsApp sai, e o registro diz que não saiu por decisão.
     */
    avisaPeloWhatsapp: boolean;
    /**
     * Os bens e permutas que vão ao papel definitivo.
     *
     * ⚠️ CAMPO PRÓPRIO, COMO `compradores` — e não lido de `pedido` aqui dentro. É este PDF que
     * fica guardado na aba Documentos e que vai por WhatsApp para três pessoas: ele e a prévia
     * precisam sair da MESMA lista, e o campo explícito é o que faz o typecheck cobrar quem
     * esquecer de passá-la.
     */
    bensEPermutas: BemOuPermuta[];
    c2xId: string;
    /** O elo do PDF com a ficha do cliente no Apolo. Ver a 0136. */
    clienteDocumentoHash: null | string;
    clienteEntityId: null | string;
    codigo: string;
    compradores: CompradorDoPedido[];
    corretorId: null | string;
    cronograma: ReturnType<typeof montarCronograma>;
    empreendimento: LinhaDoCadastro;
    /** A tabela de reajuste entra no PDF que vai por WhatsApp? Ver `DadosDaFolha`. */
    incluirReajuste: boolean;
    imobiliariaId: null | string;
    pedido: PedidoDeProposta;
    plano: PlanoComercial;
    propostaId: null | string;
    /** O COD em número — é ele que agrupa o documento na aba. */
    protocolo: null | number;
    tipoProduto: TipoProduto;
    titular: Proponente;
    unidade: UnidadeDaProposta;
    unidadeEscrita: string;
  },
): Promise<ResultadoDoAviso[]> {
  // Sem imobiliária não há para quem mandar pelo caminho do Relacionamento (o `entity_id` do
  // registro do disparo é o dela, inclusive o do coordenador). A proposta continua gravada.
  if (!dados.imobiliariaId) {
    return [
      { motivo: "reserva sem imobiliária", ok: false, para: "imobiliaria" },
    ];
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
      dados.cronograma.reajustes.length <= 1 &&
      dados.plano.indiceCorrecao === "SEM_CORRECAO";

    const anexo = await guardarOPdf(admin, {
      // ⚠️ A MESMA ESCOLHA DO PAPEL GERADO. O PDF que vai por WhatsApp e o que fica guardado sao o
      // MESMO documento: se a bandeira nao viesse ate aqui, o coordenador veria a PA sem a tabela e
      // o cliente receberia uma com ela.
      incluirReajuste: dados.incluirReajuste,
      atendimento: {
        coordenador: destinatarios.coordenadores[0]?.nome ?? null,
        corretor: destinatarios.corretor?.nome ?? null,
        imobiliaria: destinatarios.imobiliaria.nome,
        telefone: destinatarios.imobiliaria.telefone,
      },
      bensEPermutas: dados.bensEPermutas,
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
      tipoProduto: dados.tipoProduto,
      unidade: dados.unidade,
      unidadeEscrita: dados.unidadeEscrita,
      // A MESMA data que acabou de ir para `validade_em`: o papel repete o que ficou gravado.
      validadeEmIso: dados.pedido.validadeEm,
      valorNegociado: dados.pedido.valorNegociado,
      plano: dados.plano,
    });

    // ⚠️ PORTAL QUE OPERA SOZINHO: o papel ficou guardado acima, e aqui para. Nenhum texto é montado
    // e nenhum WhatsApp sai; cada destinatário ganha a linha "não enviado por decisão".
    if (!dados.avisaPeloWhatsapp) {
      const naoEnviados = await registrarAvisoNaoEnviado(admin, {
        corretorId: dados.corretorId,
        destinatarios,
        imobiliariaId: dados.imobiliariaId,
        origem: "proposta:whatsapp",
        tipo: "hercules_proposta",
      });
      return anexo
        ? naoEnviados
        : [
            ...naoEnviados,
            { motivo: "não foi possível gerar o PDF", ok: false, para: "documento" },
          ];
    }

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
            motivo:
              "não foi possível gerar o PDF; os três receberam só o texto",
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
  /**
   * Os bens e permutas recebidos. Ausente ou vazia = a seção não existe no papel.
   *
   * ⚠️ O PAPEL TEM QUE DIZER DE ONDE VEIO O ABATIMENTO. O cronograma que vai impresso já desconta
   * o carro do saldo; sem esta lista, o comprador lê um financiado R$ 80.000 menor que o lote e
   * não acha no documento uma linha que explique a diferença — e é o mesmo papel que a Têmis usa
   * para escrever o contrato.
   */
  bensEPermutas: BemOuPermuta[];
  codigo: string;
  compradores: CompradorDoPedido[];
  cronograma: ReturnType<typeof montarCronograma>;
  diaDeVencimento: number;
  /** A tabela de reajuste entra no papel? Ver `DadosDaFolha.incluirReajuste`. */
  incluirReajuste: boolean;
  empreendimento: LinhaDoCadastro;
  enterpriseId: string;
  plano: PlanoComercial;
  /** O elo com o Apolo, para o PDF aparecer na ficha do cliente. Ver a 0136. */
  clienteDocumentoHash?: null | string;
  clienteEntityId?: null | string;
  propostaId: null | string;
  /** O COD em número — é ele que agrupa o documento na aba. */
  protocolo?: null | number;
  /** Loteamento ou prédio: muda a palavra da folha ("o lote" ou "a unidade"), nunca a conta. */
  tipoProduto: TipoProduto;
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
    bensEPermutas: dados.bensEPermutas,
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
    incluirReajuste: dados.incluirReajuste,
    logoC2x: logoDoC2x(),
    logoEmpreendimento: await logoDoEmpreendimento(admin, dados.enterpriseId),
    plano: dados.plano,
    // ⚠️ A TABELA SÓ VAI QUANDO O PLANO TEM DESCONTO (0178): é o que faz a folha mostrar "valor de
    // tabela" e "desconto" no Investidor Parcelado do Garden. Plano sem desconto não manda nada, e o
    // papel dos outros empreendimentos sai exatamente como saía.
    precoDeTabela:
      descontoDoPlano((dados.plano as { descontoPercentual?: unknown }).descontoPercentual) > 0
        ? numeroDoBanco(dados.unidade.preco_tabela)
        : null,
    // O tipo do produto vai para a folha (C6): no prédio o subtítulo diz "m² privativos" e a tarja
    // diz "a unidade". Quem desenha a diferença é `proposta-para-pdf.ts`, e a folha o repassa ao PDF.
    tipoProduto: dados.tipoProduto,
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
        console.error(
          "[hercules][proposta] falha ao registrar o PDF como documento",
          erro,
        );
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
    return new Uint8Array(
      fs.readFileSync(path.join(process.cwd(), "public", "c2x-logo.png")),
    );
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
const COLUNAS_DA_PROPOSTA_QUE_CAI =
  "id, etapa, protocolo_numero, codigo, compradores, cliente_nome, reserva_id, imobiliaria_entity_id, corretor_entity_id, empreendimento_id, cancelada_em, cancelada_motivo, atualizado_em";

type PropostaQueCai = {
  atualizado_em: null | string;
  cancelada_em: null | string;
  cancelada_motivo: null | string;
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

/**
 * Quanto tempo depois do cancelamento a nova tentativa ainda completa a soltura. É o "tente de novo
 * em instantes" da resposta 503.
 *
 * ⚠️ E A ENTRADA DELA É ESTA MODAL, NÃO A TELA RECARREGADA (revisão de 24/09/2026). Com a venda já
 * `cancelado` e o cadastro preso, a unidade recarregada chega à ficha como `reservada` sem processo:
 * `acaoDeCancelamento` cai no último caso e não oferece botão nenhum. Enquanto a tela não tiver a
 * porta própria ("Terminar o cancelamento"), o 503 manda NÃO fechar a janela, e a janela larga serve
 * a quem deixa a modal aberta e tenta de novo mais tarde. Pendência anotada em
 * `docs/operations/engineering-operations.md`.
 */
const JANELA_DA_RETOMADA_MS = 24 * 60 * 60 * 1000;

/**
 * A venda tem card de cancelamento ou distrato VIVO na Têmis?
 *
 * ⚠️ É ELE QUEM DIZ DE QUEM É A RETOMADA, E NÃO A MARCA DO PEDIDO (revisão de 24/09/2026). O filtro
 * `cancelamento_pedido_em is null` não prova nada: o indeferimento de um pedido irmão LIMPA a marca
 * (`indeferimento-na-venda-server.ts`), e o motor da conclusão trata explicitamente a venda de marca
 * nula (`concluir-cancelamento-server.ts`). Uma venda derrubada pelo motor e parada no passo da
 * reserva casava todos os filtros daqui, e esta rota mandava os WhatsApps de "proposta cancelada"
 * para corretor, imobiliária e cliente sobre um cancelamento que o jurídico concluiu.
 *
 * ⚠️ CARD INDEFERIDO NÃO SEGURA NADA: ele foi recusado e já não é dono de venda nenhuma. E leitura
 * que falha é "não sei", que vira "tente de novo" — nunca uma retomada às cegas.
 */
async function temCardDeDesfazerVivo(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  propostaId: string,
): Promise<"leitura_falhou" | boolean> {
  const { data, error } = await admin
    .from("temis_trabalhos")
    .select("id")
    .eq("workspace_id", WORKSPACE)
    .eq("proposta_id", propostaId)
    .in("tipo", ["cancelamento", "distrato"])
    .neq("estagio", "indeferido")
    .limit(1);
  if (error) {
    console.error("[hercules][proposta] não deu para ler os cards de cancelamento da venda", error.message);
    return "leitura_falhou";
  }
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * A VEZ DE AVISAR, TOMADA POR COMPARAR-E-TROCAR — uma tentativa só manda os WhatsApps.
 *
 * ⚠️ SEM ISTO, DUAS TENTATIVAS JUNTAS AVISAM DUAS VEZES (revisão de 24/09/2026). O caminho normal
 * tinha a trava do clique duplo na etapa; a retomada não tinha nenhuma, e decidia pelo estado da
 * reserva: entre o `update` da venda e o da reserva existe uma janela em que a segunda tentativa lê
 * a venda já `cancelado` com a reserva viva e conclui que ninguém avisou. `atualizado_em` é o
 * carimbo de versão: quem conseguir trocá-lo pelo valor que leu é quem avisa, e o outro fica sabendo
 * que os avisos já saíram (é o que a tela mostra).
 *
 * ⚠️ O VALOR NOVO É SEMPRE DIFERENTE DO LIDO (o `+ 1` milissegundo): carimbo igual faria as duas
 * tentativas casarem a condição e avisarem as duas.
 */
async function tomarAVezDeAvisar(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  venda: { atualizadoEm: null | string; id: string },
): Promise<"erro" | "outra_tentativa" | "minha"> {
  const lido = venda.atualizadoEm;
  if (!lido) return "minha";
  const marca = new Date(Math.max(Date.now(), Date.parse(lido) + 1)).toISOString();
  const { data, error } = await admin
    .from("hercules_propostas")
    .update({ atualizado_em: marca })
    .eq("id", venda.id)
    .eq("etapa", "cancelado")
    .eq("atualizado_em", lido)
    .select("id");
  if (error) {
    console.error("[hercules][proposta] não deu para tomar a vez de avisar", error.message);
    return "erro";
  }
  return ((data ?? []) as unknown[]).length > 0 ? "minha" : "outra_tentativa";
}

/**
 * O CANCELAMENTO DESTA ROTA QUE PAROU NO MEIO: a venda já está `cancelado`, mas a reserva ligada
 * continua viva ou o cadastro do lote continua `reservada`.
 *
 * ⚠️ SÓ O QUE ESTA ROTA CANCELOU. `origem = 'panteon'` (a mesma régua da busca da proposta aberta),
 * `cancelada_em` preenchido, `cancelamento_pedido_em` VAZIO e — o que decide de verdade — NENHUM card
 * de cancelamento ou distrato vivo na Têmis (`temCardDeDesfazerVivo`). A venda derrubada pelo motor
 * nasce de um pedido e tem dono próprio para a retomada, o botão Concluir do card; a marca do pedido
 * sozinha não a separa, porque o indeferimento de um pedido irmão a limpa.
 *
 * ⚠️ E SÓ A MAIS RECENTE, DENTRO DA JANELA, E A MESMA QUE A TELA ESTÁ VENDO. A tela manda o id da
 * proposta que mostrou (`pedido.propostaId`); se for outro, não é retomada.
 *
 * ⚠️ ISTO NÃO DECIDE SE O LOTE VOLTA. Quem decide é a trava dentro de `soltarLoteDaVendaDesfeita`,
 * que conta todos os donos vivos do terreno: com outro dono, o cadastro fica como está.
 */
async function cancelamentoQueParouNoMeio(
  admin: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  unidade: UnidadeDaProposta,
  propostaIdDaTela: null | string,
): Promise<"do_juridico" | "leitura_falhou" | null | { reservaLigadaViva: boolean; venda: PropostaQueCai }> {
  const { data, error } = await admin
    .from("hercules_propostas")
    .select(COLUNAS_DA_PROPOSTA_QUE_CAI)
    .eq("workspace_id", WORKSPACE)
    .eq("unidade_id", unidade.id)
    .eq("origem", "panteon")
    .eq("etapa", "cancelado")
    .is("cancelamento_pedido_em", null)
    .not("cancelada_em", "is", null)
    .order("cancelada_em", { ascending: false })
    .limit(1);
  if (error) {
    console.error("[hercules][proposta] não deu para procurar o cancelamento que parou no meio", error.message);
    return "leitura_falhou";
  }
  const venda = ((data ?? []) as unknown as PropostaQueCai[])[0];
  if (!venda) return null;
  if (propostaIdDaTela && propostaIdDaTela !== venda.id) return null;
  const quando = Date.parse(String(venda.cancelada_em ?? ""));
  if (Number.isNaN(quando) || Date.now() - quando > JANELA_DA_RETOMADA_MS) return null;

  let reservaLigadaViva = false;
  if (venda.reserva_id) {
    const { data: reserva, error: erroDaReserva } = await admin
      .from("hercules_reservas")
      .select("id")
      .eq("id", venda.reserva_id)
      .in("situacao", ["ativa", "proposta"])
      .maybeSingle();
    if (erroDaReserva) {
      console.error("[hercules][proposta] não deu para ler a reserva da venda cancelada", erroDaReserva.message);
      return "leitura_falhou";
    }
    reservaLigadaViva = Boolean(reserva);
  }

  if (!reservaLigadaViva && String(unidade.situacao ?? "").trim() !== "reservada") return null;

  const doJuridico = await temCardDeDesfazerVivo(admin, venda.id);
  if (doJuridico === "leitura_falhou") return "leitura_falhou";
  if (doJuridico) return "do_juridico";
  return { reservaLigadaViva, venda };
}

export async function PATCH(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Configuração indisponível." },
      { status: 503 },
    );
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
    propostaId:
      typeof corpo.propostaId === "string"
        ? corpo.propostaId.trim() || null
        : null,
    unidadeId: String(corpo.unidadeId ?? "").trim(),
  };

  const erros = conferirCancelamentoDaProposta(pedido);
  if (erros.length > 0) {
    return NextResponse.json({ erros }, { status: 422 });
  }

  try {
    const permitidos = new Set(await idsDaSessao(auth.sessao));

    const unidade = await unidadePorId(admin, pedido.unidadeId);
    if (!unidade || !permitidos.has(String(unidade.enterprise_id))) {
      return NextResponse.json(
        { error: "Unidade não encontrada." },
        { status: 404 },
      );
    }

    // A mesma régua do POST: cancelar a proposta é escrita, e no produto só de consulta não se escreve.
    const escrita = await autorizarEscritaNoProduto(request, auth.sessao, [unidade.enterprise_id]);
    if (!escrita.ok) return escrita.response;
    const sessao = escrita.sessao;

    // ⚠️ SÓ A PROPOSTA NATIVA E ABERTA. `origem = 'panteon'` mantém de fora as 4.857 importadas do
    // C2X — cancelar por aqui uma venda que mora no legado escreveria no Panteon um cancelamento
    // que o C2X nunca saberia, e os dois passariam a discordar sobre o mesmo lote.
    const { data: linha } = await admin
      .from("hercules_propostas")
      .select(COLUNAS_DA_PROPOSTA_QUE_CAI)
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidade.id)
      .eq("origem", "panteon")
      .eq("etapa", "proposta")
      .maybeSingle();

    let proposta = linha as null | PropostaQueCai;

    // ⚠️ A NOVA TENTATIVA COMPLETA A SOLTURA (revisão de 24/09/2026). Quando a venda já foi para
    // `cancelado` e a queda da reserva falhou, a resposta abaixo é 503 "tente de novo". Mas esta
    // busca só acha venda em `proposta`, e a nova tentativa caía no 409 "Não há proposta aberta":
    // cancelar a reserva recusa reserva em `proposta` e bloquear exige `disponivel`, então nenhum
    // botão soltava o lote. Agora, sem proposta aberta, a rota procura o cancelamento que parou no
    // meio e termina a soltura (`soltarLoteDaVendaDesfeita` é idempotente e a trava nunca solta lote
    // com outro dono).
    let retomada: null | { reservaLigadaViva: boolean } = null;
    if (!proposta) {
      const parado = await cancelamentoQueParouNoMeio(admin, unidade, pedido.propostaId ?? null);
      if (parado === "leitura_falhou") {
        return NextResponse.json(
          { error: "Não foi possível conferir a unidade agora. Tente de novo em instantes." },
          { status: 503 },
        );
      }
      if (parado === "do_juridico") {
        return NextResponse.json(
          {
            error:
              "Esta venda foi desfeita pelo jurídico na Têmis, e é por lá que a unidade é liberada: abra o card e clique em Concluir.",
          },
          { status: 409 },
        );
      }
      if (!parado) {
        return NextResponse.json(
          { error: "Não há proposta aberta nesta unidade." },
          { status: 409 },
        );
      }
      proposta = parado.venda;
      retomada = { reservaLigadaViva: parado.reservaLigadaViva };
    }

    // ⚠️ A TELA DIZ QUAL PROPOSTA ELA ESTÁ VENDO, e aqui as duas têm que ser a mesma. Ver o aviso
    // em `PedidoDeCancelamentoDaProposta`: sem esta conferência, uma aba aberta desde cedo cancela
    // a proposta que nasceu depois — de outro cliente, com outro corretor, e os três recebem o
    // aviso com o nome errado. Opcional para não quebrar quem já tem a tela carregada sem o campo.
    if (pedido.propostaId && pedido.propostaId !== proposta.id) {
      return NextResponse.json(
        {
          error:
            "Esta unidade já tem outra proposta. Recarregue a tela antes de cancelar.",
        },
        { status: 409 },
      );
    }

    // Na retomada vale o motivo gravado na primeira tentativa: é ele que está na venda.
    const motivo =
      (retomada ? String(proposta.cancelada_motivo ?? "").trim() : "") ||
      motivoEscrito(pedido.motivo, pedido.detalhe);
    const agora = new Date().toISOString();

    if (!retomada) {
      const { data: cancelada, error } = await admin
        .from("hercules_propostas")
        .update({
          atualizado_em: agora,
          cancelada_em: agora,
          cancelada_motivo: motivo,
          cancelada_por: sessao.usuarioId,
          cancelada_por_nome: sessao.usuarioNome,
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
    }

    // A reserva que virou esta proposta volta a ser história, e o lote volta pela trava. Ver o aviso
    // do topo: sem isto a unidade aparece livre e recusa a próxima reserva.
    //
    // ⚠️ A RESERVA CAI ANTES DA UNIDADE, E O ERRO É LIDO. São gravações sem transação (o cliente do
    // Supabase não tem uma), e a única forma de nenhuma falha deixar lote preso é soltar a unidade
    // POR ÚLTIMO, depois que as linhas que a travam já caíram. Engolir o erro da reserva (o que este
    // bloco fazia antes) produzia o pior estado possível: unidade `disponivel` com a reserva parada
    // em `proposta`, que o índice `hercules_reservas_uma_viva_por_unidade` continua ocupando.
    //
    // ⚠️ SÓ A SITUAÇÃO DA RESERVA, SEM OS CAMPOS `cancelada_*`: ela foi CONSUMIDA pela proposta lá
    // atrás e cai junto com ela; preencher `cancelada_em` faria a ficha do lote contar "Reserva
    // cancelada" ao lado de "Proposta cancelada", um ato que ninguém praticou.
    //
    // ⚠️ E O LOTE SÓ VOLTA SE O TERRENO FICOU SEM DONO E SE O CADASTRO ESTAVA `reservada` (18/09/2026).
    // Desde 24/09/2026 isto é `soltarLoteDaVendaDesfeita`, a MESMA soltura do motor da Têmis (Lucas,
    // 24/09/2026: *"lembrando que quando tem cancelamento a unidade tem que ficar disponivel, tem que
    // ter esse reflexo"*): a trava de sempre, mais a reserva esquecida em `proposta` desta venda e a
    // prova pela régua. E o desfecho vai para a resposta (`loteVoltou`, `porque`): antes a rota o
    // ignorava, e a tela não tinha como saber que a trava segurou o lote.
    //
    // ⚠️ A UNIDADE VOLTA ANTES DO AVISO, como no cancelamento da reserva: se o WhatsApp falhar, o lote
    // já está livre para vender.
    const soltura = await soltarLoteDaVendaDesfeita(admin, {
      aceitos: ["reservada"],
      agora,
      venda: { id: proposta.id, reserva_id: proposta.reserva_id ?? null, unidade_id: unidade.id },
    });

    if (!soltura.ok) {
      // ⚠️ PARA AQUI, COM A UNIDADE AINDA PRESA — e isso é de propósito. A proposta já está
      // `cancelado`, e este mesmo botão termina a soltura na próxima tentativa
      // (`cancelamentoQueParouNoMeio`, desde a revisão de 24/09/2026); parar antes de soltar a
      // unidade mantém o estado CONSISTENTE (lote travado, os três ainda sem aviso) em vez de
      // deixá-lo travado e anunciado como livre.
      return NextResponse.json(
        {
          error:
            "A proposta foi cancelada, mas a reserva não. Não feche esta tela e clique de novo em instantes: é por este botão que a unidade é liberada.",
        },
        { status: 503 },
      );
    }
    const doLote = desfechoDaUnidade(soltura.desfecho);

    // ⚠️ RETOMADA SÓ PELO LOTE PRESO (a reserva ligada já tinha caído): a venda já estava inteira
    // cancelada, e a única coisa a fazer era o cadastro. Se a trava não soltou, não há o que
    // completar aqui: com outro dono é o 409 de sempre, e com leitura que falhou é "tente de novo".
    // Nada foi escrito no cadastro (a trava grava com a condição) e ninguém é avisado de novo.
    if (retomada && !retomada.reservaLigadaViva && !doLote.voltou) {
      const leituraFalhou = !soltura.desfecho.devolvida && soltura.desfecho.porque === "leitura_falhou";
      return NextResponse.json(
        {
          error: leituraFalhou
            ? "Não foi possível conferir se o lote tem outro dono. Tente de novo em instantes."
            : "Não há proposta aberta nesta unidade.",
        },
        { status: leituraFalhou ? 503 : 409 },
      );
    }

    const cadastro = await carregarCadastroDeEmpreendimentos();
    const nomeDoEmpreendimento =
      cadastro.find((l) => l.id === proposta.empreendimento_id)?.nome ??
      // Proposta sem `empreendimento_id` gravado ainda tem o id do C2X na unidade: o nome vai na
      // mensagem que três pessoas leem, e "empreendimento" no lugar dele é um recado sem endereço.
      cadastro.find(
        (l) => String(l.c2xEnterpriseId) === String(unidade.enterprise_id),
      )?.nome ??
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
    // ⚠️ NA RETOMADA, SÓ AVISA QUEM AINDA NÃO FOI AVISADO. A reserva ligada viva é a prova de que a
    // primeira tentativa parou no 503 da reserva, ANTES dos avisos. Sem ela a primeira passou da
    // soltura e já avisou: avisar de novo mandaria o segundo WhatsApp de cancelamento.
    const jaAvisou = retomada !== null && !retomada.reservaLigadaViva;
    // ⚠️ E A TELA PRECISA SABER DISSO (revisão de 24/09/2026). Com `avisos: []` a modal montava a
    // frase "O aviso não chegou a ser enviado", o contrário do que aconteceu, e quem cancelou ligava
    // para o cliente que já tinha recebido o WhatsApp.
    let avisosJaSairam = jaAvisou;
    // ⚠️ A VEZ DE AVISAR É DE QUEM TROCA O CARIMBO. Ver `tomarAVezDeAvisar`: no caminho normal o
    // carimbo lido é o `agora` que esta requisição acabou de gravar; na retomada, o que veio do
    // banco. Quem perde não avisa, e diz que os avisos saíram na outra tentativa.
    const vez =
      imobiliariaId && !jaAvisou
        ? await tomarAVezDeAvisar(admin, {
            atualizadoEm: retomada ? proposta.atualizado_em : agora,
            id: proposta.id,
          })
        : "minha";
    if (vez === "outra_tentativa") avisosJaSairam = true;
    if (imobiliariaId && !jaAvisou && vez === "minha") {
      const destinatarios = await destinatariosDaVenda(admin, {
        corretorId: proposta.corretor_entity_id,
        empreendimento: {
          c2xId: String(unidade.enterprise_id),
          nome: nomeDoEmpreendimento,
        },
        imobiliariaId,
      });
      // Portal que opera sozinho (Lucas, 16/09/2026): nenhum WhatsApp, só o registro de que não saiu.
      avisos = vendaAvisaPeloWhatsapp(sessao)
        ? await avisarSobreAVenda(admin, {
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
          })
        : await registrarAvisoNaoEnviado(admin, {
            corretorId: proposta.corretor_entity_id,
            destinatarios,
            imobiliariaId,
            origem: "proposta:cancelamento",
            tipo: "hercules_proposta",
          });
    }

    // ⚠️ A TRAVA QUE NÃO CONSEGUIU LER O TERRENO É "TENTE DE NOVO", NÃO "CANCELADA" (revisão de
    // 24/09/2026). A reserva caiu e a venda caiu, mas o cadastro ficou `reservada` sem dono conferido.
    // Com 200 a modal fechava, e a tela já não oferecia Cancelar proposta (não há proposta aberta):
    // o lote ficava preso sem botão. Com 503 a modal fica aberta, e a próxima tentativa entra pela
    // retomada (`cancelamentoQueParouNoMeio`) e só refaz a soltura. Os avisos já saíram acima, porque
    // a venda caiu de fato; a retomada sem reserva viva não avisa de novo (`jaAvisou`).
    if (!soltura.desfecho.devolvida && soltura.desfecho.porque === "leitura_falhou") {
      return NextResponse.json(
        {
          error:
            "A proposta foi cancelada, mas não deu para conferir se o lote tem outro dono, e ele continua ocupado. Não feche esta tela e clique de novo em instantes.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      data: {
        avisos,
        /** Os avisos desta venda saíram em outra tentativa: a tela não diz que ninguém foi avisado. */
        avisosJaSairam,
        codigo,
        id: proposta.id,
        // ⚠️ O LOTE VOLTOU? E, se não voltou, por quê (a frase da trava, a mesma da Têmis).
        loteVoltou: doLote.voltou,
        porque: doLote.voltou ? null : doLote.frase,
      },
    });
  } catch (erro) {
    console.error("[hercules][proposta] falha ao cancelar", erro);
    return NextResponse.json(
      { error: "Não foi possível cancelar agora." },
      { status: 503 },
    );
  }
}
