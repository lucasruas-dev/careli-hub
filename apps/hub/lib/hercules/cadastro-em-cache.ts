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
//   • MANTÉM O ANTERIOR SE A LEITURA FALHAR, seja do carimbo, seja do cadastro. Banco oscilando não
//     apaga nome de tela nenhuma. A próxima conferência fica para depois dos 30 s, e não para a
//     próxima chamada, para uma queda não virar rajada de consultas;
//   • quem chega durante uma conferência espera a MESMA (uma por vez por instância);
//   • sem cadastro na partida a frio (primeira leitura falhou), devolve `null`: quem chama avisa e lista
//     pelo id do C2X, nunca por uma lista velha (plano do PAN-124, "Listas fixas").
//
// ⚠️ ATÉ A MIGRATION 0192 (F2), O `atualizado_em` SÓ MUDA QUANDO QUEM EDITA O GRAVA. Hoje não há
// gatilho que o mantenha (medido em 26/09/2026: o único gatilho da tabela é o de pai e raiz, da 0123).
// Um UPDATE por SQL que não toque em `atualizado_em` não muda o carimbo, e o cache não o vê. A 0192
// cria o gatilho. Na F1 nenhum leitor usa este cache (a troca de fonte é da F6 em diante), então a
// lacuna não aparece em tela; ela fecha antes do primeiro leitor.
import { createApoloAdminClient } from "@/lib/apolo/server";

import { carregarCadastroDeEmpreendimentos, type LinhaDoCadastro } from "./cadastro";
import { reguaDoCadastro, type ReguaDoCadastro } from "./regua-do-cadastro";

/** De quanto em quanto tempo, no máximo, o carimbo é conferido, por instância. */
export const INTERVALO_DO_CARIMBO_MS = 30 * 1000;

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
  /** Quando o carimbo foi conferido pela última vez (com ou sem sucesso). */
  conferidoEmMs: number;
  linhas: readonly LinhaDoCadastro[];
  /** Quando o cadastro foi lido por inteiro pela última vez. */
  lidoEmMs: number;
  regua: ReguaDoCadastro;
};

/** As duas idas ao banco. Injetáveis para o teste. */
export type FontesDoCadastro = {
  lerCadastro: () => Promise<LinhaDoCadastro[]>;
  lerCarimbo: () => Promise<CarimboDoCadastro>;
};

export type CacheDoCadastro = {
  /** Esquece o guardado. SÓ PARA TESTE E SCRIPT DE MEDIÇÃO: em produção, apagar tira a proteção contra a queda. */
  esquecer: () => void;
  /** O cadastro e a régua, conferindo o carimbo se já passou o intervalo. `null` só na partida a frio sem banco. */
  ler: (agoraMs?: number) => Promise<CadastroGuardado | null>;
};

function mesmoCarimbo(a: CarimboDoCadastro, b: CarimboDoCadastro): boolean {
  return a.linhas === b.linhas && a.ultimaEdicao === b.ultimaEdicao;
}

/** O cache, com as fontes que quem chama der. O do app é `cacheDoCadastro`, logo abaixo. */
export function criarCacheDoCadastro(
  fontes: FontesDoCadastro,
  intervaloMs: number = INTERVALO_DO_CARIMBO_MS,
): CacheDoCadastro {
  let guardado: CadastroGuardado | null = null;
  // Partida a frio que falhou: quando foi, para não tentar de novo antes do intervalo.
  let falhouSemNadaEmMs: null | number = null;
  let emVoo: null | Promise<CadastroGuardado | null> = null;

  // Falhou: fica o anterior, com a conferência marcada para o intervalo seguinte.
  const manterAnterior = (agoraMs: number, onde: string, erro: unknown) => {
    console.error(`[hercules][cadastro-em-cache] ${onde} falhou; fica o cadastro anterior`, erro);
    if (guardado) guardado = { ...guardado, conferidoEmMs: agoraMs };
    else falhouSemNadaEmMs = agoraMs;
    return guardado;
  };

  async function conferir(agoraMs: number): Promise<CadastroGuardado | null> {
    let carimbo: CarimboDoCadastro;
    try {
      carimbo = await fontes.lerCarimbo();
    } catch (erro) {
      return manterAnterior(agoraMs, "a leitura do carimbo", erro);
    }

    if (guardado && mesmoCarimbo(guardado.carimbo, carimbo)) {
      guardado = { ...guardado, conferidoEmMs: agoraMs };
      return guardado;
    }

    let linhas: LinhaDoCadastro[];
    try {
      linhas = await fontes.lerCadastro();
    } catch (erro) {
      // O carimbo novo NÃO é guardado: na próxima conferência ele continua diferente, e relê.
      return manterAnterior(agoraMs, "a leitura do cadastro", erro);
    }

    guardado = {
      carimbo,
      conferidoEmMs: agoraMs,
      linhas,
      lidoEmMs: agoraMs,
      regua: reguaDoCadastro(linhas),
    };
    falhouSemNadaEmMs = null;
    return guardado;
  }

  return {
    esquecer() {
      guardado = null;
      falhouSemNadaEmMs = null;
      emVoo = null;
    },
    async ler(agoraMs = Date.now()) {
      if (guardado && agoraMs - guardado.conferidoEmMs < intervaloMs) return guardado;
      if (!guardado && falhouSemNadaEmMs !== null && agoraMs - falhouSemNadaEmMs < intervaloMs) {
        return null;
      }

      if (emVoo) return emVoo;
      const conferencia = conferir(agoraMs);
      emVoo = conferencia;
      try {
        return await conferencia;
      } finally {
        if (emVoo === conferencia) emVoo = null;
      }
    },
  };
}

/**
 * O carimbo, numa requisição: a linha de `atualizado_em` mais recente e o `count` exato do workspace.
 * Lança em falha (o cache trata), como `carregarCadastroDeEmpreendimentos`.
 */
export async function lerCarimboDoCadastro(): Promise<CarimboDoCadastro> {
  const admin = createApoloAdminClient();
  if (!admin) {
    throw new Error("Carimbo do cadastro indisponível: Supabase sem configuração.");
  }

  const { count, data, error } = await admin
    .from("hercules_empreendimentos")
    .select("atualizado_em", { count: "exact" })
    .eq("workspace_id", WORKSPACE)
    .order("atualizado_em", { ascending: false })
    .limit(1)
    .returns<Array<{ atualizado_em: null | string }>>();

  if (error) {
    throw new Error(`Não foi possível ler o carimbo do cadastro: ${error.message}`);
  }
  if (typeof count !== "number") {
    throw new Error("Não foi possível ler o carimbo do cadastro: o banco não devolveu a contagem.");
  }

  return { linhas: count, ultimaEdicao: data?.[0]?.atualizado_em ?? null };
}

/** O cache do app: o cadastro de `carregarCadastroDeEmpreendimentos`, conferido pelo carimbo. */
export const cacheDoCadastro: CacheDoCadastro = criarCacheDoCadastro({
  lerCadastro: carregarCadastroDeEmpreendimentos,
  lerCarimbo: lerCarimboDoCadastro,
});

/** Atalho: só a régua. `null` na partida a frio sem banco. */
export async function reguaEmCache(agoraMs: number = Date.now()): Promise<ReguaDoCadastro | null> {
  return (await cacheDoCadastro.ler(agoraMs))?.regua ?? null;
}
