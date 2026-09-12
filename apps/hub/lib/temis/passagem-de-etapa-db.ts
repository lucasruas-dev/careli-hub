import type { SupabaseClient } from "@supabase/supabase-js";

import { ehTabelaAusente } from "@/lib/temis/tabela-ausente";
import type { EstagioDoTrabalho, TipoDeTrabalho } from "@/lib/temis/trabalhos";

// A GRAVAÇÃO DA PASSAGEM DE ETAPA — o único lugar que escreve em `temis_trabalho_etapas`.
//
// Lucas (11/09/2026): *"o historico nao esta trazendo essas aprovacoes de analise - contrato -
// contrato para assinatura, tem que trazer"*. Não estava trazendo porque o banco nunca guardou: os
// seis pontos que movem um card faziam `update ... set estagio` e o estágio anterior era
// sobrescrito no mesmo instante. Ver a migration 0153.
//
// ⚠️ ESTA FUNÇÃO NUNCA LANÇA, E NUNCA DEVOLVE ERRO. Ela roda DEPOIS do fato que ela descreve: o
// PDF do contrato já está no bucket, o envelope já existe (e já custou) na Clicksign, o
// indeferimento já viajou. Deixar uma falha de histórico derrubar a ação principal trocaria um
// registro que se remenda na leitura seguinte por uma ação desfeita — e, nos dois casos em que o
// fato está do lado de fora da casa, "desfeita" nem é possível.
//
// ⚠️ E ELA NÃO GRAVA QUANDO `de === para`: etapa que não anda não é passagem. `moverCardDaTemis`
// não compara o destino com o estágio atual, então gerar o contrato duas vezes a chama duas vezes
// com destino `contrato` — sem esta guarda, a segunda vez escreveria "contrato → contrato" no
// histórico, dizendo que o card andou quando ele ficou parado. O CHECK da 0153 diz o mesmo; a
// repetição é deliberada, e é ela que impede o erro de constraint de chegar até quem emite.

/**
 * O que fez o card andar.
 *
 * ⚠️ OS SETE VALORES SÃO OS DO CHECK DA 0153, e o check é a garantia. Valor novo aqui sem valor
 * novo lá vira linha recusada pelo banco — e, como esta função é calada por construção, a recusa
 * sairia só no `console.error`.
 */
export type OrigemDaPassagem =
  | "abertura"
  | "atividade"
  | "contrato_gerado"
  | "envio_assinatura"
  | "indeferimento"
  | "retorno_para_correcao"
  | "webhook_assinatura";

export type PassagemDeEtapa = {
  /**
   * O estágio de onde o card saiu.
   *
   * ⚠️ `null` É O NASCIMENTO DO CARD, e não "não consegui descobrir". Quem não sabe o estágio
   * anterior não deve chamar esta função: uma linha com `de` nulo no meio da vida do card mentiria
   * dizendo que ele acabou de ser aberto.
   */
  de: null | string;
  /** No indeferimento, o código do catálogo (`lib/temis/indeferimento.ts`). */
  motivo?: null | string;
  observacao?: null | string;
  origem: OrigemDaPassagem;
  para: EstagioDoTrabalho | string;
  propostaId: null | string;
  /**
   * Quem clicou.
   *
   * ⚠️ NULO QUER DIZER "O SISTEMA MOVEU SOZINHO", e só isso — é a promessa da 0153. Quem tem a
   * identidade em mãos passa: mandar o contrato para a Clicksign é o ato mais caro e mais
   * irreversível do módulo, e deixá-lo anônimo é perder a primeira pergunta de qualquer auditoria
   * de contrato. Hoje o único nulo legítimo é o webhook.
   */
  quem?: null | string;
  quemNome?: null | string;
  trabalhoId: string;
  trabalhoTipo: string | TipoDeTrabalho;
};

/** A tabela que esta função escreve — e o nome que a régua de `ehTabelaAusente` procura. */
const TABELA = "temis_trabalho_etapas";

/**
 * A tabela pode não existir ainda — e neste caso isso é o NORMAL, não a exceção.
 *
 * ⚠️ O CÓDIGO VAI PARA PRODUÇÃO ANTES DA MIGRATION SER APLICADA. A 0153 espera OK explícito do
 * Lucas (regra da casa), e até lá todo clique que move um card cairia aqui. Um `console.error` por
 * clique encheria o log da Vercel de vermelho por uma pendência conhecida — e log vermelho que é
 * normal é log que ninguém lê mais. Por isso: um `console.info`, uma vez por processo.
 *
 * ⚠️ E ESTE DESENHO NUNCA CHEGOU A ACONTECER, porque o guard daqui procurava a coisa errada. Ele
 * testava `42P01` (o código do POSTGRES, que só aparece quando a query executa) e `does not exist`;
 * contra tabela fora do schema cache a Supabase responde `PGRST205` com `Could not find the table
 * ... in the schema cache`, que não casa com nenhum dos dois. Resultado: um `console.error` por
 * Gerar contrato, por Enviar para assinatura, por Indeferir, por Voltar para análise, por abertura
 * de card e por webhook. A régua certa mora em `lib/temis/tabela-ausente.ts` — a mesma que o
 * Chronos já usava.
 */
let jaAvisouDaTabelaAusente = false;

/**
 * Registra que o card mudou de etapa.
 *
 * Chame-a DEPOIS de o `update` do estágio ter dado certo: o que se guarda aqui é o fato, e fato que
 * não aconteceu não entra em auditoria de contrato.
 */
export async function registrarPassagemDeEtapa(
  sb: SupabaseClient,
  passagem: PassagemDeEtapa,
): Promise<void> {
  const de = passagem.de === null ? null : String(passagem.de).trim() || null;
  const para = String(passagem.para).trim();

  // Sem destino não há passagem. E etapa que não anda também não é passagem — ver a nota do topo.
  if (!para || de === para) return;

  try {
    const { error } = await sb.from(TABELA).insert({
      de,
      motivo: passagem.motivo ?? null,
      observacao: passagem.observacao ?? null,
      origem: passagem.origem,
      para,
      proposta_id: passagem.propostaId,
      quem: passagem.quem ?? null,
      quem_nome: passagem.quemNome ?? null,
      trabalho_id: passagem.trabalhoId,
      trabalho_tipo: passagem.trabalhoTipo,
      workspace_id: "careli",
    });

    if (!error) return;

    if (ehTabelaAusente(error, TABELA)) {
      if (!jaAvisouDaTabelaAusente) {
        jaAvisouDaTabelaAusente = true;
        console.info(
          `[temis][etapa] a tabela ${TABELA} ainda não existe (migration 0153 pendente): o histórico de passagens não está sendo gravado.`,
        );
      }
      return;
    }

    console.error("[temis][etapa] falha ao registrar a passagem de etapa", error.message);
  } catch (e) {
    // ⚠️ O `catch` É A REDE, E NÃO DECORAÇÃO. O builder do Supabase é um `PromiseLike`: falha de
    // rede ou de serialização vira exceção, não `{ error }`. Sem isto, uma queda do Supabase no
    // meio do envio para a Clicksign viraria um `unhandled rejection` derrubando a rota DEPOIS de
    // o envelope já ter sido criado e cobrado.
    console.error("[temis][etapa] falha ao registrar a passagem de etapa", e);
  }
}
