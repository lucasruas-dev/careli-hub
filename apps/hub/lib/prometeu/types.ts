// Prometeu: vocabulario do dia do lancamento. As etapas e as cores vem dos mockups ja
// validados (public/prometeu/cockpit.html), pra tela React nascer identica ao que o Lucas
// aprovou.

export const PROMETEU_ETAPAS = [
  { cor: "#64748b", id: "recepcao", label: "Recepção" },
  { cor: "#ec7f2e", id: "negociacao", label: "Negociação" },
  { cor: "#3b82f6", id: "reserva", label: "Reserva" },
  { cor: "#8b5cf6", id: "secretaria", label: "Secretaria" },
  { cor: "#0e9aa5", id: "proposta", label: "Proposta" },
  { cor: "#e0a52e", id: "pagamento", label: "Pagamento" },
  { cor: "#22a95b", id: "concluido", label: "Concluído" },
  { cor: "#e0554a", id: "cancelado", label: "Cancelado" },
] as const;

export type PrometeuEtapa = (typeof PROMETEU_ETAPAS)[number]["id"];

// Etapas que ainda estao "em jogo": saem daqui os KPIs de fila e os cronometros.
export const ETAPAS_ATIVAS: readonly PrometeuEtapa[] = [
  "recepcao",
  "negociacao",
  "reserva",
  "secretaria",
  "proposta",
  "pagamento",
];

export function etapaLabel(id: string): string {
  return PROMETEU_ETAPAS.find((e) => e.id === id)?.label ?? id;
}

export function etapaCor(id: string): string {
  return PROMETEU_ETAPAS.find((e) => e.id === id)?.cor ?? "#64748b";
}

// Zonas fisicas do evento (setup.html): onde as mesas ficam.
export const PROMETEU_ZONAS = [
  { id: "recepcao", label: "Recepção" },
  { id: "salao", label: "Salão de vendas" },
  { id: "secretaria", label: "Secretaria" },
] as const;

export type PrometeuZona = (typeof PROMETEU_ZONAS)[number]["id"];

// Perfis do OPERADOR do evento (login proprio, nao e' usuario do hub). ATENDENTE e' o unico que
// leva mesa e so existe na secretaria (tem "minha mesa"); organizador toca recepcao/salao; gestor
// acompanha a operacao (Central/telao) sem posto fixo.
export const PROMETEU_PAPEIS = [
  { id: "organizador", label: "Organizador" },
  { id: "atendente", label: "Atendente" },
  { id: "gestor", label: "Gestor" },
] as const;

export type PrometeuPapel = (typeof PROMETEU_PAPEIS)[number]["id"];

// Um operador do evento como aparece na lista do Setup (SEM a senha, nunca exposta).
export type PrometeuOperadorResumo = {
  ativo: boolean;
  id: string;
  mesaId: string | null;
  mesaNumero: string | null;
  nome: string;
  perfil: PrometeuPapel;
  ultimoLoginEm: string | null;
  username: string;
  zona: PrometeuZona;
};

// Quem sou eu: o operador logado, do cookie de sessao. E' o que faz a tela abrir no posto certo.
// `null` = ninguem logado (cai na tela de login).
export type PrometeuOperadorEu = {
  eventoId: string;
  mesaId: string | null;
  nome: string;
  operadorId: string;
  perfil: PrometeuPapel;
  username: string;
  zona: PrometeuZona;
} | null;

// Ciclo do evento. A DATA e so informativa (decisao do Lucas 19/jul): quem manda e o status.
//   rascunho    -> sendo configurado no Setup
//   ativo       -> libera a PREPARACAO: CAD, etiqueta, PIX, fila e os testes do time
//   em_andamento-> o evento real comecou (o reset dos testes ja rodou)
//   encerrado   -> acabou
export type PrometeuEventoStatus =
  | "rascunho"
  | "ativo"
  | "em_andamento"
  | "encerrado";

// O que o Setup preenche e ainda nao merece coluna propria.
export type PrometeuEventoConfig = {
  // Check-in LIGADO (padrao) = quem pagou o PIX tem prioridade na fila (ordem do pagamento).
  // DESLIGADO = o PIX perde a prioridade e a fila ordena pela hora do check-in fisico. Substitui
  // a antiga "janela" de data/hora: agora e um simples liga/desliga do evento. Ausente = ligado.
  checkinHabilitado?: boolean;
  // FASE do check-in: um contador que SOBE 1 a cada vez que `checkinHabilitado` vira (liga->desliga
  // ou o contrario). E o que congela a fila: quem faz check-in guarda a fase vigente no momento, e
  // a fila ordena por fase primeiro. Assim, ao mudar o regime, quem ja entrou NAO se move — o novo
  // regime so vale para quem bipar dali pra frente. Ausente = fase 1 (antes de qualquer troca).
  checkinFase?: number;
  construtora?: string;
  // Nome do empreendimento por extenso ("Vale do Ouro"). O evento guarda enterprise_id e
  // enterprise_code, mas o NOME so existe no C2X (MySQL legado) — buscar la' a cada leitura de
  // tela sairia caro. Como quem escolhe o empreendimento e' o Setup, e ele ja tem a lista
  // carregada, o nome e' gravado junto no config e todas as telas leem de graca.
  enterpriseNome?: string;
  local?: string;
  mesasSecretaria?: number;
  metas?: {
    atendimento?: { alerta: number; meta: number };
    filaRecepcao?: { alerta: number; meta: number };
    filaSecretaria?: { alerta: number; meta: number };
    negociacao?: { alerta: number; meta: number };
    tempoMedioAtendimento?: number;
    tempoTotalEvento?: number;
  };
  senhaPorWhatsapp?: boolean;
  // Reforço do alerta da tela: manda um WhatsApp ("É a sua vez") na hora do chamado. Ausente =
  // ligado. Ver [[project_prometeu_tela_cliente]].
  avisarChamadoPorWhatsapp?: boolean;
};

export type PrometeuEvento = {
  // Quando o lancamento saiu de circulacao. Null = aparece nas telas. ARQUIVAR NAO APAGA NADA:
  // todo o historico (credenciados, movimentacoes, chamadas) continua no banco.
  arquivadoEm: string | null;
  config: PrometeuEventoConfig;
  dataEvento: string | null;
  enterpriseCode: string | null;
  enterpriseId: string | null;
  id: string;
  // Carimbo do "Iniciar evento real": trava pra o reset dos testes nao rodar duas vezes.
  iniciadoEm: string | null;
  nome: string;
  status: PrometeuEventoStatus;
};

// "No tal dia sera nessa hora": uma janela por dia de check-in.
export type PrometeuJanela = {
  data: string;
  horaFim: string;
  horaInicio: string;
  id: string;
};

export type PrometeuUnidade = {
  codigo: string;
  id: string;
  lote: string | null;
  quadra: string | null;
  situacao: string;
};

export type PrometeuCredenciado = {
  // Quando a CAD chegou (data da task no Asana, guardada na esteira do Apolo). É a data que a
  // fila mostra para quem ainda não pagou — e o desempate entre eles.
  chegouEm: string | null;
  corretor: string | null;
  // Gravado NO CHECK-IN: estava dentro da janela de check-in? Define o regime da fila da
  // recepcao. Nulo = ainda nao fez check-in.
  credenciadoNaJanela: boolean | null;
  documento: string | null;
  entityId: string | null;
  // Vazio = habilitado, ainda NAO chegou ao evento. Preenchido = fez check-in (leu o QR).
  entrouEm: string | null;
  etapa: PrometeuEtapa;
  etapaDesde: string;
  etiquetaImpressaEm: string | null;
  // Chamado e nao apareceu. Sai das filas normais e vai pra lista de no-show; chamar de novo
  // limpa a marca sozinho.
  noShow: boolean;
  // De qual POSTO veio o no-show (recepcao/salao/secretaria). A etapa nao muda no no-show, entao
  // ela nao serve pra dizer de qual fila a pessoa e — quem chama e' que sabe. Cada posto lista so'
  // o "nao veio" dele filtrando por esta zona. Nulo = no-show antigo, sem origem gravada.
  noShowZona: string | null;
  // Caminho da PA (foto do A4 da proposta) no Storage. Nulo = PA pendente: o cliente segue na
  // fila normalmente, mas NAO pode ir para o atendimento REMOTO — quem atende de fora precisa
  // ver a folha. Regra do Lucas, 27/07.
  paPath: string | null;
  eventoId: string;
  id: string;
  // Nome da imobiliária para EXIBIR/AGRUPAR: o canônico da entidade do Apolo quando há vínculo,
  // senão o texto da esteira. As etiquetas agrupam por `imobiliariaEntityId` (fonte única).
  imobiliaria: string | null;
  imobiliariaEntityId: string | null;
  nome: string;
  // CHAVE de ordenacao da fila do evento (epoch do PIX, ou o valor que o admin fixou ao
  // arrastar). Nao confundir com `posicao`, que e derivada na leitura.
  ordemFila: number | null;
  ordemMotivo: string | null;
  origem: string;
  // Nulo = ainda nao pagou o PIX da pre-venda.
  pagoEm: string | null;
  // CONGELADO no check-in (metadata.recepcao): a fase vigente e se o check-in estava LIGADO
  // naquele momento. E o que trava a posicao na fila da recepcao — ver `filaDaRecepcao`. Nulo =
  // check-in feito antes deste mecanismo (cai no fallback do flag atual).
  recepcaoFase: number | null;
  recepcaoLigado: boolean | null;
  // DERIVADA (1, 2, 3...) a partir de ordemFila. Nao existe coluna: e calculada ao ler, pra
  // nao haver duas fontes de verdade quando o admin fura a fila.
  posicao: number | null;
  // Vem da ficha no Apolo (apolo_contacts), não de uma coluna daqui: é o contato de quem está na
  // fila, pra o organizador conseguir falar com a pessoa antes de ela ser chamada.
  telefone?: string | null;
  unidades: PrometeuUnidade[];
};

// Card "Últimas chamadas" da Central: quem foi chamado, pra onde e quando.
export type PrometeuChamada = {
  chamadoEm: string;
  id: string;
  mesa: string | null;
  nome: string;
  zona: string | null;
};

// Feed "Atividade ao vivo": cada troca de etapa vira uma linha.
export type PrometeuAtividade = {
  deEtapa: string | null;
  em: string;
  id: string;
  motivo: string | null;
  nome: string;
  paraEtapa: PrometeuEtapa;
};

export type PrometeuMesa = {
  // Nome de quem está atendendo na mesa (operador do evento ou admin testando). Gravado quando a
  // pessoa entra na mesa pela tela do Atendente; nulo quando ninguém sentou. É o que o Mapa do
  // salão da Central mostra.
  atendenteNome: string | null;
  atendenteUserId: string | null;
  credenciadoId: string | null;
  estado: "livre" | "ocupada" | "atendimento";
  id: string;
  numero: string;
  // Última mexida na mesa. O auto-reparo de mesa órfã (rota da fila) usa isto como tolerância:
  // só solta uma `ocupada` sem chamada aberta se ela está parada há mais de 45s.
  updatedAt: string | null;
  zona: string;
};

// O QUE ESTA MESA FEZ HOJE — os dois indicadores do topo da tela do atendente.
//
// Nada disso é coluna: o banco carimba QUANDO a pessoa sentou (`prometeu_chamadas.atendido_em`)
// e, quando ela sai, grava uma MOVIMENTAÇÃO de etapa. O fim do atendimento é essa movimentação.
// Cruzar as duas evita criar coluna nova em cima do evento (01/08).
// Os indicadores de UMA mesa para o Mapa do salão da gestão: quantos atendimentos fechou, quantas
// unidades foram vendidas nesses atendimentos, e o tempo (médio e total). Derivados, não colunas.
export type PrometeuIndicadorDaMesa = {
  atendimentos: number;
  // Quem SENTOU nesta mesa e já saiu. ⚠️ Existe para a tela poder somar as unidades do C2X: o
  // campo `unidades` abaixo vem de `prometeu_unidades`, que nunca foi escrita, e por isso o "UN"
  // de toda mesa aparecia 0 mesmo com o cliente tendo levado dois lotes.
  credenciadoIds: string[];
  tempoMedioMs: number | null;
  tempoTotalMs: number;
  unidades: number;
};

// Um passo da JORNADA do cliente no evento, reconstituído das movimentações de etapa + carimbos.
// A sequência que interessa (decisão do Lucas): Check-in → Negociação → Reserva (com as unidades)
// → Secretária (check-in e atendimento) → Proposta → Finalizado. Mais os no-shows.
export type PrometeuPassoJornada = {
  // Marca quando a pessoa saiu do fluxo aqui (cancelou ou não veio): a bolinha fica vermelha.
  cancelado: boolean;
  // Linha extra (ex.: as unidades reservadas). Nulo quando não há.
  detalhe: string | null;
  // ISO do carimbo, ou null quando o passo aconteceu sem hora registrada.
  quando: string | null;
  titulo: string;
};

export type PrometeuResumoDaMesa = {
  // Atendimentos ENCERRADOS hoje nesta mesa (quem está sentado agora ainda não conta).
  atendimentosHoje: number;
  // Começo do atendimento em curso, carimbado pelo servidor. É o que faz o cronômetro da tela
  // sobreviver a F5 e valer igual em qualquer máquina.
  emAtendimentoDesde: string | null;
  // Média do tempo dos atendimentos encerrados. Nulo enquanto nenhum fechou: sem base para média,
  // a tela mostra travessão em vez de "0:00".
  tempoMedioMs: number | null;
};
