import type { PassoDaUnidade } from "./reservas-c2x";
import { passoEhSaida } from "./reservas-c2x";
import type { PrometeuPassoJornada } from "./types";

// O CICLO DAS UNIDADES DENTRO DA JORNADA DO CLIENTE.
//
// A ficha mostrava só o caminho da pessoa pelo salão (check-in, negociação, secretaria,
// finalizado). Faltava o que ela veio fazer aqui: qual lote pegou, se devolveu, se trocou por
// outro. Pedido do Lucas (22/08, evento rodando): *"essa AA Maria reservou uma unidade, só que
// ela devolveu... eu preciso apontar isso na ficha dela que ela reservou e teve um cancelamento.
// Mas temos caso da pessoa devolver a PA e pegar outra, então esse histórico temos que ter"*.
//
// ⚠️ O dado vem de `acquisition_request_historics` no C2X, e NÃO do estado atual do pedido: a
// linha do pedido guarda só onde ele parou. A RVPD14 da Ana Maria aparece hoje como "Cancelado"
// e ponto — sem contar que houve uma reserva antes. Quem sabe da passagem é o histórico.

// Como cada etapa do C2X é dita na ficha. O texto é para o coordenador ler no meio do salão.
const TITULO_POR_ETAPA: Record<string, string> = {
  Cancelado: "Devolveu a unidade",
  "Contrato gerado": "Contrato gerado",
  Distratado: "Distrato",
  "Em assinatura": "Em assinatura",
  "Em distrato": "Em distrato",
  Faturado: "Faturado",
  Finalizado: "Venda finalizada",
  "Proposta realizada": "Proposta",
  Reprovado: "Reprovado no crédito",
  "Reprovado análise de crédito": "Reprovado no crédito",
  Reservado: "Reservou a unidade",
  "Análise de crédito": "Em análise de crédito",
};

function tituloDoPasso(passo: PassoDaUnidade): string {
  const base = TITULO_POR_ETAPA[passo.para] ?? passo.para;
  return `${base} · ${passo.unidade}`;
}

// A linha de baixo do passo: quem mexeu e por quê. Vazia quando o C2X não registrou nenhum dos
// dois — melhor não inventar texto do que encher a ficha de ruído.
function detalheDoPasso(passo: PassoDaUnidade): null | string {
  const partes: string[] = [];
  if (passo.de) partes.push(`de ${passo.de}`);
  if (passo.motivo) partes.push(passo.motivo);
  if (passo.operador) partes.push(`por ${passo.operador}`);
  return partes.length > 0 ? partes.join(" · ") : null;
}

export function passosDasUnidades(passos: PassoDaUnidade[]): PrometeuPassoJornada[] {
  return passos.map((passo) => ({
    // Devolução/reprovação acende a bolinha vermelha, igual ao cancelamento do salão.
    cancelado: passoEhSaida(passo),
    detalhe: detalheDoPasso(passo),
    quando: passo.em || null,
    titulo: tituloDoPasso(passo),
  }));
}

// Junta o caminho da PESSOA (salão) com o das UNIDADES (C2X) numa linha do tempo só.
//
// ⚠️ Ordena pelo relógio, e não por origem, senão a ficha conta a história fora de ordem: a
// reserva do Antonio (09:25) tem que aparecer entre o check-in dele (09:13) e a conclusão
// (10:09). Passo sem hora vai para o fim — não dá para posicionar sem carimbo, e jogá-lo no
// começo fingiria uma precedência que não existe.
export function mesclarJornada(
  daPessoa: PrometeuPassoJornada[],
  dasUnidades: PrometeuPassoJornada[],
): PrometeuPassoJornada[] {
  const todos = [...daPessoa, ...dasUnidades];
  return todos
    .map((passo, indice) => ({ indice, passo }))
    .sort((a, b) => {
      const ta = a.passo.quando ? Date.parse(a.passo.quando) : Number.NaN;
      const tb = b.passo.quando ? Date.parse(b.passo.quando) : Number.NaN;
      const va = Number.isNaN(ta);
      const vb = Number.isNaN(tb);
      if (va && vb) return a.indice - b.indice;
      if (va) return 1;
      if (vb) return -1;
      // Empate de horário mantém a ordem de entrada: o passo do salão vem antes do da unidade,
      // que é a leitura natural ("sentou e então reservou").
      return ta === tb ? a.indice - b.indice : ta - tb;
    })
    .map((item) => item.passo);
}
