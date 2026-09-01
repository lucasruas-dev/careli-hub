// NÚMERO POR EXTENSO — para o contrato escrever "R$ 185.400,00 (cento e oitenta e cinco mil e
// quatrocentos reais)" sem ninguém digitar.
//
// POR QUE ISTO EXISTE. As minutas usam `[valor_imovel_venda_extenso]` e `[area_lote_extenso]`, e o
// legado nunca preencheu esses campos (medido: `extensive_area` vazio nas 5.528 unidades). Como o
// Lucas resumiu: *"é pegar o valor da area e transformar ele em texto"*.
//
// ⚠️ A UNIDADE NÃO ENTRA AQUI, E ISSO É O PONTO MAIS IMPORTANTE DO ARQUIVO. Estas funções devolvem
// só o número escrito — "trezentos", "cento e oitenta e cinco mil e quatrocentos". Quem escreve
// "metros quadrados" ou "reais" é `areaPorExtenso`/`dinheiroPorExtenso`, e nunca as duas coisas ao
// mesmo tempo. No contrato real do Villa Paris saiu **"300,00 m² (trezentos metros quadrados metros
// quadrados)"**, porque o dado guardado já trazia a unidade e o template acrescentou de novo. Só há
// uma forma de isso não acontecer: um único lugar decide, e é este.
//
// ⚠️ AQUI SE ESCREVE "UM MIL", E É DELIBERADO. Na fala corrente diz-se "mil reais"; em documento
// financeiro a convenção é "um mil reais" — a mesma razão do cheque: a palavra na frente não deixa
// espaço para alguém acrescentar um dígito. Decisão do Lucas (01/09/2026): *"o correto é usar um
// mil"*. Vale para a classe do milhar; milhão e bilhão já carregam o "um" naturalmente.
//
// ⚠️ As demais regras: "cem" sozinho, mas "cento e um"; e o "e" antes da última classe só entra em
// alguns casos. Cada uma tem teste, porque valor por extenso errado num contrato é o tipo de coisa
// que o cartório devolve e o cliente questiona.

const UNIDADES = [
  "", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove",
  "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete",
  "dezoito", "dezenove",
];

const DEZENAS = [
  "", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa",
];

// ⚠️ "cem" é exato; qualquer coisa acima vira "cento e ...". A posição 1 aqui é "cento" de
// propósito, e o caso de 100 exato é tratado à parte.
const CENTENAS = [
  "", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos",
  "seiscentos", "setecentos", "oitocentos", "novecentos",
];

const CLASSES: { plural: string; singular: string }[] = [
  { plural: "", singular: "" },
  { plural: "mil", singular: "mil" },
  { plural: "milhões", singular: "milhão" },
  { plural: "bilhões", singular: "bilhão" },
  { plural: "trilhões", singular: "trilhão" },
];

/** Escreve um grupo de até três dígitos (1 a 999). */
function grupoPorExtenso(n: number): string {
  if (n <= 0 || n > 999) return "";
  if (n === 100) return "cem";

  const centena = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];

  if (centena > 0) partes.push(CENTENAS[centena]!);

  if (resto > 0) {
    if (resto < 20) partes.push(UNIDADES[resto]!);
    else {
      const dezena = Math.floor(resto / 10);
      const unidade = resto % 10;
      partes.push(unidade > 0 ? `${DEZENAS[dezena]} e ${UNIDADES[unidade]}` : DEZENAS[dezena]!);
    }
  }

  return partes.join(" e ");
}

/**
 * O número inteiro por extenso, SEM unidade.
 *
 * `inteiroPorExtenso(185400)` → "cento e oitenta e cinco mil e quatrocentos"
 * `inteiroPorExtenso(1000)`   → "um mil"
 */
export function inteiroPorExtenso(valor: number): string {
  const n = Math.trunc(Math.abs(valor));
  if (n === 0) return "zero";

  // Quebra em grupos de três, do menos significativo para o mais.
  const grupos: number[] = [];
  let resto = n;
  while (resto > 0) {
    grupos.push(resto % 1000);
    resto = Math.floor(resto / 1000);
  }

  const escritos: string[] = [];
  for (let i = grupos.length - 1; i >= 0; i -= 1) {
    const g = grupos[i]!;
    if (g === 0) continue;

    const classe = CLASSES[i];
    if (!classe) continue;

    // ⚠️ "um mil", e não "mil". Ver a nota do topo: é a convenção de documento financeiro.
    if (i === 1 && g === 1) escritos.push("um mil");
    else if (i === 0) escritos.push(grupoPorExtenso(g));
    else escritos.push(`${grupoPorExtenso(g)} ${g === 1 ? classe.singular : classe.plural}`.trim());
  }

  if (escritos.length === 1) return escritos[0]!;

  // ⚠️ A REGRA DO "E" ANTES DA ÚLTIMA CLASSE. Entra quando o último grupo é menor que 100 ou é
  // centena redonda: "mil e quatrocentos", "dois milhões e cem". Não entra quando o último grupo
  // tem centena com resto: "mil duzentos e trinta e quatro".
  const ultimo = grupos[0]!;
  const ligaComE = ultimo > 0 && (ultimo < 100 || ultimo % 100 === 0);
  const cabeca = escritos.slice(0, -1).join(", ");
  const cauda = escritos[escritos.length - 1]!;
  return ligaComE ? `${cabeca} e ${cauda}` : `${cabeca} ${cauda}`;
}

/**
 * Valor em dinheiro por extenso, com "reais" e "centavos".
 *
 * `dinheiroPorExtenso(185400)`   → "cento e oitenta e cinco mil e quatrocentos reais"
 * `dinheiroPorExtenso(1234.56)`  → "um mil duzentos e trinta e quatro reais e cinquenta e seis centavos"
 * `dinheiroPorExtenso(1)`        → "um real"
 */
export function dinheiroPorExtenso(valor: number): string {
  const total = Math.round(Math.abs(valor) * 100);
  const inteiros = Math.floor(total / 100);
  const centavos = total % 100;

  const partes: string[] = [];
  if (inteiros > 0) {
    partes.push(`${inteiroPorExtenso(inteiros)} ${inteiros === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) {
    partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  }
  // Zero real é valor legítimo em contrato (parcela de ato R$ 0,00 existe no C2X).
  if (!partes.length) return "zero reais";
  return partes.join(" e ");
}

/**
 * Área por extenso, em metros quadrados.
 *
 * ⚠️ A PARTE DECIMAL DA ÁREA É DECÍMETRO QUADRADO, e não "vírgula alguma coisa". É como escritura e
 * matrícula escrevem, e é o que o registro de imóveis espera ler.
 *
 * `areaPorExtenso(300)`     → "trezentos metros quadrados"
 * `areaPorExtenso(302.45)`  → "trezentos e dois metros quadrados e quarenta e cinco decímetros quadrados"
 * `areaPorExtenso(1)`       → "um metro quadrado"
 */
export function areaPorExtenso(valor: number): string {
  const total = Math.round(Math.abs(valor) * 100);
  const inteiros = Math.floor(total / 100);
  const decimos = total % 100;

  const partes: string[] = [];
  if (inteiros > 0) {
    partes.push(`${inteiroPorExtenso(inteiros)} ${inteiros === 1 ? "metro quadrado" : "metros quadrados"}`);
  }
  if (decimos > 0) {
    partes.push(
      `${inteiroPorExtenso(decimos)} ${decimos === 1 ? "decímetro quadrado" : "decímetros quadrados"}`,
    );
  }
  if (!partes.length) return "zero metros quadrados";
  return partes.join(" e ");
}

/**
 * Número de parcelas por extenso, para "em 120 (cento e vinte) parcelas".
 *
 * Sem unidade de propósito: quem chama escreve "parcelas", "meses" ou o que o contrato pedir.
 */
export function quantidadePorExtenso(valor: number): string {
  return inteiroPorExtenso(valor);
}
