// O PRODUTO QUE NASCE NO PANTEON: as regras puras do cadastro (sem rede, sem banco).
//
// Decisão do Lucas (16/09/2026) para o portal da Cecílio Rocha: MESMO banco, MESMAS tabelas, MESMO
// código, e cada produto (`hercules_empreendimentos`) marca QUEM o opera. Os prédios e loteamentos
// da Cecílio que ainda não existem no sistema nascem aqui, com id próprio a partir de 100000 (a
// sequence da migration 0170), e o C2X legado não recebe mais nada.
//
// ⚠️ A TELA E A ROTA LEEM A MESMA RÉGUA. A tela chama `validarProdutoNovo` para pintar o campo
// errado antes do envio; a rota chama de novo antes de gravar, porque a tela é conveniência e o
// servidor é a trava. Duas cópias da regra discordariam no primeiro ajuste.
//
// ⚠️ O CÓDIGO É ÚNICO CONTRA O C2X E CONTRA O PANTEON JUNTOS. O escopo do portal traduz ids em
// códigos pelo catálogo do C2X e soma os do Panteon (`codigos-do-pedido.ts`); um código repetido
// entre os dois faria o filtro por código da Venda juntar as unidades de dois produtos diferentes.
// Por isso quem chama monta `codigosExistentes` com os DOIS lados.
import { UFS } from "@/lib/apolo/cidades";

export const TIPOS_DE_PRODUTO = ["loteamento", "vertical"] as const;
export type TipoProduto = (typeof TIPOS_DE_PRODUTO)[number];

export const ROTULO_DO_TIPO_DE_PRODUTO: Record<TipoProduto, string> = {
  loteamento: "Loteamento",
  vertical: "Vertical (prédio)",
};

export type UF = (typeof UFS)[number];

/** O primeiro id que a sequence `hercules_empreendimento_id_seq` entrega (migration 0170). */
export const PRIMEIRO_ID_DO_PANTEON = 100000;

/**
 * O `enterprise_id` é de um produto nascido no Panteon?
 *
 * Os ids do C2X estão perto de 45 e o ZZ TESTE é 9001: tudo abaixo de 100000 é legado (ou foi
 * escrito à mão). Texto não numérico nunca é id do Panteon.
 */
export function ehIdDoPanteon(enterpriseId: null | number | string | undefined): boolean {
  const texto = String(enterpriseId ?? "").trim();
  if (!/^\d{1,18}$/.test(texto)) return false;
  return Number(texto) >= PRIMEIRO_ID_DO_PANTEON;
}

/**
 * O texto do banco para o tipo do produto, tolerante.
 *
 * ⚠️ AUSENTE VIRA LOTEAMENTO, e é de propósito: com a 0170 ainda não aplicada a coluna não vem, e
 * loteamento é o que o sistema inteiro já assume (WhatsApp, PDF e contrato dizem "Quadra · Lote").
 * Valor desconhecido também vira loteamento: a CHECK do banco só aceita os dois.
 */
export function tipoProdutoDe(valor: unknown): TipoProduto {
  return String(valor ?? "").trim().toLowerCase() === "vertical" ? "vertical" : "loteamento";
}

/** Código como a régua compara: sem espaço nas pontas, em maiúsculas. */
export function codigoDoProduto(valor: unknown): string {
  return String(valor ?? "").trim().toUpperCase();
}

export type EntradaDeProdutoNovo = {
  cidade: string;
  codigo: string;
  nome: string;
  /** Código do PAI, quando o produto é uma visão segmentada (filho). Nulo/ausente = produto raiz. */
  paiCodigo?: null | string;
  tipoProduto: string;
  uf: string;
};

export type ProdutoNovo = {
  cidade: string;
  codigo: string;
  nome: string;
  paiCodigo: null | string;
  tipoProduto: TipoProduto;
  uf: UF;
};

export type CampoDoProdutoNovo = "cidade" | "codigo" | "nome" | "paiCodigo" | "tipoProduto" | "uf";
export type ErrosDoProdutoNovo = Partial<Record<CampoDoProdutoNovo, string>>;

export type ResultadoDoProdutoNovo =
  | { erros: ErrosDoProdutoNovo; ok: false }
  | { ok: true; produto: ProdutoNovo };

export type OpcoesDoProdutoNovo = {
  /** Códigos que já existem: os do catálogo do C2X E os de `hercules_empreendimentos`. */
  codigosExistentes: Set<string>;
  /**
   * Códigos que podem ser pai (raízes do cadastro do Panteon). Quando vier, `paiCodigo` precisa
   * estar aqui; sem ele, só o formato e a auto-referência são conferidos.
   */
  paisPossiveis?: Set<string>;
};

/**
 * Letra primeiro, depois letras ou números, 2 a 6 no total.
 *
 * ⚠️ COMEÇA COM LETRA PORQUE O CÓDIGO DA UNIDADE COMEÇA COM ELE. Lote nasce `prefixo + quadra +
 * lote` (JDG0617); um produto "12" geraria a unidade "120617", que se lê como número e se confunde
 * com id do C2X em qualquer planilha.
 */
const CODIGO_VALIDO = /^[A-Z][A-Z0-9]{1,5}$/;

const TAMANHO_MAXIMO_DO_NOME = 120;
const TAMANHO_MAXIMO_DA_CIDADE = 80;

/** Texto limpo: espaços colapsados, sem pontas. */
function limpo(valor: unknown): string {
  return String(valor ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Confere o cadastro de um produto novo e devolve a versão normalizada, ou um erro por campo.
 *
 * As mensagens vão direto para a tela, embaixo do campo: dizem o que fazer, não o que falhou.
 */
export function validarProdutoNovo(
  entrada: EntradaDeProdutoNovo,
  opcoes: OpcoesDoProdutoNovo,
): ResultadoDoProdutoNovo {
  const erros: ErrosDoProdutoNovo = {};

  const existentes = new Set([...opcoes.codigosExistentes].map(codigoDoProduto).filter(Boolean));

  const codigo = codigoDoProduto(entrada.codigo);
  if (!codigo) {
    erros.codigo = "Informe o código do produto (ex.: JAD).";
  } else if (!CODIGO_VALIDO.test(codigo)) {
    erros.codigo = "Use de 2 a 6 letras ou números, começando por letra, sem espaço nem acento (ex.: JAD).";
  } else if (existentes.has(codigo)) {
    erros.codigo = `O código ${codigo} já está em uso por outro empreendimento. Escolha outro.`;
  }

  const nome = limpo(entrada.nome);
  if (!nome) {
    erros.nome = "Informe o nome do produto.";
  } else if (nome.length > TAMANHO_MAXIMO_DO_NOME) {
    erros.nome = `O nome pode ter até ${TAMANHO_MAXIMO_DO_NOME} caracteres.`;
  }

  const cidade = limpo(entrada.cidade);
  if (!cidade) {
    erros.cidade = "Informe a cidade do produto.";
  } else if (cidade.length > TAMANHO_MAXIMO_DA_CIDADE) {
    erros.cidade = `A cidade pode ter até ${TAMANHO_MAXIMO_DA_CIDADE} caracteres.`;
  }

  const uf = limpo(entrada.uf).toUpperCase();
  if (!uf) {
    erros.uf = "Informe a UF.";
  } else if (!(UFS as readonly string[]).includes(uf)) {
    erros.uf = "UF inválida. Use a sigla do estado (ex.: MG).";
  }

  const tipoCru = limpo(entrada.tipoProduto).toLowerCase();
  if (!tipoCru) {
    erros.tipoProduto = "Escolha o tipo: Loteamento ou Vertical (prédio).";
  } else if (!(TIPOS_DE_PRODUTO as readonly string[]).includes(tipoCru)) {
    erros.tipoProduto = "Tipo inválido. Escolha Loteamento ou Vertical (prédio).";
  }

  const paiCodigo = codigoDoProduto(entrada.paiCodigo) || null;
  if (paiCodigo) {
    if (codigo && paiCodigo === codigo) {
      erros.paiCodigo = "O produto não pode ser pai dele mesmo.";
    } else if (opcoes.paisPossiveis) {
      const pais = new Set([...opcoes.paisPossiveis].map(codigoDoProduto));
      if (!pais.has(paiCodigo)) {
        erros.paiCodigo = `O empreendimento ${paiCodigo} não pode ser pai: ele não existe ou já é filho de outro.`;
      }
    }
  }

  if (Object.keys(erros).length > 0) return { erros, ok: false };

  return {
    ok: true,
    produto: {
      cidade,
      codigo,
      nome,
      paiCodigo,
      tipoProduto: tipoCru as TipoProduto,
      uf: uf as UF,
    },
  };
}

/**
 * O erro do Supabase é "as colunas da 0170 ainda não existem"?
 *
 * ⚠️ SÓ PARA AS COLUNAS DA 0170, e pelo nome delas na mensagem. `42703` (Postgres) e `PGRST204`
 * (schema cache do PostgREST) dizem "coluna não existe" para QUALQUER coluna: engolir os dois sem
 * olhar o nome faria um erro de digitação em outra coluna do select virar, calado, um cadastro sem
 * operador. Mesma cautela de `ehColunaDaRessalvaAusente` (lib/temis/planos.ts).
 */
export function ehColunaDoProdutoAusente(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const { code, message } = erro as { code?: unknown; message?: unknown };
  if (code !== "42703" && code !== "PGRST204") return false;
  const mensagem = typeof message === "string" ? message.toLowerCase() : "";
  return /operado_por|tipo_produto|criado_origem|criado_por/.test(mensagem);
}
