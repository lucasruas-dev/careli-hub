import type { PrometeuCredenciado, PrometeuEtapa } from "./types";

// As etapas que contam como "em atendimento" (salão + secretaria) nos KPIs do dia.
export const ETAPAS_EM_ATENDIMENTO: PrometeuEtapa[] = [
  "negociacao",
  "reserva",
  "secretaria",
  "proposta",
  "pagamento",
];

export type KpisDoEvento = {
  concluidos: number;
  conversao: number | null;
  emAtendimento: number;
  presentes: number;
  tempoMedio: number | null;
  total: number;
};

// KPIs do dia, calculados sobre a fila. FONTE ÚNICA para a Central (cockpit no PC) e a Gestão
// (mobile) mostrarem os MESMOS números — o mesmo evento com contagens diferentes em telas
// diferentes confundiria o coordenador.
export function calcularKpisDoEvento(credenciados: PrometeuCredenciado[]): KpisDoEvento {
  // Quem já fez check-in (está ou passou pelo evento).
  const presentesTodos = credenciados.filter((c) => c.entrouEm !== null);
  // "Presentes agora" = quem está no evento NESTE momento: concluído/cancelado já foi embora.
  const presentes = presentesTodos.filter(
    (c) => c.etapa !== "concluido" && c.etapa !== "cancelado",
  );
  const emAtendimento = presentesTodos.filter((c) =>
    ETAPAS_EM_ATENDIMENTO.includes(c.etapa),
  ).length;
  const concluidos = credenciados.filter((c) => c.etapa === "concluido");

  // Entrada → conclusão. NÃO usa `agora`: senão uma venda de 1h "inflaria" sozinha ao longo do dia.
  const tempos = concluidos
    .filter((c) => c.entrouEm)
    .map((c) => new Date(c.etapaDesde).getTime() - new Date(c.entrouEm as string).getTime())
    .filter((ms) => ms >= 0);
  const medio = tempos.length ? tempos.reduce((soma, t) => soma + t, 0) / tempos.length : null;

  // Conversão sobre quem PASSOU pelo evento (não sobre quem está agora), senão despencaria a cada
  // leva de check-ins.
  const base = presentesTodos.length;
  return {
    concluidos: concluidos.length,
    conversao: base > 0 ? Math.round((concluidos.length / base) * 100) : null,
    emAtendimento,
    presentes: presentes.length,
    tempoMedio: medio,
    total: credenciados.length,
  };
}
