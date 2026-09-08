// AS CORES DA SITUAÇÃO DA UNIDADE — uma paleta só, para o Panteon inteiro.
//
// Lucas, 08/09/2026, olhando a lista de unidades do Setup: *"vamos colocar as cores padrão? A mesma
// cores que temos hoje no Hércules para os status"*.
//
// ⚠️ AS FAMÍLIAS JÁ ERAM AS MESMAS — verde para disponível, âmbar para reservado, roxo para
// negociação, azul para vendido, vermelho para bloqueado. O que divergia era o TOM: o Hércules
// pinta com hex próprios (`TelaProdutosComercial`), e a lista do Setup usava a escala do Tailwind
// (`emerald-50`, `blue-700`…). Duas telas do mesmo sistema mostrando o mesmo lote em dois azuis
// diferentes é o tipo de detalhe que faz a pessoa duvidar se está olhando a mesma coisa.
//
// ⚠️ ESTE ARQUIVO É A FONTE, e quem pinta importa daqui. A regra que ele existe para impedir é a de
// sempre: cor copiada é cor que diverge no dia em que uma das duas muda.
//
// ⚠️ E A COR NÃO É O ÚNICO SINAL. Ela some para quem não distingue verde de vermelho, e some no
// preto e branco de uma impressão — por isso o rótulo (`Vendido`, `Bloqueado`) anda sempre junto,
// nas duas telas. A cor acelera a leitura de quem já sabe; o texto é o que informa.

export type SituacaoDaUnidade =
  | "bloqueado"
  | "disponivel"
  | "negociacao"
  | "reservado"
  | "vendido";

export type ParDeCores = {
  /** O tom do tema claro. */
  claro: string;
  /** O tom do tema escuro — mais claro, para ter contraste sobre o fundo preto. */
  escuro: string;
};

/**
 * Os tons, medidos de `modules/incorporador/TelaProdutosComercial.tsx` (o painel de produtos do
 * portal), que é onde a paleta nasceu e onde o Lucas a aprovou.
 */
export const CORES_DA_SITUACAO: Record<SituacaoDaUnidade, ParDeCores> = {
  bloqueado: { claro: "#c24135", escuro: "#e08278" },
  disponivel: { claro: "#2f7d59", escuro: "#7cc4a1" },
  negociacao: { claro: "#6d28d9", escuro: "#a78bfa" },
  reservado: { claro: "#b45309", escuro: "#fbbf24" },
  vendido: { claro: "#1d4ed8", escuro: "#60a5fa" },
};

/** O rótulo em português, para a cor nunca ser o único sinal. */
export const ROTULO_DA_SITUACAO: Record<SituacaoDaUnidade, string> = {
  bloqueado: "Bloqueado",
  disponivel: "Disponível",
  negociacao: "Em negociação",
  reservado: "Reservado",
  vendido: "Vendido",
};

/**
 * O CSS das variáveis, para colar num `<style>` da tela.
 *
 * ⚠️ OS TRÊS ESTADOS DO TEMA, e não dois. O portal tem escolha explícita (`data-inc-tema`) além da
 * preferência do sistema: a media query fica GUARDADA por `:not([data-inc-tema="claro"])`, para o
 * sistema escuro não atropelar quem pediu claro de propósito, e o bloco explícito vem depois para a
 * escolha vencer no outro sentido. É a mesma regra de `modules/incorporador/tema.tsx`, e existe
 * porque uma cor definida SÓ dentro da media query fica sem valor no outro tema.
 */
export function cssDasCores(escopo: string): string {
  const linhas = (lado: "claro" | "escuro") =>
    (Object.keys(CORES_DA_SITUACAO) as SituacaoDaUnidade[])
      .map((s) => `--sit-${s}:${CORES_DA_SITUACAO[s][lado]};`)
      .join(" ");

  return `
    ${escopo} { ${linhas("claro")} }
    @media (prefers-color-scheme: dark) {
      :root:not([data-inc-tema="claro"]) ${escopo} { ${linhas("escuro")} }
    }
    :root[data-inc-tema="escuro"] ${escopo} { ${linhas("escuro")} }
  `;
}

/** A variável CSS de uma situação, para usar em `color` ou `border-color`. */
export function corDaSituacao(s: SituacaoDaUnidade): string {
  return `var(--sit-${s})`;
}

/**
 * As classes do Tailwind para o selo da lista, no tom do Hércules.
 *
 * ⚠️ POR QUE CLASSE E NÃO A VARIÁVEL CSS AQUI. A lista do Setup vive dentro do hub, que é Tailwind
 * puro e não carrega o `<style>` do portal; usar `var(--sit-vendido)` ali daria cor nenhuma. As
 * famílias do Tailwind foram escolhidas por ficarem no mesmo tom dos hex acima — `blue-700` é
 * #1d4ed8, que é exatamente o `vendido` do Hércules, e `emerald-700`, `amber-700`, `violet-700` e
 * `rose-700` são os vizinhos mais próximos dos outros quatro.
 */
export const CLASSES_DO_SELO: Record<SituacaoDaUnidade, string> = {
  bloqueado:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-300",
  disponivel:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-300",
  negociacao:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/12 dark:text-violet-300",
  reservado:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300",
  vendido:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/12 dark:text-blue-300",
};

/** Uma situação vinda do banco (texto livre) virando uma das cinco. `disponivel` é o fallback. */
export function situacaoConhecida(cru: unknown): SituacaoDaUnidade {
  const t = String(cru ?? "").trim().toLowerCase();
  if (t in CORES_DA_SITUACAO) return t as SituacaoDaUnidade;
  // ⚠️ `includes`, E NÃO `startsWith`. O legado escreve "em negociação" e "unidade vendida": um
  // prefixo perderia as duas, e a unidade em negociação apareceria como disponível — que é
  // exatamente a cor que faz alguém tentar vender um lote que já tem proposta.
  if (t.includes("vend")) return "vendido";
  if (t.includes("reserv")) return "reservado";
  if (t.includes("bloq") || t.includes("indispon")) return "bloqueado";
  if (t.includes("negoc") || t.includes("propost")) return "negociacao";
  // O que não se reconhece cai em disponível, que é o estado neutro — e o rótulo ao lado continua
  // mostrando o texto original, então nada some por causa desta escolha.
  return "disponivel";
}
