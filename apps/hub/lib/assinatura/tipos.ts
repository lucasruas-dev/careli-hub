// O VOCABULÁRIO ÚNICO DA ASSINATURA — o que a Têmis fala, independente de quem assina.
//
// Lucas, 07/09/2026: *"a minha ideia é ter as duas, não vou desfazer da d4sign"*, e o motivo:
// *"teve uma vez que ficamos 4 dias com a d4sign fora do ar"*. Não é preferência, é continuidade:
// quatro dias sem conseguir assinar é venda parada e cliente esperando.
//
// ⚠️ POR QUE ESTA CAMADA EXISTE. Os dois provedores falam línguas diferentes, e sem tradução o
// jargão de cada um vaza para dentro das nossas telas — e aí a tela precisa saber que `statusId 4`
// do D4Sign e `closed` da Clicksign são a mesma coisa. Pior: no dia em que o primário cair, a tela
// teria de aprender a segunda língua no meio do incidente.
//
//     D4Sign            statusId 1..7 · act numérico · e-mail é a identidade · 4 eventos
//     Clicksign         draft/running/closed/canceled · qualification · ~30 eventos
//     ↓ tradução (esta camada)
//     Panteon           rascunho · aguardando · parcial · assinado · recusado · cancelado · expirado
//
// ⚠️ O QUE UM PROVEDOR NÃO TEM CONTINUA EXISTINDO AQUI. `recusado` não tem equivalente no D4Sign —
// lá não há status nem evento de recusa. A escolha é MANTER o estado no nosso vocabulário e deixá-lo
// vazio daquele lado, em vez de rebaixar a língua ao menor denominador comum: quando a Clicksign
// avisa que o cliente recusou, a Têmis precisa saber disso, e o dia em que o D4Sign ganhar recusa
// não pode exigir mudar a tela.
//
// ⚠️ E O PROVEDOR USADO VAI GRAVADO EM CADA ENVIO. Sem isso, daqui a seis meses ninguém sabe em que
// plataforma procurar um contrato — e com dois provedores vivos essa pergunta é feita toda semana.
// Ver [[reference_d4sign_escrita_armadilhas]] e [[project_contrato_so_no_panteon]].

/** Quem assinou o contrato. O histórico dos 3.923 documentos antigos é todo `d4sign`. */
export type Provedor = "clicksign" | "d4sign";

/**
 * Onde o documento está, na língua da Têmis.
 *
 * ⚠️ `expirado` É SEPARADO DE `cancelado` de propósito, embora os dois provedores misturem os dois:
 * o D4Sign autocancela no `sign_limit_date` e a Clicksign cancela (ou fecha) no `deadline_at`. Para
 * a operação são coisas diferentes — cancelado é decisão de alguém, expirado é o relógio. Quem vê a
 * fila precisa distinguir "desistiram" de "perdemos o prazo", porque a ação é outra.
 */
export type EstadoDaAssinatura =
  /** Montado do nosso lado, ainda não foi para ninguém. Só a Clicksign tem equivalente (`draft`). */
  | "rascunho"
  /** Enviado, ninguém assinou ainda. */
  | "aguardando"
  /** Pelo menos um assinou, faltam outros. É o estado em que o contrato passa mais tempo. */
  | "parcial"
  /** Todos assinaram. */
  | "assinado"
  /** Alguém recusou. ⚠️ O D4Sign não produz este estado — ver a nota do topo. */
  | "recusado"
  /** Alguém cancelou, de propósito. */
  | "cancelado"
  /** O prazo venceu. */
  | "expirado"
  /** O provedor devolveu algo que não sabemos traduzir. Nunca vira silêncio: vira alerta. */
  | "desconhecido";

/** Os estados em que o documento ainda pode mudar sozinho — os que valem acompanhar. */
export const ESTADOS_EM_MOVIMENTO: EstadoDaAssinatura[] = ["aguardando", "parcial"];

/** Os estados finais: não mudam mais, e o contrato sai da fila de acompanhamento. */
export const ESTADOS_TERMINAIS: EstadoDaAssinatura[] = [
  "assinado",
  "recusado",
  "cancelado",
  "expirado",
];

export function estaEmMovimento(estado: EstadoDaAssinatura): boolean {
  return ESTADOS_EM_MOVIMENTO.includes(estado);
}

export function ehTerminal(estado: EstadoDaAssinatura): boolean {
  return ESTADOS_TERMINAIS.includes(estado);
}

/**
 * O papel de quem assina, no vocabulário do CONTRATO — não no do provedor.
 *
 * ⚠️ NENHUM DOS DOIS TEM "CÔNJUGE" NEM "VENDEDORA". O D4Sign tem `act` numérico (assinar, testemunha,
 * aprovar…) e a Clicksign tem `qualification`. Guardamos o papel real e cada provedor traduz para o
 * que sabe representar — senão a informação de QUEM é aquela pessoa no contrato se perde na saída, e
 * é ela que a Têmis mostra na tela e o jurídico confere.
 */
export type PapelNoContrato = "comprador" | "conjuge" | "vendedora" | "testemunha" | "interveniente";

export const PAPEIS: PapelNoContrato[] = [
  "comprador",
  "conjuge",
  "vendedora",
  "testemunha",
  "interveniente",
];

export function rotuloDoPapel(papel: PapelNoContrato): string {
  const mapa: Record<PapelNoContrato, string> = {
    comprador: "Comprador",
    conjuge: "Cônjuge",
    interveniente: "Interveniente",
    testemunha: "Testemunha",
    vendedora: "Vendedora",
  };
  return mapa[papel];
}

/**
 * Uma pessoa que vai assinar.
 *
 * ⚠️ O E-MAIL É OBRIGATÓRIO, e não é escolha nossa: no D4Sign o signatário É o e-mail, sem campo de
 * nome nem de CPF. Por isso a CAD passou a travar e-mail repetido (`lib/apolo/email-unico.ts`) — sem
 * endereço próprio por pessoa, o contrato sai sem se saber quem assinou.
 *
 * `nome` e `cpf` viajam porque a Clicksign os aceita e o D4Sign os ignora. Guardar o dado do lado
 * mais rico é o certo: o lado pobre descarta, e a trilha de auditoria NOSSA fica completa nos dois.
 */
export type Signatario = {
  /** Ordem de assinatura. Mesmo número = assinam em paralelo; número maior espera o menor. */
  ordem: number;
  cpf?: null | string;
  email: string;
  nome: string;
  papel: PapelNoContrato;
  telefone?: null | string;
};

/** O que se manda para assinar: um PDF já montado, e quem assina. */
export type PedidoDeAssinatura = {
  /** O PDF completo — capa + corpo + anexos —, montado pelo Panteon antes de sair. */
  arquivo: { bytes: Uint8Array; nome: string };
  /** Prazo em dias. ⚠️ A Clicksign tem TETO RÍGIDO de 90 dias contados do upload. */
  prazoEmDias?: number;
  /** Mensagem do e-mail para o signatário. */
  mensagem?: string;
  signatarios: Signatario[];
};

/** O que o provedor devolve quando aceita o pedido. */
export type EnvioFeito = {
  /** O id do documento LÁ. É por ele que se consulta, cancela e baixa. */
  idExterno: string;
  provedor: Provedor;
  /** Chave de cada signatário no provedor, quando ele devolve uma. Poupa uma consulta no reenvio. */
  chavesDosSignatarios?: Record<string, string>;
};

/** Como está cada pessoa, na consulta de status. */
export type SituacaoDoSignatario = {
  assinadoEm?: null | string;
  email: string;
  estado: "assinou" | "recusou" | "pendente";
  nome?: null | string;
};

export type SituacaoDaAssinatura = {
  estado: EstadoDaAssinatura;
  /** O que o provedor respondeu, cru, para a tela poder mostrar quando `estado` é `desconhecido`. */
  estadoCru: string;
  signatarios: SituacaoDoSignatario[];
};

/**
 * O que todo provedor precisa saber fazer.
 *
 * ⚠️ ENXUTO DE PROPÓSITO. Cada método aqui é um método que as DUAS implementações têm de sustentar,
 * e cada um que sobra é uma promessa que uma delas vai quebrar no dia do incidente. `apagar` NÃO
 * está aqui: o D4Sign não tem delete e a Clicksign só apaga rascunho — uma porta que só um lado
 * atravessa não é contrato comum, é armadilha.
 */
export type ProvedorDeAssinatura = {
  /** Cancela o documento. Nos dois provedores isso é irreversível. */
  cancelar: (idExterno: string, motivo: string) => Promise<void>;
  /** Baixa o PDF assinado. */
  baixarAssinado: (idExterno: string) => Promise<Uint8Array>;
  /** Está de pé? É o que decide o failover — ver `estaDePe` na nota do topo. */
  estaDePe: () => Promise<boolean>;
  nome: Provedor;
  /** Consulta a situação. */
  situacao: (idExterno: string) => Promise<SituacaoDaAssinatura>;
  /** Manda o contrato para assinatura. */
  enviar: (pedido: PedidoDeAssinatura) => Promise<EnvioFeito>;
};
