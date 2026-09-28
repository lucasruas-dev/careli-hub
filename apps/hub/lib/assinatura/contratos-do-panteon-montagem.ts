import type { SituacaoDaAssinatura, ContratoDoPortal, ContratosDoPortal } from "@/lib/apolo/incorporador/contratos";
import {
  type AssinanteDoQuadro,
  type ContratoVivo,
  type DegrauDaFila,
  type EnvioSemAssinante,
  type KpisDeAssinatura,
  montarQuadroDeAssinaturas,
  type QuadroDeAssinaturas,
  type TaxaDoPerfil,
  type UnidadeDeAssinatura,
} from "@/lib/apolo/incorporador/assinaturas";
import { type LinhaAssinatura, prazoDoComprador } from "@/lib/apolo/painel-assinatura";
import { VENDA_DESFEITA } from "@/lib/hercules/acao-de-cancelamento";
import { terrenosDasUnidades } from "@/lib/hercules/terreno";

import { envelopeVigente } from "./envelope-vigente";
import { diaEmBrasilia } from "./instante";
import { type EstadoDaAssinatura, PAPEIS, type PapelNoContrato, type Provedor } from "./tipos";

// A LEITURA ÚNICA DO CONTRATO, MONTADA — puro, sem banco (F4 da fonte única,
// docs/assinatura/fonte-unica-do-contrato.md, seções 4 e 5).
//
// Lucas, 28/09/2026: *"já cansei de falar que informações de venda, contrato, assinatura tem que
// morar em um local e ele alimentar tudo"*. Até aqui a aba Assinatura do Hércules (e a pílula
// Contratos do portal) lia o C2X, a D4Sign AO VIVO e, por cima, as vendas nativas do Panteon, e
// costurava as três (`unirComOPanteon`). Agora ela lê SÓ o Panteon: as vendas vivas com contrato
// (`temis_contratos_do_panteon`) e os envelopes de contrato dos dois provedores
// (`temis_envelopes_de_contrato`, com a D4Sign espelhada pela F3). Esta folha monta as linhas e o
// quadro a partir do que `contratos-do-panteon.ts` leu.
//
// ⚠️ O QUADRO É O MESMO DE SEMPRE (`montarQuadroDeAssinaturas`, lib/apolo/incorporador/assinaturas.ts):
// a leitura entrega as MESMAS entradas (linhas por pessoa, contratos vivos, envio → proposta, envio
// sem assinante), e as taxas, a fila, os KPIs e o quadro por assinante saem da régua que a tela já
// conhece. Uma segunda montagem aqui seria o terceiro jeito de contar "unidade assinada".
//
// ⚠️ AS DUAS RESPOSTAS DO LUCAS (28/09/2026, seção 9 do plano) MORAM AQUI:
//   1. "Aparecem pelo envelope, sem ler o C2X": o envelope da D4Sign ligado só à UNIDADE (regra
//      `sem_venda` do espelho: venda feita direto no C2X, o Garden, o que a carga não trouxe) vira
//      LINHA também no portal, com o comprador pelos signatários de perfil Comprador. No portal a
//      linha não diz por que não tem venda; na tela interna ela leva `envelope_sem_venda`.
//   2. Contrato de venda desfeita SOME DO PORTAL e fica na tela interna com
//      `contrato_de_venda_desfeita` (o padrão (a) da pergunta 2).

/** Uma linha de `temis_contratos_do_panteon` (0195): a venda viva com contrato, com a unidade. */
export type LinhaDaViewDeContratos = {
  ar_c2x_id: null | number | string;
  cancelamento_pedido_em: null | string;
  cliente_nome: null | string;
  criado_em: null | string;
  data_assinatura: null | string;
  data_ato: null | string;
  data_faturamento: null | string;
  empreendimento_codigo: null | string;
  enterprise_id: null | number | string;
  espelho_de: null | string;
  etapa: null | string;
  etapa_desde: null | string;
  gerado_em: null | string;
  imobiliaria_nome: null | string;
  lote: null | string;
  origem: null | string;
  preco_tabela: null | number | string;
  proposta_id: string;
  quadra: null | string;
  unidade_c2x_id: null | number | string;
  unidade_codigo: null | string;
  unidade_id: string;
  unidade_preco_tabela: null | number | string;
  valor: null | number | string;
};

/** Uma linha de `temis_envelopes_de_contrato` (0195): só `finalidade = 'contrato'`, dos dois provedores. */
export type LinhaDaViewDeEnvelopes = {
  c2x_contract_signature_id: null | number | string;
  conferido_em: null | string;
  criado_em: string;
  envelope_id: null | string;
  enviado_em: null | string;
  estado: string;
  estado_cru: null | string;
  falha: null | string;
  fechado_em: null | string;
  id: string;
  ordenada: boolean | null;
  origem: null | string;
  proposta_id: null | string;
  provedor: string;
  provedor_documento_id: null | string;
  signatarios: unknown;
  unidade_id: null | string;
};

/** Uma unidade lida à parte: a dos envelopes que não caem numa venda viva, e a família dela (terreno). */
export type UnidadeDaLeitura = {
  codigo: null | string;
  enterprise_id: null | number | string;
  espelho_de: null | string;
  id: string;
  lote: null | string;
  origem_c2x_id: null | number | string;
  preco_tabela: null | number | string;
  quadra: null | string;
};

/** A proposta de um envelope que NÃO está na view de contratos (desfeita, ou viva fora dela). */
export type PropostaForaDaLeitura = {
  aberta?: boolean | null;
  cancelada_em: null | string;
  etapa: null | string;
  id: string;
  origem: null | string;
  unidade_id: null | string;
};

/** Tudo o que `contratos-do-panteon.ts` leu, cru. */
export type LinhasDosContratos = {
  /** Proposta nativa → o contrato MAIS RECENTE gerado (`hercules_documentos`). `null` = a leitura falhou. */
  contratoGeradoEm?: null | ReadonlyMap<string, string>;
  contratos: readonly LinhaDaViewDeContratos[];
  /** `hercules_unidades.enterprise_id` → código do cadastro, para a linha sem venda. */
  empreendimentoPorEnterprise: ReadonlyMap<string, string>;
  envelopes: readonly LinhaDaViewDeEnvelopes[];
  propostasForaDaLeitura: readonly PropostaForaDaLeitura[];
  /** `temis_espelho_d4sign.ultima_rodada_ok_em`. Nulo = nunca rodou, ou a leitura falhou. */
  ultimaRodadaOkEm: null | string;
  unidades: readonly UnidadeDaLeitura[];
};

/** Uma pessoa do contrato, pronta para a tela. SEM e-mail: o perfil já foi resolvido aqui dentro. */
export type PessoaDoContrato = {
  /** O instante gravado pela 0195 (ISO em -03:00). Nulo = não assinou, ou o provedor não deu a data. */
  assinadoEm: null | string;
  /** A ordem CRUA do provedor; 0 = sem ordem (todos em paralelo). */
  degrau: number;
  nome: string;
  papel: null | PapelNoContrato;
  perfil: string;
  recusadoEm: null | string;
};

export type EnvelopeDoContrato = {
  c2xContractSignatureId: null | number;
  conferidoEm: null | string;
  criadoEm: string;
  enviadoEm: null | string;
  estado: EstadoDaAssinatura;
  estadoCru: null | string;
  fechadoEm: null | string;
  id: string;
  origem: "c2x" | "panteon";
  pessoas: PessoaDoContrato[];
  provedor: Provedor;
  provedorDocumentoId: null | string;
};

export type AvisoDoContrato =
  | "conferencia_atrasada"
  | "contrato_de_venda_desfeita"
  | "dois_contratos_vivos"
  | "envelope_sem_venda";

export type ContratoDoPanteon = {
  /** INTERNO: nunca atravessa para o portal. */
  avisos: AvisoDoContrato[];
  envelope: EnvelopeDoContrato | null;
  /**
   * INTERNO. A linha aparece no portal? Não aparece: o contrato de venda desfeita (resposta 2), e a
   * venda "aguardando emissão" cujo terreno tem um envelope sem venda (o contrato dela correu pelo
   * C2X; ver `montarContratosDoPanteon`).
   */
  noPortal: boolean;
  /** INTERNO: os outros envelopes vivos da mesma venda (o aviso de dois contratos). */
  outrosVivos: EnvelopeDoContrato[];
  proposta: null | {
    arC2xId: null | number;
    clienteNome: null | string;
    criadoEm: null | string;
    dataAssinatura: null | string;
    dataAto: null | string;
    dataFaturamento: null | string;
    etapa: string;
    geradoEm: null | string;
    id: string;
    imobiliariaNome: null | string;
    origem: "c2x" | "panteon";
    precoTabela: number;
    /** ISO curto do dia em que o contrato voltou para correção sem contrato novo depois (só nativa). */
    voltouParaCorrecaoEm: null | string;
  };
  /** A proposta a que o envelope aponta quando ela NÃO é uma venda viva da leitura (desfeita). */
  propostaDoEnvelope: null | string;
  situacao: SituacaoDaAssinatura;
  unidade: {
    c2xId: null | number;
    codigo: string;
    empreendimento: string;
    enterpriseId: string;
    id: string;
    lote: null | string;
    precoTabela: number;
    quadra: null | string;
    terrenoId: string;
  };
};

/** A volta da Têmis para correção cancela o envelope com este carimbo (retorno-para-correcao.ts). */
const CARIMBO_DA_VOLTA = "panteon:retorno_para_correcao";

/** A campainha: a última rodada boa do espelho há mais que isto, e o recorte tem D4Sign. */
const ATRASO_DA_CONFERENCIA_MS = 2 * 60 * 60 * 1000;

const ESTADOS: ReadonlySet<string> = new Set([
  "aguardando",
  "assinado",
  "cancelado",
  "desconhecido",
  "expirado",
  "parcial",
  "rascunho",
  "recusado",
]);

function limpo(valor: unknown): string {
  return String(valor ?? "").trim().replace(/\s+/g, " ");
}

function textoOuNulo(valor: unknown): null | string {
  const t = limpo(valor);
  return t ? t : null;
}

function numero(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number(String(valor ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function inteiroOuNulo(valor: unknown): null | number {
  if (valor === null || valor === undefined || limpo(valor) === "") return null;
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function instante(valor: null | string | undefined): number {
  const t = limpo(valor);
  const n = t ? Date.parse(t) : Number.NaN;
  return Number.isNaN(n) ? Number.NEGATIVE_INFINITY : n;
}

/** Um primo abaixo de 2^48: o resto cabe inteiro num `number` e `resto * 16` não passa de 2^53. */
const PRIMO_DA_CHAVE = 281_474_976_710_597;

/**
 * A chave NUMÉRICA de um uuid, para os campos da tela que sempre foram número (`envioId`, `arId`).
 *
 * ⚠️ NEGATIVA DE PROPÓSITO: `contract_signatures.id` e `acquisition_requests.id` do C2X são
 * positivos, e a linha da Clicksign ao lado de uma da D4Sign não pode colidir com ela.
 *
 * ⚠️ O UUID INTEIRO ENTRA NA CONTA (resto de uma divisão por um primo de 48 bits), e não um pedaço
 * dele: um pedaço fixo (os 12 primeiros hexadecimais) repete entre uuids que só diferem no fim, e
 * duas vendas com a mesma chave viravam UMA no quadro (o `arId` casa envio com venda).
 */
export function chaveNumerica(uuid: string): number {
  const hex = String(uuid ?? "").replace(/[^0-9a-f]/gi, "").toLowerCase();
  let resto = 0;
  for (const digito of hex) resto = (resto * 16 + Number.parseInt(digito, 16)) % PRIMO_DA_CHAVE;
  return resto > 0 ? -resto : -1;
}

/**
 * O PERFIL DE TELA de uma pessoa do quadro.
 *
 * ⚠️ NA LINHA DA TÊMIS O PAPEL VENCE O E-MAIL (plano, seção 5, Regressão M2). A coordenadora de
 * venda assina com e-mail `@careli.adm.br` e, pela régua do e-mail, viraria "Backoffice": o papel
 * congelado no envio diz quem ela é. Os rótulos são os que a lista já usa para o legado
 * (`perfilDeTela`), porque a lista mistura as duas origens: dois nomes para o mesmo papel abririam
 * duas barras e dois filtros para a mesma pessoa.
 *
 * ⚠️ NA LINHA DA D4SIGN O PERFIL JÁ VEM GRAVADO pelo espelho (`perfilDeTela`, com a exceção do Huber e
 * o papel no cadastro do empreendimento): nada se recalcula aqui. Sem ele, só o e-mail da casa.
 */
export function perfilDaPessoa(item: {
  email?: null | string;
  origem: "c2x" | "panteon";
  papel?: null | string;
  perfil?: null | string;
}): string {
  const email = limpo(item.email).toLowerCase();
  if (item.origem === "panteon") {
    const papel = limpo(item.papel).toLowerCase();
    const doPapel: Record<string, string> = {
      careli: "Backoffice",
      comprador: "Comprador",
      conjuge: "Comprador",
      coordenadora: "Coordenadora de venda",
      corretor: "Imobiliária",
      testemunha: "Testemunha",
      vendedora: "Incorporador",
    };
    if (doPapel[papel]) return doPapel[papel] as string;
  }
  const gravado = limpo(item.perfil);
  if (gravado) return gravado;
  if (email.endsWith("@careli.adm.br")) return "Backoffice";
  return "Sem perfil";
}

function papelOuNulo(valor: unknown): null | PapelNoContrato {
  const papel = limpo(valor).toLowerCase();
  return (PAPEIS as string[]).includes(papel) ? (papel as PapelNoContrato) : null;
}

/** As pessoas do quadro gravado (0195), na ordem do quadro. E-mail entra só na régua do perfil. */
function pessoasDoQuadro(linha: LinhaDaViewDeEnvelopes, origem: "c2x" | "panteon"): PessoaDoContrato[] {
  if (!Array.isArray(linha.signatarios)) return [];
  // ⚠️ SEM ORDEM, DEGRAU 0 (a convenção da tela: todos em paralelo). Na Clicksign é `ordenada =
  // false`; na D4Sign vale a posição crua do C2X, e posição ausente é 0. Sem renumerar: renumerar
  // misturava papéis no mesmo degrau quando faltava um passo (plano, seção 5, `degrau`).
  const semOrdem = linha.provedor === "clicksign" && linha.ordenada === false;
  return linha.signatarios
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const ordem = Number(item.ordem);
      return {
        assinadoEm: textoOuNulo(item.assinado_em),
        degrau: semOrdem || !Number.isFinite(ordem) || ordem < 0 ? 0 : Math.trunc(ordem),
        nome: limpo(item.nome),
        papel: papelOuNulo(item.papel),
        perfil: perfilDaPessoa({
          email: typeof item.email === "string" ? item.email : null,
          origem,
          papel: typeof item.papel === "string" ? item.papel : null,
          perfil: typeof item.perfil === "string" ? item.perfil : null,
        }),
        recusadoEm: textoOuNulo(item.recusado_em),
      };
    });
}

function envelopeDoContrato(linha: LinhaDaViewDeEnvelopes): EnvelopeDoContrato {
  const origem = linha.origem === "c2x" ? "c2x" : "panteon";
  return {
    c2xContractSignatureId: inteiroOuNulo(linha.c2x_contract_signature_id),
    conferidoEm: textoOuNulo(linha.conferido_em),
    criadoEm: linha.criado_em,
    enviadoEm: textoOuNulo(linha.enviado_em),
    estado: (ESTADOS.has(linha.estado) ? linha.estado : "desconhecido") as EstadoDaAssinatura,
    estadoCru: textoOuNulo(linha.estado_cru),
    fechadoEm: textoOuNulo(linha.fechado_em),
    id: linha.id,
    origem,
    pessoas: pessoasDoQuadro(linha, origem),
    provedor: linha.provedor === "d4sign" ? "d4sign" : "clicksign",
    provedorDocumentoId: textoOuNulo(linha.provedor_documento_id),
  };
}

/**
 * A situação da linha, na régua da lista: sem envelope vigente, "aguardando emissão"; o documento
 * assinado, ou todas as pessoas com `assinado_em`, "assinado"; o resto, "em assinatura".
 *
 * ⚠️ `data_assinatura` DA VENDA NÃO FAZ A LINHA "ASSINADA". A linha é o CONTRATO, e o contrato
 * assinado é o envelope; é a mesma régua do legado (a D4Sign manda), e a venda nativa só ganha
 * `data_assinatura` quando o envelope fecha (F2). Uma venda da carga com a data e sem o envio
 * espelhado continua "aguardando emissão", como o portal a mostrava.
 */
function situacaoDoEnvelope(envelope: EnvelopeDoContrato | null): SituacaoDaAssinatura {
  if (!envelope) return "aguardando-emissao";
  if (envelope.estado === "assinado") return "assinado";
  if (envelope.pessoas.length > 0 && envelope.pessoas.every((p) => Boolean(p.assinadoEm))) return "assinado";
  return "em-assinatura";
}

function conferenciaAtrasada(ultimaRodadaOkEm: null | string, agora: Date): boolean {
  const ultima = instante(ultimaRodadaOkEm);
  return !Number.isFinite(ultima) || agora.getTime() - ultima > ATRASO_DA_CONFERENCIA_MS;
}

/** As etapas com contrato da view (`temis_contratos_do_panteon`). */
const ETAPAS_DA_VIEW: ReadonlySet<string> = new Set(["assinatura", "contrato", "faturado"]);

/** A proposta passaria pelo filtro da view, fora a regra da sombra? */
function vivaNaView(p: PropostaForaDaLeitura): boolean {
  return ETAPAS_DA_VIEW.has(limpo(p.etapa)) && p.aberta !== false && !limpo(p.cancelada_em);
}

/** A proposta da CARGA pendurada numa linha-sombra do pai (a que a view tira). */
function daSombraDaCarga(p: PropostaForaDaLeitura, unidades: ReadonlyMap<string, UnidadeDaLeitura>): boolean {
  const unidade = unidades.get(limpo(p.unidade_id));
  return limpo(p.origem) === "c2x" && Boolean(unidade && limpo(unidade.espelho_de));
}

type Vigencia = { avisos: AvisoDoContrato[]; envelope: EnvelopeDoContrato | null; outrosVivos: EnvelopeDoContrato[] };

/**
 * A régua única (`envelopeVigente`, F2) sobre as linhas de um grupo, com os avisos dela.
 *
 * @param grupo `"venda"`: o grupo é UMA venda, e o assinado vence o vivo mais novo (a régua da F2).
 *   `"unidade"`: o grupo é a UNIDADE de envelopes sem venda, e vale o vivo MAIS RECENTE.
 *
 * ⚠️ POR QUE A UNIDADE NÃO USA "O ASSINADO VENCE" (revisão da F4, 28/09/2026). O envelope sem venda não
 * sabe de que pedido do C2X ele é (o espelho não grava o AR), e a unidade junta os contratos de TODOS
 * os compradores dela. Revenda é comum (947 unidades com uma proposta desfeita e outra viva, SELECT
 * de 28/09), e o Garden inteiro vive sem venda no Panteon: com "o assinado vence", o contrato
 * ASSINADO do comprador anterior virava a linha, e o contrato em assinatura do comprador ATUAL caía
 * em `outrosVivos` (interno) e sumia do portal. O leitor antigo guardava um envio por pedido. Sem o
 * pedido, o mais recente é o do comprador de agora; o anterior fica em `outrosVivos`, com o aviso
 * interno de dois contratos. O custo aceito: o reenvio de um contrato já assinado do MESMO pedido
 * (raro) mostra o reenvio, e não o assinado.
 */
function vigenciaDe(
  linhas: readonly LinhaDaViewDeEnvelopes[],
  ultimaRodadaOkEm: null | string,
  agora: Date,
  grupo: "unidade" | "venda" = "venda",
): Vigencia {
  const regua = envelopeVigente(linhas);
  const vigente = grupo === "unidade" ? (regua.vivos[0] ?? null) : regua.vigente;
  const envelope = vigente ? envelopeDoContrato(vigente) : null;
  const outrosVivos = regua.vivos.filter((l) => l !== vigente).map(envelopeDoContrato);
  const avisos: AvisoDoContrato[] = [];
  if (regua.doisContratosVivos) avisos.push("dois_contratos_vivos");
  if (envelope?.provedor === "d4sign" && conferenciaAtrasada(ultimaRodadaOkEm, agora)) {
    avisos.push("conferencia_atrasada");
  }
  return { avisos, envelope, outrosVivos };
}

/**
 * Monta um contrato por VENDA VIVA da view, mais as linhas que só o envelope sustenta.
 *
 *   • venda viva (view): o envelope vigente dela, pela régua única (`envelopeVigente`);
 *   • envelope sem venda (`proposta_id` nulo, ou proposta viva que a view não traz, como a da carga
 *     pendurada no pai): UMA linha por UNIDADE, com o vivo MAIS RECENTE dela (resposta 1; o porquê de
 *     não ser "o assinado vence" está em `vigenciaDe`);
 *   • envelope de venda desfeita (cancelada ou em distrato): UMA linha por proposta, só na tela
 *     interna (resposta 2);
 *   • grupo sem nenhum envelope vigente (todos cancelados): não vira linha.
 *
 * ⚠️ UM TERRENO, UMA LINHA NO PORTAL, QUANDO O CONTRATO DA VENDA CORREU PELO C2X. É a regra que a
 * v1.389.0 já fazia no caminho antigo (`unirComOPanteon`): a venda nativa "aguardando emissão" foi
 * redigitada no C2X e o contrato saiu de lá, num envio que o espelho não ligou a ela (o comprador não
 * bateu, por exemplo). No portal fica a linha do envelope, que diz o que aconteceu com o contrato; a
 * da venda some de lá, UMA por envelope, e continua na tela interna. Se a venda tem envelope próprio,
 * ficam as duas: são dois contratos de verdade.
 *
 * ⚠️ SÓ QUANDO O ENVIO É DEPOIS DA VENDA (revisão da F4, 28/09/2026). A redigitação vem DEPOIS da venda
 * nativa (a venda nasce no Panteon e é redigitada para gerar boleto), então o envio dela também. O
 * contrato de um comprador ANTERIOR da unidade revendida (o Garden, onde a venda nova da Cecília
 * esperava emissão ao lado do contrato antigo de outra pessoa) é de antes da venda nova e não a tira
 * do portal. Venda sem data de criação não sai: esconder venda por palpite é pior que duas linhas.
 */
export function montarContratosDoPanteon(linhas: LinhasDosContratos, agora: Date): ContratoDoPanteon[] {
  const idsDasVendas = new Set(linhas.contratos.map((c) => c.proposta_id));
  const foraPorId = new Map(linhas.propostasForaDaLeitura.map((p) => [p.id, p]));
  const unidadePorId = new Map(linhas.unidades.map((u) => [u.id, u]));

  const daVenda = new Map<string, LinhaDaViewDeEnvelopes[]>();
  const daDesfeita = new Map<string, LinhaDaViewDeEnvelopes[]>();
  const semVenda = new Map<string, LinhaDaViewDeEnvelopes[]>();
  const juntar = (mapa: Map<string, LinhaDaViewDeEnvelopes[]>, chave: string, linha: LinhaDaViewDeEnvelopes) =>
    mapa.set(chave, [...(mapa.get(chave) ?? []), linha]);

  for (const envelope of linhas.envelopes) {
    const propostaId = limpo(envelope.proposta_id);
    if (propostaId && idsDasVendas.has(propostaId)) {
      juntar(daVenda, propostaId, envelope);
      continue;
    }
    const fora = propostaId ? foraPorId.get(propostaId) : undefined;
    if (fora && (VENDA_DESFEITA.has(limpo(fora.etapa)) || limpo(fora.cancelada_em))) {
      juntar(daDesfeita, propostaId, envelope);
      continue;
    }
    // ⚠️ VENDA VIVA COM CONTRATO QUE A VIEW TRAZ, MAS FORA DESTE RECORTE: a linha é dela, no recorte
    // dela (o envelope da reserva no pai, ligado pela regra 2 à venda do filho, não vira "sem venda"
    // no recorte do pai). A exceção é a proposta DA CARGA pendurada na sombra do pai, que a view tira
    // de propósito: o envelope dela não tem outra casa, e aparece pela unidade.
    if (fora && vivaNaView(fora) && !daSombraDaCarga(fora, unidadePorId)) continue;
    // Sem venda: `proposta_id` nulo, a proposta da carga na sombra do pai, ou proposta que não se
    // achou. A unidade é a do envelope, senão a da proposta.
    const unidadeId = limpo(envelope.unidade_id) || limpo(fora?.unidade_id);
    if (unidadeId) juntar(semVenda, unidadeId, envelope);
  }

  // O TERRENO: a união da régua (lib/hercules/terreno.ts) sobre as linhas que a leitura conhece (as
  // unidades das vendas, que a view traz inteiras, e as lidas à parte com a família delas).
  const linhasDoTerreno = new Map<string, { enterprise_id: string; espelho_de: null | string; id: string; lote: null | string; quadra: null | string }>();
  for (const c of linhas.contratos) {
    linhasDoTerreno.set(c.unidade_id, {
      enterprise_id: limpo(c.enterprise_id),
      espelho_de: textoOuNulo(c.espelho_de),
      id: c.unidade_id,
      lote: c.lote,
      quadra: c.quadra,
    });
  }
  for (const u of linhas.unidades) {
    if (linhasDoTerreno.has(u.id)) continue;
    linhasDoTerreno.set(u.id, {
      enterprise_id: limpo(u.enterprise_id),
      espelho_de: textoOuNulo(u.espelho_de),
      id: u.id,
      lote: u.lote,
      quadra: u.quadra,
    });
  }
  const terrenoDe = terrenosDasUnidades(linhasDoTerreno.values());
  const terreno = (unidadeId: string) => terrenoDe.get(unidadeId) ?? `terreno:${unidadeId}`;

  const saida: ContratoDoPanteon[] = [];

  for (const c of linhas.contratos) {
    const doContrato = daVenda.get(c.proposta_id) ?? [];
    const { avisos, envelope, outrosVivos } = vigenciaDe(doContrato, linhas.ultimaRodadaOkEm, agora);
    const origem = limpo(c.origem) === "c2x" ? "c2x" : "panteon";

    // ⚠️ "GERADO EM" É O CONTRATO, NÃO A ETAPA (v1.390.0, print da VOC0306 do Lucas). Na nativa, o
    // documento de contrato MAIS RECENTE (`hercules_documentos`); a volta para correção devolve a
    // venda à etapa `contrato` e a primeira passagem ficaria com o contrato cancelado. E se a última
    // coisa que aconteceu foi a volta (envelope cancelado pela Têmis, sem contrato novo depois), a
    // linha diz isso.
    const maisRecente = [...doContrato].sort((a, b) => instante(b.criado_em) - instante(a.criado_em))[0];
    const voltaEm =
      !envelope && maisRecente && maisRecente.estado === "cancelado" && limpo(maisRecente.estado_cru) === CARIMBO_DA_VOLTA
        ? textoOuNulo(maisRecente.fechado_em)
        : null;
    //
    // ⚠️ NA NATIVA COM O MAPA LIDO, SEM DOCUMENTO É NULO (a régua da v1.390.0, "sem contrato, nulo"):
    // a entrada na etapa não é contrato gerado. Só com o mapa FORA DO AR (`null`) a primeira passagem
    // para `contrato` da view entra, para a linha não perder a data por uma leitura acessória.
    //
    // ⚠️ NA VENDA DA CARGA, A DATA É A PRIMEIRA PASSAGEM PARA `contrato` (a view). Antes vinha do
    // histórico do C2X, que a leitura única não lê mais; a carga só tem essa passagem em parte das
    // vendas (395 de 2.464 vivas com contrato, SELECT de 28/09). É diferença DECLARADA: o ensaio de
    // paridade conta quantas linhas perdem "gerado em" e o tempo médio dos dois lados, e o Zeus leva
    // ao Lucas antes do deploy.
    const mapaLido = origem === "panteon" && linhas.contratoGeradoEm != null;
    const documentoMaisRecente = mapaLido ? (linhas.contratoGeradoEm?.get(c.proposta_id) ?? null) : null;
    const refeito = voltaEm !== null && documentoMaisRecente !== null && instante(documentoMaisRecente) > instante(voltaEm);
    const voltouParaCorrecaoEm = voltaEm && !refeito ? diaEmBrasilia(voltaEm) : null;
    const geradoEm = voltouParaCorrecaoEm ? null : mapaLido ? documentoMaisRecente : textoOuNulo(c.gerado_em);

    saida.push({
      avisos,
      envelope,
      noPortal: true,
      outrosVivos,
      proposta: {
        arC2xId: origem === "c2x" ? inteiroOuNulo(c.ar_c2x_id) : null,
        clienteNome: textoOuNulo(c.cliente_nome),
        criadoEm: textoOuNulo(c.criado_em),
        dataAssinatura: textoOuNulo(c.data_assinatura),
        dataAto: textoOuNulo(c.data_ato),
        dataFaturamento: textoOuNulo(c.data_faturamento),
        etapa: limpo(c.etapa),
        geradoEm,
        id: c.proposta_id,
        imobiliariaNome: textoOuNulo(c.imobiliaria_nome),
        origem,
        precoTabela: numero(c.preco_tabela ?? c.unidade_preco_tabela ?? c.valor),
        voltouParaCorrecaoEm,
      },
      propostaDoEnvelope: null,
      situacao: situacaoDoEnvelope(envelope),
      unidade: {
        c2xId: inteiroOuNulo(c.unidade_c2x_id),
        codigo: limpo(c.unidade_codigo),
        empreendimento: limpo(c.empreendimento_codigo).toUpperCase(),
        enterpriseId: limpo(c.enterprise_id),
        id: c.unidade_id,
        lote: textoOuNulo(c.lote),
        precoTabela: numero(c.unidade_preco_tabela),
        quadra: textoOuNulo(c.quadra),
        terrenoId: terreno(c.unidade_id),
      },
    });
  }

  const unidadeDaLinha = (u: UnidadeDaLeitura) => ({
    c2xId: inteiroOuNulo(u.origem_c2x_id),
    codigo: limpo(u.codigo),
    empreendimento: (linhas.empreendimentoPorEnterprise.get(limpo(u.enterprise_id)) ?? "").toUpperCase(),
    enterpriseId: limpo(u.enterprise_id),
    id: u.id,
    lote: textoOuNulo(u.lote),
    precoTabela: numero(u.preco_tabela),
    quadra: textoOuNulo(u.quadra),
    terrenoId: terreno(u.id),
  });

  // A resposta 2: o contrato de venda desfeita, só na tela interna.
  for (const [propostaId, doContrato] of daDesfeita) {
    const { avisos, envelope, outrosVivos } = vigenciaDe(doContrato, linhas.ultimaRodadaOkEm, agora);
    if (!envelope) continue;
    const unidadeId = limpo(doContrato[0]?.unidade_id) || limpo(foraPorId.get(propostaId)?.unidade_id);
    const unidade = unidadePorId.get(unidadeId);
    if (!unidade) continue;
    saida.push({
      avisos: ["contrato_de_venda_desfeita", ...avisos],
      envelope,
      noPortal: false,
      outrosVivos,
      proposta: null,
      propostaDoEnvelope: propostaId,
      situacao: situacaoDoEnvelope(envelope),
      unidade: unidadeDaLinha(unidade),
    });
  }

  // A resposta 1: o envelope sem venda, uma linha por unidade, também no portal.
  const aguardandoPorTerreno = new Map<string, ContratoDoPanteon[]>();
  for (const linha of saida) {
    if (linha.proposta && linha.situacao === "aguardando-emissao") {
      const lista = aguardandoPorTerreno.get(linha.unidade.terrenoId) ?? [];
      lista.push(linha);
      aguardandoPorTerreno.set(linha.unidade.terrenoId, lista);
    }
  }
  for (const [unidadeId, doEnvelope] of semVenda) {
    const { avisos, envelope, outrosVivos } = vigenciaDe(doEnvelope, linhas.ultimaRodadaOkEm, agora, "unidade");
    if (!envelope) continue;
    const unidade = unidadePorId.get(unidadeId);
    if (!unidade) continue;
    const linha: ContratoDoPanteon = {
      avisos: ["envelope_sem_venda", ...avisos],
      envelope,
      noPortal: true,
      outrosVivos,
      proposta: null,
      propostaDoEnvelope: null,
      situacao: situacaoDoEnvelope(envelope),
      unidade: unidadeDaLinha(unidade),
    };
    // A venda criada ATÉ o envio (a mais recente delas): a redigitação é depois da venda.
    const envio = instante(envelope.enviadoEm ?? envelope.criadoEm);
    const substituida = (aguardandoPorTerreno.get(linha.unidade.terrenoId) ?? [])
      .filter((v) => v.noPortal && Number.isFinite(instante(v.proposta?.criadoEm)) && instante(v.proposta?.criadoEm) <= envio)
      .sort((a, b) => instante(b.proposta?.criadoEm) - instante(a.proposta?.criadoEm))[0];
    if (substituida) substituida.noPortal = false;
    saida.push(linha);
  }

  return saida;
}

/** O total por situação e o faturado, contados ANTES do teto da lista (Regressão M1). */
export type TotaisDeContratos = {
  aguardandoEmissao: number;
  assinados: number;
  contratos: number;
  emAssinatura: number;
  faturados: number;
};

export type TotaisDoQuadro = TotaisDeContratos & {
  porEmpreendimento: Array<TotaisDeContratos & { empreendimento: string }>;
};

/** O quadro da leitura única: o de sempre, mais os totais do recorte inteiro. */
export type QuadroDoPanteon = QuadroDeAssinaturas & {
  /** Sempre `false`: não há reconciliação ao vivo para esperar (a D4Sign é espelhada pela F3). */
  conciliando: false;
  totais: TotaisDoQuadro;
};

function totaisZerados(): TotaisDeContratos {
  return { aguardandoEmissao: 0, assinados: 0, contratos: 0, emAssinatura: 0, faturados: 0 };
}

function somarNoTotal(totais: TotaisDeContratos, contrato: ContratoDoPanteon): void {
  totais.contratos += 1;
  if (contrato.situacao === "assinado") totais.assinados += 1;
  else if (contrato.situacao === "em-assinatura") totais.emAssinatura += 1;
  else totais.aguardandoEmissao += 1;
  if (contrato.proposta?.dataFaturamento) totais.faturados += 1;
}

/** O texto interno de cada aviso (tela do time; o portal nunca recebe). */
const TEXTO_DO_AVISO: Record<AvisoDoContrato, string> = {
  conferencia_atrasada: "A conferência com a D4Sign está atrasada: o espelho não completa uma rodada há mais de 2 horas.",
  contrato_de_venda_desfeita: "Contrato de venda desfeita: o documento ainda está no provedor de assinatura.",
  dois_contratos_vivos: "Dois contratos em assinatura para a mesma venda.",
  envelope_sem_venda: "Venda fora do Panteon: o contrato está ligado só à unidade.",
};

const AVISO_DA_FONTE_INTERNO =
  "A conferência com a D4Sign está atrasada (a última rodada boa do espelho tem mais de 2 horas). As assinaturas mais recentes podem não aparecer ainda.";

/** Dias inteiros entre dois dias ISO curtos (a régua de `diasEntre` do quadro). */
function diasEntreDias(de: string, ate: string): number {
  const a = Date.parse(`${de}T12:00:00Z`);
  const b = Date.parse(`${ate}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * O QUADRO DAS TELAS a partir dos contratos: as mesmas entradas de `montarQuadroDeAssinaturas`.
 *
 *   • `envioId`: D4Sign, o `contract_signatures.id` do C2X (o mesmo número de antes); Clicksign,
 *     `chaveNumerica(id)` (negativa, não colide);
 *   • `arId` da venda: carga, o `ar_c2x_id`; nativa, `chaveNumerica(proposta)`; envelope sem venda,
 *     `chaveNumerica(envelope)`. O contrato de venda desfeita NÃO é contrato vivo (a linha vem sem
 *     dados de contrato, como o legado fazia com o envio de proposta que não é a viva);
 *   • quem assinou: `assinado_em` da pessoa, OU o documento assinado (a D4Sign fechada sem a data
 *     de alguém conta a pessoa como assinada, com a data nula).
 *
 * `interno: false` (o portal) leva só as linhas `noPortal`; `interno: true` leva todas, com o aviso
 * de cada uma e a procedência "panteon".
 */
export function quadroDosContratos(
  contratos: readonly ContratoDoPanteon[],
  opcoes: { agora?: Date; interno: boolean },
): QuadroDoPanteon {
  const agora = opcoes.agora ?? new Date();
  const hoje = diaEmBrasilia(agora.toISOString()) ?? agora.toISOString().slice(0, 10);
  const visiveis = opcoes.interno ? [...contratos] : contratos.filter((c) => c.noPortal);

  const linhas: LinhaAssinatura[] = [];
  const vivos: ContratoVivo[] = [];
  const arPorEnvio = new Map<number, number>();
  const semAssinante: EnvioSemAssinante[] = [];
  const avisosPorEnvio = new Map<number, AvisoDoContrato[]>();
  let atrasada = false;

  const totais = totaisZerados();
  const porEmpreendimento = new Map<string, TotaisDeContratos>();

  for (const contrato of visiveis) {
    somarNoTotal(totais, contrato);
    const emp = contrato.unidade.empreendimento || "-";
    const doEmp = porEmpreendimento.get(emp) ?? totaisZerados();
    somarNoTotal(doEmp, contrato);
    porEmpreendimento.set(emp, doEmp);

    const { envelope, proposta, unidade } = contrato;
    const un = unidade.codigo;
    const temContrato = Boolean(envelope && envelope.provedor === "d4sign" && envelope.provedorDocumentoId);
    const arId = proposta
      ? (proposta.arC2xId ?? chaveNumerica(proposta.id))
      : envelope && !contrato.propostaDoEnvelope
        ? chaveNumerica(envelope.id)
        : null;

    if (arId !== null) {
      vivos.push({
        arId,
        ficha: {
          comprador: proposta?.clienteNome ?? null,
          ...(temContrato && envelope ? { contratoId: envelope.id } : {}),
          empreendimento: unidade.empreendimento,
          faturadoEm: diaEmBrasiliaOuDia(proposta?.dataFaturamento ?? null),
          imobiliaria: proposta?.imobiliariaNome ?? null,
          temContrato,
          unidade: un,
          unitId: unidade.c2xId ?? 0,
          valorTabela: proposta ? proposta.precoTabela : unidade.precoTabela,
          ...(proposta?.voltouParaCorrecaoEm ? { voltouParaCorrecaoEm: proposta.voltouParaCorrecaoEm } : {}),
        },
        geradoEm: proposta?.geradoEm ?? null,
      });
    }

    if (!envelope) continue;
    if (envelope.provedor === "d4sign" && contrato.avisos.includes("conferencia_atrasada")) atrasada = true;

    const envioId = envelope.c2xContractSignatureId ?? chaveNumerica(envelope.id);
    if (arId !== null) arPorEnvio.set(envioId, arId);
    avisosPorEnvio.set(envioId, contrato.avisos);
    const envio = diaEmBrasilia(envelope.enviadoEm ?? envelope.criadoEm) ?? "";
    const diasDesdeEnvio = envio ? diasEntreDias(envio, hoje) : 0;
    const documentoAssinado = envelope.estado === "assinado";

    if (envelope.pessoas.length === 0) {
      semAssinante.push({ csId: envioId, emp: unidade.empreendimento, enviadoEm: envio, un });
      continue;
    }
    for (const pessoa of envelope.pessoas) {
      const assinou = Boolean(pessoa.assinadoEm) || documentoAssinado;
      const assinadoEm = diaEmBrasilia(pessoa.assinadoEm);
      const dias = assinou && assinadoEm && envio ? diasEntreDias(envio, assinadoEm) : diasDesdeEnvio;
      linhas.push({
        assinadoEm,
        assinou,
        contrato: envioId,
        degrau: pessoa.degrau,
        diasDesdeEnvio,
        email: "",
        emp: unidade.empreendimento,
        envio,
        lote: unidade.lote ?? "",
        perfil: pessoa.perfil,
        prazo: prazoDoComprador(pessoa.perfil, assinou, dias),
        quadra: unidade.quadra ?? "",
        situacao: "aguardando",
        un,
        usuario: pessoa.nome,
        valor: proposta ? proposta.precoTabela : unidade.precoTabela,
      });
    }
  }

  const quadro = montarQuadroDeAssinaturas(linhas, vivos, arPorEnvio, semAssinante);

  return {
    ...quadro,
    avisoDaFonte: atrasada ? AVISO_DA_FONTE_INTERNO : null,
    conciliando: false,
    totais: {
      ...totais,
      porEmpreendimento: [...porEmpreendimento.entries()]
        .map(([empreendimento, t]) => ({ ...t, empreendimento }))
        .sort((a, b) => b.contratos - a.contratos || a.empreendimento.localeCompare(b.empreendimento, "pt-BR")),
    },
    unidades: quadro.unidades.map((linha) => {
      const avisos = linha.envioId !== 0 ? (avisosPorEnvio.get(linha.envioId) ?? []) : [];
      return {
        ...linha,
        aviso: opcoes.interno && avisos.length > 0 ? avisos.map((a) => TEXTO_DO_AVISO[a]).join(" ") : null,
        fonte: "panteon" as const,
      };
    }),
  };
}

/** Dia de uma coluna DATE ("2026-09-12") como veio; instante, pelo dia em Brasília. */
function diaEmBrasiliaOuDia(valor: null | string): null | string {
  const t = limpo(valor);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  return diaEmBrasilia(t);
}

/** O texto genérico que o portal recebe no lugar do aviso da fonte (sem nomear sistema nenhum). */
export const AVISO_DE_ATUALIZACAO =
  "Estamos confirmando as assinaturas mais recentes. Alguns contratos podem levar alguns minutos para aparecer atualizados aqui.";

/** O que o portal recebe: a ALLOWLIST da seção 5 do plano, campo a campo. */
export type QuadroDoPortal = {
  assinantes: Array<Pick<AssinanteDoQuadro, "aguardandoAnteriores" | "assinou" | "naVez" | "nome" | "papel">>;
  aviso: null | string;
  avisoDaFonte: null | string;
  avisoDosAssinantes: null;
  conciliando: false;
  fila: DegrauDaFila[];
  kpis: KpisDeAssinatura;
  taxas: TaxaDoPerfil[];
  totais: TotaisDoQuadro;
  unidades: Array<{
    assinadas: number;
    comprador: null | string;
    concluida: boolean;
    contrato: null | {
      contratoId?: string;
      faturadoEm: null | string;
      geradoEm: null | string;
      imobiliaria: null | string;
      temContrato: boolean;
      unitId: number;
      valorTabela: number;
      voltouParaCorrecaoEm?: null | string;
    };
    empreendimento: string;
    enviadoEm: string;
    envioId: number;
    esquema: Array<{ assinadoEm: null | string; degrau: number; nome: string; perfil: string; situacao: "aguardando" | "assinado" | "vez" }>;
    grupos: Array<{ assinadas: number; naVez: boolean; perfil: string; total: number }>;
    naVez: string[];
    perfisNaVez: string[];
    situacao: SituacaoDaAssinatura;
    total: number;
    unidade: string;
  }>;
};

/**
 * O QUADRO PARA O PORTAL — uma ALLOWLIST, montada campo a campo (plano, seção 5).
 *
 * ⚠️ NUNCA POR ESPALHAMENTO DO QUE VEIO. Nada de e-mail, CPF, telefone, `provedor`, `fonte`, `aviso`
 * de linha, `avisos`, `outrosVivos`, id do documento no provedor, estado cru, nem as palavras dos
 * sistemas (Lucas, 18/08/2026: *"não queria esse tipo de comunicado para o incorporador"*). O único id
 * interno que atravessa é o `contratoId` DENTRO de `contrato`, e só com PDF disponível: é a chave do
 * botão, e a rota do PDF reconfere o escopo pela unidade antes de qualquer leitura.
 */
export function quadroParaOPortal(quadro: QuadroDoPanteon): QuadroDoPortal {
  return {
    assinantes: quadro.assinantes.map((a) => ({
      aguardandoAnteriores: a.aguardandoAnteriores,
      assinou: a.assinou,
      naVez: a.naVez,
      nome: a.nome,
      papel: a.papel,
    })),
    aviso: quadro.aviso,
    avisoDaFonte: quadro.avisoDaFonte ? AVISO_DE_ATUALIZACAO : null,
    avisoDosAssinantes: null,
    conciliando: false,
    fila: quadro.fila.map((d) => ({ assinadas: d.assinadas, degrau: d.degrau, perfis: [...d.perfis], total: d.total })),
    kpis: { ...quadro.kpis },
    taxas: quadro.taxas.map((t) => ({ assinadas: t.assinadas, esperadas: t.esperadas, perfil: t.perfil })),
    totais: {
      aguardandoEmissao: quadro.totais.aguardandoEmissao,
      assinados: quadro.totais.assinados,
      contratos: quadro.totais.contratos,
      emAssinatura: quadro.totais.emAssinatura,
      faturados: quadro.totais.faturados,
      porEmpreendimento: quadro.totais.porEmpreendimento.map((t) => ({
        aguardandoEmissao: t.aguardandoEmissao,
        assinados: t.assinados,
        contratos: t.contratos,
        emAssinatura: t.emAssinatura,
        empreendimento: t.empreendimento,
        faturados: t.faturados,
      })),
    },
    unidades: quadro.unidades.map((linha: UnidadeDeAssinatura) => ({
      assinadas: linha.assinadas,
      comprador: linha.comprador,
      concluida: linha.concluida,
      contrato: linha.contrato
        ? {
            ...(linha.contrato.temContrato && linha.contrato.contratoId ? { contratoId: linha.contrato.contratoId } : {}),
            faturadoEm: linha.contrato.faturadoEm,
            geradoEm: linha.contrato.geradoEm,
            imobiliaria: linha.contrato.imobiliaria,
            temContrato: linha.contrato.temContrato,
            unitId: linha.contrato.unitId,
            valorTabela: linha.contrato.valorTabela,
            ...(linha.contrato.voltouParaCorrecaoEm !== undefined
              ? { voltouParaCorrecaoEm: linha.contrato.voltouParaCorrecaoEm }
              : {}),
          }
        : null,
      empreendimento: linha.empreendimento,
      enviadoEm: linha.enviadoEm,
      envioId: linha.envioId,
      esquema: linha.esquema.map((e) => ({
        assinadoEm: e.assinadoEm,
        degrau: e.degrau,
        nome: e.nome,
        perfil: e.perfil,
        situacao: e.situacao,
      })),
      grupos: linha.grupos.map((g) => ({ assinadas: g.assinadas, naVez: g.naVez, perfil: g.perfil, total: g.total })),
      naVez: [...linha.naVez],
      perfisNaVez: [...linha.perfisNaVez],
      situacao: linha.situacao,
      total: linha.total,
      unidade: linha.unidade,
    })),
  };
}

/**
 * A lista de CONTRATOS GERADOS do portal (`/api/incorporador/vendas/contratos`), da mesma leitura.
 *
 * Mesma forma de `montarContratos` (contratos.ts): do mais recente para o mais antigo (geração, senão
 * faturamento, senão a proposta), contagem por situação ANTES do teto, e o teto com aviso. Só as
 * linhas do portal (`noPortal`); a unidade é o código do Panteon ("VOC0306").
 */
export function contratosDoPortal(
  contratos: readonly ContratoDoPanteon[],
  teto: number,
): ContratosDoPortal {
  const visiveis = contratos.filter((c) => c.noPortal);
  const ordenaveis = visiveis.map((c) => {
    const compradores = [
      ...new Set((c.envelope?.pessoas ?? []).filter((p) => p.perfil === "Comprador").map((p) => p.nome).filter(Boolean)),
    ];
    const temContrato = Boolean(c.envelope && c.envelope.provedor === "d4sign" && c.envelope.provedorDocumentoId);
    const contrato: ContratoDoPortal = {
      assinatura: c.situacao,
      bloco: c.unidade.quadra,
      comprador: c.proposta?.clienteNome ?? (compradores.length > 0 ? compradores.join(", ") : null),
      ...(temContrato && c.envelope ? { contratoId: c.envelope.id } : {}),
      faturadoEm: diaEmBrasiliaOuDia(c.proposta?.dataFaturamento ?? null),
      geradoEm: c.proposta?.geradoEm ?? null,
      imobiliaria: c.proposta?.imobiliariaNome ?? null,
      lote: c.unidade.lote,
      temContrato,
      unidade: c.unidade.codigo,
      unitId: c.unidade.c2xId ?? 0,
      valorTabela: c.proposta ? c.proposta.precoTabela : c.unidade.precoTabela,
    };
    const ordem =
      c.proposta?.geradoEm ?? c.proposta?.dataFaturamento ?? c.proposta?.criadoEm ?? c.envelope?.enviadoEm ?? "";
    return { contrato, ordem: Number.isFinite(instante(ordem)) ? instante(ordem) : Number.NEGATIVE_INFINITY };
  });
  ordenaveis.sort((a, b) => b.ordem - a.ordem);

  const porSituacao: Record<SituacaoDaAssinatura, number> = { "aguardando-emissao": 0, assinado: 0, "em-assinatura": 0 };
  for (const item of ordenaveis) porSituacao[item.contrato.assinatura] += 1;

  return {
    contratos: ordenaveis.slice(0, teto).map((item) => item.contrato),
    porSituacao,
    total: ordenaveis.length,
    truncado: ordenaveis.length > teto,
  };
}
