// EM QUE BALDE A UNIDADE CAI — a regra única, para a tela de Unidades e para os cards do topo.
//
// ⚠️ ELA EXISTE PORQUE AS DUAS DISCORDAVAM. Os cards eram somados em SQL e a lista era
// classificada em TypeScript, cada um com sua regra, e em 28/08/2026 o Villa Paris entregou a
// conta: 48 + 1 + 21 + 0 + 0 = 70 nos cards, com 97 unidades no total. As 27 que faltavam eram
// as de status 5 ("Bloqueado para venda"), que a lista mostrava como Bloqueado e o SQL não
// contava em balde nenhum — ele procurava status 1 COM o flag `sale_blocked` ligado.
//
// A premissa que envelheceu está escrita no topo de empreendimentos.ts: *"o status 5 está
// ZERADO no C2X: o bloqueio real é o flag"*. Era verdade quando foi escrita; o Villa Paris
// chegou com 27 unidades em status 5 e flag 0, e o resíduo virou tela mentindo.
//
// ⚠️ A ORDEM DAS PERGUNTAS É A REGRA, e ela precisa ser a MESMA nos dois lados. Por isso o SQL
// mora aqui do lado da função, e não solto na query.

export type BaldeDaUnidade =
  | "bloqueado"
  | "disponivel"
  | "negociacao"
  | "reservado"
  | "vendido";

export type SinaisDaUnidade = {
  /** Reserva viva do Prometeu, feita no salão. O C2X ainda não sabe dela. */
  reservadoNoPanteon?: boolean;
  /** `enterprise_unities.sale_blocked` — trava manual do loteador. */
  saleBlocked: boolean;
  /** 1 Disponível · 2 Reservado · 3 Em negociação · 4 Vendido · 5 Bloqueado para venda. */
  saleStatusId: null | number;
};

export const SALE_STATUS = {
  BLOQUEADO: 5,
  DISPONIVEL: 1,
  EM_NEGOCIACAO: 3,
  RESERVADO: 2,
  VENDIDO: 4,
} as const;

/**
 * A ordem, e o porquê de cada degrau:
 *
 * 1. **Vendido primeiro** — é definitivo, não vira outra coisa.
 * 2. **Em negociação** — já tem proposta andando.
 * 3. **Reservado no C2X.**
 * 4. **Reservado no salão** (Prometeu). Vem depois dos três de cima porque não pode puxar de
 *    volta um lote que já andou na esteira: a reserva do evento é o começo do funil, não o fim.
 *    Mas vem ANTES de bloqueado e de disponível, que é o que faz o lote recém-reservado no
 *    tótem parar de aparecer como livre nas telas do Apolo.
 * 5. **Bloqueado** — status 5 OU o flag. Os dois valem por si: no C2X eles costumam andar
 *    juntos, mas nada garante isso numa edição manual, e sem os dois um lote com status
 *    "Bloqueado para venda" apareceria pintado de disponível.
 * 6. **Disponível** — só o que sobrou de todas as perguntas acima.
 */
export function baldeDaUnidade(sinais: SinaisDaUnidade): BaldeDaUnidade {
  const status = sinais.saleStatusId == null ? 0 : Number(sinais.saleStatusId);
  if (status === SALE_STATUS.VENDIDO) return "vendido";
  if (status === SALE_STATUS.EM_NEGOCIACAO) return "negociacao";
  if (status === SALE_STATUS.RESERVADO) return "reservado";
  if (sinais.reservadoNoPanteon) return "reservado";
  if (status === SALE_STATUS.BLOQUEADO || sinais.saleBlocked)
    return "bloqueado";
  return "disponivel";
}

/**
 * O MESMO encadeamento, em SQL, para a agregação dos cards.
 *
 * ⚠️ Não sabe da reserva do Panteon — ela vive no Supabase e não dá para juntar numa query do
 * MySQL. Quem chama ajusta a contagem depois, em memória; ver `loadApoloEnterprises`.
 *
 * `alias` é o apelido da tabela `enterprise_unities` na query de quem chama.
 */
export function sqlDoBalde(alias: string): string {
  return `case
      when ${alias}.sale_status_id = ${SALE_STATUS.VENDIDO} then 'vendido'
      when ${alias}.sale_status_id = ${SALE_STATUS.EM_NEGOCIACAO} then 'negociacao'
      when ${alias}.sale_status_id = ${SALE_STATUS.RESERVADO} then 'reservado'
      when ${alias}.sale_status_id = ${SALE_STATUS.BLOQUEADO}
        or coalesce(${alias}.sale_blocked, 0) = 1 then 'bloqueado'
      else 'disponivel'
    end`;
}

// O TEXTO DO BADGE SAI DO BALDE, e não do nome do status no C2X.
//
// ⚠️ Foi assim que a tela ficou dizendo duas coisas ao mesmo tempo: com a reserva do salão
// entrando na regra, o RVPA09 virou "reservado" e ganhou a cor âmbar, mas o texto continuou
// vindo de `sale_statuses.name` — e o badge saiu âmbar escrito "Disponível". Cor e palavra
// precisam ter a MESMA fonte, senão uma delas mente.
const ROTULO: Record<BaldeDaUnidade, string> = {
  bloqueado: "Bloqueado",
  disponivel: "Disponível",
  negociacao: "Em negociação",
  reservado: "Reservado",
  vendido: "Vendido",
};

export function rotuloDoBalde(balde: BaldeDaUnidade): string {
  return ROTULO[balde];
}
