// O CONTRATO DE UMA PROPOSTA — a minuta publicada mais os dados, num HTML só.
//
// ⚠️ ESTE ARQUIVO EXISTE PARA QUE A PRÉVIA E O PDF NÃO POSSAM DIVERGIR. Até 08/09/2026 a montagem
// morava dentro de `/api/temis/contrato/previa`: escolher a minuta, resolver os dados, preencher e
// serializar. Quando a geração do documento entrou (09/09/2026), copiar essas quatro linhas para a
// segunda rota criaria duas verdades sobre o MESMO contrato — e a divergência não apareceria no
// dia em que fosse escrita, e sim meses depois, quando alguém mudasse a regra da minuta em um lugar
// só e o revisor aprovasse na tela um documento diferente do que foi a cartório.
//
// A prévia é a CONFERÊNCIA do papel. Se ela conferisse outro papel, não conferiria nada.
//
// ⚠️ AQUI NÃO SE GRAVA NADA. Montar é leitura pura — é o que permite gerar prévia à vontade
// enquanto se ajusta a minuta. Quem guarda é `contrato-guardado-db.ts`, e ele chama esta função.

import type { SupabaseClient } from "@supabase/supabase-js";

import { type IdentidadeDoContrato, identidadeDoContrato } from "./contrato-guardado";
import { dadosDaProposta } from "./dados-do-contrato";
import { documentoParaHtml, type NoDoDocumento } from "./documento-html";
import { preencherContrato } from "./preencher-contrato";

export type MinutaDoContrato = {
  id: string;
  nome: string;
  versao: null | number;
};

export type ContratoMontado = {
  /** O que a proposta não tinha, em frases curtas. */
  avisos: string[];
  /** As chaves gerais do preenchimento — nem toda variável mora aqui: ver `identidade`. */
  gerais: Record<string, string>;
  html: string;
  /**
   * Empreendimento, unidade e TITULAR — o que dá nome ao arquivo guardado.
   *
   * ⚠️ MONTADA AQUI porque é aqui que os dois lados existem juntos. O nome do comprador vive em
   * `compradores[0].valores` (uma variável por comprador, dentro do laço) e o resto em `gerais`;
   * quem só tivesse `gerais` geraria um arquivo sem o nome de ninguém.
   */
  identidade: IdentidadeDoContrato;
  minuta: MinutaDoContrato;
  ok: true;
  /** Variáveis que o texto pedia e o dado não respondeu. Saem impressas como `[nome]` no corpo. */
  semValor: string[];
  vezesDoLaco: number;
};

export type FalhaAoMontar = {
  erro: string;
  ok: false;
  status: 404 | 409;
};

/**
 * Monta o contrato desta proposta.
 *
 * `minutaId` força uma minuta específica (ainda precisa estar publicada); sem ele vale a minuta
 * publicada mais recente do empreendimento.
 */
export async function montarContratoDaProposta(
  sb: SupabaseClient,
  { minutaId = "", propostaId }: { minutaId?: string; propostaId: string },
): Promise<ContratoMontado | FalhaAoMontar> {
  const resolvido = await dadosDaProposta(propostaId, sb);
  if (!resolvido) {
    return { erro: "Proposta não encontrada.", ok: false, status: 404 };
  }

  const doEmpreendimento = resolvido.dados.gerais.__empreendimento_id ?? "";
  const daUnidade = resolvido.dados.gerais.__unidade_enterprise_id ?? "";
  // ⚠️ DOIS CAMINHOS PARA O MESMO ID, e o segundo salvou o primeiro teste real. A minuta é indexada
  // por `enterprise_id` (o id do C2X), e três empreendimentos do Hércules — LOX, PDX e RDX — têm
  // esse campo NULO: para eles a busca ia com string vazia e NENHUMA minuta seria achada nunca. A
  // unidade guarda o mesmo id na sua própria coluna, e ela costuma estar preenchida quando a do
  // empreendimento não está, porque veio de outra carga.
  const minuta = await acharMinuta(sb, {
    empreendimentoId: doEmpreendimento || daUnidade,
    pedida: minutaId,
  });

  if (!minuta) {
    // ⚠️ A MENSAGEM DIZ O QUE ELE PROCUROU. "Não há minuta publicada" era verdadeiro para causas
    // MUITO diferentes — a minuta não existe, ou a proposta não sabe a que empreendimento pertence
    // — e mandar publicar de novo uma minuta que JÁ ESTÁ publicada é o caminho mais curto para
    // alguém achar que o sistema está quebrado. Foi o que aconteceu no primeiro teste, em
    // 08/09/2026: a minuta do Veredas estava publicada e a tela mandou publicar.
    const alvo = doEmpreendimento || daUnidade;
    const causa = alvo
      ? `Procurei a minuta publicada do empreendimento ${alvo} e não achei nenhuma do tipo "contrato". Publique a minuta na Têmis e tente de novo.`
      : "O empreendimento desta proposta não tem o código que liga às minutas (é o caso de LOX, PDX e RDX). Sem ele não há por onde procurar — e não adianta publicar de novo.";
    return { erro: `Não consegui montar o contrato. ${causa}`, ok: false, status: 409 };
  }

  const conteudo = Array.isArray(minuta.conteudo) ? (minuta.conteudo as NoDoDocumento[]) : [];
  if (conteudo.length === 0) {
    return { erro: "A minuta publicada está vazia.", ok: false, status: 409 };
  }

  const preenchido = preencherContrato(conteudo, resolvido.dados);

  // ⚠️ O TITULAR É O PRIMEIRO COMPRADOR, pela ordem do contrato (ver `DadosDoContrato.compradores`:
  // *"na ordem do contrato. O primeiro é o titular"*). Com dois compradores o arquivo leva o nome de
  // um só — de propósito: o nome existe para achar o papel, e "João e mais 1" já é o suficiente
  // para isso sem estourar o limite da coluna.
  const titular = resolvido.dados.compradores[0]?.valores.nome_cliente ?? "";

  return {
    avisos: resolvido.avisos,
    gerais: resolvido.dados.gerais,
    // ⚠️ UM SERIALIZADOR SÓ, e é esta linha que a prévia e o PDF compartilham. Ver o topo.
    html: documentoParaHtml(preenchido.nos),
    identidade: identidadeDoContrato(resolvido.dados.gerais, titular),
    minuta: { id: minuta.id, nome: minuta.nome, versao: minuta.versao },
    ok: true,
    semValor: preenchido.semValor,
    vezesDoLaco: preenchido.vezesDoLaco,
  };
}

type MinutaEncontrada = MinutaDoContrato & { conteudo: unknown; situacao?: string };

/**
 * A minuta que vale para esta proposta.
 *
 * ⚠️ SÓ PUBLICADA. Rascunho é trabalho em andamento: gerar contrato de rascunho é como imprimir um
 * documento que alguém ainda está escrevendo — e a `temis_minutas` tem a checagem que só exige
 * `conteudo_html` quando a situação é `publicada`, justamente porque publicar é o ato de dizer "esta
 * pode ser usada".
 *
 * ⚠️ A CATEGORIA DEVERIA MANDAR, e ainda não manda. O desenho é `unidade → categoria →
 * temis_categorias.minuta_id`, e é o que permite dois contratos diferentes no mesmo empreendimento.
 * Enquanto não houver categoria cadastrada na unidade, cai-se na minuta publicada mais recente do
 * empreendimento — que é o comportamento certo para quem tem uma minuta só, e é o caso de todos
 * hoje. Quando a categoria entrar, este é o único lugar a mudar.
 */
async function acharMinuta(
  sb: SupabaseClient,
  { empreendimentoId, pedida }: { empreendimentoId: string; pedida: string },
): Promise<MinutaEncontrada | null> {
  if (pedida) {
    const { data } = await sb
      .from("temis_minutas")
      .select("id, nome, versao, conteudo, situacao")
      .eq("id", pedida)
      .maybeSingle();
    // ⚠️ A MINUTA PEDIDA TAMBÉM PRECISA ESTAR PUBLICADA. Aceitar um id de rascunho pela porta dos
    // fundos derrubaria a regra inteira.
    const linha = data as MinutaEncontrada | null;
    if (linha && linha.situacao === "publicada") return linha;
    return null;
  }

  if (!empreendimentoId) return null;

  const { data } = await sb
    .from("temis_minutas")
    .select("id, nome, versao, conteudo")
    .eq("enterprise_id", empreendimentoId)
    .eq("situacao", "publicada")
    .eq("tipo", "contrato")
    .order("atualizado_em", { ascending: false })
    .limit(1);

  return (data?.[0] as MinutaEncontrada | undefined) ?? null;
}
