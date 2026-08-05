// PARA ONDE A ESTEIRA VAI DEPOIS DO CRÉDITO — a regra única, pura e testável.
//
// Nasceu dos 3 problemas que o Lucas reportou em 04/08 (CAD do Ramon no VLO):
//
//   • PROBLEMA 1 — a pré-venda estava DESLIGADA no empreendimento (`prevenda_habilitada=false`)
//     e mesmo assim o cliente caiu na etapa `prevenda`. Com a pré-venda desligada, quem é
//     aprovado no crédito tem que ir DIRETO para `credenciado`, pulando a cobrança PIX.
//
//   • PROBLEMA 2 — o crédito foi REPROVADO e a ficha avançou para `prevenda` do mesmo jeito.
//     Reprovado NÃO avança: fica em `revisao`, travado, aguardando decisão humana (a coordenação).
//
// Antes, a decisão de destino vivia repetida no `serasa/consultar` (duas vezes) e teria que ser
// repetida de novo no override da coordenação. Repetir a regra é como ela se contradiz — por isso
// mora aqui, num lugar só, e todo caminho que "resolve o crédito" chama esta função.

import type { EtapaEsteira } from "@/lib/apolo/esteira";

// Próxima etapa depois de uma decisão de crédito (consulta ao Serasa OU aprovação por override
// da coordenação). `prevendaHabilitada` vem do empreendimento (`apolo_enterprise_settings`), com
// default TRUE quando não há empreendimento resolvido — mantém o comportamento histórico (com PIX).
export function destinoAposCredito(input: {
  aprovado: boolean;
  prevendaHabilitada: boolean;
}): EtapaEsteira {
  // PROBLEMA 2: reprovado trava em `revisao`. Nunca `prevenda`, nunca `credenciado`. Só a
  // coordenação, pelo caminho de override (com evidência), tira daqui.
  if (!input.aprovado) return "revisao";
  // PROBLEMA 1: aprovado segue para a pré-venda SE ela estiver ligada; desligada, pula a cobrança
  // e vai direto para `credenciado`.
  return input.prevendaHabilitada ? "prevenda" : "credenciado";
}
