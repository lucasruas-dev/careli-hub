// Casa TEXTO LIVRE com as listas padronizadas do C2X.
//
// O formulário do Asana é escrita livre ("Comerciante", "Pedreiro", "2 grau completo") e o
// cadastro do C2X trabalha com id de lista fechada (234 profissões, 9 escolaridades, 6 faixas
// de renda). Sem esta ponte, o dado do formulário não vira cadastro — o operador teria que
// reescolher tudo na mão, item por item.
//
// REGRA GERAL: na dúvida, devolver null. Um campo vazio o operador preenche em segundos; um
// campo preenchido ERRADO ele provavelmente não percebe, e vira dado sujo no cadastro — e
// profissão e renda entram na análise de crédito.
import { C2X_ESCOLARIDADE, C2X_FAIXA_RENDA, type C2xOption } from "./c2x-fields";
import { C2X_PROFISSOES } from "./c2x-professions";

function normalizar(valor: string | null | undefined): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(a\)|\(o\)/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Distância de edição, para tolerar erro de digitação do corretor.
function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    for (let j = 1; j <= b.length; j += 1) {
      atual[j] = Math.min(
        (atual[j - 1] ?? 0) + 1,
        (anterior[j] ?? 0) + 1,
        (anterior[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    anterior = atual;
  }
  return anterior[b.length] ?? 0;
}

function similar(a: string, b: string): number {
  const maior = Math.max(a.length, b.length);
  return maior === 0 ? 1 : 1 - distancia(a, b) / maior;
}

// Casa contra uma lista do C2X. Exige limiar ALTO: "Pedreiro" não pode virar "Padeiro".
function casarNaLista(
  texto: string | null | undefined,
  lista: C2xOption[],
  limiar = 0.86,
): number | null {
  const alvo = normalizar(texto);
  if (!alvo || alvo.length < 3) return null;

  let melhor: { id: number; score: number } | null = null;

  for (const opcao of lista) {
    const candidato = normalizar(opcao.label);
    // Igualdade exata ganha de tudo.
    if (candidato === alvo) return opcao.id;

    // A lista tem termos compostos ("AUXILIAR DE PRODUÇÃO"); conter o texto inteiro conta
    // como forte indício, mas só quando o texto tem tamanho suficiente para não ser genérico.
    const contido =
      alvo.length >= 5 && (candidato.includes(alvo) || alvo.includes(candidato));

    const score = contido ? Math.max(0.9, similar(alvo, candidato)) : similar(alvo, candidato);
    if (!melhor || score > melhor.score) melhor = { id: opcao.id, score };
  }

  return melhor && melhor.score >= limiar ? melhor.id : null;
}

export function matchProfissaoId(texto: string | null | undefined): number | null {
  return casarNaLista(texto, C2X_PROFISSOES);
}

// Escolaridade tem sinônimos que a distância de edição não pega ("2 grau" x "Médio").
export function matchEscolaridadeId(texto: string | null | undefined): number | null {
  const v = normalizar(texto);
  if (!v) return null;

  if (v.includes("analfabet")) return 1;
  if (v.includes("doutorad")) return 9;
  if (v.includes("mestrad")) return 8;

  const incompleto = v.includes("incomplet") || v.includes("cursando");
  if (v.includes("superior") || v.includes("faculdade") || v.includes("graduacao")) {
    return incompleto ? 6 : 7;
  }
  if (v.includes("medio") || v.includes("2 grau") || v.includes("segundo grau")) {
    return incompleto ? 4 : 5;
  }
  if (v.includes("fundamental") || v.includes("1 grau") || v.includes("primeiro grau")) {
    return incompleto ? 2 : 3;
  }

  return casarNaLista(texto, C2X_ESCOLARIDADE);
}

// ⚠️ Salário mínimo usado para converter renda em FAIXA. Precisa ser revisto todo ano — se
// ficar desatualizado, a faixa sai errada e a análise de crédito enxerga renda menor do que a
// real. É o único número aqui que envelhece sozinho.
export const SALARIO_MINIMO_REFERENCIA = 1518;

// "4500" → faixa em salários. Aceita "R$ 4.500,00", "4500,00" e "4.500".
export function matchFaixaRendaId(
  texto: string | null | undefined,
  salarioMinimo = SALARIO_MINIMO_REFERENCIA,
): number | null {
  const bruto = String(texto ?? "").trim();
  if (!bruto) return null;

  // Se já veio como faixa escrita ("3 a 6 salários"), casa direto na lista.
  if (/salario/i.test(normalizar(bruto))) {
    return casarNaLista(bruto, C2X_FAIXA_RENDA, 0.8);
  }

  // Número em formato brasileiro: tira separador de milhar, vírgula vira ponto.
  const numero = Number.parseFloat(
    bruto.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."),
  );
  if (!Number.isFinite(numero) || numero <= 0) return null;

  const salarios = numero / salarioMinimo;
  if (salarios < 1) return 1;
  if (salarios <= 3) return 2;
  if (salarios <= 6) return 3;
  if (salarios <= 9) return 4;
  if (salarios <= 12) return 5;
  return 6;
}
