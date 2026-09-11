// A EDIÇÃO MANUAL DO CONTRATO NO BANCO — ler, gravar, descartar.
//
// A tabela é `temis_contrato_edicoes` (migration 0152): uma linha por proposta, com o texto
// VIGENTE ainda não emitido. O histórico não mora aqui — mora em `hercules_documentos`, onde cada
// geração vira uma versão que não se apaga.
//
// ⚠️ O HTML QUE ENTRA AQUI JÁ PASSOU PELA FAXINA. Quem chama sanitiza (`sanitizarHtmlDoContrato`);
// este arquivo não recebe texto cru do navegador — se receber, o `<script>` colado junto com um
// parágrafo chega ao Chromium que gera o PDF.

import type { SupabaseClient } from "@supabase/supabase-js";

const WORKSPACE = "careli";
const TABELA = "temis_contrato_edicoes";

export type EdicaoDoContrato = {
  atualizadoEm: string;
  baseImpressao: null | string;
  editadoPorNome: null | string;
  html: string;
  minutaId: null | string;
};

type Linha = {
  atualizado_em: string;
  base_impressao: null | string;
  editado_por_nome: null | string;
  html: string;
  minuta_id: null | string;
};

/**
 * A edição vigente desta proposta, ou `null` quando ninguém alterou nada.
 *
 * ⚠️ FALHA DE LEITURA VIRA `null`, e isso é uma escolha com consequência: a tela mostra o contrato
 * DA MINUTA quando não consegue ler a edição. É o lado certo para errar — o texto da minuta é
 * sempre um contrato válido, enquanto derrubar a prévia inteira deixaria o operador sem nada. O
 * motivo vai para o log; e a gravação, essa sim, nunca é silenciosa.
 */
export async function lerEdicao(
  sb: SupabaseClient,
  propostaId: string,
): Promise<EdicaoDoContrato | null> {
  try {
    const { data, error } = await sb
      .from(TABELA)
      .select("html, base_impressao, minuta_id, editado_por_nome, atualizado_em")
      .eq("proposta_id", propostaId)
      .maybeSingle();

    if (error) {
      console.error("[temis][edicao] falha ao ler a edição do contrato", error.message);
      return null;
    }
    if (!data) return null;

    const linha = data as Linha;
    return {
      atualizadoEm: linha.atualizado_em,
      baseImpressao: linha.base_impressao,
      editadoPorNome: linha.editado_por_nome,
      html: linha.html,
      minutaId: linha.minuta_id,
    };
  } catch (e) {
    console.error("[temis][edicao] erro ao ler a edição", e instanceof Error ? e.message : e);
    return null;
  }
}

export type ResultadoDaGravacao = { ok: true } | { erro: string; ok: false; status: number };

/**
 * Grava (ou substitui) a edição vigente.
 *
 * ⚠️ É `upsert` PELA PROPOSTA, e não um insert que empilha. Salvar de novo é o gesto normal de quem
 * está escrevendo — a pessoa salva quatro vezes numa tarde. Empilhar criaria quatro rascunhos e a
 * pergunta "qual vale?" no único documento em que ela não pode existir.
 */
export async function salvarEdicao(
  sb: SupabaseClient,
  args: {
    baseImpressao: string;
    editadoPor: null | string;
    editadoPorNome: null | string;
    html: string;
    minutaId: null | string;
    propostaId: string;
  },
): Promise<ResultadoDaGravacao> {
  const { error } = await sb.from(TABELA).upsert(
    {
      atualizado_em: new Date().toISOString(),
      base_impressao: args.baseImpressao,
      editado_por: args.editadoPor,
      editado_por_nome: args.editadoPorNome,
      html: args.html,
      minuta_id: args.minutaId,
      proposta_id: args.propostaId,
      workspace_id: WORKSPACE,
    },
    { onConflict: "proposta_id" },
  );

  if (error) {
    // ⚠️ A MENSAGEM REAL VAI PARA O LOG E UMA GENÉRICA PARA A TELA — mas a tela PRECISA saber que
    // não salvou. Um "salvo" falso é pior do que um erro: a pessoa fecha a aba confiando.
    console.error("[temis][edicao] falha ao gravar", error.message);
    return {
      erro: "Não consegui salvar a alteração. O texto continua na tela; tente de novo.",
      ok: false,
      status: 500,
    };
  }

  return { ok: true };
}

/** Joga fora a alteração manual: o contrato volta a ser o texto da minuta. */
export async function descartarEdicao(
  sb: SupabaseClient,
  propostaId: string,
): Promise<ResultadoDaGravacao> {
  const { error } = await sb.from(TABELA).delete().eq("proposta_id", propostaId);

  if (error) {
    console.error("[temis][edicao] falha ao descartar", error.message);
    return { erro: "Não consegui descartar a alteração.", ok: false, status: 500 };
  }

  return { ok: true };
}
