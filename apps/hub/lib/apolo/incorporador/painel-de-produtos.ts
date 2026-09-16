// O PAINEL DE PRODUTOS DO HÉRCULES: os seis cards e a tabela pai/filhos, recortados pela sessão.
//
// Lucas (02/09/2026): *"queria trazer aquela tela que temos no empreendimento (...) vendas tem que
// morar dentro da tela de produtos"*. A tela é a de Empreendimentos do Apolo (seis cards no topo,
// uma linha por produto com chevron para as etapas); aqui ela vira a aba Produtos do portal
// comercial, e o "Ver mais" abre a Vendas fixa naquele produto.
//
// O QUE MUDA EM RELAÇÃO AO APOLO: lá o agrupamento vem de `ENTERPRISE_GROUPS` (lista fixa em
// código, onde o Vale do Ouro nunca entrou e por isso aparecia solto). Aqui o agrupamento vem do
// CADASTRO DO PANTEON (hercules_empreendimentos, migration 0123): pai e filhos, editável sem
// deploy. Os NÚMEROS continuam vindo do C2X (`loadApoloEnterprises`), por id real.
//
// ⚠️ O PAI É A SOMA DOS FILHOS, NUNCA O ESPELHO. O VLO (35) está parado no C2X — mostra 118
// unidades "em negociação" que já viraram venda nos filhos. Quando o pai tem filho autorizado, o
// cenário dele é a soma desses filhos, e o espelho é só CONSUMIDO (sai da lista residual, para
// não virar uma segunda linha "Vale do Ouro" somando as mesmas unidades nos cards). A regra de
// quem responde pelo pai é `alcanceDoPai`, a MESMA que a rota de Vendas usa para expandir
// "pai:<uuid>": o card e o funil nunca discordam.
//
// ⚠️ ESCOPO. `permitidos` é o que `idsDaSessao` já expandiu. Um pai aparece se algum filho OU o
// próprio espelho estiver lá; só os filhos autorizados entram na soma. Quem tem a gleba do
// Fernando (LBF) vê "Lagoa Bonita" com 1 etapa e os números dela — não os do Raposo.
//
// Função pura: a rota carrega cadastro, C2X e sessão e chama daqui.
import type {
  ApoloEnterpriseBucket,
  ApoloEnterpriseRow,
  ApoloEnterpriseScenario,
} from "@/lib/apolo/empreendimentos";
import { findEnterpriseMirror } from "@/lib/guardian/c2x-analytics";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";
import {
  alcanceDoPai,
  filhosDoCadastro,
  idDoPainelDoPai,
} from "@/lib/hercules/expandir-id-do-painel";
import { tipoProdutoDe, type TipoProduto } from "@/lib/hercules/produto-novo";

import { nomeApresentavel } from "./empreendimentos-do-portal";
import {
  operadorDoEnterprise,
  podeEscreverNosEnterprises,
  type PortalDaEscrita,
} from "./operacao-do-produto";

/** Os seis baldes da tela (total + cinco situações), cada um com unidades e R$. */
export type Cenario = ApoloEnterpriseScenario;

export type FilhoDoPainel = {
  codigo: string;
  /** Id REAL do C2X do filho — o que a Vendas recebe se a tela quiser abrir só a etapa. */
  id: string;
  nome: string;
  /** `apolo_incorporadores.id` de quem opera o filho (0170). Nulo = a Careli. Ver `LinhaDoPainel.podeEscrever`. */
  operadoPor?: null | string;
  /** O portal pode escrever neste filho? Mesma régua da linha (`podeEscreverNosEnterprises`). */
  podeEscrever?: boolean;
  scenario: Cenario;
  /** Loteamento ou prédio, do cadastro (0170). Opcional só no tipo: `montarPainelDeProdutos` sempre preenche. */
  tipoProduto?: TipoProduto;
};

export type LinhaDoPainel = {
  /**
   * Rótulo curto para a sublinha quando os números são de um ESPELHO do C2X (histórico, parado):
   * "Histórico · mesmos lotes de VOC + VOL". Nulo na linha viva. `painel-para-apolo.ts` traduz
   * para `mirror` + `mirrorLabel` da tela do Apolo.
   */
  aviso: null | string;
  cidade: null | string;
  /** "VOC + VOL + VOR" (filhos autorizados), ou o código do pai/da linha simples. */
  codigo: string;
  codes: string[];
  /**
   * O enterprise que as ações de ESCRITA da ficha recebem (minutas, adicionar unidades, editar
   * unidade): o id REAL de um produto só, nunca "pai:<uuid>".
   *   • linha simples (C2X ou avulsa do Panteon) → o próprio id;
   *   • pai sem filho cadastrado → o c2x do pai (o Garden, 39);
   *   • pai com UM filho autorizado → o id desse filho;
   *   • pai com vários filhos, ou espelho com filhos cadastrados → nulo (a escrita pede UM produto,
   *     e o espelho parado não recebe unidade).
   * Opcional só no tipo: `montarPainelDeProdutos` sempre preenche.
   */
  enterpriseId?: null | string;
  /** Filhos autorizados (vazio no pai sem filho e na linha simples). */
  etapas: number;
  filhos: FilhoDoPainel[];
  /** "pai:<uuid>" para pai do cadastro; o c2x id para linha simples fora do cadastro. */
  id: string;
  nome: string;
  /**
   * Quem opera o produto (0170), quando todos os ids da linha concordam; nulo = a Careli, ou donos
   * diferentes entre os filhos. Só informativo: quem decide é `podeEscrever`.
   */
  operadoPor?: null | string;
  /**
   * O portal da sessão pode ESCREVER neste produto? Decisão do Lucas (16/09/2026): no portal que
   * confecciona, só no produto que ele opera (VOC e VOR só consulta para a Cecílio). É a régua de
   * `operacao-do-produto.ts` sobre os ids que a linha cobre, calculada aqui para a tela esconder os
   * botões; as rotas conferem de novo. Ausente = falso.
   */
  podeEscrever?: boolean;
  scenario: Cenario;
  /**
   * Loteamento ou prédio: decide o formulário de unidade (quadra e lote, ou torre e apartamento) e o
   * modelo da planilha na ficha do produto. Do cadastro do Panteon (0170); a linha que só o C2X
   * conhece é loteamento, que é tudo o que o legado tem.
   *
   * ⚠️ OPCIONAL SÓ NO TIPO, para não quebrar quem monta `LinhaDoPainel` à mão (painel-para-apolo e
   * testes). `montarPainelDeProdutos` SEMPRE preenche; quem lê trata ausente como loteamento.
   */
  tipoProduto?: TipoProduto;
  uf: null | string;
};

export type PainelDeProdutos = {
  /**
   * Preenchido quando a moldura do C2X não veio e o painel saiu só com o que o cadastro do Panteon
   * sabe (a rota decide). Nulo/ausente = painel completo. Texto para o coordenador externo: diz o
   * efeito, sem nomear sistema.
   */
  avisoDaFonte?: null | string;
  /** A soma dos pais, sem repetir (cada c2x id entra numa linha só). */
  cards: Cenario;
  linhas: LinhaDoPainel[];
};

/** O aviso de `avisoDaFonte` quando o C2X não respondeu e o painel saiu pelo cadastro. */
export const AVISO_DE_PAINEL_PARCIAL =
  "Alguns empreendimentos não carregaram agora e podem estar faltando nesta lista.";

/**
 * O painel sai, ou a rota responde 503? A decisão da rota, pura.
 *
 * ⚠️ O C2X FORA DO AR DEIXOU DE DERRUBAR O PAINEL (16/09/2026). Desde 04/09 os NÚMEROS vêm do
 * Panteon e o C2X ficou só com a moldura (nome e cidade de quem não está no cadastro). Responder
 * 503 porque a moldura não veio escondia inclusive o produto que nasceu no Panteon e nunca existiu
 * no legado — no portal da Cecílio, que vai ter prédio cadastrado só aqui, a aba Produtos inteira.
 * Agora:
 *   • C2X respondeu → o painel, como sempre (cadastro fora do ar continua degradando calado para
 *     a lista do C2X, que é a decisão antiga);
 *   • C2X fora E cadastro fora → 503: não sobra fonte de nome nenhuma;
 *   • C2X fora, cadastro de pé, nenhuma linha → 503: "nenhum produto" seria afirmação errada;
 *   • C2X fora, cadastro de pé, com linhas → o painel do cadastro, com `avisoDaFonte`, porque a
 *     linha avulsa do C2X (id que o cadastro não conhece) pode estar faltando.
 */
export function decidirPainelDeProdutos(entrada: {
  cadastroRespondeu: boolean;
  c2xRespondeu: boolean;
  painel: PainelDeProdutos;
}): { ok: false } | { ok: true; painel: PainelDeProdutos } {
  const { cadastroRespondeu, c2xRespondeu, painel } = entrada;

  if (c2xRespondeu) return { ok: true, painel: { ...painel, avisoDaFonte: null } };
  if (!cadastroRespondeu || painel.linhas.length === 0) return { ok: false };

  return { ok: true, painel: { ...painel, avisoDaFonte: AVISO_DE_PAINEL_PARCIAL } };
}

const BALDES: Array<ApoloEnterpriseBucket | "total"> = [
  "total",
  "disponivel",
  "reservado",
  "negociacao",
  "vendido",
  "bloqueado",
];

// Texto para o coordenador (externo): diz o EFEITO, sem nomear sistema. Usado só quando o C2X não
// traz o `mirrorLabel` da linha (o VLO traz; um espelho cadastrado no Panteon que o
// `ENTERPRISE_MIRRORS` não conhece, como o LAB, não).
const AVISO_DE_ESPELHO = "Visão consolidada · números podem estar defasados";

/**
 * O espelho tem alguma DIVISÃO viva autorizada na sessão? Se sim, o espelho não responde: as
 * unidades dele são as mesmas das divisões, e somar os dois é contar o loteamento duas vezes.
 * As divisões vêm de `ENTERPRISE_MIRRORS` (VLO → VOC + VOL), que é a mesma lista que
 * `loadApoloEnterprises` usa para marcar `mirror`.
 */
function espelhoTemDivisaoAutorizada(
  espelho: ApoloEnterpriseRow,
  reais: Map<string, ApoloEnterpriseRow>,
  permitidos: Set<string>,
): boolean {
  const divisoes = new Set(
    (findEnterpriseMirror(espelho.code)?.divisions ?? []).map((code) => code.toUpperCase()),
  );
  if (divisoes.size === 0) return false;

  for (const [id, linha] of reais) {
    if (!divisoes.has(String(linha.code ?? "").trim().toUpperCase())) continue;
    if (permitidos.has(id)) return true;
  }
  return false;
}

export function cenarioVazio(): Cenario {
  const cenario = {} as Cenario;
  for (const balde of BALDES) cenario[balde] = { units: 0, value: 0 };
  return cenario;
}

export function somarCenarios(lista: Cenario[]): Cenario {
  const soma = cenarioVazio();
  for (const cenario of lista) {
    for (const balde of BALDES) {
      soma[balde].units += cenario[balde]?.units ?? 0;
      soma[balde].value += cenario[balde]?.value ?? 0;
    }
  }
  return soma;
}

/**
 * As linhas REAIS do C2X, uma por enterprise_id, desfazendo o agrupamento de `ENTERPRISE_GROUPS`
 * que `loadApoloEnterprises` já fez (a Lagoa Bonita chega como `group:Lagoa Bonita` com as três
 * glebas em `stages`). O agrupamento daqui é o do cadastro do Panteon, não o da lista fixa.
 */
export function linhasReaisDoC2x(linhas: ApoloEnterpriseRow[]): Map<string, ApoloEnterpriseRow> {
  const reais = new Map<string, ApoloEnterpriseRow>();

  for (const linha of linhas) {
    const etapas = linha.stages ?? [];
    if (etapas.length === 0) {
      reais.set(String(linha.id).trim(), linha);
      continue;
    }
    for (const etapa of etapas) reais.set(String(etapa.id).trim(), etapa);
  }

  return reais;
}

/**
 * O operador comum aos ids de uma linha: o mesmo em todos, ou nulo (Careli, id fora do cadastro ou
 * donos diferentes). Só informativo; a permissão é `podeEscreverNosEnterprises`.
 */
function operadorComum(cadastro: readonly LinhaDoCadastro[], ids: readonly string[]): null | string {
  let comum: null | string = null;
  for (const [indice, id] of ids.entries()) {
    const operador = operadorDoEnterprise(cadastro, id);
    if (!operador.achado || operador.operadoPor === null) return null;
    if (indice === 0) {
      comum = operador.operadoPor;
    } else if (operador.operadoPor.trim().toLowerCase() !== (comum ?? "").trim().toLowerCase()) {
      return null;
    }
  }
  return comum;
}

export function montarPainelDeProdutos(entrada: {
  cadastro: LinhaDoCadastro[];
  /**
   * As colunas da 0170 (`operado_por`) vieram na leitura do cadastro (`lerCadastroDeEmpreendimentos`)?
   * Ausente = não: o portal que confecciona não escreve em nada (fail-closed).
   */
  com0170?: boolean;
  /**
   * O estoque de cada empreendimento, contado no PANTEON (`estoquePorEmpreendimento`).
   *
   * ⚠️ ELE MANDA NOS NÚMEROS, e o C2X ficou só com a moldura (nome, cidade, quais linhas existem).
   * Lucas (04/09/2026), vendo o empreendimento de teste com 12 unidades na Venda e zero em
   * Produtos: *"a informação de unidades tem que ser alimentada de um local somente"* — as duas
   * telas respondiam a mesma pergunta por fontes diferentes. Medido no mesmo dia: as 5.528
   * unidades batem uma a uma nos 35 empreendimentos, então trocar a fonte não mexe em número de
   * ninguém; o que muda é que empreendimento do Panteon deixa de aparecer zerado.
   */
  estoque: Map<string, Cenario>;
  linhasDoC2x: ApoloEnterpriseRow[];
  /** Ids do C2X que a sessão autoriza (já expandidos por `idsDaSessao`). */
  permitidos: Set<string>;
  /**
   * Quem é o portal da sessão, para `podeEscrever` de cada linha. Ausente = ninguém escreve: um
   * painel montado sem dizer de quem é a sessão não pode acender botão de escrita.
   */
  portal?: PortalDaEscrita;
}): PainelDeProdutos {
  const { cadastro, estoque, linhasDoC2x, permitidos, portal } = entrada;
  const com0170 = entrada.com0170 === true;

  // A RÉGUA DE ESCRITA (decisão do Lucas, 16/09/2026) sobre os ids REAIS que a linha cobre: os filhos
  // autorizados, o espelho sozinho ou o próprio id. É a mesma função que as rotas usam; aqui ela só
  // decide o que a tela oferece.
  const escritaDe = (ids: readonly string[]): { operadoPor: null | string; podeEscrever: boolean } => ({
    operadoPor: operadorComum(cadastro, ids),
    podeEscrever: portal ? podeEscreverNosEnterprises(portal, cadastro, ids, com0170) : false,
  });

  const reais = linhasReaisDoC2x(linhasDoC2x);
  const filhosDe = filhosDoCadastro(cadastro);
  const consumidos = new Set<string>();
  const montadas: Array<{ linha: LinhaDoPainel; vendendo: boolean }> = [];

  // Empreendimento sem unidade no Panteon entra ZERADO, e não some: sumir esconderia o erro de
  // cadastro (ou a carga que não rodou); zero na tela é o que faz alguém corrigir.
  const cenarioDe = (c2xId: null | string): Cenario =>
    (c2xId ? estoque.get(c2xId) : undefined) ?? cenarioVazio();

  for (const pai of cadastro) {
    if (pai.paiId !== null) continue;

    const alcance = alcanceDoPai(pai, filhosDe.get(pai.id) ?? [], permitidos);

    if (alcance.filhos.length > 0) {
      const filhos: FilhoDoPainel[] = alcance.filhos
        .filter((filho): filho is LinhaDoCadastro & { c2xEnterpriseId: string } =>
          filho.c2xEnterpriseId !== null,
        )
        .map((filho) => ({
          codigo: filho.codigo,
          id: filho.c2xEnterpriseId,
          nome: filho.nome,
          ...escritaDe([filho.c2xEnterpriseId]),
          scenario: cenarioDe(filho.c2xEnterpriseId),
          tipoProduto: tipoProdutoDe(filho.tipoProduto),
        }));

      for (const filho of filhos) consumidos.add(filho.id);
      // O espelho não entra na soma, mas também não pode sobrar para a lista residual: viraria
      // uma segunda linha "Vale do Ouro" e contaria as mesmas unidades de novo nos cards.
      if (pai.c2xEnterpriseId) consumidos.add(pai.c2xEnterpriseId);

      const codes = filhos.map((filho) => filho.codigo);
      const unicoFilho = filhos.length === 1 ? filhos[0] : undefined;

      montadas.push({
        linha: {
          aviso: null,
          cidade: pai.cidade,
          codigo: codes.join(" + "),
          codes,
          // Um filho só: a escrita vai para ele. Vários: a ficha não escolhe por baixo dos panos.
          enterpriseId: unicoFilho?.id ?? null,
          etapas: filhos.length,
          filhos,
          id: idDoPainelDoPai(pai.id),
          nome: pai.nome,
          // A linha escreve só quando TODOS os filhos que ela soma são do portal: um botão na linha
          // de "Vale do Ouro" alcançaria o VOC junto com o que é dele.
          ...escritaDe(filhos.map((filho) => filho.id)),
          scenario: somarCenarios(filhos.map((filho) => filho.scenario)),
          tipoProduto: tipoProdutoDe(pai.tipoProduto),
          uf: pai.uf,
        },
        vendendo: pai.vendendo,
      });
      continue;
    }

    if (alcance.espelho) {
      consumidos.add(alcance.espelho);

      // ⚠️ PAI COM FILHOS CADASTRADOS, MAS A SESSÃO SÓ ALCANÇA O ESPELHO (vínculo da 0122 feito no
      // 35, e não em VOC/VOL/VOR — é o item óbvio de marcar, porque a tela de gestão lista
      // `enterprises` sem agrupar). O número mostrado é o DEFASADO do C2X (118 em negociação que
      // já viraram venda nos filhos). Não é vazamento (o 35 está autorizado), mas é número parado
      // apresentado como vivo: a linha ganha o aviso, com o rótulo do C2X quando ele existe. A
      // decisão maior (sumir com o pai até o vínculo ser feito nos filhos, ou manter e sinalizar)
      // está com o Lucas — ver o relato de 02/09/2026.
      const temFilhoCadastrado = (filhosDe.get(pai.id) ?? []).some(
        (filho) => filho.c2xEnterpriseId !== null,
      );
      const espelho = reais.get(alcance.espelho);
      const aviso =
        espelho?.mirror || temFilhoCadastrado
          ? espelho?.mirrorLabel ?? AVISO_DE_ESPELHO
          : null;

      montadas.push({
        linha: {
          aviso,
          cidade: pai.cidade,
          codigo: pai.codigo,
          codes: [pai.codigo],
          // Pai sem filho (o Garden): a escrita vai para o c2x dele. Espelho com filho cadastrado (o
          // VLO parado): nulo, porque unidade e minuta nascem na divisão, não no histórico.
          enterpriseId: temFilhoCadastrado ? null : alcance.espelho,
          etapas: 0,
          filhos: [],
          id: idDoPainelDoPai(pai.id),
          nome: pai.nome,
          ...escritaDe([alcance.espelho]),
          scenario: cenarioDe(alcance.espelho),
          tipoProduto: tipoProdutoDe(pai.tipoProduto),
          uf: pai.uf,
        },
        vendendo: pai.vendendo,
      });
    }
  }

  // O que a sessão alcança e o cadastro do Panteon ainda não conhece: linha simples com o nome do
  // C2X. "group:…" da sessão não tem linha real e cai fora sozinho; as divisões dele já vieram
  // expandidas em `permitidos`.
  // Índice do cadastro por id, para a linha avulsa do produto do Panteon (logo abaixo).
  const doCadastroPorId = new Map<string, LinhaDoCadastro>();
  for (const linhaDoCadastro of cadastro) {
    if (linhaDoCadastro.c2xEnterpriseId) {
      doCadastroPorId.set(linhaDoCadastro.c2xEnterpriseId, linhaDoCadastro);
    }
  }

  for (const id of permitidos) {
    const limpo = String(id).trim();
    if (!limpo || consumidos.has(limpo)) continue;

    const linha = reais.get(limpo);
    if (!linha) {
      // ⚠️ A LINHA AVULSA TAMBÉM VALE PARA O PRODUTO DO PANTEON. Até 16/09/2026 ela só existia
      // para id do C2X (`reais`), então um id da sessão que o cadastro conhece mas que nenhum pai
      // reclamou (filho cujo pai não veio na leitura, por exemplo) sumia do painel sem aviso. Aqui
      // a moldura é a do cadastro (nome, cidade, UF) e o número é o do estoque do Panteon, a mesma
      // régua das outras linhas. Id que nem o C2X nem o cadastro conhecem continua fora: não há
      // nome para mostrar.
      const doPanteon = doCadastroPorId.get(limpo);
      if (!doPanteon) continue;

      consumidos.add(limpo);
      montadas.push({
        linha: {
          aviso: null,
          cidade: doPanteon.cidade,
          codigo: doPanteon.codigo,
          codes: doPanteon.codigo ? [doPanteon.codigo] : [],
          enterpriseId: limpo,
          etapas: 0,
          filhos: [],
          id: limpo,
          nome: doPanteon.nome,
          ...escritaDe([limpo]),
          scenario: cenarioDe(limpo),
          tipoProduto: tipoProdutoDe(doPanteon.tipoProduto),
          uf: doPanteon.uf,
        },
        vendendo: doPanteon.vendendo,
      });
      continue;
    }

    // ⚠️ O ESPELHO DO C2X (`mirror`) NÃO VIRA LINHA AO LADO DAS DIVISÕES DELE. Sem cadastro (fora
    // do ar, ou o Vale do Ouro ainda não cadastrado), a sessão natural do coordenador traz
    // 35 + 37 + 36 + 41 — e o VLO (298 unid., 118 "em negociação" parados) entrava como linha
    // própria, somando o loteamento duas vezes nos cards. `loadApoloEnterprises.totals` já
    // exclui o espelho; aqui a marca era descartada. A regra é a mesma de `alcanceDoPai`: o
    // espelho só responde quando é a ÚNICA coisa do Vale do Ouro que a sessão alcança.
    if (linha.mirror && espelhoTemDivisaoAutorizada(linha, reais, permitidos)) {
      consumidos.add(limpo);
      continue;
    }

    consumidos.add(limpo);
    const code = String(linha.code ?? "").trim().toUpperCase();

    montadas.push({
      linha: {
        // Espelho sozinho na sessão: o rótulo do C2X avisa que é histórico, em vez de deixar o
        // número parado passar por pipeline vivo.
        aviso: linha.mirror ? linha.mirrorLabel ?? AVISO_DE_ESPELHO : null,
        cidade: linha.city,
        codigo: code,
        codes: code ? [code] : [],
        enterpriseId: limpo,
        etapas: 0,
        filhos: [],
        id: limpo,
        nome: nomeApresentavel(linha.name ?? code ?? "Empreendimento"),
        // Fora do cadastro não há dono: só o comercial escreve (a régua recusa id não achado).
        ...escritaDe([limpo]),
        scenario: linha.scenario,
        // Só o C2X conhece esta linha, e o legado só tem loteamento.
        tipoProduto: "loteamento",
        uf: linha.state,
      },
      // Fora do cadastro não há como saber se vende: vai para o fim, com os inativos.
      vendendo: false,
    });
  }

  const linhas = montadas
    .sort(
      (a, b) =>
        Number(b.vendendo) - Number(a.vendendo) ||
        b.linha.scenario.total.units - a.linha.scenario.total.units ||
        a.linha.nome.localeCompare(b.linha.nome, "pt-BR"),
    )
    .map((item) => item.linha);

  return {
    cards: somarCenarios(linhas.map((linha) => linha.scenario)),
    linhas,
  };
}
