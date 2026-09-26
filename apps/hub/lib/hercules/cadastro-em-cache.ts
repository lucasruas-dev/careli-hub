// O CADASTRO DE EMPREENDIMENTOS EM CACHE DE PROCESSO, RENOVADO PELO CARIMBO (PAN-124, fatia F1).
//
// A régua (./regua-do-cadastro) é pura; quem a usa precisa do cadastro lido. Ler
// `hercules_empreendimentos` a cada chamada multiplicaria consultas: o catálogo sozinho tem cerca de 30
// consumidores, e já houve incidente de fatura por leitura repetida ([[project_hermes_cost]]). Um prazo
// fixo (os 10 min do catálogo do C2X) deixa a tela com o nome velho depois de salvar: "salvei e não
// mudou".
//
// A REGRA:
//   • no máximo a cada 30 s por instância, confere o CARIMBO: `count(*)` e `max(atualizado_em)` de
//     `hercules_empreendimentos` do workspace, numa requisição só (1 linha e o `count` exato);
//   • relê o cadastro inteiro só quando o carimbo muda (linha nova ou apagada muda o count; edição
//     muda o `atualizado_em`);
//   • COM CADASTRO GUARDADO, NINGUÉM ESPERA O BANCO. Passados os 30 s, a leitura devolve o guardado na
//     hora e a conferência corre em segundo plano, uma por vez por instância. O que ela trouxer vale a
//     partir da leitura seguinte. Só a partida a frio (nada guardado) espera a ida ao banco;
//   • CADA IDA AO BANCO TEM PRAZO (5 s): o carimbo e o cadastro inteiro. Estourou, aborta a requisição
//     e conta como falha. Sem prazo, um Supabase pendurado segurava a leitura até o teto do fetch do
//     Node (300 s) ou o maxDuration da função (revisão de 26/09/2026, medido com carimbo que não
//     responde);
//   • MANTÉM O ANTERIOR SE A LEITURA FALHAR (erro ou prazo), seja do carimbo, seja do cadastro. Banco
//     oscilando não apaga nome de tela nenhuma. A próxima conferência fica para depois dos 30 s, e não
//     para a próxima chamada, para uma queda não virar rajada de consultas;
//   • sem cadastro na partida a frio (primeira leitura falhou), devolve `null`: quem chama avisa e lista
//     pelo id do C2X, nunca por uma lista velha (plano do PAN-124, "Listas fixas").
//
// ⚠️ SEGUNDO PLANO NA VERCEL. A função é congelada quando a resposta sai, e a promessa solta para no
// meio. O cache do app entrega a conferência ao `after()` do Next, que segura a função até ela acabar
// (no máximo os dois prazos). Fora de uma requisição (script, teste), o `after()` lança, e a
// conferência só corre solta: termina sozinha, e nada depende dela para responder.
//
// ⚠️ ATÉ A MIGRATION 0192 (F2), O `atualizado_em` SÓ MUDA QUANDO QUEM EDITA O GRAVA. Hoje não há
// gatilho que o mantenha (medido em 26/09/2026: o único gatilho da tabela é o de pai e raiz, da 0123).
// Um UPDATE por SQL que não toque em `atualizado_em` não muda o carimbo, e o cache não o vê. A 0192
// cria o gatilho. Na F1 nenhum leitor usa este cache (a troca de fonte é da F6 em diante), então a
// lacuna não aparece em tela; ela fecha antes do primeiro leitor.
import { after } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";

import { carregarCadastroDeEmpreendimentos, type LinhaDoCadastro } from "./cadastro";
import { reguaDoCadastro, type ReguaDoCadastro } from "./regua-do-cadastro";

/** De quanto em quanto tempo, no máximo, o carimbo é conferido, por instância. */
export const INTERVALO_DO_CARIMBO_MS = 30 * 1000;

/** Quanto cada ida ao banco (o carimbo; o cadastro inteiro) pode levar antes de contar como falha. */
export const PRAZO_DA_LEITURA_MS = 5 * 1000;

// Mesmo workspace fixo das outras leituras do cadastro (./cadastro).
const WORKSPACE = "careli";

/** O que diz se o cadastro mudou: quantas linhas e a última edição. */
export type CarimboDoCadastro = {
  linhas: number;
  /** `max(atualizado_em)`, como o banco devolveu. `null` com o cadastro vazio. */
  ultimaEdicao: null | string;
};

export type CadastroGuardado = {
  carimbo: CarimboDoCadastro;
  /** Quando começou a última conferência que terminou (com ou sem sucesso). */
  conferidoEmMs: number;
  linhas: readonly LinhaDoCadastro[];
  /** Quando o cadastro foi lido por inteiro pela última vez. */
  lidoEmMs: number;
  regua: ReguaDoCadastro;
};

/**
 * As duas idas ao banco. Injetáveis para o teste. Cada uma recebe o sinal que o prazo aborta, e quem
 * lê do banco o passa adiante (`.abortSignal`), para a requisição não ficar pendurada depois do prazo.
 */
export type FontesDoCadastro = {
  lerCadastro: (sinal: AbortSignal) => Promise<LinhaDoCadastro[]>;
  lerCarimbo: (sinal: AbortSignal) => Promise<CarimboDoCadastro>;
};

export type OpcoesDoCache = {
  /** Padrão: `INTERVALO_DO_CARIMBO_MS`. */
  intervaloMs?: number;
  /** Padrão: `PRAZO_DA_LEITURA_MS`. */
  prazoMs?: number;
  /**
   * Recebe a conferência que corre em segundo plano, para a função não ser congelada antes de ela
   * acabar. A promessa nunca rejeita. Padrão: nada (ela corre solta).
   */
  segurarAteTerminar?: (conferencia: Promise<unknown>) => void;
};

export type CacheDoCadastro = {
  /** A conferência em andamento, ou `null`. SÓ PARA TESTE E SCRIPT DE MEDIÇÃO: esperar por ela. */
  emAndamento: () => Promise<CadastroGuardado | null> | null;
  /** Esquece o guardado. SÓ PARA TESTE E SCRIPT DE MEDIÇÃO: em produção, apagar tira a proteção contra a queda. */
  esquecer: () => void;
  /**
   * O cadastro e a régua. Com algo guardado, devolve na hora e, passado o intervalo, confere em
   * segundo plano. `null` só na partida a frio sem banco.
   */
  ler: (agoraMs?: number) => Promise<CadastroGuardado | null>;
};

function mesmoCarimbo(a: CarimboDoCadastro, b: CarimboDoCadastro): boolean {
  return a.linhas === b.linhas && a.ultimaEdicao === b.ultimaEdicao;
}

/**
 * `ler`, com prazo. Estourou: aborta o sinal que `ler` recebeu e lança. Nunca espera mais que `prazoMs`,
 * mesmo que `ler` ignore o sinal.
 */
export async function comPrazo<T>(
  ler: (sinal: AbortSignal) => Promise<T>,
  prazoMs: number,
  oQue: string,
): Promise<T> {
  const controle = new AbortController();
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<never>((_, rejeitar) => {
    relogio = setTimeout(() => {
      const erro = new Error(`${oQue} passou do prazo de ${prazoMs} ms.`);
      controle.abort(erro);
      rejeitar(erro);
    }, prazoMs);
  });

  try {
    return await Promise.race([ler(controle.signal), estouro]);
  } finally {
    clearTimeout(relogio);
  }
}

/** O cache, com as fontes que quem chama der. O do app é `cacheDoCadastro`, logo abaixo. */
export function criarCacheDoCadastro(
  fontes: FontesDoCadastro,
  opcoes: OpcoesDoCache = {},
): CacheDoCadastro {
  const intervaloMs = opcoes.intervaloMs ?? INTERVALO_DO_CARIMBO_MS;
  const prazoMs = opcoes.prazoMs ?? PRAZO_DA_LEITURA_MS;
  const segurarAteTerminar = opcoes.segurarAteTerminar ?? (() => undefined);

  let guardado: CadastroGuardado | null = null;
  // Partida a frio que falhou: quando foi, para não tentar de novo antes do intervalo.
  let falhouSemNadaEmMs: null | number = null;
  let emVoo: null | Promise<CadastroGuardado | null> = null;
  // Sobe a cada `esquecer`: a conferência que começou antes dele não grava por cima.
  let geracao = 0;

  // Nunca rejeita: toda falha (e o prazo) cai em `manterAnterior`.
  async function conferir(agoraMs: number): Promise<CadastroGuardado | null> {
    const minha = geracao;
    const valendo = () => minha === geracao;

    // Falhou: fica o anterior, com a conferência marcada para o intervalo seguinte.
    const manterAnterior = (onde: string, erro: unknown) => {
      console.error(`[hercules][cadastro-em-cache] ${onde} falhou; fica o cadastro anterior`, erro);
      if (!valendo()) return guardado;
      if (guardado) guardado = { ...guardado, conferidoEmMs: agoraMs };
      else falhouSemNadaEmMs = agoraMs;
      return guardado;
    };

    let carimbo: CarimboDoCadastro;
    try {
      carimbo = await comPrazo(fontes.lerCarimbo, prazoMs, "A leitura do carimbo do cadastro");
    } catch (erro) {
      return manterAnterior("a leitura do carimbo", erro);
    }

    if (guardado && mesmoCarimbo(guardado.carimbo, carimbo)) {
      if (valendo()) guardado = { ...guardado, conferidoEmMs: agoraMs };
      return guardado;
    }

    let linhas: LinhaDoCadastro[];
    let regua: ReguaDoCadastro;
    try {
      linhas = await comPrazo(fontes.lerCadastro, prazoMs, "A leitura do cadastro");
      regua = reguaDoCadastro(linhas);
    } catch (erro) {
      // O carimbo novo NÃO é guardado: na próxima conferência ele continua diferente, e relê.
      return manterAnterior("a leitura do cadastro", erro);
    }

    const novo: CadastroGuardado = { carimbo, conferidoEmMs: agoraMs, linhas, lidoEmMs: agoraMs, regua };
    if (!valendo()) return novo;
    guardado = novo;
    falhouSemNadaEmMs = null;
    return guardado;
  }

  // Uma conferência por vez por instância: quem chega durante ela recebe a MESMA.
  function conferirUmaVez(agoraMs: number): Promise<CadastroGuardado | null> {
    if (emVoo) return emVoo;
    const conferencia: Promise<CadastroGuardado | null> = conferir(agoraMs).finally(() => {
      if (emVoo === conferencia) emVoo = null;
    });
    emVoo = conferencia;
    return conferencia;
  }

  return {
    emAndamento: () => emVoo,
    esquecer() {
      geracao += 1;
      guardado = null;
      falhouSemNadaEmMs = null;
      emVoo = null;
    },
    async ler(agoraMs = Date.now()) {
      if (guardado) {
        if (agoraMs - guardado.conferidoEmMs >= intervaloMs && !emVoo) {
          segurarAteTerminar(conferirUmaVez(agoraMs));
        }
        return guardado;
      }

      // Partida a frio: espera a ida ao banco (com prazo), no máximo uma vez por intervalo.
      if (falhouSemNadaEmMs !== null && agoraMs - falhouSemNadaEmMs < intervaloMs) return null;
      return conferirUmaVez(agoraMs);
    },
  };
}

/**
 * O carimbo, numa requisição: a linha de `atualizado_em` mais recente e o `count` exato do workspace.
 * Lança em falha (o cache trata), como `carregarCadastroDeEmpreendimentos`. `sinal` aborta a requisição.
 */
export async function lerCarimboDoCadastro(sinal?: AbortSignal): Promise<CarimboDoCadastro> {
  const admin = createApoloAdminClient();
  if (!admin) {
    throw new Error("Carimbo do cadastro indisponível: Supabase sem configuração.");
  }

  const consulta = admin
    .from("hercules_empreendimentos")
    .select("atualizado_em", { count: "exact" })
    .eq("workspace_id", WORKSPACE)
    .order("atualizado_em", { ascending: false })
    .limit(1)
    .returns<Array<{ atualizado_em: null | string }>>();
  const { count, data, error } = await (sinal ? consulta.abortSignal(sinal) : consulta);

  if (error) {
    throw new Error(`Não foi possível ler o carimbo do cadastro: ${error.message}`);
  }
  if (typeof count !== "number") {
    throw new Error("Não foi possível ler o carimbo do cadastro: o banco não devolveu a contagem.");
  }

  return { linhas: count, ultimaEdicao: data?.[0]?.atualizado_em ?? null };
}

// Segura a função da Vercel até a conferência em segundo plano acabar. Fora de uma requisição (script,
// teste), o `after()` lança: aí a conferência corre solta, o que basta, porque ninguém espera por ela.
function segurarComAfter(conferencia: Promise<unknown>): void {
  try {
    after(conferencia);
  } catch {
    // Sem contexto de requisição.
  }
}

/** O cache do app: o cadastro de `carregarCadastroDeEmpreendimentos`, conferido pelo carimbo. */
export const cacheDoCadastro: CacheDoCadastro = criarCacheDoCadastro(
  {
    lerCadastro: (sinal) => carregarCadastroDeEmpreendimentos({ sinal }),
    lerCarimbo: (sinal) => lerCarimboDoCadastro(sinal),
  },
  { segurarAteTerminar: segurarComAfter },
);

/** Atalho: só a régua. `null` na partida a frio sem banco. */
export async function reguaEmCache(agoraMs: number = Date.now()): Promise<ReguaDoCadastro | null> {
  return (await cacheDoCadastro.ler(agoraMs))?.regua ?? null;
}
