// O ATENDIMENTO QUE JÁ EXISTE: resolver pelo CLIENTE e ler a conversa de verdade.
//
// Chamado TI-000137, aberto por Isac Santa Fé em 25/08/2026, impacto crítico:
// *"Não estou conseguindo enviar o script para o cliente"*. Tela `/hades/cobranca`.
//
// ⚠️ O PAINEL NUNCA CARREGAVA O ATENDIMENTO QUE JÁ EXISTIA. O `WhatsAppConversationPanel` só
// ganhava `irisTicketId` dentro de `openTicket()`, que é um POST de ABERTURA. Quem recarregava a
// página, ou entrava por um atendimento já aberto, montava o painel com `status: "Pendente"` e
// `irisTicketId: undefined`, então `operationReady` era falso, o composer ficava com o
// placeholder "Ticket incompleto" e `sendMessage()` parava no `if (!ticket.irisTicketId)`.
// O operador só conseguia falar na MESMA montagem em que tinha aberto o ticket.
//
// ⚠️ E A CHAVE É O TELEFONE DO CLIENTE, NÃO O PROTOCOLO. A primeira tentativa resolvia por
// `linkedAttendanceProtocol`, e ele vem VAZIO no caminho real: a prop `whatsAppAttendanceProtocol`
// só nasce de parâmetros de URL (`?at=`, `?atProtocol=`, `?attendanceProtocol=`) que NENHUM
// arquivo do repo gera, e o caminho alternativo lê `client.timeline`, que o servidor devolve `[]`
// (`lib/guardian/read-model.ts:560`). Medido em 23/09/2026 no banco: dos 8.180 tickets, ZERO tem
// `metadata.hadesClientId`, ZERO tem `source_context.clientId` e ZERO tem `source_module='hades'`,
// ou seja, nenhuma chave do Hades chegou a ser gravada. O que existe em 8.180 de 8.180 é o
// `contact_id`, e o contato se acha pelo telefone: dos 270 clientes da fila do Hades, 241 (89,3%)
// já têm contato na Iris com ticket, e 11 têm atendimento ABERTO agora.
//
// ⚠️ E O TELEFONE É A MESMA IDENTIDADE QUE O PAINEL JÁ USA PARA FALAR. O `sendMessage()` manda
// `to: client.dados360.telefone`. Resolver por outro campo seria inventar uma segunda identidade
// para o mesmo cliente na mesma tela.
//
// ⚠️ E RESOLVER É LEITURA, NUNCA ABERTURA. A régua da casa é um atendimento ABERTO por cliente, e
// este repo já produziu o cliente com dois cards na Iris. Por isso a resolução mora aqui, sozinha,
// e só sabe emitir GET: não existe caminho neste arquivo que abra ticket.
//
// ⚠️ E ESTA LÓGICA NÃO PODE MORAR NO PAINEL. `WhatsAppConversationPanel.tsx` começa com
// `// @ts-nocheck`, então `tsc --noEmit` não olha uma linha dele. Medido em 23/09/2026: o arquivo
// tem 2.953 linhas e nenhuma cobertura de tipo. Aqui é arquivo checado e testado.

/** Uma linha de `caredesk_messages` como a Iris grava. */
export type LinhaDeMensagemDaIris = {
  body?: null | string;
  created_at: string;
  delivery_status?: null | string;
  direction: string;
  id: string;
  message_type: string;
  sender_type: string;
  sent_at?: null | string;
};

export type AutorDaMensagem = "client" | "operator";
export type TipoDaMensagem = "audio" | "document" | "text";
export type StatusDaMensagem = "enviada" | "entregue" | "falhou" | "lida";

/** Uma mensagem no formato que o painel do Hades renderiza. */
export type MensagemDoPainel = {
  author: AutorDaMensagem;
  body: string;
  date: string;
  id: string;
  kind: TipoDaMensagem;
  operator?: string;
  status?: StatusDaMensagem;
  ticketProtocol: string;
  time: string;
};

export type StatusDoTicket =
  | "Aguardando cliente"
  | "Aguardando operador"
  | "Aguardando pagamento"
  | "Cancelado"
  | "Convertido em acordo"
  | "Convertido em promessa"
  | "Em atendimento"
  | "Encerrado"
  | "Pendente";

export type PrioridadeDoPainel = "Alta" | "Baixa" | "Crítica" | "Média";

export type LinhaDeTicketDaIris = {
  id: string;
  metadata?: unknown;
  opened_at?: null | string;
  priority?: null | string;
  profile_id?: null | string;
  protocol?: null | string;
  queue_id?: null | string;
  source_context?: unknown;
  status?: null | string;
};

export type PerfilDaIris = {
  category?: null | string;
  id: string;
  name: string;
  priority?: null | string;
  queueId?: null | string;
  slaFirstResponseMinutes?: null | number;
};

export type TicketHidratado = {
  attendanceProtocol: string;
  collectionProtocol: string;
  irisTicketId: string;
  openedAt: string;
  priority: PrioridadeDoPainel;
  profileCategory: string;
  profileId: string;
  profileName: string;
  protocol: string;
  relatedInstallments: string[];
  slaHours: number;
  status: StatusDoTicket;
};

type RespostaDaBusca = {
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
};

/**
 * O `fetch` do navegador, estreitado ao que esta função usa. Fica como parâmetro para o teste
 * conseguir provar que daqui NUNCA sai um POST.
 */
export type Buscador = (
  url: string,
  init: { cache?: string; headers?: Record<string, string>; method: string },
) => Promise<RespostaDaBusca>;

export type ResultadoDaResolucao =
  | {
      collectionProtocol: null | string;
      encontrado: true;
      mensagens: LinhaDeMensagemDaIris[];
      ticket: LinhaDeTicketDaIris;
    }
  | { encontrado: false; motivo: string };

const CAMPO_VAZIO = "-";

/** O protocolo operacional da Iris: `AT-` de atendimento, `CB-` de cobrança. */
export function protocoloOperacional(valor: unknown): null | string {
  const normalizado = String(valor ?? "").trim().toUpperCase();

  return /^(AT|CB)-\d{1,12}$/.test(normalizado) ? normalizado : null;
}

/**
 * A chave que existe de verdade no caminho real: o telefone do cliente, em dígitos, com DDI.
 *
 * ⚠️ A NORMALIZAÇÃO É A MESMA DO `normalizeWhatsAppDestination` DA ROTA, DE PROPÓSITO. Quem
 * expande o 9º dígito e as variantes sem DDI é o servidor, com o `buildBrazilianPhoneVariants`,
 * que já é a régua única de identidade do número nesta casa. Normalizar diferente aqui criaria
 * uma segunda régua para o mesmo número.
 *
 * Medido em 23/09/2026: as 25.320 linhas de `c2x_guardian_attendance_queue` guardam o telefone
 * COM máscara ("(31) 8964-7019"), 25.249 delas com 10 ou 11 dígitos e NENHUMA só com dígitos; os
 * 1.670 contatos da Iris guardam E.164 ("5531989647019") em 1.650 deles. Sem tirar a máscara,
 * nenhum dos dois lados se acha.
 */
export function telefoneDoCliente(valor: unknown): null | string {
  const digitos = String(valor ?? "").replace(/\D/g, "");

  if (digitos.length === 10 || digitos.length === 11) {
    return `55${digitos}`;
  }

  return digitos.length >= 12 && digitos.length <= 15 ? digitos : null;
}

/**
 * Encontra na Iris o atendimento de um protocolo. Só LÊ.
 *
 * ⚠️ NÃO EXISTE FALLBACK DE ABERTURA AQUI, E ISSO É DE PROPÓSITO. Protocolo que não bate devolve
 * `encontrado: false` e o painel continua trancado, que é o comportamento seguro: melhor o
 * operador não conseguir falar do que o cliente ganhar um segundo card na Iris.
 */
export async function resolverAtendimentoExistente(params: {
  buscar: Buscador;
  protocolo: unknown;
  token?: null | string;
}): Promise<ResultadoDaResolucao> {
  const protocolo = protocoloOperacional(params.protocolo);

  if (!protocolo) {
    return { encontrado: false, motivo: "Protocolo fora do formato da Iris." };
  }

  return lerAtendimento({
    buscar: params.buscar,
    token: params.token,
    url: `/api/iris/tickets?protocol=${encodeURIComponent(protocolo)}`,
  });
}

/**
 * Encontra na Iris o atendimento do CLIENTE, pelo telefone. Só LÊ.
 *
 * ⚠️ É ESTA QUE RODA NA TELA. O painel sempre tem o cliente, porque o cliente é o que ele abre;
 * o protocolo, não. Ver a nota do topo: dos 270 clientes da fila do Hades, 241 já têm contato na
 * Iris com ticket, contra ZERO tickets alcançáveis por qualquer chave do Hades.
 */
export async function resolverAtendimentoDoCliente(params: {
  buscar: Buscador;
  telefone: unknown;
  token?: null | string;
}): Promise<ResultadoDaResolucao> {
  const telefone = telefoneDoCliente(params.telefone);

  if (!telefone) {
    return { encontrado: false, motivo: "Cliente sem telefone utilizável." };
  }

  return lerAtendimento({
    buscar: params.buscar,
    token: params.token,
    url: `/api/iris/tickets?clientPhone=${encodeURIComponent(telefone)}`,
  });
}

/**
 * A porta única do painel: o protocolo quando ele existe, o telefone sempre.
 *
 * ⚠️ O TELEFONE NÃO É FALLBACK DE EXCEÇÃO, É O CAMINHO NORMAL. O protocolo fica na frente só
 * porque, quando alguém enfim gerar o deep link `?at=AT-…`, ele aponta para UM atendimento
 * específico e é mais preciso que a identidade do número. Hoje ele nunca chega preenchido.
 */
export async function resolverAtendimentoDoPainel(params: {
  buscar: Buscador;
  protocolo?: unknown;
  telefone?: unknown;
  token?: null | string;
}): Promise<ResultadoDaResolucao> {
  if (protocoloOperacional(params.protocolo)) {
    const porProtocolo = await resolverAtendimentoExistente({
      buscar: params.buscar,
      protocolo: params.protocolo,
      token: params.token,
    });

    if (porProtocolo.encontrado) {
      return porProtocolo;
    }
  }

  return resolverAtendimentoDoCliente({
    buscar: params.buscar,
    telefone: params.telefone,
    token: params.token,
  });
}

/** O que a tela faz com o atendimento que encontrou. */
export type DecisaoDoPainel = "assumir" | "so-historico";

/**
 * Atendimento ABERTO a tela assume; atendimento ENCERRADO vira só histórico.
 *
 * ⚠️ ENCERRADO NÃO DESTRAVA O ENVIO, E ISSO É DECISÃO DA TELA, NÃO ACIDENTE DE `setState`.
 * Medido em 23/09/2026: 8.163 dos 8.180 tickets estão `closed` (99,8%), contra 14
 * `waiting_customer` e 3 `waiting_operator`. Quem resolveu o atendimento encerrou o card, então
 * destravar o composer em cima do ticket fechado faria a tela oferecer, em 99,8% dos casos, um
 * canal que não existe mais: o envio sairia para um atendimento já fechado e a conversa nova
 * ficaria pendurada num ciclo encerrado.
 *
 * ⚠️ E ABRIR UM NOVO AÍ É O CAMINHO LEGÍTIMO, PORQUE A RÉGUA FALA DE ABERTO. "Um atendimento
 * aberto por cliente" não proíbe o segundo ciclo depois que o primeiro fechou; proíbe dois vivos
 * ao mesmo tempo. Por isso o encerrado devolve a conversa para leitura e deixa o formulário de
 * abertura no lugar, em vez de assumir o ticket fechado como se fosse canal.
 */
export function decidirOQuePainelFazComOAtendimento(status: unknown): DecisaoDoPainel {
  const noPainel = statusDoTicketNoPainel(status);

  return noPainel === "Encerrado" || noPainel === "Cancelado" ? "so-historico" : "assumir";
}

/** A leitura em si: um GET, e nada além de um GET. */
async function lerAtendimento(params: {
  buscar: Buscador;
  token?: null | string;
  url: string;
}): Promise<ResultadoDaResolucao> {
  const resposta = await params.buscar(params.url, {
    cache: "no-store",
    headers: params.token ? { Authorization: `Bearer ${params.token}` } : {},
    // ⚠️ GET, SEMPRE. Ver a nota do topo: resolver é encontrar, nunca criar.
    method: "GET",
  });

  const conteudo = (await resposta.json().catch(() => null)) as null | Record<string, unknown>;

  if (!resposta.ok || !conteudo) {
    const motivo =
      typeof conteudo?.error === "string"
        ? conteudo.error
        : "Nao foi possivel localizar o atendimento na Iris.";

    return { encontrado: false, motivo };
  }

  const ticket = conteudo.ticket as LinhaDeTicketDaIris | undefined;

  if (!ticket?.id) {
    return { encontrado: false, motivo: "Atendimento nao localizado na Iris." };
  }

  return {
    collectionProtocol: protocoloOperacional(conteudo.collectionProtocol),
    encontrado: true,
    mensagens: Array.isArray(conteudo.mensagens)
      ? (conteudo.mensagens as LinhaDeMensagemDaIris[])
      : [],
    ticket,
  };
}

/**
 * As mensagens de `caredesk_messages` no formato do painel.
 *
 * ⚠️ A ORDEM É `created_at`, NUNCA `sent_at`. Medido em 23/09/2026 na fila Cobrança: ordenar por
 * `sent_at` tira 2.511 mensagens do lugar, em 319 das 2.509 conversas — o provedor entrega com
 * `sent_at` defasado (as 4.906 inbound têm 100% `sent_at` ANTES do `created_at`, e 1.965 das
 * 2.148 outbound têm DEPOIS), e às vezes fora de ordem: no AT-011401 duas falas do cliente
 * chegam com 11 e 26 minutos de defasagem e trocadas entre si. E as 99 internas têm `sent_at`
 * NULO, então nem dava para ordenar por ele.
 */
export function mensagensDoAtendimento(
  linhas: LinhaDeMensagemDaIris[],
  contexto: { operador?: null | string; protocolo: string },
): MensagemDoPainel[] {
  return [...(linhas ?? [])]
    .filter((linha) => linha && linha.id)
    .sort((uma, outra) => horario(uma.created_at) - horario(outra.created_at))
    .map((linha) => {
      const doCliente = linha.direction === "inbound" || linha.sender_type === "customer";
      const quando = linha.created_at;

      return {
        author: doCliente ? "client" : "operator",
        body: linha.body ?? "",
        date: dataCurta(quando),
        id: linha.id,
        kind: tipoDaMensagem(linha.message_type),
        ...(doCliente ? {} : { operator: contexto.operador ?? undefined }),
        ...(doCliente ? {} : { status: statusDaEntrega(linha.delivery_status) }),
        ticketProtocol: contexto.protocolo,
        time: horaCurta(quando),
      } satisfies MensagemDoPainel;
    });
}

/**
 * O tipo da mensagem como o painel sabe desenhar.
 *
 * O banco grava dez tipos (medido na fila Cobrança: text, template, button, audio, document,
 * image, reaction, sticker, system, note) e o painel desenha três. `image` entra como anexo;
 * o resto que é texto entra como texto.
 */
function tipoDaMensagem(tipo: unknown): TipoDaMensagem {
  const normalizado = String(tipo ?? "").trim().toLowerCase();

  if (normalizado === "audio" || normalizado === "voice") return "audio";
  if (normalizado === "document" || normalizado === "image" || normalizado === "video") {
    return "document";
  }

  return "text";
}

/**
 * O status de entrega da mensagem.
 *
 * ⚠️ `failed` TEM QUE APARECER COMO "falhou". Medido em 23/09/2026: 183 templates da fila
 * Cobrança estão `failed`. Traduzir isso como "enviada" seria a tela afirmando uma entrega que
 * não houve, que é o mesmo defeito deste chamado, só que mais quieto.
 */
function statusDaEntrega(status: unknown): StatusDaMensagem {
  const normalizado = String(status ?? "").trim().toLowerCase();

  if (normalizado === "read") return "lida";
  if (normalizado === "delivered") return "entregue";
  if (normalizado === "failed") return "falhou";

  return "enviada";
}

/** O status da Iris no vocabulário do painel do Hades. */
export function statusDoTicketNoPainel(status: unknown): StatusDoTicket {
  const normalizado = String(status ?? "").trim().toLowerCase();

  if (normalizado === "waiting_customer") return "Aguardando cliente";
  if (normalizado === "waiting_operator") return "Aguardando operador";
  if (normalizado === "closed" || normalizado === "resolved") return "Encerrado";
  if (normalizado === "cancelled" || normalizado === "canceled") return "Cancelado";

  // ⚠️ O PADRÃO É "Em atendimento", NUNCA "Pendente". O painel calcula
  // `ticketActive = status !== "Pendente"`, e é justamente "Pendente" que tranca o composer.
  // Um ticket que a Iris devolveu EXISTE: cair em "Pendente" reabriria o defeito deste chamado.
  return "Em atendimento";
}

function prioridadeDoPainel(prioridade: unknown): PrioridadeDoPainel {
  const normalizada = String(prioridade ?? "").trim().toLowerCase();

  if (normalizada === "critical") return "Crítica";
  if (normalizada === "high") return "Alta";
  if (normalizada === "low") return "Baixa";

  return "Média";
}

/**
 * O estado do ticket no painel a partir da linha que a Iris devolveu.
 *
 * Preenche o que o `operationReady` do painel exige (perfil, prioridade, SLA e um status fora de
 * "Pendente") para o operador conseguir falar sem precisar abrir nada.
 */
export function hidratarTicketDoAtendimento(params: {
  collectionProtocol?: null | string;
  perfis: PerfilDaIris[];
  ticket: LinhaDeTicketDaIris;
}): TicketHidratado {
  const { perfis, ticket } = params;
  const perfil = perfis.find((item) => item.id && item.id === ticket.profile_id) ?? null;
  const metadata = registro(ticket.metadata);
  const contexto = registro(ticket.source_context);

  const atendimento = protocoloOperacional(ticket.protocol) ?? CAMPO_VAZIO;
  const cobranca =
    protocoloOperacional(params.collectionProtocol) ??
    protocoloOperacional(contexto.collectionProtocol) ??
    protocoloOperacional(metadata.collectionProtocol) ??
    atendimento;

  const slaMinutos = Number(perfil?.slaFirstResponseMinutes ?? 0);

  return {
    attendanceProtocol: atendimento,
    collectionProtocol: cobranca,
    irisTicketId: ticket.id,
    openedAt: ticket.opened_at ?? CAMPO_VAZIO,
    priority: prioridadeDoPainel(perfil?.priority ?? ticket.priority),
    profileCategory: perfil?.category ?? CAMPO_VAZIO,
    profileId: perfil?.id ?? String(ticket.profile_id ?? ""),
    profileName: perfil?.name ?? CAMPO_VAZIO,
    // A tela mostra a cobrança; o atendimento fica no campo próprio.
    protocol: cobranca,
    relatedInstallments: listaDeTextos(metadata.relatedInstallments),
    // SLA precisa ser > 0 para o checklist do painel fechar; sem perfil carregado, 1 hora.
    slaHours: slaMinutos > 0 ? Math.max(Math.ceil(slaMinutos / 60), 1) : 1,
    status: statusDoTicketNoPainel(ticket.status),
  };
}

function registro(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function listaDeTextos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.map((item) => String(item)).filter(Boolean) : [];
}

function horario(valor: unknown): number {
  const instante = new Date(String(valor ?? "")).getTime();

  return Number.isNaN(instante) ? 0 : instante;
}

function dataCurta(valor: unknown): string {
  const data = new Date(String(valor ?? ""));

  if (Number.isNaN(data.getTime())) return CAMPO_VAZIO;

  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function horaCurta(valor: unknown): string {
  const data = new Date(String(valor ?? ""));

  if (Number.isNaN(data.getTime())) return CAMPO_VAZIO;

  return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
