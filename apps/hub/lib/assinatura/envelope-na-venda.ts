import type { SupabaseClient } from "@supabase/supabase-js";

import { VENDA_DESFEITA } from "@/lib/hercules/acao-de-cancelamento";

// ⚠️ IMPORT EM CÍRCULO, CONSCIENTE: `estado-db.ts` (o webhook) chama `aplicarEnvelopeNaVenda` daqui,
// e daqui se usam as funções de card de lá. Os dois lados só usam o outro DENTRO de funções.
import { concluirAssinaturaDoCard, moverCardDaTemis, ultimaAssinaturaDoComprador } from "./estado-db";
import { ESTADOS_QUE_LIBERAM_REENVIO, envelopeVigente } from "./envelope-vigente";
import { diaEmBrasilia } from "./instante";
import { type ItemDoQuadro, lerQuadro } from "./registro-db";
import type { EstadoDaAssinatura, FinalidadeDoEnvelope, Provedor } from "./tipos";

// O FATO DO ENVELOPE CHEGA AO CARD E À VENDA POR UMA PORTA SÓ, VENHA DE ONDE VIER.
//
// Lucas, 28/09/2026, sobre o contrato da venda nativa assinado pela D4Sign do C2X: *"Sim, anda
// sozinho"*. E sobre a data: gravada na venda quando o contrato fecha. Até a F2 da fonte única só o
// webhook da Clicksign movia o card (no assinado), com a data do prazo "agora" quando faltava a do
// comprador, e nenhuma escrita de `data_assinatura`. O espelho da D4Sign (F3) precisa do mesmo
// caminho, e duas portas divergiriam no primeiro conserto (plano, seção 7).
//
// ⚠️ AS GUARDAS VÊM ANTES DE TUDO, E QUALQUER "NÃO" DEVOLVE `nada` COM O MOTIVO (só ids e regra,
// nunca nome): a chave `moverVendas`; `finalidade = 'contrato'` (distrato e cessão também vão para
// assinatura com o `proposta_id` da venda, 0.22 do plano); proposta NATIVA (a carga do C2X não tem a
// etapa movida por aqui); venda lida AGORA e viva; e SEM pedido de cancelamento aberto (a LBF, 0.21:
// o contrato de uma venda que o cliente pediu para desfazer não empurra a venda para a frente).
//
// ⚠️ SÓ NA BORDA, COM COMPARAR-E-TROCAR E SÓ COM DATA REAL. O card anda com `.eq("estagio", lido)`
// (`moverCardDaTemis` e `concluirAssinaturaDoCard`); a data vai com `.is("data_assinatura", null)`.
// Chamar de novo com o mesmo fato não muda nada: é isso que deixa a reconciliação rodar toda rodada.
//
// ⚠️ EFEITO SÓ NO BANCO (0.11 do plano): mover o card e refletir na venda não disparam WhatsApp,
// notificação, fila do C2X nem gatilho.

/**
 * A CHAVE DO ESPELHO DA D4SIGN: o contrato que o C2X mandou move a venda nativa?
 *
 * ⚠️ NASCE `false`, E SÓ VIRA `true` NUM DEPLOY, COM OK DO LUCAS, DEPOIS DA PROVA DA F3 (plano, F3,
 * "Ordem": ensaio → `--gravar` sem mover → prova → cron → prova → `--mover-vendas`). Ligar antes
 * moveria cards e vendas a partir de um casamento envelope → venda que ninguém conferiu ainda.
 *
 * ⚠️ ELA NÃO DESLIGA A CLICKSIGN. O envelope da Clicksign é mandado pela própria Têmis e sempre
 * concluiu o card no assinado: o webhook o trata com `moverVendas: true`, e a reconciliação o refaz
 * sempre que grava (quem segura a escrita dela é `gravar`, não esta chave).
 *
 * ⚠️ QUANDO ELA LIGAR, a entrada em assinatura dos envelopes que o `--gravar` inseriu com ela
 * desligada já passou e não se repete: quem leva esses cards a "Em assinatura" é a reconciliação
 * (alvo `entrada`), na primeira rodada com a chave ligada.
 */
export const MOVER_VENDAS = false;

/** O fato: o envelope, o estado de antes e o de depois. */
export type MudancaDoEnvelope = {
  envelope: {
    /** Só data REAL do provedor (a 0195 nunca inventa `fechado_em`). */
    fechadoEm: null | string;
    finalidade: FinalidadeDoEnvelope | null;
    id: string;
    origem: "c2x" | "panteon";
    propostaId: null | string;
    provedor: Provedor;
    /** O quadro JÁ MESCLADO pela função da 0195. */
    signatarios: ItemDoQuadro[];
    /** O card que mandou o envelope (0195), quando se sabe. */
    trabalhoId?: null | string;
  };
  /** `novo` = a linha acabou de nascer (o espelho a inseriu nesta rodada). */
  estadoAntes: EstadoDaAssinatura | "novo";
  estadoDepois: EstadoDaAssinatura;
};

/** O que aconteceu, para o log e o relatório. */
export type EfeitoNaVenda = {
  card: "andou" | "ja_estava" | "nada" | "recusado";
  dataDeAssinatura: "falhou" | "gravada" | "ja_tinha" | "nao_se_aplica" | "sem_data_real";
  /** Ids e regra, NUNCA nome, e-mail ou documento. */
  motivo: string;
};

/** A chave vem de quem chama: a constante `MOVER_VENDAS` no espelho, `--mover-vendas` no script. */
export type OpcoesDoEfeito = { moverVendas: boolean };

const WORKSPACE = "careli";

/** De onde a D4Sign "entra" em assinatura: a linha nova, o rascunho, o que não se sabia. */
const ESTADOS_ANTES_DE_ENTRAR: ReadonlySet<string> = new Set(["novo", "rascunho", "desconhecido"]);
/** Onde ela entra. */
const ESTADOS_EM_ASSINATURA: ReadonlySet<string> = new Set(["aguardando", "parcial"]);

type VendaLida = {
  cancelada_em: null | string;
  cancelamento_pedido_em: null | string;
  data_assinatura: null | string;
  etapa: null | string;
  id: string;
  origem: null | string;
};

/**
 * Leva o fato do envelope ao card da Têmis e à venda do Hércules. NUNCA LANÇA.
 *
 *   • D4Sign entrando em assinatura (antes `novo`/`rascunho`/`desconhecido`, depois `aguardando`/
 *     `parcial`): o card de contrato antes de "Em assinatura" vai para lá (origem `espelho_d4sign`)
 *     e o reflexo leva a venda `contrato → assinatura`. Card já lá ou adiante: nada é regravado.
 *   • Clicksign `aguardando`/`parcial`, e qualquer mudança que não seja borda: nada (o envio da Têmis
 *     já moveu o card).
 *   • Qualquer provedor → `assinado` COM DATA REAL: D4Sign leva o card a "Em assinatura" se ainda não
 *     estava; depois o card vai ao Pré-faturamento (`concluirAssinaturaDoCard`) com o início dos 7
 *     dias; depois `data_assinatura` = o dia em Brasília DO MESMO INSTANTE, só se nula e só na nativa.
 *   • `assinado` sem data real: nada (`sem_data_real`); a reconciliação pega quando a data chegar.
 *   • `cancelado`/`expirado`/`recusado`: nada no card.
 */
export async function aplicarEnvelopeNaVenda(
  sb: SupabaseClient,
  mudanca: MudancaDoEnvelope,
  opcoes: OpcoesDoEfeito,
): Promise<EfeitoNaVenda> {
  const { envelope, estadoAntes, estadoDepois } = mudanca;
  const nada = (motivo: string, dataDeAssinatura: EfeitoNaVenda["dataDeAssinatura"] = "nao_se_aplica"): EfeitoNaVenda => ({
    card: "nada",
    dataDeAssinatura,
    motivo: `envelope ${envelope.id}: ${motivo}`,
  });

  if (!opcoes.moverVendas) return nada("mover vendas está desligado");
  if (envelope.finalidade !== "contrato") {
    return nada(`finalidade ${envelope.finalidade ?? "desconhecida"}, só contrato move a venda`);
  }
  const propostaId = String(envelope.propostaId ?? "").trim();
  if (!propostaId) return nada("sem venda ligada");

  const assinou = estadoDepois === "assinado";
  const entrou =
    envelope.provedor === "d4sign" && ESTADOS_ANTES_DE_ENTRAR.has(estadoAntes) && ESTADOS_EM_ASSINATURA.has(estadoDepois);
  if (!assinou && !entrou) return nada(`${estadoAntes} → ${estadoDepois} não é borda que mova a venda`);

  try {
    const leitura = await lerVenda(sb, propostaId);
    if (!leitura.ok) {
      return {
        card: "recusado",
        dataDeAssinatura: assinou ? "falhou" : "nao_se_aplica",
        motivo: `envelope ${envelope.id}: não deu para ler a venda ${propostaId}`,
      };
    }
    const venda = leitura.venda;
    if (!venda) return nada(`a venda ${propostaId} não existe`);

    // ⚠️ SÓ A NATIVA. A proposta da carga tem a etapa e a data vindas do C2X; mexer nela daqui
    // escreveria por cima do legado uma decisão que é dele (plano, seção 7).
    if (String(venda.origem ?? "") !== "panteon") return nada(`a venda ${propostaId} é da carga do C2X`);

    // ⚠️ VENDA MORTA NÃO RESSUSCITA. Um contrato assinado depois do distrato não põe a venda de volta
    // no funil: fica `recusado` para o relatório, e ninguém anda.
    if (VENDA_DESFEITA.has(String(venda.etapa ?? "").trim()) || venda.cancelada_em) {
      return {
        card: "recusado",
        dataDeAssinatura: "nao_se_aplica",
        motivo: `envelope ${envelope.id}: a venda ${propostaId} já foi desfeita`,
      };
    }

    // ⚠️ PEDIDO DE CANCELAMENTO ABERTO: A VENDA FICA PARADA (0.21 do plano, a LBF). Quem decide o que
    // acontece com ela é a conclusão do pedido na Têmis; um contrato que chega nesse meio tempo não
    // empurra a venda para o Pré-faturamento nem carimba a data. Vai ao relatório.
    if (venda.cancelamento_pedido_em) {
      return nada(`a venda ${propostaId} tem pedido de cancelamento aberto`);
    }

    if (!assinou) {
      const movimento = await moverCardDaTemis(sb, propostaId, "assinatura", null, null, "espelho_d4sign", {
        somenteSeAndar: true,
        tipos: ["contrato"],
      });
      if (movimento.movidos.length > 0) {
        return {
          card: "andou",
          dataDeAssinatura: "nao_se_aplica",
          motivo: `envelope ${envelope.id}: card da venda ${propostaId} foi para Em assinatura`,
        };
      }
      const jaEstava = await cardDeContratoJaChegou(sb, propostaId, "assinatura");
      return {
        card: jaEstava ? "ja_estava" : "nada",
        dataDeAssinatura: "nao_se_aplica",
        motivo: `envelope ${envelope.id}: ${jaEstava ? "o card já estava em Em assinatura ou adiante" : "nenhum card de contrato pôde andar"}`,
      };
    }

    // ── ASSINADO ────────────────────────────────────────────────────────────
    const instante = inicioDoArrependimento(envelope.provedor, envelope.signatarios, envelope.fechadoEm);
    const dia = diaDaAssinatura(instante);
    if (!instante || !dia) {
      return nada("assinado sem data real (nem do comprador, nem do provedor)", "sem_data_real");
    }

    // ⚠️ A D4SIGN PODE FECHAR ANTES DE O CARD TER ENTRADO EM ASSINATURA (o espelho viu o documento
    // já finalizado, ou a rodada da entrada ficou para trás). O card passa por "Em assinatura" antes
    // do Pré-faturamento: são as duas passagens que aconteceram, e a conclusão só sai de lá.
    if (envelope.provedor === "d4sign") {
      await moverCardDaTemis(sb, propostaId, "assinatura", null, null, "espelho_d4sign", {
        somenteSeAndar: true,
        tipos: ["contrato"],
      });
    }

    const conclusao = await concluirAssinaturaDoCard(sb, propostaId, {
      fechadoEm: envelope.fechadoEm,
      finalidade: envelope.finalidade,
      provedor: envelope.provedor,
      signatarios: envelope.signatarios,
      trabalhoId: envelope.trabalhoId ?? null,
    });

    const dataDeAssinatura = await gravarDataDeAssinatura(sb, venda, dia);

    return {
      card: conclusao === "andou" ? "andou" : conclusao === "ja_estava" ? "ja_estava" : "nada",
      dataDeAssinatura,
      motivo: `envelope ${envelope.id}: venda ${propostaId} assinada em ${dia} (card ${conclusao}, data ${dataDeAssinatura})`,
    };
  } catch (falha) {
    console.error("[assinatura][venda] falha inesperada ao levar o envelope à venda", {
      envelope: envelope.id,
      message: falha instanceof Error ? falha.message : String(falha),
    });
    return {
      card: "recusado",
      dataDeAssinatura: assinou ? "falhou" : "nao_se_aplica",
      motivo: `envelope ${envelope.id}: falha inesperada`,
    };
  }
}

/** A venda, lida AGORA (e não a do chamador, que pode ter minutos). `ok: false` = a leitura falhou. */
async function lerVenda(
  sb: SupabaseClient,
  propostaId: string,
): Promise<{ ok: false } | { ok: true; venda: null | VendaLida }> {
  const { data, error } = await sb
    .from("hercules_propostas")
    .select("id, origem, etapa, cancelada_em, cancelamento_pedido_em, data_assinatura")
    .eq("workspace_id", WORKSPACE)
    .eq("id", propostaId)
    .maybeSingle();
  if (error) {
    console.error("[assinatura][venda] falha ao ler a venda", { code: error.code ?? null, message: error.message ?? null });
    return { ok: false };
  }
  return { ok: true, venda: (data as null | VendaLida) ?? null };
}

/** Algum card de contrato desta venda já está no estágio pedido, ou adiante dele? */
async function cardDeContratoJaChegou(sb: SupabaseClient, propostaId: string, estagio: "assinatura"): Promise<boolean> {
  const { data, error } = await sb
    .from("temis_trabalhos")
    .select("id, estagio")
    .eq("proposta_id", propostaId)
    .eq("tipo", "contrato");
  if (error) return false;
  const adiante = new Set<string>([estagio, "prazo_legal", "faturado"]);
  return ((data ?? []) as Array<{ estagio: string }>).some((c) => adiante.has(String(c.estagio)));
}

/**
 * `data_assinatura` = o dia do contrato, só se nula e só na nativa.
 *
 * ⚠️ `.is("data_assinatura", null)` E `.eq("origem", "panteon")` NA PRÓPRIA ESCRITA, e não só na
 * leitura acima: entre as duas outra mão pode ter gravado a data (a própria reconciliação, um
 * segundo webhook), e a primeira data que o Panteon gravou é a que vale. Zero linhas = já tinha.
 *
 * ⚠️ É A ÚNICA ESCRITA NOVA EM `hercules_propostas` DA FONTE ÚNICA (decisão do Lucas, 28/09): a etapa
 * continua com o reflexo (`reflexo-da-temis-server.ts`), que nunca escreve esta coluna.
 */
async function gravarDataDeAssinatura(
  sb: SupabaseClient,
  venda: VendaLida,
  dia: string,
): Promise<EfeitoNaVenda["dataDeAssinatura"]> {
  if (venda.data_assinatura) return "ja_tinha";
  const { data, error } = await sb
    .from("hercules_propostas")
    .update({ atualizado_em: new Date().toISOString(), data_assinatura: dia })
    .eq("workspace_id", WORKSPACE)
    .eq("id", venda.id)
    .eq("origem", "panteon")
    .is("data_assinatura", null)
    .select("id");
  if (error) {
    console.error("[assinatura][venda] falha ao gravar a data de assinatura", {
      code: error.code ?? null,
      message: error.message ?? null,
    });
    return "falhou";
  }
  return Array.isArray(data) && data.length > 0 ? "gravada" : "ja_tinha";
}

/** Um instante legível, ou `null`. */
function instanteLegivel(valor: null | string | undefined): null | string {
  const texto = String(valor ?? "").trim();
  return texto && !Number.isNaN(Date.parse(texto)) ? texto : null;
}

/**
 * QUANDO COMEÇAM OS 7 DIAS DE ARREPENDIMENTO. Puro.
 *
 * ⚠️ CLICKSIGN: a última assinatura de comprador ou cônjuge do QUADRO (o papel é congelado no envio e
 * nunca é nulo lá, medido em 8 de 8), senão o fechamento. Lucas: os 7 dias contam da última
 * assinatura do COMPRADOR, e a vendedora não entra.
 *
 * ⚠️ D4SIGN: SEMPRE O FECHAMENTO (a última assinatura de todos). Lá só o perfil "Cliente" vira
 * Comprador, comprador sem usuário vira "Sem perfil" e corretor que compra vira "Imobiliária":
 * escolher "o último comprador" poderia começar o prazo cedo demais. Começar no fechamento nunca
 * encurta um prazo que é do cliente (plano, seção 7, Integridade I12).
 *
 * `null` = sem data real. Quem chama NÃO inventa "agora".
 */
export function inicioDoArrependimento(
  provedor: Provedor,
  signatarios: readonly ItemDoQuadro[],
  fechadoEm: null | string,
): null | string {
  const fechamento = instanteLegivel(fechadoEm);
  if (provedor === "d4sign") return fechamento;
  return ultimaAssinaturaDoComprador(signatarios) ?? fechamento;
}

/**
 * O dia (`AAAA-MM-DD`) em Brasília de um instante. Puro.
 *
 * ⚠️ `hercules_propostas.data_assinatura` É DATE (0.10 do plano): 23:30 de Brasília é o dia seguinte
 * em UTC, e um `slice(0, 10)` gravaria o dia errado. Por isso `diaEmBrasilia`, com `Intl`.
 */
export function diaDaAssinatura(instante: null | string): null | string {
  return diaEmBrasilia(instante);
}

// ── A RECONCILIAÇÃO ─────────────────────────────────────────────────────────

/** O tamanho da página e do lote das leituras (o teto de 1.000 do PostgREST e o `.in()` na URL). */
const PAGINA = 1000;
const LOTE = 100;

/** Os estágios do card de contrato ANTES do Pré-faturamento: onde o assinado ainda não chegou. */
const CARD_ANTES_DO_PRAZO: ReadonlySet<string> = new Set(["analise", "contrato", "assinatura"]);
/** Os estágios do card de contrato ANTES de "Em assinatura": onde a entrada da D4Sign ainda não chegou. */
const CARD_ANTES_DA_ASSINATURA: ReadonlySet<string> = new Set(["analise", "contrato"]);
/** As etapas da venda em que a ENTRADA da D4Sign ainda faz sentido (faturada não volta para assinatura). */
const VENDA_ANTES_DO_FATURADO: ReadonlySet<string> = new Set(["contrato", "assinatura"]);

/**
 * As colunas da PRIMEIRA passada, SEM `signatarios`.
 *
 * ⚠️ O JSONB DO QUADRO (nome e e-mail de quem assina) SÓ É LIDO DE QUEM VAI SER REFEITO (Segurança 16
 * do plano: "leitura estreita, jsonb só dos que vão"). A primeira passada lê toda venda nativa em
 * contrato, assinatura e faturado sem data, 48 vezes por dia com o cron da F3; o quadro de todas elas
 * a cada rodada seria custo e exposição sem uso.
 */
const COLUNAS_DO_ENVELOPE =
  "id, proposta_id, provedor, origem, finalidade, estado, fechado_em, trabalho_id, criado_em, envelope_id, falha, enviado_em";

type EnvelopeLido = {
  criado_em: string;
  enviado_em: null | string;
  envelope_id: null | string;
  estado: string;
  falha: null | string;
  fechado_em: null | string;
  finalidade: FinalidadeDoEnvelope | null;
  id: string;
  origem: null | string;
  proposta_id: string;
  provedor: string;
  trabalho_id: null | string;
};

/** Uma venda que a rodada vai refazer, já decidida ANTES de gastar o limite. */
type AlvoDaReconciliacao = {
  /** `conclusao` = o assinado que ficou para trás; `entrada` = a D4Sign em assinatura cujo card não entrou. */
  tipo: "conclusao" | "entrada";
  venda: VendaLida;
  vigente: EnvelopeLido;
};

/** As opções da reconciliação. */
export type OpcoesDaReconciliacao = OpcoesDoEfeito & {
  /**
   * `false` = ENSAIO: escolhe os alvos, conta em `planejadas` e não escreve nada (nem card, nem
   * passagem, nem venda, nem data).
   *
   * ⚠️ É UMA CHAVE SEPARADA DE `moverVendas`, DE PROPÓSITO. `moverVendas` é a chave da D4SIGN (o
   * contrato que o C2X mandou move a venda nativa?); a Clicksign é refeita sempre que se grava, porque
   * esta varredura é a rede do WEBHOOK dela, que move a venda com ou sem espelho. Reaproveitar
   * `moverVendas: false` como "não escreve" deixaria o ensaio escrever a Clicksign (revisão da F2).
   * Para o Zeus, antes da F3: o `--gravar` sem `--mover-vendas` do script chama com `gravar: true,
   * moverVendas: false` e REFAZ a Clicksign que ficou para trás (é a rede do webhook, não o espelho
   * movendo venda); o ensaio chama com `gravar: false`.
   */
  gravar: boolean;
  /** Quantas vendas a rodada refaz, no máximo (cron: 20). */
  limite: number;
};

/**
 * Refaz o efeito do contrato que ficou para trás. Idempotente.
 *
 * ⚠️ É A REDE DA TRANSIÇÃO QUE SE PERDE (Integridade I5): o `after()` do webhook que morreu depois
 * da função da 0195 ter gravado "assinado", ou o orçamento do cron que cortou entre a RPC e o efeito.
 * Nos dois casos o envelope já diz o estado novo e a borda não volta: sem esta varredura, o card e a
 * data da venda ficariam para trás para sempre. Roda em toda rodada do espelho (F3), com `limite`.
 *
 * ⚠️ QUEM A CHAMA É O ESPELHO DA D4SIGN (F3, `espelho-d4sign/espelho.ts`, passo 6), em toda rodada, com
 * limite 20. Enquanto o cron do espelho não estiver no `vercel.json` (pendente de OK), ela só roda pelo
 * script ou pelo POST manual, e o efeito que falhar no webhook fica para trás até lá (o log diz isso).
 *
 * Os dois alvos, só de venda NATIVA viva e sem pedido de cancelamento:
 *   • CONCLUSÃO: o envelope de contrato vigente está `assinado` COM `fechado_em` (plano, seção 7), e
 *     o card de contrato ainda está antes do Pré-faturamento OU a `data_assinatura` está nula;
 *   • ENTRADA (só D4Sign, só com `moverVendas`): o vigente é da D4Sign e está `aguardando`/`parcial`,
 *     e o card de contrato ainda está antes de "Em assinatura". ⚠️ É O CASO DA ORDEM DA F3: o
 *     `--gravar` roda SEM mover vendas, e a entrada em assinatura dos envelopes vivos (`novo` →
 *     `aguardando`) passa enquanto a chave está desligada. A borda não se repete; quando a chave
 *     liga, só esta varredura leva esses cards a "Em assinatura" (o "anda sozinho" do Lucas nas
 *     nativas já conhecidas: ACP, REP, VAL×2). Chama a porta com `estadoAntes: "desconhecido"`: o
 *     `somenteSeAndar` e o comparar-e-trocar deixam a chamada idempotente.
 *
 * ⚠️ DECIDE ANTES DE CONTAR. O caso que nunca se resolve não gasta o limite (vai para `puladas`): a
 * Clicksign assinada com o card fora de "Em assinatura" e a data já gravada (a Clicksign não leva o
 * card até lá, então a conclusão não teria o que fazer) e o assinado sem `fechado_em`. Sem isso, mais
 * travados que o limite, sempre na mesma ordem, e as vendas seguintes nunca seriam refeitas.
 *
 * ⚠️ LEITURA PAGINADA COM ORDEM, `.in()` EM LOTES DE 100: sem ordem, a paginação perde linha e o total
 * ainda bate; `.in()` grande estoura a URL (medido na casa, 700 ids deram 400).
 */
export async function reconciliarVendasAssinadas(
  sb: SupabaseClient,
  opcoes: OpcoesDaReconciliacao,
): Promise<{ planejadas: number; puladas: Record<string, number>; refeitas: number }> {
  const puladas: Record<string, number> = {};
  const pular = (motivo: string) => {
    puladas[motivo] = (puladas[motivo] ?? 0) + 1;
  };
  let refeitas = 0;

  try {
    // ⚠️ A FATURADA SÓ ENTRA SEM DATA: faturada com `data_assinatura` não tem mais o que refazer (o card
    // acompanha a venda), e sem este recorte toda venda nativa já faturada seria lida para sempre.
    const emCurso = await lerPaginado<VendaLida>(async (de) =>
      sb
        .from("hercules_propostas")
        .select("id, origem, etapa, cancelada_em, cancelamento_pedido_em, data_assinatura")
        .eq("workspace_id", WORKSPACE)
        .eq("origem", "panteon")
        .in("etapa", ["contrato", "assinatura"])
        .is("cancelada_em", null)
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1),
    );
    const faturadasSemData = await lerPaginado<VendaLida>(async (de) =>
      sb
        .from("hercules_propostas")
        .select("id, origem, etapa, cancelada_em, cancelamento_pedido_em, data_assinatura")
        .eq("workspace_id", WORKSPACE)
        .eq("origem", "panteon")
        .eq("etapa", "faturado")
        .is("cancelada_em", null)
        .is("data_assinatura", null)
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1),
    );
    if (!emCurso || !faturadasSemData) return { planejadas: 0, puladas: { leitura_falhou: 1 }, refeitas: 0 };
    const vendas = [...emCurso, ...faturadasSemData];

    const ids = vendas.map((v) => v.id);
    const envelopes: EnvelopeLido[] = [];
    const cards: Array<{ estagio: string; id: string; proposta_id: string }> = [];
    // Os estados que SEGURAM (a régua do vigente precisa de todos eles, não só do assinado).
    const liberam = `(${[...ESTADOS_QUE_LIBERAM_REENVIO].join(",")})`;
    for (let i = 0; i < ids.length; i += LOTE) {
      const lote = ids.slice(i, i + LOTE);
      const doLote = await lerPaginado<EnvelopeLido>(async (de) =>
        sb
          .from("temis_envelopes")
          .select(COLUNAS_DO_ENVELOPE)
          .eq("finalidade", "contrato")
          .not("estado", "in", liberam)
          .in("proposta_id", lote)
          .order("id", { ascending: true })
          .range(de, de + PAGINA - 1),
      );
      const cardsDoLote = await lerPaginado<{ estagio: string; id: string; proposta_id: string }>(async (de) =>
        sb
          .from("temis_trabalhos")
          .select("id, proposta_id, estagio")
          .eq("tipo", "contrato")
          .in("proposta_id", lote)
          .order("id", { ascending: true })
          .range(de, de + PAGINA - 1),
      );
      if (!doLote || !cardsDoLote) return { planejadas: 0, puladas: { ...puladas, leitura_falhou: 1 }, refeitas };
      envelopes.push(...doLote);
      cards.push(...cardsDoLote);
    }

    // ── 1. DECIDE (sem escrever e sem gastar o limite com o que não se resolve) ──
    const alvos: AlvoDaReconciliacao[] = [];
    for (const venda of vendas) {
      const vigente = envelopeVigente(envelopes.filter((e) => e.proposta_id === venda.id)).vigente;
      if (!vigente) continue;
      const estagios = cards.filter((c) => c.proposta_id === venda.id).map((c) => String(c.estagio));
      const provedor: Provedor = vigente.provedor === "d4sign" ? "d4sign" : "clicksign";

      let tipo: AlvoDaReconciliacao["tipo"];
      if (vigente.estado === "assinado") {
        const cardAtrasado = estagios.some((e) => CARD_ANTES_DO_PRAZO.has(e));
        if (!cardAtrasado && venda.data_assinatura) continue;
        tipo = "conclusao";
      } else if (provedor === "d4sign" && ESTADOS_EM_ASSINATURA.has(vigente.estado)) {
        if (!VENDA_ANTES_DO_FATURADO.has(String(venda.etapa ?? ""))) continue;
        if (!estagios.some((e) => CARD_ANTES_DA_ASSINATURA.has(e))) continue;
        tipo = "entrada";
      } else {
        continue;
      }

      if (venda.cancelamento_pedido_em) {
        pular("pedido_de_cancelamento");
        continue;
      }
      if (provedor === "d4sign" && !opcoes.moverVendas) {
        pular("mover_vendas_desligado");
        continue;
      }
      if (tipo === "conclusao") {
        // ⚠️ SÓ COM DATA REAL (plano, seção 7: "contrato `assinado` com `fechado_em`").
        if (!instanteLegivel(vigente.fechado_em)) {
          pular("sem_data_real");
          continue;
        }
        // ⚠️ A CLICKSIGN NÃO LEVA O CARD A "EM ASSINATURA" (quem leva é o envio da Têmis). Com o card
        // antes de lá e a data já gravada, a conclusão nunca terá o que fazer: pulado sem gastar limite.
        if (provedor === "clicksign" && !estagios.includes("assinatura") && venda.data_assinatura) {
          pular("clicksign_card_fora_de_assinatura");
          continue;
        }
      }
      if (alvos.length >= opcoes.limite) {
        pular("limite");
        continue;
      }
      alvos.push({ tipo, venda, vigente });
    }

    if (!opcoes.gravar) return { planejadas: alvos.length, puladas, refeitas: 0 };

    // ── 2. O QUADRO, SÓ DE QUEM VAI SER CONCLUÍDO ──
    const quadros = new Map<string, unknown>();
    const precisamDoQuadro = alvos.filter((a) => a.tipo === "conclusao").map((a) => a.vigente.id);
    for (let i = 0; i < precisamDoQuadro.length; i += LOTE) {
      const lote = precisamDoQuadro.slice(i, i + LOTE);
      const { data, error } = await sb.from("temis_envelopes").select("id, signatarios").in("id", lote);
      if (error) {
        console.error("[assinatura][reconciliacao] falha ao ler o quadro", {
          code: error.code ?? null,
          message: error.message ?? null,
        });
        return { planejadas: alvos.length, puladas: { ...puladas, leitura_falhou: 1 }, refeitas };
      }
      for (const l of (data ?? []) as Array<{ id: string; signatarios: unknown }>) quadros.set(l.id, l.signatarios);
    }

    // ── 3. REFAZ ──
    for (const { tipo, venda, vigente } of alvos) {
      const provedor: Provedor = vigente.provedor === "d4sign" ? "d4sign" : "clicksign";
      const efeito = await aplicarEnvelopeNaVenda(
        sb,
        {
          envelope: {
            fechadoEm: vigente.fechado_em,
            finalidade: vigente.finalidade,
            id: vigente.id,
            origem: vigente.origem === "c2x" ? "c2x" : "panteon",
            propostaId: venda.id,
            provedor,
            signatarios: tipo === "conclusao" ? lerQuadro(quadros.get(vigente.id)) : [],
            trabalhoId: vigente.trabalho_id,
          },
          // ⚠️ NA ENTRADA, "desconhecido" é a verdade: a borda passou com a chave desligada e ninguém
          // sabe de onde o envelope veio. É um dos estados de onde a D4Sign "entra" (a porta confere).
          estadoAntes: tipo === "conclusao" ? "assinado" : "desconhecido",
          estadoDepois: vigente.estado as EstadoDaAssinatura,
        },
        // A chave já foi conferida acima (a D4Sign só chega aqui com `moverVendas`).
        { moverVendas: true },
      );

      if (efeito.card === "andou" || efeito.dataDeAssinatura === "gravada") refeitas += 1;
      else if (efeito.dataDeAssinatura === "sem_data_real") pular("sem_data_real");
      else if (efeito.card === "recusado" || efeito.dataDeAssinatura === "falhou") pular("falhou");
      else pular("sem_efeito");
    }
    return { planejadas: alvos.length, puladas, refeitas };
  } catch (falha) {
    console.error("[assinatura][reconciliacao] falha inesperada", {
      message: falha instanceof Error ? falha.message : String(falha),
    });
    return { planejadas: 0, puladas: { ...puladas, falha_inesperada: 1 }, refeitas };
  }
}

/** Lê página a página até a página vir curta. `null` = alguma página falhou (log só com code e message). */
async function lerPaginado<L>(
  pagina: (de: number) => PromiseLike<{ data: unknown; error: null | { code?: string; message?: string } }>,
): Promise<L[] | null> {
  const todas: L[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de);
    if (error) {
      console.error("[assinatura][reconciliacao] falha de leitura", {
        code: error.code ?? null,
        message: error.message ?? null,
      });
      return null;
    }
    const linhas = (Array.isArray(data) ? data : []) as L[];
    todas.push(...linhas);
    if (linhas.length < PAGINA) return todas;
  }
}
