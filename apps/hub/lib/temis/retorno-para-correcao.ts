import type { SupabaseClient } from "@supabase/supabase-js";

import type { PortaDaClicksign } from "@/lib/assinatura/clicksign/cliente";
import { cancelarEnvelope, consultarEnvelope } from "@/lib/assinatura/clicksign/envelope";
import { type EnvelopeDaProposta, envelopeQueSegura } from "@/lib/assinatura/envio-db";
import type { EstadoDaAssinatura } from "@/lib/assinatura/tipos";
import { nomeDaEtapaGravada } from "@/lib/temis/historico-de-etapas";
import { registrarPassagemDeEtapa } from "@/lib/temis/passagem-de-etapa-db";

// VOLTAR O CARD PARA A ANÁLISE — e, quando o contrato já está na rua, MATAR O ENVELOPE ANTES.
//
// Lucas (11-12/09/2026), fechando a regra em três mensagens: *"aproveita e coloca uma forma de
// voltar para analise quando precisarmos alterar alguma coisa no contrato mesmo estando na sessao de
// assinatura, pois e nesse momento que todos vao receber o contrato para assinatura, ae com certeza
// pode ter algo para ser alterado"*; *"pode cancelar o envelope"*; *"se o contrato estiver assinado
// por todos somente cancelamento do contrato"*. E, sobre o Pré-faturamento: *"prefaturamento pode
// desde que nao esteja todo assinado"*, *"ae entra naquelas regras, se ele estiver todo assinado tem
// que fazer distrato"*.
//
// A REGRA, EM UMA LINHA: o card volta para a Análise ENQUANTO O CONTRATO NÃO ESTIVER ASSINADO POR
// TODOS. Assinado por todos, o caminho é o DISTRATO.
//
// ⚠️ O PORTÃO É O ENVELOPE, E NÃO A ETAPA — e esta é a correção que desfaz o desenho anterior. Não
// existe lista de estágios que "podem voltar por natureza": o que decide é um FATO, o contrato está
// assinado por todos? A etapa NÃO prova esse fato. O Pré-faturamento é alcançado normalmente com o
// envelope fechado, mas `marcarAtividade` avança card por marcação humana sem consultar envelope
// nenhum — foi assim que o card do Henrique chegou ao fim sem contrato e sem envelope (medido em
// 09/09/2026). Decidir pelo estágio faria a regra do Lucas valer só na aparência da tela.
//
// ⚠️ POR ISSO A CONFERÊNCIA DO ENVELOPE VALE NOS TRÊS ESTÁGIOS, e não só na assinatura. O card pode
// dizer "Contrato" com um envelope vivo de um envio anterior, e pode dizer "Pré-faturamento" sem
// envelope nenhum. Quem responde é a linha de `temis_envelopes`, sempre.
//
// ⚠️ A ORDEM É CONFERIR → LER NA CLICKSIGN → CANCELAR → MOVER, E ELA É O DESENHO INTEIRO. Mover
// primeiro deixaria, numa falha do cancelamento, um card em Análise com envelope VIVO na Clicksign —
// as pessoas com o convite na caixa de entrada, assinando a versão velha enquanto alguém edita a
// nova. E assinatura de contrato vale juridicamente: não é um registro que se remenda na leitura
// seguinte. Por isso o caminho FALHA FECHADO — se o cancelamento não der certo, o card NÃO volta.
//
// ⚠️ E O "JÁ ESTÁ ASSINADO?" É PERGUNTADO À CLICKSIGN, NÃO AO NOSSO BANCO. `temis_envelopes.estado`
// só é escrito pelo webhook, ou seja, é exatamente a fonte que ATRASA — e o caso que este desenho
// existe para cobrir é o do atraso: três de quatro assinaram, o quarto assina às 14:00:00, e às
// 14:00:01 alguém clica em voltar com a tela carregada às 13:58. O banco ainda diz `parcial`, e
// cancelar ali mataria um contrato ASSINADO POR TODOS. Pior: `cancelado` é terminal, então o
// `auto_close` que chegasse em seguida seria DESCARTADO e o Panteon ficaria sem registro nenhum de
// que aquele contrato foi assinado. Por isso `consultarEnvelope` roda IMEDIATAMENTE ANTES do
// cancelamento, e uma leitura que FALHA recusa a volta — nunca se cancela no escuro.
//
// ⚠️ SÓ O CARD DE TIPO `contrato` CONSULTA E CANCELA ENVELOPE — ver `conferirEMatarOEnvelope`.
//
// ⚠️ O REENVIO DEPOIS DA VOLTA JÁ ESTÁ RESOLVIDO, e não precisa de nada novo aqui: o envelope
// cancelado fica em `cancelado`, que é um dos três estados que `envelopeQueSegura` libera
// (`lib/assinatura/envio-db.ts`). Corrigir e mandar de novo segue o caminho normal.

/**
 * Os três estágios de onde um card volta.
 *
 * ⚠️ ESTA LISTA NÃO É A REGRA, É SÓ ONDE O BOTÃO APARECE. A regra é o envelope, conferido logo
 * depois em `conferirEnvelopeParaVoltar` — um card em qualquer um destes três é RECUSADO se o
 * contrato já estiver assinado por todos.
 *
 * ⚠️ `prazo_legal` (o Pré-faturamento) ENTROU EM 12/09/2026, e o lote anterior o excluía "por
 * natureza", supondo que só se chega lá com tudo assinado. Lucas: *"prefaturamento pode desde que
 * nao esteja todo assinado"*. Ficam de fora só `faturado` (o fim) e `indeferido` (a saída lateral).
 */
const ESTAGIOS_QUE_VOLTAM = ["assinatura", "contrato", "prazo_legal"] as const;

type EstagioQueVolta = (typeof ESTAGIOS_QUE_VOLTAM)[number];

/**
 * O que a tela avisa quando NÃO há envelope vivo para cancelar: a volta é só a volta.
 *
 * ⚠️ ELA NÃO PROMETE CANCELAMENTO NENHUM de propósito. Prometer o cancelamento de um envelope que
 * não existe ensinaria o operador a ler a frase como enfeite — e no dia em que o envelope existir de
 * verdade, ele clicaria sem ler.
 */
export const AVISO_DA_VOLTA_SIMPLES =
  "O card volta para Análise e o prazo daquela etapa recomeça. O contrato já gerado continua na lista: a próxima geração vira a versão seguinte e aposenta esta.";

/**
 * O que a tela avisa quando há envelope VIVO: a volta mata o envelope, e isso não se desfaz.
 *
 * ⚠️ AS TRÊS PROMESSAS DESTA FRASE SÓ ESTE ARQUIVO CUMPRE (o envelope é cancelado, quem já assinou
 * assina de novo, o cancelado fica na lista para sempre). Escrita solta dentro do componente, ela
 * continuaria dizendo isso no dia em que a regra mudasse.
 */
export const AVISO_DA_VOLTA_COM_ENVELOPE =
  "Isto CANCELA o envelope na Clicksign. Quem já recebeu o convite perde o acesso, e quem já assinou terá de assinar de novo na versão nova. O envelope cancelado continua na lista da conta, para sempre. O card volta para Análise.";

/**
 * O AVISO DE CADA ESTÁGIO — as frases fechadas com o Lucas em 11-12/09/2026.
 *
 * ⚠️ ESTE MAPA DEIXOU DE ESCOLHER A FRASE DA TELA, E O COMENTÁRIO QUE DIZIA O CONTRÁRIO CAIU JUNTO.
 * Até 12/09/2026 a confirmação decidia pelo ESTÁGIO, supondo que em "Contrato" nunca há envelope —
 * e um card fica em "Contrato" com envelope ATIVO sempre que o envio falha no passo `notificar`
 * (a linha fica com `envelope_id` e o card não é movido). Agora quem decide é o envelope vivo que o
 * GET de `/api/temis/trabalho` devolve, pela MESMA régua do servidor (`envelopeQueSegura`), e o erro
 * pelo lado caro que este mapa cometia — cessão, distrato e cancelamento lendo "isto CANCELA" sem
 * ter envelope nenhum — sumiu com ele.
 *
 * ⚠️ O QUE ELE É HOJE: a REFERÊNCIA das duas frases, e o lugar onde o teste byte a byte confere que
 * a cópia da tela não divergiu (`retorno-para-correcao.test.ts`). Não o apague por "não ter mais
 * consumidor": o consumidor é o teste, e é ele que impede a tela de resumir a frase que avisa, antes
 * do clique, que um envelope da conta de PRODUÇÃO vai ser cancelado.
 */
export const AVISO_DA_VOLTA: Record<EstagioQueVolta, string> = {
  assinatura: AVISO_DA_VOLTA_COM_ENVELOPE,
  contrato: AVISO_DA_VOLTA_SIMPLES,
  prazo_legal: AVISO_DA_VOLTA_COM_ENVELOPE,
};

/**
 * A RECUSA QUE MANDA FAZER O DISTRATO — a trava da terceira mensagem do Lucas.
 *
 * ⚠️ ELA NÃO OFERECE SAÍDA ALTERNATIVA de propósito. "Cancele o envelope mesmo assim" seria desfazer
 * o que não se desfaz: as assinaturas já existem, e o contrato assinado é o documento da venda.
 *
 * ⚠️ ELA DIZ QUE EXISTE UMA CLASSIFICAÇÃO, E NÃO QUAL SAI — e esta redação trocou em 12/09/2026,
 * depois de a revisão apontar que a frase anterior ("o sistema classifica como distrato")
 * PROMETIA um resultado que este arquivo não calcula. Quem decide é `classificarCancelamento`
 * (`lib/temis/cancelamento.ts`), pelas duas perguntas — assinou? pagou? —, sobre fatos que outra
 * leitura apura (`apurarFatosDoContrato`, alimentada pela rota do pedido). Prometer o desfecho
 * daqui é escrever uma segunda régua, que diverge da primeira no dia em que a apuração mudar de
 * ideia — e quem leu "vai ser distrato" e recebeu "cancelamento" perde a confiança nas duas.
 *
 * ⚠️ E ELA DIZ ONDE FICA O BOTÃO. A frase anterior mandava "abrir o pedido de cancelamento" sem
 * dizer em que tela — e quem está olhando o card da Têmis não tem esse botão ali: ele é do
 * Hércules, na tela da venda.
 */
export const RECUSA_DO_CONTRATO_ASSINADO =
  "Este contrato já está assinado por todos, e assinatura não se desfaz: o card não volta para a Análise. Para mudar alguma coisa agora, abra o pedido de cancelamento no Hércules, na tela desta venda. O sistema classifica sozinho o pedido entre cancelamento e distrato.";

// ── A PARTE PURA: QUEM VOLTA, E O QUE BARRA A VOLTA ─────────────────────────

export type ConferenciaDoEstagio = { erro: string; ok: false } | { ok: true };

/**
 * A frase de cada estágio que não volta — cada uma dizendo PARA ONDE IR.
 *
 * ⚠️ BOTÃO QUE SOME DEIXA QUEM PROCURA PROCURANDO. Nestes dois o caminho existe, só não é este, e a
 * frase é o único lugar onde isso está escrito para quem opera.
 *
 * ⚠️ FATURADO É O FIM — Lucas (12/09/2026): *"somente no ultimo estagio que nao tem como voltar para
 * corrigir"*. INDEFERIDO é saída lateral: o card não está no caminho do contrato, e quem corrige é
 * quem vendeu, de onde o trabalho veio.
 */
const RECUSA_POR_ESTAGIO: Record<string, (rotulo: string) => string> = {
  faturado: (rotulo) =>
    `Este trabalho já está em "${rotulo}", e daqui não há volta para corrigir: é o único estágio sem retorno. ` +
    `Para mudar alguma coisa agora, abra o pedido de cancelamento do contrato.`,
  indeferido: (rotulo) =>
    `Este trabalho está em "${rotulo}": ele saiu do caminho do contrato, e não há etapa para onde devolvê-lo. ` +
    `A correção volta pelo Hércules, com quem vendeu.`,
};

/**
 * Este card está num estágio de onde o botão devolve para a análise?
 *
 * ⚠️ ISTO NÃO DECIDE SE A VOLTA PODE — só se ela começa. Quem decide é o envelope, logo abaixo.
 */
export function conferirEstagioParaVoltar(
  estagio: string,
  tipoDoTrabalho: string,
): ConferenciaDoEstagio {
  const limpo = estagio.trim();

  // ⚠️ JÁ ESTAR NA ANÁLISE NÃO É "CAMINHO ERRADO", é não ter para onde ir — e mandar essa pessoa
  // abrir cancelamento seria um conselho absurdo para quem já pode simplesmente corrigir e gerar.
  if (limpo === "analise") {
    return { erro: "Este trabalho já está na Análise: não há para onde devolver.", ok: false };
  }

  if (!ESTAGIOS_QUE_VOLTAM.some((e) => e === limpo)) {
    const rotulo = nomeDaEtapaGravada(limpo, tipoDoTrabalho);
    const frase = RECUSA_POR_ESTAGIO[limpo];
    return {
      erro: frase
        ? frase(rotulo)
        : `Só dá para devolver para a análise um trabalho que está em Contrato, Em assinatura ou Pré-faturamento. ` +
          `Este está em "${rotulo}".`,
      ok: false,
    };
  }

  return { ok: true };
}

export type ConferenciaDoEnvelope =
  | { erro: string; ok: false }
  /** O id do envelope a cancelar, ou `null` quando não há nada vivo para cancelar. */
  | { envelopeParaCancelar: null | string; ok: true; registroId: null | string };

/**
 * O envelope desta proposta deixa o card voltar? E, se deixar, há o que cancelar?
 *
 * Recebe as linhas de `temis_envelopes` da proposta em `criado_em desc` — as mesmas que a guarda do
 * envio lê.
 *
 * ⚠️ A PERGUNTA É FEITA POR `envelopeQueSegura`, E DE PROPÓSITO: é a mesma régua que decide se um
 * contrato pode ser mandado de novo, e ela já está testada. Uma segunda régua escrita aqui
 * divergiria da primeira no dia em que um estado mudasse de lado — e as duas respondem exatamente a
 * mesma coisa: existe envelope VIVO deste contrato?
 *
 * ⚠️ E ELA VALE NOS TRÊS ESTÁGIOS, inclusive com o card ainda em "Em assinatura": o card pode dizer
 * "Pré-faturamento" por marcação humana, e pode dizer "Contrato" com um envelope vivo de um envio
 * anterior. Quem responde é a linha, sempre.
 *
 * ⚠️ MAS ELA NÃO COBRE O WEBHOOK ATRASADO, E ESTA RESSALVA JÁ ESTEVE ESCRITA AO CONTRÁRIO AQUI. O
 * `estado` que ela lê é gravado SÓ pelo webhook: se a última assinatura entrou entre a tela carregar
 * e alguém clicar, esta linha ainda diz `parcial`. Quem cobre esse caso é a leitura do estado REAL
 * na Clicksign, logo antes do cancelamento (`conferirEstadoRealParaVoltar`). Esta régua é a primeira
 * peneira — barata, sem rede, e capaz de recusar cedo o que já se sabe.
 *
 * ⚠️ NENHUM ENVELOPE VIVO NÃO É ERRO, e este é o caso mais comum depois de um reenvio frustrado:
 * cancelado por alguém na Clicksign, recusado por quem ia assinar, ou vencido no prazo. O que estava
 * na rua já morreu; não há o que cancelar, e o card volta direto. Vale também para a proposta sem
 * envelope NENHUM — o card que subiu por marcação humana, sem contrato ter saído daqui.
 */
export function conferirEnvelopeParaVoltar(linhas: EnvelopeDaProposta[]): ConferenciaDoEnvelope {
  const vivo = envelopeQueSegura(linhas);
  if (!vivo) return { envelopeParaCancelar: null, ok: true, registroId: null };

  if (vivo.estado === "assinado") return { erro: RECUSA_DO_CONTRATO_ASSINADO, ok: false };

  // ⚠️ O `provedor` VEM NA CONSULTA E ERA JOGADO FORA — e isso é um id indo para a API errada.
  // `cancelarEnvelope` fala CLICKSIGN: mandar para lá o id de um envelope do D4Sign não dá erro
  // óbvio, dá 404 (ou, pior, acerta outro envelope), e o card ou trava sem motivo ou volta achando
  // que matou algo que continua vivo no outro provedor. São DOIS provedores vivos de propósito
  // (Lucas, 07/09/2026: *"a minha ideia e ter as duas, nao vou desfazer da d4sign"*), e a coluna
  // existe na 0149 justamente para ninguém supor um só.
  //
  // ⚠️ E A SAÍDA NÃO PROMETE O WEBHOOK, ao contrário das outras frases deste arquivo: o webhook que
  // escreve em `temis_envelopes` é só o da Clicksign (`lib/assinatura/estado-db.ts` filtra por
  // `provedor = 'clicksign'`). Cancelar no D4Sign não volta para cá sozinho, e dizer que volta
  // deixaria alguém esperando uma liberação que nunca chega.
  if (vivo.provedor !== "clicksign") {
    return {
      erro:
        `O envelope vivo deste contrato não é da Clicksign: está no ${nomeDoProvedor(vivo.provedor)} (registro ${vivo.id}${vivo.envelope_id ? `, envelope ${vivo.envelope_id}` : ""}), e daqui só se cancela envelope da Clicksign. ` +
        `Confira e cancele no ${nomeDoProvedor(vivo.provedor)}; depois disso o registro ${vivo.id} precisa ficar encerrado em temis_envelopes para a volta liberar.`,
      ok: false,
    };
  }

  // ⚠️ LINHA VIVA SEM `envelope_id` É A AMBÍGUA: um envio começou e o Panteon nunca soube como
  // terminou (a função morreu no meio, o timeout da Vercel). Não dá para cancelar o que não se sabe
  // identificar, e soltar o card aqui é justamente o estado que este desenho existe para impedir —
  // Análise com envelope possivelmente vivo lá fora. Recusa, e diz como destravar.
  if (!vivo.envelope_id) {
    return {
      erro:
        `Existe um envio deste contrato que o Panteon não sabe como terminou (registro ${vivo.id}), e por isso não dá para cancelar o envelope daqui. ` +
        `Confira na Clicksign se o envelope desta venda existe: se existir, cancele por lá — o webhook grava o cancelamento aqui e libera a volta.`,
      ok: false,
    };
  }

  return { envelopeParaCancelar: vivo.envelope_id, ok: true, registroId: vivo.id };
}

/**
 * O nome do provedor, para a frase.
 *
 * ⚠️ CÓPIA DELIBERADA de `lib/assinatura/envio-db.ts`, que tem o mesmo mapa e NÃO o exporta. São
 * dois rótulos de dois valores fechados por `check` na 0149 (`clicksign`, `d4sign`); exportar de lá
 * só para isto arrastaria o módulo do envio inteiro para cá. Valor que o código não conhece sai como
 * ele mesmo, em vez de virar "undefined" no meio de uma frase que manda alguém procurar.
 */
function nomeDoProvedor(provedor: string): string {
  const nomes: Record<string, string> = { clicksign: "Clicksign", d4sign: "D4Sign" };
  return nomes[provedor] ?? provedor;
}

/**
 * O QUE O ESTADO REAL DECIDE — a régua da leitura que vem da Clicksign, não do nosso banco.
 *
 * ⚠️ ESCRITO COMO `Record` DE PROPÓSITO: estado novo em `EstadoDaAssinatura` sem linha aqui não
 * compila. O que não pode acontecer é um estado desconhecido cair calado no ramo de cancelar.
 */
const O_QUE_O_ESTADO_REAL_DECIDE: Record<
  EstadoDaAssinatura,
  "cancelar" | "conferir" | "distrato" | "ja_morreu"
> = {
  aguardando: "cancelar",
  assinado: "distrato",
  cancelado: "ja_morreu",
  desconhecido: "conferir",
  expirado: "ja_morreu",
  parcial: "cancelar",
  // ⚠️ `rascunho` (o `draft` deles) É ENVELOPE QUE NUNCA FOI ATIVADO, e o PATCH para `canceled` pode
  // muito bem ser recusado nele — a operação certa lá seria o DELETE. Deixamos no ramo de cancelar
  // mesmo assim: se a Clicksign recusar, a volta é barrada e a frase manda conferir, que é o
  // desfecho seguro. Inventar aqui um DELETE que esta casa nunca chamou fora do rascunho do envio é
  // que seria adivinhação, e apagar envelope é irreversível.
  rascunho: "cancelar",
  recusado: "ja_morreu",
};

/** O desfecho da leitura real: cancelar, voltar sem cancelar, ou não voltar. */
export type LeituraDoEstadoReal = { cancelar: boolean; ok: true } | { erro: string; ok: false };

/**
 * O estado que a CLICKSIGN acabou de dizer deixa o card voltar? E ainda há o que cancelar?
 *
 * ⚠️ ESTA É A TRAVA QUE O BANCO NÃO CONSEGUE DAR. Ver a nota do topo: `temis_envelopes.estado` só é
 * escrito pelo webhook, e a janela entre a última assinatura e o evento chegar é o momento exato em
 * que alguém clica em voltar.
 *
 * ⚠️ `closed` CAI EM "CONFERIR", E NÃO EM "ASSINADO" — e isso não é timidez. `estadoDaClicksign`
 * traduz `closed` como `desconhecido` quando não se sabe se TODOS assinaram, porque o
 * `deadline_partial_signature_action` pode fechar o envelope no vencimento com as assinaturas que
 * tiver: um contrato com o comprador assinado e a vendedora não vira `closed` com cara de
 * concluído. Esta leitura pega o status do ENVELOPE, não a lista de signatários, então ela não tem
 * como separar os dois — e afirmar "assinado por todos" sem saber mandaria alguém abrir um distrato
 * de um contrato que ninguém terminou de assinar. Fechado, de um jeito ou de outro, a volta para.
 */
export function conferirEstadoRealParaVoltar(
  leitura: { envelopeId: string; estado: EstadoDaAssinatura; status: string },
): LeituraDoEstadoReal {
  switch (O_QUE_O_ESTADO_REAL_DECIDE[leitura.estado]) {
    case "cancelar":
      return { cancelar: true, ok: true };
    case "distrato":
      return { erro: RECUSA_DO_CONTRATO_ASSINADO, ok: false };
    // ⚠️ JÁ MORREU LÁ FORA, E NÃO SE CANCELA DUAS VEZES. Cancelado, recusado ou vencido: não há
    // ninguém com convite vivo, e o card volta direto — são os mesmos três estados que já liberam o
    // REENVIO em `envelopeQueSegura`.
    case "ja_morreu":
      return { cancelar: false, ok: true };
    default:
      return {
        erro:
          `A Clicksign respondeu "${leitura.status}" para o envelope ${leitura.envelopeId}, e daqui não dá para afirmar se o contrato está assinado por todos — um envelope fechado pode ser tanto "todos assinaram" quanto "venceu o prazo e fechou com as assinaturas que tinha". Por isso o card NÃO voltou para a análise e nada foi cancelado. ` +
          // ⚠️ A MESMA REDAÇÃO DA RECUSA IRMÃ: diz que há classificação automática, sem prometer
          // qual sai. Ver o JSDoc de `RECUSA_DO_CONTRATO_ASSINADO`.
          `Confira o envelope ${leitura.envelopeId} na Clicksign: se estiver assinado por todos, o caminho é o pedido de cancelamento no Hércules, na tela desta venda (o sistema classifica sozinho o pedido entre cancelamento e distrato); se não estiver, cancele por lá — o webhook grava o cancelamento aqui e libera a volta.`,
        ok: false,
      };
  }
}

// ── O CAMINHO INTEIRO, COM O BANCO E A CLICKSIGN ────────────────────────────

export type RetornoFeito = {
  /** De onde o card saiu, para a tela poder contar o que aconteceu. */
  de: string;
  /** O envelope que foi cancelado nesta volta — `null` quando não havia nada vivo. */
  envelopeCancelado: null | string;
  ok: true;
};

/** O desfecho do passo do envelope, antes de o card se mexer. */
type EnvelopeResolvido = { envelopeCancelado: null | string; ok: true };

export type FalhaNoRetorno = {
  erro: string;
  ok: false;
  status: 404 | 409 | 502 | 503;
};

type CardParaVoltar = {
  estagio: string;
  id: string;
  proposta_id: null | string;
  tipo: string;
};

/**
 * Devolve o card para a Análise, cancelando o envelope quando for o caso.
 *
 * `porta` é a chamada HTTP da Clicksign (o duplo do teste entra por aqui).
 */
export async function retornarParaAnalise(
  sb: SupabaseClient,
  pedido: {
    observacao?: null | string;
    trabalhoId: string;
    usuarioId: null | string;
    usuarioNome: null | string;
  },
  porta?: PortaDaClicksign,
): Promise<FalhaNoRetorno | RetornoFeito> {
  const { data: card, error: erroDaLeitura } = await sb
    .from("temis_trabalhos")
    .select("estagio, id, proposta_id, tipo")
    .eq("id", pedido.trabalhoId)
    .maybeSingle<CardParaVoltar>();

  if (erroDaLeitura) {
    console.error("[temis][retorno] falha ao ler o card", erroDaLeitura);
    return { erro: "Nao foi possivel abrir o trabalho.", ok: false, status: 503 };
  }
  if (!card) return { erro: "Trabalho nao encontrado.", ok: false, status: 404 };

  const estagio = conferirEstagioParaVoltar(card.estagio, card.tipo);
  if (!estagio.ok) return { erro: estagio.erro, ok: false, status: 409 };

  // ⚠️ SEMPRE, E NÃO SÓ NA ASSINATURA: é o envelope que responde se o contrato está assinado, e o
  // estágio não prova isso em nenhum dos três.
  const envelope = await conferirEMatarOEnvelope(sb, card, porta);
  if (!envelope.ok) return envelope;

  const agora = new Date().toISOString();
  const { data: mexidos, error } = await sb
    .from("temis_trabalhos")
    .update({
      // ⚠️ O RELÓGIO DOS 7 DIAS PARA DE CORRER AQUI, E O CAMPO TEM DE MORRER JUNTO. Voltar do
      // Pré-faturamento deixava `arrependimento_inicio` com a data da assinatura ANTIGA — a do
      // contrato que esta mesma volta acabou de cancelar. O prazo de arrependimento é DAQUELE
      // contrato: desfeito ele, o relógio não é o mesmo que continua correndo, e a tela
      // (`EtapaDoPrazoLegal`) mostraria dias já vencidos de um contrato que ninguém tem mais —
      // liberando o faturamento de um contrato que talvez nem tenha sido assinado de novo.
      // Quem carimba a data nova é `concluirAssinaturaDoCard` (`lib/assinatura/estado-db.ts`),
      // quando o PRÓXIMO envelope fechar: a contagem recomeça da última assinatura do comprador
      // na versão corrigida, que é o que a lei conta.
      //
      // ⚠️ E LIMPA SEMPRE, NÃO SÓ VINDO DO PRÉ-FATURAMENTO: um card que já passou por lá e voltou
      // carrega a data pelos estágios seguintes, e `null` num card que nunca teve prazo é
      // exatamente o que ele já tinha.
      arrependimento_inicio: null,
      atualizado_em: agora,
      estagio: "analise",
      // ⚠️ `estagio_desde` ANDA AQUI, E É A ÚNICA VEZ EM QUE ELE ANDA PARA TRÁS NO MÓDULO. A regra
      // da casa é que ele não volta quando só o RÓTULO da etapa muda (migration 0150). Aqui é o
      // contrário: o card REENTROU na análise, de verdade, e o prazo daquela etapa recomeça agora.
      // Deixar o carimbo velho faria a análise nascer atrasada de dias que ela não teve, e o quadro
      // cobraria do analista um atraso que é da correção.
      estagio_desde: agora,
    })
    .eq("id", card.id)
    // ⚠️ COMPARAÇÃO-E-TROCA: entre a leitura lá em cima e esta linha o card pode ter andado. E o
    // `.select()` é o que permite PERCEBER isso — `update` que não pega linha nenhuma volta sem
    // erro, e a rota responderia "pronto" sobre um card que não se moveu.
    .eq("estagio", card.estagio)
    .select("id");

  if (error) {
    console.error("[temis][retorno] falha ao devolver para a análise", error);
    return { erro: "Nao foi possivel devolver para a analise.", ok: false, status: 503 };
  }

  if (!mexidos || mexidos.length === 0) {
    // ⚠️ AQUI O ENVELOPE JÁ PODE TER SIDO CANCELADO, e não há como desfazer isso — é o preço de
    // cancelar ANTES de mover, e é o preço certo: o contrato que estava na rua era o velho de
    // qualquer jeito. A frase avisa, para ninguém concluir que "não aconteceu nada".
    return {
      erro: envelope.envelopeCancelado
        ? `O envelope ${envelope.envelopeCancelado} foi cancelado na Clicksign, mas o card saiu da etapa enquanto a tela estava aberta e não foi movido. Abra de novo.`
        : "Este trabalho saiu da etapa enquanto a tela estava aberta. Abra de novo.",
      ok: false,
      status: 409,
    };
  }

  await registrarPassagemDeEtapa(sb, {
    de: card.estagio,
    observacao: pedido.observacao ?? null,
    origem: "retorno_para_correcao",
    para: "analise",
    propostaId: card.proposta_id,
    quem: pedido.usuarioId,
    quemNome: pedido.usuarioNome,
    trabalhoId: card.id,
    trabalhoTipo: card.tipo,
  });

  return { de: card.estagio, envelopeCancelado: envelope.envelopeCancelado, ok: true };
}

/**
 * Lê o envelope da proposta e, se houver um vivo, cancela.
 *
 * Devolve a falha pronta quando a volta tem de parar, ou o que foi cancelado (`null` = não havia
 * nada vivo).
 */
async function conferirEMatarOEnvelope(
  sb: SupabaseClient,
  card: CardParaVoltar,
  porta?: PortaDaClicksign,
): Promise<EnvelopeResolvido | FalhaNoRetorno> {
  // ⚠️ SÓ O CARD DE TIPO `contrato` OLHA ENVELOPE, E ISSO É CORREÇÃO DE DOIS DEFEITOS REAIS — um que
  // trava e um que destrói. A leitura abaixo casa por `proposta_id`, e `temis_envelopes` NÃO TEM
  // `trabalho_id`: o elo da 0149 é `proposta_id` + `documento_id`. Só que o pedido de cancelamento
  // nasce com a MESMA `proposta_id` da venda (`app/api/incorporador/venda/cancelamento-de-contrato/
  // route.ts` chama `abrirTrabalho` com `propostaId: proposta.id`), e uma proposta tem DOIS cards —
  // medido em 10/09/2026 na proposta do Henrique (Q01 L05). Sem este portão:
  //
  //   • o card de DISTRATO, aberto sobre uma venda já assinada, NUNCA volta: a leitura acha o
  //     envelope `assinado` DA VENDA e recusa mandando "abra o pedido de cancelamento" — que é
  //     exatamente o card que a pessoa está olhando. Trava para sempre;
  //   • voltar o card de CANCELAMENTO cancelaria, na conta de PRODUÇÃO, o envelope vivo DA VENDA —
  //     e a confirmação mostrada nem fala em envelope, porque o cancelamento anda pelo estágio
  //     "contrato" (`AVISO_DA_VOLTA_SIMPLES`). Envelope cancelado não se desfaz.
  //
  // ⚠️ E O PORTÃO É VERDADEIRO HOJE, NÃO UMA SIMPLIFICAÇÃO: só o tipo `contrato` produz envelope. A
  // geração do contrato é travada por `tipo === "contrato"` (`ehContrato`, em
  // `modules/temis/blocks/trabalho/tela-de-trabalho.tsx`) e é dela que sai o PDF do envio; o painel
  // de assinatura abre para os quatro tipos que assinam (`EXIGE_ASSINATURA`), mas cessão, distrato e
  // cancelamento por correção ainda não geram contrato pela Têmis, então não há o que mandar.
  //
  // ⚠️ NO DIA EM QUE DISTRATO OU CESSÃO TIVEREM ENVELOPE PRÓPRIO, ESTE PORTÃO NÃO BASTA MAIS — e
  // trocar o `!==` por uma lista de tipos seria o conserto ERRADO, porque o defeito não é o tipo: é
  // a leitura por `proposta_id`, que devolve os envelopes de TODOS os cards da proposta. O conserto
  // é dar ao envelope um elo com o TRABALHO. Dois caminhos, os dois já desenhados na 0149:
  //   1. pelo documento — `temis_envelopes.documento_id` → `hercules_documentos.tipo`, casando o
  //      envelope com a peça que ele carrega (contrato, distrato, termo de cessão); ou
  //   2. uma coluna `trabalho_id` em `temis_envelopes`, gravada no envio.
  // Fica ESCRITO, e não resolvido agora: inventar a coluna hoje seria migration sem uso, e escolher
  // entre os dois caminhos depende de o envio de distrato existir para dizer qual deles se sustenta.
  if (card.tipo.trim() !== "contrato") return { envelopeCancelado: null, ok: true };

  if (!card.proposta_id) {
    // ⚠️ SEM VENDA LIGADA, SÓ A ETAPA DE CONTRATO VOLTA — e a diferença não é burocrática. Todo
    // envelope nasce amarrado a uma proposta (`abrirRegistro`, em `lib/assinatura/envio-db.ts`):
    // card sem `proposta_id` na etapa de Contrato nunca teve envio DAQUI, e não há nada na rua para
    // conferir. Já "Em assinatura" e "Pré-faturamento" AFIRMAM que o contrato saiu — é a marcação
    // humana de `marcarAtividade`, que avança o card sem envelope nenhum —, e nesses dois a falta da
    // proposta significa não poder conferir o que a própria etapa diz existir. Fail-closed: os cards
    // antigos (Garden e Lavra, anteriores à migration 0134) têm `proposta_id` nulo.
    if (card.estagio.trim() === "contrato") return { envelopeCancelado: null, ok: true };

    return {
      erro:
        `Este trabalho está em "${nomeDaEtapaGravada(card.estagio, card.tipo)}" e não tem venda ligada no Panteon, então não dá para conferir nem cancelar o envelope daqui. ` +
        "Confira na Clicksign e cancele por lá antes de mexer neste card.",
      ok: false,
      status: 409,
    };
  }

  const { data, error } = await sb
    .from("temis_envelopes")
    // As mesmas colunas que a guarda do envio lê — é a mesma régua, em `envelopeQueSegura`.
    .select("criado_em, envelope_id, estado, falha, id, provedor")
    .eq("proposta_id", card.proposta_id)
    .order("criado_em", { ascending: false })
    .limit(50);

  if (error) {
    // ⚠️ NÃO SABER É MOTIVO PARA NÃO VOLTAR, pelo mesmo desenho do envio: sem esta leitura não há
    // conferência nenhuma, e o card iria para a Análise com o contrato na rua.
    //
    // ⚠️ E ESTA É A ÚNICA FRASE DO ARQUIVO QUE MANDA TENTAR DE NOVO, DE PROPÓSITO — a regra das
    // outras (ver o bloco do cancelamento, mais abaixo) nasceu de um fato que aqui não existe.
    // Lá, o clique de novo pode cancelar um envelope duas vezes ou soltar o card sobre um que
    // ninguém matou; aqui nada saiu do Panteon: uma LEITURA falhou, nenhuma linha foi escrita,
    // nenhum id foi para a Clicksign. Falha de leitura passa sozinha, e sem esta oração a frase
    // deixaria o operador sem próximo passo nenhum.
    console.error("[temis][retorno] falha ao ler os envelopes da proposta", error);
    return {
      erro:
        "Não foi possível conferir o envelope deste contrato, e por isso o card não foi movido. Tente de novo em instantes.",
      ok: false,
      status: 503,
    };
  }

  const veredito = conferirEnvelopeParaVoltar((data ?? []) as EnvelopeDaProposta[]);
  if (!veredito.ok) return { erro: veredito.erro, ok: false, status: 409 };
  if (!veredito.envelopeParaCancelar) return { envelopeCancelado: null, ok: true };

  // ⚠️ A PERGUNTA "JÁ ESTÁ ASSINADO?" VAI PARA A CLICKSIGN, E É AQUI. O que a linha do banco diz
  // acima é o que o webhook conseguiu escrever até agora; o que decide é o estado de AGORA. Ver a
  // nota do topo — 14:00:00 a quarta assinatura, 14:00:01 o clique.
  const leitura = await consultarEnvelope(veredito.envelopeParaCancelar, porta);

  // ⚠️ FAIL-CLOSED: LEITURA QUE FALHA RECUSA A VOLTA. Sem saber o estado, cancelar seria cancelar no
  // escuro — e o escuro aqui inclui o contrato assinado por todos, que não se desfaz. A frase NÃO
  // afirma nada sobre o envelope: diz que não deu para confirmar, e manda para onde a resposta está.
  if (!leitura.ok) {
    return {
      erro:
        `Não deu para confirmar o estado do envelope ${leitura.envelopeId} na Clicksign, e por isso o card NÃO voltou para a análise e nada foi cancelado. ` +
        `Confira o envelope ${leitura.envelopeId} na Clicksign: se ele ainda estiver correndo e não servir mais, cancele por lá — o webhook grava o cancelamento aqui e libera a volta. (${leitura.erro}${leitura.requestId ? ` · request ${leitura.requestId}` : ""})`,
      ok: false,
      status: 502,
    };
  }

  const real = conferirEstadoRealParaVoltar(leitura);
  if (!real.ok) return { erro: real.erro, ok: false, status: 409 };

  // Morreu lá fora entre o nosso último webhook e agora: não há o que cancelar, e o card volta.
  //
  // ⚠️ E A LINHA DO BANCO FICA COMO ESTÁ, DE PROPÓSITO — com uma consequência que precisa estar
  // escrita: até o webhook chegar, `temis_envelopes` ainda diz `aguardando`, e é ela que a guarda do
  // ENVIO lê (`impedimentoDeEnvelopeVivo`). Ou seja, o card volta para a Análise e o reenvio fica
  // recusado por alguns instantes, dizendo que já existe envelope vivo. Carimbar aqui seria pior:
  // `carimbarCancelamento` grava `estado_cru = panteon:retorno_para_correcao`, que quer dizer "fomos
  // nós que cancelamos" — e aqui não fomos. Escrever isso sobre uma recusa ou um prazo vencido
  // mandaria a auditoria procurar um cancelamento nosso que nunca houve. Quem tem a verdade é o
  // evento que está a caminho.
  if (!real.cancelar) return { envelopeCancelado: null, ok: true };

  const cancelamento = await cancelarEnvelope(veredito.envelopeParaCancelar, porta);

  // ⚠️ FALHOU O CANCELAMENTO, O CARD NÃO VOLTA — e a mensagem diz o id, porque a saída é cancelar
  // por lá. Sem o id, "confira na Clicksign" manda alguém procurar à mão numa lista que tem contrato
  // de verdade dentro.
  //
  // ⚠️ E SÃO DUAS FRASES, PORQUE SÃO DOIS FATOS DIFERENTES. A API recusar é uma certeza: o envelope
  // continua vivo. A chamada ABORTAR (timeout, rede) não é — o PATCH pode ter chegado e o envelope
  // já estar morto do outro lado, e a frase antiga afirmava "as pessoas continuam com o contrato
  // atual para assinar" nos dois casos. É a mesma distinção que `carimbarFalha` já faz no envio
  // (`lib/assinatura/envio-db.ts`), e quem separa os dois é `cancelamento.duvidoso`.
  //
  // ⚠️ NENHUMA DAS DUAS DIZ "TENTE DE NOVO". É a regra escrita da casa para estas frases (a irmã
  // desta, na linha ambígua acima, já a cumpria): quem libera a volta é o WEBHOOK gravando o
  // cancelamento aqui, não um segundo clique — e um segundo clique, no caso duvidoso, é justamente
  // quem cancelaria o envelope certo duas vezes ou soltaria o card sobre um que ninguém matou.
  if (!cancelamento.ok) {
    return {
      erro: cancelamento.duvidoso
        ? `A Clicksign não respondeu ao pedido de cancelamento do envelope ${cancelamento.envelopeId}, e NÃO DÁ PARA SABER se ele chegou: o envelope pode ter sido cancelado lá ou continuar valendo. Por isso o card NÃO voltou para a análise. ` +
          `Confira o envelope ${cancelamento.envelopeId} na Clicksign — se ainda estiver correndo, cancele por lá, e o webhook grava o cancelamento aqui e libera a volta. (${cancelamento.erro}${cancelamento.requestId ? ` · request ${cancelamento.requestId}` : ""})`
        : `A Clicksign recusou o cancelamento do envelope ${cancelamento.envelopeId}, e por isso o card NÃO voltou para a análise: as pessoas continuam com o contrato atual para assinar. ` +
          `Cancele o envelope ${cancelamento.envelopeId} na Clicksign — o webhook grava o cancelamento aqui e libera a volta. (${cancelamento.erro}${cancelamento.requestId ? ` · request ${cancelamento.requestId}` : ""})`,
      ok: false,
      status: 502,
    };
  }

  await carimbarCancelamento(sb, veredito.registroId, cancelamento.envelopeId);

  return { envelopeCancelado: cancelamento.envelopeId, ok: true };
}

/**
 * Marca no Panteon o envelope que acabou de morrer na Clicksign.
 *
 * ⚠️ FALHA AQUI NÃO PARA A VOLTA, e é a única falha deste arquivo que não para. O fato já aconteceu
 * do lado de fora: o envelope está cancelado, ninguém mais assina aquilo. O que se perde é o nosso
 * registro — e ele ainda tem quem o conserte, porque a Clicksign manda o evento de cancelamento pelo
 * webhook e `aplicarEventoDaClicksign` grava o mesmo estado. Derrubar a volta por causa disso deixaria
 * o card parado em "em assinatura" com o envelope já morto: o pior dos dois mundos, invertido.
 */
async function carimbarCancelamento(
  sb: SupabaseClient,
  registroId: null | string,
  envelopeId: string,
): Promise<void> {
  if (!registroId) return;

  const agora = new Date().toISOString();
  const { error } = await sb
    .from("temis_envelopes")
    .update({
      atualizado_em: agora,
      estado: "cancelado",
      // ⚠️ `panteon:` E NÃO `clicksign:`, porque quem cancelou fomos nós. O `estado_cru` das outras
      // gravações guarda o evento que veio de lá (`clicksign:running`, `clicksign:cancel`), e
      // escrever um evento que a Clicksign não mandou faria a auditoria procurar no webhook um
      // registro que nunca existiu.
      estado_cru: "panteon:retorno_para_correcao",
      // ⚠️ `fechado_em` É O QUE TIRA A LINHA DA FILA DE ACOMPANHAMENTO: sem ele o envelope morto
      // continuaria sendo consultado como se ainda estivesse correndo.
      fechado_em: agora,
    })
    .eq("id", registroId);

  if (error) {
    console.error(
      "[temis][retorno] O ENVELOPE FOI CANCELADO NA CLICKSIGN E O REGISTRO NÃO ATUALIZOU. envelope:",
      envelopeId,
      error,
    );
  }
}
