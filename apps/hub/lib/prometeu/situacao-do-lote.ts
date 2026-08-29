// DE QUE COR O LOTE APARECE NO TELÃO DO LANÇAMENTO.
//
// ⚠️ AQUI O PANTEON MANDA (Lucas, 28/08/2026: "agora as reservas vão nascer no panteon e do
// panteon vamos mandar para o C2X"). Fora do evento vale o contrário — a situação do lote vem
// do C2X e o Panteon reflete —, mas no salão a reserva acabou de ser feita no tótem e o telão
// precisa pintar em segundos. Esperar o C2X saber seria projetar um mapa desatualizado bem na
// frente do cliente que reservou.
//
// ⚠️ O TELÃO MOSTRA SÓ A SITUAÇÃO. Nunca nome de comprador, nunca valor — é a tela mais pública
// que existe no evento, projetada para o salão inteiro, e roda em máquina de terceiro por um
// link sem login. A lição é do Garden, onde uma página interna sem senha expôs nome e preço.
// Por isso este módulo devolve UMA palavra por lote, e nada mais.

export type SituacaoDoLote =
  | "disponivel"
  | "indisponivel"
  | "reservado"
  | "vendido";

export type SinaisDoLote = {
  /** Pedido de aquisição aberto no C2X (`acquisition_requests.open = 1`). */
  arAberta: boolean;
  /** Reserva viva deste evento no Panteon (`prometeu_reservas`, sem cancelamento). */
  reservadoNoPanteon: boolean;
  /** `enterprise_unities.sale_blocked` — trava manual do loteador. */
  saleBlocked: boolean;
  /** `enterprise_unities.sale_status_id`: 1 Disponível · 2 Reservado · 3 Em negociação · 4 Vendido · 5 Bloqueado. */
  saleStatusId: null | number;
};

const C2X_DISPONIVEL = 1;
const C2X_RESERVADO = 2;
const C2X_EM_NEGOCIACAO = 3;
const C2X_VENDIDO = 4;
const C2X_BLOQUEADO = 5;

/**
 * A ordem das perguntas É a regra, e cada degrau tem um porquê:
 *
 * 1. **Reserva do Panteon primeiro.** É o que acabou de acontecer no salão, e é o único sinal
 *    que chega em segundos. Ela ganha até de "disponível" no C2X, porque o C2X ainda não sabe.
 * 2. **Vendido é definitivo.** Não vira reserva nem volta para a prateleira durante o evento.
 * 3. **Bloqueado não é reserva de cliente** — é decisão do loteador (permuta, área
 *    institucional, lote com pendência). Fica em cinza, e não em amarelo, senão o salão lê como
 *    "alguém pegou" e cria disputa por um lote que nunca esteve à venda.
 * 4. **Reservado, em negociação ou com AR aberta** são o mesmo recado para quem olha o telão:
 *    esse lote tem dono provisório. A diferença entre eles interessa ao backoffice, não ao
 *    salão.
 * 5. **Só então disponível** — e apenas se o C2X também concordar. Status desconhecido (um id
 *    novo que alguém criar no legado amanhã) NÃO vira verde: some do mapa como indisponível,
 *    porque anunciar disponível um lote que não está é o erro caro deste tela.
 */
export function situacaoDoLote(sinais: SinaisDoLote): SituacaoDoLote {
  if (sinais.reservadoNoPanteon) return "reservado";
  if (sinais.saleStatusId === C2X_VENDIDO) return "vendido";
  if (sinais.saleBlocked || sinais.saleStatusId === C2X_BLOQUEADO)
    return "indisponivel";
  if (
    sinais.arAberta ||
    sinais.saleStatusId === C2X_RESERVADO ||
    sinais.saleStatusId === C2X_EM_NEGOCIACAO
  ) {
    return "reservado";
  }
  if (sinais.saleStatusId === C2X_DISPONIVEL) return "disponivel";
  return "indisponivel";
}

/** Quantos lotes em cada situação — o painel de números do telão. */
export function contarSituacoes(
  situacoes: Iterable<SituacaoDoLote>,
): Record<SituacaoDoLote, number> {
  const total: Record<SituacaoDoLote, number> = {
    disponivel: 0,
    indisponivel: 0,
    reservado: 0,
    vendido: 0,
  };
  for (const s of situacoes) total[s] += 1;
  return total;
}
