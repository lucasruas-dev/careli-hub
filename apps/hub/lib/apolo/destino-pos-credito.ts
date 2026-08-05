// A DECISÃO ÚNICA de "para onde vai a esteira depois do crédito". Nasceu dos 3 problemas que o
// Lucas reportou em 04/08 (Ramon Leite Gaspar, CAD no Vale do Ouro / enterprise 35):
//
//   • PROBLEMA 1 — a pré-venda estava DESLIGADA (`prevenda_habilitada=false`) e mesmo assim o
//     cliente caiu em "prevenda". A rota do Serasa já respeitava o toggle, mas o caminho MANUAL
//     (o botão "Aprovar crédito (coordenador)" do Board) hardcodava "prevenda". Com a pré-venda
//     desligada, quem é aprovado no crédito tem que ir DIRETO para "credenciado", pulando o PIX.
//
//   • PROBLEMA 2 — crédito REPROVADO não pode avançar. Reprovado mora em "revisao" e trava ali até
//     uma decisão humana; NUNCA vai sozinho para "prevenda"/"credenciado".
//
// Centralizar a regra aqui (função pura, sem banco) é o que garante que os TRÊS caminhos que
// decidem etapa — a rota do Serasa (aprovado automático), a rota do Serasa com análise desligada,
// e a aprovação com restrição da coordenação (override) — usem exatamente o mesmo critério, em vez
// de cada um reinventar o `? "prevenda" : "credenciado"` (foi essa divergência que gerou o bug).

import type { EtapaEsteira } from "@/lib/apolo/esteira";

// Para onde vai um crédito LIBERADO (aprovado no Serasa ou aprovado com restrição pela
// coordenação). Pré-venda ligada = "prevenda" (gera o PIX de R$ 1.000); desligada = "credenciado"
// direto, sem cobrança. PROBLEMA 1.
export function destinoPosCredito(prevendaHabilitada: boolean): EtapaEsteira {
  return prevendaHabilitada ? "prevenda" : "credenciado";
}

// A etapa que a esteira recebe a partir do VEREDITO do crédito + o toggle da pré-venda.
// Reprovado NUNCA avança: vai para "revisao" e trava até a coordenação decidir (PROBLEMA 2).
// Aprovado segue pelo toggle (PROBLEMA 1). É a decisão que a rota do Serasa aplica no gatilho
// automático — extraída para cá para ser a mesma regra testável do override.
export function proximaEtapaCredito(input: {
  aprovado: boolean;
  prevendaHabilitada: boolean;
}): EtapaEsteira {
  if (!input.aprovado) return "revisao";
  return destinoPosCredito(input.prevendaHabilitada);
}
