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

// A ORDEM das centrais na tela (pedido do Lucas: "Atendimento - Relacionamento - Gurgel").
// Vive aqui e não espalhada pelos componentes, para a barra de abas e o Setup não divergirem.
export const IRIS_CENTRAIS: IrisCentral[] = [
  "atendimento",
  "relacionamento",
  "gurgel",
];

export const IRIS_CENTRAL_LABEL: Record<IrisCentralSelecionada, string> = {
  atendimento: "Central de Atendimento",
  gurgel: "Central Gurgel",
  relacionamento: "Central de Relacionamento",
  todas: "Todas as centrais",
};

// Rótulo curto, para caber na barra de abas sem quebrar linha.
export const IRIS_CENTRAL_LABEL_CURTO: Record<IrisCentralSelecionada, string> = {
  atendimento: "Atendimento",
  gurgel: "Gurgel",
  relacionamento: "Relacionamento",
  todas: "Todas",
};

// "Parceiro" saiu do Relacionamento e a Gurgel virou "Comercial" (Lucas, 15/08). Faz sentido
// junto: o parceiro que morava no Relacionamento ERA a Gurgel, e ela agora tem central própria.
export const IRIS_CENTRAL_DESCRICAO: Record<IrisCentralSelecionada, string> = {
  atendimento: "O cliente final",
  gurgel: "Comercial",
  relacionamento: "Corretor e imobiliaria",
  todas: "Todas as centrais juntas",
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
  // Percorre IRIS_CENTRAIS (e não o Set) para a ordem na tela ser sempre a mesma,
  // independente da ordem em que as filas voltaram do banco.
  const centrais: IrisCentralSelecionada[] = IRIS_CENTRAIS.filter((central) =>
    tem.has(central),
  );

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

// Não lidas de CADA central, para a aba mostrar movimento do lado que a pessoa não está vendo.
// ⚠️ Recebe o `IrisData` BRUTO de propósito: com o dado já recortado, a outra central seria
// sempre 0 e a aba nunca acenderia.
export function naoLidasPorCentral(
  dataBruto: IrisData,
  centrais: IrisCentralSelecionada[],
): Partial<Record<IrisCentralSelecionada, number>> {
  const contagem: Partial<Record<IrisCentralSelecionada, number>> = {};

  for (const central of centrais) {
    const slugs = new Set(
      dataBruto.queues
        .filter((fila) => filaEhDaCentral(fila, central))
        .map((fila) => fila.slug),
    );

    contagem[central] = dataBruto.tickets.filter(
      (ticket) =>
        ticket.unread &&
        (central === "todas" || !ticket.queueSlug || slugs.has(ticket.queueSlug)),
    ).length;
  }

  return contagem;
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

// ── ABRIR UM ATENDIMENTO QUE ESTÁ EM OUTRA CENTRAL ───────────────────────────
//
// Chamado TI-000126: *"quando tento abrir novamente, diz que já tem um ticket aberto, mas não
// aparece a conversa"*.
//
// ⚠️ A RECUSA ENXERGA MAIS DO QUE A TELA. A rota que barra o segundo atendimento procura o ticket
// aberto do contato SEM recorte nenhum (`tickets/route.ts`), enquanto a lista da tela passa por
// duas peneiras: a régua de acesso (fila do seu departamento) e a CENTRAL aberta, aqui em cima.
// Quando o ticket existente cai fora de uma das duas, a pessoa recebe "Cliente já está em
// atendimento", clica em "Abrir o atendimento existente" e não encontra a conversa.
//
// Medido no banco em 21/09/2026: 548 atendimentos abertos na central de Atendimento e 10 na de
// Relacionamento — qualquer um deles fica invisível para quem está na outra aba.
export type DestinoDoTicket =
  | { tipo: "esta_aqui" }
  | { tipo: "outra_central"; central: IrisCentralSelecionada }
  | { tipo: "fora_do_alcance" };

/**
 * Onde está o atendimento que a pessoa quer abrir, do ponto de vista da tela dela.
 *
 * Recebe os dados BRUTOS (antes do recorte por central), que já vêm filtrados por permissão: é
 * assim que dá para separar "está na outra aba" de "não é seu".
 */
export function ondeAbrirOTicket(
  ticketId: null | string,
  dataBruto: IrisData,
  centralAtual: IrisCentralSelecionada,
): DestinoDoTicket {
  if (!ticketId) return { tipo: "esta_aqui" };

  const ticket = dataBruto.tickets.find((item) => item.id === ticketId);
  // Não está nem no bruto: a fila dele é de um departamento que não é o desta pessoa.
  if (!ticket) return { tipo: "fora_do_alcance" };

  const fila = dataBruto.queues.find((item) => item.slug === ticket.queueSlug);
  // Ticket órfão (sem fila) aparece em qualquer recorte — ver `recortarDadosPorCentral`.
  if (!ticket.queueSlug || !fila) return { tipo: "esta_aqui" };

  if (filaEhDaCentral(fila, centralAtual)) return { tipo: "esta_aqui" };

  // ⚠️ SÓ MANDA TROCAR PARA UMA CENTRAL QUE ELA TEM. Se a fila do ticket não pertence a nenhuma
  // central que a pessoa enxerga, trocar a aba deixaria a tela vazia do mesmo jeito.
  const central = fila.central;
  const disponiveis = centraisDisponiveis(dataBruto.queues);
  return central && disponiveis.includes(central)
    ? { central, tipo: "outra_central" }
    : { tipo: "fora_do_alcance" };
}
