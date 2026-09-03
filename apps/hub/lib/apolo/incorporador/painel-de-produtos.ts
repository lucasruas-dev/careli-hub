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

import { nomeApresentavel } from "./empreendimentos-do-portal";

/** Os seis baldes da tela (total + cinco situações), cada um com unidades e R$. */
export type Cenario = ApoloEnterpriseScenario;

export type FilhoDoPainel = {
  codigo: string;
  /** Id REAL do C2X do filho — o que a Vendas recebe se a tela quiser abrir só a etapa. */
  id: string;
  nome: string;
  scenario: Cenario;
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
  /** Filhos autorizados (vazio no pai sem filho e na linha simples). */
  etapas: number;
  filhos: FilhoDoPainel[];
  /** "pai:<uuid>" para pai do cadastro; o c2x id para linha simples fora do cadastro. */
  id: string;
  nome: string;
  scenario: Cenario;
  uf: null | string;
};

export type PainelDeProdutos = {
  /** A soma dos pais, sem repetir (cada c2x id entra numa linha só). */
  cards: Cenario;
  linhas: LinhaDoPainel[];
};

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

export function montarPainelDeProdutos(entrada: {
  cadastro: LinhaDoCadastro[];
  linhasDoC2x: ApoloEnterpriseRow[];
  /** Ids do C2X que a sessão autoriza (já expandidos por `idsDaSessao`). */
  permitidos: Set<string>;
}): PainelDeProdutos {
  const { cadastro, linhasDoC2x, permitidos } = entrada;

  const reais = linhasReaisDoC2x(linhasDoC2x);
  const filhosDe = filhosDoCadastro(cadastro);
  const consumidos = new Set<string>();
  const montadas: Array<{ linha: LinhaDoPainel; vendendo: boolean }> = [];

  // Filho autorizado sem linha no C2X (id errado no cadastro) entra ZERADO, e não some: sumir
  // esconderia o erro de cadastro; zero na tela é o que faz alguém corrigir.
  const cenarioDe = (c2xId: null | string): Cenario =>
    (c2xId ? reais.get(c2xId)?.scenario : undefined) ?? cenarioVazio();

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
          scenario: cenarioDe(filho.c2xEnterpriseId),
        }));

      for (const filho of filhos) consumidos.add(filho.id);
      // O espelho não entra na soma, mas também não pode sobrar para a lista residual: viraria
      // uma segunda linha "Vale do Ouro" e contaria as mesmas unidades de novo nos cards.
      if (pai.c2xEnterpriseId) consumidos.add(pai.c2xEnterpriseId);

      const codes = filhos.map((filho) => filho.codigo);

      montadas.push({
        linha: {
          aviso: null,
          cidade: pai.cidade,
          codigo: codes.join(" + "),
          codes,
          etapas: filhos.length,
          filhos,
          id: idDoPainelDoPai(pai.id),
          nome: pai.nome,
          scenario: somarCenarios(filhos.map((filho) => filho.scenario)),
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
          etapas: 0,
          filhos: [],
          id: idDoPainelDoPai(pai.id),
          nome: pai.nome,
          scenario: cenarioDe(alcance.espelho),
          uf: pai.uf,
        },
        vendendo: pai.vendendo,
      });
    }
  }

  // O que a sessão alcança e o cadastro do Panteon ainda não conhece: linha simples com o nome do
  // C2X. "group:…" da sessão não tem linha real e cai fora sozinho; as divisões dele já vieram
  // expandidas em `permitidos`.
  for (const id of permitidos) {
    const limpo = String(id).trim();
    if (!limpo || consumidos.has(limpo)) continue;

    const linha = reais.get(limpo);
    if (!linha) continue;

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
        etapas: 0,
        filhos: [],
        id: limpo,
        nome: nomeApresentavel(linha.name ?? code ?? "Empreendimento"),
        scenario: linha.scenario,
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
