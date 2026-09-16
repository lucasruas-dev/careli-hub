import { createHash, randomUUID } from "node:crypto";

import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";
import {
  conferirCpfNoEmpreendimento,
  type ConflitoDoCpf,
} from "@/lib/apolo/cadastro-checar-cpf";
import type { MotivoDaRecusaDoCadastro } from "@/lib/apolo/cadastro-persist";
import {
  salvarCadastroDoApolo,
  type EsteiraDoSalvar,
  type SalvarPayload,
} from "@/lib/apolo/cadastro-salvar";
import { exigeComprovanteRenda } from "@/lib/apolo/enterprise-settings";
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { custoOcrImagem } from "@/lib/apolo/most-precos";
import {
  type CompanyEnrichment,
  enrichCompany,
  type EnrichmentResult,
  enrichPerson,
  extractDocument,
  isMostqiConfigured,
} from "@/lib/apolo/mostqi";
import { cpfValidoParaNucleo } from "@/lib/apolo/nucleo-familiar";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import {
  carregarCadastroDeEmpreendimentos,
  lerCadastroDeEmpreendimentos,
  type LinhaDoCadastro,
} from "@/lib/hercules/cadastro";
import { enterpriseNoAlcance, nomeDoAutor, type AtorDoPortal } from "@/lib/temis/ator";

import { lerImobiliariasVinculadas } from "./crm";
import { nomeApresentavel } from "./empreendimentos-do-portal";
import { linhasSoDoPanteon } from "./escopo";
import { podeEscreverNosEnterprises, type PortalDaEscrita } from "./operacao-do-produto";
import { escritaNoProduto, type ResultadoDaEscrita } from "./operacao-do-produto-servidor";
import { cabeNoTetoDoPortal, MENSAGEM_DO_TETO_DO_PORTAL } from "./teto-do-portal";

// CLIENTE NOVO PELO CRM DO PORTAL — as regras de quem vem de FORA da Careli.
//
// Decisão do Lucas (16/09/2026): *"a equipe da Cecilio cadastra cliente novo pelo CRM do portal"*.
// O portal da Cecílio virou a réplica do Hércules operada pelo próprio time dela, e cadastro de
// cliente é a porta de entrada da venda. O wizard é o MESMO do hub (CadastroFlow, modo "portal") e
// a gravação é a MESMA função (`salvarCadastroDoApolo`): campos, documentos obrigatórios e uma
// ficha por pessoa valem igual. O que este arquivo acrescenta é só o que muda por ser gente de fora:
//
//   1. O PRODUTO É OBRIGATÓRIO E TEM DE SER DA SESSÃO. No hub o empreendimento é opcional (é o
//      buraco das CADs órfãs); aqui ele é a própria chave do escopo. Vem do corpo e é conferido
//      contra `ator.enterpriseIds` (a lista já expandida pelo portão). Fora dela: 404, sem dizer
//      por quê, como toda rota do portal.
//   2. A IMOBILIÁRIA É OBRIGATÓRIA E TEM DE ESTAR HABILITADA NESTE PRODUTO (vínculo `empreendimento`
//      verificado em `apolo_relationships`). Sem isso, um corpo forjado penduraria a CAD numa
//      imobiliária qualquer e ela apareceria na carteira de quem não trabalha ali: 422. E sem
//      imobiliária a CAD não entra na esteira (regra do hub), o que no portal quer dizer: o cliente
//      não aparece no CRM de quem acabou de cadastrar e a trava de duplicidade (que lê a esteira)
//      não pega o segundo envio do mesmo CPF. Revisão da onda 3 (16/09/2026): 400 sem ela.
//   3. A RECUSA NÃO NOMEIA TERCEIROS. A frase do hub diz em qual empreendimento a CAD já existe, de
//      quem é o e-mail e quem é o titular do núcleo familiar, e devolve o id da ficha existente.
//      Para o portal isso é saber onde o cliente do vizinho está comprando. Aqui sai a categoria.
//   3b. O PORTAL APROVEITA A FICHA QUE JÁ EXISTE, SEM TROCAR NADA DELA. Decisão do Lucas
//      (16/09/2026): o cliente que já tem ficha na Careli e é cadastrado pelo portal ganha a CAD do
//      produto da Cecílio na MESMA ficha (uma ficha por pessoa). A gravação é o modo `acrescentar`
//      de `cadastro-persist.ts`: nome, metadata, telefone, e-mail, endereço, identificadores e
//      cônjuge que a ficha já tem ficam como estão; só entra o dado que ela não tinha. E NADA do que
//      a Careli já tinha volta na resposta: nem id de outro empreendimento, nem nome, nem dado da
//      ficha, nem o aviso de que a pessoa já existia (o 201 é o mesmo de uma ficha nova). O que
//      continua recusado é a CAD no MESMO produto: 409 "Este CPF já tem cadastro neste produto."
//      (Até esta decisão era 409 "fale com a central", da revisão da onda 3.)
//   3c. SÓ ESCREVE NO PRODUTO QUE A CECÍLIO OPERA (decisão do Lucas, 16/09/2026). O "Novo cliente"
//      oferece só os produtos com `operado_por` do portal, e o salvar, a checagem do CPF, o upload e
//      as exigências do produto conferem de novo (`recusaDaEscritaNoCadastro`): VOC e VOR são só
//      consulta para ela (403), e sem a coluna da 0170 ninguém cadastra (503).
//   4. A MOST É PAGA PELA CARELI. Toda leitura e todo enriquecimento pedidos pelo portal ficam
//      registrados com o ator (usuário e slug) em `apolo_ocr_reads`, a tabela das leituras pagas,
//      cabem num teto por usuário (`teto-do-portal.ts`), e o enriquecimento só consulta documento
//      que a MESMA conta acabou de ler (ver `documentoLidoPeloAtor`).
//   5. O AUTOR É O USUÁRIO DO PORTAL, com origem `portal`: nome no drive, `metadata.cadastradoPor`
//      na ficha e `portal-incorporador` na origem da ficha e da esteira.
//
// ⚠️ QUEM ENTRA É DECIDIDO PELO PORTÃO, NÃO AQUI: `autorizarTemisDoPortal` (lib/temis) é a porta do
// portal que OPERA SOZINHO (`portalConfeccionaContrato`), com o cadastro reconferido no banco e os
// empreendimentos expandidos. O comercial (Gurgel) não ganha cadastro nesta onda e morre lá com 404.

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** A origem gravada na ficha (`metadata.origem`) e na CAD (`apolo_esteira.origem`). */
export const ORIGEM_DO_PORTAL = "portal-incorporador";

/** A frase do 404 do portal (a mesma de `foraDoEscopo`). */
const NAO_ENCONTRADO = "Nao encontrado.";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

const digitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

/** Resposta de rota, sem depender de `NextResponse` (a rota embrulha; o teste lê direto). */
export type RespostaDoPortal = { corpo: Record<string, unknown>; status: number };

// ── O STAGING DO UPLOAD DIRETO ──────────────────────────────────────────────

/**
 * O dono do staging do upload direto para o usuário do portal.
 *
 * ⚠️ PREFIXO PRÓPRIO (`p-`), e não o `u-` do operador do hub: os ids vêm de tabelas diferentes
 * (`apolo_incorporador_usuarios` e `hub_users`), e um prefixo comum deixaria um lado reivindicar o
 * arquivo que o outro subiu se um dia dois ids coincidissem.
 */
export function donoUploadDoPortal(usuarioId: string): string {
  return `p-${texto(usuarioId)}`;
}

// ── OS PRODUTOS QUE ESTA SESSÃO PODE CADASTRAR ──────────────────────────────

export type ProdutoDoCadastro = { id: string; nome: string };

/**
 * Os produtos que SÓ o cadastro do Panteon conhece e que a sessão alcança, com o nome de exibição.
 *
 * ⚠️ POR QUE EXISTE (revisão da onda 3, 16/09/2026). O "Novo cliente" oferecia só as divisões do
 * catálogo do C2X, e o portal da Cecílio passa a criar produto no Panteon como regra (id a partir de
 * 100000, ver `codigosDaSessao` em escopo.ts): o produto recém-criado não aparecia, e com ele sozinho
 * na sessão o botão nem surgia. A régua é a de `linhasSoDoPanteon` (tradução, não permissão: só
 * entra id que a sessão já traz). Cadastro fora do ar devolve lista vazia, que é menos, nunca mais.
 */
export async function produtosDoPanteonDaSessao(
  ator: AtorDoPortal,
  catalogo: EmpreendimentoDoCatalogo[],
  /** O cadastro já lido por quem chama (a lista do "Novo cliente" lê uma vez só). */
  linhasJaLidas?: LinhaDoCadastro[],
): Promise<ProdutoDoCadastro[]> {
  try {
    const cadastro = linhasJaLidas ?? (await carregarCadastroDeEmpreendimentos());
    return linhasSoDoPanteon({ cadastro, catalogo, permitidos: ator.enterpriseIds })
      .filter((linha) => texto(linha.c2xEnterpriseId))
      .map((linha) => ({
        id: texto(linha.c2xEnterpriseId),
        nome: nomeApresentavel(linha.nome || linha.codigo),
      }));
  } catch (erro) {
    console.error("[apolo][cadastro][portal] cadastro do Panteon indisponível", erro);
    return [];
  }
}

/**
 * Os produtos oferecidos no "Novo cliente": as DIVISÕES reais do catálogo que a sessão alcança.
 *
 * ⚠️ DIVISÃO, E NÃO O GRUPO. A CAD é de UMA gleba: VOC é da Cecílio e VOL é do Lino, e os vínculos
 * das imobiliárias estão gravados pela divisão (medido em 17/08/2026: 150 de 151). Oferecer o grupo
 * gravaria a CAD num id que a habilitação de quase ninguém usa. O nome leva o código só quando a
 * mesma sessão alcança mais de uma divisão do mesmo grupo (o dono do conjunto precisa distinguir);
 * quem tem uma divisão só vê o nome do empreendimento.
 *
 * `doPanteon` são os produtos só do Panteon (`produtosDoPanteonDaSessao`); cada um passa de novo pelo
 * alcance, e id que o catálogo já ofereceu não se repete.
 */
export function produtosDoCadastro(
  catalogo: EmpreendimentoDoCatalogo[],
  enterpriseIds: string[],
  doPanteon: ProdutoDoCadastro[] = [],
): ProdutoDoCadastro[] {
  const alcance = new Set(enterpriseIds.map((id) => texto(String(id ?? ""))).filter(Boolean));
  const saida: ProdutoDoCadastro[] = [];

  for (const produto of doPanteon) {
    const id = texto(produto.id);
    if (id && alcance.has(id) && !saida.some((jaTem) => jaTem.id === id)) {
      saida.push({ id, nome: produto.nome });
    }
  }

  for (const emp of catalogo) {
    const nome = nomeApresentavel(emp.name);
    const divisoes = emp.stageIds
      .map((stageId, indice) => ({ code: texto(emp.codes[indice]), id: texto(String(stageId)) }))
      .filter((divisao) => divisao.id && alcance.has(divisao.id));

    for (const divisao of divisoes) {
      if (saida.some((jaTem) => jaTem.id === divisao.id)) continue;
      saida.push({
        id: divisao.id,
        nome: divisoes.length > 1 && divisao.code ? `${nome} (${divisao.code})` : nome,
      });
    }
  }

  return saida.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// ── QUEM OPERA O PRODUTO (decisão do Lucas, 16/09/2026) ─────────────────────

/**
 * O portal da régua de escrita, montado do ator. O ator só existe depois de `autorizarTemisDoPortal`,
 * que já revalidou o incorporador, a conta e o escopo: o tipo é o de quem confecciona.
 */
export function portalDoAtor(ator: AtorDoPortal): PortalDaEscrita {
  return { incorporadorId: ator.incorporadorId, slug: ator.slug, tipo: "incorporador" };
}

/** O cadastro do Panteon com a marca da 0170. Nulo = não deu para ler. */
export type CadastroDaOperacao = null | { com0170: boolean; linhas: LinhaDoCadastro[] };

/** Lê o cadastro sem lançar: quem chama decide o que "não deu para ler" quer dizer. */
export async function lerCadastroDaOperacao(): Promise<CadastroDaOperacao> {
  try {
    return await lerCadastroDeEmpreendimentos();
  } catch (erro) {
    console.error("[apolo][cadastro][portal] cadastro de empreendimentos indisponível", erro);
    return null;
  }
}

/**
 * Os produtos do "Novo cliente" que o portal OPERA: VOC e VOR são da Gurgel e ficam de fora da
 * lista; Garden e os produtos nascidos no portal ficam. É a mesma régua das rotas de escrita
 * (`podeEscreverNosEnterprises`), produto a produto.
 */
export function produtosQueOPortalOpera(
  produtos: ProdutoDoCadastro[],
  ator: AtorDoPortal,
  cadastro: { com0170: boolean; linhas: LinhaDoCadastro[] },
): ProdutoDoCadastro[] {
  const portal = portalDoAtor(ator);
  return produtos.filter((produto) =>
    podeEscreverNosEnterprises(portal, cadastro.linhas, [produto.id], cadastro.com0170),
  );
}

/**
 * O produto pedido é desta sessão? Sem produto é 400; fora da sessão é 404, sem dizer por quê.
 * Uma função só para o salvar, o upload e a checagem do CPF.
 */
export function conferirProdutoDaSessao(
  ator: AtorDoPortal,
  enterpriseId: unknown,
): { enterpriseId: string; ok: true } | { error: string; ok: false; status: number } {
  const alvo = normalizarEnterpriseId(enterpriseId);
  if (!alvo) {
    return { error: "Escolha o produto deste cadastro.", ok: false, status: 400 };
  }
  if (!enterpriseNoAlcance(ator, alvo)) {
    return { error: NAO_ENCONTRADO, ok: false, status: 404 };
  }
  return { enterpriseId: alvo, ok: true };
}

/**
 * A recusa da régua de escrita para o produto deste cadastro, ou `null` para seguir.
 *
 * ⚠️ PRODUTO AUSENTE OU FORA DA SESSÃO SEGUE (`null`): quem responde é a regra de sempre, com 400 ou
 * 404. Perguntar a régua antes do escopo faria um produto de fora responder 403 "só consulta", e o
 * portal confirmaria que ele existe.
 *
 * `so-consulta` → 403 (VOC, VOR); `indisponivel` → 503 (cadastro fora do ar ou sem a 0170).
 */
export async function recusaDaEscritaNoCadastro(
  ator: AtorDoPortal,
  enterpriseId: unknown,
): Promise<null | Exclude<ResultadoDaEscrita, "pode">> {
  const produto = conferirProdutoDaSessao(ator, enterpriseId);
  if (!produto.ok) return null;

  const resultado = await escritaNoProduto(portalDoAtor(ator), [produto.enterpriseId]);
  return resultado === "pode" ? null : resultado;
}

/**
 * O nome do produto para a esteira e para a tela. Nulo quando nem o catálogo nem o cadastro do
 * Panteon (`doPanteon`) conhecem o id.
 */
export function nomeDoProduto(
  catalogo: EmpreendimentoDoCatalogo[],
  enterpriseId: string,
  doPanteon: ProdutoDoCadastro[] = [],
): null | string {
  const alvo = texto(enterpriseId);
  if (!alvo) return null;

  for (const emp of catalogo) {
    if (texto(emp.id) === alvo || emp.stageIds.some((id) => texto(String(id)) === alvo)) {
      return nomeApresentavel(emp.name);
    }
  }
  return doPanteon.find((produto) => texto(produto.id) === alvo)?.nome ?? null;
}

/**
 * Os ids em que a HABILITAÇÃO de uma imobiliária vale para este produto: ele mesmo e o grupo dele.
 *
 * ⚠️ ISTO NÃO É ESCOPO DA SESSÃO, é a regra da imobiliária: para ela "Lagoa Bonita é um
 * empreendimento só" (escopo.ts), então quem foi habilitada no grupo vende em qualquer divisão. A
 * pergunta "o produto é desta sessão?" já foi respondida antes, por `enterpriseNoAlcance`. Irmã de
 * outra divisão NÃO entra: habilitada no VOL não vende no VOC.
 */
export function idsDaHabilitacao(
  catalogo: EmpreendimentoDoCatalogo[],
  enterpriseId: string,
): string[] {
  const alvo = texto(enterpriseId);
  if (!alvo) return [];

  const ids = new Set([alvo]);
  for (const emp of catalogo) {
    const grupo = texto(emp.id);
    if (grupo && grupo !== alvo && emp.stageIds.some((id) => texto(String(id)) === alvo)) {
      ids.add(grupo);
    }
  }
  return [...ids];
}

export type ImobiliariaDoCadastro = { id: string; nome: string };

/**
 * As imobiliárias HABILITADAS neste produto: vínculo `empreendimento` verificado. É a lista que a
 * tela oferece E a lista que o salvar confere; uma função só, para as duas nunca discordarem.
 * Vínculo `pending` (pedido em análise) não autoriza CAD, igual ao hub
 * (`empreendimentosCredenciados`, lib/publico/cad/dados.ts).
 */
export async function imobiliariasDoCadastro(
  adminClient: AdminClient,
  catalogo: EmpreendimentoDoCatalogo[],
  enterpriseId: string,
): Promise<{ imobiliarias: ImobiliariaDoCadastro[]; ok: true } | { ok: false }> {
  const lidas = await lerImobiliariasVinculadas(adminClient, idsDaHabilitacao(catalogo, enterpriseId));
  if (!lidas.ok) return { ok: false };

  return {
    imobiliarias: lidas.credenciadas
      .filter((imobiliaria) => imobiliaria.verificada)
      .map((imobiliaria) => ({ id: imobiliaria.id, nome: imobiliaria.nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    ok: true,
  };
}

// ── O VÍNCULO DO CADASTRO (produto + imobiliária) ───────────────────────────

export type VinculoDoPortal =
  | {
      empreendimentoNome: null | string;
      enterpriseId: string;
      imobiliaria: ImobiliariaDoCadastro | null;
      ok: true;
    }
  | { error: string; ok: false; status: number };

/**
 * Confere o produto e a imobiliária pedidos, ANTES de qualquer gravação e antes de ler cadastro.
 *
 * A ordem é a do custo: produto (lista em memória) antes da imobiliária (banco). Produto fora do
 * escopo responde 404 mesmo com imobiliária válida: o portal não confirma que o produto existe.
 *
 * ⚠️ SEM IMOBILIÁRIA É 400 (revisão da onda 3, 16/09/2026; ver o item 2 do cabeçalho). É decisão
 * do Lucas se a Cecílio vender sem imobiliária um dia: aí a esteira do portal teria de gravar só
 * com o produto, e esta trava sai junto.
 */
export async function conferirVinculoDoPortal({
  adminClient,
  ator,
  catalogo,
  doPanteon = [],
  enterpriseId,
  imobiliariaId,
}: {
  adminClient: AdminClient;
  ator: AtorDoPortal;
  catalogo: EmpreendimentoDoCatalogo[];
  /** Os produtos só do Panteon da sessão (`produtosDoPanteonDaSessao`), para o nome na esteira. */
  doPanteon?: ProdutoDoCadastro[];
  enterpriseId: unknown;
  imobiliariaId: unknown;
}): Promise<VinculoDoPortal> {
  const produto = conferirProdutoDaSessao(ator, enterpriseId);
  if (!produto.ok) return produto;
  const alvo = produto.enterpriseId;

  const vinculo = {
    empreendimentoNome: nomeDoProduto(catalogo, alvo, doPanteon),
    enterpriseId: alvo,
  };

  const pedida = texto(imobiliariaId);
  if (!pedida) {
    return { error: "Escolha a imobiliária deste cadastro.", ok: false, status: 400 };
  }

  const lista = await imobiliariasDoCadastro(adminClient, catalogo, alvo);
  if (!lista.ok) {
    return { error: "Não foi possível conferir a imobiliária agora.", ok: false, status: 503 };
  }

  const achada = lista.imobiliarias.find(
    (imobiliaria) => imobiliaria.id.toLowerCase() === pedida.toLowerCase(),
  );
  if (!achada) {
    return {
      error: "Esta imobiliária não está habilitada neste produto.",
      ok: false,
      status: 422,
    };
  }

  return { ...vinculo, imobiliaria: achada, ok: true };
}

/**
 * O corpo que o salvar compartilhado recebe, montado a partir do que o PORTÃO decidiu.
 *
 * ⚠️ O QUE O CORPO NÃO DITA: o papel (só prospect: imobiliária nasce credenciada no hub e isso não
 * é para gente de fora), a origem, o dono, o corretor (o wizard do portal não coleta, e um id
 * forjado entraria na esteira sem conferência), os corretores e empreendimentos de imobiliária, e
 * a imobiliária, que sai do vínculo conferido e nunca do texto que veio.
 */
export function payloadDoPortal(
  payload: SalvarPayload,
  vinculo: Extract<VinculoDoPortal, { ok: true }>,
): SalvarPayload {
  return {
    ...payload,
    corretores: undefined,
    empreendimentos: undefined,
    origem: ORIGEM_DO_PORTAL,
    ownerUserId: null,
    perfil: {
      ...(payload.perfil ?? {}),
      imobiliariaId: vinculo.imobiliaria?.id ?? "",
      imobiliariaLabel: vinculo.imobiliaria?.nome ?? "",
    },
    role: "prospect",
    vinculo: {
      empreendimentoNome: vinculo.empreendimentoNome ?? undefined,
      enterpriseId: vinculo.enterpriseId,
    },
  };
}

// ── A RECUSA, SEM TERCEIROS ─────────────────────────────────────────────────

/**
 * Os avisos da gravação SEM a mensagem do banco. O salvar compartilhado escreve `rótulo: motivo`
 * (`esteira: duplicate key value violates unique constraint ...`), e o motivo traz nome de índice,
 * coluna e caminho do Storage: é detalhe do schema da Careli, não de quem cadastra. O portal recebe
 * só o rótulo; o motivo inteiro fica no log.
 */
export function avisosSemDetalheDoBanco(avisos: string[]): string[] {
  const rotulos = avisos
    .map((aviso) => texto(String(aviso ?? "").split(":")[0]))
    .filter(Boolean);
  return [...new Set(rotulos)];
}

/**
 * Traduz a recusa da ficha para o portal. Nunca devolve `entityIdExistente` nem a frase do hub.
 *
 * ⚠️ "JÁ TEM CADASTRO NESTE PRODUTO" É A ÚNICA DUPLICIDADE QUE NOMEIA O LUGAR, e o lugar é o
 * próprio produto da sessão (o dedup compara com o empreendimento do pedido, que já passou pelo
 * escopo). Quando a pessoa tem ficha na Careli e nenhuma CAD neste produto não há recusa: a CAD
 * entra na mesma ficha (item 3b do cabeçalho), e o portal não fica sabendo que ela já existia.
 */
export function respostaDaRecusaNoPortal(
  recusa: { motivo?: MotivoDaRecusaDoCadastro },
  persona: unknown,
): RespostaDoPortal {
  const documento = persona === "pj" ? "CNPJ" : "CPF";

  switch (recusa.motivo) {
    case "cad-no-empreendimento":
      return {
        corpo: { error: `Este ${documento} já tem cadastro neste produto.`, jaExiste: true },
        status: 409,
      };
    case "nucleo-familiar":
      return {
        corpo: {
          error:
            "Este cliente ou o cônjuge já faz parte de um cadastro neste produto. Casal é um cadastro só por produto.",
        },
        status: 409,
      };
    case "email-repetido":
      return {
        corpo: {
          error:
            "Este e-mail já está em outro cadastro. Cada pessoa do contrato precisa do seu próprio e-mail: é por ele que a assinatura eletrônica identifica quem assinou.",
        },
        status: 409,
      };
    case "verificacao-indisponivel":
      return {
        corpo: {
          error: "Não foi possível verificar cadastros existentes agora. Tente novamente em instantes.",
        },
        status: 503,
      };
    case "dados-invalidos":
      return {
        corpo: { error: `Informe o nome e um ${documento} válido para cadastrar.` },
        status: 400,
      };
    default:
      return {
        corpo: { error: "Não foi possível salvar o cadastro agora. Tente novamente em instantes." },
        status: 500,
      };
  }
}

/** A mesma tradução para a checagem do CPF na identificação (antes de preencher a ficha). */
export function conflitoDoCpfNoPortal(
  conflito: ConflitoDoCpf | null,
): null | { mensagem: string; tipo: string } {
  if (!conflito) return null;

  const casal = "Casal é um cadastro só por produto.";
  switch (conflito.tipo) {
    case "cpf-ja-tem-cad":
      return { mensagem: "Este CPF já tem cadastro neste produto.", tipo: conflito.tipo };
    case "conjuge-informado-ja-tem-cad":
      return {
        mensagem: `O CPF do cônjuge já tem cadastro neste produto. ${casal}`,
        tipo: conflito.tipo,
      };
    case "conjuge-informado-ja-e-conjuge":
      return {
        mensagem: `O CPF do cônjuge já aparece como cônjuge em outro cadastro deste produto. ${casal}`,
        tipo: conflito.tipo,
      };
    case "titular-ja-e-conjuge-de-quem-tem-cad":
      return {
        mensagem: `Este CPF já aparece como cônjuge em um cadastro deste produto. ${casal}`,
        tipo: conflito.tipo,
      };
    default:
      return { mensagem: "Este CPF já tem cadastro neste produto.", tipo: "cpf-ja-tem-cad" };
  }
}

/**
 * O que o time do portal lê depois de salvar, sobre a fila do board.
 *
 * ⚠️ SEM IMOBILIÁRIA A CAD NÃO ENTRA NA ESTEIRA, e isso é a regra do hub, não do portal: a fila de
 * validação só recebe CAD com empreendimento E imobiliária (`salvarCadastroDoApolo`, bloco 1b). O
 * portal exige a imobiliária antes de gravar (`conferirVinculoDoPortal`), então `sem-vinculo` não
 * deveria chegar aqui; a frase fica para o dia em que a regra mudar.
 */
export function avisoDaEsteira(esteira: EsteiraDoSalvar): string {
  if (esteira === "gravada") {
    return "O cadastro entrou no board de cadastro, na etapa de validação.";
  }
  if (esteira === "falhou") {
    return "O cliente foi cadastrado e a CAD ficou registrada na ficha, mas não foi possível colocar o cadastro no board agora. Avise a Careli.";
  }
  return "O cliente foi cadastrado e a CAD ficou registrada na ficha. Sem imobiliária, o cadastro não entra no board de cadastro: a fila de validação só recebe CAD com produto e imobiliária.";
}

// ── AS OPERAÇÕES (as rotas só embrulham) ────────────────────────────────────

/** POST /api/incorporador/crm/cadastro/salvar */
export async function salvarCadastroDoPortal({
  adminClient,
  ator,
  catalogo,
  doPanteon = [],
  payload,
}: {
  adminClient: AdminClient;
  ator: AtorDoPortal;
  catalogo: EmpreendimentoDoCatalogo[];
  doPanteon?: ProdutoDoCadastro[];
  payload: SalvarPayload;
}): Promise<RespostaDoPortal> {
  // Só o PROSPECT: a imobiliária cadastrada pelo operador nasce credenciada (ver ENABLED_ROLES em
  // cadastro-salvar.ts), e credenciar parceiro é decisão da Careli.
  if (payload?.role !== "prospect") {
    return {
      corpo: { error: "Processo de cadastro ainda nao disponivel para este papel." },
      status: 400,
    };
  }

  const vinculo = await conferirVinculoDoPortal({
    adminClient,
    ator,
    catalogo,
    doPanteon,
    enterpriseId: payload.vinculo?.enterpriseId,
    imobiliariaId: payload.perfil?.imobiliariaId,
  });
  if (!vinculo.ok) return { corpo: { error: vinculo.error }, status: vinculo.status };

  const nome = nomeDoAutor(ator);
  const resultado = await salvarCadastroDoApolo({
    adminClient,
    autor: {
      donoUpload: donoUploadDoPortal(ator.usuarioId),
      nome: async () => nome,
      // `owner_user_id` é do `hub_users`: o usuário do portal não cabe ali, e a autoria vai para
      // `metadata.cadastradoPor`.
      ownerUserId: null,
      registro: { nome, origem: "portal", slug: ator.slug, usuarioId: ator.usuarioId },
    },
    // A pessoa que já tem ficha na Careli ganha a CAD na mesma ficha, sem trocar nada dela (item 3b
    // do cabeçalho).
    fichaExistente: "acrescentar",
    origemDaEsteira: ORIGEM_DO_PORTAL,
    origemPadrao: ORIGEM_DO_PORTAL,
    payload: payloadDoPortal(payload, vinculo),
  });

  if (!resultado.ok) {
    if (resultado.tipo === "invalido") {
      return { corpo: { error: resultado.error }, status: resultado.status };
    }
    return respostaDaRecusaNoPortal(resultado.recusa, payload.persona);
  }

  if (resultado.corpo.warnings.length > 0) {
    console.warn("[apolo][cadastro][portal] cadastro salvo com avisos", {
      entityId: resultado.corpo.entityId,
      incorporadorId: ator.incorporadorId,
      slug: ator.slug,
      usuarioId: ator.usuarioId,
      warnings: resultado.corpo.warnings,
    });
  }

  // ⚠️ SÓ ESTES QUATRO CAMPOS (decisão do Lucas, 16/09/2026: nada do que a Careli já tinha volta).
  // O corpo do salvar compartilhado traz também o código de autenticação e o PDF da CAD. No modo
  // `acrescentar` o código é o que a ficha JÁ TINHA (o ano de quando a pessoa entrou na Careli vai
  // impresso nele), e devolver código e PDF só para ficha nova diria, pela diferença, que a pessoa
  // já existia. A CAD em PDF fica no drive da ficha, marcada com o produto, e abre pelo board.
  // `entityId` é o da ficha que agora tem a CAD deste produto: é por ele que o board do portal abre.
  return {
    corpo: {
      aviso: avisoDaEsteira(resultado.esteira),
      entityId: resultado.corpo.entityId,
      naEsteira: resultado.esteira === "gravada",
      warnings: avisosSemDetalheDoBanco(resultado.corpo.warnings),
    },
    status: 201,
  };
}

const SEM_CONFLITO: RespostaDoPortal = {
  corpo: { data: { conferido: false, conflito: null } },
  status: 200,
};

/** POST /api/incorporador/crm/cadastro/checar-cpf */
export async function checarCpfNoPortal({
  adminClient,
  ator,
  corpo,
}: {
  adminClient: AdminClient | null;
  ator: AtorDoPortal;
  corpo: unknown;
}): Promise<RespostaDoPortal> {
  const pedido = (corpo && typeof corpo === "object" ? corpo : {}) as {
    cpf?: unknown;
    cpfConjuge?: unknown;
    enterpriseId?: unknown;
  };

  // O produto vem do corpo (é o time do portal quem escolhe), e por isso é conferido PRIMEIRO:
  // produto de fora responde 404 antes de qualquer consulta, com CPF completo ou não.
  const enterpriseId = normalizarEnterpriseId(pedido.enterpriseId ?? null);
  if (enterpriseId && !enterpriseNoAlcance(ator, enterpriseId)) {
    return { corpo: { error: NAO_ENCONTRADO }, status: 404 };
  }

  const cpf = digitos(pedido.cpf);
  // CPF pela metade não é erro: ainda estão digitando, ou a leitura ainda não fechou.
  if (!cpfValidoParaNucleo(cpf) || !enterpriseId || !adminClient) return SEM_CONFLITO;

  const resultado = await conferirCpfNoEmpreendimento(adminClient, {
    cpf,
    cpfConjuge: digitos(pedido.cpfConjuge),
    enterpriseId,
  });
  if (!resultado) return SEM_CONFLITO;

  // ⚠️ SÓ OS CONFLITOS DO PRODUTO (CAD neste produto, núcleo familiar neste produto). Ter ficha na
  // Careli não é conflito desde a decisão de 16/09/2026 (item 3b do cabeçalho): a CAD entra na mesma
  // ficha, e dizer aqui que a pessoa já existe seria devolver o que a Careli sabe dela.
  return {
    corpo: {
      data: {
        conferido: true,
        conflito: resultado.conflito ? conflitoDoCpfNoPortal(resultado.conflito) : null,
      },
    },
    status: 200,
  };
}

/**
 * GET /api/incorporador/crm/cadastro/settings
 *
 * Sem `enterpriseId`: os produtos que a sessão pode cadastrar, e só os que o portal OPERA (a tela
 * usa também para decidir se o botão "Novo cliente" aparece: lista vazia, sem botão; e o portal
 * que não confecciona leva 404 no portão).
 * Com `enterpriseId`: o que aquele produto exige (hoje o comprovante de renda) e as imobiliárias
 * habilitadas nele. A régua de quem opera esse produto é conferida ANTES, pela rota
 * (`recusaDaEscritaNoCadastro`), porque a resposta dela é a da porta de escrita.
 */
export async function configuracaoDoCadastroNoPortal({
  adminClient,
  ator,
  cadastro = null,
  catalogo,
  doPanteon = [],
  enterpriseId,
}: {
  adminClient: AdminClient | null;
  ator: AtorDoPortal;
  /** O cadastro do Panteon com a marca da 0170 (`lerCadastroDaOperacao`). Só a lista usa. */
  cadastro?: CadastroDaOperacao;
  catalogo: EmpreendimentoDoCatalogo[];
  /** Os produtos só do Panteon da sessão (`produtosDoPanteonDaSessao`). */
  doPanteon?: ProdutoDoCadastro[];
  enterpriseId: null | string;
}): Promise<RespostaDoPortal> {
  const alvo = normalizarEnterpriseId(enterpriseId);

  if (!alvo) {
    // ⚠️ SEM PROVAR QUEM OPERA, NENHUM PRODUTO (decisão do Lucas, 16/09/2026). Cadastro fora do ar
    // ou a 0170 não aplicada fazem toda linha sair "a Careli opera": oferecer a lista inteira seria
    // deixar a Cecílio cadastrar no VOC. Lista vazia, e 503 para a tela não afirmar "nenhum produto".
    if (!cadastro || !cadastro.com0170) {
      return {
        corpo: {
          data: { produtos: [] },
          error: "Não foi possível conferir os produtos que você opera agora. Tente de novo em instantes.",
        },
        status: 503,
      };
    }
    // Sem catálogo (C2X fora do ar) e sem produto do Panteon não há nome nem divisão para
    // oferecer: "nenhum produto" seria uma afirmação falsa, então é 503.
    if (catalogo.length === 0 && doPanteon.length === 0) {
      return { corpo: { error: "Não foi possível carregar os produtos agora." }, status: 503 };
    }
    return {
      corpo: {
        data: {
          produtos: produtosQueOPortalOpera(
            produtosDoCadastro(catalogo, ator.enterpriseIds, doPanteon),
            ator,
            cadastro,
          ),
        },
      },
      status: 200,
    };
  }

  if (!enterpriseNoAlcance(ator, alvo)) {
    return { corpo: { error: NAO_ENCONTRADO }, status: 404 };
  }
  if (!adminClient) {
    return { corpo: { error: "Não foi possível carregar o produto agora." }, status: 503 };
  }

  const [comprovanteRenda, imobiliarias] = await Promise.all([
    exigeComprovanteRenda(adminClient, alvo),
    imobiliariasDoCadastro(adminClient, catalogo, alvo),
  ]);
  if (!imobiliarias.ok) {
    return { corpo: { error: "Não foi possível carregar as imobiliárias agora." }, status: 503 };
  }

  return {
    corpo: {
      data: {
        comprovanteRenda,
        imobiliarias: imobiliarias.imobiliarias,
        produto: { id: alvo, nome: nomeDoProduto(catalogo, alvo, doPanteon) },
      },
    },
    status: 200,
  };
}

// ── A MOST, PAGA PELA CARELI ────────────────────────────────────────────────

/** Base64 de um arquivo de 20MB ~ 27MB de texto: o mesmo teto defensivo do /api/apolo/mostqi. */
export const MAX_BASE64_DA_LEITURA = 28_000_000;

export type PedidoDoMost =
  | { acao: "enrich"; cpf: string }
  | { acao: "enrich-company"; cnpj: string }
  | { acao: "extract"; fileBase64: string; fileName: string };

/**
 * O que o wizard pode pedir à MOST pelo portal.
 *
 * ⚠️ SÓ AS TRÊS AÇÕES DO WIZARD. O /api/apolo/mostqi do hub é também laboratório (`probe`,
 * `authenticate`) e aceita escolher `datasets` e `query`, que mudam o preço da consulta. Nada disso
 * é do portal: aqui sai sempre a query padrão, e o resto é 400.
 */
export function lerPedidoDoMost(
  corpo: unknown,
): { error: string; ok: false; status: number } | { ok: true; pedido: PedidoDoMost } {
  const dados = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  const acao = texto(dados.action);

  if (acao === "extract") {
    const fileBase64 = typeof dados.fileBase64 === "string" ? dados.fileBase64 : "";
    if (!fileBase64) return { error: "Envie o documento para ler.", ok: false, status: 400 };
    if (fileBase64.length > MAX_BASE64_DA_LEITURA) {
      return { error: "Arquivo acima do limite de 20MB.", ok: false, status: 413 };
    }
    return {
      ok: true,
      pedido: { acao, fileBase64, fileName: texto(dados.fileName) || "documento" },
    };
  }
  if (acao === "enrich") return { ok: true, pedido: { acao, cpf: digitos(dados.cpf) } };
  if (acao === "enrich-company") return { ok: true, pedido: { acao, cnpj: digitos(dados.cnpj) } };

  return { error: "Ação desconhecida.", ok: false, status: 400 };
}

/** Aceita "data:image/png;base64,XXXX" ou o base64 puro (igual ao /api/apolo/mostqi). */
function semPrefixoDataUrl(valor: string): string {
  const virgula = valor.indexOf(",");
  return valor.startsWith("data:") && virgula >= 0 ? valor.slice(virgula + 1) : valor;
}

/**
 * A linha de `apolo_ocr_reads` de UMA consulta paga pedida pelo portal.
 *
 * ⚠️ POR QUE ESTA TABELA. É o único registro de consulta paga à MOST que existe (0056): o import do
 * Asana e a correção de titular gravam aqui. O wizard do hub NÃO registra nada hoje (medido em
 * 16/09/2026: /api/apolo/mostqi só chama e devolve), então "o mesmo lugar onde o hub registra uso"
 * é esta tabela, com `source_system = portal-incorporador`, `source_id = slug` e `lido_por` = o
 * usuário do portal. O ator inteiro vai também em `extracao.ator`.
 *
 * ⚠️ A CHAVE ÚNICA É O SHA-256 DO BYTE, e ela é o cache que evita pagar duas vezes a mesma foto no
 * import. Por isso só a LEITURA BEM-SUCEDIDA grava com o hash real, e grava a extração inteira no
 * formato dos outros escritores (`cadastro`, `cpf`, `documentType`): uma linha de hash real com
 * extração vazia faria o import reaproveitar um "nada". Enriquecimento não tem arquivo, a leitura
 * que falhou não tem extração, e a releitura de uma foto já registrada não pode repetir a chave: as
 * três usam uma chave que nunca parece um SHA (`consulta:`, `falha:`, `releitura:` + uuid), e nunca
 * acertam o cache por engano.
 */
export function registroDoUsoDoMost(input: {
  acao: PedidoDoMost["acao"];
  ator: AtorDoPortal;
  custoPorImagem: number;
  extracao?: {
    cadastro?: unknown;
    confiancaDocumento?: null | number;
    documentType?: null | string;
  } | null;
  fileName?: null | string;
  fileSha256?: null | string;
  idDaConsulta: string;
  resultado?: null | string;
  sizeBytes?: null | number;
}): Record<string, unknown> {
  const ator = {
    nome: nomeDoAutor(input.ator),
    origem: "portal",
    slug: input.ator.slug,
    usuarioId: input.ator.usuarioId,
  };
  const comum = {
    lido_por: UUID_RE.test(input.ator.usuarioId) ? input.ator.usuarioId : null,
    paginas: 1,
    provider: "mostqi",
    source_id: input.ator.slug,
    source_system: ORIGEM_DO_PORTAL,
  };

  if (input.acao !== "extract") {
    return {
      ...comum,
      confianca: null,
      // O preço do enriquecimento depende dos datasets da query; quem diz o valor é a fatura.
      custo_brl: null,
      extracao: { acao: input.acao, ator, resultado: input.resultado ?? null },
      file_name: null,
      file_sha256: `consulta:${input.idDaConsulta}`,
      size_bytes: null,
      tipo: "enrichment",
    };
  }

  const cadastro =
    input.extracao?.cadastro && typeof input.extracao.cadastro === "object"
      ? (input.extracao.cadastro as Record<string, unknown>)
      : {};
  const cpf = digitos(cadastro.cpf);
  const cnpj = digitos(cadastro.cnpj);

  return {
    ...comum,
    confianca: input.extracao?.confiancaDocumento ?? null,
    custo_brl: input.custoPorImagem,
    extracao: {
      ator,
      cadastro,
      // `cnpj` vem ao lado do `cpf` para `documentoLidoPeloAtor`: o enriquecimento do portal só
      // consulta um documento que esta mesma conta leu.
      cnpj: cnpj.length === 14 ? cnpj : null,
      cpf: cpf.length === 11 ? cpf : null,
      documentType: input.extracao?.documentType ?? null,
    },
    file_name: input.fileName ?? null,
    // Sem hash = a leitura que FALHOU (sem extração para guardar): chave que nunca acerta o cache.
    file_sha256: input.fileSha256 || `falha:${input.idDaConsulta}`,
    size_bytes: input.sizeBytes ?? null,
    tipo: "iocr",
  };
}

/** Grava o uso. NUNCA derruba a leitura: a consulta já foi paga e a resposta tem de chegar. */
async function registrarUsoDoMost(
  adminClient: AdminClient | null,
  linha: Record<string, unknown>,
): Promise<void> {
  if (!adminClient) {
    console.warn("[apolo][most][portal] uso sem registro: Supabase indisponível", {
      slug: linha.source_id,
      tipo: linha.tipo,
    });
    return;
  }

  try {
    const { error } = await adminClient.from("apolo_ocr_reads").insert(linha);
    if (!error) return;

    // A MESMA FOTO LIDA DE NOVO (o hash já está na tabela): registra a releitura com chave própria,
    // sem a extração, para a conta de consultas não perder a segunda cobrança.
    if (error.code === "23505" && linha.tipo === "iocr") {
      const extracao = (linha.extracao ?? {}) as Record<string, unknown>;
      const { error: erroDaReleitura } = await adminClient.from("apolo_ocr_reads").insert({
        ...linha,
        extracao: {
          ator: extracao.ator,
          cnpj: extracao.cnpj ?? null,
          cpf: extracao.cpf ?? null,
          documentType: extracao.documentType ?? null,
          releitura: true,
        },
        file_sha256: `releitura:${randomUUID()}`,
      });
      if (!erroDaReleitura) return;
    }

    console.warn("[apolo][most][portal] uso sem registro", {
      codigo: error.code,
      slug: linha.source_id,
      tipo: linha.tipo,
    });
  } catch (erro) {
    console.warn("[apolo][most][portal] uso sem registro", {
      erro: (erro as Error).message,
      slug: linha.source_id,
      tipo: linha.tipo,
    });
  }
}

/** Por quanto tempo uma leitura de documento autoriza o enriquecimento do número lido. */
export const JANELA_DA_LEITURA_MS = 12 * 60 * 60 * 1000;

/**
 * Esta conta LEU, há pouco, um documento com este CPF (ou CNPJ)?
 *
 * ⚠️ POR QUE O ENRIQUECIMENTO PRECISA DISSO (revisão da onda 3, 16/09/2026). `enrich` devolve de
 * uma pessoa o nome da mãe e do pai, o nascimento, o cônjuge, os e-mails, os telefones, a renda e o
 * patrimônio. Aberto a qualquer CPF, o portal virava um balcão de consulta de birô com a conta da
 * Careli, para gente de fora: clientes do Lino, compradores da Gurgel ou quem nunca foi cliente. O
 * wizard só enriquece o número que ACABOU DE LER de um documento (titular, cônjuge, sócio, cartão
 * CNPJ), e a leitura já fica registrada em `apolo_ocr_reads` com o ator. Então a regra é essa: só
 * consulta o documento que esta mesma conta leu nas últimas 12 horas (o prazo do cookie).
 *
 * ⚠️ FALHA FECHADA: leitura que falhou ou registro que não existe (a gravação do uso é
 * best-effort) respondem "não". O wizard trata o enriquecimento como opcional e segue com os campos
 * abertos para digitar.
 */
export async function documentoLidoPeloAtor(
  adminClient: AdminClient | null,
  ator: AtorDoPortal,
  tipo: "cnpj" | "cpf",
  documento: string,
  agora: number = Date.now(),
): Promise<boolean> {
  if (!adminClient || !documento) return false;

  try {
    const { data, error } = await adminClient
      .from("apolo_ocr_reads")
      .select("id")
      .eq("source_system", ORIGEM_DO_PORTAL)
      .eq("source_id", ator.slug)
      .eq("tipo", "iocr")
      .eq("extracao->ator->>usuarioId", ator.usuarioId)
      .eq(`extracao->>${tipo}`, documento)
      .gte("created_at", new Date(agora - JANELA_DA_LEITURA_MS).toISOString())
      .limit(1);

    if (error) {
      console.warn("[apolo][most][portal] não foi possível conferir a leitura do documento", {
        codigo: error.code,
        slug: ator.slug,
      });
      return false;
    }
    return (data ?? []).length > 0;
  } catch (erro) {
    console.warn("[apolo][most][portal] não foi possível conferir a leitura do documento", {
      erro: (erro as Error).message,
      slug: ator.slug,
    });
    return false;
  }
}

/**
 * O que o wizard recebe quando o enriquecimento não pode acontecer: o MESMO formato do
 * "indisponível" de `mostqi.ts` (tipado, para não divergir), e o wizard segue com os campos abertos.
 */
function enriquecimentoIndisponivel(
  ehPessoa: boolean,
  aviso: string,
): CompanyEnrichment | EnrichmentResult {
  const comum = { available: false, emails: [], source: "unavailable" as const, telefones: [], warnings: [aviso] };
  if (!ehPessoa) {
    return {
      ...comum,
      atividade: "",
      cnae: "",
      dataAbertura: "",
      naturezaJuridica: "",
      nomeFantasia: "",
      porte: "",
      razaoSocial: "",
      situacaoCadastral: "",
      socios: [],
    };
  }
  return {
    ...comum,
    certidoes: [],
    conjuge: "",
    creci: "",
    enderecos: [],
    estadoCivil: "",
    nascimento: "",
    nome: "",
    nomeMae: "",
    nomePai: "",
    obito: false,
    patrimonio: "",
    profissao: "",
    renda: "",
    sexo: "",
  };
}

/** POST /api/incorporador/crm/cadastro/mostqi — as três ações do wizard, com o uso registrado. */
export async function executarMostNoPortal({
  adminClient,
  agora = Date.now(),
  ator,
  pedido,
}: {
  adminClient: AdminClient | null;
  agora?: number;
  ator: AtorDoPortal;
  pedido: PedidoDoMost;
}): Promise<RespostaDoPortal> {
  // Sem a chave da MOST as funções devolvem o modo simulado: não há consulta, não há custo.
  const cobrada = isMostqiConfigured();

  // ⚠️ O TETO VEM ANTES DA CONSULTA, e só quando ela é paga (ver `teto-do-portal.ts`).
  if (cobrada) {
    const torneira = pedido.acao === "extract" ? "leitura-de-documento" : "consulta-paga";
    if (!(await cabeNoTetoDoPortal(adminClient, ator, torneira))) {
      console.warn("[apolo][most][portal] teto de uso atingido", {
        acao: pedido.acao,
        incorporadorId: ator.incorporadorId,
        slug: ator.slug,
        usuarioId: ator.usuarioId,
      });
      return { corpo: { error: MENSAGEM_DO_TETO_DO_PORTAL }, status: 429 };
    }
  }

  if (pedido.acao === "extract") {
    const base64 = semPrefixoDataUrl(pedido.fileBase64);
    try {
      // returnImage: o recorte tratado (endireitado, sem fundo) é o que vai para o drive. Sem
      // includeRaw: o JSON cru da MOST é dado demais para trafegar e o wizard não o lê (igual ao
      // espelho público).
      const extracao = await extractDocument({
        fileBase64: base64,
        fileName: pedido.fileName,
        returnImage: true,
      });

      if (cobrada) {
        const bytes = Buffer.from(base64, "base64");
        await registrarUsoDoMost(
          adminClient,
          registroDoUsoDoMost({
            acao: "extract",
            ator,
            custoPorImagem: custoOcrImagem(),
            extracao: {
              cadastro: extracao.cadastro,
              confiancaDocumento: extracao.confiancaDocumento,
              documentType: extracao.documentType,
            },
            fileName: pedido.fileName,
            fileSha256: createHash("sha256").update(bytes).digest("hex"),
            idDaConsulta: randomUUID(),
            sizeBytes: bytes.byteLength,
          }),
        );
      }

      return { corpo: { data: extracao }, status: 200 };
    } catch {
      // A leitura que falhou também pode ter sido cobrada: registra, sem o hash (ver acima).
      if (cobrada) {
        await registrarUsoDoMost(
          adminClient,
          registroDoUsoDoMost({
            acao: "extract",
            ator,
            custoPorImagem: custoOcrImagem(),
            extracao: null,
            fileName: pedido.fileName,
            fileSha256: null,
            idDaConsulta: randomUUID(),
          }),
        );
      }
      // O wizard já trata: o arquivo fica anexado e os campos abrem para digitar.
      return {
        corpo: {
          error: "Não conseguimos ler o documento agora. O arquivo fica salvo: preencha os dados na mão.",
        },
        status: 502,
      };
    }
  }

  const ehPessoa = pedido.acao === "enrich";
  const documento = ehPessoa ? pedido.cpf : pedido.cnpj;
  // Documento com tamanho errado nem sai daqui (as funções devolvem "indisponível" sem chamar).
  const consultou = cobrada && documento.length === (ehPessoa ? 11 : 14);

  // Só o documento que esta conta acabou de ler (ver `documentoLidoPeloAtor`). No modo simulado
  // não há consulta nem dado real, então não há o que proteger.
  if (
    consultou &&
    !(await documentoLidoPeloAtor(adminClient, ator, ehPessoa ? "cpf" : "cnpj", documento, agora))
  ) {
    console.warn("[apolo][most][portal] enriquecimento recusado: documento não lido por esta conta", {
      acao: pedido.acao,
      incorporadorId: ator.incorporadorId,
      slug: ator.slug,
      usuarioId: ator.usuarioId,
    });
    return {
      corpo: {
        data: enriquecimentoIndisponivel(
          ehPessoa,
          "A consulta automática só completa os dados de um documento lido neste cadastro. Preencha os campos na mão.",
        ),
      },
      status: 200,
    };
  }

  // Best-effort nas duas funções: elas não lançam, devolvem `available: false` com o aviso.
  const resultado = ehPessoa ? await enrichPerson(documento) : await enrichCompany(documento);

  if (consultou) {
    await registrarUsoDoMost(
      adminClient,
      registroDoUsoDoMost({
        acao: pedido.acao,
        ator,
        custoPorImagem: custoOcrImagem(),
        idDaConsulta: randomUUID(),
        resultado: resultado.source,
      }),
    );
  }

  return { corpo: { data: resultado }, status: 200 };
}
