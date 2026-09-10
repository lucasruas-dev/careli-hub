"use client";

import { EspelhoDoProduto, type LoteDaMesa } from "./EspelhoDoProduto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Bookmark,
  Check,
  FileSignature,
  FileText,
  Grid2x2,
  Receipt,
  Search,
  Signature,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { acaoDeCancelamento } from "@/lib/hercules/acao-de-cancelamento";
import { ETAPAS_DO_FLUXO } from "@/lib/hercules/fluxo-de-venda";
import {
  propostaEmFoco as acharPropostaEmFoco,
  unidadeEmFoco as acharUnidadeEmFoco,
} from "@/lib/hercules/unidade-em-foco";
import type {
  EtapaDoEspelho,
  EtapaDoFluxo,
  FluxoDeVenda,
} from "@/lib/hercules/fluxo-de-venda";
import {
  type ClasseDoFato,
  classeDoFato,
  type EventoDaUnidade,
} from "@/lib/hercules/historico-da-unidade";

import { toTitleCase } from "@/lib/format/name-case";
import { formatarTelefoneGuardado } from "@/lib/hercules/paises";

import { T } from "../tema";
import { Pilula } from "./AssinaturasDoProduto";
import { ConversaDaVenda } from "./ConversaDaVenda";
import { DocumentosDaVenda } from "./DocumentosDaVenda";
import { ModalDeCancelamento } from "./ModalDeCancelamento";
import { ModalDeContrato } from "./ModalDeContrato";
import { ModalDePedidoDeCancelamento } from "./ModalDePedidoDeCancelamento";
import { ModalDeProposta } from "./ModalDeProposta";
import { ModalDeReserva } from "./ModalDeReserva";
import { PreviaDoContrato } from "./PreviaDoContrato";
import { SimuladorDeProposta } from "./SimuladorDeProposta";

// A TELA VENDA — onde o coordenador VENDE, e onde ele olha se está vendendo bem.
//
// Pedido do Lucas (03/09/2026): *"vamos criar a tela Venda, que vai ser a tela que vamos fazer o
// processo de reserva, proposta e emissão de contratos"*, com *"a parte indicadores (...) a ideia é
// mostrar o cenário comercial daquele ou daqueles empreendimentos"*, *"um dashboard (painel de
// gestão) rico focado em performance comercial"*, agilidade com *"simulador de proposta"* e *"ter o
// mapa na tela de vendas para que o coordenador possa ver visualmente o que está sendo vendido"*.
//
// ⚠️ OS DADOS SÃO DO PANTEON, NÃO DO C2X. Na mesma conversa: *"quero importar todos os dados do
// c2x, eles tem que existir dentro do panteon (...) e quero que hoje isso seja visto dentro do
// panteon"*. A carga trouxe 4.853 propostas e 12.269 movimentações de etapa
// (`scripts/hercules/importar-fluxo-de-venda.mjs`), e esta tela lê `/api/incorporador/venda` —
// Supabase, não o MySQL do legado. A tela antiga (`TelaVendas`) continua lendo o C2X e serve os
// portais de incorporador; quando eles migrarem, ela sai.
//
// ⚠️ A FAIXA DO FLUXO É A ESPINHA, e fica acima das duas visões. Reserva → Proposta → Contrato →
// Assinatura → Faturamento é o processo, e ele não muda quando o coordenador troca de visão: o que
// muda é o que ele faz com aquilo. Clicar numa etapa recorta a Mesa para ela.
//
// ⚠️ CANCELADO E DISTRATO NÃO SÃO PASSOS. São saídas do caminho, e vivem no quadro de perdas do
// Panorama — a régua está em `lib/hercules/fluxo-de-venda.ts`, com teste.
//
// ⚠️ O QUE AINDA NÃO EXISTE ESTÁ DITO NA TELA, não escondido atrás de um botão morto. Reservar,
// gerar proposta e cancelar já gravam no Panteon (migrations 0125 e 0131); "Enviar para contrato"
// continua apagado, com o motivo no `title`.
//
// ⚠️ O ESTOQUE TEM DUAS VISTAS NO MESMO LUGAR: quadrados e mapa (Lucas, 03/09/2026: *"vamos dar a
// opção do usuário de selecionar se ele quer ver essa tela quadrados, ou mapa (...) não é para
// abrir uma tela nova, tem que aparecer aí mesmo"*). O masterplan é o desenho de verdade do
// loteamento; a grade é o quadro por quadra, que funciona em qualquer produto e não depende
// de haver mapa publicado. Antes disso o masterplan abria em tela cheia e tirava o coordenador da
// Mesa — perdia a lista, o painel e o simulador para olhar o mapa.
//
// ⚠️ E COM TODOS OS EMPREENDIMENTOS NÃO HÁ MAPA. Cada produto tem o seu; o consolidado não tem um
// desenho só. Nesse caso a opção nem aparece, em vez de aparecer e não fazer nada.

/** O card da rota antiga — usado só para achar o masterplan de um produto. */
type CardDeProduto = {
  code: string;
  enterpriseIds: string[];
  id: string;
  masterplanInterno: null | string;
  masterplanUrl: null | string;
  nome: string;
};

/**
 * O PRODUTO É O PAI, e os recortes são filhos dele.
 *
 * ⚠️ ISTO É A ARQUITETURA DA CASA, EXPLICADA PELO LUCAS (03/09/2026): *"o Pai sempre será a nossa
 * referência para tudo, o filho são recortes, visões do pai (...) no Vale do Ouro o Pai VLO é a
 * referência, o VOC são os lotes que pertencem a Cecílio Rocha, o VOL são os lotes que pertencem à
 * Família Lino (...) eu peguei o pai e subdividi ele pois na hora de emitir os boletos teria que
 * sair de contas separadas. No C2X não tínhamos essa divisão tão bem arquitetada, por isso
 * criávamos outros empreendimentos, era nossa gambiarra"*.
 *
 * E o pedido: *"quero que o VLO seja reflexo dos filhos, então não vai ter três Vale do Ouro, vai
 * ter UM Vale do Ouro e quando tiver filhos trazer um subfiltro para caso o usuário queira ver
 * somente aquele recorte"*.
 *
 * ⚠️ E O ESPELHO DO PAI NÃO ENTRA NA CONTA quando há filhos. No C2X o VLO tem 298 unidades e 165
 * propostas PRÓPRIAS (só 11 faturadas) — é o registro antigo, parado, dos MESMOS lotes que hoje
 * vivem em VOC + VOL + VOR. Somar pai e filhos contaria cada venda duas vezes. Quem já resolve
 * isso é `expandirIdDoPainel`: pai com filho devolve só os filhos.
 */
type Produto = {
  filhos: { codigo: string; id: string; nome: string }[];
  id: string;
  nome: string;
};

type UnidadeNoMapa = FluxoDeVenda["mapa"][number]["unidades"][number];
type Proposta = FluxoDeVenda["lista"][number];

/**
 * O que o painel da direita está mostrando.
 *
 * ⚠️ SÃO DUAS PORTAS PARA A MESMA COISA. Clicar no lote do mapa parte da UNIDADE (e a proposta,
 * se houver, é achada pelo id); clicar na linha da lista parte da PROPOSTA. Guardar só a proposta
 * deixaria o lote disponível sem nada para mostrar — e foi exatamente o que aconteceu: o Lucas
 * clicou nos lotes e a tela não reagiu.
 */
type Foco =
  | { proposta: Proposta; tipo: "proposta" }
  | { tipo: "unidade"; unidade: UnidadeNoMapa };

// ⚠️ O ESTOQUE ABRE A FAIXA (Lucas, 03/09/2026: *"aproveitar trazer aqui também disponível"*). É
// de onde a venda começa, e ver o pipeline sem saber quanto sobra para vender conta metade da
// história. Ele é o único passo contado em UNIDADES — nos outros, cada unidade tem uma proposta.
const FLUXO: ReadonlyArray<{
  cor: string;
  etapa: "disponivel" | EtapaDoFluxo;
  icone: LucideIcon;
  rotulo: string;
}> = [
  { cor: "#98a2b3", etapa: "disponivel", icone: Grid2x2, rotulo: "Disponível" },
  { cor: "#c9962b", etapa: "reservado", icone: Bookmark, rotulo: "Reserva" },
  { cor: "#3c73c0", etapa: "proposta", icone: FileText, rotulo: "Proposta" },
  {
    cor: "#7d5cba",
    etapa: "contrato",
    icone: FileSignature,
    rotulo: "Contrato",
  },
  {
    cor: "#454c5c",
    etapa: "assinatura",
    icone: Signature,
    rotulo: "Assinatura",
  },
  { cor: "#2f7d4a", etapa: "faturado", icone: Receipt, rotulo: "Faturamento" },
];

// ⚠️ A GRADE PINTA POR ETAPA, NÃO POR SITUAÇÃO (Lucas, 03/09/2026: *"em vez de vendida, ter
// propostas, contrato assinatura faturamento"*). A cor de cada etapa é a MESMA da faixa acima, de
// propósito: o quadrado amarelo no quadro é o mesmo amarelo do cartão Reserva, e o coordenador liga
// os dois sem legenda.
//
// ⚠️ `vendida` e `reservada` são os estados SEM PROPOSTA que o cadastro sozinho afirma — 114 lotes
// hoje. Recebem tom próprio, apagado, para parecerem ocupados sem se passar por uma etapa do fluxo:
// eles não estão em nenhuma, e é justamente isso que precisa aparecer.
// ⚠️ UM MATIZ POR ETAPA, e não tons do mesmo. Lucas (03/09/2026), olhando a legenda com
// assinatura, faturamento e "vendida sem proposta" em três verdes: *"não gostei desses tons da
// mesma cor, isso confunde na hora da visualização"*. Num quadro de 500 quadradinhos de 12px, dois
// verdes vizinhos são a mesma cor — o olho não separa. Então cada etapa pegou um matiz distante no
// círculo: amarelo, azul, violeta, ciano, verde.
//
// ⚠️ E O QUE NÃO TEM PROPOSTA GANHA LISTRA, NÃO UM TOM. `vendida` e `reservada` (114 lotes que o
// cadastro afirma sem proposta que sustente) precisam parecer OCUPADOS — se virassem cinza, se
// misturariam ao disponível e alguém venderia de novo. A cor é a do estado, a listra é o "falta a
// proposta": diferença de textura, que sobrevive ao quadradinho pequeno.
const AMARELO = "#f2c14e";
const VERDE = "#3f9d5e";

const listrado = (cor: string, sombra: string) =>
  `repeating-linear-gradient(135deg, ${cor} 0 4px, ${sombra} 4px 8px)`;

const COR_DA_ETAPA: Record<EtapaDoEspelho, string> = {
  assinatura: "#454c5c",
  bloqueada: "#e08276",
  contrato: "#9b7ed0",
  disponivel: "var(--inc-soft)",
  faturado: VERDE,
  proposta: "#5b8dd6",
  reservada: listrado(AMARELO, "#d9a833"),
  reservado: AMARELO,
  vendida: listrado(VERDE, "#2f7d4a"),
};

/** A ordem da legenda é a do caminho: estoque, fluxo, e no fim o que está fora dele. */
const LEGENDA: ReadonlyArray<{ etapa: EtapaDoEspelho; rotulo: string }> = [
  { etapa: "disponivel", rotulo: "Disponível" },
  { etapa: "reservado", rotulo: "Reserva" },
  { etapa: "proposta", rotulo: "Proposta" },
  { etapa: "contrato", rotulo: "Contrato" },
  { etapa: "assinatura", rotulo: "Assinatura" },
  { etapa: "faturado", rotulo: "Faturamento" },
  { etapa: "vendida", rotulo: "Vendida sem proposta" },
  { etapa: "reservada", rotulo: "Reservada sem proposta" },
  { etapa: "bloqueada", rotulo: "Bloqueada" },
];

const ROTULO_DA_ETAPA: Record<EtapaDoEspelho, string> = Object.fromEntries(
  LEGENDA.map((l) => [l.etapa, l.rotulo]),
) as Record<EtapaDoEspelho, string>;

/** As etapas de fundo ESCURO, onde o número do lote precisa ser claro para continuar legível. */
const FUNDO_ESCURO = new Set<EtapaDoEspelho>(["assinatura"]);

const textoNoQuadrado = (etapa: EtapaDoEspelho) =>
  etapa === "disponivel"
    ? T.muted
    : FUNDO_ESCURO.has(etapa)
      ? "rgb(255 255 255 / .9)"
      : "rgb(0 0 0 / .6)";

const dinheiro = (v: number) =>
  v >= 1_000_000
    ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`
    : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

const inteiro = (v: number) => v.toLocaleString("pt-BR");

const dia = (iso: null | string) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

/**
 * Quando o contrato fica pronto: 24 HORAS ÚTEIS depois do despacho.
 *
 * Lucas (06/09/2026): *"aqui pode trazer a data de entrega prevista"*, *"emissão de contrato 24
 * horas úteis"*.
 *
 * ⚠️ 24 HORAS ÚTEIS É UM DIA ÚTIL, e sexta vira segunda — a mesma conta de `prazoDeEmissao` na
 * Têmis, que é quem promete o prazo do outro lado. Duas contas para a mesma promessa dariam duas
 * datas para o mesmo contrato: a que o comercial lê aqui e a que o jurídico vê no card.
 */
function entregaPrevista(desde: null | string): string {
  if (!desde) return "—";
  const base = new Date(desde);
  if (Number.isNaN(base.getTime())) return "—";

  const fim = new Date(base.getTime());
  let restantes = 1;
  while (restantes > 0) {
    fim.setUTCDate(fim.getUTCDate() + 1);
    const semana = fim.getUTCDay();
    if (semana !== 0 && semana !== 6) restantes -= 1;
  }
  return fim.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  });
}

/**
 * As janelas do Panorama.
 *
 * ⚠️ A JANELA VALE PARA O DESEMPENHO, NUNCA PARA A FAIXA DO FLUXO. A faixa é o pipeline VIVO — "3
 * em assinatura" é verdade hoje, venha a proposta de que mês vier; filtrá-la faria a venda parada
 * desde julho desaparecer da tela em setembro, escondendo justamente o que precisa de atenção. A
 * régua está em `lib/hercules/fluxo-de-venda.ts`, com teste.
 */
const JANELAS: ReadonlyArray<{
  id: string;
  meses: null | number;
  rotulo: string;
}> = [
  { id: "mes", meses: 1, rotulo: "Este mês" },
  { id: "3m", meses: 3, rotulo: "3 meses" },
  { id: "12m", meses: 12, rotulo: "12 meses" },
  { id: "tudo", meses: null, rotulo: "Tudo" },
];

/** A competência de N meses atrás, no formato AAAA-MM que a rota espera. */
function competenciaDe(mesesAtras: number): string {
  const hoje = new Date();
  const d = new Date(
    Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - mesesAtras, 1),
  );
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Como a unidade aparece para quem vende: **quadra e lote**, e o recorte por baixo.
 *
 * ⚠️ O CÓDIGO DA UNIDADE NÃO VAI PARA A TELA. Lucas (03/09/2026), comparando as duas listas:
 * *"vamos deixar esse padrão do segundo print, 12 06 VOR; não vamos trabalhar com o código da
 * unidade, esse será de uso do backend (...) caso trazer, ter a conotação de código"*. "VOL0307" é
 * chave de sistema; quem está vendendo fala "lote 07 da quadra 03". A lista de propostas já
 * escrevia assim (o nome vem de bloco + lote), e a de disponíveis destoava.
 *
 * `VOL0307` → `{ recorte: "VOL", unidade: "03 07" }`. Código fora do padrão (apartamento, unidade
 * avulsa) volta inteiro no lugar da unidade: melhor um código à mostra do que um lote inventado.
 */
function comoSeEscreve(
  codigo: string,
  quadra: null | string,
  lote: null | string,
): { recorte: null | string; unidade: string } {
  if (quadra && lote) {
    const m = /^([A-Za-z]{2,4})/.exec(codigo.trim());
    return {
      recorte: m ? m[1]!.toUpperCase() : null,
      unidade: `${quadra} ${lote}`,
    };
  }

  const padrao = /^([A-Za-z]{2,4})(\d{2})(\d{2})$/.exec(codigo.trim());
  if (padrao) {
    return {
      recorte: padrao[1]!.toUpperCase(),
      unidade: `${padrao[2]} ${padrao[3]}`,
    };
  }
  return { recorte: null, unidade: codigo };
}

/**
 * "Quadra 03 · Lote 07" — o nome da unidade por extenso, como as modais o escrevem no título.
 *
 * ⚠️ É A MESMA FRASE QUE VAI NO WHATSAPP, de propósito: o corretor lê "Quadra 03 · Lote 07" no
 * celular e precisa reconhecer exatamente isso quando abrir a tela. "0307" na tela e "Quadra 03"
 * na mensagem seriam duas maneiras de dizer o mesmo lote, e alguém teria que traduzir uma na outra.
 */
function comoSeLe(u: UnidadeNoMapa): string {
  const escrita = comoSeEscreve(u.codigo, u.quadra, u.lote);
  const partes = escrita.unidade.split(" ");
  if (partes.length < 2) return escrita.unidade;
  return `Quadra ${partes[0]} · Lote ${partes[1]}`;
}

/**
 * Como a data se chama em cada etapa.
 *
 * ⚠️ "Desde" NÃO DIZ NADA (Lucas, 03/09/2026: *"colocar Data de faturamento (quando for
 * faturamento), Data de Reserva (quando for reserva), Data da Proposta (quando for proposta)"*).
 * Numa lista de faturamento, "desde 31/08" faz pensar em tempo parado; "Data de faturamento
 * 31/08" é o fato. E como a lista mostra uma etapa por vez, o cabeçalho da coluna pode dizer
 * exatamente qual data está ali.
 */
const ROTULO_DA_DATA: Record<string, string> = {
  assinatura: "Data da assinatura",
  cancelado: "Data do cancelamento",
  contrato: "Data do contrato",
  distrato: "Data do distrato",
  faturado: "Data de faturamento",
  proposta: "Data da proposta",
  reservado: "Data da reserva",
};

const rotuloDaData = (etapa: string) => ROTULO_DA_DATA[etapa] ?? "Data";


/**
 * A cor do ponto na linha do tempo.
 *
 * ⚠️ É A MESMA DA GRADE, de propósito. O coordenador já aprendeu que amarelo é reserva, azul é
 * proposta e grafite é assinatura olhando o quadro de lotes; o histórico usar outra paleta o
 * obrigaria a aprender duas. Cancelado e distratado saem em vermelho — antes ficavam no cinza das
 * transições comuns, escondidos no meio da lista.
 */
// ⚠️ QUEM CLASSIFICA É A LIB, junto de quem escreve os fatos (`classeDoFato`). A régua já morou
// aqui, procurando o radical "reservad", e ficou para trás quando o fato virou "Reserva criada":
// o ponto caiu no cinza de transição comum. Aqui fica só a tradução de família para cor.
const COR_DA_CLASSE: Record<ClasseDoFato, string> = {
  assinatura: COR_DA_ETAPA.assinatura,
  cancelado: T.danger,
  contrato: COR_DA_ETAPA.contrato,
  faturado: COR_DA_ETAPA.faturado,
  pagamento: T.ok,
  proposta: COR_DA_ETAPA.proposta,
  reserva: COR_DA_ETAPA.reservado,
  transicao: T.border,
};

function corDoEvento(e: EventoDaUnidade): string {
  return COR_DA_CLASSE[classeDoFato(e.fato, e.tipo)];
}

/** "31/08/26" — a data curta da coluna da linha do tempo. */
function diaCurto(iso: null | string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  // `noUncheckedIndexedAccess`: o grupo existe se o regex casou, mas o compilador não sabe.
  return m ? `${m[3]}/${m[2]}/${(m[1] ?? "").slice(2)}` : "—";
}

/** "14:20". Dois eventos do mesmo dia têm ordem, e num histórico ela importa. */
function hora(iso: null | string): string {
  const m = /[T ](\d{2}):(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[1]}:${m[2]}` : "";
}

/**
 * Como a proposta que caiu se chama.
 *
 * Sumiu junto com o painel antigo e voltou porque a ficha de um lote livre precisa dizer o que
 * aconteceu com a última — "cancelada", não "cancelado", porque o sujeito é a proposta.
 */
const ROTULO_TERMINAL: Record<string, string> = {
  cancelado: "Cancelada",
  distrato: "Distratada",
};

/**
 * A proposta está no caminho, ou já saiu dele?
 *
 * A lista das etapas vivas vem do núcleo (`ETAPAS_DO_FLUXO`), e não repetida aqui: é a mesma régua
 * que decide a cor do lote na grade e o que entra na faixa. Duplicá-la seria criar um segundo lugar
 * para alguém esquecer de mexer.
 */
const ehEtapaViva = (etapa: string) =>
  (ETAPAS_DO_FLUXO as readonly string[]).includes(etapa);

const MESES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
const mesCurto = (mes: string) => {
  const [ano, m] = mes.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${String(ano).slice(2)}`;
};

export function TelaVenda() {
  const [dados, setDados] = useState<FluxoDeVenda | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [cards, setCards] = useState<CardDeProduto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);

  // `emp` é o PRODUTO (o pai); `recorte` é o filho escolhido dentro dele, quando houver.
  const [emp, setEmp] = useState<string>("");
  const [recorte, setRecorte] = useState<string>("");
  const [visao, setVisao] = useState<"mesa" | "panorama">("panorama");
  const [etapa, setEtapa] = useState<"disponivel" | EtapaDoFluxo>("reservado");
  /**
   * O lugar guardado já foi lido? Só depois disso a tela consulta o servidor.
   *
   * ⚠️ ESPERAR CUSTA MENOS DO QUE CARREGAR DUAS VEZES. Sem esta trava a tela pedia o escopo INTEIRO
   * (5.528 unidades) e, um instante depois, pedia de novo já com o produto restaurado — duas
   * consultas pesadas por abertura, numa casa que já teve incidente de fatura por chamada demais.
   * E foi essa dobra que criou a corrida do "parou de filtrar": a primeira resposta chegava por
   * último e vencia.
   */
  const [lugarLido, setLugarLido] = useState(false);
  const [foco, setFoco] = useState<null | Foco>(null);
  const [simulando, setSimulando] = useState<null | UnidadeNoMapa>(null);
  const [reservando, setReservando] = useState<null | UnidadeNoMapa>(null);
  const [cancelando, setCancelando] = useState<null | UnidadeNoMapa>(null);
  /**
   * A unidade cujo envio para contrato está esperando confirmação.
   *
   * ⚠️ O CLIQUE DIRETO ERA UM RISCO (Lucas, 05/09/2026: *"tem que ter um botão para confirmar o
   * envio para contrato (...) pois senão pode clicar errado e dar problema"*). O botão fica no meio
   * de outros três, do mesmo tamanho, e o que ele dispara não volta: a venda muda de etapa, um
   * trabalho entra na fila do jurídico e o "Gerar proposta" apaga.
   */
  const [mandandoParaContrato, setMandandoParaContrato] =
    useState<null | UnidadeNoMapa>(null);
  const [enviandoContrato, setEnviandoContrato] = useState(false);
  /** A venda em contrato cujo cancelamento está sendo pedido à Têmis. */
  const [pedindoCancelamento, setPedindoCancelamento] =
    useState<null | UnidadeNoMapa>(null);
  const [enviandoPedido, setEnviandoPedido] = useState(false);
  const [propondo, setPropondo] = useState<null | UnidadeNoMapa>(null);
  const [recado, setRecado] = useState<null | string>(null);
  /** Sobe a cada carga do fluxo. O histórico da ficha o observa para refazer a busca dele. */
  const [versaoDosDados, setVersaoDosDados] = useState(0);
  const [modoDoEstoque, setModoDoEstoque] = useState<"grade" | "mapa">("grade");
  // Abre em 12 meses: o mês corrente sozinho, no dia 3, mostraria quase nada.
  const [janela, setJanela] = useState<string>("12m");

  // ⚠️ A ÚLTIMA CHAMADA É A QUE VALE, E ISSO NÃO É PRECAUÇÃO TEÓRICA. Sem este contador a tela
  // mostrou o escopo INTEIRO com o seletor marcando um produto só (Lucas, 05/09/2026: *"parou de
  // filtrar"* — 11 reservas na tela para 3 no banco). A corrida nasceu junto com a memória do
  // último produto: na abertura saem DUAS chamadas, a inicial sem filtro e a do produto restaurado
  // do `localStorage`. A sem filtro carrega 5.528 unidades e demora mais, então ela responde POR
  // ÚLTIMO e sobrescreve a resposta certa que já tinha chegado — o seletor fica certo e o conteúdo,
  // errado. Guardar o número do pedido e descartar o que não for o mais novo resolve os dois casos:
  // a restauração e o clique rápido entre produtos.
  const pedidoEmVoo = useRef(0);

  const carregar = useCallback(async (alvo: string, qualJanela: string) => {
    pedidoEmVoo.current += 1;
    const meu = pedidoEmVoo.current;
    setCarregando(true);
    setErro(null);
    try {
      const busca = new URLSearchParams();
      if (alvo) busca.set("emp", alvo);
      const meses = JANELAS.find((j) => j.id === qualJanela)?.meses ?? null;
      if (meses) {
        // `de` é o começo da janela e `ate` é o mês corrente: um intervalo fechado, para o
        // servidor não precisar saber que dia é hoje.
        busca.set("de", competenciaDe(meses - 1));
        busca.set("ate", competenciaDe(0));
      }
      const sufixo = busca.toString() ? `?${busca}` : "";
      const r = await fetch(`/api/incorporador/venda${sufixo}`, {
        cache: "no-store",
      });
      const j = (await r.json().catch(() => null)) as null | {
        data?: FluxoDeVenda;
        error?: string;
      };

      // Chegou tarde: outro pedido saiu depois deste, e é a resposta dele que vale.
      if (meu !== pedidoEmVoo.current) return;

      if (!r.ok || !j?.data) {
        setErro(j?.error ?? "Não foi possível carregar o fluxo de venda.");
        return;
      }
      setDados(j.data);
      // ⚠️ O SELO É O QUE FAZ O HISTÓRICO SE ATUALIZAR (Lucas, 05/09/2026: *"histórico tem que ser
      // atualizado quando fazemos alguma coisa em tempo real; reservei e não veio atualização"* e,
      // depois de gerar e enviar para contrato: *"histórico não atualiza"*). O efeito que busca o
      // histórico só dependia de `unidadeId`, e nenhuma das quatro ações muda o id do lote — a
      // ficha ficava mostrando os eventos de antes, inclusive de OUTRO cliente, enquanto o mapa,
      // a faixa e a lista já tinham andado. Incrementar aqui, no fim de cada carga, é o sinal de
      // que o servidor tem coisa nova para contar.
      setVersaoDosDados((v) => v + 1);
    } catch {
      if (meu === pedidoEmVoo.current)
        setErro("Não foi possível carregar o fluxo de venda.");
    } finally {
      // ⚠️ O "CARREGANDO" TAMBÉM É DO ÚLTIMO. Sem esta conferência, a resposta velha apagava o aviso
      // de carregando enquanto o pedido novo ainda estava em voo, e a tela ficava parada parecendo
      // pronta, mostrando o conteúdo do pedido anterior.
      if (meu === pedidoEmVoo.current) setCarregando(false);
    }
  }, []);

  /**
   * Leva a proposta aceita para a fase de contrato.
   *
   * ⚠️ COM MODAL, E EU TINHA DECIDIDO O CONTRÁRIO. O primeiro desenho mandava direto — "é o
   * coordenador dizendo que o cliente aceitou, não há o que perguntar" —, e o Lucas pediu a
   * confirmação (05/09/2026: *"tem que ter um botão para confirmar o envio para contrato, pois
   * senão pode clicar errado e dar problema"*). Ele está certo: o botão fica no meio de outros três,
   * do mesmo tamanho, e o que ele dispara não volta — a venda muda de etapa, um trabalho entra na
   * fila do jurídico e o "Gerar proposta" apaga. A modal mostra a PROPOSTA (COD, cliente, plano,
   * valor), que é o que faz alguém perceber que clicou no lote errado.
   *
   * ⚠️ E ELA RECARREGA A TELA. O lote muda de cor no mapa, a faixa do funil anda uma casa e o
   * histórico ganha a linha nova — sem isso, a única prova de que funcionou seria o recado verde.
   */
  const enviarParaContrato = useCallback(
    async (u: null | UnidadeNoMapa) => {
      if (!u) return;
      setEnviandoContrato(true);
      try {
        // ⚠️ O ID DA PROPOSTA QUE A MODAL MOSTROU VAI JUNTO. A rota já sabe recusar ("Esta unidade
        // já tem outra proposta. Recarregue a tela antes de seguir"), e a trava nunca disparava
        // porque ninguém mandava o campo. Com a confirmação no meio do caminho, a janela ficou
        // maior: enquanto a modal está aberta com o COD do João, outra pessoa pode cancelar essa
        // proposta e gerar uma da Maria no mesmo lote — e o clique moveria a da Maria, com o card
        // saindo no nome dela. A modal existe para ele dizer "não era essa"; ela não pode mentir.
        const viva = (dados?.lista ?? []).find(
          (l) => l.unidadeId === u.id && ehEtapaViva(l.etapa),
        );
        const r = await fetch("/api/incorporador/venda/contrato", {
          body: JSON.stringify({
            propostaId: viva?.id ?? null,
            unidadeId: u.id,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const j = (await r.json().catch(() => null)) as null | {
          data?: {
            avisoDaTemis?: null | string;
            codigo?: string;
            trabalhoId?: null | string;
          };
          error?: string;
        };
        if (!r.ok) {
          setRecado(j?.error ?? "Não foi possível enviar para contrato.");
          return;
        }
        const cod = j?.data?.codigo ? `${j.data.codigo} · ` : "";
        // ⚠️ O RECADO DIZ SE O CONTRATO CHEGOU NA TÊMIS. A venda anda de etapa mesmo quando a fila
        // do jurídico recusa o trabalho — e sem esta frase o coordenador sairia achando que o
        // documento está sendo feito, quando ninguém do outro lado recebeu pedido nenhum.
        setRecado(
          j?.data?.trabalhoId
            ? `${cod}${comoSeLe(u)} foi para contrato: a proposta foi entregue à Têmis.`
            : `${cod}${comoSeLe(u)} foi para a fase de contrato, mas a proposta NÃO chegou à Têmis${
                j?.data?.avisoDaTemis ? ` (${j.data.avisoDaTemis})` : ""
              }. Avise o jurídico.`,
        );
        void carregar(recorte || emp, janela);
      } catch {
        setRecado("Não foi possível enviar para contrato agora.");
      } finally {
        setEnviandoContrato(false);
        setMandandoParaContrato(null);
      }
    },
    [carregar, emp, janela, recorte],
  );

  /**
   * O PEDIDO DE CANCELAMENTO DEPOIS DO CONTRATO.
   *
   * ⚠️ A ÚNICA COISA QUE MUDA NO PANTEON É O CARIMBO DO PEDIDO. A etapa da venda fica como está: se
   * a tela devolvesse o lote ao estoque aqui, ele poderia ser vendido de novo com um contrato ainda
   * de pé do outro lado. O que anda é a fila do jurídico.
   */
  const pedirCancelamento = useCallback(
    async (
      u: null | UnidadeNoMapa,
      resposta: {
        ajuste: null | { assinaturaCompleta: boolean; houvePagamento: boolean };
        motivo: string;
      },
    ) => {
      if (!u) return;
      setEnviandoPedido(true);
      try {
        const r = await fetch(
          "/api/incorporador/venda/cancelamento-de-contrato",
          {
            body: JSON.stringify({ ...resposta, unidadeId: u.id }),
            headers: { "content-type": "application/json" },
            method: "POST",
          },
        );
        const j = (await r.json().catch(() => null)) as null | {
          data?: { codigo?: string; devolveValores?: boolean; tipo?: string };
          error?: string;
        };
        if (!r.ok) {
          // ⚠️ A MODAL FICA ABERTA NO ERRO. Ela guarda duas respostas e um motivo escrito à mão;
          // fechar em qualquer falha (rede, 502 da Têmis) obriga a pessoa a responder tudo de novo
          // para tentar outra vez — e a segunda digitação do motivo nunca sai igual à primeira.
          setRecado(j?.error ?? "Não foi possível pedir o cancelamento.");
          return;
        }
        setPedindoCancelamento(null);
        const cod = j?.data?.codigo ? `${j.data.codigo} · ` : "";
        // ⚠️ O RECADO DIZ O TIPO, porque é a informação que muda o que acontece depois: distrato
        // com devolução manda o jurídico atrás dos dados bancários do cliente.
        setRecado(
          `${cod}${comoSeLe(u)}: pedido de ${
            j?.data?.tipo === "distrato" ? "distrato" : "cancelamento"
          } aberto na Têmis${
            j?.data?.devolveValores ? ", com devolução de valores" : ""
          }. A venda continua em contrato até o jurídico concluir.`,
        );
        void carregar(recorte || emp, janela);
      } catch {
        setRecado("Não foi possível pedir o cancelamento agora.");
      } finally {
        setEnviandoPedido(false);
      }
    },
    [carregar, emp, janela, recorte],
  );

  // ── O LUGAR ONDE ELE PAROU, RESTAURADO ANTES DA PRIMEIRA CONSULTA ────────
  //
  // ⚠️ DEPOIS DE MONTAR, e não no `useState` inicial: `localStorage` não existe no servidor, e ler
  // ali faria o HTML do servidor divergir do primeiro render do cliente.
  //
  // ⚠️ CADA CAMPO É CONFERIDO CONTRA A LISTA VÁLIDA DE HOJE. Uma etapa que saiu do fluxo, uma
  // janela que deixou de existir ou um recorte de outro produto voltariam como estado impossível —
  // e a tela renderizaria uma faixa vazia sem dizer por quê. O `emp` é a exceção: ele só pode ser
  // conferido contra a lista de produtos, que chega depois, e por isso é validado lá embaixo.
  useEffect(() => {
    const lugar = lugarGuardado();

    if (lugar.visao === "mesa" || lugar.visao === "panorama")
      setVisao(lugar.visao);
    if (lugar.modoDoEstoque === "grade" || lugar.modoDoEstoque === "mapa") {
      setModoDoEstoque(lugar.modoDoEstoque);
    }
    if (lugar.janela && JANELAS.some((j) => j.id === lugar.janela))
      setJanela(lugar.janela);
    if (
      lugar.etapa === "disponivel" ||
      (lugar.etapa && ETAPAS_DO_FLUXO.some((e) => e === lugar.etapa))
    ) {
      setEtapa(lugar.etapa as "disponivel" | EtapaDoFluxo);
    }
    if (lugar.emp) setEmp(lugar.emp);
    if (lugar.recorte) setRecorte(lugar.recorte);

    setLugarLido(true);
  }, []);

  // ⚠️ O RECORTE SUBSTITUI O PAI NA CONSULTA, e não soma a ele: o filho já é um pedaço do pai, e
  // mandar os dois pediria o mesmo lote duas vezes. Sem recorte, vale o pai — e aí o servidor
  // expande para TODOS os filhos, deixando o espelho de fora.
  useEffect(() => {
    if (!lugarLido) return;
    void carregar(recorte || emp, janela);
  }, [carregar, emp, janela, lugarLido, recorte]);

  // ⚠️ GUARDA O LUGAR A CADA MUDANÇA, e não em cada `onClick`: são seis estados trocados em oito
  // lugares diferentes da tela, e um `guardar` esquecido num deles seria um campo que volta errado
  // — o tipo de defeito que ninguém percebe até o F5 devolver metade do lugar.
  useEffect(() => {
    if (!lugarLido) return;
    guardarLugar({ emp, etapa, janela, modoDoEstoque, recorte, visao });
  }, [emp, etapa, janela, lugarLido, modoDoEstoque, recorte, visao]);

  // DUAS FONTES, e cada uma responde uma pergunta diferente:
  //   • o PAINEL diz quais são os produtos e quem é filho de quem (é ele que agrupa o pai);
  //   • os CARDS dizem qual produto tem masterplan publicado.
  // O painel não carrega masterplan e a rota de cards não agrupa pai/filho — juntar as duas num
  // endpoint só seria a terceira lista de empreendimentos para manter viva.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const [rPainel, rCards] = await Promise.all([
          fetch("/api/incorporador/produtos/painel", { cache: "no-store" }),
          fetch("/api/incorporador/produtos", { cache: "no-store" }),
        ]);

        if (rPainel.ok) {
          const j = (await rPainel.json()) as {
            data?: {
              linhas?: {
                filhos?: Produto["filhos"];
                id: string;
                nome: string;
              }[];
            };
          };
          if (vivo) {
            const lista = (j.data?.linhas ?? []).map((l) => ({
              filhos: l.filhos ?? [],
              id: l.id,
              nome: l.nome,
            }));
            setProdutos(lista);

            // ⚠️ O PRODUTO RESTAURADO PRECISA AINDA EXISTIR. Ele foi aplicado antes desta lista
            // chegar (para a tela não consultar duas vezes), então é aqui que se confere: escopo
            // muda, produto sai do ar, e um id guardado que não existe mais pediria uma tela que o
            // servidor recusa com 404. Some o produto, some o recorte junto — um filho sem o pai
            // escolhido é um filtro que a tela não sabe desenhar.
            setEmp((atual) => {
              if (atual && !lista.some((p) => p.id === atual)) {
                setRecorte("");
                return "";
              }
              return atual;
            });
          }
        }

        if (rCards.ok) {
          // ⚠️ O PAYLOAD É `{ data: { produtos } }`, e não a lista solta: eu li errado uma vez e a
          // tela quebrou com "produtos.filter is not a function" antes de desenhar qualquer coisa.
          const j = (await rCards.json()) as {
            data?: { produtos?: CardDeProduto[] };
          };
          if (vivo) setCards(j.data?.produtos ?? []);
        }
      } catch {
        // Sem as listas, a tela mostra tudo e não oferece filtro. Ela não depende disso para viver.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // Nas cinco etapas do fluxo a lista é de PROPOSTAS; no estoque não existe proposta, e o que o
  // coordenador precisa ver é a lista de lotes livres para vender.
  const daEtapa = useMemo(
    () =>
      etapa === "disponivel"
        ? []
        : (dados?.lista ?? []).filter((l) => l.etapa === etapa),
    [dados, etapa],
  );

  const livres = useMemo(
    () =>
      etapa === "disponivel"
        ? (dados?.mapa ?? []).flatMap((g) =>
            g.unidades
              .filter((u) => u.etapa === "disponivel")
              .map((u) => ({ ...u, grupo: g.grupo })),
          )
        : [],
    [dados, etapa],
  );

  // O mapa do PRODUTO ESCOLHIDO, e só dele: no consolidado não existe um masterplan único.
  const produtoEscolhido = useMemo(
    () => (emp ? (produtos.find((p) => p.id === emp) ?? null) : null),
    [emp, produtos],
  );

  // ⚠️ O MASTERPLAN É DO PAI, sempre. O desenho é do loteamento inteiro; o recorte escolhe QUAIS
  // lotes olhar, não outro desenho. Os cards trazem o mapa por id do C2X ou pelo id do card, e o
  // pai do painel ("pai:<uuid>") não bate com nenhum dos dois — por isso o encontro é pelo NOME,
  // que é o que os dois lados têm em comum.
  // ⚠️ QUEM TEM ESPELHO VEM DO CADASTRO, e não mais de uma lista no código. Até 10/09/2026 o
  // botão dependia de `MASTERPLANS_INTERNOS` — cinco arquivos HTML gerados à mão —, e três
  // empreendimentos com masterplan publicado ficavam sem espelho na Mesa: Veredas do Ouro, Jardim
  // das Gerais e Villa Paris. Lucas: *"pq não tem o espelho no veredas aqui"*. Agora a rota
  // responde quais têm mapa publicado em `hercules_masterplans`, e a lista cresce sozinha a cada
  // importação.
  const [comEspelho, setComEspelho] = useState<Set<string>>(new Set());

  useEffect(() => {
    let vivo = true;
    fetch("/api/incorporador/espelho?parte=disponiveis")
      .then((r) => (r.ok ? r.json() : null))
      .then((corpo: null | { data?: { codigos?: string[] } }) => {
        if (vivo && corpo?.data?.codigos) setComEspelho(new Set(corpo.data.codigos));
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  /** O código do produto aberto que TEM mapa — é ele que o espelho carrega. */
  const codeDoEspelho = useMemo(() => {
    if (!produtoEscolhido) return null;
    const nome = produtoEscolhido.nome.trim().toLowerCase();
    const card = cards.find((c) => c.nome.trim().toLowerCase() === nome);
    for (const code of [card?.code, ...(card?.enterpriseIds ?? [])]) {
      const limpo = String(code ?? "").trim().toUpperCase();
      if (limpo && comEspelho.has(limpo)) return limpo;
    }
    return null;
  }, [cards, comEspelho, produtoEscolhido]);

  const mapaDoProduto = useMemo(() => {
    if (!produtoEscolhido) return null;
    const nome = produtoEscolhido.nome.trim().toLowerCase();
    return cards.find((c) => c.nome.trim().toLowerCase() === nome) ?? null;
  }, [cards, produtoEscolhido]);

  // Trocar para "todos" (ou para um produto sem mapa) volta para a grade: deixar o modo
  // "mapa" aceso sem mapa para mostrar daria um painel vazio sem explicação.
  useEffect(() => {
    if (!codeDoEspelho) setModoDoEstoque("grade");
  }, [codeDoEspelho]);

  return (
    // ⚠️ A TELA TEM A ALTURA DO <main> E NÃO ROLA. O portal comercial já deixa o main com
    // `height:100dvh` e rolagem própria (TEMA_CSS, `.inc--comercial .inc-conteudo`); aqui o
    // conteúdo passa a caber nele, e quem rola são os painéis. Cabeçalho e faixa do fluxo ficam
    // sempre à vista, que é o ponto: eles são a bússola da tela.
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* ⚠️ SEM TÍTULO NEM SUBTÍTULO (Lucas, 03/09/2026: *"tirar essa venda, e o texto abaixo,
          trazer o filtro do empreendimento mais a mesa (...) mais o Panorama"*). A aba do menu já
          diz Venda, e o subtítulo explicava a tela para quem a usa o dia inteiro. O que sobra é o
          que se opera: à esquerda o que estou vendo, à direita sobre o quê.

          "Mesa" virou "Venda" e "Panorama" virou "Painel", também a pedido dele. */}
      <header
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <Pilula
            ativo={visao === "panorama"}
            onClick={() => setVisao("panorama")}
            rotulo="Painel"
          />
          <Pilula
            ativo={visao === "mesa"}
            onClick={() => setVisao("mesa")}
            rotulo="Venda"
          />
        </div>

        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          {/* A janela só muda o Panorama; na Mesa ela ficaria sem efeito e confundiria. */}
          {visao === "panorama" ? (
            <select
              aria-label="Período"
              onChange={(e) => setJanela(e.target.value)}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderRadius: 999,
                color: T.text,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: "7px 12px",
              }}
              value={janela}
            >
              {JANELAS.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.rotulo}
                </option>
              ))}
            </select>
          ) : null}

          {produtos.length > 1 ? (
            <select
              aria-label="Empreendimento"
              onChange={(e) => {
                setEmp(e.target.value);
                // Trocar de produto sem zerar o recorte deixaria um filho de OUTRO pai escolhido.
                setRecorte("");
                setFoco(null);
              }}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderRadius: 999,
                color: T.text,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: "7px 12px",
              }}
              value={emp}
            >
              <option value="">Todos os empreendimentos</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          ) : null}

          {/* ⚠️ O SUBFILTRO SÓ APARECE COM FILHOS. Pedido do Lucas: um Vale do Ouro no seletor, e o
              recorte (Cecílio, Lino) num filtro à parte. Produto sem filho não mostra nada — um
              seletor com uma opção só é ruído. */}
          {(produtoEscolhido?.filhos.length ?? 0) > 0 ? (
            <select
              aria-label="Recorte do empreendimento"
              onChange={(e) => {
                setRecorte(e.target.value);
                setFoco(null);
              }}
              style={{
                background: T.card,
                border: `1px solid ${T.gold}`,
                borderRadius: 999,
                color: T.text,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: "7px 12px",
              }}
              value={recorte}
            >
              <option value="">Todo o {produtoEscolhido?.nome}</option>
              {produtoEscolhido?.filhos.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </header>

      {erro ? (
        <p
          style={{
            background: T.dangerBg,
            border: `1px solid ${T.danger}`,
            borderRadius: 10,
            color: T.danger,
            fontSize: 13.5,
            fontWeight: 600,
            margin: 0,
            padding: "10px 13px",
          }}
        >
          {erro}
        </p>
      ) : null}

      {/* ── A FAIXA DO FLUXO, SÓ NA MESA ─────────────────────────────────── */}
      {/* ⚠️ Fora do Panorama de propósito: lá embaixo o funil já conta a mesma história, e ter os
          mesmos números em dois desenhos na mesma tela é convite a duvidar de qual está certo. */}
      <div
        style={{
          display: visao === "mesa" ? "grid" : "none",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        }}
      >
        {FLUXO.map((passo) => {
          const dado = dados?.fluxo.find((f) => f.etapa === passo.etapa);
          const ativo = etapa === passo.etapa;
          const Icone = passo.icone;
          return (
            <button
              key={passo.etapa}
              onClick={() => {
                setEtapa(passo.etapa);
                setFoco(null);
                setVisao("mesa");
              }}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderLeft: `4px solid ${passo.cor}`,
                borderRadius: 12,
                color: T.text,
                cursor: "pointer",
                font: "inherit",
                outline: ativo ? `2px solid ${passo.cor}` : "none",
                outlineOffset: 1,
                padding: "12px 13px",
                textAlign: "left",
              }}
              type="button"
            >
              <span
                style={{
                  alignItems: "center",
                  color: T.muted,
                  display: "flex",
                  fontSize: 10.5,
                  fontWeight: 700,
                  gap: 6,
                  letterSpacing: ".07em",
                  textTransform: "uppercase",
                }}
              >
                <Icone aria-hidden="true" size={13} />
                {passo.rotulo}
              </span>
              <div
                style={{
                  fontSize: 25,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 650,
                  lineHeight: 1.05,
                  marginTop: 7,
                }}
              >
                {carregando ? "—" : inteiro(dado?.quantidade ?? 0)}
              </div>
              <div
                style={{
                  color: T.muted,
                  fontSize: 11.5,
                  fontVariantNumeric: "tabular-nums",
                  marginTop: 3,
                }}
              >
                {carregando ? "carregando…" : dinheiro(dado?.vgv ?? 0)}
              </div>
            </button>
          );
        })}
      </div>

      {/* ⚠️ A FAIXA FICA FORA DO FLEX DE BAIXO. Ela nasceu dentro dele e virou uma COLUNA verde
          vazia do lado do estoque, ocupando a altura toda da tela (Lucas, 04/09/2026: *"não gostei
          desse painel na esquerda mostrando a reserva"*). Aqui ela é o que devia ser: uma linha
          acima do conteúdo, que empurra o resto para baixo e some quando fechada. */}
      {recado ? (
        <div
          style={{
            alignItems: "center",
            background: T.okBg,
            border: `1px solid ${T.ok}`,
            borderRadius: 10,
            color: T.ok,
            display: "flex",
            fontSize: 12.5,
            gap: 12,
            justifyContent: "space-between",
            margin: "0 0 12px",
            padding: "9px 12px",
          }}
        >
          <span>{recado}</span>
          <button
            onClick={() => setRecado(null)}
            style={{
              background: "transparent",
              border: "none",
              color: T.ok,
              cursor: "pointer",
              font: "inherit",
              fontSize: 12,
              fontWeight: 700,
              padding: 0,
            }}
            type="button"
          >
            fechar
          </button>
        </div>
      ) : null}
      <div style={{ display: "flex", flex: "1 1 auto", minHeight: 0 }}>
        {/* ⚠️ A MODAL VIVE AQUI, e não dentro da Mesa: ela cobre a tela inteira, e um <dialog> preso
          a uma coluna herdaria o `overflow: hidden` dela. */}
        {simulando ? (
          <ModalDoSimulador
            // ⚠️ O PISO É DO EMPREENDIMENTO DO LOTE, e não do escopo: num pai com filhos há mais de
            // um produto na tela, e eles podem ter mínimos diferentes.
            entradaMinimaPercentual={
              dados?.entradaMinima?.[simulando.enterpriseId] ?? null
            }
            nome={mapaDoProduto?.nome ?? "Simulação"}
            onFechar={() => setSimulando(null)}
            planos={dados?.planos ?? []}
            unidade={simulando}
          />
        ) : null}

        {/* ⚠️ A MODAL DE RESERVA VIVE AQUI PELO MESMO MOTIVO DA DO SIMULADOR: cobre a tela toda, e
          presa a uma coluna herdaria o `overflow: hidden` dela. */}
        {reservando ? (
          <ModalDeReserva
            onFechar={() => setReservando(null)}
            onReservado={(mensagem) => {
              setReservando(null);
              setRecado(mensagem);
              // A unidade mudou de situação: a tela recarrega para o mapa, a grade e o funil
              // contarem a reserva nova. Sem isso o lote continuaria verde até o próximo F5.
              void carregar(recorte || emp, janela);
            }}
            unidade={{
              id: reservando.id,
              nome: comoSeLe(reservando),
              produto: mapaDoProduto?.nome ?? "",
            }}
            valorDaUnidade={reservando.preco}
          />
        ) : null}

        {/* ⚠️ CANCELAR É O OUTRO CAMINHO DA RESERVA (Lucas, 04/09/2026: *"da reserva eu tenho dois
          caminhos, gerar proposta ou cancelar"*), e por isso mora ao lado dela, com o mesmo
          desfecho: fecha, recarrega a tela e deixa o recado na faixa. */}
        {/* ⚠️ A CONFIRMAÇÃO MOSTRA A PROPOSTA, e não uma pergunta genérica. "Tem certeza?" não ajuda
          ninguém a perceber que clicou no lote errado; ver o COD, o cliente e o valor é o que faz
          alguém dizer "não era essa". Os dados saem da lista já carregada — a mesma proposta viva
          que a ficha mostra —, sem uma segunda ida ao servidor para confirmar o que está na tela. */}
        {mandandoParaContrato
          ? (() => {
              const viva = (dados?.lista ?? []).find(
                (l) =>
                  l.unidadeId === mandandoParaContrato.id &&
                  ehEtapaViva(l.etapa),
              );
              return (
                <ModalDeContrato
                  aoConfirmar={() =>
                    void enviarParaContrato(mandandoParaContrato)
                  }
                  aoFechar={() => setMandandoParaContrato(null)}
                  enviando={enviandoContrato}
                  proposta={{
                    cliente: viva?.cliente ?? null,
                    codigo: viva?.codigo ?? null,
                    imobiliaria: viva?.imobiliaria ?? null,
                    plano: viva?.plano ?? null,
                    produto: mapaDoProduto?.nome ?? "",
                    unidade: comoSeLe(mandandoParaContrato),
                    valor: viva?.valor ?? null,
                  }}
                />
              );
            })()
          : null}

        {/* ⚠️ DEPOIS DO CONTRATO O CANCELAMENTO É UM PEDIDO, e por isso é outra modal: as duas
          perguntas que classificam o caso (assinou? pagou?) não existem no cancelamento da reserva
          nem no da proposta, e a promessa aqui é outra — a venda NÃO volta ao estoque. */}
        {pedindoCancelamento
          ? (() => {
              const viva = (dados?.lista ?? []).find(
                (l) =>
                  l.unidadeId === pedindoCancelamento.id &&
                  ehEtapaViva(l.etapa),
              );
              return (
                <ModalDePedidoDeCancelamento
                  aoConfirmar={(resposta) =>
                    void pedirCancelamento(pedindoCancelamento, resposta)
                  }
                  aoFechar={() => setPedindoCancelamento(null)}
                  enviando={enviandoPedido}
                  venda={{
                    cliente: viva?.cliente ?? null,
                    codigo: viva?.codigo ?? null,
                    unidade: comoSeLe(pedindoCancelamento),
                    unidadeId: pedindoCancelamento.id,
                  }}
                />
              );
            })()
          : null}

        {cancelando ? (
          <ModalDeCancelamento
            // ⚠️ O ALVO SAI DA ETAPA DA UNIDADE, e não de um segundo estado: são os dois únicos
            // pontos do fluxo em que o botão acende, e guardar o alvo à parte abriria a chance de
            // ele discordar da unidade que está na tela — cancelar a proposta de um lote reservado.
            alvo={cancelando.etapa === "proposta" ? "proposta" : "reserva"}
            onCancelada={(mensagem) => {
              setCancelando(null);
              setRecado(mensagem);
              // O lote voltou a ser vendável: sem recarregar, ele continuaria amarelo até o F5.
              void carregar(recorte || emp, janela);
            }}
            onFechar={() => setCancelando(null)}
            // ⚠️ A PROPOSTA QUE ESTA TELA ESTÁ VENDO, não a que o servidor achar. Mesma regra do
            // painel (a viva da unidade); com ela o servidor recusa o cancelamento quando a unidade
            // ganhou outra proposta desde que esta aba carregou — ver a trava no corpo do PATCH.
            propostaId={
              (dados?.lista ?? []).find(
                (l) => l.unidadeId === cancelando.id && ehEtapaViva(l.etapa),
              )?.id ?? null
            }
            unidade={{
              id: cancelando.id,
              nome: comoSeLe(cancelando),
              produto: mapaDoProduto?.nome ?? "",
            }}
          />
        ) : null}

        {/* ⚠️ O OUTRO CAMINHO DA RESERVA, e mora ao lado do cancelamento pelo mesmo motivo — cobre a
          tela inteira e presa a uma coluna herdaria o `overflow: hidden` dela. O desfecho também é
          o mesmo: fecha, deixa o recado na faixa com o COD na frente e recarrega, porque o lote sai
          de "reservado" e entra em "proposta" — sem recarregar ele continuaria na etapa antiga na
          faixa, na grade e no mapa até o F5. */}
        {propondo ? (
          <ModalDeProposta
            onFechar={() => setPropondo(null)}
            onGerada={(mensagem) => {
              setPropondo(null);
              setRecado(mensagem);
              void carregar(recorte || emp, janela);
            }}
            unidade={{
              id: propondo.id,
              nome: comoSeLe(propondo),
              produto: mapaDoProduto?.nome ?? "",
            }}
          />
        ) : null}

        {visao === "mesa" ? (
          <Mesa
            aoFocar={setFoco}
            aoCancelar={setCancelando}
            aoEnviarParaContrato={setMandandoParaContrato}
            versaoDosDados={versaoDosDados}
            aoGerarProposta={setPropondo}
            aoPedirCancelamento={setPedindoCancelamento}
            aoReservar={setReservando}
            aoSimular={setSimulando}
            aoTrocarModo={setModoDoEstoque}
            codeDoEspelho={codeDoEspelho}
            carregando={carregando}
            dados={dados}
            etapa={etapa}
            foco={foco}
            lista={daEtapa}
            livres={livres}
            modo={modoDoEstoque}
          />
        ) : (
          <Panorama dados={dados} />
        )}
      </div>
    </div>
  );
}

// ── A MESA ──────────────────────────────────────────────────────────────────

function Mesa({
  aoCancelar,
  aoEnviarParaContrato,
  aoFocar,
  aoGerarProposta,
  aoPedirCancelamento,
  aoReservar,
  aoSimular,
  aoTrocarModo,
  codeDoEspelho,
  carregando,
  dados,
  etapa,
  foco,
  lista,
  livres,
  modo,
  versaoDosDados,
}: {
  aoCancelar: (u: null | UnidadeNoMapa) => void;
  aoEnviarParaContrato: (u: null | UnidadeNoMapa) => void;
  /** Sobe a cada carga do fluxo: é o sinal que faz o histórico da ficha se refazer. */
  versaoDosDados: number;
  aoFocar: (f: null | Foco) => void;
  aoGerarProposta: (u: null | UnidadeNoMapa) => void;
  aoPedirCancelamento: (u: null | UnidadeNoMapa) => void;
  aoReservar: (u: null | UnidadeNoMapa) => void;
  aoSimular: (u: null | UnidadeNoMapa) => void;
  aoTrocarModo: (m: "grade" | "mapa") => void;
  carregando: boolean;
  /** O código do produto que TEM masterplan publicado. `null` esconde o botão "Espelho". */
  codeDoEspelho: null | string;
  dados: FluxoDeVenda | null;
  etapa: "disponivel" | EtapaDoFluxo;
  foco: null | Foco;
  lista: FluxoDeVenda["lista"];
  livres: (UnidadeNoMapa & { grupo: string })[];
  modo: "grade" | "mapa";
}) {
  const rotulo = FLUXO.find((f) => f.etapa === etapa)?.rotulo ?? "Propostas";

  // ⚠️ O CLIQUE NO LOTE NÃO PRECISA MAIS DE PONTE ENTRE DOCUMENTOS. Enquanto o espelho era um
  // <iframe> de HTML gerado, a ficha só reagia porque esta tela injetava um listener no documento
  // de dentro a cada `onLoad`. Agora o mapa é um componente React desta mesma árvore, e o clique
  // chega direto pelo `aoClicarNoLote` — sem escutar documento alheio e sem depender de o iframe
  // recarregar no tema certo.

  // ⚠️ BUSCA E FILTRO SÃO PADRÃO EM VISÃO ANALÍTICA (Lucas, 03/09/2026: *"no analítico, coloca
  // filtros, buscar. Sempre ter isso como padrão em visões analíticas"*). A busca zera ao trocar de
  // etapa: o texto que fazia sentido em "reserva" quase nunca faz em "faturamento", e um filtro
  // esquecido mostra lista vazia sem explicar por quê.
  // A proposta cuja prévia está aberta. Null = nenhuma.
  const [previaDe, setPreviaDe] = useState<null | string>(null);
  const [busca, setBusca] = useState("");
  const [imobiliaria, setImobiliaria] = useState("");
  const [quadra, setQuadra] = useState("");
  useEffect(() => {
    setBusca("");
    setImobiliaria("");
    setQuadra("");
  }, [etapa]);

  const procurado = normalizar(busca);

  const imobiliarias = useMemo(
    () =>
      [
        ...new Set(
          lista
            .map((l) => l.imobiliaria)
            .filter((n): n is string => Boolean(n)),
        ),
      ].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [lista],
  );

  const listaFiltrada = useMemo(
    () =>
      lista.filter(
        (l) =>
          (!imobiliaria || l.imobiliaria === imobiliaria) &&
          // ⚠️ O COD ENTRA NA BUSCA, e é o primeiro lugar em que alguém o usa: quem recebeu o
          // número no WhatsApp digita ele aqui para achar a venda.
          (contem(l.unidade, procurado) ||
            contem(l.codigo, procurado) ||
            contem(l.cliente, procurado) ||
            contem(l.imobiliaria, procurado) ||
            contem(l.produto, procurado)),
      ),
    [imobiliaria, lista, procurado],
  );

  const quadras = useMemo(
    () =>
      [...new Set(livres.map((u) => u.quadra ?? u.grupo))].sort((a, b) =>
        a.localeCompare(b, "pt-BR", { numeric: true }),
      ),
    [livres],
  );

  const livresFiltrados = useMemo(
    () =>
      livres.filter((u) => {
        const nome = comoSeEscreve(u.codigo, u.quadra ?? u.grupo, u.lote);
        return (
          (!quadra || (u.quadra ?? u.grupo) === quadra) &&
          (contem(nome.unidade, procurado) ||
            contem(nome.recorte, procurado) ||
            contem(u.codigo, procurado))
        );
      }),
    [livres, procurado, quadra],
  );
  const estoque = dados?.totais.estoque ?? {};
  // ⚠️ SÓ AS PRIMEIRAS QUADRAS. São 5.528 unidades no escopo inteiro: desenhar todas trava o
  // navegador e ninguém lê. Com um empreendimento escolhido, o mapa dele cabe inteiro.
  const grupos = (dados?.mapa ?? []).slice(0, 30);

  // O que o painel mostra. Vindo do mapa, a proposta é achada pelo id da unidade — a mais recente,
  // porque a lista já chega ordenada por `etapa_desde` decrescente.
  // ⚠️ O RETRATO DO CLIQUE ENVELHECE, E ELE MANDA EM QUATRO COISAS. `foco` guarda o OBJETO da
  // unidade como ela estava quando alguém clicou nela, e nada o ressincroniza depois que a tela
  // recarrega: quem reserva, gera a proposta e volta a olhar a MESMA ficha vê o mapa repintado e a
  // trilha do fluxo em "Proposta" — mas o chip continua dizendo "Reserva", o botão continua
  // dizendo "Cancelar reserva", a modal fala com a rota da RESERVA (409: "Esta reserva já virou
  // proposta. O cancelamento é o da proposta", apontando para um botão que a tela não oferece), e
  // depois de um cancelamento bem-sucedido o "Reservar" segue apagado num lote já disponível.
  // Procurar a versão fresca no `mapa` recém-carregado conserta os quatro de uma vez; o retrato só
  // permanece quando a unidade saiu do recorte atual, e aí ele é tudo o que existe.
  //
  // ⚠️ E A LISTA TAMBÉM PRECISA CHEGAR NA UNIDADE. Clicar numa linha do analítico foca uma
  // PROPOSTA, não um lote — e enquanto `unidadeEmFoco` só olhava o foco do tipo "unidade", a ficha
  // aberta pela lista vinha com os quatro botões apagados dizendo "Escolha uma unidade", numa tela
  // que estava mostrando o cliente, o valor e o histórico daquele lote. Pela grade funcionava, e a
  // diferença não tinha explicação nenhuma para quem usa. A proposta carrega o `unidadeId`
  // justamente para isto (ver `LinhaDaLista.unidadeId`): as duas portas levam ao mesmo lote.
  // A regra vive em `lib/hercules/unidade-em-foco.ts`, pura e com teste: ela já errou das duas
  // pontas no mesmo dia (retrato velho e lista sem lote), e cada erro apagou os quatro botões numa
  // ficha que estava mostrando o lote certo.
  const unidadeEmFoco = acharUnidadeEmFoco(
    foco,
    (dados?.mapa ?? []).flatMap((g) => g.unidades),
  );
  // ⚠️ SÓ A PROPOSTA VIVA VIRA A FICHA DA UNIDADE. O Lucas pegou isto olhando o VOC 06 07: o lote
  // aparecia "Disponível" e a ficha mostrava cliente, imobiliária, plano e "Data do cancelamento" —
  // eu casava pelo id da unidade sem olhar a etapa, e pegava a proposta CANCELADA como se fosse a
  // atual. Num lote livre isso é pior do que não mostrar nada: sugere que o lote tem dono.
  const propostasDaUnidade = unidadeEmFoco
    ? (dados?.lista ?? []).filter((l) => l.unidadeId === unidadeEmFoco.id)
    : [];
  // ⚠️ A FRESCA VENCE O RETRATO — a mesma regra da unidade, um andar abaixo. Ver `propostaEmFoco`.
  const propostaEmFoco = acharPropostaEmFoco(
    foco,
    propostasDaUnidade,
    ehEtapaViva,
  );

  // A última que caiu, quando não há viva: o lote está livre, mas já teve história — e o coordenador
  // que vai oferecê-lo merece saber disso antes de ligar para o cliente.
  const ultimaQueCaiu =
    propostaEmFoco || !unidadeEmFoco ? null : (propostasDaUnidade[0] ?? null);
  const idEmFoco = unidadeEmFoco?.id ?? propostaEmFoco?.unidadeId ?? null;

  return (
    <>
    {/* ⚠️ O MODAL FICA FORA DA GRADE. Ele é `position: fixed`, então dentro da coluna ele herdaria o
        `overflow` dela e a folha do contrato ficaria recortada na metade.

        ⚠️ `podeGerar={false}`: AQUI SE CONFERE, NÃO SE EMITE. Lucas, 08/09/2026, no portal comercial
        da Gurgel em perfil de coordenador: *"estou como coordenador, não pode ter esse botão de
        gerar contrato, isso é somente o time administrativo interno"*. A folha continua inteira — a
        conferência é justamente o que o comercial faz nesta tela — e "Abrir o contrato guardado"
        continua no rodapé: ver o documento já emitido não é emitir.

        ⚠️ E ISTO NÃO É A TRAVA, É A METADE DELA. Quem fecha a rota é `autorizarEmissaoDeContrato`
        (`lib/temis/autorizacao.ts`); esconder botão só resolve o que se vê. */}
    {previaDe ? (
      <PreviaDoContrato
        aoFechar={() => setPreviaDe(null)}
        podeGerar={false}
        propostaId={previaDe}
      />
    ) : null}
    {/* ⚠️ `alignItems: start` SAIU. Ele encolhia as colunas para a altura do conteúdo, e era isso
        que jogava a rolagem para a página inteira. Agora as duas esticam e rolam por dentro. */}
    <div
      style={{
        display: "grid",
        gap: 14,
        gridTemplateColumns: "minmax(0, 1.35fr) minmax(300px, .65fr)",
        minHeight: 0,
        width: "100%",
      }}
    >
      {/* A coluna do estoque: o quadro em cima com altura própria (até 55% da área, para a lista
          nunca virar uma faixa de três linhas) e o analítico embaixo ocupando o resto. Os dois
          rolam por dentro, cada um com a sua barra. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          minHeight: 0,
          minWidth: 0,
          overflow: "auto",
        }}
      >
        <Cartao
          direita={
            <div
              style={{
                alignItems: "center",
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
              }}
            >
              {modo === "grade"
                ? LEGENDA.filter((l) => (estoque[l.etapa] ?? 0) > 0).map(
                    ({ etapa: chave, rotulo: nome }) => (
                      <span
                        key={chave}
                        style={{
                          color: T.muted,
                          fontSize: 11.5,
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <i
                          style={{
                            background: COR_DA_ETAPA[chave],
                            borderRadius: 3,
                            display: "inline-block",
                            height: 10,
                            marginRight: 5,
                            width: 10,
                          }}
                        />
                        {nome} {inteiro(estoque[chave] ?? 0)}
                      </span>
                    ),
                  )
                : null}

              {/* A escolha da vista. Só aparece com um produto que TEM masterplan. */}
              {/* O par Grade/Espelho só existe onde há masterplan publicado. */}
              {codeDoEspelho ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <Pilula
                    ativo={modo === "grade"}
                    onClick={() => aoTrocarModo("grade")}
                    rotulo="Grade"
                  />
                  <Pilula
                    ativo={modo === "mapa"}
                    onClick={() => aoTrocarModo("mapa")}
                    rotulo="Espelho"
                  />
                </div>
              ) : null}
            </div>
          }
          titulo="Estoque"
        >
          {/* ⚠️ O ESPELHO DEIXOU DE SER UM <iframe> DE HTML GERADO À MÃO. Ele agora desenha a
              mesma arte e a mesma geometria que o espelho público lê de `hercules_masterplans` —
              oito empreendimentos em vez de cinco, sem preparo manual —, mas com as CORES DO
              FUNIL, que são as desta tela. O motor do mapa (zoom, arraste, conter sem esticar) é
              compartilhado em `modules/espelho/MapaDeLotes`. */}
          {modo === "mapa" && codeDoEspelho ? (
            <EspelhoDoProduto
              aoClicarNoLote={(l: LoteDaMesa) => {
                const u = (dados?.mapa ?? [])
                  .flatMap((g) => g.unidades)
                  .find((x) => x.id === l.id);
                if (u) aoFocar({ tipo: "unidade", unidade: u });
              }}
              code={codeDoEspelho}
              loteEmFoco={unidadeEmFoco?.codigo ?? null}
              lotes={(dados?.mapa ?? []).flatMap((g) =>
                g.unidades.map((u) => ({ codigo: u.codigo, etapa: u.etapa, id: u.id })),
              )}
            />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gap: 14,
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                }}
              >
                {grupos.map((g) => (
                  <div key={g.grupo}>
                    <div
                      style={{
                        color: T.muted,
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: ".06em",
                        marginBottom: 5,
                        textTransform: "uppercase",
                      }}
                    >
                      {g.grupo}
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gap: 3,
                        gridTemplateColumns: "repeat(6, 1fr)",
                      }}
                    >
                      {g.unidades.slice(0, 60).map((u) => (
                        <button
                          key={u.codigo}
                          onClick={() =>
                            aoFocar({ tipo: "unidade", unidade: u })
                          }
                          style={{
                            aspectRatio: "1 / 1.25",
                            background: COR_DA_ETAPA[u.etapa] ?? T.soft,
                            border: 0,
                            borderRadius: 3,
                            color: textoNoQuadrado(u.etapa),
                            cursor: "pointer",
                            display: "grid",
                            font: "inherit",
                            fontSize: 8.5,
                            fontWeight: 600,
                            outline:
                              idEmFoco === u.id
                                ? `2.5px solid ${T.text}`
                                : undefined,
                            outlineOffset: 1,
                            padding: 0,
                            placeItems: "center",
                          }}
                          // O código aparece aqui com a conotação de código, como o Lucas pediu: é a
                          // única porta onde ele serve, para quem precisa cruzar com o backend.
                          title={`${comoSeEscreve(u.codigo, u.quadra, u.lote).unidade} · ${
                            ROTULO_DA_ETAPA[u.etapa] ?? u.etapa
                          } · código ${u.codigo}`}
                          type="button"
                        >
                          {u.lote ?? ""}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {!carregando && grupos.length === 0 ? (
                <p
                  style={{
                    color: T.muted,
                    fontSize: 13,
                    margin: 0,
                    textAlign: "center",
                  }}
                >
                  Nenhuma unidade no recorte.
                </p>
              ) : null}
              {(dados?.mapa.length ?? 0) > 30 ? (
                <p
                  style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}
                >
                  Mostrando 30 de {inteiro(dados?.mapa.length ?? 0)} quadras.
                  Escolha um empreendimento no alto para ver o estoque inteiro
                  dele.
                </p>
              ) : null}
            </>
          )}
        </Cartao>

        {etapa === "disponivel" ? (
          <Cartao
            barra={
              <>
                <Busca
                  aoMudar={setBusca}
                  placeholder="Buscar quadra, lote ou código"
                  valor={busca}
                />
                <Filtro
                  aoMudar={setQuadra}
                  opcoes={quadras}
                  rotuloDeTodos="Todas as quadras"
                  valor={quadra}
                />
                <span
                  style={{ color: T.muted, fontSize: 11.5, marginLeft: "auto" }}
                >
                  {inteiro(livresFiltrados.length)} de {inteiro(livres.length)}
                </span>
              </>
            }
            rolagem
            titulo={`Disponíveis · ${inteiro(livres.length)}`}
          >
            <div style={{ margin: "-16px", overflowX: "auto" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: 13,
                  width: "100%",
                }}
              >
                <thead>
                  <tr>
                    {["Unidade", "Valor de tabela"].map((c, i) => (
                      <th
                        key={c}
                        style={{
                          color: T.muted,
                          fontSize: 10.5,
                          fontWeight: 650,
                          letterSpacing: ".05em",
                          padding: "10px 12px",
                          textAlign: i === 1 ? "right" : "left",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {livresFiltrados.slice(0, 150).map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => aoFocar({ tipo: "unidade", unidade: u })}
                      style={{
                        background: idEmFoco === u.id ? T.soft : undefined,
                        cursor: "pointer",
                      }}
                    >
                      <td style={celula}>
                        <b>
                          {
                            comoSeEscreve(u.codigo, u.quadra ?? u.grupo, u.lote)
                              .unidade
                          }
                        </b>
                        <div style={{ color: T.muted, fontSize: 11.5 }}>
                          {comoSeEscreve(u.codigo, u.quadra ?? u.grupo, u.lote)
                            .recorte ?? ""}
                        </div>
                      </td>
                      <td
                        style={{
                          ...celula,
                          fontVariantNumeric: "tabular-nums",
                          textAlign: "right",
                        }}
                      >
                        {u.preco ? dinheiro(u.preco) : "—"}
                      </td>
                    </tr>
                  ))}
                  {livresFiltrados.length === 0 ? (
                    <tr>
                      <td
                        colSpan={2}
                        style={{
                          ...celula,
                          color: T.muted,
                          textAlign: "center",
                        }}
                      >
                        {carregando
                          ? "Carregando…"
                          : livres.length > 0
                            ? "Nenhuma unidade com esse filtro."
                            : "Nenhuma unidade disponível no recorte."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {livresFiltrados.length > 150 ? (
              <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
                Mostrando 150 de {inteiro(livresFiltrados.length)}.
              </p>
            ) : null}
          </Cartao>
        ) : (
          <Cartao
            barra={
              <>
                <Busca
                  aoMudar={setBusca}
                  placeholder="Buscar unidade, cliente ou imobiliária"
                  valor={busca}
                />
                <Filtro
                  aoMudar={setImobiliaria}
                  opcoes={imobiliarias}
                  rotuloDeTodos="Todas as imobiliárias"
                  valor={imobiliaria}
                />
                <span
                  style={{ color: T.muted, fontSize: 11.5, marginLeft: "auto" }}
                >
                  {inteiro(listaFiltrada.length)} de {inteiro(lista.length)}
                </span>
              </>
            }
            rolagem
            titulo={`${rotulo} · ${inteiro(lista.length)}`}
          >
            <div style={{ margin: "-16px", overflowX: "auto" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: 13,
                  width: "100%",
                }}
              >
                <thead>
                  <tr>
                    {[
                      "Unidade",
                      "Cliente",
                      "Imobiliária",
                      rotuloDaData(etapa),
                      // ⚠️ SÓ EM CONTRATO (Lucas, 06/09/2026: *"aqui pode trazer a data de entrega
                      // prevista"*). A promessa de 24 horas úteis é da EMISSÃO do contrato; nas
                      // outras etapas não há o que prometer — reserva e proposta esperam o cliente,
                      // e assinatura espera quem assina. Uma coluna vazia em quatro das seis
                      // etapas diria sobretudo "não sei".
                      ...(etapa === "contrato" ? ["Entrega prevista"] : []),
                      "Valor",
                    ].map((c, i, todas) => (
                      <th
                        key={c}
                        style={{
                          color: T.muted,
                          fontSize: 10.5,
                          fontWeight: 650,
                          letterSpacing: ".05em",
                          padding: "10px 12px",
                          textAlign: i === todas.length - 1 ? "right" : "left",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {listaFiltrada.slice(0, 150).map((l) => (
                    <tr
                      key={l.id}
                      onClick={() => aoFocar({ proposta: l, tipo: "proposta" })}
                      style={{
                        background:
                          propostaEmFoco?.id === l.id ? T.soft : undefined,
                        // ⚠️ UM FIO VERMELHO NA BORDA, E NÃO A LINHA PINTADA (Lucas, 06/09/2026:
                        // *"os contratos que estão em cancelamento têm que vir falando, ou trazer
                        // uma cor vermelha, algo mais discreto"*). Fundo vermelho numa lista de
                        // contratos vivos lê-se como erro do sistema; o fio diz "esta é diferente"
                        // sem gritar, e a coluna ao lado escreve o que ela tem de diferente.
                        borderLeft: l.cancelamentoPedidoEm
                          ? `2px solid ${T.danger}`
                          : "2px solid transparent",
                        cursor: "pointer",
                      }}
                    >
                      <td style={celula}>
                        <b>{l.unidade ?? "—"}</b>
                        {/* ⚠️ O COD SÓ APARECE ONDE EXISTE: as 4.857 propostas importadas não têm
                          código (o legado não tem), e escrever "—" em quase toda linha da lista
                          faria a coluna dizer sobretudo "não sei". Ele desce para o segundo nível
                          da célula, ao lado do produto, e a busca — que já aceitava o COD — deixa
                          de procurar por um número invisível. */}
                        <div
                          style={{
                            color: T.muted,
                            display: "flex",
                            fontSize: 11.5,
                            gap: 6,
                          }}
                        >
                          <span>{l.produto ?? ""}</span>
                          {l.codigo ? (
                            <span
                              style={{
                                fontFamily:
                                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                                fontWeight: 600,
                                letterSpacing: ".04em",
                              }}
                            >
                              {l.codigo}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td style={celula}>
                        {l.cliente ? toTitleCase(l.cliente) : "—"}
                      </td>
                      <td style={celula}>
                        {l.imobiliaria ? toTitleCase(l.imobiliaria) : "—"}
                      </td>
                      <td style={{ ...celula, color: T.muted }}>
                        {dia(l.desde)}
                      </td>
                      {etapa === "contrato" ? (
                        <td style={{ ...celula, color: T.muted }}>
                          {/* ⚠️ QUEM PEDIU CANCELAMENTO NÃO TEM ENTREGA PREVISTA: prometer data de
                              contrato para uma venda que o jurídico está desfazendo seria a tela
                              contando duas histórias sobre a mesma linha. */}
                          {l.cancelamentoPedidoEm ? (
                            <span style={{ color: T.danger, fontWeight: 600 }}>
                              Cancelamento solicitado
                            </span>
                          ) : (
                            entregaPrevista(l.desde)
                          )}
                        </td>
                      ) : null}
                      <td
                        style={{
                          ...celula,
                          fontVariantNumeric: "tabular-nums",
                          textAlign: "right",
                        }}
                      >
                        {l.valor ? dinheiro(l.valor) : "—"}
                      </td>
                    </tr>
                  ))}
                  {listaFiltrada.length === 0 ? (
                    <tr>
                      <td
                        colSpan={etapa === "contrato" ? 6 : 5}
                        style={{
                          ...celula,
                          color: T.muted,
                          textAlign: "center",
                        }}
                      >
                        {carregando
                          ? "Carregando…"
                          : lista.length > 0
                            ? "Nenhuma proposta com esse filtro."
                            : "Nenhuma proposta nesta etapa."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {listaFiltrada.length > 150 ? (
              <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
                Mostrando as 150 mais recentes de{" "}
                {inteiro(listaFiltrada.length)}.
              </p>
            ) : null}
          </Cartao>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          minHeight: 0,
          // A rede: se a ficha e o simulador sozinhos passarem da altura (tela muito baixa), a
          // coluna rola em vez de cortar. Em uso normal a barra aparece só no histórico.
          overflow: "auto",
        }}
      >
        <Cartao
          direita={
            unidadeEmFoco ? (
              <span
                style={{
                  background: COR_DA_ETAPA[unidadeEmFoco.etapa] ?? T.soft,
                  borderRadius: 999,
                  color: FUNDO_ESCURO.has(unidadeEmFoco.etapa)
                    ? "rgb(255 255 255 / .92)"
                    : "rgb(0 0 0 / .7)",
                  fontSize: 11,
                  fontWeight: 650,
                  padding: "2px 9px",
                }}
              >
                {ROTULO_DA_ETAPA[unidadeEmFoco.etapa] ?? unidadeEmFoco.etapa}
              </span>
            ) : null
          }
          // ⚠️ O TÍTULO CARREGA O RECORTE quando existe (Lucas, 03/09/2026: *"quando tiver filho
          // essa unidade tem que fazer referência"*). "04 04" sozinho é ambíguo num produto
          // dividido: existe um 04 04 em VOC e outro em VOL, e são lotes diferentes.
          // ⚠️ A SIGLA VEM PRIMEIRO (Lucas, 03/09/2026: *"trocar de lugar, começar com a sigla"*).
          // "VOL · 04 04" se lê como endereço: primeiro onde, depois qual. Com o número na frente,
          // dois lotes de recortes diferentes começam iguais e só se separam no fim.
          titulo={
            unidadeEmFoco
              ? [
                  comoSeEscreve(
                    unidadeEmFoco.codigo,
                    unidadeEmFoco.quadra,
                    unidadeEmFoco.lote,
                  ).recorte,
                  comoSeEscreve(
                    unidadeEmFoco.codigo,
                    unidadeEmFoco.quadra,
                    unidadeEmFoco.lote,
                  ).unidade,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : [propostaEmFoco?.produto, propostaEmFoco?.unidade]
                  .filter(Boolean)
                  .join(" · ") || "Nada escolhido"
          }
        >
          {unidadeEmFoco || propostaEmFoco ? (
            <>
              <TrilhaDoFluxo
                etapa={propostaEmFoco?.etapa ?? unidadeEmFoco?.etapa ?? null}
                pedidoDeCancelamento={
                  propostaEmFoco?.cancelamentoPedidoEm ?? null
                }
              />
              {unidadeEmFoco?.preco ? (
                <Linha
                  rotulo="Valor de tabela"
                  valor={dinheiro(unidadeEmFoco.preco)}
                />
              ) : null}
              {propostaEmFoco ? (
                <>
                  {/* ⚠️ ETAPA E PRODUTO SAÍRAM DA LISTA (Lucas, 03/09/2026): a etapa já está no selo
                      aqui em cima e o produto no filtro do topo. Repetir os dois gastava duas linhas
                      da ficha para dizer o que a tela já dizia duas vezes. */}
                  {/* ⚠️ O COD VEM PRIMEIRO (Lucas, 04/09/2026: *"eu gosto muito de protocolo"*,
                      *"em vez de protocolo vamos tratar como COD"*). É o número que ele fala no
                      telefone: aparece antes de data e valor porque é por ele que se ACHA a venda,
                      não por eles. */}
                  {propostaEmFoco.codigo ? (
                    <Linha rotulo="COD" valor={propostaEmFoco.codigo} />
                  ) : null}
                  <Linha
                    rotulo={rotuloDaData(propostaEmFoco.etapa)}
                    valor={dia(propostaEmFoco.desde)}
                  />
                  <Linha
                    rotulo="Valor negociado"
                    valor={
                      propostaEmFoco.valor
                        ? dinheiro(propostaEmFoco.valor)
                        : "—"
                    }
                  />
                  <ClienteDaVenda
                    nome={toTitleCase(propostaEmFoco.cliente) || "—"}
                    unidadeId={idEmFoco}
                  />
                  <Linha
                    rotulo="Imobiliária"
                    valor={toTitleCase(propostaEmFoco.imobiliaria) || "—"}
                  />
                  <Linha
                    rotulo="Corretor"
                    valor={toTitleCase(propostaEmFoco.corretor) || "—"}
                  />
                  {/* O FLUXO do contrato, não o nome do plano — a mesma escrita do extrato. */}
                  <Linha rotulo="Plano" valor={propostaEmFoco.plano ?? "—"} />
                  {/* ⚠️ A PRÉVIA MORA NA FICHA DA PROPOSTA, e não numa tela à parte: é aqui que
                      alguém já está olhando o negócio inteiro — cliente, unidade, valor e plano —
                      quando decide emitir. Pedido do Lucas em 08/09/2026. */}
                  <button
                    onClick={() => setPreviaDe(propostaEmFoco.id)}
                    style={{
                      background: "transparent",
                      border: `1px solid ${T.border}`,
                      borderRadius: 8,
                      color: T.text,
                      cursor: "pointer",
                      fontSize: 11.5,
                      fontWeight: 600,
                      marginTop: 8,
                      padding: "7px 10px",
                      width: "100%",
                    }}
                    type="button"
                  >
                    Prévia do contrato
                  </button>
                  {propostaEmFoco.observacao ? (
                    <div
                      style={{
                        borderTop: `1px dashed ${T.border}`,
                        marginTop: 8,
                        paddingTop: 8,
                      }}
                    >
                      <div
                        style={{
                          color: T.muted,
                          fontSize: 10.5,
                          fontWeight: 650,
                        }}
                      >
                        Observações
                      </div>
                      <p
                        style={{
                          color: T.sub,
                          fontSize: 12.5,
                          margin: "3px 0 0",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {propostaEmFoco.observacao}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : (
                // ⚠️ SEM PROPOSTA VIVA NÃO É ERRO: é lote livre, e é o começo normal de uma venda.
                // Mas se ele JÁ TEVE proposta, isso é dito — em uma linha, sem os dados do cliente
                // antigo, que não têm por que aparecer na ficha de um lote que está à venda.
                <>
                  <p
                    style={{
                      color: T.muted,
                      fontSize: 12.5,
                      margin: "8px 0 0",
                    }}
                  >
                    Nenhuma proposta em andamento nesta unidade.
                  </p>
                  {ultimaQueCaiu ? (
                    <p
                      style={{
                        color: T.muted,
                        fontSize: 11.5,
                        margin: "6px 0 0",
                      }}
                    >
                      A última{" "}
                      {ROTULO_TERMINAL[ultimaQueCaiu.etapa]?.toLowerCase() ??
                        "encerrada"}{" "}
                      em {dia(ultimaQueCaiu.desde)}. O histórico abaixo conta o
                      resto.
                    </p>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
              Clique num lote do mapa ou numa linha da lista.
            </p>
          )}
          <AcoesDaUnidade
            aoCancelar={() => aoCancelar(unidadeEmFoco)}
            aoEnviarParaContrato={() => aoEnviarParaContrato(unidadeEmFoco)}
            aoGerarProposta={() => aoGerarProposta(unidadeEmFoco)}
            aoPedirCancelamento={() => aoPedirCancelamento(unidadeEmFoco)}
            aoReservar={() => aoReservar(unidadeEmFoco)}
            propostaViva={propostaEmFoco}
            unidade={unidadeEmFoco}
          />
        </Cartao>

        {/* ⚠️ O HISTÓRICO VEM ANTES DO SIMULADOR (Lucas, 04/09/2026: *"você podia trocar histórico
            pelo simulador (...) falo a ordem"*). Quem abre um lote quer primeiro saber o que já
            aconteceu nele — quem reservou, quando, o que foi anotado. O simulador é a próxima
            ação, e ação vem depois de entender a situação. */}
        <PainelDaVenda
          aoSimular={unidadeEmFoco ? () => aoSimular(unidadeEmFoco) : null}
          unidadeId={idEmFoco}
          versao={versaoDosDados}
        />
      </div>
    </div>
    </>
  );
}

// ── O SIMULADOR DE PROPOSTA ─────────────────────────────────────────────────
//
// Lucas (03/09/2026): *"quero melhorar esse simulador, está bem confuso. O que eu gosto: a opção de
// começar pelo valor da parcela, isso ajuda bastante; gosto das parcelas dos planos já definidos, e
// a ideia é eu poder editar isso quando necessário. (...) acho que lado esquerdo ser esse cockpit,
// de montagem de proposta mesmo, e o lado direito o de visualização, recomendação"*.
//
// ⚠️ ANTES ERA O MASTERPLAN NUM IFRAME, e o que ele achou confuso vinha de lá: três botões de MODO
// ("parto da parcela do cliente", "eu escolho as condições", "proposta livre") obrigavam a declarar
// como você ia pensar antes de digitar qualquer coisa. Numa mesa de venda ninguém escolhe modo — se
// digita o que o cliente falou. Agora o modo é consequência do campo que você mexeu.
//
// ⚠️ SÓ AQUI, NO COMERCIAL (*"vamos mexer somente para o comercial, se eu gostar posso estender
// para cecilio"*). Os cinco masterplans continuam byte a byte como estavam.
//
// ⚠️ E A MATEMÁTICA NÃO FOI REESCRITA: `lib/hercules/simulacao.ts` (Price com valor presente dos
// reforços) e `lib/hercules/composicoes.ts` (a varredura que parte da parcela), as duas testadas.
// Duas versões da mesma conta de dinheiro seria uma a mais.

/**
 * O simulador em tela cheia.
 *
 * ⚠️ NÃO GRAVA NADA (*"a ideia é ter um local que o usuário possa fazer algumas simulações sem ter
 * que vincular a nada e nem gerar proposta"*). O gerador de proposta real entra depois, no fluxo da
 * venda.
 */
function ModalDoSimulador({
  entradaMinimaPercentual,
  nome,
  onFechar,
  planos,
  unidade,
}: {
  entradaMinimaPercentual: null | number;
  nome: string;
  onFechar: () => void;
  planos: FluxoDeVenda["planos"];
  unidade: UnidadeNoMapa;
}) {
  const escrita = comoSeEscreve(unidade.codigo, unidade.quadra, unidade.lote);
  // Escape fecha: tela cheia sem saída de teclado prende quem usa teclado.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = antes;
    };
  }, [onFechar]);

  return (
    <div
      style={{
        background: "rgb(0 0 0 / .55)",
        display: "grid",
        inset: 0,
        padding: 24,
        placeItems: "center",
        position: "fixed",
        zIndex: 60,
      }}
    >
      <div
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          height: "min(92vh, 900px)",
          maxWidth: 1280,
          overflow: "hidden",
          width: "min(96vw, 1280px)",
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            justifyContent: "space-between",
            padding: "12px 16px",
          }}
        >
          <b style={{ fontSize: 14 }}>
            Simulador de proposta · {nome} · {escrita.unidade}
          </b>
          <button
            onClick={onFechar}
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              color: T.sub,
              cursor: "pointer",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              padding: "5px 12px",
            }}
            type="button"
          >
            Fechar
          </button>
        </div>

        <div
          style={{
            background: T.page,
            flex: "1 1 auto",
            minHeight: 0,
            padding: 14,
          }}
        >
          <SimuladorDeProposta
            entradaMinimaPercentual={entradaMinimaPercentual}
            planos={planos}
            unidade={escrita.unidade}
            valorDaUnidade={unidade.preco}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * O nome do cliente, que ao ser clicado mostra como falar com ele.
 *
 * Lucas (04/09/2026): *"como eu posso ter os dados do cliente da reserva, pode ser que eu queira
 * ligar para ele (...) tipo um link ao clicar no nome"*, e depois *"acho que ligar não, só mostrar
 * mesmo"*.
 *
 * ⚠️ BUSCA SÓ NO CLIQUE. O telefone poderia vir junto da lista, mas são 4.857 linhas: o contato de
 * milhares de clientes ficaria no navegador de quem só queria ver o funil. Aqui sai uma unidade por
 * vez, quando alguém pede.
 *
 * ⚠️ O CPF APARECE MASCARADO e o telefone inteiro: o documento serve para conferir que é a pessoa
 * certa, o telefone é o que ele pediu para ver. Mascarar o telefone não serviria para nada.
 */
function ClienteDaVenda({
  nome,
  unidadeId,
}: {
  nome: string;
  unidadeId: null | string;
}) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<null | {
    documento: null | string;
    nome: null | string;
    telefone: null | string;
  }>(null);
  const [buscando, setBuscando] = useState(false);

  // Trocar de unidade fecha o que estava aberto: senão o painel mostraria o contato do lote
  // anterior sob o nome do novo, que é o pior tipo de erro num dado de contato.
  useEffect(() => {
    setAberto(false);
    setDados(null);
  }, [unidadeId]);

  async function abrir() {
    if (aberto) {
      setAberto(false);
      return;
    }
    setAberto(true);
    if (dados || !unidadeId) return;

    setBuscando(true);
    try {
      const r = await fetch(
        `/api/incorporador/venda/cliente?unidade=${encodeURIComponent(unidadeId)}`,
        { cache: "no-store" },
      );
      const texto = await r.text();
      const corpo = texto ? (JSON.parse(texto) as { data?: typeof dados }) : {};
      setDados(corpo.data ?? null);
    } catch {
      setDados(null);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div>
      <div
        style={{
          alignItems: "baseline",
          borderTop: `1px dashed ${T.border}`,
          display: "flex",
          gap: 10,
          justifyContent: "space-between",
          padding: "7px 0",
        }}
      >
        <span style={{ color: T.sub, fontSize: 12.5 }}>Cliente</span>
        <button
          onClick={() => void abrir()}
          style={{
            background: "transparent",
            border: "none",
            color: T.text,
            cursor: unidadeId ? "pointer" : "default",
            font: "inherit",
            fontSize: 12.5,
            fontWeight: 650,
            padding: 0,
            textAlign: "right",
            textDecoration: unidadeId ? "underline" : "none",
            textDecorationStyle: "dotted",
            textUnderlineOffset: 3,
          }}
          type="button"
        >
          {nome}
        </button>
      </div>

      {aberto ? (
        <div
          style={{
            background: T.soft,
            borderRadius: 8,
            display: "grid",
            gap: 4,
            margin: "0 0 8px",
            padding: "8px 10px",
          }}
        >
          {buscando ? (
            <span style={{ color: T.muted, fontSize: 11.5 }}>Buscando…</span>
          ) : dados ? (
            <>
              <Miudo rotulo="Nome" valor={dados.nome ?? "—"} />
              <Miudo rotulo="CPF" valor={dados.documento ?? "não cadastrado"} />
              <Miudo
                rotulo="Telefone"
                valor={
                  formatarTelefoneGuardado(dados.telefone) || "não cadastrado"
                }
              />
            </>
          ) : (
            <span style={{ color: T.muted, fontSize: 11.5 }}>
              Sem contato cadastrado para esta unidade.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Miudo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
      <span style={{ color: T.muted, fontSize: 11.5 }}>{rotulo}</span>
      <span style={{ fontSize: 11.5, fontWeight: 600 }}>{valor}</span>
    </div>
  );
}

// ── A TRILHA DO FLUXO ───────────────────────────────────────────────────────
//
// Lucas (04/09/2026): *"vamos colocar no topo desse painel um workflow, para gente ver ele
// caminhando nas etapas?"* e *"concluindo as que ele já passou"*.
//
// ⚠️ O SELO SOZINHO DIZ ONDE ESTÁ, MAS NÃO DE ONDE VEIO NEM O QUE FALTA. "Reserva" no canto do
// cabeçalho responde uma pergunta; quem acompanha uma venda faz outras duas — quanto já andou e
// quanto falta —, e é isso que a trilha responde sem clique nenhum.
//
// ⚠️ AS CUMPRIDAS GANHAM CHECK, e não só uma cor mais fraca: num caminho de cinco degraus, "antes"
// e "depois" pintados só por tom ficam iguais para quem olha de relance — e a diferença entre eles
// é a informação inteira.
//
// ⚠️ SETAS, E NÃO TRAÇOS (Lucas, 04/09/2026: *"queria tipo uma setinha em vez de linha"*). Cinco
// barras paralelas são cinco coisas do lado uma da outra; a seta diz que uma leva à outra, que é o
// que um fluxo é. Cada degrau avança sobre o próximo com `clip-path`, e a margem negativa encaixa
// a ponta no recorte do seguinte — sem ela sobra uma fresta branca no meio do caminho.

function TrilhaDoFluxo({
  etapa,
  pedidoDeCancelamento,
}: {
  etapa: null | string;
  /** Quando existe, a venda está com cancelamento solicitado e esperando o jurídico. */
  pedidoDeCancelamento?: null | string;
}) {
  // Fora do caminho (disponível, bloqueada, vendida sem proposta) não há trilha para mostrar: a
  // venda não começou, ou não passou por aqui. Um traço todo apagado só ocuparia espaço.
  const atual = ETAPAS_DO_FLUXO.indexOf(etapa as EtapaDoFluxo);
  if (atual < 0) return null;

  // A ponta da seta, em pixels. Entra duas vezes em cada degrau: o recorte da direita (a ponta que
  // avança) e o da esquerda (o encaixe que recebe a ponta do anterior).
  const PONTA = 9;

  return (
    <>
      {/* ⚠️ A VENDA COM PEDIDO ABERTO PRECISA SE ANUNCIAR (Lucas, 06/09/2026: *"temos que colocar
          alguma etapa ou marcação visual"*). A etapa NÃO muda — quem desfaz é o jurídico, e mexer
          nela devolveria o lote ao estoque com o contrato ainda de pé —, então a trilha continua
          dizendo "Contrato" e nada na tela contava que havia um distrato em curso. A faixa é o
          recado: ela some sozinha no dia em que a Têmis concluir e o carimbo cair. */}
      {pedidoDeCancelamento ? (
        <div
          style={{
            alignItems: "center",
            background: T.dangerBg,
            border: `1px solid ${T.danger}`,
            borderRadius: 8,
            color: T.danger,
            display: "flex",
            fontSize: 11.5,
            fontWeight: 700,
            gap: 6,
            margin: "0 0 8px",
            padding: "6px 10px",
          }}
        >
          <Ban aria-hidden="true" size={13} />
          Cancelamento solicitado · aguardando o jurídico
        </div>
      ) : null}

      <div style={{ display: "flex", margin: "0 0 12px" }}>
        {ETAPAS_DO_FLUXO.map((passo, i) => {
          const cumprida = i < atual;
          const ehAtual = i === atual;
          const primeiro = i === 0;
          const ultimo = i === ETAPAS_DO_FLUXO.length - 1;

          // ⚠️ O DEGRAU AVANÇA SOBRE O PRÓXIMO, e é isso que faz a seta ler como caminho: o recorte
          // da direita é uma ponta, o da esquerda é o encaixe dela, e a margem negativa junta os
          // dois. Sem a sobreposição sobra uma fresta branca entre os degraus.
          // ⚠️ O ÚLTIMO NÃO TEM PONTA: o caminho acaba nele, e uma seta apontando para fora
          // prometeria um passo que não existe.
          const direita = ultimo
            ? "100% 0, 100% 100%"
            : `calc(100% - ${PONTA}px) 0, 100% 50%, calc(100% - ${PONTA}px) 100%`;
          const recorte = primeiro
            ? `polygon(0 0, ${direita}, 0 100%)`
            : `polygon(0 0, ${direita}, 0 100%, ${PONTA}px 50%)`;

          return (
            <div
              key={passo}
              style={{
                alignItems: "center",
                // ⚠️ O DEGRAU CUMPRIDO É VERDE (Lucas, 05/09/2026: *"aqui também pode colocar um
                // verde indicando que foi concluído"*). Ele já tinha o ✓, mas em cinza — a mesma cor
                // do degrau que ainda não aconteceu, com um ícone pequeno como única diferença. Num
                // fluxo de cinco passos lido de relance, o que responde "até onde essa venda chegou"
                // é a COR, não o ícone: agora o caminho andado se separa do que falta sem precisar
                // procurar. O verde é o mesmo `ok` do resto do portal, em fundo lavado.
                background: ehAtual ? T.gold : cumprida ? T.okBg : T.card,
                border: ehAtual
                  ? "none"
                  : `1px solid ${cumprida ? T.ok : T.border}`,
                clipPath: recorte,
                color: ehAtual ? T.btnFg : cumprida ? T.ok : T.muted,
                display: "flex",
                flex: 1,
                fontSize: 10,
                fontWeight: ehAtual || cumprida ? 700 : 500,
                gap: 3,
                justifyContent: "center",
                marginLeft: primeiro ? 0 : -PONTA,
                minWidth: 0,
                overflow: "hidden",
                padding: `5px ${PONTA + 2}px 5px ${primeiro ? PONTA : PONTA * 2}px`,
                whiteSpace: "nowrap",
              }}
            >
              {cumprida ? (
                <Check aria-hidden size={10} strokeWidth={3} />
              ) : null}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {ROTULO_DA_ETAPA[passo] ?? passo}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── AS AÇÕES DA UNIDADE ─────────────────────────────────────────────────────
//
// Lucas (03/09/2026): *"vamos inserir os botões de reservar, gerar propostas, enviar para contrato
// e o botão de cancelar"*, e detalhou o fluxo da RESERVA — *"depois a gente continua"*.
//
// ⚠️ OS QUATRO APARECEM DESDE JÁ, e o que ainda não existe diz isso. Hoje sobrou um — "Enviar para
// contrato"; reservar, gerar proposta e cancelar já gravam no Panteon. Mostrar só o que funciona
// esconderia o desenho do fluxo de quem usa a tela; um botão que some e volta a cada release é pior
// do que um botão que diz "vem depois". O que NÃO pode é botão que parece pronto e não faz nada:
// por isso eles ficam apagados e com o motivo no title.
//
// ⚠️ E O ESTADO MANDA. Reservar só existe em unidade DISPONÍVEL — é a regra dele ("se a unidade
// estiver disponível, ter um botão para reservar"). Nas outras etapas o botão continua visível,
// apagado, dizendo por quê: sumir faria o coordenador procurar o botão em vez de ler a ficha.

// ── ONDE ELE PAROU ─────────────────────────────────────────────────────────
//
// Lucas (05/09/2026): *"a ideia é que ao sair da tela ou carregar fica onde eu estava (...) estou na
// aba vendas, quando eu atualizo volta para aba painel"*.
//
// ⚠️ O LUGAR NÃO É SÓ O EMPREENDIMENTO. A primeira versão guardava só o produto escolhido, e o F5
// continuava devolvendo para o Painel — porque o que ele chama de "aba" aqui é a VISÃO da tela
// (Painel/Venda), e ela não estava guardada. "Onde eu estava" é o conjunto: a visão, a etapa do
// funil aberta, o modo do estoque, a janela de tempo e o recorte, além do produto.
//
// ⚠️ UMA CHAVE SÓ, com tudo dentro. Seis chaves separadas dariam seis leituras, seis escritas e a
// possibilidade de restaurar metade do estado — um recorte de um produto que não é mais o
// escolhido, por exemplo. Como objeto, o estado volta inteiro ou não volta.
//
// Vive no navegador, por pessoa, como o tema e a lateral recolhida do portal: é preferência de uso,
// não dado de venda, e não tem por que viajar até o servidor.
const CHAVE_DO_LUGAR = "hercules:venda:lugar";

type LugarGuardado = {
  emp?: string;
  etapa?: string;
  janela?: string;
  modoDoEstoque?: string;
  recorte?: string;
  visao?: string;
};

function lugarGuardado(): LugarGuardado {
  try {
    const cru = window.localStorage.getItem(CHAVE_DO_LUGAR);
    if (!cru) return {};
    const lido = JSON.parse(cru) as unknown;
    // ⚠️ O QUE VEM DO STORAGE É TEXTO DE FORA, e uma versão antiga pode ter gravado outro formato:
    // sem esta conferência, um `null` guardado viraria acesso a propriedade de null na leitura.
    return lido && typeof lido === "object" ? (lido as LugarGuardado) : {};
  } catch {
    return {};
  }
}

function guardarLugar(lugar: LugarGuardado): void {
  try {
    window.localStorage.setItem(CHAVE_DO_LUGAR, JSON.stringify(lugar));
  } catch {
    /* sem storage, a escolha só não sobrevive ao F5 */
  }
}

function AcoesDaUnidade({
  aoCancelar,
  aoEnviarParaContrato,
  aoGerarProposta,
  aoPedirCancelamento,
  aoReservar,
  propostaViva,
  unidade,
}: {
  aoCancelar: () => void;
  aoEnviarParaContrato: () => void;
  aoGerarProposta: () => void;
  /** Depois do contrato o cancelamento é PEDIDO à Têmis, e é outra tela e outra rota. */
  aoPedirCancelamento: () => void;
  /**
   * A proposta viva do lote, quando há — usada para saber se ela é NATIVA.
   *
   * ⚠️ SÓ A NATIVA SE CANCELA POR AQUI. Há 14 propostas do C2X em etapa `proposta` (vendas correndo
   * no legado), e elas pintam o lote igual às daqui: sem esta conferência o botão "Cancelar
   * proposta" acendia nelas e a rota respondia "Não há proposta aberta nesta unidade" numa ficha
   * que acabava de dizer Proposta — um beco sem explicação.
   */
  propostaViva?: null | {
    cancelamentoPedidoEm?: null | string;
    id: string;
    origem: null | string;
  };
  aoReservar: () => void;
  unidade: null | UnidadeNoMapa;
}) {
  const disponivel = unidade?.etapa === "disponivel";
  const reservada = unidade?.etapa === "reservado";
  // ⚠️ A PROPOSTA TAMBÉM TEM VOLTA. Sem esta etapa aqui, gerar a proposta tirava o lote do estoque
  // para sempre: os quatro botões apagavam, a rota da reserva mandava procurar "o cancelamento da
  // proposta" e não havia nenhum — cliente que desiste ou reprova no crédito deixava a unidade
  // presa, com o preço já circulando por WhatsApp, e só SQL na mão a soltava.
  // ⚠️ E SÓ A NATIVA: a etapa `proposta` do espelho não distingue quem nasceu aqui de quem veio da
  // carga do legado, e a rota só cancela a nativa. Ver `propostaViva`.
  const proposta =
    unidade?.etapa === "proposta" && propostaViva?.origem === "panteon";
  /** Proposta do legado pintando o lote: a tela diz Proposta, mas o cancelamento é lá. */
  const propostaDoLegado =
    unidade?.etapa === "proposta" && propostaViva?.origem !== "panteon";

  // Qual dos três cancelamentos cabe aqui — ver `lib/hercules/acao-de-cancelamento.ts`.
  const cancelamento = acaoDeCancelamento({
    etapa: unidade?.etapa ?? null,
    pedidoAberto: Boolean(propostaViva?.cancelamentoPedidoEm),
    propostaDoLegado,
    propostaNativa: proposta,
    vendaNativa: propostaViva?.origem === "panteon",
  });

  /**
   * ⚠️ A COR DIZ O QUE O CLIQUE FAZ, e é por isso que ela não é enfeite aqui. Os quatro botões
   * ficam lado a lado, com rótulos parecidos e do mesmo tamanho: "Gerar proposta" e "Cancelar
   * proposta" são vizinhos e opostos, e quem está com o cliente no telefone lê o primeiro que
   * parecer certo. Verde para o que ANDA, vermelho para o que DESFAZ.
   *
   * ⚠️ FUNDO SUAVE, NÃO BLOCO CHEIO. Quatro botões sólidos coloridos brigam entre si e nenhum vira
   * o principal — o Lucas já reprovou esse excesso no PDF (*"ficou ruim, muito chamativo"*). O tom
   * mora na borda e no texto, sobre um fundo lavado; o único sólido continua sendo o Reservar, que
   * é a ação de abertura do fluxo.
   */
  const acoes: Array<{
    ativo: boolean;
    aoClicar?: () => void;
    motivo: string;
    principal?: boolean;
    rotulo: string;
    tom?: "avanca" | "desfaz";
  }> = [
    {
      ativo: Boolean(unidade) && disponivel,
      aoClicar: aoReservar,
      motivo: !unidade
        ? "Escolha uma unidade."
        : disponivel
          ? "Reserva a unidade e avisa corretor, imobiliária e coordenador."
          : "Só unidade disponível pode ser reservada.",
      principal: true,
      rotulo: "Reservar",
    },
    // ⚠️ SÓ EM CIMA DE UMA RESERVA (Lucas, 04/09/2026: *"da reserva eu tenho dois caminhos, gerar
    // proposta ou cancelar"*). A proposta herda o cliente e a unidade da reserva; sem ela não há
    // titular definido nem lote travado, e o portão da modal não teria de quem conferir a CAD.
    {
      ativo: reservada,
      aoClicar: aoGerarProposta,
      motivo: !unidade
        ? "Escolha uma unidade."
        : reservada
          ? "Confere a CAD do cliente da reserva, monta as condições e gera a proposta com o PDF."
          : "Precisa de uma reserva ativa.",
      rotulo: "Gerar proposta",
      tom: "avanca",
    },
    // ⚠️ O SEGUNDO CAMINHO DA PROPOSTA (Lucas, 05/09/2026: *"depois da proposta gerada, tenho dois
    // caminhos, cancelar e enviar para contrato, pode habilitar"*). Ele MARCA que a proposta foi
    // aceita e entrou na fila do jurídico — não gera minuta, que é da Têmis e ainda não está
    // ligada aqui. Por isso também não dispara WhatsApp: "entrou na fila" não muda nada na mão do
    // cliente hoje, e o aviso fica reservado para o dia em que a minuta sair de verdade.
    {
      ativo: proposta,
      aoClicar: aoEnviarParaContrato,
      motivo: !unidade
        ? "Escolha uma unidade."
        : proposta
          ? "Entrega a proposta à Têmis, que faz o contrato, e leva a venda para a fase de contrato."
          : propostaDoLegado
            ? "Esta proposta veio do C2X: o contrato dela é feito lá."
            : "Precisa de uma proposta gerada.",
      rotulo: "Enviar para contrato",
      tom: "avanca",
    },
    // ⚠️ CANCELAR NÃO É UM ATO SÓ, E QUEM SABE QUAL É A LIB. Na reserva e na proposta o coordenador
    // desfaz e o lote volta ao estoque na hora; depois que a venda foi para contrato, quem desfaz é
    // o jurídico e o que existe aqui é um PEDIDO. O comentário antigo desta lista dizia que "o botão
    // que serve para as duas coisas é o botão que alguém clica errado" — continua valendo, e é por
    // isso que são três rótulos, três modais e três rotas, decididos em `acaoDeCancelamento` (com
    // teste próprio) e não numa escada de ternários aqui dentro.
    {
      ativo: Boolean(unidade) && cancelamento.tipo !== null,
      aoClicar:
        cancelamento.tipo === "pedido" ? aoPedirCancelamento : aoCancelar,
      motivo: !unidade ? "Escolha uma unidade." : cancelamento.motivo,
      rotulo: cancelamento.rotulo,
      tom: "desfaz",
    },
  ];

  return (
    <div
      style={{
        borderTop: `1px dashed ${T.border}`,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 12,
        paddingTop: 12,
      }}
    >
      {acoes.map((acao) => (
        <button
          key={acao.rotulo}
          disabled={!acao.ativo}
          onClick={acao.aoClicar}
          style={{
            background: !acao.ativo
              ? T.soft
              : acao.principal
                ? T.btnBg
                : acao.tom === "avanca"
                  ? T.okBg
                  : acao.tom === "desfaz"
                    ? T.dangerBg
                    : T.soft,
            // Apagado mantém a borda cinza de sempre: sem ela o botão inativo some do grupo.
            border: `1px solid ${
              !acao.ativo
                ? T.border
                : acao.tom === "avanca"
                  ? T.ok
                  : acao.tom === "desfaz"
                    ? T.danger
                    : "transparent"
            }`,
            borderRadius: 8,
            color: !acao.ativo
              ? T.muted
              : acao.principal
                ? T.btnFg
                : acao.tom === "avanca"
                  ? T.ok
                  : acao.tom === "desfaz"
                    ? T.danger
                    : T.text,
            cursor: acao.ativo ? "pointer" : "default",
            font: "inherit",
            fontSize: 12,
            fontWeight: 650,
            opacity: acao.ativo ? 1 : 0.55,
            padding: "7px 13px",
          }}
          title={acao.motivo}
          type="button"
        >
          {acao.rotulo}
        </button>
      ))}
    </div>
  );
}

// ── O PANORAMA ──────────────────────────────────────────────────────────────

function Panorama({ dados }: { dados: FluxoDeVenda | null }) {
  if (!dados) {
    return (
      <Cartao titulo="Panorama">
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Carregando…</p>
      </Cartao>
    );
  }

  const faturadas =
    dados.fluxo.find((f) => f.etapa === "faturado")?.quantidade ?? 0;
  const emAndamento = dados.fluxo
    .filter((f) => f.etapa !== "faturado")
    .reduce((a, f) => a + f.quantidade, 0);
  const perdidas = dados.perdas.canceladas + dados.perdas.distratos;
  const decididas = faturadas + perdidas;
  const conversao = decididas > 0 ? (faturadas / decididas) * 100 : 0;
  const ticket = faturadas > 0 ? dados.totais.vgvFaturado / faturadas : 0;
  const comMotivo = dados.motivos.reduce((a, m) => a + m.n, 0);
  const maiorSerie = Math.max(1, ...dados.serie.map((s) => s.faturadas));
  const maiorFunil = Math.max(1, ...dados.fluxo.map((f) => f.quantidade));

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
        gridAutoRows: "min-content",
        minHeight: 0,
        overflow: "auto",
        width: "100%",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        }}
      >
        <Kpi
          nota={`${inteiro(faturadas)} propostas`}
          rotulo="VGV faturado"
          valor={dinheiro(dados.totais.vgvFaturado)}
        />
        <Kpi
          nota="das propostas faturadas"
          rotulo="Ticket médio"
          valor={dinheiro(ticket)}
        />
        <Kpi
          nota="propostas vivas, fora do faturamento"
          rotulo="Em andamento"
          valor={inteiro(emAndamento)}
        />
        <Kpi
          nota={`${inteiro(faturadas)} de ${inteiro(decididas)} decididas`}
          rotulo="Conversão"
          valor={`${conversao.toFixed(0)}%`}
        />
        <Kpi
          nota={`${inteiro(dados.perdas.distratos)} distratos`}
          rotulo="Canceladas"
          valor={inteiro(dados.perdas.canceladas)}
        />
        <Kpi
          nota="que saiu do caminho"
          rotulo="VGV perdido"
          valor={dinheiro(dados.perdas.vgvCancelado)}
        />
      </div>

      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
        }}
      >
        <Cartao titulo="O funil">
          <div style={{ display: "grid", gap: 9 }}>
            {/* ⚠️ AS CADs SÃO OUTRA FONTE, e a barra diz isso na cor. CAD é cadastro (Apolo);
                reserva para baixo é venda (o fluxo importado do C2X). Pedido do Lucas: *"quantas
                cads foram geradas, quantas reservas, propostas"* — na mesma escada. Com todos os
                empreendimentos a esteira não recorta, e aí a CAD não aparece. */}
            {dados.cads
              ? [
                  {
                    n: dados.cads.total,
                    nota: `${inteiro(dados.cads.emCorrecao)} em correção`,
                    rotulo: "CADs geradas",
                  },
                  {
                    n: dados.cads.credenciados,
                    nota: `${inteiro(dados.cads.reprovadas)} reprovadas`,
                    rotulo: "Credenciados",
                  },
                ].map((c) => (
                  <div key={c.rotulo} style={{ display: "grid", gap: 4 }}>
                    <div
                      style={{
                        display: "flex",
                        fontSize: 12.5,
                        justifyContent: "space-between",
                      }}
                    >
                      <span style={{ color: T.sub }}>{c.rotulo}</span>
                      <b style={{ fontVariantNumeric: "tabular-nums" }}>
                        {inteiro(c.n)}
                      </b>
                    </div>
                    <div
                      style={{
                        background: T.soft,
                        borderRadius: 5,
                        height: 20,
                        overflow: "hidden",
                      }}
                    >
                      <i
                        style={{
                          background: T.muted,
                          display: "block",
                          height: "100%",
                          width: `${Math.max(2, (c.n / Math.max(1, dados.cads!.total)) * 100)}%`,
                        }}
                      />
                    </div>
                    <span style={{ color: T.muted, fontSize: 11 }}>
                      {c.nota}
                    </span>
                  </div>
                ))
              : null}

            {dados.fluxo.map((f) => {
              const passo = FLUXO.find((x) => x.etapa === f.etapa);
              return (
                <div key={f.etapa} style={{ display: "grid", gap: 4 }}>
                  <div
                    style={{
                      display: "flex",
                      fontSize: 12.5,
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ color: T.sub }}>
                      {passo?.rotulo ?? f.etapa}
                    </span>
                    <b style={{ fontVariantNumeric: "tabular-nums" }}>
                      {inteiro(f.quantidade)}
                    </b>
                  </div>
                  <div
                    style={{
                      background: T.soft,
                      borderRadius: 5,
                      height: 20,
                      overflow: "hidden",
                    }}
                  >
                    <i
                      style={{
                        background: passo?.cor ?? T.gold,
                        display: "block",
                        height: "100%",
                        width: `${Math.max(2, (f.quantidade / maiorFunil) * 100)}%`,
                      }}
                    />
                  </div>
                  <span style={{ color: T.muted, fontSize: 11 }}>
                    {dinheiro(f.vgv)}
                  </span>
                </div>
              );
            })}
          </div>
          <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
            {dados.periodo.de
              ? `Desempenho de ${mesCurto(dados.periodo.de)} a ${mesCurto(dados.periodo.ate ?? dados.periodo.de)}: ${inteiro(dados.periodo.propostasNoPeriodo)} propostas na janela.`
              : `${inteiro(dados.totais.propostas)} propostas no escopo, com o histórico inteiro desde 2023.`}{" "}
            As barras de reserva para baixo são o pipeline de HOJE, que a janela
            não filtra; {inteiro(perdidas)} saíram do caminho e não aparecem
            nelas.
          </p>
        </Cartao>

        <Cartao titulo="Quem está vendendo">
          {dados.ranking.length > 0 ? (
            <div style={{ margin: "-16px", overflowX: "auto" }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  fontSize: 13,
                  width: "100%",
                }}
              >
                <thead>
                  <tr>
                    {["Imobiliária", "Propostas", "Vendidas", "VGV"].map(
                      (c, i) => (
                        <th
                          key={c}
                          style={{
                            color: T.muted,
                            fontSize: 10.5,
                            fontWeight: 650,
                            padding: "10px 12px",
                            textAlign: i === 0 ? "left" : "right",
                          }}
                        >
                          {c}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {dados.ranking.slice(0, 10).map((r) => (
                    <tr key={r.imobiliaria}>
                      <td style={celula}>{toTitleCase(r.imobiliaria)}</td>
                      <td style={{ ...celula, textAlign: "right" }}>
                        {inteiro(r.propostas)}
                      </td>
                      <td style={{ ...celula, textAlign: "right" }}>
                        {inteiro(r.vendidas)}
                      </td>
                      <td
                        style={{
                          ...celula,
                          fontVariantNumeric: "tabular-nums",
                          textAlign: "right",
                        }}
                      >
                        {dinheiro(r.vgv)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
              Sem imobiliária no recorte.
            </p>
          )}
        </Cartao>
      </div>

      <Cartao titulo="Mês a mês">
        {dados.serie.length > 0 ? (
          <div
            style={{
              alignItems: "flex-end",
              display: "flex",
              gap: 8,
              minHeight: 140,
            }}
          >
            {dados.serie.slice(-18).map((s) => (
              <div
                key={s.mes}
                style={{
                  display: "grid",
                  flex: 1,
                  gap: 5,
                  justifyItems: "center",
                }}
              >
                <b style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                  {s.faturadas}
                </b>
                <div
                  style={{
                    background: T.gold,
                    borderRadius: "4px 4px 0 0",
                    height: `${Math.max(3, (s.faturadas / maiorSerie) * 100)}px`,
                    width: "100%",
                  }}
                  title={`${s.faturadas} faturadas · ${s.canceladas} canceladas`}
                />
                <div
                  style={{
                    background: T.danger,
                    borderRadius: "0 0 4px 4px",
                    height: `${Math.max(2, (s.canceladas / maiorSerie) * 40)}px`,
                    opacity: 0.55,
                    width: "100%",
                  }}
                />
                <span style={{ color: T.muted, fontSize: 10 }}>
                  {mesCurto(s.mes)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
            Sem série no recorte.
          </p>
        )}
        <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
          Dourado é faturamento; a barra vermelha embaixo é o que caiu no mesmo
          mês.
        </p>
      </Cartao>

      <Cartao titulo="Cancelamentos por motivo">
        {dados.motivos.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {dados.motivos.slice(0, 10).map((m) => (
              <div
                key={m.motivo}
                style={{ display: "flex", justifyContent: "space-between" }}
              >
                <span style={{ color: T.sub, fontSize: 12.5 }}>{m.motivo}</span>
                <b
                  style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}
                >
                  {m.n}
                </b>
              </div>
            ))}
          </div>
        ) : null}
        <p
          style={{
            color: T.sub,
            fontSize: 13,
            margin: dados.motivos.length > 0 ? "12px 0 0" : 0,
          }}
        >
          De {inteiro(perdidas)} propostas que caíram, {inteiro(comMotivo)} têm
          motivo registrado. O legado tinha o campo e ele quase nunca foi
          preenchido; quando o cancelamento passar a acontecer aqui, o motivo
          vira obrigatório e este quadro deixa de ser um número solto.
        </p>
      </Cartao>
    </div>
  );
}

// ── O HISTÓRICO DA UNIDADE ──────────────────────────────────────────────────
//
// Pedido do Lucas (03/09/2026): *"aqui eu quero ter um histórico de tudo que foi feito naquela
// unidade, tudo tem que ficar registrado, trazendo o que foi feito, quando, por quem tudo, um
// histórico bem completo"*.
//
// ⚠️ CARREGA SÓ QUANDO HÁ UNIDADE EM FOCO, e por rota própria: são 12.295 movimentações na base, e
// mandá-las junto com a tela seria pagar o custo por uma pergunta que quase nunca é feita.
//
// ⚠️ E O EIXO É O LOTE, NÃO A PROPOSTA. O lote 01 04 do Portal dos Vales teve proposta de sete
// clientes diferentes em quatro dias antes de vender: por isso cada evento diz de quem era a
// proposta naquele momento.
/**
 * AS TRÊS ABAS DA VENDA — chat, documentos e histórico.
 *
 * Lucas (06/09/2026): *"teremos nessa aba de histórico mais duas abas, documentos e chat (...) o
 * chat é onde vai ficar os registros de conversas, formalizações, observações, enfim, e histórico
 * fica sendo histórico mesmo"*. E, sobre a ordem: *"deixa o chat como principal, primeiro chat -
 * documentos - histórico"*.
 *
 * ⚠️ O CHAT ABRE PRIMEIRO PORQUE É ONDE SE TRABALHA. O histórico responde "o que aconteceu" — uma
 * pergunta que se faz de vez em quando, e que a máquina escreve sozinha. O chat é onde a pessoa
 * ESCREVE, e é o único dos três que fica vazio se ninguém abrir.
 *
 * ⚠️ CADA ABA CARREGA SÓ QUANDO É ABERTA, e continua montada depois. São três rotas diferentes:
 * abrir as três de uma vez custaria três consultas por clique em lote, para responder uma pergunta
 * que quase nunca é feita; desmontar ao trocar de aba perderia o que estivesse digitado no chat.
 */
function PainelDaVenda({
  aoSimular,
  unidadeId,
  versao,
}: {
  /** `null` quando não há lote em foco: o simulador precisa de um preço para trabalhar. */
  aoSimular: (() => void) | null;
  unidadeId: null | string;
  versao: number;
}) {
  const [aba, setAba] = useState<"chat" | "documentos" | "historico">("chat");
  const [visitadas, setVisitadas] = useState<Set<string>>(
    () => new Set(["chat"]),
  );

  useEffect(() => {
    // Trocar de lote recomeça no chat e esquece o que já foi carregado: a aba aberta era do lote
    // anterior, e manter a escolha faria a ficha nova abrir num painel que ainda mostra o antigo.
    setAba("chat");
    setVisitadas(new Set(["chat"]));
  }, [unidadeId]);

  const escolher = (qual: "chat" | "documentos" | "historico") => {
    setAba(qual);
    setVisitadas((atuais) =>
      atuais.has(qual) ? atuais : new Set([...atuais, qual]),
    );
  };

  return (
    <Cartao
      barra={
        <>
          {(
            [
              ["chat", "Chat"],
              ["documentos", "Documentos"],
              ["historico", "Histórico"],
            ] as const
          ).map(([chave, rotulo]) => (
            <Pilula
              ativo={aba === chave}
              key={chave}
              onClick={() => escolher(chave)}
              rotulo={rotulo}
            />
          ))}

          {/* ⚠️ O SIMULADOR VIROU BOTÃO, e não tem mais cartão próprio (Lucas, 07/09/2026: *"vamos
              tirar esse painel de simulador e deixar ele como um botão no painel de venda"*). Ele
              ocupava um bloco inteiro da coluna — título, parágrafo e botão — para uma ação de um
              clique, e empurrava para baixo o que se lê. Aqui ele fica onde a venda está, à direita
              das abas: presente, sem tomar a coluna. */}
          {aoSimular ? (
            <button
              onClick={aoSimular}
              style={{
                background: "transparent",
                border: `1px solid ${T.border}`,
                borderRadius: 999,
                color: T.sub,
                cursor: "pointer",
                font: "inherit",
                fontSize: 11.5,
                fontWeight: 600,
                marginLeft: "auto",
                padding: "5px 12px",
              }}
              type="button"
            >
              Simulador
            </button>
          ) : null}
        </>
      }
      maxAltura="58vh"
      titulo="Venda"
    >
      {/* ⚠️ `height: 100%` NAS TRÊS, e não só na do chat: é isso que faz o campo de escrever colar no
          rodapé em vez de subir junto com a lista. `display: none` mantém a aba montada — trocar de
          aba não pode perder o que estiver digitado. */}
      <div
        style={{
          display: aba === "chat" ? "block" : "none",
          height: "100%",
          minHeight: 0,
        }}
      >
        <ConversaDaVenda unidadeId={unidadeId} versao={versao} />
      </div>
      <div
        style={{
          display: aba === "documentos" ? "block" : "none",
          height: "100%",
          minHeight: 0,
        }}
      >
        {visitadas.has("documentos") ? (
          <DocumentosDaVenda unidadeId={unidadeId} versao={versao} />
        ) : null}
      </div>
      <div
        style={{
          display: aba === "historico" ? "block" : "none",
          height: "100%",
          minHeight: 0,
        }}
      >
        {visitadas.has("historico") ? (
          <Historico semCartao unidadeId={unidadeId} versao={versao} />
        ) : null}
      </div>
    </Cartao>
  );
}

function Historico({
  semCartao,
  unidadeId,
  versao,
}: {
  /** Dentro das abas o cartão é de fora: dois cartões aninhados viram duas molduras. */
  semCartao?: boolean;
  unidadeId: null | string;
  /**
   * Muda a cada carga do fluxo de venda — é o sinal para refazer a busca.
   *
   * ⚠️ SEM ELE O HISTÓRICO CONGELAVA NA PRIMEIRA ABERTURA. Reservar, gerar proposta, enviar para
   * contrato e cancelar recarregam a tela, mas nenhuma dessas ações muda o ID do lote: o efeito
   * daqui só dependia dele, e a ficha continuava contando a história de antes — no caso mais
   * grave, os eventos do cliente ANTERIOR, enquanto o topo já mostrava o novo.
   */
  versao: number;
}) {
  const [eventos, setEventos] = useState<EventoDaUnidade[]>([]);
  const [propostas, setPropostas] = useState(0);
  const [estado, setEstado] = useState<"carregando" | "erro" | "pronto">(
    "pronto",
  );
  const [tudo, setTudo] = useState(false);
  const [so, setSo] = useState<"assinatura" | "pagamento" | "tudo">("tudo");
  const [desde, setDesde] = useState("");

  useEffect(() => {
    setTudo(false);
    setSo("tudo");
    setDesde("");
    if (!unidadeId) {
      setEventos([]);
      setPropostas(0);
      return;
    }

    let vivo = true;
    setEstado("carregando");
    void (async () => {
      try {
        const r = await fetch(
          `/api/incorporador/venda/historico?unidade=${encodeURIComponent(unidadeId)}`,
          { cache: "no-store" },
        );
        const j = (await r.json().catch(() => null)) as null | {
          data?: { eventos: EventoDaUnidade[]; propostas: number };
        };
        if (!vivo) return;
        if (!r.ok || !j?.data) {
          setEstado("erro");
          return;
        }
        setEventos(j.data.eventos);
        setPropostas(j.data.propostas);
        setEstado("pronto");
      } catch {
        if (vivo) setEstado("erro");
      }
    })();

    return () => {
      vivo = false;
    };
    // ⚠️ `versao` ENTRA AQUI, e é o que refaz a busca depois de cada ação. Os filtros são
    // reiniciados junto de propósito: um recorte de "só pagamentos" aplicado antes esconderia
    // justamente o evento que a pessoa acabou de criar.
  }, [unidadeId, versao]);

  // Os anos que existem neste histórico — o filtro de data não oferece ano vazio.
  const anos = useMemo(
    () =>
      [...new Set(eventos.map((e) => e.quando.slice(0, 4)))].sort((a, b) =>
        b.localeCompare(a),
      ),
    [eventos],
  );

  // ⚠️ O FILTRO DE DATA TEM DE APARECER SEMPRE (Lucas, 03/09/2026: *"faltou o filtro de data"*).
  // A primeira versão usava o `Filtro` genérico, que se esconde com menos de duas opções — e num
  // lote cujos eventos são todos do mesmo ano ele simplesmente sumia. Períodos relativos existem
  // independentemente do que há na base, então a lista nunca fica com uma opção só.
  const opcoesDeData = useMemo(() => {
    const agora = new Date();
    const menos = (dias: number) =>
      new Date(agora.getTime() - dias * 86_400_000).toISOString().slice(0, 10);
    return [
      { rotulo: "Todo o período", valor: "" },
      { rotulo: "Últimos 30 dias", valor: `>=${menos(30)}` },
      { rotulo: "Últimos 90 dias", valor: `>=${menos(90)}` },
      { rotulo: "Últimos 12 meses", valor: `>=${menos(365)}` },
      ...anos.map((a) => ({ rotulo: a, valor: a })),
    ];
  }, [anos]);

  const filtrados = useMemo(
    () =>
      eventos.filter((e) => {
        if (so !== "tudo" && e.tipo !== so) return false;
        if (!desde) return true;
        // `>=AAAA-MM-DD` é o corte relativo; o resto é ano cheio.
        return desde.startsWith(">=")
          ? e.quando.slice(0, 10) >= desde.slice(2)
          : e.quando.startsWith(desde);
      }),
    [desde, eventos, so],
  );

  if (!unidadeId) return null;

  const visiveis = tudo ? filtrados : filtrados.slice(0, 15);
  const pagos = eventos
    .filter((e) => e.tipo === "pagamento" && e.valor)
    .reduce((a, e) => a + (e.valor ?? 0), 0);

  const filtros =
    eventos.length > 0 ? (
      <>
        {/* ⚠️ FILTRO DE TIPO E DE DATA (Lucas, 03/09/2026: *"colocar um filtro de data"*). Um
                lote com trinta registros vira uma parede; a pergunta real costuma ser "o que
                aconteceu de dinheiro" ou "o que houve neste ano". */}
        {(
          [
            ["tudo", `Tudo ${eventos.length}`],
            ["pagamento", "Pagamentos"],
            ["assinatura", "Assinaturas"],
          ] as const
        ).map(([chave, rotulo]) => (
          <Pilula
            ativo={so === chave}
            key={chave}
            onClick={() => setSo(chave)}
            rotulo={rotulo}
          />
        ))}
        <select
          aria-label="Período"
          onChange={(e) => setDesde(e.target.value)}
          style={{
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 999,
            color: T.text,
            cursor: "pointer",
            font: "inherit",
            fontSize: 12.5,
            fontWeight: 600,
            padding: "6px 10px",
          }}
          value={desde}
        >
          {opcoesDeData.map((o) => (
            <option key={o.valor} value={o.valor}>
              {o.rotulo}
            </option>
          ))}
        </select>
        {pagos > 0 ? (
          <span
            style={{
              color: T.ok,
              fontSize: 11.5,
              fontWeight: 650,
              marginLeft: "auto",
            }}
          >
            {dinheiro(pagos)} pagos
          </span>
        ) : null}
      </>
    ) : null;

  const corpo = (
    <>
      {estado === "carregando" ? (
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Carregando…</p>
      ) : estado === "erro" ? (
        <p style={{ color: T.danger, fontSize: 13, margin: 0 }}>
          Não consegui carregar o histórico agora.
        </p>
      ) : eventos.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
          Nada registrado nesta unidade. Ela nunca teve proposta.
        </p>
      ) : filtrados.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
          Nada com esse filtro.
        </p>
      ) : (
        <>
          {/* ⚠️ O DESENHO É UMA LINHA DO TEMPO, e não uma lista de parágrafos. A data fica numa
              coluna fixa à esquerda e o fato à direita: o olho desce pela data procurando "quando",
              que é como se lê histórico. Antes tudo era texto corrido e o Lucas achou "estranho". */}
          <div style={{ display: "grid", gap: 0 }}>
            {visiveis.map((e, i) => {
              const anterior = visiveis[i - 1];
              // O nome do cliente só aparece quando MUDA: repetir "ALEXANDRE" em doze linhas
              // seguidas era metade do ruído da lista.
              const mostrarCliente =
                e.cliente && e.cliente !== anterior?.cliente;
              // ⚠️ A TRANSIÇÃO GANHA A COR DA ETAPA DE DESTINO (Lucas, 03/09/2026: *"deixar essas
              // transições reserva - proposta na cor que estamos usando para marcar na grade,
              // cancelamento em vermelho"*). A grade já ensinou o olho: azul é proposta, violeta é
              // contrato, grafite é assinatura. O histórico usar outra paleta obrigaria a aprender
              // duas — e cancelamento em cinza escondia justamente o que se procura.
              const cor = corDoEvento(e);

              return (
                <div key={e.id}>
                  {mostrarCliente ? (
                    <div
                      style={{
                        color: T.sub,
                        fontSize: 11,
                        fontWeight: 650,
                        letterSpacing: ".03em",
                        paddingTop: i === 0 ? 0 : 12,
                        textTransform: "uppercase",
                      }}
                    >
                      {e.cliente}
                    </div>
                  ) : null}

                  <div
                    style={{
                      display: "grid",
                      gap: 10,
                      gridTemplateColumns: "62px 8px minmax(0, 1fr)",
                      padding: "7px 0",
                    }}
                  >
                    <span
                      style={{
                        color: T.muted,
                        fontSize: 11,
                        fontVariantNumeric: "tabular-nums",
                        lineHeight: 1.35,
                        paddingTop: 1,
                      }}
                    >
                      {diaCurto(e.quando)}
                      <br />
                      <span style={{ opacity: 0.75 }}>{hora(e.quando)}</span>
                    </span>

                    {/* O fio da linha do tempo, com o ponto do evento. */}
                    <span
                      style={{
                        display: "grid",
                        justifyItems: "center",
                        position: "relative",
                      }}
                    >
                      <span
                        style={{
                          background: cor,
                          borderRadius: "50%",
                          height: 7,
                          marginTop: 5,
                          width: 7,
                        }}
                      />
                      <span
                        style={{ background: T.border, flex: 1, width: 1 }}
                      />
                    </span>

                    <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 12.5, lineHeight: 1.35 }}>
                        {e.fato}
                        {/* ⚠️ O COD FICA JUNTO DO FATO (Lucas, 04/09/2026: *"aqui pode vir o código
                            também"*). Ele já ia no WhatsApp e já era buscável nesta tela, mas não
                            aparecia em lugar nenhum — dava para procurar por um número que a tela
                            nunca mostrou. Monoespaçado, como no resto do portal: é para conferir
                            dígito a dígito com o que chegou na mensagem. */}
                        {e.codigo ? (
                          <span
                            style={{
                              color: T.muted,
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: 11,
                              fontWeight: 600,
                              letterSpacing: ".04em",
                            }}
                          >
                            {" "}
                            · {e.codigo}
                          </span>
                        ) : null}
                        {e.valor ? (
                          <span style={{ color: T.ok }}>
                            {" "}
                            · {dinheiro(e.valor)}
                          </span>
                        ) : null}
                      </b>
                      {e.quem ? (
                        <span style={{ color: T.muted, fontSize: 11 }}>
                          {e.quem}
                        </span>
                      ) : null}
                      {e.observacao ? (
                        <span
                          style={{
                            color: T.muted,
                            fontSize: 11,
                            opacity: 0.85,
                          }}
                        >
                          {e.observacao}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {filtrados.length > 15 && !tudo ? (
            <button
              onClick={() => setTudo(true)}
              style={{
                background: "transparent",
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                color: T.sub,
                cursor: "pointer",
                font: "inherit",
                fontSize: 12,
                fontWeight: 600,
                marginTop: 10,
                padding: "6px 12px",
                width: "100%",
              }}
              type="button"
            >
              Ver os {inteiro(filtrados.length)} registros
            </button>
          ) : null}
        </>
      )}
    </>
  );

  // ⚠️ DENTRO DAS ABAS O CARTÃO É DE FORA. Dois cartões aninhados viram duas molduras com dois
  // títulos para a mesma coisa, e a rolagem passa a ser de um dos dois — nunca dos dois juntos.
  if (semCartao) {
    return (
      // ⚠️ OS FILTROS FICAM FORA DO QUE ROLA, como faziam na barra do cartão. Um filtro que sobe
      // junto com a lista obriga a voltar ao topo para refinar — e é justamente descendo a lista
      // que se percebe o que precisa ser filtrado.
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateRows: "auto 1fr",
          minHeight: 0,
        }}
      >
        {filtros || propostas > 0 ? (
          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {filtros}
            {/* ⚠️ O CONTADOR DE PROPOSTAS NÃO SOME só porque o cartão passou a ser de fora: ele é
                a única coisa na tela que diz quantas vendas este lote já teve. */}
            {propostas > 0 ? (
              <span
                style={{ color: T.muted, fontSize: 11.5, marginLeft: "auto" }}
              >
                {inteiro(propostas)} proposta(s)
              </span>
            ) : null}
          </div>
        ) : null}
        <div style={{ minHeight: 0, overflow: "auto" }}>{corpo}</div>
      </div>
    );
  }

  return (
    <Cartao
      barra={filtros}
      direita={
        propostas > 0 ? (
          <span style={{ color: T.muted, fontSize: 11.5 }}>
            {inteiro(propostas)} proposta(s)
          </span>
        ) : null
      }
      rolagem
      titulo="Histórico da unidade"
    >
      {corpo}
    </Cartao>
  );
}

// ── AS PEÇAS DE UMA VISÃO ANALÍTICA ─────────────────────────────────────────
//
// ⚠️ BUSCA E FILTRO SÃO PADRÃO, e não enfeite desta tela. Lucas (03/09/2026): *"no analítico,
// coloca filtros, buscar. Sempre ter isso como padrão em visões analíticas"*. Toda lista longa
// nasce com os dois — uma tabela de 150 linhas sem busca obriga a rolar procurando com o olho, que
// é o oposto do que uma visão analítica existe para fazer.

function Busca({
  aoMudar,
  placeholder,
  valor,
}: {
  aoMudar: (v: string) => void;
  placeholder: string;
  valor: string;
}) {
  return (
    <span
      style={{
        alignItems: "center",
        display: "inline-flex",
        gap: 6,
        position: "relative",
      }}
    >
      <Search
        aria-hidden="true"
        size={13}
        style={{
          color: T.muted,
          left: 10,
          pointerEvents: "none",
          position: "absolute",
        }}
      />
      <input
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={placeholder}
        style={{
          background: T.soft,
          border: `1px solid ${T.border}`,
          borderRadius: 999,
          color: T.text,
          font: "inherit",
          fontSize: 12.5,
          minWidth: 210,
          padding: "6px 12px 6px 28px",
        }}
        type="search"
        value={valor}
      />
    </span>
  );
}

function Filtro({
  aoMudar,
  opcoes,
  rotuloDeTodos,
  valor,
}: {
  aoMudar: (v: string) => void;
  opcoes: string[];
  rotuloDeTodos: string;
  valor: string;
}) {
  // Um filtro com uma opção só não filtra nada: ele só ocupa espaço e sugere uma escolha que não
  // existe.
  if (opcoes.length < 2) return null;

  return (
    <select
      aria-label={rotuloDeTodos}
      onChange={(e) => aoMudar(e.target.value)}
      style={{
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 999,
        color: T.text,
        cursor: "pointer",
        font: "inherit",
        fontSize: 12.5,
        fontWeight: 600,
        maxWidth: 230,
        padding: "6px 10px",
      }}
      value={valor}
    >
      <option value="">{rotuloDeTodos}</option>
      {opcoes.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** Compara ignorando caixa e acento — o operador digita "sao" e espera achar "SÃO". */
function contem(alvo: null | string | undefined, busca: string): boolean {
  if (!busca) return true;
  return String(alvo ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes(busca);
}

/** O texto da busca, pronto para comparar. */
function normalizar(v: string): string {
  return v
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// ── PEÇAS ───────────────────────────────────────────────────────────────────

const celula = {
  borderTop: `1px solid ${T.border}`,
  padding: "9px 12px",
} as const;

function Cartao({
  barra,
  children,
  direita,
  maxAltura,
  rolagem,
  titulo,
}: {
  /**
   * Uma faixa entre o cabeçalho e o corpo — busca e filtros, tipicamente.
   *
   * ⚠️ FICA FORA DA ÁREA QUE ROLA, de propósito: um campo de busca que some quando a pessoa desce
   * a lista obriga a subir de volta para refinar, e é justamente descendo a lista que se percebe
   * o que precisa ser filtrado.
   */
  barra?: React.ReactNode;
  children: React.ReactNode;
  direita?: React.ReactNode;
  /**
   * Teto de altura, em % da área de trabalho.
   *
   * ⚠️ SEM ELE O ESTOQUE COME O ANALÍTICO. O quadro cresce com a quantidade de quadras — o Vale do
   * Ouro tem 15, o Jardim das Gerais 27 — e numa linha de grid `auto` ele tomaria a altura toda,
   * deixando a lista com três linhas. O teto devolve o resto para quem está embaixo.
   */
  maxAltura?: string;
  /**
   * O corpo rola por dentro, e o cabeçalho fica.
   *
   * ⚠️ É O PEDIDO DO LUCAS (03/09/2026): *"eu não quero a barra de rolagem na tela toda, quero nos
   * painéis (...) teríamos que ter a barra de rolagem no painel que traz o analítico"*. Com a
   * página inteira rolando, descer até a linha 80 da lista levava embora a faixa do fluxo, o mapa
   * e o simulador — some justamente o contexto que faz a lista significar alguma coisa.
   */
  rolagem?: boolean;
  titulo: string;
}) {
  return (
    <section
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 13,
        // `minHeight: 0` é o que permite ao corpo encolher e rolar: sem ele o flex item cresce até
        // o tamanho do conteúdo e empurra a rolagem de volta para a página.
        ...(rolagem
          ? {
              display: "flex",
              flex: "1 1 auto",
              flexDirection: "column",
              minHeight: 240,
              overflow: "hidden",
            }
          : {}),
        ...(maxAltura ? { maxHeight: maxAltura } : {}),
        minWidth: 0,
      }}
    >
      <div
        style={{
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          justifyContent: "space-between",
          padding: "13px 16px",
        }}
      >
        <h2 style={{ color: T.text, fontSize: 14, fontWeight: 650, margin: 0 }}>
          {titulo}
        </h2>
        {direita}
      </div>
      {barra ? (
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            padding: "10px 16px",
          }}
        >
          {barra}
        </div>
      ) : null}
      <div
        style={{
          minHeight: 0,
          padding: 16,
          ...(rolagem ? { flex: "1 1 auto", overflow: "auto" } : {}),
        }}
      >
        {children}
      </div>
    </section>
  );
}

function Kpi({
  nota,
  rotulo,
  valor,
}: {
  nota: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: "13px 14px",
      }}
    >
      <span
        style={{
          color: T.muted,
          fontSize: 10.5,
          fontWeight: 650,
          letterSpacing: ".07em",
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </span>
      <div
        style={{
          fontSize: 23,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 650,
          marginTop: 6,
        }}
      >
        {valor}
      </div>
      <div style={{ color: T.muted, fontSize: 11.5, marginTop: 4 }}>{nota}</div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div
      style={{
        borderTop: `1px dashed ${T.border}`,
        display: "flex",
        gap: 10,
        justifyContent: "space-between",
        padding: "6px 0",
      }}
    >
      <span style={{ color: T.sub, fontSize: 12.5 }}>{rotulo}</span>
      <b
        style={{
          fontSize: 12.5,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 650,
        }}
      >
        {valor}
      </b>
    </div>
  );
}
