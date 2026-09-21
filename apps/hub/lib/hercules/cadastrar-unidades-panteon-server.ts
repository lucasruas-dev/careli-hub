// O CADASTRO DE UNIDADES NO PANTEON: a peça de servidor que as DUAS portas chamam.
//
// Decisão do Lucas (16/09/2026) para o portal da Cecílio Rocha: mesmo banco, mesmas tabelas, mesmo
// código, e a unidade cadastrada pelo portal grava no Panteon (`hercules_unidades`), NUNCA no C2X,
// que é somente leitura. As regras puras (validação, código, rótulo, planilha, a linha do banco)
// moram em `./unidade-nova.ts`; aqui fica a ida ao banco e as decisões que só o banco responde.
//
// AS DUAS PORTAS: /api/incorporador/produto/unidades/cadastrar (cookie do portal, escopo da sessão)
// e /api/apolo/empreendimentos/unidades/panteon (Bearer do hub, `authorizeApoloWrite`). A rota só
// autoriza e recorta. A regra de cadastro mora aqui, uma vez, para o portal e o hub nunca aceitarem
// unidades diferentes.
//
// ⚠️ O TIPO DO PRODUTO VEM DO CADASTRO, NUNCA DO CORPO. Loteamento ou prédio decide quais colunas
// valem, o formato do código e o texto que vai para WhatsApp, PDF e contrato. Se a tela mandasse o
// tipo, uma aba velha (ou um corpo forjado) gravaria apartamento em quadra/lote.
//
// ⚠️ CONFERIR NÃO ESCREVE NADA, e as outras ações reconferem no servidor a partir das linhas cruas:
// entre a conferência e o clique alguém pode ter cadastrado a mesma unidade.
//
// ⚠️ IMPORTAR É TUDO OU NADA. Uma linha com erro recusa a planilha inteira, e a gravação é UM
// insert só (uma instrução no Postgres: entra tudo ou não entra nada). O motivo é o reenvio: com
// importação parcial, a planilha corrigida voltaria acusando "já cadastrada" nas linhas que
// entraram da primeira vez, e o operador teria que caçar quais apagar do arquivo. Por isso o envio
// tem teto (`MAXIMO_DE_UNIDADES_POR_ENVIO`): lote pequeno cabe numa instrução só, e o que passa
// disso se divide por quadra ou por torre.
//
// ⚠️ SÓ PRODUTO NASCIDO NO PANTEON RECEBE UNIDADE (revisão de 16/09/2026). O VOC 37, o Garden 39 e
// os outros produtos do C2X têm o estoque num retrato parado da carga (`carregar-unidades-do-c2x.mjs`)
// enquanto o legado continua vivo: a conferência aqui não enxerga o lote criado lá depois da carga, a
// aba Unidades e o Resumo continuam lendo o C2X, e a próxima carga bateria no índice único. Seriam
// duas fontes para o mesmo estoque, o que o Lucas vetou em 04/09. Liberar exige aposentar a carga
// daquele produto e fazer a aba Unidades ler o Panteon (decisão dele).
//
// ⚠️ A EXCEÇÃO É CORRIGIR, NÃO CRIAR (decisão D2 do Lucas, 16/09/2026). O produto do C2X que JÁ tem
// dono marcado (`operado_por`, hoje o Garden 39 da Cecílio) passou a ter o estoque mantido pelo
// Panteon: a carga do C2X e o semeador pulam produto com dono, e a aba Unidades e o Resumo leem
// `hercules_unidades` dele. Então nele `modelo` e `atualizar` passam (preço, área e matrícula das
// unidades que vieram da carga), e `conferir`, `criar` e `importar` continuam 409: unidade NOVA num
// id abaixo de 100000 ainda bateria no terreno que o C2X pode ter criado depois da carga.
//
// ⚠️ ATUALIZAR NUNCA MEXE EM SITUAÇÃO. Disponível, reservada, vendida e bloqueada são consequência
// do fluxo de venda (reserva, proposta, contrato, bloqueio com motivo e autor), e cada uma dessas
// telas tem a própria trava. Um campo "situação" num formulário de cadastro desfaria todas elas.
import {
  podeCadastrarNoProduto,
  type PortalDaEscrita,
} from "@/lib/apolo/incorporador/operacao-do-produto";
import { createApoloAdminClient } from "@/lib/apolo/server";

import { lerCadastroDeEmpreendimentos, type LinhaDoCadastro } from "./cadastro";
import { ehIdDoPai, PREFIXO_DO_PAI } from "./expandir-id-do-painel";
import { codigoDoProduto, ehIdDoPanteon, tipoProdutoDe, type TipoProduto } from "./produto-novo";
import {
  type CampoDaPlanilhaDeUnidades,
  type CampoDaUnidade,
  chaveDaColunaDeUnidades,
  chaveDeVinculoDaColuna,
  chaveDaUnidade,
  type ColunaDaPlanilhaDeUnidades,
  COLUNA_DE_CATEGORIA,
  colunasDaPlanilha,
  conferirPlanilhaDeUnidades,
  ehColunaDaUnidadeVerticalAusente,
  type EntradaDeUnidade,
  type ErrosDaUnidade,
  lerCsvDeUnidades,
  type LinhaDaPlanilhaDeUnidades,
  linhaDaUnidadeNova,
  type LinhaDeUnidadeNova,
  MAXIMO_DE_UNIDADES_POR_ENVIO,
  type PartesDaUnidade,
  type ProblemaDaLinhaDeUnidade,
  rotuloDaUnidade,
  type UnidadeConferida,
  type UnidadeNova,
  validarUnidade,
} from "./unidade-nova";
import { categoriaPorNome, comparavel } from "./vinculo-da-unidade";

// ⚠️ "careli", A STRING. `hercules_unidades.workspace_id` é text com default 'careli' (0112). Um uuid
// aqui não dá erro de tipo: casa zero linhas em silêncio, e a checagem de duplicado diria "nenhuma
// unidade existe" para um produto cheio (o defeito exato que a rota do bloqueio já pagou).
const WORKSPACE = "careli";

// O PostgREST corta em 1.000 linhas SEM erro: toda leitura de lista pagina.
const PAGINA = 1000;

// `.in()` vai na URL e estoura em 400 perto de 400 itens: leitura por lista vai em lotes de 100.
const LOTE_DO_IN = 100;

// O teto por envio mora na fundação (a tela também o usa); reexportado para quem já importava daqui.
export { MAXIMO_DE_UNIDADES_POR_ENVIO };

/**
 * O MESMO texto para "não existe" e "não é seu". No portal, uma resposta diferente para cada caso
 * deixaria alguém de fora descobrir, trocando o número, quais produtos existem.
 */
export const PRODUTO_NAO_ENCONTRADO = "Produto não encontrado.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SO_DIGITOS = /^\d{1,18}$/;

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

type ClienteAdmin = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type AutorDoCadastro = { id: null | string; nome: null | string };

/** O produto onde a unidade vai morar, como o cadastro do Panteon o descreve. */
export type ProdutoDoCadastro = {
  codigo: string;
  /** O `c2x_enterprise_id` do produto: é o `enterprise_id` que a unidade grava. */
  enterpriseId: string;
  /** O uuid de `hercules_empreendimentos`. Não sai na resposta. */
  id: string;
  nome: string;
  /** `apolo_incorporadores.id` de quem opera. Nulo = a Careli. */
  operadoPor: null | string;
  tipoProduto: TipoProduto;
};

export type Falha = {
  data?: unknown;
  /**
   * O detalhe técnico (migration pendente, mensagem do banco). A rota do HUB devolve; a do PORTAL
   * não, porque o time do cliente não tem o que fazer com o nome de uma migration.
   */
  detalhe?: string;
  error: string;
  ok: false;
  status: number;
};

export type Sucesso<T> = { data: T; ok: true };

function falha(status: number, error: string, extra?: { data?: unknown; detalhe?: string }): Falha {
  return { ...extra, error, ok: false, status };
}

/** Uma unidade que já existe no banco, com as partes que dizem "é o mesmo terreno/apartamento". */
export type UnidadeExistente = PartesDaUnidade & { codigo: string; enterpriseId: string };

/** Como a unidade volta para a tela depois de gravada: o que o banco confirmou. */
export type UnidadeGravada = { codigo: string; id: string; rotulo: string; situacao: string };

/** Uma linha da planilha (ou o formulário), julgada. */
export type LinhaConferida = {
  /**
   * A categoria que esta linha CASOU, pelo nome cadastrado (não o que o operador digitou).
   *
   * ⚠️ É O RELATÓRIO DO VÍNCULO, e é por isso que ela sai por linha: o operador precisa ver "esta
   * entrou em Condomínio" e "esta não casou com nada", sem abrir o arquivo de novo. Nulo = a coluna
   * veio em branco (o estado normal) ou a linha não entra.
   */
  categoria: null | string;
  codigo: null | string;
  /** Linha como o operador vê no Excel: a 1 é o cabeçalho. */
  linha: number;
  problemas: ProblemaDaLinhaDeUnidade[];
  resultado: "aviso" | "erro" | "ok";
  rotulo: null | string;
  /** A unidade normalizada, quando a linha pode entrar. */
  unidade: null | UnidadeNova;
};

export type ConferenciaDoCadastro = {
  linhas: LinhaConferida[];
  /** As que podem ser gravadas (com ou sem aviso). */
  prontas: UnidadeConferida[];
  resumo: {
    comAviso: number;
    /** Quantas linhas prontas nascem com categoria. */
    comCategoria: number;
    comErro: number;
    jaExistem: number;
    prontas: number;
    total: number;
  };
};

type ProdutoPublico = Pick<ProdutoDoCadastro, "codigo" | "enterpriseId" | "nome" | "tipoProduto">;

function produtoPublico(produto: ProdutoDoCadastro): ProdutoPublico {
  return {
    codigo: produto.codigo,
    enterpriseId: produto.enterpriseId,
    nome: produto.nome,
    tipoProduto: produto.tipoProduto,
  };
}

function texto(valor: unknown): null | string {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo ? limpo : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// REGRAS PURAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O produto que o pedido aponta, a partir do cadastro do Panteon.
 *
 * O pedido chega em dois formatos: o id do produto ("37", "100001", a chave que a unidade grava)
 * ou "pai:<uuid>", que é o `empFixo` da ficha do produto quando a linha do painel é um pai.
 *
 * ⚠️ PRODUTO DIVIDIDO EM GLEBAS NÃO RECEBE UNIDADE. No Vale do Ouro e na Lagoa Bonita o mesmo
 * terreno já tem duas linhas (a do pai, parada, e a da gleba que vende; migration 0161), e a
 * verdade é a da gleba. Unidade nova no pai criaria um terceiro registro que nenhuma gleba vende.
 *
 * `familia` são os `enterprise_id` do pai e das glebas irmãs (sem o próprio produto): a numeração de
 * quadra e lote é UMA para o loteamento inteiro, e a conferência usa isso para não deixar o mesmo
 * terreno entrar em duas glebas.
 */
export function resolverProduto(
  cadastro: LinhaDoCadastro[],
  pedido: null | string | undefined,
): Falha | ({ familia: string[]; ok: true; produto: ProdutoDoCadastro }) {
  const alvo = String(pedido ?? "").trim();

  let linha: LinhaDoCadastro | undefined;
  if (ehIdDoPai(alvo)) {
    const uuid = alvo.slice(PREFIXO_DO_PAI.length);
    linha = cadastro.find((l) => l.id === uuid);
  } else if (SO_DIGITOS.test(alvo)) {
    linha = cadastro.find((l) => l.c2xEnterpriseId === alvo);
  }

  const enterpriseId = texto(linha?.c2xEnterpriseId);
  if (!linha || !enterpriseId) return falha(404, PRODUTO_NAO_ENCONTRADO);

  const produto: ProdutoDoCadastro = {
    codigo: codigoDoProduto(linha.codigo),
    enterpriseId,
    id: linha.id,
    nome: linha.nome,
    operadoPor: texto(linha.operadoPor),
    tipoProduto: tipoProdutoDe(linha.tipoProduto),
  };

  const familia = linha.paiId
    ? cadastro
        .filter((l) => l.id === linha.paiId || l.paiId === linha.paiId)
        .map((l) => texto(l.c2xEnterpriseId))
        .filter((id): id is string => Boolean(id) && id !== enterpriseId)
    : [];

  return { familia: [...new Set(familia)], ok: true, produto };
}

/** As ações do cadastro de unidades (o `acao` do corpo). */
export type AcaoDoCadastroDeUnidades = "atualizar" | "conferir" | "criar" | "importar" | "modelo";

const ACOES_DO_CADASTRO: readonly AcaoDoCadastroDeUnidades[] = [
  "atualizar",
  "conferir",
  "criar",
  "importar",
  "modelo",
];

function ehAcaoDoCadastro(valor: unknown): valor is AcaoDoCadastroDeUnidades {
  return typeof valor === "string" && (ACOES_DO_CADASTRO as readonly string[]).includes(valor);
}

/**
 * As guardas do produto que dependem de o pedido JÁ estar autorizado. Ficam fora de
 * `resolverProduto` de propósito: se rodassem antes do escopo, o 409 "dividido em glebas" diria a
 * quem é de fora que aquele produto existe.
 *
 * ⚠️ A AÇÃO ENTRA NA DECISÃO (D2, 16/09/2026). No produto do C2X com dono marcado, `modelo` e
 * `atualizar` passam (o estoque dele é mantido aqui); unidade nova continua recusada. Ver o topo.
 */
export function produtoRecebeUnidade(
  cadastro: LinhaDoCadastro[],
  produto: ProdutoDoCadastro,
  acao: AcaoDoCadastroDeUnidades,
): Falha | null {
  // Ver o topo do arquivo: produto do C2X (e o ZZ TESTE 9001, id inventado abaixo de 100000) tem o
  // estoque noutra fonte, e unidade nova aqui seria a segunda. Com dono marcado, corrigir o que já
  // existe é daqui.
  const soCorrigeOQueExiste = acao === "atualizar" || acao === "modelo";
  if (!ehIdDoPanteon(produto.enterpriseId) && !(soCorrigeOQueExiste && texto(produto.operadoPor))) {
    return falha(
      409,
      "O estoque deste empreendimento ainda é mantido pela Careli. Peça a inclusão da unidade a ela.",
      {
        detalhe:
          "Produto do C2X (enterprise_id abaixo de 100000): hercules_unidades é retrato da carga e a aba Unidades lê o C2X; unidade nova aqui criaria duas fontes.",
      },
    );
  }
  if (cadastro.some((l) => l.paiId === produto.id)) {
    return falha(
      409,
      "Este produto é dividido em glebas. Cadastre a unidade na gleba onde ela vai ser vendida.",
    );
  }
  if (!produto.codigo) {
    return falha(
      409,
      "Este produto está sem código, e o código da unidade nasce dele. Complete o cadastro do produto antes.",
    );
  }
  return null;
}

/**
 * O produto está no recorte do PORTAL?
 *
 * ⚠️ DUAS CONDIÇÕES, E AS DUAS FECHAM:
 *   • o `enterprise_id` está entre os ids que a sessão alcança (`idsDaSessao`, já expandido);
 *   • o produto MARCA que é este incorporador quem o opera (0170). A Gurgel também vende produto da
 *     Cecílio, mas o estoque de um produto é de quem o opera.
 *
 * ⚠️ SEM MARCA É RECUSA (revisão de 16/09/2026). `operado_por` nulo quer dizer "a Careli opera", e
 * até aqui ele liberava o produto para qualquer portal que operasse a venda: um coordenador da
 * Gurgel importava 500 lotes no LBF, gleba que a Careli administra. Nulo também é o que sai quando a
 * 0170 não responde, e aí a regra fecha sozinha em vez de abrir para todos.
 *
 * ⚠️ A SEGUNDA CONDIÇÃO É `podeCadastrarNoProduto`, A RÉGUA ÚNICA DO PORTAL (D1, 16/09/2026), e não
 * uma comparação escrita aqui: o comercial nunca cadastra, o portal que confecciona só no produto
 * que ele opera, qualquer outro portal nunca, e sem a 0170 ninguém.
 */
export function produtoNoRecorteDoPortal(
  produto: Pick<ProdutoDoCadastro, "enterpriseId" | "operadoPor">,
  recorte: PortalDaEscrita & { com0170: boolean; permitidos: ReadonlySet<string> },
): boolean {
  if (!recorte.permitidos.has(produto.enterpriseId)) return false;
  return podeCadastrarNoProduto(recorte, produto.operadoPor, recorte.com0170);
}

/**
 * Uma linha crua (da planilha lida no navegador ou do formulário) com as chaves que a validação
 * entende, PARA O TIPO DO PRODUTO.
 *
 * ⚠️ O TIPO MUDA O SIGNIFICADO DA CHAVE: "area" é a área do lote no loteamento e a área privativa no
 * prédio. A tela pode mandar o cabeçalho cru ("Área (m²)", "Apto"): o mapeamento é o mesmo da leitura
 * de CSV. Chave exata do tipo vence a chave traduzida quando as duas vêm.
 */
export function linhaNaChaveDoTipo(tipoProduto: TipoProduto, bruta: unknown): LinhaDaPlanilhaDeUnidades {
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) return {};

  // A categoria entra junto: ela não é campo da unidade (`colunasDaPlanilha` desenha o formulário),
  // mas é coluna da planilha e precisa chegar ao servidor para virar `categoria_id`.
  const campos = new Set<string>([
    ...colunasDaPlanilha(tipoProduto).map((c) => c.chave),
    COLUNA_DE_CATEGORIA.chave,
  ]);
  const saida: LinhaDaPlanilhaDeUnidades = {};

  for (const [chaveCrua, valor] of Object.entries(bruta as Record<string, unknown>)) {
    const exata = campos.has(chaveCrua);
    const chave = exata
      ? (chaveCrua as CampoDaPlanilhaDeUnidades)
      : chaveDaColunaDeUnidades(tipoProduto, chaveCrua) || chaveDeVinculoDaColuna(chaveCrua);
    if (!chave || !campos.has(chave)) continue;
    if (exata || saida[chave] === undefined) saida[chave] = valor;
  }

  return saida;
}

function temAlgumValor(linha: LinhaDaPlanilhaDeUnidades): boolean {
  return Object.values(linha).some((v) => String(v ?? "").trim() !== "");
}

/** As linhas do pedido: `csv` (texto do arquivo) ou `linhas` (objetos já lidos pela tela). */
export function linhasDoPedido(
  tipoProduto: TipoProduto,
  corpo: { csv?: unknown; linhas?: unknown },
): Falha | { linhas: LinhaDaPlanilhaDeUnidades[]; ok: true } {
  let linhas: LinhaDaPlanilhaDeUnidades[] = [];

  if (typeof corpo.csv === "string" && corpo.csv.trim() !== "") {
    linhas = lerCsvDeUnidades(tipoProduto, corpo.csv);
  } else if (Array.isArray(corpo.linhas)) {
    linhas = corpo.linhas.map((l) => linhaNaChaveDoTipo(tipoProduto, l)).filter(temAlgumValor);
  }

  if (linhas.length === 0) return falha(400, "A planilha veio vazia.");

  if (linhas.length > MAXIMO_DE_UNIDADES_POR_ENVIO) {
    return falha(
      400,
      `Envie no máximo ${MAXIMO_DE_UNIDADES_POR_ENVIO} unidades por vez. Divida a planilha (por quadra ou por torre) e envie em partes.`,
    );
  }

  return { linhas, ok: true };
}

/** A chave tem as partes que identificam a unidade? Linha sem elas não pode casar com nada. */
function chaveCompleta(tipoProduto: TipoProduto, chave: string): boolean {
  const [primeira = "", segunda = ""] = chave.split("|");
  // Torre vazia é legítima (prédio de torre única); quadra vazia não.
  return tipoProduto === "vertical" ? segunda !== "" : primeira !== "" && segunda !== "";
}

/**
 * Confere as linhas contra as regras da unidade E contra o que já está no banco.
 *
 * A validação e a repetição DENTRO da planilha são as da fundação (`conferirPlanilhaDeUnidades`).
 * O cruzamento com o banco é feito aqui, e não passando as existentes para a fundação, porque aqui
 * a resposta precisa dizer QUAL o caso ("já cadastrada neste produto" × "já existe em outra gleba"),
 * e a rota de criar responde 409 para duplicado e 422 para dado inválido.
 *
 *   • no próprio produto: pelo código (o índice único da 0112) e pelas partes (quadra/lote ou
 *     torre/apartamento; o código sozinho não pega a unidade que o C2X nomeou fora do padrão);
 *   • na família (pai e glebas irmãs), SÓ NO LOTEAMENTO: a numeração de quadra e lote é do
 *     loteamento inteiro (é a chave com que a 0161 casou pai e gleba). Prédio não compartilha
 *     numeração: o 101 de uma torre não é o 101 de outra.
 *
 * ⚠️ E A CATEGORIA DA PLANILHA É RESOLVIDA AQUI, contra as categorias da FAMÍLIA (Lucas, 15/09/2026:
 * *"normalmente vamos subir em massa essa configuração na importação de unidades"*). Nome que não
 * existe é ERRO DA LINHA, nunca "entra sem categoria": a unidade entraria calada no lugar errado, e
 * a categoria é o que decide qual minuta o lote assina.
 */
export function conferirContraOBanco(
  tipoProduto: TipoProduto,
  linhas: LinhaDaPlanilhaDeUnidades[],
  opcoes: {
    /** As categorias da FAMÍLIA (a categoria mora no pai e vale para as glebas). */
    categorias?: readonly { id: string; nome: string }[];
    familia?: UnidadeExistente[];
    prefixo: string;
    proprias?: UnidadeExistente[];
  },
): ConferenciaDoCadastro {
  const base = conferirPlanilhaDeUnidades(tipoProduto, linhas, { prefixo: opcoes.prefixo });
  const campoDaChave = tipoProduto === "vertical" ? "torre/apartamento" : "quadra/lote";

  const codigosProprios = new Set((opcoes.proprias ?? []).map((u) => String(u.codigo).trim().toUpperCase()));
  const chavesProprias = new Map<string, string>();
  for (const u of opcoes.proprias ?? []) {
    const chave = chaveDaUnidade(tipoProduto, u);
    if (chaveCompleta(tipoProduto, chave)) chavesProprias.set(chave, u.codigo);
  }

  const chavesDaFamilia = new Map<string, string>();
  if (tipoProduto === "loteamento") {
    for (const u of opcoes.familia ?? []) {
      const chave = chaveDaUnidade(tipoProduto, u);
      if (chaveCompleta(tipoProduto, chave)) chavesDaFamilia.set(chave, u.codigo);
    }
  }

  const jaExistem = new Map<number, ProblemaDaLinhaDeUnidade>();
  const prontas: UnidadeConferida[] = [];

  for (const conferida of base.unidades) {
    const chave = chaveDaUnidade(tipoProduto, conferida.unidade);
    const pelaChave = chavesProprias.get(chave);
    const doProduto = pelaChave ?? (codigosProprios.has(conferida.codigo) ? conferida.codigo : undefined);

    if (doProduto) {
      jaExistem.set(conferida.linha, {
        campo: campoDaChave,
        linha: conferida.linha,
        // ⚠️ O MESMO CÓDIGO COM PARTES DIFERENTES NÃO É "JÁ CADASTRADA": é outra unidade que dá o mesmo
        // código (quadra 010 lote 11 × quadra 01 lote 011). Dizer "já cadastrada" mandaria a pessoa
        // procurar um lote que não existe.
        motivo: pelaChave
          ? `${conferida.rotulo} já está cadastrada neste produto (${doProduto}).`
          : `${conferida.rotulo} gera o código ${doProduto}, que já é de outra unidade deste produto. Confira ${
              tipoProduto === "vertical" ? "a torre e o apartamento" : "a quadra e o lote"
            }.`,
        valor: conferida.codigo,
      });
      continue;
    }

    // ⚠️ SEM O CÓDIGO DA GÊMEA NA MENSAGEM. A gleba irmã pode ser de outro dono (VOC da Cecílio, VOL
    // do Lino), e `conferir` aceita 500 linhas por chamada sem gravar nada: com o código na resposta,
    // quem só tem uma gleba listaria o estoque da outra testando quadra e lote.
    if (chavesDaFamilia.has(chave)) {
      jaExistem.set(conferida.linha, {
        campo: campoDaChave,
        linha: conferida.linha,
        motivo: `${conferida.rotulo} já existe neste loteamento. O mesmo terreno não pode ser cadastrado duas vezes.`,
        valor: conferida.codigo,
      });
      continue;
    }

    prontas.push(conferida);
  }

  // ⚠️ A CATEGORIA CASA POR NOME, IGNORANDO CAIXA E ACENTO (`categoriaPorNome`): o operador digita
  // "CONDOMINIO" no Excel, e recusar por causa do acento faria a importação falhar por um detalhe de
  // teclado. Nome que NÃO existe tira a linha da gravação e diz qual é — as outras entram.
  const porNome = categoriaPorNome(opcoes.categorias ?? []);
  const nomePeloId = new Map((opcoes.categorias ?? []).map((c) => [c.id, c.nome]));
  const problemasDaCategoria = new Map<number, ProblemaDaLinhaDeUnidade>();
  const prontasComVinculo: UnidadeConferida[] = [];

  for (const conferida of prontas) {
    const pedida = texto(conferida.categoria);
    if (!pedida) {
      prontasComVinculo.push(conferida);
      continue;
    }
    const id = porNome.get(comparavel(pedida));
    if (!id) {
      problemasDaCategoria.set(conferida.linha, {
        campo: "categoria",
        linha: conferida.linha,
        motivo:
          (opcoes.categorias ?? []).length === 0
            ? `Este empreendimento não tem categorias cadastradas, e a planilha pede "${pedida}". Cadastre a categoria antes, ou deixe a coluna em branco.`
            : `A categoria "${pedida}" não existe neste empreendimento.`,
        valor: pedida,
      });
      continue;
    }
    prontasComVinculo.push({ ...conferida, categoriaId: id });
  }

  const problemasPorLinha = new Map<number, ProblemaDaLinhaDeUnidade[]>();
  const anotar = (p: ProblemaDaLinhaDeUnidade) => {
    const lista = problemasPorLinha.get(p.linha) ?? [];
    lista.push(p);
    problemasPorLinha.set(p.linha, lista);
  };
  // O aviso de uma linha que não vai entrar (ex.: "sem preço" numa unidade que já existe) só polui.
  for (const p of base.problemas) if (!(p.soAviso && jaExistem.has(p.linha))) anotar(p);
  for (const p of jaExistem.values()) anotar(p);
  for (const p of problemasDaCategoria.values()) anotar(p);

  const prontaPorLinha = new Map(prontasComVinculo.map((u) => [u.linha, u]));
  const conferidaPorLinha = new Map(base.unidades.map((u) => [u.linha, u]));

  const saida: LinhaConferida[] = linhas.map((_, indice) => {
    const linha = indice + 2;
    const problemas = problemasPorLinha.get(linha) ?? [];
    const pronta = prontaPorLinha.get(linha);
    const conferida = conferidaPorLinha.get(linha);
    const temErro = !pronta || problemas.some((p) => !p.soAviso);
    return {
      categoria: temErro || !pronta?.categoriaId ? null : (nomePeloId.get(pronta.categoriaId) ?? null),
      codigo: conferida?.codigo ?? null,
      linha,
      problemas,
      resultado: temErro ? "erro" : problemas.length > 0 ? "aviso" : "ok",
      rotulo: conferida?.rotulo ?? null,
      unidade: temErro ? null : (pronta?.unidade ?? null),
    };
  });

  return {
    linhas: saida,
    prontas: prontasComVinculo,
    resumo: {
      comAviso: saida.filter((l) => l.resultado === "aviso").length,
      comCategoria: prontasComVinculo.filter((u) => u.categoriaId).length,
      comErro: saida.filter((l) => l.resultado === "erro").length,
      jaExistem: jaExistem.size,
      prontas: prontasComVinculo.length,
      total: saida.length,
    },
  };
}

/**
 * Quem cadastrou, no formato que a linha aceita.
 *
 * ⚠️ `bloqueado_por` É UUID (0163). O atalho de ambiente local do hub devolve "local-hub-user", e um
 * texto que não é uuid derrubaria o insert inteiro com 22P02: o id sai nulo e o nome continua.
 */
export function autorGravavel(autor: AutorDoCadastro | null | undefined): AutorDoCadastro {
  const id = texto(autor?.id);
  return { id: id && UUID.test(id) ? id : null, nome: texto(autor?.nome) };
}

export type LinhaParaGravar = LinhaDeUnidadeNova & {
  /** Só quando a planilha pediu categoria: chave ausente não é citada no insert. */
  categoria_id?: string;
  origem_c2x_id: null;
  tipo_unidade: "apartamento" | "lote";
};

/**
 * A linha do insert: a da fundação, mais o que só o servidor completa.
 *
 * `tipo_unidade` é o texto que o contrato escreve em "a unidade do tipo [tipo_unidade]" (a
 * variável da Têmis mostra "lote" como exemplo), por isso "lote" ou "apartamento", coerente com o
 * tipo do produto. `origem_c2x_id` nulo diz "nasceu no Panteon": é o sinal que a carga do C2X usa
 * para não tocar na linha, e o que a atualização usa para saber que o cadastro é daqui.
 */
export function linhaParaGravar(
  conferida: Pick<UnidadeConferida, "categoriaId" | "unidade">,
  contexto: { agora: Date; autor: AutorDoCadastro; produto: Pick<ProdutoDoCadastro, "codigo" | "enterpriseId"> },
): LinhaParaGravar {
  const linha = linhaDaUnidadeNova(conferida.unidade, {
    agora: contexto.agora,
    autor: autorGravavel(contexto.autor),
    enterpriseId: contexto.produto.enterpriseId,
    prefixo: contexto.produto.codigo,
  });
  return {
    ...linha,
    // ⚠️ SÓ QUANDO A PLANILHA PEDIU. Mandar `categoria_id: null` seria igual em efeito, mas a chave
    // ausente é o que faz o insert continuar funcionando se um dia a coluna não estiver lá — a
    // mesma disciplina das colunas da 0171.
    ...(conferida.categoriaId ? { categoria_id: conferida.categoriaId } : {}),
    origem_c2x_id: null,
    tipo_unidade: conferida.unidade.tipoProduto === "vertical" ? "apartamento" : "lote",
  };
}

/** A unidade como está no banco, com as colunas que a atualização precisa. */
export type UnidadeDoBanco = {
  andar?: null | number;
  apartamento?: null | string;
  area: null | number | string;
  codigo: string;
  enterprise_id: string;
  espelho_de: null | string;
  id: string;
  lote: null | string;
  matricula: null | string;
  origem_c2x_id: null | number | string;
  preco_tabela: null | number | string;
  quadra: null | string;
  situacao: string;
  tipologia?: null | string;
  torre?: null | string;
  vagas?: null | number;
};

export type PatchDaUnidade = {
  area?: number;
  area_extenso?: null;
  matricula?: null | string;
  preco_extenso?: null;
  preco_tabela?: null | number;
  tipologia?: null | string;
  vagas?: null | number;
};

const EDITAVEIS: Record<TipoProduto, ReadonlySet<string>> = {
  loteamento: new Set(["area", "matricula", "preco"]),
  vertical: new Set(["area", "areaPrivativa", "matricula", "preco", "tipologia", "vagas"]),
};

const IDENTIDADE = new Set(["andar", "apartamento", "codigo", "lote", "quadra", "torre"]);

function mesmoNumero(a: unknown, b: null | number): boolean {
  if (a === null || a === undefined || a === "") return b === null;
  return b !== null && Number(a) === b;
}

/**
 * O que muda numa unidade existente, validado pela MESMA régua do cadastro.
 *
 * ⚠️ VALIDA A UNIDADE INTEIRA, NÃO SÓ O CAMPO. A unidade de hoje (do banco) recebe as mudanças por
 * cima e passa por `validarUnidade`: uma regra de preço ou de área escrita só aqui divergiria da do
 * cadastro no primeiro ajuste. A situação fica de fora da validação (não é assunto desta ação).
 *
 * ⚠️ SITUAÇÃO NO CORPO É RECUSADA, NÃO IGNORADA. Ignorar calado deixaria a tela achar que desbloqueou
 * uma unidade. E quadra, lote, torre, andar e apartamento também: eles formam o código, e o código é
 * a chave que a venda, o espelho e o contrato já usam.
 *
 * ⚠️ O EXTENSO SAI JUNTO COM O NÚMERO. `area_extenso`/`preco_extenso` guardam o que o contrato
 * escreve por extenso; mudar a área e deixar o extenso antigo imprimiria dois números diferentes na
 * mesma cláusula.
 */
export function montarAtualizacao(
  tipoProduto: TipoProduto,
  atual: UnidadeDoBanco,
  campos: unknown,
):
  | { avisos: ErrosDaUnidade; mexeNoValor: boolean; ok: true; patch: PatchDaUnidade }
  | (Falha & { erros?: ErrosDaUnidade }) {
  if (!campos || typeof campos !== "object" || Array.isArray(campos)) {
    return falha(400, "Informe o que mudar na unidade.");
  }

  const pedidos = Object.entries(campos as Record<string, unknown>);
  if (pedidos.length === 0) return falha(400, "Informe o que mudar na unidade.");

  for (const [chave] of pedidos) {
    if (chave === "situacao" || chave === "motivoDoBloqueio") {
      return falha(
        400,
        "A situação da unidade não muda por aqui: reserva, venda e bloqueio têm caminho próprio.",
      );
    }
    if (IDENTIDADE.has(chave)) {
      return falha(
        400,
        "Quadra, lote, torre, andar e apartamento identificam a unidade e não mudam depois do cadastro.",
      );
    }
    if (!EDITAVEIS[tipoProduto].has(chave)) {
      return falha(
        400,
        EDITAVEIS.vertical.has(chave)
          ? `O campo ${chave} não se aplica a loteamento.`
          : `Campo desconhecido: ${chave}.`,
      );
    }
  }

  // "area" no prédio é a área privativa (a coluna é uma só; ver a 0171).
  const mudancas: EntradaDeUnidade = {};
  for (const [chave, valor] of pedidos) {
    const destino = tipoProduto === "vertical" && chave === "area" ? "areaPrivativa" : chave;
    mudancas[destino as CampoDaUnidade] = valor;
  }

  const hoje: EntradaDeUnidade =
    tipoProduto === "vertical"
      ? {
          andar: atual.andar,
          apartamento: atual.apartamento,
          areaPrivativa: atual.area,
          matricula: atual.matricula,
          preco: atual.preco_tabela,
          tipologia: atual.tipologia,
          torre: atual.torre,
          vagas: atual.vagas,
        }
      : {
          area: atual.area,
          lote: atual.lote,
          matricula: atual.matricula,
          preco: atual.preco_tabela,
          quadra: atual.quadra,
        };

  const resultado = validarUnidade(tipoProduto, { ...hoje, ...mudancas });
  if (!resultado.ok) {
    const primeiro = Object.values(resultado.erros)[0] ?? "Confira os dados da unidade.";
    // Os erros por campo vão em `data`, para a tela pintar o campo certo.
    return { ...falha(422, primeiro, { data: { erros: resultado.erros } }), erros: resultado.erros };
  }

  const unidade = resultado.unidade;
  const pedidas = new Set(Object.keys(mudancas));
  const patch: PatchDaUnidade = {};

  // ⚠️ UNIDADE FORA DE BLOQUEIO NÃO FICA SEM PREÇO. No cadastro, sem preço a unidade nasce bloqueada
  // (`validarUnidade`); aqui a situação não muda, então apagar o preço de uma disponível a deixaria na
  // grade da Venda com R$ 0. Só a bloqueada perde o preço.
  if (pedidas.has("preco") && unidade.preco === null && atual.situacao !== "bloqueada") {
    const erros: ErrosDaUnidade = {
      preco: "Unidade fora de bloqueio não fica sem preço. Para tirar o preço, bloqueie a unidade antes pela tela Venda.",
    };
    return { ...falha(422, erros.preco as string, { data: { erros } }), erros };
  }

  const area = unidade.tipoProduto === "vertical" ? unidade.areaPrivativa : unidade.area;
  if ((pedidas.has("area") || pedidas.has("areaPrivativa")) && !mesmoNumero(atual.area, area)) {
    patch.area = area;
    patch.area_extenso = null;
  }
  if (pedidas.has("preco") && !mesmoNumero(atual.preco_tabela, unidade.preco)) {
    patch.preco_tabela = unidade.preco;
    patch.preco_extenso = null;
  }
  if (pedidas.has("matricula") && texto(atual.matricula) !== unidade.matricula) {
    patch.matricula = unidade.matricula;
  }
  if (unidade.tipoProduto === "vertical") {
    if (pedidas.has("tipologia") && texto(atual.tipologia) !== unidade.tipologia) {
      patch.tipologia = unidade.tipologia;
    }
    if (pedidas.has("vagas") && !mesmoNumero(atual.vagas, unidade.vagas)) {
      patch.vagas = unidade.vagas;
    }
  }

  const avisos: ErrosDaUnidade = {};
  for (const [campo, aviso] of Object.entries(resultado.avisos) as [CampoDaUnidade, string][]) {
    if (pedidas.has(campo)) avisos[campo] = aviso;
  }
  // O aviso do cadastro ("entra bloqueada") não vale aqui: a unidade já está bloqueada.
  if (avisos.preco && unidade.preco === null) {
    avisos.preco = "Sem valor de tabela: a unidade fica fora da venda e do VGV até alguém preencher o preço.";
  }

  return {
    avisos,
    mexeNoValor: "area" in patch || "preco_tabela" in patch,
    ok: true,
    patch,
  };
}

/** O texto da recusa quando o corpo tenta mudar situação ou identificação de unidade da carga. */
export const SITUACAO_E_IDENTIDADE_NAO_MUDAM = "A situação e a identificação da unidade não se alteram por aqui.";

const EDITAVEIS_NA_UNIDADE_DA_CARGA: ReadonlySet<string> = new Set(["area", "matricula", "preco"]);

/**
 * O corpo pode corrigir esta unidade que veio da carga do C2X? `null` = pode seguir para
 * `montarAtualizacao`; senão a recusa pronta (422).
 *
 * ⚠️ SÓ PREÇO, ÁREA E MATRÍCULA (D2, 16/09/2026). A unidade da carga nasceu com a situação e o nome
 * do legado; tipologia e vagas não existem no loteamento que o C2X mandou. Situação, motivo do
 * bloqueio e as partes que formam o código são recusados com a mesma frase, e qualquer outro campo
 * com a lista do que vale. Corpo que não é objeto segue: `montarAtualizacao` responde o 400 dele.
 */
export function camposDaUnidadeDaCarga(campos: unknown): Falha | null {
  if (!campos || typeof campos !== "object" || Array.isArray(campos)) return null;

  for (const chave of Object.keys(campos as Record<string, unknown>)) {
    if (chave === "situacao" || chave === "motivoDoBloqueio" || IDENTIDADE.has(chave)) {
      return falha(422, SITUACAO_E_IDENTIDADE_NAO_MUDAM);
    }
    if (!EDITAVEIS_NA_UNIDADE_DA_CARGA.has(chave)) {
      return falha(422, "Nesta unidade só o preço, a área e a matrícula podem ser corrigidos.");
    }
  }
  return null;
}

/** Divide uma lista em pedaços de `tamanho`. */
export function emLotes<T>(lista: readonly T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEITURAS
// ─────────────────────────────────────────────────────────────────────────────

const COLUNAS_DA_EXISTENTE = "codigo,enterprise_id,quadra,lote";
const COLUNAS_VERTICAIS = "torre,apartamento";

type ExistenteCrua = {
  apartamento?: null | string;
  codigo: null | string;
  enterprise_id: null | string;
  lote: null | string;
  quadra: null | string;
  torre?: null | string;
};

/**
 * As unidades que já existem no produto e na família, paginadas.
 *
 * ⚠️ SEM A 0171, O PRÉDIO LÊ SEM TORRE E APARTAMENTO e avisa quem chamou (`colunasVerticaisAusentes`):
 * a conferência continua valendo pelo código, e a gravação de apartamento responde 503.
 */
async function lerExistentes(
  admin: ClienteAdmin,
  ids: string[],
  tipoProduto: TipoProduto,
): Promise<
  | { colunasVerticaisAusentes: boolean; ok: true; unidades: UnidadeExistente[] }
  | { detalhe: string; ok: false }
> {
  const unidades: UnidadeExistente[] = [];
  let colunas =
    tipoProduto === "vertical" ? `${COLUNAS_DA_EXISTENTE},${COLUNAS_VERTICAIS}` : COLUNAS_DA_EXISTENTE;
  let colunasVerticaisAusentes = false;

  for (let de = 0; ; de += PAGINA) {
    const ler = (selecao: string) =>
      admin
        .from("hercules_unidades")
        .select(selecao)
        .eq("workspace_id", WORKSPACE)
        .in("enterprise_id", ids)
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1);

    let { data, error } = await ler(colunas);

    if (error && colunas !== COLUNAS_DA_EXISTENTE && ehColunaDaUnidadeVerticalAusente(error)) {
      colunas = COLUNAS_DA_EXISTENTE;
      colunasVerticaisAusentes = true;
      ({ data, error } = await ler(colunas));
    }

    if (error) return { detalhe: error.message, ok: false };

    const pagina = (data ?? []) as unknown as ExistenteCrua[];
    for (const u of pagina) {
      unidades.push({
        apartamento: u.apartamento ?? null,
        codigo: String(u.codigo ?? ""),
        enterpriseId: String(u.enterprise_id ?? ""),
        lote: u.lote,
        quadra: u.quadra,
        torre: u.torre ?? null,
      });
    }

    if (pagina.length < PAGINA) break;
  }

  return { colunasVerticaisAusentes, ok: true, unidades };
}

/**
 * As categorias da FAMÍLIA (o produto mais o pai e as glebas irmãs).
 *
 * ⚠️ DA FAMÍLIA, E NÃO DO PRODUTO. Medido em 21/09/2026: as 907 unidades com categoria apontam para
 * as duas categorias cadastradas no Lagoa Bonita PAI (31), e 412 delas são linhas das glebas. Ler só
 * o `enterprise_id` do produto faria a planilha da gleba dizer "a categoria Condomínio não existe"
 * justamente para a categoria que carimba 750 lotes.
 *
 * ⚠️ FALHA NÃO DERRUBA O CADASTRO: devolve lista vazia, e a planilha que pediu categoria recusa a
 * linha com "este empreendimento não tem categorias cadastradas". A unidade sem categoria entra —
 * que é o estado normal de 36 dos 37 produtos.
 */
async function lerCategoriasDaFamilia(
  admin: ClienteAdmin,
  ids: string[],
): Promise<{ id: string; nome: string }[]> {
  try {
    const { data, error } = await admin
      .from("temis_categorias")
      .select("id,nome,ativa")
      .eq("workspace_id", WORKSPACE)
      .in("enterprise_id", ids)
      .order("nome", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as { ativa: boolean | null; id: string; nome: null | string }[])
      .filter((c) => c.ativa !== false)
      .map((c) => ({ id: c.id, nome: String(c.nome ?? "") }));
  } catch (erro) {
    console.warn("[hercules][cadastro-de-unidades] categorias da família indisponíveis", erro);
    return [];
  }
}

type GravadaCrua = {
  apartamento?: null | string;
  codigo: string;
  id: string;
  lote: null | string;
  quadra: null | string;
  situacao: string;
  torre?: null | string;
};

/**
 * Relê do banco o que acabou de ser gravado, pelo código, em lotes de 100.
 *
 * ⚠️ A RESPOSTA DA TELA É O QUE O BANCO TEM, NÃO O QUE FOI ENVIADO. Um sucesso do insert com uma
 * linha a menos (gatilho, política, coluna trocada) passaria calado se a resposta ecoasse o corpo.
 */
async function relerGravadas(
  admin: ClienteAdmin,
  produto: ProdutoDoCadastro,
  codigos: string[],
): Promise<{ faltando: string[]; ok: true; unidades: UnidadeGravada[] } | { detalhe: string; ok: false }> {
  const colunas =
    produto.tipoProduto === "vertical"
      ? `id,codigo,situacao,quadra,lote,${COLUNAS_VERTICAIS}`
      : "id,codigo,situacao,quadra,lote";
  const achadas = new Map<string, UnidadeGravada>();

  for (const lote of emLotes(codigos, LOTE_DO_IN)) {
    const { data, error } = await admin
      .from("hercules_unidades")
      .select(colunas)
      .eq("workspace_id", WORKSPACE)
      .eq("enterprise_id", produto.enterpriseId)
      .in("codigo", lote)
      .range(0, PAGINA - 1);

    if (error) return { detalhe: error.message, ok: false };

    for (const u of (data ?? []) as unknown as GravadaCrua[]) {
      achadas.set(u.codigo, {
        codigo: u.codigo,
        id: u.id,
        rotulo: rotuloDaUnidade(produto.tipoProduto, u),
        situacao: u.situacao,
      });
    }
  }

  return {
    faltando: codigos.filter((c) => !achadas.has(c)),
    ok: true,
    unidades: codigos.map((c) => achadas.get(c)).filter((u): u is UnidadeGravada => Boolean(u)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AS AÇÕES
// ─────────────────────────────────────────────────────────────────────────────

export type EntradaDoCadastro = {
  /** Relógio injetável para o teste. */
  agora?: Date;
  autor: AutorDoCadastro;
  /** O corpo do POST, cru: `{ acao, linhas?, csv?, unidade?, unidadeId?, campos? }`. */
  corpo: unknown;
  /** O produto: id ("37", "100001") ou "pai:<uuid>". */
  pedido: null | string | undefined;
  /**
   * A guarda da porta, aplicada ao produto JÁ resolvido e antes de qualquer outra resposta que
   * revele algo sobre ele. O portal passa o escopo da sessão; o hub não passa nada.
   *
   * `contexto.com0170` diz se o cadastro veio com as colunas da 0170: é o que a régua do portal
   * (`podeCadastrarNoProduto`) exige para confiar em `operadoPor`.
   */
  podeOperar?: (produto: ProdutoDoCadastro, contexto: { com0170: boolean }) => boolean;
};

type Corpo = {
  acao?: unknown;
  campos?: unknown;
  csv?: unknown;
  linhas?: unknown;
  unidade?: unknown;
  unidadeId?: unknown;
};

const TEXTO_SEM_COLUNAS_VERTICAIS =
  "O cadastro de apartamentos ainda não está liberado. Fale com a Careli.";
const DETALHE_SEM_COLUNAS_VERTICAIS =
  "Migration 0171 (torre, andar, apartamento, tipologia, vagas em hercules_unidades) não aplicada.";

/**
 * A ação pedida, do começo ao fim. NUNCA LANÇA: toda falha vira `{ ok: false, status, error }`.
 *
 *   • `modelo`    → o produto e as colunas da planilha do tipo dele. Não lê unidade.
 *   • `conferir`  → julga as linhas (validação, repetição, já existentes). Não escreve.
 *   • `criar`     → uma unidade (`unidade`), pela mesma conferência. 422 dado inválido, 409 duplicada.
 *   • `importar`  → várias (`linhas` ou `csv`). Tudo ou nada; relida do banco.
 *   • `atualizar` → área, preço, matrícula, tipologia, vagas de UMA unidade (`unidadeId`, `campos`).
 */
export async function executarCadastroDeUnidades(
  entrada: EntradaDoCadastro,
): Promise<Falha | Sucesso<unknown>> {
  const corpo = (entrada.corpo && typeof entrada.corpo === "object" ? entrada.corpo : {}) as Corpo;
  const acao = corpo.acao;

  if (!ehAcaoDoCadastro(acao)) {
    return falha(400, "Ação desconhecida.");
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return falha(503, "Cadastro de unidades indisponível.", { detalhe: "Supabase sem configuração." });
  }

  let cadastro: LinhaDoCadastro[];
  let com0170: boolean;
  try {
    const lido = await lerCadastroDeEmpreendimentos();
    // ⚠️ SEM AS COLUNAS DA 0170 NÃO HÁ COMO SABER O TIPO NEM QUEM OPERA. A leitura cai em "Careli
    // opera, loteamento", e gravar com isso poria lote num prédio. Fail-closed, antes de olhar o
    // produto (a resposta não diz nada sobre ele).
    if (!lido.com0170) {
      return falha(503, "O cadastro de unidades está indisponível agora. Tente de novo em instantes.", {
        detalhe: "Colunas da migration 0170 (operado_por, tipo_produto) ausentes na leitura do cadastro.",
      });
    }
    cadastro = lido.linhas;
    com0170 = lido.com0170;
  } catch (erro) {
    return falha(503, "Não foi possível carregar os produtos agora.", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
  }

  const resolvido = resolverProduto(cadastro, entrada.pedido);
  if (!resolvido.ok) return resolvido;

  const { familia, produto } = resolvido;

  // ⚠️ A GUARDA DA PORTA VEM ANTES DE QUALQUER OUTRA RESPOSTA sobre o produto, e devolve o MESMO
  // 404 de um produto que não existe.
  if (entrada.podeOperar && !entrada.podeOperar(produto, { com0170 })) {
    return falha(404, PRODUTO_NAO_ENCONTRADO);
  }

  const recusa = produtoRecebeUnidade(cadastro, produto, acao);
  if (recusa) return recusa;

  const agora = entrada.agora ?? new Date();

  try {
    if (acao === "modelo") {
      return {
        data: {
          // A planilha-modelo traz a coluna Categoria, e a tela precisa dos nomes aceitos para
          // preencher o exemplo com uma categoria que existe de verdade neste empreendimento.
          categorias: await lerCategoriasDaFamilia(admin, [produto.enterpriseId, ...familia]),
          colunas: colunasDaPlanilha(produto.tipoProduto),
          // ⚠️ A COLUNA DO VÍNCULO SAI SEPARADA das colunas da unidade. A tela do PORTAL monta um
          // campo do formulário por item de `colunas`; a categoria não é campo da unidade e viraria
          // um texto livre sem lista nem conferência. Quem monta a planilha-modelo junta as duas.
          colunasDoVinculo: [COLUNA_DE_CATEGORIA],
          produto: produtoPublico(produto),
        },
        ok: true,
      };
    }

    if (acao === "atualizar") {
      return await atualizar(admin, produto, corpo, agora);
    }

    // conferir, criar e importar passam pela MESMA conferência.
    const pedidoDeLinhas =
      acao === "criar"
        ? corpo.unidade && typeof corpo.unidade === "object"
          ? linhasDoPedido(produto.tipoProduto, { linhas: [corpo.unidade] })
          : falha(400, "Unidade não informada.")
        : linhasDoPedido(produto.tipoProduto, { csv: corpo.csv, linhas: corpo.linhas });
    if (!pedidoDeLinhas.ok) return pedidoDeLinhas;

    const existentes = await lerExistentes(admin, [produto.enterpriseId, ...familia], produto.tipoProduto);
    if (!existentes.ok) {
      return falha(503, "Não foi possível conferir as unidades que já existem. Nada foi gravado.", {
        detalhe: existentes.detalhe,
      });
    }

    const proprias = existentes.unidades.filter((u) => u.enterpriseId === produto.enterpriseId);
    const categorias = await lerCategoriasDaFamilia(admin, [produto.enterpriseId, ...familia]);
    const conferencia = conferirContraOBanco(produto.tipoProduto, pedidoDeLinhas.linhas, {
      categorias,
      familia: existentes.unidades.filter((u) => u.enterpriseId !== produto.enterpriseId),
      prefixo: produto.codigo,
      proprias,
    });

    const semColunasVerticais =
      produto.tipoProduto === "vertical" && existentes.colunasVerticaisAusentes;

    const paraATela = {
      bloqueioDaGravacao: semColunasVerticais ? TEXTO_SEM_COLUNAS_VERTICAIS : null,
      // ⚠️ A LISTA DE CATEGORIAS VAI JUNTO, e não é enfeite: sem ela a tela só saberia dizer "a
      // categoria X não existe", e o operador teria de sair da importação para descobrir quais
      // existem. Com ela, a conferência mostra os nomes aceitos ao lado do erro.
      categorias,
      colunas: colunasDaPlanilha(produto.tipoProduto) as readonly ColunaDaPlanilhaDeUnidades[],
      colunasDoVinculo: [COLUNA_DE_CATEGORIA],
      linhas: conferencia.linhas,
      produto: produtoPublico(produto),
      resumo: conferencia.resumo,
      /** Quantas unidades o produto tem hoje, pela mesma leitura da conferência. */
      unidadesHoje: proprias.length,
    };

    if (acao === "conferir") return { data: paraATela, ok: true };

    if (conferencia.resumo.comErro > 0) {
      const primeira = conferencia.linhas.find((l) => l.resultado === "erro");
      const motivo = primeira?.problemas.find((p) => !p.soAviso)?.motivo ?? "Confira os dados da unidade.";

      if (acao === "criar") {
        // Duplicada é conflito com o que existe (409); dado inválido é do pedido (422).
        return falha(conferencia.resumo.jaExistem > 0 ? 409 : 422, motivo, { data: paraATela });
      }

      const n = conferencia.resumo.comErro;
      return falha(
        422,
        `${n} ${n === 1 ? "linha tem" : "linhas têm"} problema, e nada foi gravado. Corrija a planilha e envie de novo.`,
        { data: paraATela },
      );
    }

    if (semColunasVerticais) {
      return falha(503, TEXTO_SEM_COLUNAS_VERTICAIS, { detalhe: DETALHE_SEM_COLUNAS_VERTICAIS });
    }

    const linhas = conferencia.prontas.map((conferida) =>
      linhaParaGravar(conferida, { agora, autor: entrada.autor, produto }),
    );

    // ⚠️ UM INSERT SÓ, E É ELE QUE FAZ O "TUDO OU NADA". Uma chamada com a lista inteira é uma
    // instrução no Postgres; se uma linha bater no índice único (alguém cadastrou a mesma unidade
    // entre a conferência e agora), nenhuma entra.
    const { error } = await admin.from("hercules_unidades").insert(linhas);

    if (error) {
      if (ehColunaDaUnidadeVerticalAusente(error)) {
        return falha(503, TEXTO_SEM_COLUNAS_VERTICAIS, { detalhe: DETALHE_SEM_COLUNAS_VERTICAIS });
      }
      if (error.code === "23505") {
        return falha(
          409,
          acao === "criar"
            ? "Esta unidade acabou de ser cadastrada por outra pessoa."
            : "Uma das unidades acabou de ser cadastrada por outra pessoa, e nada foi gravado. Confira de novo.",
          { detalhe: error.message },
        );
      }
      if (error.code === "23514") {
        return falha(422, "O banco recusou um dos valores, e nada foi gravado.", { detalhe: error.message });
      }
      return falha(503, "Não foi possível gravar as unidades agora. Confira a lista antes de tentar de novo.", {
        detalhe: error.message,
      });
    }

    const codigos = linhas.map((l) => l.codigo);
    const relidas = await relerGravadas(admin, produto, codigos);

    if (!relidas.ok) {
      return falha(
        503,
        "As unidades foram enviadas, mas não deu para confirmar no banco. Confira a lista antes de enviar de novo.",
        { detalhe: relidas.detalhe },
      );
    }

    if (relidas.faltando.length > 0) {
      return falha(
        500,
        "Parte das unidades não apareceu no banco depois da gravação. Confira a lista antes de enviar de novo.",
        { data: { faltando: relidas.faltando, unidades: relidas.unidades }, detalhe: "Releitura por código não achou todas." },
      );
    }

    const avisos = conferencia.linhas.flatMap((l) => l.problemas.filter((p) => p.soAviso));

    if (acao === "criar") {
      return {
        data: { avisos, produto: produtoPublico(produto), unidade: relidas.unidades[0] ?? null },
        ok: true,
      };
    }

    return {
      data: {
        avisos,
        criadas: relidas.unidades.length,
        produto: produtoPublico(produto),
        unidades: relidas.unidades,
      },
      ok: true,
    };
  } catch (erro) {
    return falha(503, "Não foi possível concluir o cadastro agora.", {
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
  }
}

const COLUNAS_DA_ATUALIZACAO =
  "id,codigo,enterprise_id,quadra,lote,area,preco_tabela,matricula,situacao,espelho_de,origem_c2x_id";
const COLUNAS_VERTICAIS_DA_ATUALIZACAO = "torre,andar,apartamento,tipologia,vagas";

async function atualizar(
  admin: ClienteAdmin,
  produto: ProdutoDoCadastro,
  corpo: Corpo,
  agora: Date,
): Promise<Falha | Sucesso<unknown>> {
  const unidadeId = texto(corpo.unidadeId);
  // Id que não é uuid não existe: 404 antes de o Postgres responder 22P02.
  if (!unidadeId || !UUID.test(unidadeId)) return falha(404, "Unidade não encontrada.");

  const vertical = produto.tipoProduto === "vertical";
  const ler = (selecao: string) =>
    admin
      .from("hercules_unidades")
      .select(selecao)
      .eq("workspace_id", WORKSPACE)
      .eq("enterprise_id", produto.enterpriseId)
      .eq("id", unidadeId)
      .maybeSingle();

  const { data, error } = await ler(
    vertical ? `${COLUNAS_DA_ATUALIZACAO},${COLUNAS_VERTICAIS_DA_ATUALIZACAO}` : COLUNAS_DA_ATUALIZACAO,
  );
  if (error && vertical && ehColunaDaUnidadeVerticalAusente(error)) {
    return falha(503, TEXTO_SEM_COLUNAS_VERTICAIS, { detalhe: DETALHE_SEM_COLUNAS_VERTICAIS });
  }
  if (error) {
    return falha(503, "Não foi possível ler a unidade agora.", { detalhe: error.message });
  }

  // ⚠️ O PRODUTO ENTRA NO FILTRO. Sem `enterprise_id`, um uuid de unidade de outro produto (de outro
  // incorporador) seria editável por quem só tem este no recorte.
  const atual = data as unknown as null | UnidadeDoBanco;
  if (!atual) return falha(404, "Unidade não encontrada.");

  if (atual.espelho_de) {
    return falha(409, "Esta linha é o registro antigo do terreno. Corrija a unidade pela gleba que vende.");
  }

  // ⚠️ A UNIDADE QUE VEIO DA CARGA DO C2X SÓ SE EDITA AQUI QUANDO O PRODUTO TEM DONO MARCADO. Sem
  // dono, a carga (`carregar-unidades-do-c2x.mjs`) reescreve área, preço e matrícula por
  // `origem_c2x_id` e a aba Unidades lê o C2X ao vivo: editar só no Panteon criaria um preço aqui e
  // outro lá, o erro de "duas fontes" que o Lucas proibiu. Com dono (D2, 16/09/2026: o Garden da
  // Cecílio), a carga e o semeador pulam o produto e as telas leem `hercules_unidades`, então o
  // cadastro passou a ser daqui. Mesmo assim só preço, área e matrícula: a situação é do fluxo de
  // venda e a identificação (quadra, lote) é a chave que o contrato e o espelho já usam.
  if (atual.origem_c2x_id !== null && atual.origem_c2x_id !== undefined) {
    if (!texto(produto.operadoPor)) {
      return falha(409, "Esta unidade veio do sistema anterior, e o cadastro dela ainda não é corrigido por aqui.", {
        detalhe: "origem_c2x_id preenchido em produto sem operado_por: a carga do C2X sobrescreve área, preço e matrícula.",
      });
    }
    const recusaDaCarga = camposDaUnidadeDaCarga(corpo.campos);
    if (recusaDaCarga) return recusaDaCarga;
  }

  const montada = montarAtualizacao(produto.tipoProduto, atual, corpo.campos);
  if (!montada.ok) return montada;

  const rotulo = rotuloDaUnidade(produto.tipoProduto, atual);
  const alterados = Object.keys(montada.patch).filter((c) => !c.endsWith("_extenso"));

  if (alterados.length === 0) {
    return {
      data: { alterados, avisos: montada.avisos, produto: produtoPublico(produto), unidade: { codigo: atual.codigo, id: atual.id, rotulo } },
      ok: true,
    };
  }

  // ⚠️ PREÇO E ÁREA TRAVAM COM VENDA EM ANDAMENTO. São a base da proposta (a simulação lê
  // `preco_tabela`) e da cláusula do imóvel no contrato: mudá-los com reserva ou proposta viva faria
  // a proposta e a tabela contarem histórias diferentes. Matrícula, tipologia e vagas continuam
  // livres, porque a matrícula costuma chegar justamente quando a venda já anda.
  if (montada.mexeNoValor) {
    if (atual.situacao !== "disponivel" && atual.situacao !== "bloqueada") {
      return falha(409, `Esta unidade está ${atual.situacao}: preço e área ficam travados enquanto a venda anda.`);
    }

    // A proposta viva ganha da coluna `situacao` (a mesma pergunta da rota do bloqueio): pela
    // ETAPA, porque `aberta` nunca volta para false.
    const { data: vivas, error: erroDasPropostas } = await admin
      .from("hercules_propostas")
      .select("id,etapa")
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", atual.id)
      .not("etapa", "in", '("cancelado","distrato")')
      .limit(1);

    // Fail-closed: sem conseguir provar que não há venda andando, preço e área não mudam.
    if (erroDasPropostas) {
      return falha(503, "Não foi possível conferir as propostas da unidade agora.", {
        detalhe: erroDasPropostas.message,
      });
    }
    if (Array.isArray(vivas) && vivas.length > 0) {
      return falha(409, "Esta unidade tem um processo de venda em andamento: preço e área ficam travados.");
    }

    // ⚠️ A RESERVA VIVA TAMBÉM TRAVA, E NÃO SÓ A SITUAÇÃO DA UNIDADE. A rota da reserva grava a
    // reserva 'ativa' e só DEPOIS marca a unidade como reservada, num update separado: nesse
    // intervalo (ou se aquele update falhar) a unidade segue 'disponivel' com reserva viva, e o preço
    // mudaria debaixo do preço combinado. As situações vivas são as do índice
    // `hercules_reservas_uma_viva_por_unidade` (0125).
    const { data: reservas, error: erroDasReservas } = await admin
      .from("hercules_reservas")
      .select("id")
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", atual.id)
      .in("situacao", ["ativa", "proposta"])
      .limit(1);

    if (erroDasReservas) {
      return falha(503, "Não foi possível conferir as reservas da unidade agora.", {
        detalhe: erroDasReservas.message,
      });
    }
    if (Array.isArray(reservas) && reservas.length > 0) {
      return falha(409, "Esta unidade tem uma reserva em andamento: preço e área ficam travados.");
    }
  }

  let gravar = admin
    .from("hercules_unidades")
    .update({ ...montada.patch, atualizado_em: agora.toISOString() })
    .eq("workspace_id", WORKSPACE)
    .eq("enterprise_id", produto.enterpriseId)
    .eq("id", atual.id);

  // ⚠️ O UPDATE É CONDICIONAL QUANDO MEXE NO VALOR, e é ele a trava: entre a leitura e a gravação
  // cabe uma reserva. Quem chegar depois casa zero linhas, e o `select` mostra isso.
  if (montada.mexeNoValor) gravar = gravar.in("situacao", ["disponivel", "bloqueada"]);

  const { data: gravadas, error: erroDaGravacao } = await gravar.select("id");

  if (erroDaGravacao) {
    if (ehColunaDaUnidadeVerticalAusente(erroDaGravacao)) {
      return falha(503, TEXTO_SEM_COLUNAS_VERTICAIS, { detalhe: DETALHE_SEM_COLUNAS_VERTICAIS });
    }
    return falha(503, "Não foi possível atualizar a unidade agora.", { detalhe: erroDaGravacao.message });
  }

  if (!Array.isArray(gravadas) || gravadas.length === 0) {
    return falha(409, "A unidade mudou enquanto você editava. Recarregue e tente de novo.");
  }

  return {
    data: {
      alterados,
      avisos: montada.avisos,
      produto: produtoPublico(produto),
      unidade: { codigo: atual.codigo, id: atual.id, rotulo },
    },
    ok: true,
  };
}
