// A RÉGUA DO CADASTRO, PELO ID DO C2X (PAN-124, fatia F1). Pura: sem banco e sem rede.
//
// Lucas (24/09/2026): *"temos que ter capacidade de editar cadastros dos empreendimentos bem como
// criá-los dentro do panteon"*. Antes de qualquer tela mudar de fonte, o Panteon precisa de UM lugar
// que responda, a partir do `c2x_enterprise_id`, as perguntas que hoje cada leitor responde do seu
// jeito (lista fixa por sigla, nome do C2X, texto da esteira):
//   • o NOME DE MERCADO (o do pai, sem a divisão interna; [[feedback_pai_e_a_fonte_unidade_unica]]);
//   • a SIGLA do cadastro (`hercules_empreendimentos.codigo`);
//   • o PAI e os FILHOS;
//   • a CHAVE DO GRUPO. Até a F4 ela é o NOME DO PAI, porque é com ele que o catálogo, a sessão e o
//     settings gravam `group:<Nome>` hoje; a F4 congela a chave numa coluna;
//   • o PAPEL no grupo (divisão, pai ou simples). A chave sozinha não diz quem PERTENCE ao grupo: o
//     pai com id vivo (o VLO 35) tem a chave e fica fora dos ids, como em ENTERPRISE_GROUPS;
//   • os GRUPOS, derivados de `pai_id`, e não de `ENTERPRISE_GROUPS`.
// NENHUM LEITOR TROCA DE FONTE NA F1. A régua nasce com as provas (teste e paridade só com SELECT), e
// cada leitor passa a ela na fatia dele (F6, F7, F8b).
//
// AS TRÊS REGRAS QUE FICAM ESCRITAS AQUI (e o teste cobra cada uma):
//   1. PAI COM ID VIVO NO C2X, FORA DE `EXCLUDED_ENTERPRISE_IDS`, CONTINUA ENTRADA SIMPLES, E O GRUPO É
//      ADICIONAL. É o que o catálogo faz hoje com o VLO (35) ao lado de `group:Vale do Ouro`
//      (lib/apolo/catalogo-empreendimentos.ts, `agrupar`). Absorver o 35 no grupo tiraria o nome de 693
//      CADs no Board e 210 propostas VLO da Venda de 4 contas do portal. Juntar as duas entradas é da
//      unificação, não do PAN-124.
//   2. O LAB (31) CONTINUA FORA das entradas: `EXCLUDED_ENTERPRISE_IDS` = [2, 31, 34]. A Lagoa Bonita
//      aparece só como grupo. Pelo id a régua ainda responde o 31 (com `excluido: true`), porque o nome
//      de mercado dele é lido hoje pelo sync do Apolo (lib/apolo/nome-de-mercado-por-id.ts).
//   3. OS FILHOS SAEM NA ORDEM (ordem, codigo) DO CADASTRO, a mesma do Hércules
//      (`filhosDoCadastro`, lib/hercules/expandir-id-do-painel.ts, e lib/hercules/empreendimentos.ts).
//      Na Lagoa Bonita isso é LBF, LBP, LBR (medido em 26/09/2026: ordem 0, 1, 2), e não a ordem da
//      constante (LBF, LBR, LBP). Quem compara com a constante compara como CONJUNTO.
//
// ⚠️ UM NÍVEL SÓ. O gatilho da migration 0123 garante que o pai é raiz; a régua não sobe além dele, como
// `nomeDeMercado` (lib/apolo/empreendimento-de-mercado.ts). Filho cujo pai não veio na leitura é tratado
// como simples, e o nome de mercado dele segue a regra do prefixo antes do "·".
//
// ⚠️ SÓ SERVIDOR. A lista de excluídos mora em lib/guardian/c2x-analytics.ts, que importa o pool do C2X
// (mysql2). A varredura lib/cliente-sem-mysql.varredura.test.ts barra o "use client" que chegar aqui.
import {
  nomeDeMercado,
  semDivisao,
  type LinhaDoCadastro as LinhaDoMercado,
} from "@/lib/apolo/empreendimento-de-mercado";
import { PREFIXO_DO_GRUPO } from "@/lib/apolo/c2x-pelo-id";
import { EXCLUDED_ENTERPRISE_IDS } from "@/lib/guardian/c2x-analytics";

import type { LinhaDoCadastro } from "./cadastro";
import { filhosDoCadastro } from "./expandir-id-do-painel";

/** O pedaço de uma linha do cadastro que a régua devolve para o próprio, o pai, o filho e a divisão. */
export type ParteDaRegua = {
  /** Id do C2X, aparado. `null` no pai só do Panteon (LOX, PDX, RDX). */
  c2xEnterpriseId: null | string;
  /** O `nome` da linha, como está no cadastro ("Vale do Ouro · VOC" no filho). */
  nome: string;
  ordem: number;
  /** O uuid de `hercules_empreendimentos`. */
  panteonId: string;
  /** A sigla do CADASTRO (`codigo`), em caixa alta. Não é a do C2X. */
  sigla: string;
};

/** O que a régua responde para um id do C2X. */
export type EmpreendimentoDaRegua = ParteDaRegua & {
  c2xEnterpriseId: string;
  /**
   * A chave do grupo LIGADO ao id: na divisão, a do grupo que ela compõe; no pai, a do grupo que ele
   * encabeça; no simples, `null`. Até a F4 é o nome do pai.
   *
   * ⚠️ TER A CHAVE NÃO É PERTENCER AO GRUPO. O pai com id próprio (o VLO 35) tem a chave e fica FORA
   * de `grupos[].ids`: ENTERPRISE_GROUPS o deixa de fora de propósito, porque o 35 tem os mesmos lotes
   * das divisões e somá-lo contaria o loteamento duas vezes. Quem quer os MEMBROS do grupo lê
   * `grupos[].ids`, ou filtra por `papel === "divisao"` e `!excluido`: o teste prova que os dois dão o
   * mesmo conjunto. Filtrar só por `chaveDoGrupo` traz o pai junto.
   */
  chaveDoGrupo: null | string;
  /** Está em `EXCLUDED_ENTERPRISE_IDS` (ou na lista que quem chamou passou). */
  excluido: boolean;
  /** Os filhos, na ordem do cadastro. Vazio para filho e para empreendimento sem divisão. */
  filhos: readonly ParteDaRegua[];
  /** Nome de mercado. `""` quando não há nome confiável: aí quem chama usa o nome do C2X. */
  nomeDeMercado: string;
  /** O pai, para o filho. `null` para raiz. */
  pai: null | ParteDaRegua;
  /**
   * O lugar do id no grupo:
   *   • "divisao": filho de um pai que veio na leitura. COMPÕE o grupo: fora os excluídos, as divisões
   *     de uma chave são exatamente `grupos[].ids` dela;
   *   • "pai": raiz com filhos e com id próprio no C2X. ENCABEÇA o grupo sem estar nos ids dele. É o
   *     que o plano chama de espelho ("pai com c2x id próprio e com filhos"), que substitui
   *     ENTERPRISE_MIRRORS na F8b: hoje o VLO 35, e o LAB 31, que é excluído;
   *   • "simples": sem grupo (raiz sem filhos, ou filho cujo pai não veio na leitura).
   */
  papel: PapelNaRegua;
};

/** Ver `EmpreendimentoDaRegua.papel`. */
export type PapelNaRegua = "divisao" | "pai" | "simples";

/** Um grupo, derivado de `pai_id`: um pai do cadastro e as divisões dele. */
export type GrupoDaRegua = {
  /** Até a F4, o nome do pai ("Lagoa Bonita"). */
  chave: string;
  /** Todas as divisões, na ordem (ordem, codigo) do cadastro. */
  divisoes: readonly ParteDaRegua[];
  /** `group:<chave>`: o id que o catálogo, a sessão e o settings usam hoje. */
  id: string;
  /** Os ids do C2X das divisões, fora os excluídos, na mesma ordem de `divisoes`. */
  ids: readonly string[];
  nomeDeMercado: string;
  pai: ParteDaRegua;
  /** As siglas do cadastro, alinhadas com `ids`. */
  siglas: readonly string[];
};

/**
 * Uma entrada no molde do catálogo (`EmpreendimentoDoCatalogo`): o grupo e o empreendimento simples.
 * É a lista que a F7 vai comparar com o catálogo do C2X antes de trocar a fonte dele.
 */
export type EntradaDaRegua = {
  /** `group:<chave>` para o grupo; o id do C2X para o simples. */
  id: string;
  /** Os ids do C2X por trás da entrada (as divisões do grupo, ou ele mesmo). */
  ids: readonly string[];
  nomeDeMercado: string;
  /** O uuid do pai (grupo) ou da própria linha (simples). */
  panteonId: string;
  siglas: readonly string[];
  tipo: "grupo" | "simples";
};

export type ReguaDoCadastro = {
  /** Os grupos e os simples, sem os excluídos, na ordem (ordem, codigo) do cadastro. */
  entradas: readonly EntradaDaRegua[];
  grupos: readonly GrupoDaRegua[];
  /** Id do C2X → nome de mercado. O mesmo mapa que o sync do Apolo grava. */
  nomesDeMercado: ReadonlyMap<string, string>;
  /** Id do C2X (texto, aparado) → a resposta da régua. Inclui os excluídos, marcados. */
  porId: ReadonlyMap<string, EmpreendimentoDaRegua>;
};

export type OpcoesDaRegua = {
  /** Ids do C2X que não viram entrada nem divisão de grupo. Padrão: `EXCLUDED_ENTERPRISE_IDS`. */
  excluir?: readonly number[];
};

/**
 * O id do C2X como o cadastro guarda: texto aparado. Aceita número (`e.id` direto), texto
 * (`cast(e.id as char)`) e o Buffer que o driver entrega para texto longo: `String()` cobre os três.
 */
export function idDoCadastro(valor: unknown): string {
  return valor === null || valor === undefined ? "" : String(valor).trim();
}

function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

// A MESMA ordem de `filhosDoCadastro` e de `arvoreDeEmpreendimentos`: ordem, depois código.
function naOrdemDoCadastro(a: LinhaDoCadastro, b: LinhaDoCadastro): number {
  return a.ordem - b.ordem || a.codigo.localeCompare(b.codigo);
}

/**
 * Id do C2X → nome de mercado, PURO. Recebe o cadastro já lido e devolve, para cada linha com id, o
 * nome de mercado dela (`nomeDeMercado`: o do pai, sem a divisão). Linha sem nome confiável (nem dela,
 * nem do pai) fica de fora, e aí vale o nome do C2X.
 *
 * É a regra que `mapaDeNomesDeMercado` (lib/apolo/nome-de-mercado-por-id.ts) aplicava; ela agora
 * delega para cá, para o sync do Apolo e a régua nunca discordarem.
 */
export function nomesDeMercadoPorId(cadastro: readonly LinhaDoMercado[]): Map<string, string> {
  const mapa = new Map<string, string>();

  for (const linha of cadastro) {
    const id = idDoCadastro(linha.c2x_enterprise_id);
    if (!id) continue;

    const nome = nomeDeMercado(id, cadastro);
    if (nome) mapa.set(id, nome);
  }

  return mapa;
}

function paraMercado(linha: LinhaDoCadastro): LinhaDoMercado {
  return {
    c2x_enterprise_id: linha.c2xEnterpriseId,
    id: linha.id,
    nome: linha.nome,
    pai_id: linha.paiId,
  };
}

function parte(linha: LinhaDoCadastro): ParteDaRegua {
  return {
    c2xEnterpriseId: idDoCadastro(linha.c2xEnterpriseId) || null,
    nome: linha.nome,
    ordem: linha.ordem,
    panteonId: linha.id,
    sigla: linha.codigo,
  };
}

/**
 * A régua inteira, a partir do cadastro lido por `carregarCadastroDeEmpreendimentos`
 * (lib/hercules/cadastro.ts) ou pelo cache (lib/hercules/cadastro-em-cache.ts).
 *
 * Id do C2X repetido no cadastro: vale a PRIMEIRA linha, a mesma que `nomeDeMercado` acha.
 */
export function reguaDoCadastro(
  cadastro: readonly LinhaDoCadastro[],
  opcoes: OpcoesDaRegua = {},
): ReguaDoCadastro {
  const fora = new Set((opcoes.excluir ?? EXCLUDED_ENTERPRISE_IDS).map((id) => String(id)));
  const vivo = (linha: LinhaDoCadastro) => {
    const id = idDoCadastro(linha.c2xEnterpriseId);
    return id !== "" && !fora.has(id);
  };

  const nomesDeMercado = nomesDeMercadoPorId(cadastro.map(paraMercado));
  const porUuid = new Map<string, LinhaDoCadastro>();
  for (const linha of cadastro) if (!porUuid.has(linha.id)) porUuid.set(linha.id, linha);
  const filhosDe = filhosDoCadastro([...cadastro]);

  // O pai que vale: existe na leitura e é raiz. Um nível só.
  const paiDe = (linha: LinhaDoCadastro): LinhaDoCadastro | null => {
    if (!linha.paiId) return null;
    const pai = porUuid.get(linha.paiId);
    return pai && !pai.paiId ? pai : null;
  };

  const raizes = cadastro.filter((linha) => !linha.paiId).sort(naOrdemDoCadastro);

  const grupos: GrupoDaRegua[] = [];
  const grupoDoPai = new Map<string, GrupoDaRegua>();
  for (const raiz of raizes) {
    const filhos = filhosDe.get(raiz.id) ?? [];
    if (filhos.length === 0 || grupoDoPai.has(raiz.id)) continue;

    const vivos = filhos.filter(vivo);
    const chave = raiz.nome.trim();
    const grupo: GrupoDaRegua = {
      chave,
      divisoes: filhos.map(parte),
      id: `${PREFIXO_DO_GRUPO}${chave}`,
      ids: vivos.map((filho) => idDoCadastro(filho.c2xEnterpriseId)),
      nomeDeMercado: semDivisao(raiz.nome),
      pai: parte(raiz),
      siglas: vivos.map((filho) => filho.codigo),
    };
    grupos.push(grupo);
    grupoDoPai.set(raiz.id, grupo);
  }

  const porId = new Map<string, EmpreendimentoDaRegua>();
  for (const linha of cadastro) {
    const id = idDoCadastro(linha.c2xEnterpriseId);
    if (!id || porId.has(id)) continue;

    const pai = paiDe(linha);
    const grupoProprio = linha.paiId ? undefined : grupoDoPai.get(linha.id);
    const grupoDoFilho = pai ? grupoDoPai.get(pai.id) : undefined;
    porId.set(id, {
      ...parte(linha),
      c2xEnterpriseId: id,
      chaveDoGrupo: grupoDoFilho?.chave ?? grupoProprio?.chave ?? null,
      excluido: fora.has(id),
      filhos: grupoProprio?.divisoes ?? [],
      nomeDeMercado: nomesDeMercado.get(id) ?? "",
      pai: pai ? parte(pai) : null,
      papel: grupoDoFilho ? "divisao" : grupoProprio ? "pai" : "simples",
    });
  }

  const simples = (linha: LinhaDoCadastro): EntradaDaRegua => {
    const id = idDoCadastro(linha.c2xEnterpriseId);
    return {
      id,
      ids: [id],
      nomeDeMercado: nomesDeMercado.get(id) ?? "",
      panteonId: linha.id,
      siglas: [linha.codigo],
      tipo: "simples",
    };
  };

  const entradas: EntradaDaRegua[] = [];
  const jaEntrou = new Set<string>();
  const entrar = (entrada: EntradaDaRegua) => {
    if (jaEntrou.has(entrada.id)) return;
    jaEntrou.add(entrada.id);
    entradas.push(entrada);
  };

  for (const raiz of raizes) {
    // Regra 1: o pai com id vivo continua simples (o VLO 35), e o grupo entra ALÉM dele.
    // Regra 2: o pai excluído (o LAB 31) não entra; o grupo dele, sim.
    if (vivo(raiz)) entrar(simples(raiz));

    const grupo = grupoDoPai.get(raiz.id);
    if (grupo && grupo.ids.length > 0) {
      entrar({
        id: grupo.id,
        ids: grupo.ids,
        nomeDeMercado: grupo.nomeDeMercado,
        panteonId: raiz.id,
        siglas: grupo.siglas,
        tipo: "grupo",
      });
    }
  }

  // Filho cujo pai não veio na leitura não pertence a grupo nenhum: fica como simples.
  for (const linha of [...cadastro].sort(naOrdemDoCadastro)) {
    if (linha.paiId && !paiDe(linha) && vivo(linha)) entrar(simples(linha));
  }

  return { entradas, grupos, nomesDeMercado, porId };
}

/** A resposta da régua para um id do C2X (número, texto ou Buffer), ou `null` se o id não está no cadastro. */
export function empreendimentoPorId(
  regua: Pick<ReguaDoCadastro, "porId">,
  enterpriseId: unknown,
): EmpreendimentoDaRegua | null {
  const id = idDoCadastro(enterpriseId);
  return (id && regua.porId.get(id)) || null;
}

/**
 * O grupo de `group:<Nome>`, sem diferença de caixa nem de acento (a mesma tolerância de
 * `divisoesDoGrupo`, lib/apolo/c2x-pelo-id.ts). Qualquer outra coisa devolve `null`.
 */
export function grupoPeloId(
  regua: Pick<ReguaDoCadastro, "grupos">,
  pedido: unknown,
): GrupoDaRegua | null {
  const texto = idDoCadastro(pedido);
  if (!normalizar(texto).startsWith(PREFIXO_DO_GRUPO)) return null;

  const nome = normalizar(texto.slice(PREFIXO_DO_GRUPO.length));
  if (!nome) return null;

  return regua.grupos.find((grupo) => normalizar(grupo.chave) === nome) ?? null;
}
