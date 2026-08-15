// AS DUAS CENTRAIS DA IRIS — o recorte de topo da tela.
//
// Pedido do Lucas (15/08/2026): "eu queria uma aba geral que separa Atendimento de
// Relacionamento, aplicaria as mesma estrutura, somente a separação".
//
// A regra do arquivo é essa última frase: a central NÃO é uma tela nova, é um FILTRO
// aplicado nos dados antes de qualquer view. Board, Histórico, E-mail, Disparos e
// Relatórios continuam iguais e passam a enxergar só a fatia da central escolhida.
//
// ⚠️ QUEM VÊ QUAL CENTRAL JÁ ESTÁ RESOLVIDO, e de graça: `IrisData.queues` chega aqui
// já filtrado por `canSeeResource` (iris-data-client.ts:132). Então a central que a
// pessoa enxerga é DERIVADA das filas que ela enxerga. Quando o Lucas vincular as filas
// novas no Setup, o seletor se ajusta sozinho, sem vínculo novo e sem migration.

import type { IrisCentral, IrisData, IrisQueueConfig } from "../types/iris-types";

export type IrisCentralSelecionada = IrisCentral | "todas";

export const IRIS_CENTRAL_LABEL: Record<IrisCentralSelecionada, string> = {
  atendimento: "Central de Atendimento",
  relacionamento: "Central de Relacionamento",
  todas: "Todas as centrais",
};

// Rótulo curto, para caber na sidebar sem quebrar linha.
export const IRIS_CENTRAL_LABEL_CURTO: Record<IrisCentralSelecionada, string> = {
  atendimento: "Atendimento",
  relacionamento: "Relacionamento",
  todas: "Todas",
};

export const IRIS_CENTRAL_DESCRICAO: Record<IrisCentralSelecionada, string> = {
  atendimento: "O cliente final",
  relacionamento: "Corretor, imobiliaria e parceiro",
  todas: "As duas centrais juntas",
};

// Fila SEM central mapeada entra em qualquer recorte. É deliberado: uma fila criada
// depois da 0087 não pode fazer o ticket sumir das duas visões, ou seja, da tela de
// todo mundo. A trava da migration cobre o passado; isto cobre o futuro.
export function filaEhDaCentral(
  fila: IrisQueueConfig,
  central: IrisCentralSelecionada,
): boolean {
  if (central === "todas") {
    return true;
  }

  return fila.central === central || fila.central === null;
}

// As centrais que ESTA pessoa pode ver, na ordem em que aparecem no seletor.
// Só oferece "Todas" para quem tem filas nas duas: para quem tem uma só, o seletor
// some da tela em vez de virar um controle de uma opção.
export function centraisDisponiveis(
  filas: IrisQueueConfig[],
): IrisCentralSelecionada[] {
  const tem = new Set(filas.map((fila) => fila.central).filter(Boolean));
  const centrais: IrisCentralSelecionada[] = [];

  if (tem.has("atendimento")) {
    centrais.push("atendimento");
  }
  if (tem.has("relacionamento")) {
    centrais.push("relacionamento");
  }

  return centrais.length > 1 ? ["todas", ...centrais] : centrais;
}

// Se a central persistida não existe mais para esta pessoa (perdeu acesso, ou o Lucas
// remapeou a fila no Setup), cai na primeira disponível em vez de mostrar tela vazia.
export function centralValida(
  escolhida: IrisCentralSelecionada,
  disponiveis: IrisCentralSelecionada[],
): IrisCentralSelecionada {
  if (disponiveis.length === 0) {
    return "todas";
  }

  return disponiveis.includes(escolhida) ? escolhida : disponiveis[0]!;
}

// O RECORTE. Filtra filas e tickets; o resto de `IrisData` passa intacto de propósito:
// canais, departamentos, setores, perfis e templates são catálogo, não fila de trabalho.
// Broadcast fica inteiro porque disparo é por template e número, não por central.
export function recortarDadosPorCentral(
  data: IrisData,
  central: IrisCentralSelecionada,
): IrisData {
  if (central === "todas") {
    return data;
  }

  const queues = data.queues.filter((fila) => filaEhDaCentral(fila, central));
  // Casa por SLUG, não por id: é o que o ticket carrega (`IrisTicket.queueSlug`).
  const slugsVisiveis = new Set(queues.map((fila) => fila.slug));

  return {
    ...data,
    queues,
    // Ticket sem fila entra: é ticket órfão, e escondê-lo aqui seria enterrar um
    // problema de dado atrás de um filtro de tela.
    tickets: data.tickets.filter(
      (ticket) => !ticket.queueSlug || slugsVisiveis.has(ticket.queueSlug),
    ),
  };
}
