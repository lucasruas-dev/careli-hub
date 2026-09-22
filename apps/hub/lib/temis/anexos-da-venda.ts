// OS ANEXOS QUE SOMAM — as peças que entram no contrato desta venda, de todos os níveis.
//
// Lucas (21/09/2026): *"os anexos SOMAM os níveis. O contrato leva os anexos do pai MAIS os da
// divisão MAIS os da categoria, na ordem definida."*
//
// ⚠️ ISTO INVERTE O QUE ESTAVA ESCRITO EM QUATRO LUGARES, e a inversão é deliberada. A 0156 (linhas
// 29 a 37), `anexos.ts` (`rotuloDoAlcance`), `estrutura-servico.ts` (`lerAnexos`) e a tela de
// cadastro diziam "unidade vence categoria, que vence empreendimento" — um nível só valia. A regra
// de hoje é a soma. A PRECEDÊNCIA continua existindo, mas só para a MINUTA (ver `minuta-da-cadeia`):
// dois contratos não somam, dois anexos sim.
//
// ⚠️ A POSIÇÃO É GLOBAL NA CADEIA, e não por nível. É a consequência direta da soma. Os índices da
// 0156 são por nível, então pai e categoria podem, os dois, gravar a posição 1 — e somando, o
// `[anexo_1]` da minuta ficaria apontando para dois arquivos. Renumerar na montagem (pai 1..n,
// depois divisão) seria pior: cadastrar um anexo no pai empurraria a numeração de toda minuta já
// publicada dos filhos, calado, que é exatamente o que a decisão do Lucas de 07/09/2026 proíbe
// (*"à medida que eu vou importando os anexos vai fazendo essa conta"* — a posição é ESCOLHIDA).
// Então: posição repetida na cadeia é CONFLITO, e ele recusa a montagem nomeando as duas peças.
// Hoje isso é de graça — `temis_anexos` tem ZERO linhas em produção (medido em 21/09/2026).
//
// ⚠️ O MESMO ARQUIVO NÃO SAI DUAS VEZES, e a chave da deduplicação é o `storage_path`. Deduplicar
// por NOME não resolveria nada: o caminho leva um `crypto.randomUUID()`
// (`estrutura-servico.ts:425`), então o mesmo PDF subido duas vezes gera duas linhas legítimas e
// distintas. O que o `storage_path` pega é o caso real — a MESMA linha alcançada por dois caminhos
// da cadeia, que é o que acontece quando a divisão e o empreendimento da proposta são o mesmo id.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type CadeiaDoContrato,
  type DegrauDoContrato,
  NOME_DO_DEGRAU,
  ORDEM_DOS_DEGRAUS,
} from "./cadeia-do-contrato";

/** Uma peça do contrato, já sabendo de que degrau veio. */
export type AnexoDaVenda = {
  arquivoBytes: null | number;
  degrau: DegrauDoContrato;
  id: string;
  nome: string;
  posicao: number;
  /** O nome humano do degrau: "Lagoa Bonita", "Condomínio". É o que a prévia mostra. */
  rotuloDoNivel: string;
  storagePath: string;
};

/** A linha crua de `temis_anexos`, como ela sai do banco. */
export type LinhaDeAnexo = {
  arquivo_bytes?: null | number;
  categoria_id: null | string;
  enterprise_id: null | string;
  id: string;
  nome: null | string;
  posicao: null | number;
  storage_path: null | string;
  unidade_id: null | string;
};

export type AnexosDaVenda =
  | { anexos: AnexoDaVenda[]; ok: true }
  | { erro: string; ok: false };

const COLUNAS =
  "arquivo_bytes, categoria_id, enterprise_id, id, nome, posicao, storage_path, unidade_id";

/**
 * As peças da cadeia, somadas, ordenadas e sem repetição. Pura: o banco fica em `lerAnexosDaVenda`.
 *
 * ⚠️ A ORDEM FINAL É A POSIÇÃO, e o degrau só entra como desempate impossível — se duas peças
 * chegarem à mesma posição a função RECUSA antes de ordenar. Ordenar por nível primeiro faria a
 * mesma minuta imprimir o anexo 1 depois do anexo 2 conforme quem cadastrou onde.
 */
export function somarAnexosDaCadeia(
  linhas: readonly LinhaDeAnexo[],
  cadeia: CadeiaDoContrato,
): AnexosDaVenda {
  const porId = new Map<string, { degrau: DegrauDoContrato; rotulo: string }>();
  for (const nivel of cadeia.niveis) {
    const dele = { degrau: nivel.degrau, rotulo: nivel.rotulo };
    if (!porId.has(nivel.id)) porId.set(nivel.id, dele);
    // ⚠️ O CONSOLIDADO É O MESMO DEGRAU COM OUTRO NOME. A peça subida pela ficha agrupada do Apolo
    // está gravada em `group:Lagoa Bonita`, e sem esta linha ela entrava na consulta e caía fora
    // aqui — o operador via o anexo listado na tela e o PDF saía sem ele. Ver `NivelDaCadeia.alias`.
    if (nivel.alias && !porId.has(nivel.alias)) porId.set(nivel.alias, dele);
  }

  const porCaminho = new Map<string, AnexoDaVenda>();

  for (const linha of linhas) {
    const caminho = texto(linha.storage_path);
    const posicao = typeof linha.posicao === "number" ? linha.posicao : Number(linha.posicao);
    if (!caminho || !Number.isInteger(posicao) || posicao < 1) continue;

    const alvo =
      texto(linha.unidade_id) || texto(linha.categoria_id) || texto(linha.enterprise_id);
    const nivel = porId.get(alvo);
    // ⚠️ O QUE NÃO É DA CADEIA NÃO ENTRA. A consulta já filtra por estes ids; isto é a segunda
    // tranca, para o dia em que alguém alargar o filtro e trouxer o anexo de outro produto.
    if (!nivel) continue;

    const candidato: AnexoDaVenda = {
      arquivoBytes: typeof linha.arquivo_bytes === "number" ? linha.arquivo_bytes : null,
      degrau: nivel.degrau,
      id: linha.id,
      nome: texto(linha.nome) || `Anexo ${posicao}`,
      posicao,
      rotuloDoNivel: nivel.rotulo,
      storagePath: caminho,
    };

    const jaTem = porCaminho.get(caminho);
    // O mesmo arquivo alcançado por dois degraus fica pelo MAIS ESPECÍFICO: é dele que a tela
    // precisa falar quando o operador for tirar a peça do contrato.
    if (!jaTem || ORDEM_DOS_DEGRAUS[candidato.degrau] < ORDEM_DOS_DEGRAUS[jaTem.degrau]) {
      porCaminho.set(caminho, candidato);
    }
  }

  const anexos = [...porCaminho.values()].sort(
    (a, b) =>
      a.posicao - b.posicao ||
      ORDEM_DOS_DEGRAUS[a.degrau] - ORDEM_DOS_DEGRAUS[b.degrau] ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );

  for (let i = 1; i < anexos.length; i += 1) {
    const anterior = anexos[i - 1];
    const atual = anexos[i];
    if (!anterior || !atual || anterior.posicao !== atual.posicao) continue;
    return {
      erro:
        `A posição ${atual.posicao} do contrato está ocupada por duas peças ao mesmo tempo: ` +
        `"${anterior.nome}" (${NOME_DO_DEGRAU[anterior.degrau]} ${anterior.rotuloDoNivel}) e ` +
        `"${atual.nome}" (${NOME_DO_DEGRAU[atual.degrau]} ${atual.rotuloDoNivel}). ` +
        "Os anexos dos níveis somam, então cada posição só pode ser de um arquivo: mude a posição de uma das duas.",
      ok: false,
    };
  }

  return { anexos, ok: true };
}

/**
 * Lê as peças desta venda no banco e soma os níveis. UMA consulta.
 *
 * ⚠️ FALHA DE LEITURA RECUSA, NÃO ENCOLHE. Um contrato emitido sem a convenção de condomínio que
 * ele próprio anuncia em cláusula é pior do que um contrato que não saiu: o primeiro vai a cartório
 * e ninguém percebe, o segundo tem quem aperte o botão de novo.
 */
export async function lerAnexosDaVenda(
  sb: SupabaseClient,
  cadeia: CadeiaDoContrato,
): Promise<AnexosDaVenda> {
  const alvos = filtroDaCadeia(cadeia);
  if (!alvos) return { anexos: [], ok: true };

  const { data, error } = await sb.from("temis_anexos").select(COLUNAS).eq("ativo", true).or(alvos);

  if (error) {
    console.error("[temis][anexos] falha ao ler os anexos da venda", error);
    return {
      erro: "Não consegui ler os anexos deste contrato. Como eles entram no PDF junto com o corpo, não gero o documento sem ter certeza de quais são. Tente de novo em instantes.",
      ok: false,
    };
  }

  return somarAnexosDaCadeia((data ?? []) as LinhaDeAnexo[], cadeia);
}

/**
 * O `.or()` do PostgREST com os ids da cadeia.
 *
 * ⚠️ OS IDS SÃO CONFERIDOS ANTES DE VIRAR FILTRO. Eles não vêm da requisição — saem do cadastro,
 * lidos pela cadeia — mas `.or()` é string concatenada, e um id com VÍRGULA (o separador dos
 * termos), PONTO (o separador de coluna/operador/valor) ou PARÊNTESE dentro quebraria a expressão
 * inteira e mudaria o recorte em silêncio. Uuid e id do C2X são alfanuméricos com hífen; o espaço
 * entra porque o rótulo do consolidado o tem ("group:Lagoa Bonita"). O que não couber, não entra.
 * É a mesma disciplina de `lerAnexos`.
 *
 * ⚠️ O CONSOLIDADO NÃO É DEGRAU DA CADEIA, e hoje isso não deixa buraco nenhum: a GRAVAÇÃO já
 * resolve o `group:` para o id do empreendimento antes de escrever, e RECUSA com 400 quando não
 * resolve (ver o ramo do consolidado em `estrutura-servico.ts`). Ou seja, anexo com `group:` em
 * `enterprise_id` não existe mais — a linha nunca chega a ser criada, em vez de ser criada e nunca
 * aparecer no papel, que era o defeito de antes.
 *
 * `resolverCadeiaDoContrato` monta os níveis a partir de `hercules_empreendimentos`, onde
 * `group:Lagoa Bonita` não existe: ele é rótulo do catálogo do C2X, e só `empreendimentosQueServem`
 * (o caminho da minuta PEDIDA) o conhece. Trazê-lo custaria uma leitura do catálogo do C2X em TODA
 * montagem. A validação abaixo segue aceitando o formato, para o dia em que a decisão mudar.
 *
 * ⚠️ O QUE SOBRA DE VERDADE são as três famílias cuja RAIZ não tem `c2x_enterprise_id` (LOX, PDX e
 * RDX, medido em 22/09/2026): nelas a ficha consolidada recusa o cadastro, e a peça tem de ser
 * pendurada na etapa (LOS, LOU, PDV, PVS, RDP, RPC, RPS) ou na categoria. Funciona, mas não herda
 * de um pai comum — cada etapa precisa da sua cópia.
 */
export function filtroDaCadeia(cadeia: CadeiaDoContrato): string {
  const partes: string[] = [];
  const vistos = new Set<string>();

  for (const nivel of cadeia.niveis) {
    const coluna =
      nivel.degrau === "unidade"
        ? "unidade_id"
        : nivel.degrau === "categoria"
          ? "categoria_id"
          : "enterprise_id";

    // ⚠️ O ALIAS ENTRA COMO UM SEGUNDO TERMO, E NÃO NO LUGAR DO ID. O mesmo degrau pode ter peças
    // gravadas dos dois jeitos — pela ficha da divisão (id numérico) e pela ficha consolidada
    // (`group:<nome>`) —, e as duas vão para o mesmo contrato.
    for (const valor of [nivel.id, nivel.alias]) {
      if (!valor || !/^[A-Za-z0-9 :_-]+$/.test(valor)) continue;
      const parte = `${coluna}.eq.${valor}`;
      if (vistos.has(parte)) continue;
      vistos.add(parte);
      partes.push(parte);
    }
  }

  return partes.join(",");
}

/**
 * O que o motor da minuta espera: posição → nome do arquivo.
 *
 * É o `dados.anexos` de `DadosDoContrato`, o que liga `[inicio_tem_anexo_2]` e o que responde
 * `[anexo_2_nome]`. Até 21/09/2026 este campo NUNCA era preenchido em produção: o bloco do anexo 1
 * da minuta publicada do VOL v6 sumia do papel em silêncio, sem entrar em `semValor` e sem aviso.
 */
export function anexosParaOMotor(anexos: readonly AnexoDaVenda[]): Record<number, string> {
  const mapa: Record<number, string> = {};
  for (const a of anexos) mapa[a.posicao] = a.nome;
  return mapa;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : valor == null ? "" : String(valor).trim();
}
