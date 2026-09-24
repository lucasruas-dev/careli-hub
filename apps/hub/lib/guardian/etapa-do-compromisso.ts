// A ETAPA DO WORKFLOW OPERACIONAL, EM UM LUGAR SÓ — pura, sem banco e sem tela.
//
// ⚠️ PROMESSA VENCIDA VOLTA A ACIONAR PELO FATO, E O FATO É A DATA (Nívea, 24/09/2026): *"Erro no
// processo. O comprador fez promessa e não pagou. Deve voltar para o status de acionar."* Até aqui
// a etapa saía de kind+status+approval_status e `promised_date` NEM ENTRAVA NO SELECT
// (compromissos.ts:955-961), então uma promessa vencida há 6 dias seguia escrita como "Promessa de
// pagamento / Aguardar a data prometida". Medido em 24/09/2026: 59 compromissos, `broken_at` NULO
// em 59, `status='quebrado'` em 0, 3 promessas vencidas e vivas (R$ 7.825,27), e a tal régua com
// `sent_at` nulo em 100% dos lembretes. A etapa é DERIVADA, não gravada: sem rotina nova, sem rota
// nova e sem segredo novo; e porque 394 de 397 parcelas em aberto estão sem `payment_c2x_id`, a
// frase manda conferir o pagamento em vez de afirmar calote.
//
// ⚠️ E ELA É UMA PEÇA SÓ PORQUE A FILA E O DETALHE LEEM A MESMA COISA. A derivação vivia duplicada
// em `compromissos.ts` (a fila) e em `ClientDetailPanel.tsx` (o detalhe), palavra por palavra, de
// propósito: as duas telas têm de bater. Duplicada, qualquer conserto num lado faria as duas
// divergirem — que é pior do que o defeito que se estava consertando.

import { hojeNaCasa } from "@/lib/guardian/hoje-na-casa";

/** Uma linha de `guardian_compromissos`, no recorte de que a etapa precisa. */
export type LinhaDaEtapa = {
  /** `em_elaboracao` | `pendente` | `aprovado` | `reprovado`. */
  approvalStatus: null | string;
  /**
   * O carimbo humano da aprovação.
   *
   * ⚠️ NULO NÃO QUER DIZER "NÃO APROVADO". A PROMESSA nasce com `approval_status='aprovado'` e
   * `approved_at` NULO de propósito (`aprovacao-da-proposta.ts:36-57`): ninguém decidiu nada, e é
   * essa diferença que a régua usa para NÃO mandar WhatsApp que ninguém conferiu
   * (`podeDispararLembrete`, :80-83). Aqui ele serve para não prometer, na tela, uma régua que
   * nunca vai disparar.
   */
  approvedAt?: null | string;
  kind: string;
  /** `YYYY-MM-DD`. A data que o comprador prometeu. */
  promisedDate?: null | string;
  status: string;
};

export type EtapaDoCompromisso = { nextAction: string; stage: string };

/**
 * Uma linha como o DETALHE do cliente a tem (`ClientDetailPanel`), antes de virar `LinhaDaEtapa`.
 *
 * ⚠️ ELA EXISTE PARA O `map` DO DETALHE SAIR DE DENTRO DO `@ts-nocheck`. `ClientDetailPanel.tsx`
 * tem `// @ts-nocheck` na linha 2, então o `tsc` não cobre nada escrito lá: um campo trocado no
 * mapeamento (`promisedDate` virando `promised_date`, por exemplo) passaria calado e a etapa do
 * detalhe voltaria a dizer "Promessa de pagamento" para promessa vencida, que é o defeito de
 * 24/09/2026 exatamente de volta.
 */
export type ItemDoDetalhe = {
  approvalStatus?: null | string;
  approvedAt?: null | string;
  kind?: null | string;
  promisedDate?: null | string;
  status?: null | string;
};

/** O recorte do detalhe traduzido para o que a etapa entende. */
export function linhasDaEtapaDoDetalhe(
  items: readonly ItemDoDetalhe[],
): LinhaDaEtapa[] {
  return items.map((item) => ({
    approvalStatus: item.approvalStatus ?? null,
    approvedAt: item.approvedAt ?? null,
    kind: item.kind ?? "",
    promisedDate: item.promisedDate ?? null,
    status: item.status ?? "",
  }));
}

/** "18/09" — o pedaço da data que cabe numa frase de próxima ação. */
function diaEMes(data: string): string {
  const [ano, mes, dia] = data.split("-");
  return ano && mes && dia ? `${dia}/${mes}` : data;
}

/**
 * A etapa e a próxima ação de UM cliente, a partir dos compromissos dele.
 *
 * A ordem dos ramos é a mesma de sempre — acordo aprovado, promessa aprovada, pendente, quebrado —
 * e ela não muda: um acordo vivo é o que manda, mesmo que exista promessa vencida ao lado. O que
 * mudou é o ramo da promessa, que agora pergunta a data.
 */
export function etapaDoCompromisso(
  linhas: readonly LinhaDaEtapa[],
  // ⚠️ O DIA É O DE BRASÍLIA, E NÃO O DE GREENWICH. Com `toISOString()` aqui, das 21h à meia-noite
  // a promessa que vence HOJE já era lida como vencida e o comprador entrava na fila de acionar
  // três horas antes do prazo que ele combinou — todo dia, para toda promessa do dia. A conta mora
  // em `hoje-na-casa.ts` e é a MESMA de `todayDateOnly`, que manda na régua de lembretes.
  hoje: string = hojeNaCasa(),
): EtapaDoCompromisso | null {
  if (!Array.isArray(linhas) || linhas.length === 0) return null;

  const ativos = linhas.filter((linha) => linha.status === "ativo");
  const temAcordoAprovado = ativos.some(
    (linha) => linha.kind === "acordo" && linha.approvalStatus === "aprovado",
  );
  const promessasAprovadas = ativos.filter(
    (linha) => linha.kind === "promessa" && linha.approvalStatus === "aprovado",
  );
  const temPendente = ativos.some((linha) => linha.approvalStatus === "pendente");
  const temQuebrado = linhas.some((linha) => linha.status === "quebrado");

  if (temAcordoAprovado) {
    return {
      nextAction: "Acompanhar o pagamento das parcelas do acordo.",
      stage: "Acordo",
    };
  }

  if (promessasAprovadas.length > 0) {
    const datas = promessasAprovadas.map((linha) => (linha.promisedDate ?? "").slice(0, 10));
    // ⚠️ SEM DATA NÃO HÁ FATO PARA AFIRMAR: promessa sem `promised_date` continua sendo promessa.
    // Chamar de vencida o que não tem prazo seria acusar por falta de dado.
    const vencidas = datas.filter((data) => data !== "" && data < hoje).sort();
    // ⚠️ UMA PROMESSA VIVA SEGURA A ETAPA. Se o cliente prometeu de novo para daqui a três dias,
    // há o que esperar: acionar agora seria cobrar quem acabou de combinar.
    //
    // ⚠️ E VIVA É A QUE TEM DATA NO FUTURO, NÃO "A QUE NÃO ESTÁ VENCIDA". A conta era
    // `aprovadas.length > vencidas.length`, e por ela a promessa SEM data contava como viva: uma
    // promessa sem prazo segurava indefinidamente a etapa da promessa vencida do MESMO cliente, e
    // o cliente nunca voltava para "A acionar" nem reentrava na fila diária. Medido em
    // 24/09/2026: 10 promessas ativas aprovadas, 0 sem data — o risco é futuro, e o campo é
    // opcional (`compromissos.ts:454-456` cai para a primeira parcela, que pode não existir).
    const vivas = datas.filter((data) => data !== "" && data >= hoje);

    if (vivas.length === 0 && vencidas.length > 0) {
      // A MAIS RECENTE das vencidas: é a última coisa que o comprador prometeu, e é a data que ele
      // vai reconhecer quando o operador ligar.
      const ultima = vencidas[vencidas.length - 1] ?? "";
      return {
        nextAction:
          `Promessa vencida em ${diaEMes(ultima)} sem baixa registrada. ` +
          "Confirmar o pagamento no C2X e retomar o contato.",
        stage: "A acionar",
      };
    }

    // ⚠️ SÓ PROMETE RÉGUA QUEM TEM RÉGUA. Promessa sem `approved_at` nunca dispara lembrete (a
    // trava de `podeDispararLembrete`), então mandar "aguardar a régua" ali seria mandar esperar
    // uma mensagem que não sai.
    const temCarimbo = promessasAprovadas.some((linha) => Boolean(linha.approvedAt));
    return {
      nextAction: temCarimbo
        ? "Aguardar a data prometida (régua de lembretes)."
        : "Aguardar a data prometida e confirmar o pagamento no C2X.",
      stage: "Promessa de pagamento",
    };
  }

  if (temPendente) {
    return {
      nextAction: "Proposta registrada aguardando aprovação do gestor.",
      stage: "Negociação",
    };
  }

  if (temQuebrado) {
    return {
      nextAction: "Acordo quebrado, reabrir negociação.",
      stage: "Quebra",
    };
  }

  return null;
}
