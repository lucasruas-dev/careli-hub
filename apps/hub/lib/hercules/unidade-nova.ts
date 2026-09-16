// A UNIDADE CADASTRADA NO PANTEON, lote ou apartamento: as regras puras (sem rede, sem banco).
//
// Decisão do Lucas (16/09/2026): unidade cadastrada pelo portal grava no Panteon
// (`hercules_unidades`), nunca no C2X, que é SOMENTE LEITURA. E prédio é coluna própria na unidade
// (torre, andar, apartamento, tipologia, vagas, migration 0171) mais o tipo do produto (0170):
// apartamento NUNCA é encaixado em quadra/lote, porque WhatsApp, PDF e contrato escreveriam
// "Quadra · Lote" para um apartamento.
//
// ⚠️ COERENTE COM A IMPORTAÇÃO PARA O C2X, E NÃO UMA SEGUNDA RÉGUA. Número em formato brasileiro,
// quadra e lote com dois dígitos e o nome `prefixo + quadra + lote` vêm de
// `lib/apolo/cadastrar-unidades.ts` (importados, não copiados): uma unidade que o C2X chamou
// `JDG0617` e uma cadastrada aqui têm que ter o mesmo código, senão a checagem de duplicado não
// acha o que já existe.
//
// ⚠️ O QUE MUDA EM RELAÇÃO À IMPORTAÇÃO DO C2X: a situação inicial. Lá "Vendido" passava com aviso;
// aqui só Disponível e Bloqueada. No Panteon a venda é um fato com reserva, proposta e contrato por
// trás, e a tela Venda conta a situação da unidade: um lote que nasce "vendida" sem venda nenhuma
// faria o espelho e o VGV mentirem desde o primeiro dia.
import {
  doisDigitos,
  nomeDaUnidade as nomeNoPadraoDoC2x,
  normalizar,
  numeroBR,
} from "@/lib/apolo/cadastrar-unidades";

import { nomeDaUnidade as nomeDecompostoDoCodigo } from "./nome-da-unidade";
import type { TipoProduto } from "./produto-novo";

export type SituacaoInicial = "bloqueada" | "disponivel";

/**
 * Teto de unidades por envio (conferir e importar), na tela e no servidor.
 *
 * ⚠️ É O "LOTE PEQUENO" QUE MANTÉM A IMPORTAÇÃO NUM INSERT SÓ. 500 linhas são uns 200 KB de JSON:
 * cabem numa instrução, e uma instrução é atômica. Loteamento grande (300+ lotes) e prédio grande
 * cabem; o que passar disso se divide por quadra ou por torre, e cada parte continua tudo ou nada.
 * Mora aqui, e não no arquivo do servidor, porque a tela recusa a planilha grande ANTES de enviar.
 */
export const MAXIMO_DE_UNIDADES_POR_ENVIO = 500;

/**
 * O motivo gravado quando a unidade nasce sem preço (ver `validarUnidade`). Texto fixo para quem
 * libera a unidade na Venda saber, sem abrir o cadastro, o que falta.
 */
export const MOTIVO_DO_BLOQUEIO_SEM_PRECO = "Sem preço de tabela";

/**
 * O que chega da tela ou da planilha, cru. Cada campo é `unknown` porque planilha traz número
 * como número, texto como texto e célula vazia como nada; a normalização é daqui.
 *
 * Loteamento usa quadra, lote e area. Vertical usa torre, andar, apartamento, tipologia, vagas e
 * areaPrivativa. Os dois usam preco, matricula, situacao e motivoDoBloqueio.
 */
export type EntradaDeUnidade = {
  andar?: unknown;
  apartamento?: unknown;
  area?: unknown;
  areaPrivativa?: unknown;
  lote?: unknown;
  matricula?: unknown;
  motivoDoBloqueio?: unknown;
  preco?: unknown;
  quadra?: unknown;
  situacao?: unknown;
  tipologia?: unknown;
  torre?: unknown;
  vagas?: unknown;
};

export type CampoDaUnidade = keyof EntradaDeUnidade;
export type ErrosDaUnidade = Partial<Record<CampoDaUnidade, string>>;

type ComumDaUnidade = {
  matricula: null | string;
  /** Só preenchido quando `situacao` é `bloqueada`. */
  motivoDoBloqueio: null | string;
  /** Nulo = sem preço de tabela ainda (a unidade existe, mas não entra no VGV). */
  preco: null | number;
  situacao: SituacaoInicial;
};

export type UnidadeDeLoteamento = ComumDaUnidade & {
  area: number;
  lote: string;
  quadra: string;
  tipoProduto: "loteamento";
};

export type UnidadeVertical = ComumDaUnidade & {
  andar: number;
  apartamento: string;
  /** Vai para a coluna `area` (ver ATENCAO 2 da 0171: não existe `area_privativa`). */
  areaPrivativa: number;
  tipologia: null | string;
  tipoProduto: "vertical";
  /** Nulo = prédio de torre única. */
  torre: null | string;
  /** Nulo = não informado; 0 = sem vaga. */
  vagas: null | number;
};

export type UnidadeNova = UnidadeDeLoteamento | UnidadeVertical;

export type ResultadoDaUnidade =
  | { avisos: ErrosDaUnidade; ok: true; unidade: UnidadeNova }
  | { erros: ErrosDaUnidade; ok: false };

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

function texto(valor: unknown): null | string {
  const t = String(valor ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

/** Tira acento e deixa em maiúsculas: a chave de torre e apartamento só aceita A-Z e 0-9. */
function semAcentoMaiusculo(valor: string): string {
  return valor.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase();
}

/** "0304" → "304". Só em texto 100% numérico: "01A" continua "01A". */
function semZeroAEsquerda(valor: string): string {
  return /^\d+$/.test(valor) ? valor.replace(/^0+(?=\d)/, "") : valor;
}

/**
 * Quadra ou lote como a casa grava: dois dígitos quando é número ("1" → "01"), letra em
 * maiúsculas ("c01" → "C01", como na Lagoa Bonita). A palavra "Quadra"/"Lote" digitada junto sai.
 */
export function quadraOuLote(valor: unknown, palavra: "LOTE" | "QUADRA"): string {
  const cru = texto(valor);
  if (!cru) return "";
  const sem = semAcentoMaiusculo(cru).replace(new RegExp(`^${palavra}\\s+`), "");
  return doisDigitos(sem.replace(/\s+/g, ""));
}

/**
 * Torre como a casa grava: "Torre A" → "A", "bloco 02" → "2", "Norte" → "NORTE".
 *
 * ⚠️ O PREFIXO SAI PORQUE O RÓTULO JÁ O ESCREVE. Guardar "TORRE A" produziria "Torre TORRE A" no
 * WhatsApp. E o zero à esquerda sai pelo mesmo motivo do apartamento: "02" e "2" são a mesma torre,
 * e o índice único da 0171 compara o texto.
 */
export function torreCanonica(valor: unknown): null | string {
  const cru = texto(valor);
  if (!cru) return null;
  const sem = semAcentoMaiusculo(cru)
    .replace(/^(TORRE|BLOCO)\b\.?\s*/, "")
    .replace(/\s+/g, "");
  return sem ? semZeroAEsquerda(sem) : null;
}

/**
 * Apartamento como se fala: "Apto 0304" → "304", "1203a" → "1203A".
 *
 * ⚠️ SEM ZERO À ESQUERDA. Em prédio ninguém diz "apartamento zero três zero quatro", e "0304" e "304"
 * gravados por duas pessoas seriam dois apartamentos para o índice único.
 */
export function apartamentoCanonico(valor: unknown): null | string {
  const cru = texto(valor);
  if (!cru) return null;
  const sem = semAcentoMaiusculo(cru)
    .replace(/^(APARTAMENTO|APTO|APT|AP)\.?\s*(?=\d)/, "")
    .replace(/\s+/g, "");
  return sem ? semZeroAEsquerda(sem) : null;
}

const PARTE_DE_CODIGO = /^[A-Z0-9]+$/;

const SITUACOES_ACEITAS: Record<string, SituacaoInicial> = {
  "a venda": "disponivel",
  bloqueada: "bloqueada",
  bloqueado: "bloqueada",
  "bloqueado para venda": "bloqueada",
  disponivel: "disponivel",
  livre: "disponivel",
};

/** Andar: número inteiro, ou "Térreo" (0). "3º" e "3° andar" viram 3. */
function andarDe(valor: unknown): null | number {
  if (typeof valor === "number") return Number.isInteger(valor) ? valor : Number.NaN;
  const cru = texto(valor);
  if (!cru) return null;
  const chave = normalizar(cru);
  if (chave === "terreo" || chave === "t") return 0;
  if (!/^-?\d+\s*(º|°|o)?(\s*andar)?$/i.test(cru)) return Number.NaN;
  return Number.parseInt(cru, 10);
}

/** Vagas: inteiro sem sinal. "2 vagas" vira 2; "1,5" é erro. */
function vagasDe(valor: unknown): null | number {
  if (typeof valor === "number") return Number.isInteger(valor) && valor >= 0 ? valor : Number.NaN;
  const cru = texto(valor);
  if (!cru) return null;
  const m = /^(\d+)(\s*vagas?)?$/i.exec(cru);
  return m ? Number(m[1]) : Number.NaN;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDAÇÃO DE UMA UNIDADE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Confere uma unidade e devolve a versão normalizada (com avisos), ou um erro por campo.
 *
 * ⚠️ PREÇO PODE FALTAR, e é a mesma decisão da importação para o C2X (Lucas, 20/08/2026: *"eu ainda
 * não tenho o valor dessas matrículas"*): número inventado em campo de preço entra no VGV e ninguém
 * desconfia. Sai AVISO, não erro. Preenchido, tem que ser número maior que zero.
 *
 * ⚠️ MAS SEM PREÇO A UNIDADE NASCE BLOQUEADA (revisão de 16/09/2026). Disponível com `preco_tabela`
 * nulo entrava na grade da Venda com R$ 0: a reserva só confere a situação, a proposta abria com
 * preço de tabela zero, e a correção do preço ficava travada pela própria venda em andamento. Agora
 * a unidade entra, fora da venda, com o motivo `MOTIVO_DO_BLOQUEIO_SEM_PRECO`; quem preenche o preço
 * libera pela tela Venda. Quem já escolheu Bloqueada continua com o próprio motivo.
 */
export function validarUnidade(tipoProduto: TipoProduto, entrada: EntradaDeUnidade): ResultadoDaUnidade {
  const erros: ErrosDaUnidade = {};
  const avisos: ErrosDaUnidade = {};

  // ── comum aos dois tipos ──
  const precoVazio = texto(entrada.preco) === null;
  const preco = precoVazio ? null : numeroBR(entrada.preco);
  if (!precoVazio && (preco === null || preco <= 0)) {
    erros.preco = "O valor precisa ser um número maior que zero, ou ficar em branco.";
  }

  const situacaoCrua = texto(entrada.situacao);
  const situacaoPedida: SituacaoInicial | undefined = situacaoCrua
    ? SITUACOES_ACEITAS[normalizar(situacaoCrua)]
    : "disponivel";
  if (!situacaoPedida) {
    erros.situacao =
      "Unidade nova nasce Disponível ou Bloqueada. Reserva e venda acontecem pela tela Venda.";
  }

  let situacao = situacaoPedida;
  let motivo = texto(entrada.motivoDoBloqueio);
  if (precoVazio && situacaoPedida === "disponivel") {
    situacao = "bloqueada";
    motivo = MOTIVO_DO_BLOQUEIO_SEM_PRECO;
    avisos.preco =
      "Sem valor de tabela: a unidade entra bloqueada, fora da venda e do VGV, até alguém preencher o preço e liberar pela tela Venda.";
  } else if (precoVazio) {
    avisos.preco = "Sem valor de tabela: a unidade fica fora do VGV até alguém preencher o preço.";
  }
  if (situacaoPedida === "bloqueada" && !motivo) {
    avisos.motivoDoBloqueio = "Bloqueada sem motivo: quem for liberar a unidade não vai saber por que ela saiu da venda.";
  }

  const matricula = texto(entrada.matricula);
  if (!matricula) {
    avisos.matricula = "Sem matrícula: a unidade entra, mas o contrato vai precisar dela depois.";
  }

  const comum = {
    matricula,
    motivoDoBloqueio: situacao === "bloqueada" ? motivo : null,
    preco,
    situacao: situacao ?? "disponivel",
  };

  if (tipoProduto === "vertical") {
    const torre = torreCanonica(entrada.torre);
    if (torre !== null && !PARTE_DE_CODIGO.test(torre)) {
      erros.torre = "Use só letras e números na torre (ex.: A, B, NORTE).";
    } else if (torre !== null && torre.length > 10) {
      erros.torre = "A torre pode ter até 10 letras ou números.";
    }

    const apartamento = apartamentoCanonico(entrada.apartamento);
    if (!apartamento) {
      erros.apartamento = "Informe o número do apartamento (ex.: 304).";
    } else if (!PARTE_DE_CODIGO.test(apartamento) || apartamento.length > 8) {
      erros.apartamento = "Use até 8 letras ou números no apartamento (ex.: 304, 1203A).";
    }

    const andar = andarDe(entrada.andar);
    if (andar === null) {
      erros.andar = "Informe o andar (0 para térreo).";
    } else if (!Number.isInteger(andar)) {
      erros.andar = "O andar precisa ser um número inteiro (0 para térreo, negativo para subsolo).";
    }

    const vagas = vagasDe(entrada.vagas);
    if (vagas !== null && !Number.isInteger(vagas)) {
      erros.vagas = "Vagas precisa ser um número inteiro, zero ou maior.";
    }

    const areaPrivativa = numeroBR(entrada.areaPrivativa);
    if (areaPrivativa === null || areaPrivativa <= 0) {
      erros.areaPrivativa = "A área privativa precisa ser um número maior que zero.";
    }

    const tipologia = texto(entrada.tipologia);
    if (tipologia && tipologia.length > 60) {
      erros.tipologia = "A tipologia pode ter até 60 caracteres.";
    }

    if (Object.keys(erros).length > 0) return { erros, ok: false };

    return {
      avisos,
      ok: true,
      unidade: {
        ...comum,
        andar: andar as number,
        apartamento: apartamento as string,
        areaPrivativa: areaPrivativa as number,
        tipologia,
        tipoProduto: "vertical",
        torre,
        vagas,
      },
    };
  }

  const quadra = quadraOuLote(entrada.quadra, "QUADRA");
  if (!quadra) {
    erros.quadra = "Informe a quadra.";
  } else if (!PARTE_DE_CODIGO.test(quadra) || quadra.length > 6) {
    erros.quadra = "Use até 6 letras ou números na quadra (ex.: 01, C01).";
  }

  const lote = quadraOuLote(entrada.lote, "LOTE");
  if (!lote) {
    erros.lote = "Informe o lote.";
  } else if (!PARTE_DE_CODIGO.test(lote) || lote.length > 6) {
    erros.lote = "Use até 6 letras ou números no lote (ex.: 07, 12A).";
  }

  const area = numeroBR(entrada.area);
  if (area === null || area <= 0) {
    erros.area = "A área precisa ser um número maior que zero.";
  }

  if (Object.keys(erros).length > 0) return { erros, ok: false };

  return {
    avisos,
    ok: true,
    unidade: { ...comum, area: area as number, lote, quadra, tipoProduto: "loteamento" },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CÓDIGO E RÓTULO
// ─────────────────────────────────────────────────────────────────────────────

/** O mínimo para montar código e rótulo: serve para a unidade validada e para a linha do banco. */
export type PartesDaUnidade = {
  apartamento?: null | string;
  codigo?: null | string;
  lote?: null | string;
  quadra?: null | string;
  torre?: null | string;
};

/**
 * O código da unidade em `hercules_unidades.codigo` (único por empreendimento).
 *
 *   • loteamento: `JDG0617`, prefixo + quadra + lote, sem separador, EXATAMENTE como o C2X nomeia
 *     e como a carga (`carregar-unidades-do-c2x.mjs`) gravou as 5.541 unidades de hoje;
 *   • vertical: `JAD-A-304` (com torre) ou `JAD-304` (torre única).
 *
 * ⚠️ O HÍFEN DO VERTICAL É PROTEÇÃO, NÃO ESTÉTICA. `nome-da-unidade.ts` e a TelaVenda decompõem
 * código no padrão `^[A-Za-z]{2,4}\d{2}\d{2}$` em quadra e lote: sem separador, o apartamento 1203
 * do Jade viraria `JAD1203` e sairia "Quadra 12 · Lote 03" no WhatsApp do comprador.
 *
 * O prefixo é o `codigo` do produto onde a unidade mora (o `enterprise_id` dela). Devolve texto
 * vazio quando faltam as partes: quem chama trata como erro, nunca grava código vazio.
 */
export function codigoDaUnidade(prefixo: string, tipoProduto: TipoProduto, unidade: PartesDaUnidade): string {
  const sigla = String(prefixo ?? "").trim().toUpperCase();

  if (tipoProduto === "vertical") {
    const apartamento = apartamentoCanonico(unidade.apartamento);
    if (!sigla || !apartamento) return "";
    const torre = torreCanonica(unidade.torre);
    return torre ? `${sigla}-${torre}-${apartamento}` : `${sigla}-${apartamento}`;
  }

  const quadra = quadraOuLote(unidade.quadra, "QUADRA");
  const lote = quadraOuLote(unidade.lote, "LOTE");
  if (!sigla || !quadra || !lote) return "";
  return nomeNoPadraoDoC2x(sigla, quadra, lote);
}

/**
 * Como a unidade se escreve para gente: "Quadra 01 · Lote 05", "Torre A · Apto 304", "Apto 304".
 *
 * ⚠️ O MESMO SEPARADOR DE `nome-da-unidade.ts` ("·"), porque este texto vai no WhatsApp e no PDF ao
 * lado dele. Sem as partes, cai no código (e o de loteamento ainda é decomposto quando dá).
 */
export function rotuloDaUnidade(tipoProduto: TipoProduto, unidade: PartesDaUnidade): string {
  const codigo = String(unidade.codigo ?? "").trim();

  if (tipoProduto === "vertical") {
    const apartamento = apartamentoCanonico(unidade.apartamento);
    if (!apartamento) return codigo;
    const torre = torreCanonica(unidade.torre);
    return torre ? `Torre ${torre} · Apto ${apartamento}` : `Apto ${apartamento}`;
  }

  const quadra = quadraOuLote(unidade.quadra, "QUADRA");
  const lote = quadraOuLote(unidade.lote, "LOTE");
  if (quadra && lote) return `Quadra ${quadra} · Lote ${lote}`;
  return nomeDecompostoDoCodigo({ codigo, lote: null, quadra: null });
}

/**
 * A chave que diz "é a mesma unidade" dentro de um produto: quadra+lote ou torre+apartamento.
 * É a mesma pergunta do índice único da 0171, feita antes de gravar.
 */
export function chaveDaUnidade(tipoProduto: TipoProduto, unidade: PartesDaUnidade): string {
  if (tipoProduto === "vertical") {
    return `${torreCanonica(unidade.torre) ?? ""}|${apartamentoCanonico(unidade.apartamento) ?? ""}`;
  }
  return `${quadraOuLote(unidade.quadra, "QUADRA")}|${quadraOuLote(unidade.lote, "LOTE")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// A LINHA DO BANCO
// ─────────────────────────────────────────────────────────────────────────────

export type LinhaDeUnidadeNova = {
  andar?: number;
  apartamento?: string;
  area: number;
  bloqueado_em?: string;
  bloqueado_por?: null | string;
  bloqueado_por_nome?: null | string;
  bloqueio_motivo?: null | string;
  codigo: string;
  enterprise_id: string;
  lote: null | string;
  matricula: null | string;
  preco_tabela: null | number;
  quadra: null | string;
  situacao: SituacaoInicial;
  tipologia?: null | string;
  torre?: null | string;
  vagas?: null | number;
  workspace_id: "careli";
};

export type ContextoDaGravacao = {
  /**
   * Quem cadastrou. Só é usado quando a unidade nasce bloqueada: `bloqueado_por` é uuid
   * (`apolo_incorporador_usuarios.id` no portal, ver 0163), e o nome é COPIADO no ato.
   */
  autor: null | { id: null | string; nome: null | string };
  /** O `c2x_enterprise_id` do produto (id do C2X no legado, >= 100000 no nascido aqui). */
  enterpriseId: string;
  /** Relógio injetável para o teste. */
  agora?: Date;
  /** O `codigo` do produto. */
  prefixo: string;
};

/**
 * A linha para `insert` em `hercules_unidades`.
 *
 * ⚠️ LOTE NÃO MANDA AS COLUNAS DA 0171. Chave ausente no corpo não é citada no insert, então
 * cadastrar lote funciona com a 0171 pendente. Apartamento manda, e sem a migration o insert falha
 * com 42703/PGRST204: a rota responde 503 com `ehColunaDaUnidadeVerticalAusente`.
 *
 * ⚠️ BLOQUEADA NASCE COM CARIMBO. A 0163 usa `bloqueado_em` nulo para dizer "bloqueio herdado do
 * C2X, sem autor". Uma unidade bloqueada no cadastro do Panteon sem carimbo se passaria por legado.
 */
export function linhaDaUnidadeNova(unidade: UnidadeNova, contexto: ContextoDaGravacao): LinhaDeUnidadeNova {
  const bloqueio =
    unidade.situacao === "bloqueada"
      ? {
          bloqueado_em: (contexto.agora ?? new Date()).toISOString(),
          bloqueado_por: contexto.autor?.id ?? null,
          bloqueado_por_nome: contexto.autor?.nome ?? null,
          bloqueio_motivo: unidade.motivoDoBloqueio,
        }
      : {};

  const base = {
    codigo: codigoDaUnidade(contexto.prefixo, unidade.tipoProduto, unidade),
    enterprise_id: String(contexto.enterpriseId).trim(),
    matricula: unidade.matricula,
    preco_tabela: unidade.preco,
    situacao: unidade.situacao,
    workspace_id: "careli" as const,
    ...bloqueio,
  };

  if (unidade.tipoProduto === "vertical") {
    return {
      ...base,
      andar: unidade.andar,
      apartamento: unidade.apartamento,
      area: unidade.areaPrivativa,
      lote: null,
      quadra: null,
      tipologia: unidade.tipologia,
      torre: unidade.torre,
      vagas: unidade.vagas,
    };
  }

  return { ...base, area: unidade.area, lote: unidade.lote, quadra: unidade.quadra };
}

/**
 * O erro do Supabase é "as colunas da 0171 ainda não existem"?
 *
 * ⚠️ SÓ PARA AS COLUNAS DA 0171, pelo nome na mensagem: `42703`/`PGRST204` valem para qualquer
 * coluna, e engolir erro de digitação em outra coluna esconderia o defeito.
 */
export function ehColunaDaUnidadeVerticalAusente(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const { code, message } = erro as { code?: unknown; message?: unknown };
  if (code !== "42703" && code !== "PGRST204") return false;
  const mensagem = typeof message === "string" ? message.toLowerCase() : "";
  return /\b(torre|andar|apartamento|tipologia|vagas)\b/.test(mensagem);
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANILHA DE IMPORTAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

export type ColunaDaPlanilhaDeUnidades = {
  chave: CampoDaUnidade;
  exemplo: string;
  obrigatoria: boolean;
  rotulo: string;
};

const COLUNAS_COMUNS: readonly ColunaDaPlanilhaDeUnidades[] = [
  { chave: "preco", exemplo: "140401,00", obrigatoria: false, rotulo: "Valor (R$)" },
  { chave: "matricula", exemplo: "25.862", obrigatoria: false, rotulo: "Matrícula" },
  { chave: "situacao", exemplo: "Disponível", obrigatoria: false, rotulo: "Situação" },
  { chave: "motivoDoBloqueio", exemplo: "Permuta", obrigatoria: false, rotulo: "Motivo do bloqueio" },
];

export const COLUNAS_DA_PLANILHA_DE_LOTEAMENTO: readonly ColunaDaPlanilhaDeUnidades[] = [
  { chave: "quadra", exemplo: "01", obrigatoria: true, rotulo: "Quadra" },
  { chave: "lote", exemplo: "07", obrigatoria: true, rotulo: "Lote" },
  { chave: "area", exemplo: "300,00", obrigatoria: true, rotulo: "Área (m²)" },
  ...COLUNAS_COMUNS,
];

export const COLUNAS_DA_PLANILHA_VERTICAL: readonly ColunaDaPlanilhaDeUnidades[] = [
  { chave: "torre", exemplo: "A", obrigatoria: false, rotulo: "Torre" },
  { chave: "andar", exemplo: "3", obrigatoria: true, rotulo: "Andar" },
  { chave: "apartamento", exemplo: "304", obrigatoria: true, rotulo: "Apartamento" },
  { chave: "tipologia", exemplo: "2 quartos, 1 suíte", obrigatoria: false, rotulo: "Tipologia" },
  { chave: "vagas", exemplo: "1", obrigatoria: false, rotulo: "Vagas" },
  { chave: "areaPrivativa", exemplo: "68,45", obrigatoria: true, rotulo: "Área privativa (m²)" },
  ...COLUNAS_COMUNS,
];

export function colunasDaPlanilha(tipoProduto: TipoProduto): readonly ColunaDaPlanilhaDeUnidades[] {
  return tipoProduto === "vertical" ? COLUNAS_DA_PLANILHA_VERTICAL : COLUNAS_DA_PLANILHA_DE_LOTEAMENTO;
}

/**
 * O cabeçalho da planilha para a chave que a validação entende. Vazio = coluna ignorada.
 *
 * ⚠️ ACEITA A VARIAÇÃO DO DIA A DIA, como a importação do C2X: "Área (m²)", "Metragem", "Apto",
 * "Bloco". E "Área" sozinha é a área do LOTE no loteamento e a área PRIVATIVA no prédio, que é o
 * que cada um quer dizer quando escreve só "Área".
 */
export function chaveDaColunaDeUnidades(tipoProduto: TipoProduto, bruto: string): "" | CampoDaUnidade {
  const limpo = normalizar(bruto)
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (limpo.startsWith("motivo")) return "motivoDoBloqueio";
  if (limpo.startsWith("valor") || limpo.startsWith("preco")) return "preco";
  if (limpo.startsWith("matricula")) return "matricula";
  if (limpo.startsWith("status") || limpo.startsWith("situacao")) return "situacao";

  if (tipoProduto === "vertical") {
    if (limpo.startsWith("torre") || limpo.startsWith("bloco")) return "torre";
    if (limpo.startsWith("andar") || limpo.startsWith("pavimento")) return "andar";
    if (limpo.startsWith("ap") || limpo === "unidade") return "apartamento";
    if (limpo.startsWith("tipologia") || limpo.startsWith("planta") || limpo === "tipo") return "tipologia";
    if (limpo.startsWith("vaga") || limpo.startsWith("garagem")) return "vagas";
    if (limpo.startsWith("area") || limpo.startsWith("metragem")) return "areaPrivativa";
    return "";
  }

  if (limpo.startsWith("quadra")) return "quadra";
  if (limpo.startsWith("lote")) return "lote";
  if (limpo.startsWith("area") || limpo.startsWith("metragem")) return "area";
  return "";
}

export type LinhaDaPlanilhaDeUnidades = Partial<Record<CampoDaUnidade, unknown>>;

/**
 * Lê um CSV em linhas já com as chaves da validação.
 *
 * ⚠️ O SEPARADOR É DESCOBERTO, NÃO ASSUMIDO (mesmo motivo de `lerCsv` da importação do C2X): o Excel
 * em português salva com ponto e vírgula, o resto do mundo com vírgula. Linha toda em branco some.
 */
export function lerCsvDeUnidades(tipoProduto: TipoProduto, conteudo: string): LinhaDaPlanilhaDeUnidades[] {
  // BOM do Excel ("salvar como CSV UTF-8") na frente do primeiro cabeçalho: sem tirar, a coluna 1
  // não seria reconhecida. Por código e não por literal, para o caractere invisível não viver no fonte.
  const semBom = conteudo.charCodeAt(0) === 0xfeff ? conteudo.slice(1) : conteudo;
  const linhas = semBom.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (linhas.length < 2) return [];

  const primeira = linhas[0] as string;
  const pontoEVirgula = (primeira.match(/;/g) ?? []).length;
  const virgula = (primeira.match(/,/g) ?? []).length;
  const separador = pontoEVirgula >= virgula ? ";" : ",";

  const cabecalho = primeira.split(separador).map((c) => chaveDaColunaDeUnidades(tipoProduto, c));

  return linhas
    .slice(1)
    .map((linha) => {
      const celulas = linha.split(separador);
      const registro: LinhaDaPlanilhaDeUnidades = {};
      cabecalho.forEach((chave, i) => {
        if (chave) registro[chave] = (celulas[i] ?? "").trim().replace(/^"|"$/g, "");
      });
      return registro;
    })
    .filter((registro) => Object.values(registro).some((v) => String(v ?? "").trim() !== ""));
}

export type ProblemaDaLinhaDeUnidade = {
  campo: string;
  /** Linha como o operador vê no Excel: a 1 é o cabeçalho, a primeira unidade é a 2. */
  linha: number;
  motivo: string;
  /** `true` = só alerta: a linha entra, mas alguém precisa olhar. */
  soAviso?: boolean;
  valor: string;
};

export type UnidadeConferida = {
  codigo: string;
  linha: number;
  rotulo: string;
  unidade: UnidadeNova;
};

export type ConferenciaDeUnidades = {
  problemas: ProblemaDaLinhaDeUnidade[];
  /** Linhas prontas para gravar. */
  unidades: UnidadeConferida[];
};

export type OpcoesDaConferencia = {
  /** Códigos que JÁ existem no produto (`hercules_unidades.codigo` daquele `enterprise_id`). */
  codigosExistentes?: Iterable<string>;
  /** O `codigo` do produto. */
  prefixo: string;
  /**
   * As unidades que JÁ existem no produto, com as partes (quadra/lote ou torre/apartamento).
   *
   * ⚠️ O CÓDIGO SOZINHO NÃO BASTA. As unidades que vieram do C2X têm o código que o legado deu, e
   * nem todo nome do C2X segue `prefixo + quadra + lote`: comparar só o código deixaria entrar a
   * quadra 01 lote 07 que já existe com outro nome. As partes pegam o mesmo terreno.
   */
  unidadesExistentes?: Iterable<PartesDaUnidade>;
};

/**
 * Confere a planilha inteira: o que entra e o que trava, com o motivo por linha.
 *
 * ⚠️ UMA LINHA COM PROBLEMA NÃO ENTRA, e o resto entra (a mesma decisão da importação do C2X):
 * recusar a planilha por uma célula obriga a caçar a linha no escuro; deixar passar com valor
 * chutado cria unidade errada.
 *
 * ⚠️ DUPLICADO É ERRO NAS DUAS DIREÇÕES: repetido dentro da própria planilha (duas linhas com a
 * mesma quadra e lote, ou a mesma torre e apartamento) e já existente no produto (pelo código).
 */
export function conferirPlanilhaDeUnidades(
  tipoProduto: TipoProduto,
  linhas: LinhaDaPlanilhaDeUnidades[],
  opcoes: OpcoesDaConferencia,
): ConferenciaDeUnidades {
  const problemas: ProblemaDaLinhaDeUnidade[] = [];
  const unidades: UnidadeConferida[] = [];
  const vistas = new Map<string, number>();
  // ⚠️ PARTES DIFERENTES PODEM DAR O MESMO CÓDIGO NO LOTEAMENTO. Quadra e lote aceitam até 6
  // caracteres e `doisDigitos` só completa até dois: quadra 01 lote 011 e quadra 010 lote 11 viram os
  // dois `JDG01011`. A chave (quadra|lote) é diferente, então a repetição pela chave não pega, e o
  // índice único do código derrubaria a planilha inteira com "outra pessoa cadastrou".
  const codigosVistos = new Map<string, number>();
  const existentes = new Set([...(opcoes.codigosExistentes ?? [])].map((c) => String(c).trim().toUpperCase()));
  const prefixo = String(opcoes.prefixo ?? "").trim().toUpperCase();
  const chavesExistentes = new Set(
    [...(opcoes.unidadesExistentes ?? [])]
      .map((u) => chaveDaUnidade(tipoProduto, u))
      // Linha sem as partes (quadra ou lote vazio; apartamento vazio) não pode casar com nada. Torre
      // vazia é legítima: prédio de torre única.
      .filter((c) => !c.endsWith("|") && (tipoProduto === "vertical" || !c.startsWith("|"))),
  );

  linhas.forEach((bruta, indice) => {
    const linha = indice + 2;
    const resultado = validarUnidade(tipoProduto, bruta);

    if (!resultado.ok) {
      for (const [campo, motivo] of Object.entries(resultado.erros)) {
        problemas.push({ campo, linha, motivo: motivo as string, valor: String(bruta[campo as CampoDaUnidade] ?? "") });
      }
      return;
    }

    const { unidade } = resultado;
    const rotulo = rotuloDaUnidade(tipoProduto, unidade);
    const campoDaChave = tipoProduto === "vertical" ? "torre/apartamento" : "quadra/lote";

    const chave = chaveDaUnidade(tipoProduto, unidade);
    const jaVista = vistas.get(chave);
    if (jaVista) {
      problemas.push({
        campo: campoDaChave,
        linha,
        motivo: `Repetida: a linha ${jaVista} já traz ${rotulo}.`,
        valor: chave,
      });
      return;
    }
    vistas.set(chave, linha);

    const codigo = codigoDaUnidade(prefixo, tipoProduto, unidade);
    if (!codigo) {
      problemas.push({
        campo: "codigo",
        linha,
        motivo: "Não foi possível montar o código da unidade: o produto está sem código.",
        valor: "",
      });
      return;
    }

    const mesmoCodigo = codigosVistos.get(codigo);
    if (mesmoCodigo) {
      problemas.push({
        campo: campoDaChave,
        linha,
        motivo: `${rotulo} gera o código ${codigo}, o mesmo da linha ${mesmoCodigo}, que é outra unidade. Confira ${
          tipoProduto === "vertical" ? "a torre e o apartamento" : "a quadra e o lote"
        }.`,
        valor: codigo,
      });
      return;
    }
    codigosVistos.set(codigo, linha);

    if (existentes.has(codigo) || chavesExistentes.has(chave)) {
      problemas.push({
        campo: campoDaChave,
        linha,
        motivo: `${rotulo} já está cadastrada neste produto.`,
        valor: codigo,
      });
      return;
    }

    for (const [campo, motivo] of Object.entries(resultado.avisos)) {
      problemas.push({
        campo,
        linha,
        motivo: motivo as string,
        soAviso: true,
        valor: String(bruta[campo as CampoDaUnidade] ?? ""),
      });
    }

    unidades.push({ codigo, linha, rotulo, unidade });
  });

  return { problemas, unidades };
}
