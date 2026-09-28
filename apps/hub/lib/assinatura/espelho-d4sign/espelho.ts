import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool, PoolConnection } from "mysql2/promise";

import {
  carregarCatalogoD4Sign,
  type ConsultaD4Sign,
  consultarDocumentoD4Sign,
  d4signEmRecuoPorCota,
  d4signRecusouPorCotaDesde,
  disjuntorD4SignAberto,
  type DocumentoD4Sign,
  type SignatarioD4Sign,
  type SituacaoD4Sign,
} from "@/lib/guardian/d4sign-consulta";
import { terrenosDasUnidades } from "@/lib/hercules/terreno";

import { consultarEnvelope, type ResultadoDaLeitura } from "../clicksign/envelope";
import { aplicarEnvelopeNaVenda, type MudancaDoEnvelope, reconciliarVendasAssinadas } from "../envelope-na-venda";
import { envelopeVigente } from "../envelope-vigente";
import {
  type ChamadaDoRegistro,
  chamarRegistroDasAssinaturas,
  type EntradaDoRegistro,
  type ItemDoQuadro,
  lerQuadro,
} from "../registro-db";
import type { EstadoDaAssinatura, FinalidadeDoEnvelope } from "../tipos";
import {
  abrirLeituraDoC2x,
  descartarLeituraDoC2x,
  documentosDosCompradores,
  type EnvioDoC2x,
  fecharLeituraDoC2x,
  lerEnviosDoC2x,
  lerPessoasDosEnvios,
  type PessoaDoC2x,
} from "./c2x";
import { type CasamentoDoEnvio, casarEnvioComAVenda, precisaDoComprador, type PropostaCandidata } from "./casamento";
import { finalidadeDoTipoDoC2x } from "./finalidade";
import { fechamentoCompletoDaD4Sign, fechamentoDaD4Sign, marcasDaD4Sign, quadroDoEnvioDoC2x } from "./quadro";

// O ESPELHO DA D4SIGN: O CONTRATO QUE O C2X MANDOU PASSA A MORAR NO PANTEON (F3 do plano da fonte única).
//
// Lucas, 28/09/2026: *"já cansei de falar que informações de venda, contrato, assinatura tem que morar em
// um local e ele alimentar tudo"* e *"pode seguir, faz tudo morar no Panteon"*. Até aqui o status da
// D4Sign vivia num Map em memória de cada instância da Vercel, e cada tela chamava a D4Sign sozinha.
// Depois desta fatia, `temis_envelopes` tem uma linha `provedor = 'd4sign', origem = 'c2x'` por documento
// que o C2X mandou, de unidade que o Panteon tem, com o estado do catálogo, quem assinou (pelo `/list`),
// a finalidade pelo tipo do C2X e a venda pelo casamento da seção 3. Cron e script chamam ESTA função.
//
// UMA RODADA (seção 6 do plano): 0. a vez → 1. descobre (C2X + Panteon) → 2. insere o envio novo →
// 3. estado pelo catálogo → 4. por pessoa pelo `/list` → 5. efeito na venda → 6. reconciliação →
// 7. rede da Clicksign → 8. fecha a vez.
//
// ⚠️ AS GUARDAS, TODAS (seção 6):
//   • nunca grava CPF, IP, geolocalização, user-agent nem `sign_info`; o documento do comprador vive só
//     em memória; a credencial da D4Sign só na query string de `d4sign-consulta.ts`;
//   • log e relatório só com ids, códigos e contagens (`code` do erro, nunca o objeto inteiro: o
//     "Failing row contains (...)" do PostgREST traz o jsonb);
//   • falha não apaga: NENHUM `delete`; estado só pela função da 0195; `proposta_id` preenchido não é
//     trocado (a linha já ligada nunca é religada; só a de `proposta_id` nulo é reavaliada, seção 3);
//   • disjuntor aberto → o passo do `/list` para; catálogo nulo → nenhum estado da D4Sign na rodada;
//   • orçamento: cada passo confere o que sobra e para com 20 s de folga;
//   • HTTP 429 → para, grava `d4sign_pausada_ate = agora + 1 h` e relata `pausadoPorCota`;
//   • a leitura do C2X fecha ao fim do passo 2 (e é DESTRUÍDA se uma consulta falhou); a vez da rodada
//     tem dono (renovar e fechar só com o `em_curso_ate` que esta rodada gravou).
//
// ⚠️ SEM `gravar` NADA É ESCRITO (é o ensaio): nem a vez, nem `tentado_em`, nem a pausa, nem o
// relatório. O ensaio lê o C2X, o catálogo, o Panteon e o `/list` de uma amostra, e CONTA o que faria.
// E ele roda mesmo com a 0195 ainda não aplicada (colunas novas ausentes): nesse caso trata o espelho
// como vazio e diz `semA0195: true` no relatório (a gravação exige a 0195 e recusa sem ela).

const WORKSPACE = "careli";

/** O tamanho da página (o teto de 1.000 do PostgREST) e do lote do `.in()` (a URL). */
const PAGINA = 1000;
const LOTE = 100;

/** A vez da rodada vale 5 min e é renovada durante o `/list` longo do script. */
const VEZ_MS = 5 * 60 * 1000;
const RENOVAR_A_VEZ_MS = 60 * 1000;
/** HTTP 429: ninguém chama a D4Sign por 1 h. */
const PAUSA_POR_COTA_MS = 60 * 60 * 1000;
/** A folga do orçamento: cada passo para quando sobra menos que isto. */
const FOLGA_MS = 20_000;
/** O recuo por idade do rodízio (seção 6, passo 4). */
const DIA_MS = 24 * 60 * 60 * 1000;
/** A carga inicial pede `/list` dos envios dos últimos 120 dias (seção 6). */
const JANELA_DO_LIST_MS = 120 * DIA_MS;
/** A reconciliação refaz no máximo 20 vendas por rodada (seção 7). */
const LIMITE_DA_RECONCILIACAO = 20;
/** A rede da Clicksign confere no máximo 5 envelopes por rodada (é rara e barata). */
const LIMITE_DA_REDE_DA_CLICKSIGN = 5;
/** A reavaliação do `sem_venda` olha no máximo isto por rodada, os envios mais novos primeiro. */
const LIMITE_DA_REAVALIACAO = 200;
/** O relatório lista no máximo isto de ligações e candidatas (só ids). */
const TETO_DA_LISTA_NO_RELATORIO = 200;
/** `so` aceita até 50 envios (Segurança 17). */
export const TETO_DO_SO = 50;

/** `?so=3806,3807`: só inteiros positivos, até 50. `null` = pedido inválido. */
// ⚠️ MORA AQUI, E NÃO NA ROTA: arquivo de rota do Next só pode exportar os handlers e a configuração.
export function lerSoDoPedido(bruto: null | string): null | number[] | undefined {
  if (bruto === null || bruto.trim() === "") return undefined;
  const partes = bruto.split(",").map((p) => p.trim()).filter(Boolean);
  if (partes.length === 0 || partes.length > TETO_DO_SO) return null;
  const ids: number[] = [];
  for (const parte of partes) {
    if (!/^\d{1,12}$/.test(parte)) return null;
    const n = Number(parte);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    ids.push(n);
  }
  return [...new Set(ids)];
}

const ORDEM_DO_ESTADO: Readonly<Record<EstadoDaAssinatura, number>> = {
  aguardando: 2,
  assinado: 4,
  cancelado: 4,
  desconhecido: 1,
  expirado: 4,
  parcial: 3,
  rascunho: 0,
  recusado: 4,
};
const TERMINAIS: ReadonlySet<string> = new Set(["assinado", "recusado", "cancelado", "expirado"]);
const EM_MOVIMENTO: ReadonlySet<string> = new Set(["aguardando", "parcial", "desconhecido"]);
const ANTES_DE_ENTRAR: ReadonlySet<string> = new Set(["novo", "rascunho", "desconhecido"]);
const EM_ASSINATURA: ReadonlySet<string> = new Set(["aguardando", "parcial"]);
const ETAPAS_COM_CONTRATO_EM_CURSO: ReadonlySet<string> = new Set(["contrato", "assinatura"]);

export type OpcoesDoEspelho = {
  concorrencia: number; // cron 3; script 1 (vazão fixa)
  intervaloMs: number; // cron 0; script 2_000 entre chamadas à D4Sign
  gravar: boolean; // cron true; script só com --gravar; POST só com ?gravar=1
  moverVendas: boolean; // cron: MOVER_VENDAS (false até a prova da F3); script: --mover-vendas
  orcamentoMs: number; // cron 240_000 (maxDuration 300); script Infinity
  tetoDeListas: number; // cron 20; script: o recorte da carga inicial (seção 6)
  refazer?: boolean; // só script: refaz o /list de quem já tem conferido_em
  so?: readonly number[]; // cs ids, até 50, para ensaiar um envio
};

export type RelatorioDoEspelho = {
  candidatas: Array<{ csId: number; motivo: string; propostaId: string }>;
  candidatasNaoLigadas: number;
  casamentos: Record<string, number>;
  comCancelamentoAberto: number;
  d4signFora: boolean;
  doisContratosVivos: number;
  duracaoMs: number;
  efeitosPlanejados: number;
  enviosNoC2x: number;
  estadosDoCatalogo: Record<string, number>;
  estadosMudaram: number;
  falhas: string[]; // ids e códigos, nunca nome ou e-mail
  finalidadeNaoMapeada: Record<string, number>;
  gravou: boolean;
  inseridos: number;
  ligacoesComNativa: Array<{ csId: number; propostaId: string; regra: string }>;
  lidosPorTabela: Record<string, number>;
  listas: number;
  naoPareados: number;
  novos: number;
  pausadoPorCota: boolean;
  reconciliadas: number;
  redeDaClicksign: number;
  /** Linhas `sem_venda` que a reavaliação ligou a uma venda nesta rodada (seção 3, regra 4). */
  religadas: number;
  restamEmMovimento: number;
  semA0195: boolean;
  /** Finalizado de venda nativa cujo `/list` veio sem a data de alguém que assinou: não virou assinado. */
  semDataReal: number;
  semUnidade: number;
  semUuid: number;
  status6: number;
  tiposDoC2x: Record<string, number>;
  vendasMovidas: number;
};

/** A D4Sign, como o espelho a usa. A de verdade é `D4SIGN_DE_VERDADE`; o teste passa uma falsa. */
export type PortaDaD4Sign = {
  catalogo(): Promise<null | Map<string, DocumentoD4Sign>>;
  /** A D4Sign respondeu 429 desde este instante (ms)? */
  cotaRecusadaDesde(instante: number): boolean;
  disjuntorAberto(): boolean;
  lista(uuid: string): Promise<ConsultaD4Sign>;
};

export const D4SIGN_DE_VERDADE: PortaDaD4Sign = {
  catalogo: carregarCatalogoD4Sign,
  // ⚠️ O RECUO DA COTA TAMBÉM É COTA: com ele valendo, o catálogo devolve `null` sem sair para a rede
  // (outra tela da mesma instância levou o 429), e o espelho precisa pausar, não relatar "catálogo fora".
  cotaRecusadaDesde: (instante) => d4signRecusouPorCotaDesde(instante) || d4signEmRecuoPorCota(),
  disjuntorAberto: disjuntorD4SignAberto,
  lista: consultarDocumentoD4Sign,
};

/** As outras portas, trocáveis no teste. */
export type PortasDoEspelho = {
  agora?: () => number;
  aplicarNaVenda?: typeof aplicarEnvelopeNaVenda;
  clicksign?: (envelopeId: string) => Promise<ResultadoDaLeitura>;
  dormir?: (ms: number) => Promise<void>;
  reconciliar?: typeof reconciliarVendasAssinadas;
  registrar?: (sb: SupabaseClient, envelopeId: string, entrada: EntradaDoRegistro) => Promise<ChamadaDoRegistro>;
};

type ErroDoBanco = null | { code?: string; message?: string };

/** A linha do espelho, estreita (o jsonb do quadro só de quem vai ao `/list`). */
export type LinhaDoEspelho = {
  atualizado_em: null | string;
  c2x_contract_signature_id: null | number | string;
  conferido_em: null | string;
  criado_em: string;
  estado: EstadoDaAssinatura;
  estado_cru: null | string;
  fechado_em: null | string;
  finalidade: FinalidadeDoEnvelope | null;
  id: string;
  origem: null | string;
  proposta_id: null | string;
  provedor_documento_id: null | string;
  tentado_em: null | string;
  trabalho_id: null | string;
  unidade_id: null | string;
};

const COLUNAS_DO_ESPELHO =
  "id, provedor_documento_id, c2x_contract_signature_id, estado, estado_cru, proposta_id, unidade_id, conferido_em, tentado_em, criado_em, atualizado_em, finalidade, fechado_em, trabalho_id, origem";

type LinhaDaUnidade = {
  codigo: string;
  enterprise_id: number | string;
  espelho_de: null | string;
  id: string;
  lote: null | string;
  origem_c2x_id: null | number | string;
  quadra: null | string;
};

type LinhaDaProposta = {
  cancelada_em: null | string;
  cancelamento_pedido_em: null | string;
  cliente_documento: null | string;
  criado_em: string;
  criado_em_c2x: null | string;
  etapa: string;
  id: string;
  origem: null | string;
  origem_c2x_id: null | number | string;
  unidade_id: null | string;
};

const COLUNAS_DA_PROPOSTA =
  "id, unidade_id, origem, origem_c2x_id, etapa, cancelada_em, cancelamento_pedido_em, criado_em, criado_em_c2x, cliente_documento";

/** A venda de uma linha que JÁ está ligada: só o que os passos 3 a 5 usam. */
type VendaLigada = Pick<LinhaDaProposta, "cancelada_em" | "cancelamento_pedido_em" | "etapa" | "id" | "origem">;

// ⚠️ SEM `cliente_documento` (seção 6, leitura estreita): o documento do comprador só serve ao
// casamento do envio novo; a venda da linha que já existe é lida toda rodada e não precisa dele.
const COLUNAS_DA_VENDA_LIGADA = "id, origem, etapa, cancelada_em, cancelamento_pedido_em";

/** Uma linha em jogo nesta rodada. */
export type EmJogo = {
  envio: EnvioDoC2x | null;
  /** O estado que a rodada deixou (atualizado a cada chamada da função). */
  estado: EstadoDaAssinatura;
  /** O finalizado de venda nativa espera o `/list` (seção 6, passo 3). */
  finalizadoAdiado: boolean;
  jaListado: boolean;
  linha: LinhaDoEspelho;
  /** A venda ligada é nativa? `null` = não se sabe (não lida). */
  nativa: boolean | null;
  nova: boolean;
  quadro: ItemDoQuadro[] | null;
  /** A venda ligada está em contrato ou assinatura, viva (o recorte do `/list` da carga). */
  vendaEmCurso: boolean;
};

function relatorioVazio(gravar: boolean): RelatorioDoEspelho {
  return {
    candidatas: [],
    candidatasNaoLigadas: 0,
    casamentos: {},
    comCancelamentoAberto: 0,
    d4signFora: false,
    doisContratosVivos: 0,
    duracaoMs: 0,
    efeitosPlanejados: 0,
    enviosNoC2x: 0,
    estadosDoCatalogo: {},
    estadosMudaram: 0,
    falhas: [],
    finalidadeNaoMapeada: {},
    gravou: gravar,
    inseridos: 0,
    ligacoesComNativa: [],
    lidosPorTabela: {},
    listas: 0,
    naoPareados: 0,
    novos: 0,
    pausadoPorCota: false,
    reconciliadas: 0,
    redeDaClicksign: 0,
    religadas: 0,
    restamEmMovimento: 0,
    semA0195: false,
    semDataReal: 0,
    semUnidade: 0,
    semUuid: 0,
    status6: 0,
    tiposDoC2x: {},
    vendasMovidas: 0,
  };
}

const somar = (mapa: Record<string, number>, chave: string, n = 1) => {
  mapa[chave] = (mapa[chave] ?? 0) + n;
};

/** Só o `code` (e um pedaço da mensagem SEM dado): o objeto inteiro do PostgREST pode trazer a linha. */
function codigoDoErro(erro: ErroDoBanco | unknown): string {
  if (erro && typeof erro === "object" && "code" in erro) {
    const code = (erro as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return "erro";
}

function emLotes<T>(itens: readonly T[], tamanho = LOTE): T[][] {
  const unicos = [...new Set(itens)];
  const lotes: T[][] = [];
  for (let i = 0; i < unicos.length; i += tamanho) lotes.push(unicos.slice(i, i + tamanho));
  return lotes;
}

/** O estado proposto ANDA? (a função decide de verdade; isto só evita chamada à toa). */
function avanca(atual: EstadoDaAssinatura, proposto: EstadoDaAssinatura | null): proposto is EstadoDaAssinatura {
  if (!proposto || proposto === "desconhecido") return false;
  if (TERMINAIS.has(atual)) return false;
  return ORDEM_DO_ESTADO[proposto] > ORDEM_DO_ESTADO[atual];
}

/** A situação da D4Sign na língua da casa. `finalizado` → `assinado`; `desconhecida` → nada. */
function estadoDaSituacao(situacao: SituacaoD4Sign): EstadoDaAssinatura | null {
  switch (situacao) {
    case "aguardando-assinaturas":
    case "aguardando-signatarios":
      return "aguardando";
    case "cancelado":
      return "cancelado";
    case "finalizado":
      return "assinado";
    default:
      return null;
  }
}

const crueDaD4Sign = (documento: DocumentoD4Sign) => `d4sign:${documento.statusId ?? documento.situacao}`;

/** A coluna não existe (a 0195 ainda não foi aplicada)? */
function semColuna(erro: ErroDoBanco): boolean {
  const code = String(erro?.code ?? "");
  return code === "42703" || code === "PGRST204";
}
function semTabela(erro: ErroDoBanco): boolean {
  const code = String(erro?.code ?? "");
  return code === "42P01" || code === "PGRST205";
}

/**
 * UMA RODADA DO ESPELHO. NUNCA LANÇA: toda falha vira código em `falhas`.
 *
 * @param entrada.admin O cliente com service_role (o espelho escreve em tabela sem policy).
 * @param entrada.pool  O pool do C2X (`getHadesDbPool`): o espelho tira UMA conexão só-leitura dele.
 */
export async function espelharD4Sign(entrada: {
  admin: SupabaseClient;
  d4sign?: PortaDaD4Sign;
  opcoes: OpcoesDoEspelho;
  pool: Pick<Pool, "getConnection">;
  portas?: PortasDoEspelho;
}): Promise<RelatorioDoEspelho> {
  const { admin: sb, opcoes, pool } = entrada;
  const d4sign = entrada.d4sign ?? D4SIGN_DE_VERDADE;
  const portas = entrada.portas ?? {};
  const agora = portas.agora ?? Date.now;
  const dormir = portas.dormir ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const registrar = portas.registrar ?? chamarRegistroDasAssinaturas;
  const aplicarNaVenda = portas.aplicarNaVenda ?? aplicarEnvelopeNaVenda;
  const reconciliar = portas.reconciliar ?? reconciliarVendasAssinadas;
  const clicksign = portas.clicksign ?? ((id: string) => consultarEnvelope(id));

  const inicio = agora();
  const gravar = opcoes.gravar;
  const relatorio = relatorioVazio(gravar);
  const falhar = (codigo: string) => {
    if (relatorio.falhas.length < 200) relatorio.falhas.push(codigo);
  };
  const iso = (ms: number) => new Date(ms).toISOString();

  // ⚠️ O ESTADO DA RODADA VEM ANTES DE QUALQUER `return`: `fechar` o lê (sem isto, a saída cedo do `so`
  // inválido cairia na zona morta do `let`).
  let pausadaAte = 0;
  let tomouAVez = false;
  /** O `em_curso_ate` que ESTA rodada gravou: a vez tem dono (renovar e fechar só se ainda for ele). */
  let minhaVez: null | string = null;
  let perdeuAVez = false;

  const so = opcoes.so ? [...new Set(opcoes.so)].filter((n) => Number.isSafeInteger(n) && n > 0) : null;
  if (so && (so.length === 0 || so.length > TETO_DO_SO)) {
    falhar("so_invalido");
    return fechar(relatorio);
  }

  // ── 0. A VEZ ────────────────────────────────────────────────────────────
  if (gravar) {
    const vez = iso(agora() + VEZ_MS);
    const { data, error } = await sb
      .from("temis_espelho_d4sign")
      .update({ atualizado_em: iso(agora()), em_curso_ate: vez })
      .eq("id", 1)
      .or(`em_curso_ate.is.null,em_curso_ate.lt.${iso(agora())}`)
      .select("id, d4sign_pausada_ate");
    if (error) {
      // ⚠️ SEM A 0195 NÃO SE GRAVA NADA: a tabela da vez, as colunas e a função são dela.
      falhar(semTabela(error) ? "sem_a_0195" : `vez:${codigoDoErro(error)}`);
      return fechar(relatorio);
    }
    const linha = (Array.isArray(data) ? data[0] : null) as null | { d4sign_pausada_ate?: null | string } | undefined;
    if (!linha) {
      // Outra rodada está no ar (retry da Vercel, POST manual e cron juntos): esta sai sem fazer nada.
      falhar("outra_rodada_em_curso");
      relatorio.gravou = false;
      return fechar(relatorio, false);
    }
    tomouAVez = true;
    minhaVez = vez;
    pausadaAte = Date.parse(String(linha.d4sign_pausada_ate ?? "")) || 0;
  } else {
    const { data, error } = await sb.from("temis_espelho_d4sign").select("d4sign_pausada_ate").eq("id", 1).maybeSingle();
    if (error && semTabela(error)) relatorio.semA0195 = true;
    pausadaAte = Date.parse(String((data as null | { d4sign_pausada_ate?: string })?.d4sign_pausada_ate ?? "")) || 0;
  }

  // ⚠️ A VEZ É RENOVADA EM TODO LAÇO LONGO (passos 2, 3 e 4), E SÓ SE AINDA FOR DESTA RODADA. A carga
  // inicial (`--gravar`, orçamento infinito) faz uns 2,2 mil inserts e outras tantas chamadas da função
  // antes do `/list`: sem renovar, a vez de 5 min venceria no meio e outra rodada entraria junto (cota
  // da D4Sign em dobro). E sem o dono, a rodada que perdeu a vez estenderia (ou soltaria) a vez da outra.
  let ultimaRenovacao = agora();
  const renovarAVez = async (): Promise<void> => {
    if (!tomouAVez || perdeuAVez || !minhaVez || agora() - ultimaRenovacao < RENOVAR_A_VEZ_MS) return;
    ultimaRenovacao = agora();
    const nova = iso(agora() + VEZ_MS);
    const { data, error } = await sb
      .from("temis_espelho_d4sign")
      .update({ em_curso_ate: nova })
      .eq("id", 1)
      .eq("em_curso_ate", minhaVez)
      .select("id");
    if (error) {
      // Tropeço do banco não é perda da vez: a próxima renovação tenta de novo.
      falhar(`vez:${codigoDoErro(error)}`);
      return;
    }
    if (!Array.isArray(data) || data.length === 0) {
      // Outra rodada tomou a vez (a nossa venceu antes de ser renovada): esta para onde está.
      perdeuAVez = true;
      falhar("vez_perdida");
      return;
    }
    minhaVez = nova;
  };

  const sobra = () => opcoes.orcamentoMs - (agora() - inicio);
  const temTempo = () => !perdeuAVez && sobra() > FOLGA_MS;

  let pausada = pausadaAte > agora();
  if (pausada) relatorio.pausadoPorCota = true;
  const pausarPorCota = async () => {
    pausada = true;
    relatorio.pausadoPorCota = true;
    if (!gravar) return;
    const { error } = await sb
      .from("temis_espelho_d4sign")
      .update({ d4sign_pausada_ate: iso(agora() + PAUSA_POR_COTA_MS) })
      .eq("id", 1);
    if (error) falhar(`pausa:${codigoDoErro(error)}`);
  };

  let conexao: null | PoolConnection = null;
  // ⚠️ A CAMPAINHA (`ultima_rodada_ok_em`) SÓ TOCA COM OS PASSOS 1 A 3 INTEIROS (seção 6, passo 8):
  // cada passo diz se deu certo numa chave própria. O `d4signFora` não serve para isso: o passo 4
  // também o liga (disjuntor), e tropeço no `/list` não desfaz a conferência dos passos 1 a 3.
  let c2xOk = false;
  let lidoOk = true;
  let descobertaOk = false;
  let catalogoOk = false;
  let inesperada = false;
  const mudancas: MudancaDoEnvelope[] = [];
  const emJogo = new Map<string, EmJogo>();
  const nativas = new Map<string, VendaLigada>();

  try {
    // ── 1. DESCOBRE ───────────────────────────────────────────────────────
    let envios: EnvioDoC2x[] = [];
    try {
      conexao = await abrirLeituraDoC2x(pool);
      envios = await lerEnviosDoC2x(conexao);
      c2xOk = true;
    } catch (falha) {
      falhar(`c2x:${codigoDoErro(falha)}`);
      // ⚠️ A CONEXÃO QUE FALHOU VOLTA (destruída) ANTES DE SER ESQUECIDA: sem isto ela ficava fora do
      // pool para sempre, com a transação aberta no C2X, e cinco rodadas ruins travavam o pool do Hades.
      descartarLeituraDoC2x(conexao);
      conexao = null;
    }
    relatorio.enviosNoC2x = envios.length;
    for (const envio of envios) {
      somar(relatorio.tiposDoC2x, envio.contractType ?? "(nulo)");
      if (!envio.uuidDoc) relatorio.semUuid += 1;
      if (envio.statusC2x === 6) relatorio.status6 += 1;
    }
    if (so) envios = envios.filter((e) => so.includes(e.csId));
    const envioPorDoc = new Map<string, EnvioDoC2x>();
    for (const envio of envios) if (envio.uuidDoc) envioPorDoc.set(envio.uuidDoc, envio);

    const existentes = await lerPaginado<LinhaDoEspelho>(relatorio, "temis_envelopes", (de) =>
      sb
        .from("temis_envelopes")
        .select(COLUNAS_DO_ESPELHO)
        .eq("provedor", "d4sign")
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1),
    );
    if (!existentes.ok) {
      if (!gravar && semColuna(existentes.erro)) {
        relatorio.semA0195 = true;
      } else {
        lidoOk = false;
        falhar(`panteon:temis_envelopes:${codigoDoErro(existentes.erro)}`);
      }
    }
    const linhasExistentes = existentes.ok ? existentes.linhas : [];
    const existentePorDoc = new Map<string, LinhaDoEspelho>();
    for (const l of linhasExistentes) if (l.provedor_documento_id) existentePorDoc.set(l.provedor_documento_id, l);

    for (const linha of linhasExistentes) {
      const envio = linha.provedor_documento_id ? (envioPorDoc.get(linha.provedor_documento_id) ?? null) : null;
      if (so && !envio) continue;
      emJogo.set(linha.id, {
        envio,
        estado: linha.estado,
        finalizadoAdiado: false,
        jaListado: false,
        linha,
        nativa: null,
        nova: false,
        quadro: null,
        vendaEmCurso: false,
      });
    }

    // ── 2. O ENVIO NOVO (e a reavaliação do `sem_venda`) ──────────────────
    const novos = envios.filter((e) => e.uuidDoc && !existentePorDoc.has(e.uuidDoc));
    relatorio.novos = novos.length;
    // ⚠️ "REAVALIADO A CADA RODADA" (seção 3, regra 4): a linha do C2X que nasceu sem venda volta ao
    // casamento. Só a de `proposta_id` NULO: a ligada nunca é religada por aqui. Com teto, os envios mais
    // novos primeiro (a nativa tem de existir antes do envio, então o acervo antigo quase nunca muda).
    const reavaliar = [...emJogo.values()]
      .filter((j) => j.envio && !j.linha.proposta_id && j.linha.origem === "c2x")
      .sort((a, b) => (Date.parse(b.linha.criado_em) || 0) - (Date.parse(a.linha.criado_em) || 0))
      .slice(0, LIMITE_DA_REAVALIACAO);
    let passo2: ResultadoDaDescoberta = { c2xFalhou: false, completo: novos.length === 0 && reavaliar.length === 0 };
    if (conexao && lidoOk && (novos.length > 0 || reavaliar.length > 0) && temTempo()) {
      passo2 = await descobrirENascer({
        conexao,
        emJogo,
        falhar,
        gravar,
        nativas,
        novos,
        reavaliar,
        relatorio,
        renovarAVez,
        sb,
        temTempo,
      });
    }
    descobertaOk = passo2.completo;

    // ⚠️ O C2X FECHA AQUI, NÃO NO FIM DA RODADA: a transação só-leitura aberta durante os passos 3 a 7
    // (no script, dezenas de minutos de `/list` a cada 2 s) prendia uma conexão escassa e uma read view
    // do InnoDB. A releitura do rol no passo 4 abre uma leitura curta só para ela (`relerRol`).
    if (passo2.c2xFalhou) descartarLeituraDoC2x(conexao);
    else await fecharLeituraDoC2x(conexao);
    conexao = null;

    // As vendas ligadas às linhas que JÁ existiam: nativa? viva em curso? (o finalizado de nativa espera
    // o `/list`, e o recorte da carga lista a venda em curso). Estreito, em lotes de 100.
    const semSaberDaVenda = [...emJogo.values()].filter((j) => j.nativa === null && j.linha.proposta_id);
    if (semSaberDaVenda.length > 0) {
      const ids = semSaberDaVenda.map((j) => String(j.linha.proposta_id));
      const lidas = await lerEmLotes<VendaLigada>(relatorio, "hercules_propostas", ids, (lote) =>
        sb.from("hercules_propostas").select(COLUNAS_DA_VENDA_LIGADA).in("id", lote).order("id", { ascending: true }),
      );
      if (!lidas.ok) falhar(`panteon:hercules_propostas:${codigoDoErro(lidas.erro)}`);
      const porId = new Map((lidas.ok ? lidas.linhas : []).map((p) => [p.id, p]));
      for (const j of semSaberDaVenda) {
        const p = porId.get(String(j.linha.proposta_id));
        if (!p) continue;
        j.nativa = p.origem === "panteon";
        j.vendaEmCurso = !p.cancelada_em && ETAPAS_COM_CONTRATO_EM_CURSO.has(p.etapa);
        if (j.nativa) nativas.set(p.id, p);
      }
    }

    // ── 3. O ESTADO PELO CATÁLOGO ─────────────────────────────────────────
    // ⚠️ COM `so` O CATÁLOGO NÃO É LIDO: são 8 páginas para responder poucos documentos, e o `/list`
    // de cada um (passo 4) traz o mesmo status.
    let catalogo: null | Map<string, DocumentoD4Sign> = null;
    const podeChamarD4Sign = () => !pausada && !d4sign.disjuntorAberto();
    // ⚠️ OS PASSOS 3 E 4 RODAM COM O C2X E O ESPELHO LIDOS, mesmo que o passo 2 tenha tropeçado num envio
    // (um insert ruim não deixa o acervo inteiro sem conferência); só a campainha exige o passo 2 inteiro.
    if (!so && c2xOk && lidoOk && podeChamarD4Sign() && temTempo()) {
      const antes = agora();
      catalogo = await d4sign.catalogo();
      if (!catalogo) {
        relatorio.d4signFora = true;
        if (d4sign.cotaRecusadaDesde(antes)) await pausarPorCota();
        else falhar("d4sign:catalogo");
      } else if (d4sign.cotaRecusadaDesde(antes)) {
        // Uma página levou 429 no meio: o que veio vale (documento fora do catálogo não muda), mas o
        // catálogo está INCOMPLETO e a conta pediu pausa.
        await pausarPorCota();
      } else {
        catalogoOk = true;
      }
    } else if (!so && (pausada || d4sign.disjuntorAberto())) {
      relatorio.d4signFora = true;
    }

    if (catalogo) {
      for (const j of emJogo.values()) {
        await renovarAVez();
        if (!temTempo()) {
          // Orçamento no fim: o que faltou fica para a próxima rodada, e esta não diz "conferido agora".
          catalogoOk = false;
          break;
        }
        const doc = j.linha.provedor_documento_id ? catalogo.get(j.linha.provedor_documento_id) : undefined;
        somar(relatorio.estadosDoCatalogo, doc ? doc.situacao : "fora_do_catalogo");
        // ⚠️ DOCUMENTO QUE SUMIU DO CATÁLOGO NÃO MUDA (seção 6, passo 3): ausência não é cancelamento.
        if (!doc) continue;
        const proposto = propostoPeloStatus(doc, j.envio);
        if (!proposto) continue;
        // (`nativa !== false`: venda ligada que não se conseguiu ler conta como nativa, o lado seguro.)
        if (proposto.estado === "assinado" && j.linha.proposta_id && j.nativa !== false) {
          // ⚠️ O FINALIZADO DE VENDA NATIVA SÓ ENTRA COM O `/list` NA MESMA CHAMADA (B2 dos críticos): sem
          // a data da última assinatura, o prazo de 7 dias e a `data_assinatura` sairiam da hora do cron.
          if (j.estado !== "assinado") j.finalizadoAdiado = true;
          continue;
        }
        if (!avanca(j.estado, proposto.estado)) continue;
        const resultado = await aplicarEstado(j, {
          documento: j.linha.provedor_documento_id,
          estado: proposto.estado,
          estadoCru: proposto.cru,
        });
        // Falha de transporte da função (não a recusa de negócio de UMA linha) quebra o passo 3.
        if (resultado === "falhou") catalogoOk = false;
      }
    }

    // ── 4. POR PESSOA, PELO /list ─────────────────────────────────────────
    if (c2xOk && lidoOk && temTempo()) {
      const fila = filaDoList([...emJogo.values()], {
        agora: agora(),
        refazer: Boolean(opcoes.refazer),
        so: Boolean(so),
      }).slice(0, Math.max(0, opcoes.tetoDeListas));
      await carregarQuadros(fila);
      await percorrerALista(fila);
    }

    relatorio.restamEmMovimento = [...emJogo.values()].filter((j) => EM_MOVIMENTO.has(j.estado) && !j.jaListado).length;

    // ── 5. O EFEITO NA VENDA ──────────────────────────────────────────────
    for (const mudanca of mudancas) {
      const borda = ehBorda(mudanca);
      if (!borda) continue;
      const propostaId = mudanca.envelope.propostaId;
      if (!propostaId || !nativas.has(propostaId)) continue;
      const venda = nativas.get(propostaId);
      if (venda?.cancelamento_pedido_em) {
        relatorio.comCancelamentoAberto += 1;
        continue;
      }
      // ⚠️ `moverVendas = false` NÃO CHAMA A PORTA (plano, F3): conta o que faria, para a prova.
      if (!opcoes.moverVendas || !gravar) {
        relatorio.efeitosPlanejados += 1;
        continue;
      }
      if (!temTempo()) break;
      const efeito = await aplicarNaVenda(sb, mudanca, { moverVendas: true });
      if (efeito.card === "andou" || efeito.dataDeAssinatura === "gravada") relatorio.vendasMovidas += 1;
      if (efeito.card === "recusado" || efeito.dataDeAssinatura === "falhou") falhar(`venda:${propostaId}:${efeito.card}`);
    }

    // ── 6. A RECONCILIAÇÃO ────────────────────────────────────────────────
    if (!relatorio.semA0195 && temTempo()) {
      const r = await reconciliar(sb, { gravar, limite: LIMITE_DA_RECONCILIACAO, moverVendas: opcoes.moverVendas });
      relatorio.reconciliadas = gravar ? r.refeitas : r.planejadas;
      if (r.puladas.leitura_falhou || r.puladas.falha_inesperada) falhar("reconciliacao");
    }

    // ── 7. A REDE DA CLICKSIGN ────────────────────────────────────────────
    if (!relatorio.semA0195 && temTempo()) await redeDaClicksign();

    // Dois contratos vivos para a mesma venda (só ids no relatório; o aviso da tela é da F4/F5).
    // ⚠️ O ENSAIO CONTA MESMO SEM A 0195: é antes do `--gravar` que o Zeus precisa ver este número.
    if ((!relatorio.semA0195 || !gravar) && temTempo()) await contarDoisContratosVivos();
  } catch (falha) {
    inesperada = true;
    falhar(`inesperada:${falha instanceof Error ? falha.name : "erro"}`);
  } finally {
    // Só sobra conexão aqui se a rodada caiu entre o passo 1 e o fechamento do passo 2.
    await fecharLeituraDoC2x(conexao);
  }

  const rodadaBoa = !so && !inesperada && !perdeuAVez && passosAnterioresOk() && catalogoOk;
  return fechar(relatorio, rodadaBoa);

  // ── as peças da rodada (fecham sobre o estado dela) ──────────────────────

  /** Os passos 1 e 2 deram certo por inteiro? (C2X lido, espelho lido, envio novo e reavaliação sem erro.) */
  function passosAnterioresOk(): boolean {
    return c2xOk && lidoOk && descobertaOk;
  }

  async function fechar(r: RelatorioDoEspelho, rodadaBoa = false): Promise<RelatorioDoEspelho> {
    r.duracaoMs = agora() - inicio;
    // ⚠️ O LOG SÓ LEVA CONTAGENS E IDS (o relatório inteiro é isso por construção).
    console.info("[assinatura][espelho-d4sign] rodada", {
      casamentos: r.casamentos,
      duracaoMs: r.duracaoMs,
      estadosMudaram: r.estadosMudaram,
      falhas: r.falhas.slice(0, 20),
      gravou: r.gravou,
      inseridos: r.inseridos,
      listas: r.listas,
      pausadoPorCota: r.pausadoPorCota,
      semA0195: r.semA0195,
      vendasMovidas: r.vendasMovidas,
    });
    if (tomouAVez && minhaVez) {
      const patch: Record<string, unknown> = { atualizado_em: iso(agora()), em_curso_ate: null, relatorio: r };
      // ⚠️ A CAMPAINHA SÓ TOCA COM OS PASSOS 1 A 3 INTEIROS (seção 6, passo 8; seção 5, `avisoDaFonte`):
      // rodada parcial (`so`, C2X ou Panteon fora, catálogo fora, cota antes do passo 4, orçamento no
      // meio, falha inesperada, vez perdida) não diz "conferido agora". Tropeço no passo 4 não desfaz.
      if (rodadaBoa) patch.ultima_rodada_ok_em = iso(agora());
      // ⚠️ SÓ FECHA A VEZ SE ELA AINDA FOR DESTA RODADA: soltar a vez de outra deixaria uma terceira entrar.
      const { data, error } = await sb
        .from("temis_espelho_d4sign")
        .update(patch)
        .eq("id", 1)
        .eq("em_curso_ate", minhaVez)
        .select("id");
      if (error) console.error("[assinatura][espelho-d4sign] falha ao fechar a vez", { code: error.code ?? null });
      else if (!Array.isArray(data) || data.length === 0) {
        console.error("[assinatura][espelho-d4sign] a vez já era de outra rodada; esta não a fechou");
      }
    }
    return r;
  }

  async function aplicarEstado(j: EmJogo, dados: EntradaDoRegistro): Promise<"falhou" | "feito" | "recusado"> {
    const antes = j.estado;
    if (!gravar || j.linha.id.startsWith("ensaio:")) {
      // O ENSAIO SIMULA: o estado anda na memória para os passos seguintes contarem certo.
      const proposto = dados.estado ?? null;
      let depois = avanca(antes, proposto) ? proposto : antes;
      const comMarca = (dados.marcas ?? []).some((m) => m.assinadoEm);
      if (comMarca && (depois === "aguardando" || depois === "desconhecido" || depois === "rascunho")) depois = "parcial";
      if (depois !== antes) {
        relatorio.estadosMudaram += 1;
        j.estado = depois;
        mudancas.push(mudancaDe(j, antes, depois, dados.fechadoEm ?? null, j.quadro ?? []));
      }
      return "feito";
    }
    const chamada = await registrar(sb, j.linha.id, dados);
    if (chamada.tipo !== "feito") {
      falhar(`registro:${j.linha.id}:${chamada.tipo}`);
      return "falhou";
    }
    const { registro } = chamada;
    if (registro.recusa) {
      falhar(`registro:${j.linha.id}:${registro.recusa}`);
      return "recusado";
    }
    j.estado = registro.estadoDepois;
    j.quadro = registro.signatarios;
    if (registro.mudouEstado) {
      relatorio.estadosMudaram += 1;
      mudancas.push(mudancaDe(j, antes, registro.estadoDepois, registro.fechadoEm, registro.signatarios));
    }
    return "feito";
  }

  function mudancaDe(
    j: EmJogo,
    antes: EstadoDaAssinatura,
    depois: EstadoDaAssinatura,
    fechadoEm: null | string,
    signatarios: ItemDoQuadro[],
  ): MudancaDoEnvelope {
    return {
      envelope: {
        fechadoEm,
        finalidade: j.linha.finalidade,
        id: j.linha.id,
        origem: "c2x",
        propostaId: j.linha.proposta_id,
        provedor: "d4sign",
        signatarios,
        trabalhoId: j.linha.trabalho_id,
      },
      // ⚠️ A LINHA QUE NASCEU NESTA RODADA ENTRA COMO `novo`: é a borda de entrada em assinatura.
      estadoAntes: j.nova && (antes === "desconhecido" || antes === "rascunho") ? "novo" : antes,
      estadoDepois: depois,
    };
  }

  async function carregarQuadros(fila: EmJogo[]): Promise<void> {
    const faltam = fila.filter((j) => j.quadro === null && !j.linha.id.startsWith("ensaio:")).map((j) => j.linha.id);
    if (faltam.length === 0) return;
    const lidas = await lerEmLotes<{ id: string; signatarios: unknown }>(relatorio, "temis_envelopes:quadro", faltam, (lote) =>
      sb.from("temis_envelopes").select("id, signatarios").in("id", lote).order("id", { ascending: true }),
    );
    if (!lidas.ok) {
      falhar(`panteon:quadro:${codigoDoErro(lidas.erro)}`);
      return;
    }
    const porId = new Map(lidas.linhas.map((l) => [l.id, lerQuadro(l.signatarios)]));
    for (const j of fila) if (j.quadro === null) j.quadro = porId.get(j.linha.id) ?? [];
  }

  async function percorrerALista(fila: EmJogo[]): Promise<void> {
    let proximo = 0;
    let parar = false;
    const trabalhador = async (): Promise<void> => {
      for (;;) {
        if (parar) return;
        const j = fila[proximo];
        proximo += 1;
        if (!j) return;
        await renovarAVez();
        if (!temTempo() || pausada) {
          parar = true;
          return;
        }
        if (d4sign.disjuntorAberto()) {
          // ⚠️ DISJUNTOR ABERTO INTERROMPE O PASSO (seção 6): colecionar "indisponível" não ajuda ninguém.
          relatorio.d4signFora = true;
          parar = true;
          return;
        }
        await listarUm(j);
        if (pausada) {
          parar = true;
          return;
        }
        if (opcoes.intervaloMs > 0) await dormir(opcoes.intervaloMs);
      }
    };
    const n = Math.max(1, Math.min(opcoes.concorrencia, fila.length));
    await Promise.all(Array.from({ length: n }, () => trabalhador()));
  }

  /** O rol de UM envio, numa leitura curta e própria do C2X (a da descoberta já foi fechada). */
  async function relerRol(csId: number): Promise<PessoaDoC2x[]> {
    let curta: null | PoolConnection = null;
    try {
      curta = await abrirLeituraDoC2x(pool);
      const pessoas = (await lerPessoasDosEnvios(curta, [csId])).get(csId) ?? [];
      await fecharLeituraDoC2x(curta);
      curta = null;
      return pessoas;
    } catch (falha) {
      descartarLeituraDoC2x(curta);
      throw falha;
    }
  }

  async function listarUm(j: EmJogo): Promise<void> {
    const uuid = j.linha.provedor_documento_id;
    if (!uuid) return;
    j.jaListado = true;
    // ⚠️ `tentado_em` EM TODA TENTATIVA, ANTES DA CHAMADA (I16): o documento que sempre falha não trava o
    // rodízio no topo da fila.
    if (gravar && !j.linha.id.startsWith("ensaio:")) {
      const { error } = await sb.from("temis_envelopes").update({ tentado_em: iso(agora()) }).eq("id", j.linha.id);
      if (error) falhar(`tentado:${j.linha.id}:${codigoDoErro(error)}`);
    }
    relatorio.listas += 1;
    const consulta = await d4sign.lista(uuid);
    if (!consulta.ok) {
      if (consulta.motivo === "cota") {
        await pausarPorCota();
        return;
      }
      // ⚠️ O FINALIZADO DE NATIVA CUJO `/list` FALHOU NÃO MUDA NESTA RODADA (fica no topo da próxima).
      falhar(`list:${j.linha.id}:${consulta.motivo}`);
      return;
    }
    const sigs: readonly SignatarioD4Sign[] = consulta.signatarios ?? [];
    let quadro = j.quadro ?? [];
    let pares = marcasDaD4Sign(quadro, sigs);
    let quadroNovo: ItemDoQuadro[] | null = null;
    // ⚠️ ROL DIFERENTE → RELÊ O ROL NO C2X (I11): alguém foi trocado no envio. O quadro novo vai à função
    // pela chave (`p_quadro`), e quem continua nele leva as marcas que já tinha.
    if (pares.rolDiferente && j.envio && c2xOk) {
      try {
        const relido = quadroDoEnvioDoC2x(await relerRol(j.envio.csId));
        const chaves = (q: readonly ItemDoQuadro[]) => q.map((i) => i.chave).join("|");
        if (relido.length > 0 && chaves(relido) !== chaves(quadro)) {
          quadroNovo = relido;
          quadro = relido;
          pares = marcasDaD4Sign(quadro, sigs);
        }
      } catch (falha) {
        falhar(`c2x:rol:${j.linha.id}:${codigoDoErro(falha)}`);
      }
    }
    relatorio.naoPareados += pares.naoPareados;
    j.quadro = quadro;

    const proposto = propostoPeloStatus(consulta.documento, j.envio);
    let estado = proposto?.estado ?? null;
    let estadoCru = proposto?.cru ?? null;
    // ⚠️ SÓ DATA REAL: a última assinatura que a D4Sign devolveu (nunca a hora do cron).
    let fechadoEm = estado === "assinado" ? fechamentoDaD4Sign(sigs) : null;
    if (estado === "assinado" && j.linha.proposta_id && j.nativa !== false) {
      // ⚠️ O FINALIZADO DE VENDA NATIVA SEM A DATA DE TODOS NÃO VIRA ASSINADO (seção 6, passo 3; a prova
      // exige "assinado ligado a nativa sem data real: 0"). Assinado é terminal e sem `fechado_em` ninguém
      // mais o listaria; com uma data faltando, o fechamento sairia cedo e encurtaria o prazo de 7 dias.
      // Vão só as marcas e a conferência; o catálogo o adia de novo na próxima rodada.
      const completo = fechamentoCompletoDaD4Sign(sigs);
      if (!completo) {
        relatorio.semDataReal += 1;
        estado = null;
        estadoCru = null;
        fechadoEm = null;
      } else {
        fechadoEm = completo;
      }
    }
    await aplicarEstado(j, {
      conferidoEm: iso(agora()),
      documento: uuid,
      estado,
      estadoCru,
      fechadoEm,
      marcas: pares.marcas,
      quadro: quadroNovo,
    });
  }

  async function redeDaClicksign(): Promise<void> {
    // ⚠️ A REDE DO FECHAMENTO QUE NÃO CHEGOU (risco 1 e 8.7): envelope da Clicksign `parcial` com TODOS os
    // itens assinados e parado há mais de 30 min. Barata e rara; conferida no GET do envelope.
    const limite = agora() - 30 * 60 * 1000;
    const { data, error } = await sb
      .from("temis_envelopes")
      .select("id, envelope_id, proposta_id, finalidade, trabalho_id, signatarios, atualizado_em")
      .eq("provedor", "clicksign")
      .eq("estado", "parcial")
      .order("id", { ascending: true })
      .limit(PAGINA);
    if (error) {
      falhar(`panteon:rede:${codigoDoErro(error)}`);
      return;
    }
    type LinhaDaRede = {
      atualizado_em: null | string;
      envelope_id: null | string;
      finalidade: FinalidadeDoEnvelope | null;
      id: string;
      proposta_id: null | string;
      signatarios: unknown;
      trabalho_id: null | string;
    };
    const candidatos = ((data ?? []) as LinhaDaRede[]).filter((l) => {
      const quadro = lerQuadro(l.signatarios);
      const parado = Date.parse(String(l.atualizado_em ?? ""));
      return (
        Boolean(l.envelope_id) &&
        quadro.length > 0 &&
        quadro.every((i) => Boolean(i.assinado_em)) &&
        // (Pelo instante, não pelo texto: o banco devolve `+00:00` e o limite sairia `.000Z`.)
        !Number.isNaN(parado) &&
        parado < limite
      );
    });
    for (const l of candidatos.slice(0, LIMITE_DA_REDE_DA_CLICKSIGN)) {
      if (!gravar) {
        relatorio.redeDaClicksign += 1;
        continue;
      }
      if (!temTempo()) return;
      const lido = await clicksign(String(l.envelope_id));
      if (!lido.ok) {
        falhar(`rede:${l.id}:clicksign`);
        continue;
      }
      // ⚠️ SÓ `closed` FECHA: o GET é a fonte, e qualquer outro status deixa o envelope como está.
      if (lido.status !== "closed") continue;
      const chamada = await registrar(sb, l.id, {
        conferidoEm: iso(agora()),
        estado: "assinado",
        estadoCru: "clicksign:closed",
      });
      if (chamada.tipo !== "feito" || chamada.registro.recusa) {
        falhar(`rede:${l.id}`);
        continue;
      }
      relatorio.redeDaClicksign += 1;
      if (chamada.registro.mudouEstado && chamada.registro.estadoDepois === "assinado") {
        // ⚠️ A CLICKSIGN MOVE A VENDA SEMPRE QUE SE GRAVA, COM OU SEM `moverVendas` (decisão da F2, na
        // reconciliação: `OpcoesDaReconciliacao.gravar`, envelope-na-venda.ts). `moverVendas` é a chave
        // do contrato que o C2X mandou para a D4Sign; o envelope da Clicksign foi mandado pela Têmis, e o
        // webhook dele move a venda sempre (estado-db.ts, `moverVendas: true`). Esta rede é o webhook que
        // não chegou: com `--gravar` sem `--mover-vendas` ela move a venda da CLICKSIGN, nunca a da D4Sign.
        const efeito = await aplicarNaVenda(
          sb,
          {
            envelope: {
              fechadoEm: chamada.registro.fechadoEm,
              finalidade: l.finalidade,
              id: l.id,
              origem: "panteon",
              propostaId: l.proposta_id,
              provedor: "clicksign",
              signatarios: chamada.registro.signatarios,
              trabalhoId: l.trabalho_id,
            },
            estadoAntes: chamada.registro.estadoAntes,
            estadoDepois: "assinado",
          },
          { moverVendas: true },
        );
        if (efeito.card === "andou" || efeito.dataDeAssinatura === "gravada") relatorio.vendasMovidas += 1;
        if (efeito.card === "recusado" || efeito.dataDeAssinatura === "falhou") {
          falhar(`venda:${String(l.proposta_id)}:${efeito.card}`);
        }
      }
    }
  }

  async function contarDoisContratosVivos(): Promise<void> {
    type LinhaViva = {
      criado_em: string;
      enviado_em: null | string;
      envelope_id: null | string;
      estado: string;
      falha: null | string;
      id: string;
      proposta_id: null | string;
      provedor: string;
    };
    const VIVOS = ["rascunho", "desconhecido", "aguardando", "parcial", "assinado"];
    const ler = (comFinalidade: boolean) =>
      lerPaginado<LinhaViva>(relatorio, "temis_envelopes:vivos", (de) => {
        let q = sb
          .from("temis_envelopes")
          .select("id, proposta_id, provedor, estado, falha, envelope_id, enviado_em, criado_em")
          .in("estado", VIVOS)
          .not("proposta_id", "is", null);
        if (comFinalidade) q = q.eq("finalidade", "contrato");
        return q.order("id", { ascending: true }).range(de, de + PAGINA - 1);
      });
    let lidas = await ler(true);
    if (!lidas.ok && !gravar && semColuna(lidas.erro)) {
      // ⚠️ ENSAIO SEM A 0195: a coluna `finalidade` ainda não existe. Todo envelope que está lá é da
      // Clicksign mandado pela Têmis, e conta como contrato (aproximação só do ensaio).
      lidas = await ler(false);
    }
    if (!lidas.ok) {
      falhar(`panteon:vivos:${codigoDoErro(lidas.erro)}`);
      return;
    }
    const porId = new Map<string, LinhaViva>(lidas.linhas.map((l) => [l.id, l]));
    if (!gravar) {
      // ⚠️ O ENSAIO SOMA O QUE SIMULOU (o plano: o ensaio imprime "dois contratos vivos"): as linhas que
      // nasceriam (`ensaio:<cs>`) e o estado que as existentes teriam depois da rodada. Sem isto, o
      // ensaio antes do `--gravar` mostraria 0 para os dois contratos vivos que a gravação vai criar.
      for (const j of emJogo.values()) {
        if (!j.linha.proposta_id || j.linha.finalidade !== "contrato") continue;
        const existente = porId.get(j.linha.id);
        if (!VIVOS.includes(j.estado)) {
          porId.delete(j.linha.id);
          continue;
        }
        porId.set(j.linha.id, {
          criado_em: j.linha.criado_em,
          enviado_em: existente?.enviado_em ?? j.envio?.criadoEm ?? j.linha.criado_em,
          envelope_id: existente?.envelope_id ?? j.linha.provedor_documento_id,
          estado: j.estado,
          falha: existente?.falha ?? null,
          id: j.linha.id,
          proposta_id: j.linha.proposta_id,
          provedor: "d4sign",
        });
      }
    }
    const porProposta = new Map<string, LinhaViva[]>();
    for (const l of porId.values()) {
      if (!l.proposta_id) continue;
      porProposta.set(l.proposta_id, [...(porProposta.get(l.proposta_id) ?? []), l]);
    }
    for (const linhas of porProposta.values()) {
      if (envelopeVigente(linhas).doisContratosVivos) relatorio.doisContratosVivos += 1;
    }
  }
}

/** O estado que o status (C2X + D4Sign) propõe. Status 6 do C2X cancela, salvo finalizado na D4Sign. */
function propostoPeloStatus(
  documento: DocumentoD4Sign,
  envio: EnvioDoC2x | null,
): null | { cru: string; estado: EstadoDaAssinatura } {
  if (documento.situacao === "finalizado") return { cru: crueDaD4Sign(documento), estado: "assinado" };
  // ⚠️ STATUS 6 DO C2X → `cancelado` (I10), mas SÓ com a D4Sign respondida: sem ela não se sabe se o
  // documento foi finalizado, e cancelado é terminal (um assinado nunca mais apareceria).
  if (envio?.statusC2x === 6) return { cru: "c2x:6", estado: "cancelado" };
  const estado = estadoDaSituacao(documento.situacao);
  return estado ? { cru: crueDaD4Sign(documento), estado } : null;
}

/** A mudança é borda que move venda? (a porta confere de novo; isto só evita chamada e conta o ensaio). */
function ehBorda(mudanca: MudancaDoEnvelope): boolean {
  if (mudanca.envelope.finalidade !== "contrato" || !mudanca.envelope.propostaId) return false;
  if (mudanca.estadoDepois === "assinado") return true;
  return ANTES_DE_ENTRAR.has(mudanca.estadoAntes) && EM_ASSINATURA.has(mudanca.estadoDepois);
}

/**
 * A fila do `/list`, na ordem da seção 6 (passo 4):
 *   1. o finalizado de venda nativa (espera o `/list` para ter a data real);
 *   2. os em movimento, por `tentado_em` asc com nulos antes, com recuo por idade (sem mudança há mais de
 *      30 dias: 1 vez por dia; há mais de 180: 1 vez por semana);
 *   3. o recorte da carga inicial: assinado sem `conferido_em` de venda viva em curso ou dos últimos 120
 *      dias (o resto do acervo antigo entra "assinado sem data", já previsto);
 *   4. com `refazer` (só script), os assinados que já têm `conferido_em`.
 * Com `so`, todos os do recorte (o catálogo não foi lido; o `/list` é a fonte do status).
 */
export function filaDoList(
  linhas: readonly EmJogo[],
  contexto: { agora: number; refazer: boolean; so: boolean },
): EmJogo[] {
  if (contexto.so) return [...linhas];
  const tentado = (j: EmJogo) => (j.linha.tentado_em ? Date.parse(j.linha.tentado_em) : Number.NEGATIVE_INFINITY);
  const idade = (j: EmJogo) => contexto.agora - (Date.parse(String(j.linha.atualizado_em ?? j.linha.criado_em)) || 0);
  const desde = (j: EmJogo) => contexto.agora - tentado(j);

  const adiados = linhas.filter((j) => j.finalizadoAdiado);
  const emMovimento = linhas
    .filter((j) => !j.finalizadoAdiado && EM_MOVIMENTO.has(j.estado))
    .filter((j) => {
      if (idade(j) > 180 * DIA_MS) return desde(j) >= 7 * DIA_MS;
      if (idade(j) > 30 * DIA_MS) return desde(j) >= DIA_MS;
      return true;
    })
    .sort((a, b) => tentado(a) - tentado(b) || a.linha.id.localeCompare(b.linha.id));
  const recorte = linhas
    .filter(
      (j) =>
        !j.finalizadoAdiado &&
        j.estado === "assinado" &&
        !j.linha.conferido_em &&
        (j.vendaEmCurso || contexto.agora - (Date.parse(j.linha.criado_em) || 0) <= JANELA_DO_LIST_MS),
    )
    .sort((a, b) => (Date.parse(b.linha.criado_em) || 0) - (Date.parse(a.linha.criado_em) || 0));
  const refeitos = contexto.refazer
    ? linhas.filter((j) => !j.finalizadoAdiado && j.estado === "assinado" && Boolean(j.linha.conferido_em))
    : [];
  return [...adiados, ...emMovimento, ...recorte, ...refeitos];
}

type Leitura<L> = { erro: ErroDoBanco; ok: false } | { linhas: L[]; ok: true };

/** Página a página, com ordem (sem ordem a paginação perde linha e o total ainda bate). */
async function lerPaginado<L>(
  relatorio: RelatorioDoEspelho,
  rotulo: string,
  pagina: (de: number) => PromiseLike<{ data: unknown; error: ErroDoBanco }>,
): Promise<Leitura<L>> {
  const linhas: L[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de);
    if (error) return { erro: error, ok: false };
    const lote = (Array.isArray(data) ? data : []) as L[];
    linhas.push(...lote);
    if (lote.length < PAGINA) break;
  }
  somar(relatorio.lidosPorTabela, rotulo, linhas.length);
  return { linhas, ok: true };
}

/** `.in()` em lotes de 100 (a URL do PostgREST estoura: 700 ids deram 400 na casa). */
async function lerEmLotes<L>(
  relatorio: RelatorioDoEspelho,
  rotulo: string,
  valores: readonly (number | string)[],
  consulta: (lote: Array<number | string>) => {
    range(de: number, ate: number): PromiseLike<{ data: unknown; error: ErroDoBanco }>;
  },
): Promise<Leitura<L>> {
  const linhas: L[] = [];
  for (const lote of emLotes(valores)) {
    // Cem valores podem dar mais de 1.000 linhas (propostas de um terreno grande): paginado também.
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await consulta(lote).range(de, de + PAGINA - 1);
      if (error) return { erro: error, ok: false };
      const pagina = (Array.isArray(data) ? data : []) as L[];
      linhas.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
  }
  somar(relatorio.lidosPorTabela, rotulo, linhas.length);
  return { linhas, ok: true };
}

/** O que o passo 2 devolve para a rodada decidir a campainha e o destino da conexão do C2X. */
type ResultadoDaDescoberta = {
  /** Uma consulta ao C2X falhou (timeout, erro de SQL): a conexão é descartada, não devolvida ao pool. */
  c2xFalhou: boolean;
  /** Leituras, consultas e inserts sem erro (fora o 23505) e sem corte de orçamento. */
  completo: boolean;
};

/**
 * O passo 2: unidade, terreno, casamento, rol, finalidade e a inserção por linha; e a reavaliação das
 * linhas que nasceram `sem_venda` (seção 3, regra 4).
 *
 * ⚠️ AS UNIDADES VÊM INTEIRAS (estreitas, paginadas com ordem), E SÓ QUANDO HÁ ENVIO NOVO OU LINHA A
 * REAVALIAR. O terreno precisa da família (pai, filho e glebas irmãs da mesma quadra e lote), e montá-la
 * aos pedaços por `origem_c2x_id` seria reescrever a leitura em camadas da régua; a tabela tem ~5,5 mil
 * linhas (6 páginas). As PROPOSTAS vêm só das unidades que interessam, em lotes de 100.
 */
async function descobrirENascer(ctx: {
  conexao: PoolConnection;
  emJogo: Map<string, EmJogo>;
  falhar: (codigo: string) => void;
  gravar: boolean;
  nativas: Map<string, VendaLigada>;
  novos: EnvioDoC2x[];
  reavaliar: EmJogo[];
  relatorio: RelatorioDoEspelho;
  renovarAVez: () => Promise<void>;
  sb: SupabaseClient;
  temTempo: () => boolean;
}): Promise<ResultadoDaDescoberta> {
  const { conexao, emJogo, falhar, gravar, nativas, novos, reavaliar, relatorio, renovarAVez, sb, temTempo } = ctx;
  const falhou = (c2xFalhou = false): ResultadoDaDescoberta => ({ c2xFalhou, completo: false });

  const unidades = await lerPaginado<LinhaDaUnidade>(relatorio, "hercules_unidades", (de) =>
    sb
      .from("hercules_unidades")
      .select("id, codigo, quadra, lote, enterprise_id, espelho_de, origem_c2x_id")
      .eq("workspace_id", WORKSPACE)
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1),
  );
  if (!unidades.ok) {
    falhar(`panteon:hercules_unidades:${codigoDoErro(unidades.erro)}`);
    return falhou();
  }
  const porOrigem = new Map<string, LinhaDaUnidade>();
  const porId = new Map<string, LinhaDaUnidade>();
  for (const u of unidades.linhas) {
    porId.set(u.id, u);
    if (u.origem_c2x_id !== null && u.origem_c2x_id !== undefined) porOrigem.set(String(u.origem_c2x_id), u);
  }
  const grupoDe = terrenosDasUnidades(unidades.linhas);
  const membros = new Map<string, string[]>();
  for (const [id, grupo] of grupoDe) membros.set(grupo, [...(membros.get(grupo) ?? []), id]);
  const doTerreno = (unidadeId: string): string[] => membros.get(grupoDe.get(unidadeId) ?? "") ?? [unidadeId];

  // Os envios novos que têm unidade no Panteon (os outros não entram: `semUnidade`), e as linhas a
  // reavaliar pela unidade que já gravaram.
  type Alvo = { envio: EnvioDoC2x; existente: EmJogo | null; unidade: LinhaDaUnidade };
  const alvos: Alvo[] = [];
  for (const envio of novos) {
    const unidade = porOrigem.get(String(envio.unidadeC2xId));
    if (!unidade) {
      relatorio.semUnidade += 1;
      somar(relatorio.casamentos, "sem_unidade");
      continue;
    }
    alvos.push({ envio, existente: null, unidade });
  }
  for (const j of reavaliar) {
    const unidade = (j.linha.unidade_id ? porId.get(j.linha.unidade_id) : undefined) ?? porOrigem.get(String(j.envio?.unidadeC2xId));
    if (j.envio && unidade) alvos.push({ envio: j.envio, existente: j, unidade });
  }
  if (alvos.length === 0) return { c2xFalhou: false, completo: true };

  // As propostas: as do pedido (regra 1) e as do terreno (regras 2 e 3).
  const doAr = await lerEmLotes<LinhaDaProposta>(
    relatorio,
    "hercules_propostas:do_pedido",
    alvos.map((c) => c.envio.arId),
    (lote) =>
      sb
        .from("hercules_propostas")
        .select(COLUNAS_DA_PROPOSTA)
        .eq("workspace_id", WORKSPACE)
        .in("origem_c2x_id", lote)
        .order("id", { ascending: true }),
  );
  const unidadesDosTerrenos = [...new Set(alvos.flatMap((c) => doTerreno(c.unidade.id)))];
  const doTerrenoLidas = await lerEmLotes<LinhaDaProposta>(relatorio, "hercules_propostas:do_terreno", unidadesDosTerrenos, (lote) =>
    sb
      .from("hercules_propostas")
      .select(COLUNAS_DA_PROPOSTA)
      .eq("workspace_id", WORKSPACE)
      .in("unidade_id", lote)
      .order("id", { ascending: true }),
  );
  if (!doAr.ok || !doTerrenoLidas.ok) {
    falhar(`panteon:hercules_propostas:${codigoDoErro(!doAr.ok ? doAr.erro : !doTerrenoLidas.ok ? doTerrenoLidas.erro : null)}`);
    return falhou();
  }

  const candidata = (p: LinhaDaProposta): PropostaCandidata => {
    const unidade = p.unidade_id ? porId.get(p.unidade_id) : undefined;
    const origem = p.origem === "panteon" ? "panteon" : "c2x";
    return {
      canceladaEm: p.cancelada_em,
      criadoEm: String(origem === "c2x" ? (p.criado_em_c2x ?? p.criado_em) : p.criado_em),
      // ⚠️ SÓ DÍGITOS, EM MEMÓRIA: comparado com o do C2X e descartado com a rodada.
      documentoDoComprador: String(p.cliente_documento ?? "").replace(/\D/g, ""),
      etapa: String(p.etapa ?? ""),
      id: p.id,
      noPai: Boolean(unidade?.espelho_de) && origem === "c2x",
      origem,
      origemC2xId: p.origem_c2x_id === null || p.origem_c2x_id === undefined ? null : Number(p.origem_c2x_id),
      unidadeId: String(p.unidade_id ?? ""),
    };
  };
  const propostaPorId = new Map<string, LinhaDaProposta>();
  for (const p of [...doAr.linhas, ...doTerrenoLidas.linhas]) propostaPorId.set(p.id, p);
  const doArPorAr = new Map<number, LinhaDaProposta>();
  for (const p of doAr.linhas) {
    const ar = Number(p.origem_c2x_id);
    const atual = doArPorAr.get(ar);
    // Mais de uma proposta do mesmo pedido (a sombra do pai e a do filho): a do filho vence, a regra 2
    // reavalia a do pai. Estável pelo id.
    if (!atual || (porId.get(String(atual.unidade_id))?.espelho_de && !porId.get(String(p.unidade_id))?.espelho_de)) {
      doArPorAr.set(ar, p);
    }
  }
  const propostasPorUnidade = new Map<string, LinhaDaProposta[]>();
  for (const p of doTerrenoLidas.linhas) {
    const u = String(p.unidade_id ?? "");
    propostasPorUnidade.set(u, [...(propostasPorUnidade.get(u) ?? []), p]);
  }

  const contextos = alvos.map((alvo) => {
    const pedido = doArPorAr.get(alvo.envio.arId);
    const doTerrenoDoEnvio = doTerreno(alvo.unidade.id).flatMap((u) => propostasPorUnidade.get(u) ?? []);
    return {
      ...alvo,
      contexto: {
        propostaDoAr: pedido ? candidata(pedido) : null,
        propostasDoTerreno: doTerrenoDoEnvio.map(candidata),
        unidade: { espelhoDe: alvo.unidade.espelho_de, id: alvo.unidade.id },
      },
    };
  });

  // A consulta 3, SÓ para os candidatos às regras 2 e 3.
  // ⚠️ SE ELA FALHAR, QUEM PRECISAVA DELA NÃO É CASADO NESTA RODADA (nem inserido, nem religado): com o
  // documento nulo a regra 2 cairia na regra 1 (a sombra do pai) e a 3 em `sem_venda`, e a linha ligada
  // nunca é religada. O envio continua "novo" e a próxima rodada tenta de novo; os outros seguem.
  const precisam = new Set(contextos.filter((c) => precisaDoComprador(c.contexto)).map((c) => c.envio.arId));
  let compradores = new Map<number, string>();
  let semComprador = new Set<number>();
  let c2xFalhou = false;
  if (precisam.size > 0) {
    try {
      compradores = await documentosDosCompradores(conexao, [...precisam]);
    } catch (falha) {
      falhar(`c2x:compradores:${codigoDoErro(falha)}`);
      semComprador = precisam;
      c2xFalhou = true;
    }
  }
  let completo = !c2xFalhou;
  const casaveis = contextos.filter((c) => !semComprador.has(c.envio.arId));

  const casar = (c: (typeof contextos)[number]): CasamentoDoEnvio =>
    casarEnvioComAVenda(c.envio, { ...c.contexto, documentoDoCompradorNoC2x: compradores.get(c.envio.arId) ?? null });

  const anotarNativa = (envio: EnvioDoC2x, casamento: CasamentoDoEnvio, propostaLigada: LinhaDaProposta | undefined) => {
    if (!propostaLigada || propostaLigada.origem !== "panteon") return;
    nativas.set(propostaLigada.id, propostaLigada);
    if (relatorio.ligacoesComNativa.length < TETO_DA_LISTA_NO_RELATORIO) {
      relatorio.ligacoesComNativa.push({ csId: envio.csId, propostaId: propostaLigada.id, regra: casamento.regra });
    }
  };

  // ── A reavaliação do `sem_venda` (não precisa do rol) ──
  for (const c of casaveis) {
    const j = c.existente;
    if (!j) continue;
    await renovarAVez();
    if (!temTempo()) {
      completo = false;
      break;
    }
    const casamento = casar(c);
    if (!casamento.propostaId) continue;
    const propostaLigada = propostaPorId.get(casamento.propostaId);
    if (gravar && !j.linha.id.startsWith("ensaio:")) {
      // ⚠️ `.is('proposta_id', null)`: a linha que outra rodada (ou uma correção assistida) já ligou não é
      // religada por cima.
      const { data, error } = await sb
        .from("temis_envelopes")
        .update({ proposta_id: casamento.propostaId })
        .eq("id", j.linha.id)
        .is("proposta_id", null)
        .select("id");
      if (error) {
        falhar(`religar:${j.linha.id}:${codigoDoErro(error)}`);
        completo = false;
        continue;
      }
      if (!Array.isArray(data) || data.length === 0) continue;
    }
    // O efeito na venda desta ligação (entrada em "Em assinatura" ou a conclusão) fica com a
    // reconciliação, que olha o vigente da venda em toda rodada (seção 7).
    j.linha.proposta_id = casamento.propostaId;
    j.nativa = propostaLigada ? propostaLigada.origem === "panteon" : false;
    j.vendaEmCurso = Boolean(
      propostaLigada && !propostaLigada.cancelada_em && ETAPAS_COM_CONTRATO_EM_CURSO.has(propostaLigada.etapa),
    );
    relatorio.religadas += 1;
    anotarNativa(c.envio, casamento, propostaLigada);
  }

  const aNascer = casaveis.filter((c) => !c.existente);
  if (aNascer.length === 0) return { c2xFalhou, completo };

  // O rol dos envios que vão nascer.
  let pessoas = new Map<number, PessoaDoC2x[]>();
  try {
    pessoas = await lerPessoasDosEnvios(conexao, aNascer.map((c) => c.envio.csId));
  } catch (falha) {
    falhar(`c2x:rol:${codigoDoErro(falha)}`);
    return falhou(true);
  }

  for (const c of aNascer) {
    const { envio, unidade } = c;
    await renovarAVez();
    if (!temTempo()) {
      // O que não nasceu continua "novo" e nasce na próxima rodada.
      completo = false;
      break;
    }
    const casamento = casar(c);
    somar(relatorio.casamentos, casamento.regra);
    if (casamento.regra === "sem_venda" && casamento.candidata) {
      relatorio.candidatasNaoLigadas += 1;
      if (relatorio.candidatas.length < TETO_DA_LISTA_NO_RELATORIO) {
        relatorio.candidatas.push({ csId: envio.csId, motivo: casamento.candidata.motivo, propostaId: casamento.candidata.propostaId });
      }
    }
    const propostaLigada = casamento.propostaId ? propostaPorId.get(casamento.propostaId) : undefined;
    const ehNativa = propostaLigada?.origem === "panteon";
    anotarNativa(envio, casamento, propostaLigada);

    const finalidade = finalidadeDoTipoDoC2x(envio.contractType);
    if (!finalidade) somar(relatorio.finalidadeNaoMapeada, envio.contractType ?? "(nulo)");
    const quadro = quadroDoEnvioDoC2x(pessoas.get(envio.csId) ?? []);
    const uuid = String(envio.uuidDoc);
    const linhaNova = {
      c2x_contract_signature_id: envio.csId,
      criado_em: envio.criadoEm,
      enterprise_id: envio.enterpriseId,
      envelope_id: uuid,
      enviado_em: envio.criadoEm,
      estado: "desconhecido",
      estado_cru: envio.statusC2x === null ? null : `c2x:${envio.statusC2x}`,
      finalidade,
      nome: `Contrato ${unidade.codigo} (D4Sign, envio ${envio.csId})`,
      ordenada: envio.ordenada,
      origem: "c2x",
      proposta_id: casamento.propostaId,
      provedor: "d4sign",
      provedor_documento_id: uuid,
      signatarios: quadro,
      unidade_id: unidade.id,
      workspace_id: WORKSPACE,
    };

    let linha: LinhaDoEspelho | null = null;
    if (gravar) {
      // ⚠️ INSERÇÃO POR LINHA: um erro não derruba as outras. 23505 no documento = outra rodada inseriu
      // (ignora); o efeito na venda vale SÓ para as linhas que o insert devolveu.
      const { data, error } = await sb.from("temis_envelopes").insert(linhaNova).select(COLUNAS_DO_ESPELHO);
      if (error) {
        if (String(error.code ?? "") !== "23505") {
          falhar(`insert:${envio.csId}:${codigoDoErro(error)}`);
          completo = false;
        }
        continue;
      }
      linha = ((Array.isArray(data) ? data[0] : data) as LinhaDoEspelho | undefined) ?? null;
      if (!linha) continue;
      relatorio.inseridos += 1;
    } else {
      linha = {
        atualizado_em: envio.criadoEm,
        c2x_contract_signature_id: envio.csId,
        conferido_em: null,
        criado_em: envio.criadoEm,
        estado: "desconhecido",
        estado_cru: linhaNova.estado_cru,
        fechado_em: null,
        finalidade,
        id: `ensaio:${envio.csId}`,
        origem: "c2x",
        proposta_id: casamento.propostaId,
        provedor_documento_id: uuid,
        tentado_em: null,
        trabalho_id: null,
        unidade_id: unidade.id,
      };
    }
    emJogo.set(linha.id, {
      envio,
      estado: linha.estado,
      finalizadoAdiado: false,
      jaListado: false,
      linha,
      nativa: propostaLigada ? ehNativa : false,
      nova: true,
      quadro,
      vendaEmCurso: Boolean(propostaLigada && !propostaLigada.cancelada_em && ETAPAS_COM_CONTRATO_EM_CURSO.has(propostaLigada.etapa)),
    });
  }
  return { c2xFalhou, completo };
}
