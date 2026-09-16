// COMO A UNIDADE SE ESCREVE — "Quadra 12 · Lote 06".
//
// ⚠️ UM LUGAR SÓ, PORQUE ESTE TEXTO CIRCULA. Ele vai no WhatsApp da reserva, no WhatsApp da
// proposta e no PDF que o comprador guarda. Três grafias da mesma unidade ("Q12 L06", "1206",
// "Quadra 12 Lote 06") na mesma venda fazem o corretor conferir se está falando do mesmo lote — e
// foi assim que a rota da reserva ganhou a primeira versão desta função, privada.
//
// ⚠️ O CÓDIGO É O ÚLTIMO RECURSO, e ele é decomposto quando dá. Os empreendimentos gravam
// `JDG0617` (sigla + quadra + lote) e nem todos preencheram as colunas `quadra`/`lote`: sem esta
// leitura, o corretor receberia "JDG0617", que é o nosso vocabulário, não o dele.
//
// ⚠️ E O PRÉDIO SE ESCREVE COMO PRÉDIO. Lucas (16/09/2026): apartamento NUNCA é encaixado em
// quadra/lote, porque WhatsApp, PDF e contrato diriam "Quadra · Lote" para um apartamento. A
// unidade vertical tem colunas próprias (torre, andar, apartamento, tipologia, vagas, migration
// 0171) e sai "Torre A · Apto 304", ou "Apto 304" no prédio de torre única. Quem escreve é
// `rotuloDaUnidade` da fundação (`unidade-nova.ts`), importado e não copiado: o cadastro e a venda
// não podem escrever o mesmo apartamento de dois jeitos.
//
// ⚠️ IMPORTAÇÃO CIRCULAR CONSCIENTE. `unidade-nova.ts` também importa este arquivo (para decompor o
// código do loteamento). Os dois lados só usam as funções DENTRO de funções, nunca no topo do
// módulo, então a ordem de carga não importa.
import type { TipoProduto } from "./produto-novo";
import {
  apartamentoCanonico,
  ehColunaDaUnidadeVerticalAusente,
  rotuloDaUnidade,
  torreCanonica,
} from "./unidade-nova";

export type UnidadeParaEscrever = {
  /** Só no vertical (0171). Ausente quando a leitura não pediu a coluna. */
  apartamento?: null | string;
  codigo: string;
  lote: null | string;
  quadra: null | string;
  /**
   * O tipo do PRODUTO onde a unidade mora (`hercules_empreendimentos.tipo_produto`, 0170).
   * Ausente = a unidade decide pelas próprias colunas (ver `ehUnidadeVertical`).
   */
  tipoProduto?: null | string;
  /** Só no vertical. Nulo = prédio de torre única. */
  torre?: null | string;
};

/** `JDG0617` → quadra 06, lote 17. Duas letras de sigla ou quatro, sempre 2+2 no fim. */
const CODIGO_COM_QUADRA_E_LOTE = /^([A-Za-z]{2,4})(\d{2})(\d{2})$/;

/**
 * `JAD-A-304` ou `JAD-304`, o código que `codigoDaUnidade` da fundação grava no vertical.
 *
 * ⚠️ SÓ É LIDO QUANDO A UNIDADE JÁ É VERTICAL. Código com hífen existe fora do prédio ("APTO-101" é
 * um caso de teste antigo e continua saindo como está): decompor todo código com hífen inventaria
 * apartamento em unidade que não é apartamento.
 */
const CODIGO_VERTICAL = /^([A-Za-z][A-Za-z0-9]{1,5})-(?:([A-Za-z0-9]{1,10})-)?([A-Za-z0-9]{1,8})$/;

const preenchido = (valor: unknown): boolean => String(valor ?? "").trim() !== "";

/**
 * A unidade é de prédio?
 *
 * ⚠️ DUAS PORTAS, E A SEGUNDA É A DO DADO. O produto diz `vertical` e isso basta. Sem o tipo (a
 * leitura não cruzou com o cadastro do produto), vale a própria unidade: apartamento preenchido e
 * quadra e lote vazios. Loteamento nunca grava apartamento (`linhaDaUnidadeNova` nem manda a
 * coluna), e as 5.541 unidades da carga do C2X nasceram antes dela existir, então a segunda porta
 * não alcança nenhum lote.
 */
export function ehUnidadeVertical(
  unidade: Pick<UnidadeParaEscrever, "apartamento" | "lote" | "quadra" | "tipoProduto">,
): boolean {
  if (unidade.tipoProduto === "vertical") return true;
  return preenchido(unidade.apartamento) && !preenchido(unidade.quadra) && !preenchido(unidade.lote);
}

export function tipoDaUnidade(
  unidade: Pick<UnidadeParaEscrever, "apartamento" | "lote" | "quadra" | "tipoProduto">,
): TipoProduto {
  return ehUnidadeVertical(unidade) ? "vertical" : "loteamento";
}

/**
 * Torre, apartamento e a sigla do produto de uma unidade vertical: pelas colunas, e pelo código
 * quando a leitura não trouxe as colunas.
 */
function partesDoApartamento(unidade: UnidadeParaEscrever): {
  apartamento: null | string;
  recorte: null | string;
  torre: null | string;
} {
  const codigo = String(unidade.codigo ?? "").trim();
  const padrao = CODIGO_VERTICAL.exec(codigo);
  const recorte = padrao?.[1] ? padrao[1].toUpperCase() : null;

  // Com a coluna do apartamento, a torre também vem da coluna, e nula quer dizer torre única. Só o
  // código decide quando a leitura não pediu as colunas.
  if (preenchido(unidade.apartamento)) {
    return {
      apartamento: apartamentoCanonico(unidade.apartamento),
      recorte,
      torre: torreCanonica(unidade.torre),
    };
  }
  return {
    apartamento: padrao ? apartamentoCanonico(padrao[3]) : null,
    recorte,
    torre: padrao ? torreCanonica(padrao[2]) : null,
  };
}

export function nomeDaUnidade(unidade: UnidadeParaEscrever): string {
  if (ehUnidadeVertical(unidade)) {
    const partes = partesDoApartamento(unidade);
    return rotuloDaUnidade("vertical", {
      apartamento: partes.apartamento,
      codigo: unidade.codigo,
      torre: partes.torre,
    });
  }

  if (unidade.quadra && unidade.lote) return `Quadra ${unidade.quadra} · Lote ${unidade.lote}`;

  const padrao = CODIGO_COM_QUADRA_E_LOTE.exec(String(unidade.codigo ?? "").trim());
  if (padrao) return `Quadra ${padrao[2]} · Lote ${padrao[3]}`;

  return String(unidade.codigo ?? "").trim();
}

/**
 * Como a unidade aparece NA TELA de quem vende: **quadra e lote**, e o recorte por baixo.
 *
 * ⚠️ O CÓDIGO DA UNIDADE NÃO VAI PARA A TELA. Lucas (03/09/2026), comparando as duas listas:
 * *"vamos deixar esse padrão do segundo print, 12 06 VOR; não vamos trabalhar com o código da
 * unidade, esse será de uso do backend (...) caso trazer, ter a conotação de código"*. "VOL0307" é
 * chave de sistema; quem está vendendo fala "lote 07 da quadra 03".
 *
 * `VOL0307` → `{ recorte: "VOL", unidade: "03 07" }`. Código fora do padrão (unidade avulsa) volta
 * inteiro no lugar da unidade: melhor um código à mostra do que um lote inventado.
 *
 * ⚠️ NO PRÉDIO A FORMA CURTA É A POR EXTENSO. "A 304" não se lê como apartamento (e "304" sozinho
 * não diz a torre); "Torre A · Apto 304" é o que o corretor fala. O recorte é a sigla antes do
 * primeiro hífen, e por isso não corta código de 5 ou 6 letras (ONSKY-A-1203 → ONSKY).
 *
 * Morava na TelaVenda (`comoSeEscreve`) e veio para cá quando ganhou o segundo tipo: regra pura
 * vive onde tem teste.
 */
export function escritaCurtaDaUnidade(unidade: UnidadeParaEscrever): {
  recorte: null | string;
  unidade: string;
} {
  if (ehUnidadeVertical(unidade)) {
    const partes = partesDoApartamento(unidade);
    return { recorte: partes.recorte, unidade: nomeDaUnidade(unidade) };
  }

  const codigo = String(unidade.codigo ?? "").trim();
  if (unidade.quadra && unidade.lote) {
    // ⚠️ ATÉ SEIS LETRAS, e não quatro. O cadastro de produto do Panteon aceita código de 2 a 6
    // caracteres; com {2,4} um loteamento "SOLAR" apareceria "SOLA". Os códigos de hoje têm 2 ou 3
    // letras, então nada muda para eles.
    const m = /^([A-Za-z]{2,6})/.exec(codigo);
    return {
      recorte: m?.[1] ? m[1].toUpperCase() : null,
      unidade: `${unidade.quadra} ${unidade.lote}`,
    };
  }

  const padrao = CODIGO_COM_QUADRA_E_LOTE.exec(codigo);
  if (padrao?.[1] && padrao[2] && padrao[3]) {
    return { recorte: padrao[1].toUpperCase(), unidade: `${padrao[2]} ${padrao[3]}` };
  }
  return { recorte: null, unidade: unidade.codigo };
}

/**
 * "Quadra 03 · Lote 07" ou "Torre A · Apto 304": o nome por extenso, como as modais da tela Venda o
 * escrevem no título.
 *
 * ⚠️ É A MESMA FRASE QUE VAI NO WHATSAPP, de propósito: o corretor lê "Quadra 03 · Lote 07" no
 * celular e precisa reconhecer exatamente isso quando abrir a tela.
 *
 * ⚠️ NO LOTEAMENTO ELA PARTE DA ESCRITA CURTA, e não de `nomeDaUnidade`, porque era assim na
 * TelaVenda (`comoSeLe`) e as duas só diferem em código fora do padrão ("Q07 L12" sai "Quadra Q07 ·
 * Lote L12" aqui). Trocar a régua do lote não é assunto desta mudança.
 */
export function nomeDaUnidadeNaTela(unidade: UnidadeParaEscrever): string {
  if (ehUnidadeVertical(unidade)) return nomeDaUnidade(unidade);
  const escrita = escritaCurtaDaUnidade(unidade);
  const partes = escrita.unidade.split(" ");
  if (partes.length < 2) return escrita.unidade;
  return `Quadra ${partes[0]} · Lote ${partes[1]}`;
}

/** "Térreo", "3º andar", "1º subsolo". Vazio quando o andar não veio. */
export function rotuloDoAndar(andar: null | number | undefined): string {
  if (andar === null || andar === undefined || !Number.isInteger(andar)) return "";
  if (andar === 0) return "Térreo";
  return andar > 0 ? `${andar}º andar` : `${-andar}º subsolo`;
}

/**
 * "3º", "T", "S1": o andar na coluna estreita da grade, onde "3º andar" não cabe ao lado dos
 * quadradinhos. O rótulo longo vai no `title`.
 */
export function rotuloCurtoDoAndar(andar: null | number | undefined): string {
  if (andar === null || andar === undefined || !Number.isInteger(andar)) return "";
  if (andar === 0) return "T";
  return andar > 0 ? `${andar}º` : `S${-andar}`;
}

/**
 * As colunas do apartamento em `hercules_unidades` (0171), para somar ao `select` de quem monta
 * unidade. Com vírgula na frente: `select(\`id,codigo,quadra,lote${COLUNAS_DO_APARTAMENTO}\`)`.
 */
export const COLUNAS_DO_APARTAMENTO = ",andar,apartamento,tipologia,torre,vagas";

/**
 * Lê com as colunas do apartamento, e repete sem elas se a 0171 ainda não foi aplicada.
 *
 * ⚠️ A TELA NÃO PODE CAIR PORQUE A MIGRATION ESTÁ NA FILA. Pedir coluna que não existe devolve
 * 42703/PGRST204 e a rota inteira responderia erro, para loteamento também. Sem a 0171 não existe
 * apartamento nenhum, então ler sem as colunas é exato, não aproximado.
 *
 * Só esse erro repete (`ehColunaDaUnidadeVerticalAusente` confere o NOME da coluna): qualquer outro
 * volta para quem chamou, como viria sem este embrulho.
 */
export async function lerComColunasDoApartamento<T>(
  ler: (colunasExtras: string) => PromiseLike<{ data: T; error: unknown }>,
): Promise<{ data: T; error: unknown; semColunasDoApartamento: boolean }> {
  const comColunas = await ler(COLUNAS_DO_APARTAMENTO);
  if (!ehColunaDaUnidadeVerticalAusente(comColunas.error)) {
    return { data: comColunas.data, error: comColunas.error, semColunasDoApartamento: false };
  }
  const semColunas = await ler("");
  return { data: semColunas.data, error: semColunas.error, semColunasDoApartamento: true };
}
