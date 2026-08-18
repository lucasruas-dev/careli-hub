// CONTRATOS — a visão de Vendas do portal do incorporador que mostra os contratos do escopo e a
// fila de assinatura deles: as taxas por perfil, os blocos de KPI, a fila por ordem, a LISTA DE
// UNIDADES com o progresso por grupo e o quadro por assinante.
//
// ⚠️ FUSÃO DE 18/08/2026. Eram duas visões (Contratos e Assinaturas) e o dono pediu uma:
// *"a tela de assinatura devia chamar contratos e tirar a tela de contratos que tem hoje... no
// final dessa linha vai ter o contrato para ser baixado"*. Esta leitura virou a ÚNICA da visão, e
// por isso ela absorveu o que a outra mostrava:
//   • os dados do contrato (gerado em, valor, imobiliária, faturado em, o unitId do PDF) descem em
//     `UnidadeDeAssinatura.contrato`, vindos de `lerContratosVivos` (contratos.ts) pelo ar_id;
//   • o contrato gerado que ainda NÃO saiu para assinar deixou de ser só o KPI "aguardando
//     emissão" e virou LINHA da lista — sem envio não há esquema, mas os dados do contrato dele
//     existem e a visão antiga os mostrava.
//
// A REFERÊNCIA É O PAINEL INTERNO (lib/apolo/painel-assinatura.ts), e as regras dele são
// IMPORTADAS, não copiadas:
//   • `marcarSituacao` — assinado / vez / aguardando respeitando a ORDEM dos assinantes
//     (`after_position`): é a regra que o dono definiu, e é a diferença entre cobrar a pessoa
//     certa e a errada (o caso Northon: 181 "pendências" quando só 2 estavam com ele);
//   • `perfilDeTela` — Cliente vira Comprador, e-mail @careli.adm.br vira Backoffice. É a ÚNICA
//     fonte dos rótulos de perfil da tela (regra do Lucas, 18/08/2026: *"do jeito que estamos
//     fazendo hoje"* — o cliente lê o mesmo nome que o time lê no painel interno);
//   • `prazoDoComprador` / `PRAZO_COMPRADOR` — a régua de 7 dias do comprador;
//   • o filtro de envio: `send_document_signature = 1` e status ≠ 6.
//
// Por CONTRATO (proposta) vale UM envio — o com uuidDoc, senão o de maior id (`escolherEnvio`,
// de contratos.ts): a média é de 2 envios por contrato e contar todos dobraria o quadro.
//
// ⚠️ A GRANULARIDADE DA LISTA É O ENVIO, não a unidade, e o rótulo dela é a unidade. Uma unidade
// revendida tem dois contratos enviados, com esquemas de assinatura DIFERENTES; fundir os dois numa
// linha só criaria um esquema que não existe em contrato nenhum. Por isso `unidades` pode ter mais
// linhas que `kpis.unidadesComEnvio` (que conta unidade de verdade, chaveada por emp + unidade).
//
// ⚠️ ENVIO VÁLIDO SEM NENHUM ASSINANTE EXISTE (contratos.ts admite o cenário; medido 0 casos no
// VAL, mas o portal vai além do VAL). Por isso a leitura usa LEFT JOIN em
// `contract_signature_signers`: com join interno o envio sumiria e o contrato cairia (errado) no
// KPI "Aguardando emissão", que é justamente o balde de quem NÃO saiu para assinar. Aqui ele entra
// na lista com o esquema vazio, que a tela rotula como "sem assinante registrado".
//
// ⚠️ RÉGUA IMPORTADA À RISCA (decisão registrada): as linhas NÃO filtram estágio nem se
// restringem à proposta mais recente da unidade — fiel ao painel interno. Um envio pendente de
// venda já distratada/cancelada segue na lista até o envio ser cancelado no C2X (status 6). Ele
// entra SEM dados de contrato (`contrato: null`), porque não há contrato vigente por trás dele:
// sem valor, sem imobiliária e sem botão de PDF. Se o Lucas decidir que o portal (vitrine externa)
// deve esconder esses mortos, o corte é cruzar `enviosPorAr` com os `vivos` que esta função já lê.
//
// OS NOMES DOS ASSINANTES DO FLUXO APARECEM — decisão já comunicada ao dono: o incorporador é
// parte do contrato e assina junto; esconder quem está segurando a fila inutilizaria o quadro.
// ⚠️ E-MAIL NÃO ATRAVESSA. O painel interno mostra o e-mail sob o nome; aqui não. Decisão do Lucas
// (18/08/2026): a tela é de cliente externo, e o e-mail de terceiro (comprador, corretor,
// funcionário da Careli) é dado pessoal que a tela não precisa para responder nenhuma pergunta
// dela. O e-mail entra só na tradução de perfil, dentro do servidor.
//
// Medido no C2X em 18/08/2026, nos recortes que existem hoje: os perfis que assinam são
// Comprador, Imobiliária, Backoffice, Incorporador, Coordenadora de venda e Corretor (2 linhas no
// LBR) — nenhum "Sem perfil". A ORDEM (`after_position`) está DESLIGADA no Vista Alegre e no LBF /
// LBP (todo mundo no degrau 0, todos assinam em paralelo) e ligada no Vale do Ouro (1 a 5) e em
// parte do LBR (1 a 8). É por isso que a fila por ordem só aparece quando o recorte tem mais de um
// degrau, e que o rótulo do degrau é DERIVADO dos perfis que assinam nele (ver `fila`).
import type { RowDataPacket } from "mysql2";

// ⚠️ SÓ O TIPO. `d4sign-assinaturas` puxa o cliente HTTP da D4Sign; importar valor daqui criaria
// dependência de rede na montagem do quadro, que é PURA de propósito (é ela que os testes fixam).
import type { EnvioParaConciliar, FonteDaAssinatura } from "@/lib/apolo/d4sign-assinaturas";
// ⚠️ IMPORTAÇÃO CIRCULAR, E DE PROPÓSITO: `d4sign-quadro` importa daqui a montagem pura
// (`montarQuadroDeAssinaturas`) e este arquivo importa de lá o enxerto que a usa. O ciclo é seguro
// porque NENHUM dos dois lados usa o outro em tempo de AVALIAÇÃO do módulo — só dentro de função,
// e declaração de função é içada. Quem mexer aqui não pode criar uso de topo (uma constante
// calculada com `montarQuadroComD4Sign`, por exemplo): aí o ciclo passa a valer `undefined`.
// A alternativa seria mudar `montarQuadroDeAssinaturas` de arquivo — o que o cabeçalho de
// lib/apolo/assinaturas/nucleo.ts já prevê para quando o portal parar de estar em obra.
import { montarQuadroComD4Sign, type QuadroComFonte } from "@/lib/apolo/d4sign-quadro";
import {
  marcarSituacao,
  perfilDeTela,
  prazoDoComprador,
  type LinhaAssinatura,
} from "@/lib/apolo/painel-assinatura";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

import {
  escolherEnvio,
  lerContratosVivos,
  type ContratoBruto,
  type EnvioDeAssinatura,
  type SituacaoDaAssinatura,
} from "./contratos";

/**
 * Teto da lista analítica. Os KPIs, as taxas e a fila são calculados ANTES do corte, sobre o
 * recorte inteiro; o teto vale só para a lista que desce para o navegador (cada linha carrega o
 * esquema de assinatura completo, então uma carteira grande viraria um payload de megabytes).
 */
const TETO_DE_ENVIOS = 500;

/** Uma linha do esquema de assinatura de um contrato. Sem e-mail, por decisão do dono. */
export type AssinaturaDoEsquema = {
  /** ISO curto ("2026-07-01") de quando assinou; nulo enquanto não assinou. */
  assinadoEm: null | string;
  /** Posição na fila (`after_position`). 0 = o empreendimento não usa ordem: todos em paralelo. */
  degrau: number;
  nome: string;
  /** Perfil traduzido por `perfilDeTela` — o MESMO rótulo do painel interno. */
  perfil: string;
  situacao: "aguardando" | "assinado" | "vez";
};

/**
 * O progresso de um PERFIL dentro de um contrato: quantos daquele grupo já assinaram e se a bola
 * está com ele agora. É a barrinha por grupo da linha da unidade.
 *
 * ⚠️ Só entram os perfis que ASSINAM AQUELE contrato. Desenhar barra vazia de um perfil que não
 * participa diria que falta alguém que nunca foi chamado.
 */
export type GrupoDaUnidade = {
  assinadas: number;
  /** Alguém deste perfil está na vez NESTE contrato: é o grupo que a linha precisa destacar. */
  naVez: boolean;
  perfil: string;
  /**
   * O degrau mais cedo em que este perfil assina NESTE contrato — a matéria-prima da ordem das
   * barrinhas (ver `ordenarGruposPelaOrdemDeAssinatura`). Vai para a tela junto porque a ordem é
   * calculada no recorte inteiro, depois de todas as linhas montadas.
   */
  primeiroDegrau: number;
  total: number;
};

/**
 * O QUE O CONTRATO ACRESCENTA À LINHA — os dados que a visão Contratos antiga mostrava em colunas
 * e que a fusão de 18/08/2026 pendurou na linha da unidade (valor e geração aparecem na própria
 * linha; imobiliária e faturamento, no cabeçalho do popup).
 *
 * Vem de `lerContratosVivos` (contratos.ts) pelo `ar_id` do envio. Nulo quando o envio é de uma
 * proposta que NÃO é mais a viva da unidade (revenda, distrato): ali não há contrato vigente de
 * onde tirar valor, imobiliária ou PDF — e a visão antiga também não mostrava essa linha.
 */
export type DadosDoContrato = {
  /** Data de faturamento (`billing_date`), ISO CURTO 'YYYY-MM-DD': formatar por STRING na tela. */
  faturadoEm: null | string;
  /** Primeira entrada no estágio "Contrato gerado" (ISO completo). Nulo em venda antiga. */
  geradoEm: null | string;
  imobiliaria: null | string;
  /**
   * O contrato assinado existe no D4Sign (uuidDoc do envio escolhido): é o que liga o botão de PDF
   * do fim da linha, que aponta para /api/incorporador/contrato?unitId=… — rota que reconfere
   * `unidadeNoEscopo` e resolve o uuid NO C2X, nunca aceita uuid do navegador.
   */
  temContrato: boolean;
  /** A chave do botão de PDF. Único id que atravessa; a rota que o recebe reconfere o escopo. */
  unitId: number;
  /** Valor de tabela da unidade. */
  valorTabela: number;
};

/** Uma linha da lista analítica: um ENVIO (contrato) rotulado pela unidade dele. */
export type UnidadeDeAssinatura = {
  assinadas: number;
  /**
   * O aviso DAQUELA linha sobre a procedência do que está escrito nela. Nulo quando a D4Sign
   * confirmou e o contrato está vivo.
   *
   * ⚠️ TEM QUE APARECER NA TELA. Uma linha "c2x-legado" pode estar dizendo "pendente" sobre um
   * contrato já assinado — é literalmente o defeito que motivou a troca de fonte. Quem preenche é
   * `montarQuadroComD4Sign`; a montagem pura deixa nulo, porque sem consultar a D4Sign não há o
   * que avisar.
   */
  aviso: null | string;
  /** Nome(s) do perfil Comprador daquele contrato, já juntados. Nulo quando não há. */
  comprador: null | string;
  concluida: boolean;
  /** Os dados do contrato daquela venda. Nulo quando o envio não é da proposta viva da unidade. */
  contrato: DadosDoContrato | null;
  empreendimento: string;
  /** Data em que o contrato saiu para assinatura (ISO curto, "2026-07-01"). VAZIA em contrato que
   * ainda não saiu para assinar (situação "aguardando-emissao"). */
  enviadoEm: string;
  /** `contract_signatures.id` — a chave da linha e do popup. 0 = contrato ainda sem envio. */
  envioId: number;
  /** O esquema inteiro, na ordem do fluxo. Vazio = envio sem assinante registrado. */
  esquema: AssinaturaDoEsquema[];
  /**
   * De onde veio o status desta linha. `c2x-legado` na montagem pura (ninguém perguntou nada à
   * D4Sign); `montarQuadroComD4Sign` é quem troca pelo que a fonte respondeu.
   */
  fonte: FonteDaAssinatura;
  /** Os perfis presentes no contrato, na ordem do fluxo: as barrinhas da linha. */
  grupos: GrupoDaUnidade[];
  /** Quem está na vez NESTE contrato — pode ser mais de um (degrau dividido assina em paralelo). */
  naVez: string[];
  /** Os perfis que estão na vez: é por eles que a lista filtra ("parado com o Incorporador"). */
  perfisNaVez: string[];
  /**
   * A situação resumida, na MESMA régua da visão Contratos antiga (`situacaoDaAssinatura`):
   * assinado, em assinatura ou aguardando emissão (o contrato existe e não saiu para a D4Sign).
   */
  situacao: SituacaoDaAssinatura;
  total: number;
  unidade: string;
};

/** Um degrau da fila no recorte: quantas assinaturas dele já saíram, e de quem ele é. */
export type DegrauDaFila = {
  assinadas: number;
  degrau: number;
  /**
   * Os perfis que assinam NESTE degrau, no recorte. É daqui que sai o rótulo do degrau na tela.
   *
   * ⚠️ NÃO reusamos a tabela de nomes fixos do painel interno (1 Corretor/imobiliária, 2 Comprador
   * e cônjuge, 3 Testemunhas…): medido no C2X em 18/08/2026, ela descreve o Vale do Ouro e mente
   * fora dele — no LBR o degrau 3 é da Imobiliária e o 4 do Comprador. Rótulo derivado do dado
   * nunca mente, e a fonte do nome continua sendo `perfilDeTela`.
   */
  perfis: string[];
  total: number;
};

/** A taxa de assinatura de um perfil no recorte: o card de gargalo da faixa de cima. */
export type TaxaDoPerfil = {
  assinadas: number;
  /** Assinaturas que aquele perfil precisa dar no recorte (assinadas + pendentes). */
  esperadas: number;
  perfil: string;
};

export type AssinanteDoQuadro = {
  /** Contratos em que a fila parou em ALGUÉM ANTES dele: pendência que não é dele (ainda). */
  aguardandoAnteriores: number;
  /** Contratos que ele já assinou. */
  assinou: number;
  /** Contratos em que a bola está COM ELE agora: é a fila do gargalo. */
  naVez: number;
  nome: string;
  /** Perfil traduzido (Comprador, Imobiliária, Incorporador, Backoffice…), quando existe. */
  papel: null | string;
};

export type KpisDeAssinatura = {
  /** Contratos vivos que ainda NÃO saíram para assinar (sem envio válido na D4Sign). */
  aguardandoEmissao: number;
  /** Linhas de Comprador pendentes há mais de `PRAZO_COMPRADOR` dias (a régua do painel). */
  compradorEmAtraso: number;
  /** Unidades com TODAS as assinaturas de comprador colhidas. */
  compradorOk: number;
  /** Unidades em que ainda falta assinatura de comprador. */
  compradorPendente: number;
  /** Média de dias entre o envio e a assinatura do comprador. Nulo sem amostra. */
  diasAteAssinar: null | number;
  /** Média de dias desde o envio, por contrato enviado. Nulo sem amostra. */
  diasDesdeEnvio: null | number;
  /** % das linhas de Comprador já assinadas (0–100). Nulo sem nenhum comprador no escopo. */
  pctCompradoresAssinaram: null | number;
  /** Média de dias entre a geração do contrato e a ÚLTIMA assinatura dele. Nulo sem amostra. */
  tempoMedioDias: null | number;
  /** Unidades cujo(s) contrato(s) enviados estão 100% assinados. */
  unidadesTotalmenteAssinadas: number;
  /** Unidades com pelo menos um contrato enviado para assinatura. */
  unidadesComEnvio: number;
};

export type QuadroDeAssinaturas = {
  assinantes: AssinanteDoQuadro[];
  /** O aviso do teto da lista, quando ela foi cortada. Nulo quando veio inteira. */
  aviso: null | string;
  /**
   * O aviso da FONTE no recorte inteiro: "o D4Sign não respondeu e isto aqui é o registro antigo".
   *
   * ⚠️ NÃO É O `aviso`. Aquele é o do teto da lista ("mostrando os 500 mais antigos"); este é o da
   * procedência do dado. Somar os dois num campo só faria um esconder o outro — e o que some é
   * sempre o que aparece menos, que é justamente a notícia.
   */
  avisoDaFonte: null | string;
  /**
   * O aviso sobre o DETALHE por assinante, quando a situação do documento veio confirmada mas
   * ninguém foi conferido um a um (ver `avisoDosAssinantes` em lib/apolo/d4sign-assinaturas).
   */
  avisoDosAssinantes: null | string;
  /** A fila por ordem de assinatura. Vem VAZIA quando o recorte não usa ordem (tudo no 0). */
  fila: DegrauDaFila[];
  kpis: KpisDeAssinatura;
  taxas: TaxaDoPerfil[];
  /** A lista analítica, já ordenada pelo gargalo e cortada no teto. */
  unidades: UnidadeDeAssinatura[];
};

/**
 * A FICHA de um contrato vivo: tudo o que a visão Contratos antiga mostrava, fora a data de
 * geração (que fica no `ContratoVivo`, porque o tempo médio de assinatura sempre precisou dela).
 */
export type FichaDoContratoVivo = {
  /** Nome de quem comprou, do cadastro do C2X (rotula o contrato que ainda não saiu para assinar). */
  comprador: null | string;
  /** Código do empreendimento (VAL, LBR…): a chave de unidade da lista é emp + unidade. */
  empreendimento: string;
  /** ISO curto 'YYYY-MM-DD' de `billing_date`. */
  faturadoEm: null | string;
  imobiliaria: null | string;
  /** O PDF assinado existe na D4Sign (uuidDoc do envio escolhido daquele contrato). */
  temContrato: boolean;
  /** Rótulo da unidade, na MESMA régua das linhas de assinatura (`name`, senão code+quadra+lote). */
  unidade: string;
  /** `enterprise_unities.id` — a chave do botão de PDF. */
  unitId: number;
  valorTabela: number;
};

/**
 * Um contrato vivo do escopo — a proposta viva da unidade.
 *
 * ⚠️ DUAS FORMAS DE CHAMADA, de propósito. `arId` + `geradoEm` bastam para o que a montagem sempre
 * fez: o KPI "aguardando emissão" e o tempo médio de assinatura. A FICHA só vem de quem leu o
 * contrato inteiro (`lerContratosVivos`), e é ela que autoriza as duas coisas que a fusão de
 * 18/08/2026 trouxe: os dados na linha (`DadosDoContrato`) e a LINHA do contrato que ainda não
 * saiu para assinar. Quem chama sem ficha (o painel interno, que monta essas linhas com os campos
 * dele) continua recebendo exatamente a mesma lista de antes.
 */
export type ContratoVivo = {
  arId: number;
  /** A ficha completa. Ausente na chamada mínima. */
  ficha?: FichaDoContratoVivo;
  /** ISO completo da primeira entrada no estágio "Contrato gerado". */
  geradoEm: null | string;
};

/** Um envio VÁLIDO que saiu para a D4Sign sem NENHUMA linha de assinante registrada. */
export type EnvioSemAssinante = {
  /** `contract_signatures.id`: a linha da lista precisa de chave como qualquer outra. */
  csId: number;
  emp: string;
  /** Data do envio (ISO curto), mesma régua de `UnidadeDeAssinatura.enviadoEm`. */
  enviadoEm: string;
  un: string;
};

/**
 * Monta o quadro inteiro a partir das LINHAS de assinatura (já do envio escolhido de cada
 * contrato) e dos contratos vivos do escopo. Função pura: é ela que os testes fixam.
 *
 * @param linhas        Linhas de assinatura no formato do painel interno.
 * @param vivos         Contratos vivos do escopo (para o KPI de emissão e o tempo médio).
 * @param arPorEnvio    De qual proposta (`ar_id`) é cada envio (`LinhaAssinatura.contrato`) —
 *                      INCLUSIVE o envio sem linha: é o que o tira do KPI "Aguardando emissão".
 * @param semAssinante  Envios escolhidos sem nenhuma linha: entram na lista como pendentes.
 */
export function montarQuadroDeAssinaturas(
  linhas: LinhaAssinatura[],
  vivos: ContratoVivo[],
  arPorEnvio: Map<number, number>,
  semAssinante: EnvioSemAssinante[] = [],
): QuadroDeAssinaturas {
  // A regra da fila é a do painel interno, importada: quem está na vez é quem divide o menor
  // degrau ainda pendente DAQUELE contrato.
  const situadas = marcarSituacao(linhas);

  const porContrato = new Map<number, LinhaAssinatura[]>();
  for (const linha of situadas) {
    const lista = porContrato.get(linha.contrato) ?? [];
    lista.push(linha);
    porContrato.set(linha.contrato, lista);
  }

  // ── KPIs DE UNIDADE ───────────────────────────────────────────────────────────────────────
  //
  // Unidade 100% assinada = TODOS os envios dela com todas as linhas assinadas (uma unidade
  // revendida pode ter mais de um contrato com envio; um pendente segura a unidade).
  //
  // ⚠️ A CHAVE É empreendimento + unidade: no recorte "todos", dois loteamentos podem batizar a
  // unidade com o MESMO nome, e chavear só pelo nome subcontaria (e uma pendente de um seguraria
  // a homônima do outro).
  const unidades = new Map<string, boolean>();
  // O comprador é por UNIDADE, como no painel interno: `true` enquanto todo comprador dela assinou.
  const compradorPorUnidade = new Map<string, boolean>();
  for (const [, doContrato] of porContrato) {
    const chave = `${doContrato[0]?.emp ?? ""}:${doContrato[0]?.un ?? ""}`;
    const completo = doContrato.every((linha) => linha.assinou);
    unidades.set(chave, (unidades.get(chave) ?? true) && completo);

    const compradores = doContrato.filter((linha) => linha.perfil === "Comprador");
    if (compradores.length > 0) {
      const ok = compradores.every((linha) => linha.assinou);
      compradorPorUnidade.set(chave, (compradorPorUnidade.get(chave) ?? true) && ok);
    }
  }
  // Envio sem nenhum assinante registrado: a unidade TEM envio, e não está 100% assinada.
  for (const envio of semAssinante) {
    unidades.set(`${envio.emp}:${envio.un}`, false);
  }
  const unidadesTotalmenteAssinadas = [...unidades.values()].filter(Boolean).length;
  const compradorOk = [...compradorPorUnidade.values()].filter(Boolean).length;
  const compradorPendente = compradorPorUnidade.size - compradorOk;

  // ── KPIs DE COMPRADOR E DE PRAZO ──────────────────────────────────────────────────────────
  const compradores = situadas.filter((linha) => linha.perfil === "Comprador");
  const compradoresAssinados = compradores.filter((linha) => linha.assinou).length;

  // A régua de atraso é a do painel (7 dias), importada: quem assinou conta os dias até assinar,
  // quem não assinou conta os dias desde o envio.
  const compradorEmAtraso = compradores.filter(
    (linha) =>
      prazoDoComprador(linha.perfil, linha.assinou, diasDaLinha(linha)) ===
      "Pendente e em atraso",
  ).length;

  const diasAteAssinarAmostra = compradores
    .filter((linha) => linha.assinou && linha.assinadoEm)
    .map((linha) => diasEntre(linha.envio, linha.assinadoEm as string))
    .filter((dias): dias is number => dias !== null);

  // Um valor por CONTRATO: somar linha a linha pesaria o contrato de sete assinantes sete vezes.
  const diasDesdeEnvioPorContrato = new Map<number, number>();
  for (const linha of situadas) diasDesdeEnvioPorContrato.set(linha.contrato, linha.diasDesdeEnvio);

  // Tempo médio: geração do contrato (primeira entrada no estágio "Contrato gerado") até a
  // ÚLTIMA assinatura do envio. Só contratos completos e com a geração registrada entram — as
  // vendas antigas do C2X não têm o histórico, e chutar a data mentiria a média.
  const vivoPorAr = new Map(vivos.map((vivo) => [vivo.arId, vivo]));
  const temposDias: number[] = [];
  for (const [contrato, doContrato] of porContrato) {
    if (!doContrato.every((linha) => linha.assinou)) continue;
    const arId = arPorEnvio.get(contrato);
    const gerado = arId === undefined ? null : vivoPorAr.get(arId)?.geradoEm ?? null;
    if (!gerado) continue;
    const ultima = doContrato
      .map((linha) => linha.assinadoEm)
      .filter((data): data is string => Boolean(data))
      .sort()
      .at(-1);
    if (!ultima) continue;
    const dias = (new Date(ultima).getTime() - new Date(gerado).getTime()) / 86_400_000;
    if (Number.isFinite(dias)) temposDias.push(Math.max(0, dias));
  }

  const arsComEnvio = new Set(arPorEnvio.values());
  // Contrato gerado que ainda NÃO saiu para a D4Sign. Desde a fusão ele não é só um KPI: vira
  // linha da lista (a visão Contratos antiga o mostrava, com valor, imobiliária e faturamento).
  const semEnvio = vivos.filter((vivo) => !arsComEnvio.has(vivo.arId));
  const aguardandoEmissao = semEnvio.length;

  // ── A FILA POR ORDEM ──────────────────────────────────────────────────────────────────────
  const porDegrau = new Map<number, { assinadas: number; perfis: Set<string>; total: number }>();
  for (const linha of situadas) {
    const atual = porDegrau.get(linha.degrau) ?? { assinadas: 0, perfis: new Set<string>(), total: 0 };
    atual.total += 1;
    if (linha.assinou) atual.assinadas += 1;
    if (linha.perfil) atual.perfis.add(linha.perfil);
    porDegrau.set(linha.degrau, atual);
  }
  // ⚠️ RECORTE SEM ORDEM NÃO TEM FILA. Metade dos empreendimentos assina com `after_position` = 0
  // para todo mundo (a ordem está desligada no C2X): desenhar "degrau 0: 93 de 93" seria uma
  // seção inteira dizendo o que o KPI geral já diz. Só há fila quando há mais de um degrau.
  const fila: DegrauDaFila[] =
    porDegrau.size > 1
      ? [...porDegrau.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([degrau, valores]) => ({
            assinadas: valores.assinadas,
            degrau,
            perfis: [...valores.perfis].sort((a, b) => a.localeCompare(b, "pt-BR")),
            total: valores.total,
          }))
      : [];

  // ── AS TAXAS POR PERFIL (os cards de gargalo) ─────────────────────────────────────────────
  const porPerfil = new Map<string, { assinadas: number; esperadas: number }>();
  for (const linha of situadas) {
    const perfil = linha.perfil || "Sem perfil";
    const atual = porPerfil.get(perfil) ?? { assinadas: 0, esperadas: 0 };
    atual.esperadas += 1;
    if (linha.assinou) atual.assinadas += 1;
    porPerfil.set(perfil, atual);
  }
  // O PIOR PRIMEIRO: a faixa existe para dizer em qual elo a assinatura emperra, então o card da
  // esquerda é o que menos assinou. Empate resolve pelo volume (o gargalo maior pesa mais).
  const taxas: TaxaDoPerfil[] = [...porPerfil.entries()]
    .map(([perfil, valores]) => ({ ...valores, perfil }))
    .sort(
      (a, b) =>
        a.assinadas / a.esperadas - b.assinadas / b.esperadas ||
        b.esperadas - a.esperadas ||
        a.perfil.localeCompare(b.perfil, "pt-BR"),
    );

  // ── A LISTA ANALÍTICA, uma linha por ENVIO ────────────────────────────────────────────────
  const lista: UnidadeDeAssinatura[] = [];
  for (const [envioId, doContrato] of porContrato) {
    const esquema = [...doContrato]
      .sort(
        (a, b) =>
          a.degrau - b.degrau ||
          ordemDaSituacao(a.situacao) - ordemDaSituacao(b.situacao) ||
          a.usuario.localeCompare(b.usuario, "pt-BR"),
      )
      .map((linha) => ({
        assinadoEm: linha.assinadoEm,
        degrau: linha.degrau,
        nome: linha.usuario,
        perfil: linha.perfil || "Sem perfil",
        situacao: linha.situacao,
      }));

    const naVez = [
      ...new Set(
        doContrato
          .filter((linha) => linha.situacao === "vez")
          .map((linha) => linha.usuario)
          .filter(Boolean),
      ),
    ];
    const compradoresDoContrato = [
      ...new Set(
        doContrato
          .filter((linha) => linha.perfil === "Comprador")
          .map((linha) => linha.usuario)
          .filter(Boolean),
      ),
    ];

    const arDoEnvio = arPorEnvio.get(envioId);
    const vivo = arDoEnvio === undefined ? undefined : vivoPorAr.get(arDoEnvio);
    const concluida = doContrato.every((linha) => linha.assinou);

    lista.push({
      assinadas: doContrato.filter((linha) => linha.assinou).length,
      // A montagem PURA não fala com a D4Sign: a procedência sai daqui como legado, e quem troca é
      // `montarQuadroComD4Sign`. Nascer "confirmado" seria mentir por omissão no dia em que alguém
      // chamasse a montagem sozinha.
      aviso: null,
      comprador: compradoresDoContrato.length > 0 ? compradoresDoContrato.join(", ") : null,
      concluida,
      contrato: dadosDoContrato(vivo),
      empreendimento: doContrato[0]?.emp ?? "",
      enviadoEm: doContrato[0]?.envio ?? "",
      envioId,
      esquema,
      fonte: "c2x-legado",
      grupos: agruparPorPerfil(esquema),
      naVez,
      perfisNaVez: [
        ...new Set(
          doContrato.filter((linha) => linha.situacao === "vez").map((linha) => linha.perfil || "Sem perfil"),
        ),
      ].sort((a, b) => a.localeCompare(b, "pt-BR")),
      // Mesma régua da visão antiga: o envio existe, então nunca "aguardando emissão".
      situacao: concluida ? "assinado" : "em-assinatura",
      total: doContrato.length,
      unidade: doContrato[0]?.un ?? "",
    });
  }
  // O envio que saiu sem nenhum assinante registrado é pendência VISÍVEL: não aparece no quadro
  // por assinante (não há linha de quem cobrar), mas não pode sumir da lista — a tela mostra
  // "sem assinante registrado" quando o esquema vem vazio.
  for (const envio of semAssinante) {
    const vivo = vivoPorAr.get(arPorEnvio.get(envio.csId) ?? -1);
    lista.push({
      assinadas: 0,
      aviso: null,
      comprador: null,
      concluida: false,
      contrato: dadosDoContrato(vivo),
      empreendimento: envio.emp,
      enviadoEm: envio.enviadoEm,
      envioId: envio.csId,
      esquema: [],
      fonte: "c2x-legado",
      grupos: [],
      naVez: [],
      perfisNaVez: [],
      situacao: "em-assinatura",
      total: 0,
      unidade: envio.un,
    });
  }
  // ⚠️ O CONTRATO QUE AINDA NÃO SAIU PARA ASSINAR TAMBÉM É LINHA (fusão de 18/08/2026). A visão
  // Contratos antiga listava estas vendas com o chip "Aguardando emissão", e some-las num KPI
  // perderia o valor, a imobiliária, a geração e o faturamento delas. Sem envio, não há esquema
  // nem barrinha: a linha mostra o chip e os dados do contrato.
  //
  // Só quem manda a FICHA recebe estas linhas: sem ela não há nem rótulo de unidade para desenhar
  // (ver `ContratoVivo`), e o chamador que monta as próprias linhas não ganha uma segunda cópia.
  for (const vivo of semEnvio) {
    if (!vivo.ficha) continue;

    lista.push({
      assinadas: 0,
      aviso: null,
      comprador: vivo.ficha.comprador,
      concluida: false,
      contrato: dadosDoContrato(vivo),
      empreendimento: vivo.ficha.empreendimento,
      enviadoEm: "",
      envioId: 0,
      esquema: [],
      fonte: "c2x-legado",
      grupos: [],
      naVez: [],
      perfisNaVez: [],
      situacao: "aguardando-emissao",
      total: 0,
      unidade: vivo.ficha.unidade,
    });
  }

  // A ORDEM É A DO GARGALO: pendente primeiro, e dentro dela a que espera há mais tempo (envio
  // mais antigo). As concluídas vão para o fim, da mais recente para a mais antiga — elas não
  // somem (o dono pediu que continuassem visíveis), só param de disputar o topo.
  lista.sort(
    (a, b) =>
      Number(a.concluida) - Number(b.concluida) ||
      (a.concluida
        ? esperaDe(b).localeCompare(esperaDe(a))
        : esperaDe(a).localeCompare(esperaDe(b))) ||
      a.unidade.localeCompare(b.unidade, "pt-BR"),
  );

  const cortada = lista.length > TETO_DE_ENVIOS;

  // ── O QUADRO POR ASSINANTE ────────────────────────────────────────────────────────────────
  const assinantes = new Map<string, AssinanteDoQuadro>();
  for (const linha of situadas) {
    const nome = linha.usuario;
    if (!nome) continue;
    const atual = assinantes.get(nome) ?? {
      aguardandoAnteriores: 0,
      assinou: 0,
      naVez: 0,
      nome,
      papel: linha.perfil || null,
    };
    if (linha.situacao === "assinado") atual.assinou += 1;
    else if (linha.situacao === "vez") atual.naVez += 1;
    else atual.aguardandoAnteriores += 1;
    assinantes.set(nome, atual);
  }

  // ⚠️ AQUI, DEPOIS DE TODAS AS LINHAS MONTADAS, e não dentro do laço: a ordem das barrinhas é do
  // RECORTE, não de cada contrato. Ver `ordenarGruposPelaOrdemDeAssinatura`.
  ordenarGruposPelaOrdemDeAssinatura(lista);

  return {
    // Quem tem mais contrato NA VEZ primeiro: o quadro existe para achar o gargalo.
    assinantes: [...assinantes.values()].sort(
      (a, b) =>
        b.naVez - a.naVez ||
        b.aguardandoAnteriores - a.aguardandoAnteriores ||
        b.assinou - a.assinou ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    ),
    aviso: cortada
      ? `Mostrando os ${TETO_DE_ENVIOS} contratos mais antigos sem assinar, de ${lista.length.toLocaleString("pt-BR")}. Os indicadores acima contam o recorte inteiro.`
      : null,
    // Montagem pura não consulta fonte nenhuma: não há o que avisar. Preenchidos por
    // `montarQuadroComD4Sign`.
    avisoDaFonte: null,
    avisoDosAssinantes: null,
    fila,
    kpis: {
      aguardandoEmissao,
      compradorEmAtraso,
      compradorOk,
      compradorPendente,
      diasAteAssinar: media(diasAteAssinarAmostra),
      diasDesdeEnvio: media([...diasDesdeEnvioPorContrato.values()]),
      pctCompradoresAssinaram:
        compradores.length > 0
          ? arredondar1((compradoresAssinados / compradores.length) * 100)
          : null,
      tempoMedioDias: media(temposDias),
      unidadesTotalmenteAssinadas,
      unidadesComEnvio: unidades.size,
    },
    taxas,
    unidades: cortada ? lista.slice(0, TETO_DE_ENVIOS) : lista,
  };
}

/** O recorte de `ContratoVivo` que desce para a linha. Sem ficha, a linha vem sem dados. */
function dadosDoContrato(vivo: ContratoVivo | undefined): DadosDoContrato | null {
  if (!vivo?.ficha) return null;

  return {
    faturadoEm: vivo.ficha.faturadoEm,
    geradoEm: vivo.geradoEm,
    imobiliaria: vivo.ficha.imobiliaria,
    temContrato: vivo.ficha.temContrato,
    unitId: vivo.ficha.unitId,
    valorTabela: vivo.ficha.valorTabela,
  };
}

/**
 * A data que mede a espera da linha: o envio, e — no contrato que ainda não saiu para assinar — a
 * geração dele. Sem essa segunda régua, todo contrato aguardando emissão empataria em "" e
 * subiria ao topo da lista sem critério nenhum.
 */
function esperaDe(unidade: UnidadeDeAssinatura): string {
  return unidade.enviadoEm || (unidade.contrato?.geradoEm ?? "").slice(0, 10);
}

/**
 * As barrinhas por grupo de uma unidade: um item por perfil PRESENTE no contrato, na ordem do
 * fluxo (o menor degrau em que aquele perfil assina).
 *
 * ⚠️ A SOMA FECHA COM O TOTAL DA LINHA de propósito: todo assinante cai em algum perfil, e o que
 * o C2X não classifica cai em "Sem perfil" (o rótulo que `perfilDeTela` já usa) em vez de sumir.
 */
function agruparPorPerfil(esquema: AssinaturaDoEsquema[]): GrupoDaUnidade[] {
  const mapa = new Map<string, GrupoDaUnidade & { primeiroDegrau: number }>();

  for (const item of esquema) {
    const atual = mapa.get(item.perfil) ?? {
      assinadas: 0,
      naVez: false,
      perfil: item.perfil,
      primeiroDegrau: item.degrau,
      total: 0,
    };
    atual.total += 1;
    if (item.situacao === "assinado") atual.assinadas += 1;
    if (item.situacao === "vez") atual.naVez = true;
    atual.primeiroDegrau = Math.min(atual.primeiroDegrau, item.degrau);
    mapa.set(item.perfil, atual);
  }

  // A ordem SAI DAQUI PROVISÓRIA (pelo degrau desta unidade) e é refeita depois, no recorte
  // inteiro, por `ordenarGruposPelaOrdemDeAssinatura`. Ver o porquê lá.
  return [...mapa.values()].sort(
    (a, b) => a.primeiroDegrau - b.primeiroDegrau || a.perfil.localeCompare(b.perfil, "pt-BR"),
  );
}

/**
 * Põe as barrinhas de TODAS as linhas na ORDEM DE ASSINATURA — e na MESMA ordem em todas elas.
 *
 * Pedido do Lucas em 18/08/2026, com o print da tabela de assinatura na mão: *"não está padrão
 * isso não? imobiliária, comprador, incorporador, coordenação e backoffice?"*. Está: aquela é a
 * sequência real do fluxo, e ler a barra na ordem do dicionário (Backoffice primeiro, que é quem
 * assina por ÚLTIMO) escondia a progressão do contrato.
 *
 * ⚠️ A ORDEM É CANÔNICA, CALCULADA UMA VEZ PARA O RECORTE — e é isso que salva a ideia. Ordenar
 * cada linha pelo próprio degrau parece equivalente e não é: contrato com um perfil a menos, ou
 * com o Incorporador assinando antes, embaralha as colunas e a lista deixa de funcionar como
 * tabela (foi o que gerou o *"uma hora aparece o Backoffice, outra não"* de mais cedo no mesmo
 * dia). Aqui a posição de cada perfil sai da MÉDIA dos degraus dele no recorte, então uma linha
 * excêntrica não desalinha as outras.
 *
 * ⚠️ E A ORDEM SAI DO DADO, não de uma lista fixa no código: se amanhã o fluxo mudar (um perfil
 * novo, o Backoffice assinando antes), a tela acompanha sozinha. Uma constante com os cinco nomes
 * de hoje seria mais simples de ler e estaria errada no dia da mudança, silenciosamente.
 */
function ordenarGruposPelaOrdemDeAssinatura(unidades: UnidadeDeAssinatura[]): void {
  const soma = new Map<string, { degraus: number; vezes: number }>();
  for (const unidade of unidades) {
    for (const grupo of unidade.grupos) {
      const atual = soma.get(grupo.perfil) ?? { degraus: 0, vezes: 0 };
      atual.degraus += grupo.primeiroDegrau;
      atual.vezes += 1;
      soma.set(grupo.perfil, atual);
    }
  }

  const posicao = new Map<string, number>();
  for (const [perfil, { degraus, vezes }] of soma) {
    posicao.set(perfil, vezes > 0 ? degraus / vezes : Number.MAX_SAFE_INTEGER);
  }

  for (const unidade of unidades) {
    unidade.grupos.sort(
      (a, b) =>
        (posicao.get(a.perfil) ?? Number.MAX_SAFE_INTEGER) -
          (posicao.get(b.perfil) ?? Number.MAX_SAFE_INTEGER) ||
        a.perfil.localeCompare(b.perfil, "pt-BR"),
    );
  }
}

/** Assinado, depois quem está na vez, depois quem aguarda: a leitura do esquema de cima para baixo. */
function ordemDaSituacao(situacao: AssinaturaDoEsquema["situacao"]): number {
  return situacao === "assinado" ? 0 : situacao === "vez" ? 1 : 2;
}

/** Os dias que a régua de prazo usa: até assinar, para quem assinou; desde o envio, para quem não. */
function diasDaLinha(linha: LinhaAssinatura): number {
  if (linha.assinou && linha.assinadoEm) {
    return diasEntre(linha.envio, linha.assinadoEm) ?? linha.diasDesdeEnvio;
  }
  return linha.diasDesdeEnvio;
}

function diasEntre(de: string, ate: string): null | number {
  const inicio = new Date(de).getTime();
  const fim = new Date(ate).getTime();
  if (Number.isNaN(inicio) || Number.isNaN(fim)) return null;

  return Math.max(0, Math.round((fim - inicio) / 86_400_000));
}

function media(valores: number[]): null | number {
  if (valores.length === 0) return null;

  return arredondar1(valores.reduce((soma, valor) => soma + valor, 0) / valores.length);
}

type LinhaRow = RowDataPacket & {
  ar_id: number;
  assinado: null | number;
  data_assinatura: null | string;
  dias_envio: null | number;
  email: null | string;
  emp: null | string;
  envio: null | string;
  id_ass: number;
  lot: null | string;
  papel_no_empreendimento: null | string;
  perfil_c2x: null | string;
  usuario_c2x_id: null | number;
  posicao: null | number;
  quadra: null | string;
  /** Nulo = envio sem NENHUM assinante (o LEFT JOIN devolve uma linha só, vazia). */
  signer_id: null | number;
  /** `contract_signature_status_id` — alimenta a divergência "D4Sign 4 x C2X 7". */
  status_c2x: null | number;
  unidade: null | string;
  usuario: null | string;
  uuid_doc: null | string;
  valor: null | number | string;
};

/**
 * ⚠️ `QuadroComFonte` É UM `QuadroDeAssinaturas` — só acrescenta os números da reconciliação. Quem
 * já lia o quadro continua lendo sem mudar uma linha; quem quiser saber de onde veio o dado tem
 * `avisoDaFonte`, `avisoDosAssinantes` e o `fonte`/`aviso` de cada linha.
 */
export type ResultadoAssinaturas =
  /** `uuids` é a lista de documentos desta carga, para a rota aquecer depois de responder. */
  | { data: QuadroComFonte; ok: true; uuids: string[] }
  | { error: string; ok: false };

/**
 * Lê o cenário de assinaturas do C2X (read-only) para os CÓDIGOS já autorizados pela sessão.
 *
 * ⚠️ Esta função NÃO autoriza nada: `codes` tem que vir de `codigosDaSessao` + `codesDoRecorte`,
 * e é a rota que garante isso antes de chamar.
 */
export async function lerAssinaturasDoPortal(codes: string[]): Promise<ResultadoAssinaturas> {
  const validCodes = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code && !EXCLUDED_ENTERPRISE_CODES.includes(code));

  if (validCodes.length === 0) {
    // Recorte vazio não tem documento para conferir: monta o quadro vazio sem tocar na D4Sign.
    return {
      data: {
        ...montarQuadroDeAssinaturas([], [], new Map()),
        cancelados: [],
        // Recorte vazio já está conciliado por definição: não há documento nenhum a conferir.
        conciliando: false,
        resumoDaFonte: {
          assinaturasCorrigidas: 0,
          cancelados: 0,
          confirmados: 0,
          emFallback: 0,
          envios: 0,
          semDocumento: 0,
          somenteStatus: 0,
        },
      },
      ok: true,
      uuids: [],
    };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return { error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`, ok: false };
  }

  const placeholders = validCodes.map(() => "?").join(", ");

  try {
    // As LINHAS de assinatura do escopo — a MESMA consulta do painel interno (filtro de envio
    // incluído), escopada por código e com o ar_id e o uuidDoc a mais, para escolher o envio.
    //
    // ⚠️ `contract_signature_signers` entra por LEFT JOIN (diferença deliberada do painel
    // interno): envio válido sem nenhum assinante precisa aparecer — com join interno ele some,
    // cai no KPI errado e contradiz a aba Contratos (ver o cabeçalho). O `signer_id` nulo é o
    // marcador dessas linhas vazias.
    const [linhaRows] = await poolResult.pool.query<LinhaRow[]>(
      `select
         e.code as emp,
         coalesce(nullif(trim(u.name), ''), concat(e.code, u.block, u.lot)) as unidade,
         u.block as quadra, u.lot, u.price as valor,
         cs.id as id_ass,
         ar.id as ar_id,
         nullif(trim(cs.uuidDoc), '') as uuid_doc,
         cs.contract_signature_status_id as status_c2x,
         date_format(cs.created_at, '%Y-%m-%d') as envio,
         datediff(now(), cs.created_at) as dias_envio,
         ss.id as signer_id,
         ss.user_name as usuario,
         ss.email,
         pf.name as perfil_c2x,
         usr.id as usuario_c2x_id,
       -- O PAPEL DO ASSINANTE NO CADASTRO DO EMPREENDIMENTO, que vence o perfil generico do usuario.
       -- E o que resolve o coordenador cadastrado como "Imobiliaria" (o caso do Huber, apontado pelo
       -- Lucas duas vezes: em 18/08 no painel interno e de novo no portal, porque a primeira correcao
       -- so alcancou UM dos tres leitores).
       -- Sem crase neste comentario: ele vive dentro de um template literal e uma crase solta encerra
       -- a string e quebra o arquivo inteiro.
       case
         when usr.id is not null and usr.id = e.coordenador_id then 'coordenador'
         when usr.id is not null and usr.id = e.manager_id then 'gerente'
         when usr.id is not null and usr.id = e.captivator_id then 'captador'
         else null
       end as papel_no_empreendimento,
         ss.signed as assinado,
         date_format(ss.date_signed, '%Y-%m-%d') as data_assinatura,
         ss.after_position as posicao
       from contract_signatures cs
       join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
       join acquisition_requests ar on ar.id = arc.acquisition_request_id
       join enterprise_unities u on u.id = ar.enterprise_unity_id
       join enterprises e on e.id = u.enterprise_id
       left join contract_signature_signers ss on ss.contract_signature_id = cs.id
       left join contract_signers csg on csg.id = ss.contract_signer_id
       left join signers sg on sg.id = csg.signer_id
       left join users usr on usr.id = sg.user_id
       left join profiles pf on pf.id = usr.profile_id
       where e.code in (${placeholders})
         and cs.send_document_signature = 1
         and cs.contract_signature_status_id <> 6
       order by e.code, u.block, u.lot, ss.after_position, ss.id`,
      validCodes,
    );

    // Os contratos VIVOS do escopo — a MESMA leitura que servia a visão Contratos, agora
    // compartilhada (`lerContratosVivos`, contratos.ts). Ela traz, além da data de geração, o que
    // a linha da lista pendura: valor, imobiliária, faturamento e o unitId do botão de PDF.
    const brutos = await lerContratosVivos(poolResult.pool, validCodes);

    // Por contrato, UM envio: o com uuidDoc, senão o de maior id (regra do estudo, reusada).
    const enviosPorAr = new Map<number, EnvioDeAssinatura[]>();
    // O status do C2X por envio: é ele que vira a divergência de status na reconciliação. Sem ele
    // a discordância existe e fica muda ("o D4Sign fechou e o C2X nao soube" some do contador).
    const statusPorEnvio = new Map<number, null | number>();
    for (const row of linhaRows) {
      const arId = Number(row.ar_id);
      statusPorEnvio.set(Number(row.id_ass), row.status_c2x ?? null);
      const lista = enviosPorAr.get(arId) ?? [];
      if (!lista.some((envio) => envio.csId === Number(row.id_ass))) {
        lista.push({
          arId,
          csId: Number(row.id_ass),
          linhas: 0,
          linhasAssinadas: 0,
          uuidDoc: row.uuid_doc,
        });
      }
      enviosPorAr.set(arId, lista);
    }
    const enviosEscolhidos = new Set<number>();
    const arPorEnvio = new Map<number, number>();
    // O PDF do fim da linha existe quando o envio ESCOLHIDO tem uuidDoc — a mesma régua do
    // `temContrato` da visão antiga, sobre o mesmo conjunto de envios.
    const temContratoPorAr = new Map<number, boolean>();
    // Os envios que vão ser conferidos na D4Sign: um por contrato, o mesmo que a tela mostra.
    const paraD4Sign: EnvioParaConciliar[] = [];
    for (const [arId, envios] of enviosPorAr) {
      const escolhido = escolherEnvio(envios);
      if (escolhido) {
        enviosEscolhidos.add(escolhido.csId);
        arPorEnvio.set(escolhido.csId, arId);
        temContratoPorAr.set(arId, Boolean(escolhido.uuidDoc));
        paraD4Sign.push({
          csId: escolhido.csId,
          statusC2x: statusPorEnvio.get(escolhido.csId) ?? null,
          uuidDoc: escolhido.uuidDoc,
        });
      }
    }

    // Envio escolhido SEM nenhuma linha de assinante: o LEFT JOIN devolve exatamente uma linha
    // vazia (signer_id nulo). Ele já conta em `arPorEnvio` (sai do KPI de emissão) e entra na
    // lista como "sem assinante registrado".
    const semAssinante: EnvioSemAssinante[] = linhaRows
      .filter((row) => row.signer_id === null && enviosEscolhidos.has(Number(row.id_ass)))
      .map((row) => ({
        csId: Number(row.id_ass),
        emp: String(row.emp ?? ""),
        enviadoEm: String(row.envio ?? ""),
        un: limpo(row.unidade),
      }));

    const linhas: LinhaAssinatura[] = linhaRows
      .filter((row) => row.signer_id !== null && enviosEscolhidos.has(Number(row.id_ass)))
      .map((row) => {
        const email = String(row.email ?? "").trim().toLowerCase();
        return {
          assinadoEm: row.data_assinatura,
          assinou: Number(row.assinado) === 1,
          contrato: Number(row.id_ass),
          degrau: Number(row.posicao ?? 0),
          diasDesdeEnvio: Number(row.dias_envio ?? 0),
          email,
          emp: String(row.emp ?? ""),
          envio: String(row.envio ?? ""),
          lote: limpo(row.lot),
          perfil: perfilDeTela(
            row.perfil_c2x,
            email,
            row.papel_no_empreendimento,
            row.usuario_c2x_id,
          ),
          // O prazo de comprador é recalculado dentro de `montarQuadroDeAssinaturas`, com a régua
          // importada: assim os testes da montagem não dependem deste campo vir preenchido.
          prazo: null,
          quadra: limpo(row.quadra),
          // Preenchido por `marcarSituacao` dentro de `montarQuadroDeAssinaturas`.
          situacao: "aguardando",
          un: limpo(row.unidade),
          usuario: limpo(row.usuario),
          valor: Math.round(Number(row.valor ?? 0)),
        };
      });

    const vivos: ContratoVivo[] = brutos.map((bruto) => ({
      arId: bruto.arId,
      ficha: {
        comprador: bruto.comprador,
        empreendimento: bruto.enterpriseCode,
        faturadoEm: bruto.faturadoEm,
        imobiliaria: bruto.imobiliaria,
        temContrato: temContratoPorAr.get(bruto.arId) ?? false,
        unidade: rotuloDoVivo(bruto),
        unitId: bruto.unitId,
        valorTabela: bruto.valorTabela,
      },
      geradoEm: isoOuNulo(bruto.geradoEm),
    }));

    // ⚠️ A D4SIGN MANDA NO STATUS DAQUI PARA BAIXO. A troca é `montarQuadroComD4Sign` no lugar de
    // `montarQuadroDeAssinaturas`: as linhas entram corrigidas, o documento que a D4Sign diz
    // cancelado sai da conta (e a venda volta a "aguardando emissão") e cada linha volta sabendo
    // de onde veio. Com a fonte fora do ar, degrada para o C2X com aviso — nunca tela vazia.
    return {
      data: await montarQuadroComD4Sign({
        arPorEnvio,
        envios: paraD4Sign,
        linhas,
        // Ver o comentário gêmeo em lib/apolo/assinaturas/painel-contratos.ts: a tela não espera
        // a D4Sign, e o aquecimento roda no `after()` da rota, depois da resposta.
        opcoes: { semEsperar: true },
        semAssinante,
        vivos,
      }),
      uuids: paraD4Sign.map((envio) => envio.uuidDoc ?? "").filter((uuid) => uuid.length > 0),
      ok: true,
    };
  } catch (error) {
    console.error("[incorporador][assinaturas] falha ao ler o C2X", error);
    return { error: "Não foi possível ler as assinaturas agora.", ok: false };
  }
}

function limpo(valor: unknown): string {
  return String(valor ?? "").trim().replace(/\s+/g, " ");
}

/**
 * O rótulo da unidade de um contrato vivo, na MESMA régua da consulta de linhas
 * (`coalesce(nullif(trim(u.name), ''), concat(e.code, u.block, u.lot))`).
 *
 * ⚠️ NÃO usa o `rotuloDaUnidade` compacto de contratos.ts (VALB0218): as duas leituras agora
 * dividem a mesma lista, e trocar de régua no meio dela faria a mesma unidade aparecer com dois
 * nomes conforme tivesse saído para assinar ou não.
 */
function rotuloDoVivo(bruto: ContratoBruto): string {
  return (
    limpo(bruto.unitName) ||
    limpo(`${bruto.enterpriseCode}${bruto.bloco ?? ""}${bruto.lote ?? ""}`)
  );
}

function isoOuNulo(valor: null | Date | string): null | string {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function arredondar1(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 10) / 10;
}
