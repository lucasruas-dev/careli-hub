import type { EnvioDoC2x } from "./c2x";

// O CASAMENTO ENVELOPE D4SIGN → UNIDADE → PROPOSTA (plano da fonte única, seção 3) — puro.
//
// ⚠️ UMA VEZ LIGADO, NÃO SE RELIGA SOZINHO. Esta função só é chamada para o envio que NASCE no espelho;
// troca de vínculo depois é correção assistida. E o que não passa numa regra nunca é ligado "por
// proximidade": vira `candidata` no relatório (M5 dos críticos).
//
// A ordem das regras (a primeira que casa vence):
//   1. `ar_da_carga`: a proposta com `origem_c2x_id = ar.id` (qualquer etapa, inclusive desfeita:
//      aquele envio é daquela venda);
//   2. `ar_da_carga_no_pai`: se ela está numa linha-sombra do PAI e o terreno tem venda viva com
//      contrato no FILHO (da carga ou nativa) do MESMO comprador, liga à do filho;
//   3. `nativa_do_mesmo_comprador`: a nativa do terreno, criada antes do envio, NÃO cancelada no
//      instante do envio e do MESMO comprador, a mais recente;
//   4. `sem_venda`: nada liga (com a candidata que não passou, quando há).
//
// ⚠️ "MESMO COMPRADOR" = dígitos do documento do cliente do pedido no C2X iguais aos de
// `cliente_documento` (medido: preenchido em 22 de 22 nativas e 4.924 de 4.924 da carga, 0.20). Sem o
// documento do C2X, ninguém passa: o erro que a regra evita é ligar o contrato de um cliente à venda de
// outro no mesmo lote (B3 dos críticos, os casos VOC0306 e VOL1106).

/** Uma proposta do terreno, no recorte que o casamento lê. */
export type PropostaCandidata = {
  canceladaEm: null | string;
  criadoEm: string;
  /** Só dígitos, EM MEMÓRIA. Vazio = não se sabe (e aí não casa). */
  documentoDoComprador: string;
  etapa: string;
  id: string;
  /**
   * A proposta DA CARGA pendurada numa linha-sombra do PAI (`espelho_de` preenchido). É a regra de
   * `situacao-da-unidade.ts`: no pai, o que a carga pendurou é reflexo; a nativa no pai vale.
   */
  noPai: boolean;
  origem: "c2x" | "panteon";
  origemC2xId: null | number;
  unidadeId: string;
};

export type CasamentoDoEnvio =
  | { propostaId: string; regra: "ar_da_carga" | "ar_da_carga_no_pai" | "nativa_do_mesmo_comprador"; unidadeId: string }
  | {
      candidata: null | {
        motivo: "ar_da_carga_com_nativa_viva" | "comprador_diferente" | "nativa_depois_do_envio";
        propostaId: string;
      };
      propostaId: null;
      regra: "sem_venda";
      unidadeId: string;
    }
  | { propostaId: null; regra: "sem_unidade"; unidadeId: null };

export type ContextoDoCasamento = {
  /** Dígitos do documento do comprador do pedido no C2X. Só lido para os candidatos às regras 2 e 3. */
  documentoDoCompradorNoC2x: null | string;
  /** A proposta com `origem_c2x_id = ar.id`, se há. */
  propostaDoAr: null | PropostaCandidata;
  /** As propostas das linhas do MESMO TERRENO (a união de lib/hercules/terreno.ts). */
  propostasDoTerreno: readonly PropostaCandidata[];
  unidade: null | { espelhoDe: null | string; id: string };
};

/** As etapas de uma venda que tem contrato (a da view `temis_contratos_do_panteon`). */
const ETAPAS_COM_CONTRATO: ReadonlySet<string> = new Set(["contrato", "assinatura", "faturado"]);

const instante = (texto: null | string): number => {
  const t = Date.parse(String(texto ?? ""));
  return Number.isNaN(t) ? Number.NaN : t;
};

function mesmoComprador(proposta: PropostaCandidata, documentoNoC2x: null | string): boolean {
  const doC2x = String(documentoNoC2x ?? "").replace(/\D/g, "");
  const doPanteon = String(proposta.documentoDoComprador ?? "").replace(/\D/g, "");
  return Boolean(doC2x) && doC2x === doPanteon;
}

/** Venda viva com contrato NO FILHO (fora da sombra do pai): o alvo da regra 2. */
function vivaComContratoNoFilho(p: PropostaCandidata): boolean {
  return !p.noPai && !p.canceladaEm && ETAPAS_COM_CONTRATO.has(p.etapa);
}

/** A nativa estava de pé NO INSTANTE do envio? (criada antes, e não cancelada até lá). */
function nativaDePeNoEnvio(p: PropostaCandidata, envioEm: number): boolean {
  if (p.origem !== "panteon") return false;
  const criada = instante(p.criadoEm);
  if (Number.isNaN(criada) || criada > envioEm) return false;
  if (!p.canceladaEm) return true;
  const cancelada = instante(p.canceladaEm);
  return !Number.isNaN(cancelada) && cancelada > envioEm;
}

const maisRecente = (lista: readonly PropostaCandidata[]): null | PropostaCandidata =>
  [...lista].sort((a, b) => instante(b.criadoEm) - instante(a.criadoEm) || b.id.localeCompare(a.id))[0] ?? null;

/**
 * Este envio chega às regras 2 ou 3, e por isso precisa do documento do comprador no C2X?
 *
 * ⚠️ É O QUE LIMITA A CONSULTA 3 A "POUCOS POR RODADA" (seção 6): só quem tem proposta do pedido na
 * sombra do pai e venda viva no filho, ou não tem proposta do pedido e tem nativa no terreno.
 */
export function precisaDoComprador(
  contexto: Omit<ContextoDoCasamento, "documentoDoCompradorNoC2x">,
): boolean {
  if (!contexto.unidade) return false;
  const { propostaDoAr, propostasDoTerreno } = contexto;
  if (propostaDoAr) {
    return propostaDoAr.noPai && propostasDoTerreno.some((p) => p.id !== propostaDoAr.id && vivaComContratoNoFilho(p));
  }
  return propostasDoTerreno.some((p) => p.origem === "panteon");
}

/** Casa um envio com a venda (seção 3). Puro: sem banco, sem rede, sem relógio. */
export function casarEnvioComAVenda(
  envio: Pick<EnvioDoC2x, "arId" | "criadoEm">,
  contexto: ContextoDoCasamento,
): CasamentoDoEnvio {
  const { documentoDoCompradorNoC2x, propostaDoAr, propostasDoTerreno, unidade } = contexto;
  if (!unidade) return { propostaId: null, regra: "sem_unidade", unidadeId: null };

  const envioEm = instante(envio.criadoEm);
  const outras = propostasDoTerreno.filter((p) => p.id !== propostaDoAr?.id);

  // ── Regras 1 e 2: o pedido tem proposta da carga ──
  if (propostaDoAr) {
    if (propostaDoAr.noPai) {
      // ⚠️ REGRA 2 SÓ COM O MESMO COMPRADOR, também na nativa do filho (M6 dos críticos: VOC, VOL e VOR
      // com a reserva da carga na sombra do VLO e a nativa viva no filho).
      const doFilho = outras.filter((p) => vivaComContratoNoFilho(p) && mesmoComprador(p, documentoDoCompradorNoC2x));
      const alvo = maisRecente(doFilho);
      if (alvo) return { propostaId: alvo.id, regra: "ar_da_carga_no_pai", unidadeId: unidade.id };
    }

    // ⚠️ A DUPLICATA DA NATIVA (seção 3, "pedido redigitado antes de 21/09 que a carga importou";
    // medido 0 em 28/09): a proposta do pedido está VIVA e o terreno tem uma nativa viva. Não se sabe de
    // qual das duas vendas é o contrato; nada é ligado e o Zeus decide antes do `--gravar`. A proposta
    // do pedido DESFEITA não entra aqui: o contrato antigo de venda cancelada é daquela venda (regra 1).
    const pedidoVivo = !propostaDoAr.canceladaEm && ETAPAS_COM_CONTRATO.has(propostaDoAr.etapa);
    const nativaViva = outras.some((p) => p.origem === "panteon" && !p.canceladaEm);
    if (pedidoVivo && nativaViva) {
      return {
        candidata: { motivo: "ar_da_carga_com_nativa_viva", propostaId: propostaDoAr.id },
        propostaId: null,
        regra: "sem_venda",
        unidadeId: unidade.id,
      };
    }

    return { propostaId: propostaDoAr.id, regra: "ar_da_carga", unidadeId: unidade.id };
  }

  // ── Regra 3: a nativa do terreno ──
  const nativas = propostasDoTerreno.filter((p) => p.origem === "panteon");
  const dePe = Number.isNaN(envioEm) ? [] : nativas.filter((p) => nativaDePeNoEnvio(p, envioEm));
  const doMesmoComprador = dePe.filter((p) => mesmoComprador(p, documentoDoCompradorNoC2x));
  const escolhida = maisRecente(doMesmoComprador);
  if (escolhida) return { propostaId: escolhida.id, regra: "nativa_do_mesmo_comprador", unidadeId: unidade.id };

  // ── Regra 4: sem venda, com a candidata que não passou ──
  // A de pé com outro comprador vem antes da criada depois: ela estava lá quando o C2X mandou.
  const outroComprador = maisRecente(dePe);
  if (outroComprador) {
    return {
      candidata: { motivo: "comprador_diferente", propostaId: outroComprador.id },
      propostaId: null,
      regra: "sem_venda",
      unidadeId: unidade.id,
    };
  }
  const depois = maisRecente(
    nativas.filter((p) => !p.canceladaEm && !Number.isNaN(envioEm) && instante(p.criadoEm) > envioEm),
  );
  if (depois) {
    return {
      candidata: { motivo: "nativa_depois_do_envio", propostaId: depois.id },
      propostaId: null,
      regra: "sem_venda",
      unidadeId: unidade.id,
    };
  }
  return { candidata: null, propostaId: null, regra: "sem_venda", unidadeId: unidade.id };
}
