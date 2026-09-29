import { timingSafeEqual } from "node:crypto";

import { createApoloAdminClient } from "@/lib/apolo/server";

import DOCUMENTO_INICIAL_CR from "./cr-inicial.json";

// A CONSULTORIA DE REESTRUTURAÇÃO (c2x.app.br/consultoria/<slug>).
//
// Documento de trabalho da consultoria do Lucas num cliente: escopo, frentes, plano de ação,
// indicadores e o relatório mensal. Não é módulo do Panteon e não lê nada do Panteon.
//
// SEM LOGIN, POR LINK (Lucas, 29/09/2026: "não precisa ter esse acesso ao panteon" e "não precisa
// de login"). São dois links secretos, cada um com o seu código guardado no banco:
//   • EDIÇÃO (`?e=`): o do consultor. A tela guarda o código no navegador e daí em diante o
//     endereço limpo abre direto em modo edição.
//   • LEITURA (`?t=`): o do cliente, só leitura.
// Quem não tem nenhum dos dois vê a porta fechada. Trocar um código no banco derruba o link dele.
//
// ⚠️ O documento é salvo INTEIRO pela tela. Duas abas abertas escrevendo ao mesmo tempo apagariam
// uma o trabalho da outra em silêncio, por isso todo salvamento diz de qual versão partiu
// (`base`) e é recusado com 409 se o banco já estiver em outra.

export const PROJETOS_DE_CONSULTORIA: Record<string, unknown> = {
  cr: DOCUMENTO_INICIAL_CR,
};

// Teto do documento. O conteúdo inicial tem ~30 KB; 12 meses de registro cabem com folga. Um corpo
// maior que isso é erro de quem chamou, não crescimento do projeto.
const TAMANHO_MAXIMO = 2_000_000;
// Uma cópia no histórico a cada janela, não a cada tecla: a tela salva sozinha poucos segundos
// depois de cada edição.
const JANELA_DO_HISTORICO_MS = 20 * 60 * 1000;

export function ehProjetoConhecido(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROJETOS_DE_CONSULTORIA, slug);
}

type Linha = {
  atualizado_em: string;
  dados: unknown;
  token_edicao: null | string;
  token_leitura: string;
};

async function lerLinha(slug: string): Promise<Linha | null> {
  const client = createApoloAdminClient();
  if (!client) throw new Error("Banco indisponível.");

  const { data, error } = await client
    .from("consultoria_projetos")
    .select("dados,token_leitura,token_edicao,atualizado_em")
    .eq("slug", slug)
    .maybeSingle<Linha>();

  if (error) throw new Error(error.message);
  if (!data) return null;
  // Projeto criado VAZIO no banco (só com os códigos dos links) nasce do conteúdo aprovado no
  // mockup. O primeiro salvamento grava esse conteúdo de verdade.
  const vazio = !data.dados || typeof data.dados !== "object" || Object.keys(data.dados).length === 0;
  return vazio ? { ...data, dados: PROJETOS_DE_CONSULTORIA[slug] } : data;
}

function confere(recebido: string, esperado: null | string): boolean {
  if (!recebido || !esperado) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type Credenciais = { edicao: string; leitura: string };

/**
 * Abre o projeto pelo código do link. Código errado e projeto inexistente respondem igual (null),
 * para o link não virar oráculo. O de edição, quando confere, também devolve os dois links.
 */
export async function abrirProjeto(slug: string, { edicao, leitura }: Credenciais) {
  if (!ehProjetoConhecido(slug) || (!edicao && !leitura)) return null;
  const linha = await lerLinha(slug);
  if (!linha) return null;

  if (confere(edicao, linha.token_edicao)) {
    return {
      atualizadoEm: linha.atualizado_em,
      dados: linha.dados,
      linkDeLeitura: `/consultoria/${slug}?t=${linha.token_leitura}`,
      podeEditar: true,
    };
  }
  if (confere(leitura, linha.token_leitura)) {
    return { atualizadoEm: linha.atualizado_em, dados: linha.dados, podeEditar: false };
  }
  return null;
}

export type ResultadoDoSalvamento =
  | { atualizadoEm: string; ok: true }
  | { motivo: "conflito" | "invalido" | "negado"; ok: false };

export async function salvarProjeto(
  slug: string,
  edicao: string,
  dados: unknown,
  base: string,
): Promise<ResultadoDoSalvamento> {
  if (!ehProjetoConhecido(slug)) return { motivo: "negado", ok: false };
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return { motivo: "invalido", ok: false };
  if (JSON.stringify(dados).length > TAMANHO_MAXIMO) return { motivo: "invalido", ok: false };

  const client = createApoloAdminClient();
  if (!client) throw new Error("Banco indisponível.");

  const atual = await lerLinha(slug);
  if (!atual || !confere(edicao, atual.token_edicao)) return { motivo: "negado", ok: false };
  if (new Date(atual.atualizado_em).getTime() !== new Date(base).getTime()) {
    return { motivo: "conflito", ok: false };
  }

  const agora = new Date().toISOString();
  // A condição de versão vai no próprio UPDATE: entre a leitura acima e esta escrita outra aba
  // pode ter salvo, e aí nenhuma linha casa.
  const { data, error } = await client
    .from("consultoria_projetos")
    .update({ atualizado_em: agora, atualizado_por: "link de edição", dados })
    .eq("slug", slug)
    .eq("atualizado_em", atual.atualizado_em)
    .select("atualizado_em");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return { motivo: "conflito", ok: false };

  await guardarNoHistorico(slug, atual);
  return { atualizadoEm: agora, ok: true };
}

async function guardarNoHistorico(slug: string, anterior: Linha) {
  const client = createApoloAdminClient();
  if (!client) return;

  const { data: ultima } = await client
    .from("consultoria_projetos_historico")
    .select("salvo_em")
    .eq("slug", slug)
    .order("salvo_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ salvo_em: string }>();

  if (ultima && Date.now() - new Date(ultima.salvo_em).getTime() < JANELA_DO_HISTORICO_MS) return;

  const { error } = await client.from("consultoria_projetos_historico").insert({
    dados: anterior.dados,
    salvo_por: "link de edição",
    slug,
    versao_de: anterior.atualizado_em,
  });
  // O documento já foi salvo; falhar o histórico não pode desfazer isso, mas não pode ser mudo.
  if (error) console.error("[consultoria] histórico não gravado", slug, error.message);
}
