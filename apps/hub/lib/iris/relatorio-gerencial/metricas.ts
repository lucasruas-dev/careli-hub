// OS NÚMEROS DO RELATÓRIO — camada pura, que é onde as armadilhas de medição moram.
//
// Nada aqui toca banco: entra a lista de tickets e de mensagens da janela, sai o que o e-mail
// mostra. É assim que dá para provar, em teste, que a conta continua sendo a mesma que a sessão de
// dados validou contra a produção em 17/09/2026.
//
// ⚠️ 1. `caredesk_tickets.first_responded_at` NÃO SERVE. Ele só é preenchido na Central de
// Relacionamento; nas outras filas fica nulo mesmo quando houve resposta em dois minutos. Quem
// mede o tempo de resposta aqui são as MENSAGENS: da mensagem do cliente até a próxima nossa no
// mesmo ticket.
//
// ⚠️ 2. A CACÁ NÃO É UMA FILA. Ela é `caredesk_tickets.metadata->>'handlingOwner' = 'caca'` dentro
// da fila Atendimento. Por isso ela aparece como uma LINHA a mais no quadro por fila, e os
// atendimentos dela continuam contados no Atendimento: são os mesmos tickets, vistos por outro
// corte. Somar as quatro linhas dá mais do que o total do dia, e isso é de propósito.
//
// ⚠️ 3. O BACKLOG DO ATENDIMENTO PRECISA DE CLASSIFICAÇÃO. A fila mostra 83 pendências e 59 são
// newsletter da Asaas e da Clicksign e relatório automático do próprio domínio, que entram pelo
// canal de e-mail e viram protocolo. Publicar 83 denuncia um problema que não existe e esconde os
// 15 clientes que estão mesmo esperando.

export const FILAS_DO_RELATORIO = ["Atendimento", "Cobrança", "Central de Relacionamento"] as const;

export type MensagemDaJanela = {
  criadoEm: string;
  daCaca: boolean;
  direcao: string;
  entrega: null | string;
  /** O código de erro da Meta, quando a entrega falhou (`131026`, `131047`). */
  erroCodigo: null | string;
  fila: string;
  /**
   * O texto da mensagem, cortado na leitura.
   *
   * ⚠️ SÓ A LEITURA DO DIA USA ISTO. Nenhum número do relatório sai do texto — contar por palavra
   * é como se inventa estatística. Ver `leitura.ts`.
   */
  texto?: null | string;
  ticketId: string;
  tipo: null | string;
  usuarioId: null | string;
};

export type TicketDaJanela = {
  abertoEm: null | string;
  /** O nome do cliente, para a leitura do dia citar quem estava do outro lado. */
  cliente?: null | string;
  daCaca: boolean;
  fechadoEm: null | string;
  fila: string;
  id: string;
  /** `AT-014375` — é por ele que a Nívea acha a conversa no painel. */
  protocolo?: null | string;
};

export type LinhaDaFila = {
  abertos: number;
  audioPercentual: null | number;
  fechados: number;
  fila: string;
  medianaMinutos: null | number;
  piorCasoMinutos: null | number;
};

export type ResumoDoDia = {
  abertos: number;
  fechados: number;
  medianaMinutos: null | number;
  mensagensEntrada: number;
  mensagensSaida: number;
  recadosRespondidos: number;
  recadosRecebidos: number;
};

const ENTRADA = "inbound";
const SAIDA = "outbound";

/** Mensagem que conta como conversa: recado interno e evento de sistema ficam de fora. */
function ehConversa(m: MensagemDaJanela): boolean {
  return m.direcao === ENTRADA || m.direcao === SAIDA;
}

/**
 * Os pares recado → resposta.
 *
 * ⚠️ A RESPOSTA PODE ESTAR FORA DA JANELA, e ignorar isso inventaria demora: um recado das 18h25
 * respondido às 18h40 apareceria como "sem resposta". Por isso quem chama passa TODAS as mensagens
 * do dia e a janela recorta só os RECADOS que entram na conta.
 */
export function paresDeResposta(
  mensagens: MensagemDaJanela[],
  janela: { fim: Date; inicio: Date },
): Array<{ fila: string; minutos: null | number; ticketId: string }> {
  const porTicket = new Map<string, MensagemDaJanela[]>();
  for (const m of mensagens) {
    if (!ehConversa(m)) continue;
    const lista = porTicket.get(m.ticketId);
    if (lista) lista.push(m);
    else porTicket.set(m.ticketId, [m]);
  }

  const pares: Array<{ fila: string; minutos: null | number; ticketId: string }> = [];

  for (const [ticketId, lista] of porTicket) {
    const ordenada = [...lista].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    for (const [indice, m] of ordenada.entries()) {
      if (m.direcao !== ENTRADA) continue;
      const quando = new Date(m.criadoEm);
      if (quando < janela.inicio || quando > janela.fim) continue;

      const resposta = ordenada.slice(indice + 1).find((outra) => outra.direcao === SAIDA);
      pares.push({
        fila: m.fila,
        minutos: resposta
          ? (new Date(resposta.criadoEm).getTime() - quando.getTime()) / 60_000
          : null,
        ticketId,
      });
    }
  }

  return pares;
}

/** A mediana de uma lista de números. `null` quando não há nenhum. */
export function mediana(valores: number[]): null | number {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 === 1
    ? (ordenados[meio] ?? null)
    : ((ordenados[meio - 1] ?? 0) + (ordenados[meio] ?? 0)) / 2;
}

export function resumoDoDia(
  tickets: TicketDaJanela[],
  mensagens: MensagemDaJanela[],
  janela: { fim: Date; inicio: Date },
): ResumoDoDia {
  const naJanela = (valor: null | string) => {
    if (!valor) return false;
    const quando = new Date(valor);
    return quando >= janela.inicio && quando <= janela.fim;
  };

  const daJanela = mensagens.filter((m) => ehConversa(m) && naJanela(m.criadoEm));
  const pares = paresDeResposta(mensagens, janela);
  const tempos = pares.map((p) => p.minutos).filter((v): v is number => v !== null);

  return {
    abertos: tickets.filter((t) => naJanela(t.abertoEm)).length,
    fechados: tickets.filter((t) => naJanela(t.fechadoEm)).length,
    medianaMinutos: mediana(tempos),
    mensagensEntrada: daJanela.filter((m) => m.direcao === ENTRADA).length,
    mensagensSaida: daJanela.filter((m) => m.direcao === SAIDA).length,
    recadosRecebidos: pares.length,
    recadosRespondidos: tempos.length,
  };
}

/**
 * O quadro por fila, com a CACÁ como quarta linha.
 *
 * `audioPercentual` é sobre as respostas NOSSAS: é o indicador do relatório de 17/09 ("metade do
 * que a Central combinou hoje não existe em texto").
 */
export function desempenhoPorFila(
  tickets: TicketDaJanela[],
  mensagens: MensagemDaJanela[],
  janela: { fim: Date; inicio: Date },
): LinhaDaFila[] {
  const naJanela = (valor: null | string) => {
    if (!valor) return false;
    const quando = new Date(valor);
    return quando >= janela.inicio && quando <= janela.fim;
  };

  const pares = paresDeResposta(mensagens, janela);

  const montar = (
    rotulo: string,
    filtroTicket: (t: TicketDaJanela) => boolean,
    filtroMensagem: (m: MensagemDaJanela) => boolean,
  ): LinhaDaFila => {
    const meus = tickets.filter(filtroTicket);
    const minhasMensagens = mensagens.filter((m) => naJanela(m.criadoEm) && filtroMensagem(m));
    const respostas = minhasMensagens.filter((m) => m.direcao === SAIDA);
    const emAudio = respostas.filter((m) => m.tipo === "audio").length;
    // ⚠️ O PAR É DO TICKET, e o recorte da linha também: assim a linha da CACÁ mede os tickets
    // dela, e a do Atendimento mede os do Atendimento (inclusive os dela, que são os mesmos).
    const ticketsDaLinha = new Set(
      mensagens.filter(filtroMensagem).map((m) => m.ticketId),
    );
    for (const t of meus) ticketsDaLinha.add(t.id);
    const tempos = pares
      .filter((p) => ticketsDaLinha.has(p.ticketId))
      .map((p) => p.minutos)
      .filter((v): v is number => v !== null);

    return {
      abertos: meus.filter((t) => naJanela(t.abertoEm)).length,
      audioPercentual: respostas.length > 0 ? (emAudio / respostas.length) * 100 : null,
      fechados: meus.filter((t) => naJanela(t.fechadoEm)).length,
      fila: rotulo,
      medianaMinutos: mediana(tempos),
      piorCasoMinutos: tempos.length > 0 ? Math.max(...tempos) : null,
    };
  };

  const linhas = FILAS_DO_RELATORIO.map((fila) =>
    montar(
      fila,
      (t) => t.fila === fila,
      (m) => m.fila === fila,
    ),
  );

  // A CACÁ: o mesmo dia, visto pelo dono do atendimento. Os tickets dela JÁ ESTÃO no Atendimento.
  const daCaca = montar(
    "CACÁ",
    (t) => t.daCaca,
    (m) => m.daCaca,
  );
  if (daCaca.abertos > 0 || daCaca.fechados > 0 || daCaca.medianaMinutos !== null) {
    linhas.push(daCaca);
  }

  return linhas;
}

export type LinhaDePessoa = {
  atendimentos: number;
  fim: null | string;
  frente: string;
  inicio: null | string;
  mensagens: number;
  pessoa: string;
};

/**
 * Quem atendeu, pela mensagem que a pessoa enviou.
 *
 * ⚠️ É PELO AUTOR DA MENSAGEM, e não por `assigned_to_user_id`: o ticket fica atribuído a quem
 * pegou, mas quem respondeu de fato pode ser outro — e o relatório fala de trabalho feito.
 */
export function quemAtendeu(
  mensagens: MensagemDaJanela[],
  nomePorUsuario: Map<string, string>,
  janela: { fim: Date; inicio: Date },
): LinhaDePessoa[] {
  const porPessoa = new Map<string, MensagemDaJanela[]>();

  for (const m of mensagens) {
    if (m.direcao !== SAIDA) continue;
    const quando = new Date(m.criadoEm);
    if (quando < janela.inicio || quando > janela.fim) continue;
    // Sem autor: é disparo automático (régua de cobrança, template). Não é pessoa.
    const chave = m.daCaca && !m.usuarioId ? "caca" : (m.usuarioId ?? "");
    if (!chave) continue;
    const lista = porPessoa.get(chave);
    if (lista) lista.push(m);
    else porPessoa.set(chave, [m]);
  }

  const linhas: LinhaDePessoa[] = [];

  for (const [chave, lista] of porPessoa) {
    const ordenada = [...lista].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    const porFila = new Map<string, number>();
    for (const m of ordenada) porFila.set(m.fila, (porFila.get(m.fila) ?? 0) + 1);
    const maior = [...porFila.entries()].sort((a, b) => b[1] - a[1])[0];
    const segunda = [...porFila.entries()].sort((a, b) => b[1] - a[1])[1];

    linhas.push({
      atendimentos: new Set(ordenada.map((m) => m.ticketId)).size,
      fim: ordenada[ordenada.length - 1]?.criadoEm ?? null,
      // "Misto" quando nenhuma fila leva 60% do trabalho da pessoa.
      frente:
        maior && (!segunda || maior[1] / ordenada.length >= 0.6) ? maior[0] : "Misto",
      inicio: ordenada[0]?.criadoEm ?? null,
      mensagens: ordenada.length,
      pessoa: chave === "caca" ? "CACÁ" : (nomePorUsuario.get(chave) ?? "Sem nome"),
    });
  }

  return linhas.sort((a, b) => b.atendimentos - a.atendimentos || b.mensagens - a.mensagens);
}

export type HoraDoDia = { entraram: number; hora: number; sairam: number };

export function movimentoPorHora(
  mensagens: MensagemDaJanela[],
  janela: { fim: Date; inicio: Date },
  horaDaCasa: (iso: string) => number,
): HoraDoDia[] {
  const mapa = new Map<number, HoraDoDia>();

  for (const m of mensagens) {
    if (!ehConversa(m)) continue;
    const quando = new Date(m.criadoEm);
    if (quando < janela.inicio || quando > janela.fim) continue;
    const hora = horaDaCasa(m.criadoEm);
    const atual = mapa.get(hora) ?? { entraram: 0, hora, sairam: 0 };
    if (m.direcao === ENTRADA) atual.entraram += 1;
    else atual.sairam += 1;
    mapa.set(hora, atual);
  }

  return [...mapa.values()].sort((a, b) => a.hora - b.hora);
}

export const ERROS_DA_META: Record<string, string> = {
  "131026": "número sem WhatsApp ativo",
  "131047": "fora da janela de 24 horas",
  "131049": "limite de marketing da Meta",
  "132000": "template com parâmetro errado",
};

export function falhasDeEntrega(
  mensagens: MensagemDaJanela[],
  janela: { fim: Date; inicio: Date },
): Array<{ codigo: string; quantidade: number; rotulo: string }> {
  const mapa = new Map<string, number>();

  for (const m of mensagens) {
    const quando = new Date(m.criadoEm);
    if (quando < janela.inicio || quando > janela.fim) continue;
    if (m.entrega !== "failed") continue;
    const codigo = m.erroCodigo ?? "sem código";
    mapa.set(codigo, (mapa.get(codigo) ?? 0) + 1);
  }

  return [...mapa.entries()]
    .map(([codigo, quantidade]) => ({
      codigo,
      quantidade,
      rotulo: ERROS_DA_META[codigo] ?? "motivo não informado pela Meta",
    }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

/** Os recados que a janela terminou sem responder — o que fica para o dia seguinte. */
export function semRespostaAoFim(
  mensagens: MensagemDaJanela[],
  janela: { fim: Date; inicio: Date },
): Array<{ fila: string; quantidade: number }> {
  const pendentes = paresDeResposta(mensagens, janela).filter((p) => p.minutos === null);
  const mapa = new Map<string, number>();
  for (const p of pendentes) mapa.set(p.fila, (mapa.get(p.fila) ?? 0) + 1);
  return [...mapa.entries()]
    .map(([fila, quantidade]) => ({ fila, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade);
}

// ── O BACKLOG, CLASSIFICADO ─────────────────────────────────────────────────

export type ClasseDoBacklog = "automatico" | "cliente" | "fornecedor";

export type ItemDoBacklog = {
  assunto: null | string;
  classe: ClasseDoBacklog;
  diasParado: number;
  email: null | string;
  protocolo: null | string;
};

/** O domínio da própria casa: e-mail nosso na fila de atendimento é relatório automático. */
const DOMINIO_DA_CASA = "careli.adm.br";

/**
 * Fornecedores e plataformas que escrevem para a caixa de atendimento.
 *
 * ⚠️ LISTA EXPLÍCITA, E NÃO ADIVINHAÇÃO. Medido em 17/09/2026 nas 83 pendências: Asaas (28),
 * Clicksign (9) e mais oito domínios de fornecedor respondem por 59 delas. Uma heurística do tipo
 * "domínio corporativo é fornecedor" classificaria como propaganda o cliente que escreve do
 * trabalho — e foi o caso do `educacao.mg.gov.br`, que é gente esperando resposta desde julho.
 */
const DOMINIOS_DE_FORNECEDOR = [
  "asaas.com",
  "asaas.com.br",
  "security.asaas.com",
  "clicksign.com",
  "clicksign.com.br",
  "accounts.google.com",
  "google.com",
  "regus.com",
  "elife.com.br",
  "gocxpress.com.br",
  "ksistema.com.br",
  "sulivam.com.br",
  "i9ja.com.br",
];

/** Assuntos que denunciam robô, venha de onde vier. */
const ASSUNTOS_AUTOMATICOS = [
  "delivery status notification",
  "resposta automática",
  "automatic reply",
  "report domain",
  "alerta de segurança",
  "alerta crítico de segurança",
  "undelivered mail",
  "mail delivery",
];

export function classificarBacklog(item: {
  assunto: null | string;
  email: null | string;
}): ClasseDoBacklog {
  const assunto = (item.assunto ?? "").toLowerCase();
  if (ASSUNTOS_AUTOMATICOS.some((marca) => assunto.includes(marca))) return "automatico";

  const dominio = (item.email ?? "").toLowerCase().split("@")[1]?.trim() ?? "";
  if (!dominio) return "cliente";
  if (dominio === DOMINIO_DA_CASA || dominio.endsWith(`.${DOMINIO_DA_CASA}`)) return "automatico";
  if (DOMINIOS_DE_FORNECEDOR.some((d) => dominio === d || dominio.endsWith(`.${d}`))) {
    return "fornecedor";
  }
  return "cliente";
}

export function resumoDoBacklog(itens: ItemDoBacklog[]): {
  automatico: number;
  cliente: number;
  fornecedor: number;
  maisAntigoEmDias: number;
  total: number;
} {
  const daClasse = (classe: ClasseDoBacklog) => itens.filter((i) => i.classe === classe).length;
  const clientes = itens.filter((i) => i.classe === "cliente");

  return {
    automatico: daClasse("automatico"),
    cliente: clientes.length,
    fornecedor: daClasse("fornecedor"),
    maisAntigoEmDias: clientes.reduce((maior, i) => Math.max(maior, i.diasParado), 0),
    total: itens.length,
  };
}
