// O RECIBO DO SINAL, para mandar ao cliente pelo WhatsApp.
//
// ⚠️ ELE SAIU DA FOLHA DA PA (Lucas, 28/08/2026): *"a parte do 'recibo' vamos tirar, pois vou
// mandar o recebido por whatsapp (...) ae ganhamos mais espaço no arquivo"*. Dois ganhos numa
// decisão só: a folha recuperou o espaço que o plano personalizado precisava, e o cliente sai
// do salão com o comprovante no celular, que é onde ele vai procurar depois.
//
// O que a mensagem carrega (pedido dele: *"na mensagem deve ir o recibo, o documento"*): nome e
// CPF de quem pagou, o valor, a forma de pagamento, a data e o descritivo do que foi pago
// (empreendimento, quadra e lote). Sem isso não é recibo, é aviso.
//
// ⚠️ FORMATAÇÃO DO WHATSAPP: negrito é *um asterisco*, não dois. E nada de travessão em texto
// que vai para cliente — regra da casa, e o travessão ainda quebra em alguns teclados.

export type DadosDoRecibo = {
  /** "28 de agosto de 2026" — por extenso, como recibo pede. */
  dataExtensa: string;
  /** CPF ou CNPJ de quem pagou, já formatado. */
  documento: null | string;
  /** PIX, Dinheiro, Cartão... */
  formaDePagamento: null | string;
  lancamento: string;
  /** Nome de quem pagou (o titular da reserva). */
  pagador: string;
  /** O código do cupom, para amarrar o recibo à reserva. */
  referencia: null | string;
  unidades: { lote: string; quadra: string }[];
  valor: number;
};

function moeda(valor: number): string {
  return (
    valor
      .toLocaleString("pt-BR", { currency: "BRL", style: "currency" })
      // ⚠️ O Intl separa "R$" do número com espaço NÃO-QUEBRÁVEL (U+00A0). Ele é invisível no
      // editor e sobrevive ao copiar e colar, então vira um caractere estranho no meio do
      // recibo do cliente — e faz qualquer busca por "R$ 1.000,00" falhar sem explicação.
      .replace(/ /g, " ")
  );
}

const UNIDADES = [
  "zero",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
  "dez",
  "onze",
  "doze",
  "treze",
  "quatorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];
const DEZENAS = [
  "",
  "",
  "vinte",
  "trinta",
  "quarenta",
  "cinquenta",
  "sessenta",
  "setenta",
  "oitenta",
  "noventa",
];
const CENTENAS = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];

/** Até 999. */
function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  if (n < 20) return UNIDADES[n] ?? "";
  if (n < 100) {
    const d = Math.floor(n / 10);
    const r = n % 10;
    return r ? `${DEZENAS[d]} e ${UNIDADES[r]}` : (DEZENAS[d] ?? "");
  }
  const c = Math.floor(n / 100);
  const r = n % 100;
  return r ? `${CENTENAS[c]} e ${ate999(r)}` : (CENTENAS[c] ?? "");
}

/**
 * O valor por extenso, como recibo exige.
 *
 * ⚠️ Cobre até milhões, que é o teto real de um sinal de lote. Acima disso devolve só os
 * centavos e o inteiro sem extenso, em vez de inventar uma escala errada — recibo com valor
 * por extenso errado é pior que recibo sem extenso.
 */
export function valorPorExtenso(valor: number): string {
  const centavos = Math.round((valor - Math.floor(valor)) * 100);
  const inteiro = Math.floor(valor);
  if (inteiro >= 1_000_000_000) return "";

  const partes: string[] = [];
  const milhoes = Math.floor(inteiro / 1_000_000);
  const milhares = Math.floor((inteiro % 1_000_000) / 1000);
  const resto = inteiro % 1000;

  if (milhoes)
    partes.push(
      `${milhoes === 1 ? "um milhão" : `${ate999(milhoes)} milhões`}`,
    );
  if (milhares)
    partes.push(`${milhares === 1 ? "mil" : `${ate999(milhares)} mil`}`);
  if (resto) partes.push(ate999(resto));

  // O "E" ENTRE AS CLASSES segue a regra da língua, e ela olha o ÚLTIMO bloco:
  //
  //   "quatorze mil E novecentos"        (900 é redondo)
  //   "um milhão E quinhentos mil"       (500 mil é redondo)
  //   "mil E vinte"                      (20 é menor que cem)
  //   "um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete"  (sem "e")
  //
  // ⚠️ O que decide é o VALOR do último bloco, não a centena final. A primeira versão olhava
  // sempre o resto das centenas e escrevia "um milhão quinhentos mil reais" — sem o "e" —
  // porque ali o resto era zero.
  const valorDoUltimoBloco =
    resto > 0 ? resto : milhares > 0 ? milhares : milhoes;
  const ultimoBlocoPedeE =
    valorDoUltimoBloco < 100 || valorDoUltimoBloco % 100 === 0;

  let texto = "";
  if (partes.length === 0) texto = "zero";
  else if (partes.length === 1) texto = partes[0] ?? "";
  else {
    const ultimo = partes[partes.length - 1] ?? "";
    const anteriores = partes.slice(0, -1).join(" ");
    texto = ultimoBlocoPedeE
      ? `${anteriores} e ${ultimo}`
      : `${anteriores} ${ultimo}`;
  }

  // ⚠️ "um milhão DE reais", não "um milhão reais": em português, escala seguida de moeda pede
  // a preposição quando o número termina redondo no milhão. Detalhe pequeno, mas é um recibo —
  // e recibo com português torto é o tipo de coisa que o cliente printa e manda no grupo.
  const terminaEmMilhaoRedondo =
    inteiro >= 1_000_000 && inteiro % 1_000_000 === 0;
  const reais =
    inteiro === 1 ? "real" : terminaEmMilhaoRedondo ? "de reais" : "reais";
  if (!centavos) return `${texto} ${reais}`;
  const c = ate999(centavos);
  return `${texto} ${reais} e ${c} ${centavos === 1 ? "centavo" : "centavos"}`;
}

/**
 * A mensagem pronta para colar no WhatsApp.
 *
 * Texto puro, sem link e sem anexo: é o comprovante em si. O cliente guarda no celular e o
 * corretor não precisa lembrar o que escrever.
 */
export function reciboParaWhatsApp(dados: DadosDoRecibo): string {
  const lotes = dados.unidades
    .map((u) => `Quadra ${u.quadra}, Lote ${u.lote}`)
    .join(" · ");
  const extenso = valorPorExtenso(dados.valor);

  const linhas = ["*RECIBO DE SINAL*", "", `Recebemos de *${dados.pagador}*`];

  if (dados.documento) linhas.push(`CPF ${dados.documento}`);

  linhas.push(
    "",
    `a quantia de *${moeda(dados.valor)}*${extenso ? ` (${extenso})` : ""},`,
    dados.formaDePagamento ? `pagos por ${dados.formaDePagamento},` : "",
    `referente ao sinal da proposta de aquisição no *${dados.lancamento}*.`,
    "",
    `*Unidade:* ${lotes}`,
  );

  if (dados.referencia) linhas.push(`*Reserva:* ${dados.referencia}`);

  linhas.push(
    `*Data:* ${dados.dataExtensa}`,
    "",
    "Este recibo comprova o pagamento do sinal. A proposta segue para análise da empreendedora e você será avisado do resultado.",
  );

  // Linhas vazias que sobraram de campo ausente somem; duas seguidas viram uma só.
  return linhas
    .filter((linha, indice, todas) => linha !== "" || todas[indice - 1] !== "")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
