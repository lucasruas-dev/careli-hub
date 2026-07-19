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
  construtora?: string;
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
};

export type PrometeuEvento = {
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

// "No tal dia sera nessa hora": uma janela por dia de credenciamento.
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
  corretor: string | null;
  // Gravado NO BIP: estava dentro da janela de credenciamento? Define o regime da fila da
  // recepcao. Nulo = ainda nao fez check-in.
  credenciadoNaJanela: boolean | null;
  documento: string | null;
  entityId: string | null;
  // Vazio = habilitado, ainda NAO chegou ao evento. Preenchido = fez check-in (bipou o QR).
  entrouEm: string | null;
  etapa: PrometeuEtapa;
  etapaDesde: string;
  etiquetaImpressaEm: string | null;
  eventoId: string;
  id: string;
  imobiliaria: string | null;
  nome: string;
  // CHAVE de ordenacao da fila do evento (epoch do PIX, ou o valor que o admin fixou ao
  // arrastar). Nao confundir com `posicao`, que e derivada na leitura.
  ordemFila: number | null;
  ordemMotivo: string | null;
  origem: string;
  // Nulo = ainda nao pagou o PIX da pre-venda.
  pagoEm: string | null;
  // DERIVADA (1, 2, 3...) a partir de ordemFila. Nao existe coluna: e calculada ao ler, pra
  // nao haver duas fontes de verdade quando o admin fura a fila.
  posicao: number | null;
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
  atendenteUserId: string | null;
  credenciadoId: string | null;
  estado: "livre" | "ocupada" | "atendimento";
  id: string;
  numero: string;
  zona: string;
};
