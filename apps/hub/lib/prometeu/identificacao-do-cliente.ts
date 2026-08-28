// QUEM É O CLIENTE QUE ACABOU DE SER BIPADO — a linha de identificação da posição de reserva.
//
// O tótem do salão mostra o nome GRANDE (legível a um metro, com fila atrás) e, embaixo, de
// ONDE o cliente veio: a imobiliária que o credenciou e, quando existe, o corretor. O payload
// de /api/prometeu/reserva-touch já traz os dois campos; aqui mora a regra de COMO virar linha.
//
// ⚠️ Regra do Lucas (28/08/2026): "quando não houver imobiliária, não deixe rótulo órfão nem
// espaço vazio estranho". Por isso a função devolve `null` quando não há nada a dizer — a tela
// simplesmente não desenha a linha, em vez de mostrar um rótulo vazio.

export type OrigemDoCliente = {
  corretor?: null | string | undefined;
  imobiliaria?: null | string | undefined;
};

/**
 * O que a tela desenha na linha de origem.
 * `tipo` escolhe o ícone: prédio quando há imobiliária, pessoa quando só há corretor.
 */
export type OrigemExibida = {
  texto: string;
  tipo: "corretor" | "imobiliaria";
};

/** Espaço em branco (inclusive vindo do banco como "   ") não é conteúdo. */
function limpar(valor: null | string | undefined): null | string {
  const texto = String(valor ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  return texto.length > 0 ? texto : null;
}

function mesmoTexto(a: string, b: string): boolean {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" }) === 0;
}

/**
 * Monta a linha de origem do cliente bipado.
 *
 * - imobiliária + corretor → "IMOBILIÁRIA · Corretor" (ícone de prédio)
 * - só imobiliária → "IMOBILIÁRIA" (ícone de prédio)
 * - só corretor → "Corretor" (ícone de pessoa)
 * - nenhum dos dois → `null` (a tela não desenha a linha)
 * - corretor igual à imobiliária (autônomo cadastrado nos dois campos) → não repete
 */
export function origemDoClienteParaExibir(origem: OrigemDoCliente): null | OrigemExibida {
  const imobiliaria = limpar(origem.imobiliaria);
  const corretor = limpar(origem.corretor);

  if (!imobiliaria && !corretor) return null;
  if (!imobiliaria) return { texto: corretor!, tipo: "corretor" };
  if (!corretor || mesmoTexto(corretor, imobiliaria)) {
    return { texto: imobiliaria, tipo: "imobiliaria" };
  }
  return { texto: `${imobiliaria} · ${corretor}`, tipo: "imobiliaria" };
}

/**
 * O "+2" que aparece colado no nome do titular quando a reserva tem mais proponentes.
 * Devolve string vazia com 0 ou 1 proponente — nada de "+0" na tela.
 */
export function sufixoDeProponentes(quantidade: number): string {
  const extras = Math.floor(Number.isFinite(quantidade) ? quantidade : 0) - 1;
  return extras > 0 ? `+${extras}` : "";
}
