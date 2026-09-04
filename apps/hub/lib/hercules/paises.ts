// OS PAÍSES DO CAMPO DE TELEFONE — bandeira, código e nome para buscar.
//
// Lucas (04/09/2026): *"deixar o telefone no formato do telefone, e habilitar também telefones
// estrangeiros, trazer a bandeira dos países e o código para gente preencher (buscar)"*.
//
// ⚠️ POR QUE UMA LISTA NOVA, se `lib/iris/phone-country.ts` já tem uma. Aquela responde a pergunta
// inversa — "de que país é este número que chegou?" — e para isso bastam código e ISO2. Um SELETOR
// precisa do NOME (é por ele que se busca) e de uma ordem que faça sentido para quem escolhe. O que
// não se duplica é a bandeira: ela continua saindo do ISO2, pela mesma conta de code points.
//
// ⚠️ A LISTA NÃO É O MUNDO INTEIRO, de propósito: são os países de onde vêm compradores da carteira
// (América, Europa ocidental, os de trabalho brasileiro no exterior) mais os grandes. Uma lista de
// 195 linhas com Kiribati e Tuvalu não ajuda ninguém a achar Portugal mais rápido — e quem precisar
// de um ausente digita o código, que o campo aceita.

export type Pais = {
  /** O código de discagem, só dígitos: "55", "1", "351". */
  ddi: string;
  /** ISO 3166-1 alfa-2, de onde sai a bandeira. */
  iso2: string;
  nome: string;
};

/**
 * A bandeira em emoji, a partir do ISO2.
 *
 * Cada letra vira o "regional indicator symbol" correspondente (A = U+1F1E6), e o par forma a
 * bandeira. É a mesma conta de `lib/iris/phone-country.ts`.
 */
export function bandeira(iso2: string): string {
  const limpo = String(iso2 ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(limpo)) return "🌐";
  return String.fromCodePoint(...[...limpo].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** O Brasil vem primeiro porque é o caso de quase toda reserva; o resto, em ordem alfabética. */
export const PAISES: Pais[] = [
  { ddi: "55", iso2: "BR", nome: "Brasil" },
  { ddi: "27", iso2: "ZA", nome: "África do Sul" },
  { ddi: "49", iso2: "DE", nome: "Alemanha" },
  { ddi: "376", iso2: "AD", nome: "Andorra" },
  { ddi: "244", iso2: "AO", nome: "Angola" },
  { ddi: "54", iso2: "AR", nome: "Argentina" },
  { ddi: "61", iso2: "AU", nome: "Austrália" },
  { ddi: "43", iso2: "AT", nome: "Áustria" },
  { ddi: "32", iso2: "BE", nome: "Bélgica" },
  { ddi: "591", iso2: "BO", nome: "Bolívia" },
  { ddi: "1", iso2: "CA", nome: "Canadá" },
  { ddi: "56", iso2: "CL", nome: "Chile" },
  { ddi: "86", iso2: "CN", nome: "China" },
  { ddi: "357", iso2: "CY", nome: "Chipre" },
  { ddi: "57", iso2: "CO", nome: "Colômbia" },
  { ddi: "82", iso2: "KR", nome: "Coreia do Sul" },
  { ddi: "506", iso2: "CR", nome: "Costa Rica" },
  { ddi: "45", iso2: "DK", nome: "Dinamarca" },
  { ddi: "593", iso2: "EC", nome: "Equador" },
  { ddi: "34", iso2: "ES", nome: "Espanha" },
  { ddi: "1", iso2: "US", nome: "Estados Unidos" },
  { ddi: "358", iso2: "FI", nome: "Finlândia" },
  { ddi: "33", iso2: "FR", nome: "França" },
  { ddi: "44", iso2: "GB", nome: "Reino Unido" },
  { ddi: "30", iso2: "GR", nome: "Grécia" },
  { ddi: "502", iso2: "GT", nome: "Guatemala" },
  { ddi: "592", iso2: "GY", nome: "Guiana" },
  { ddi: "31", iso2: "NL", nome: "Holanda" },
  { ddi: "852", iso2: "HK", nome: "Hong Kong" },
  { ddi: "36", iso2: "HU", nome: "Hungria" },
  { ddi: "91", iso2: "IN", nome: "Índia" },
  { ddi: "353", iso2: "IE", nome: "Irlanda" },
  { ddi: "354", iso2: "IS", nome: "Islândia" },
  { ddi: "972", iso2: "IL", nome: "Israel" },
  { ddi: "39", iso2: "IT", nome: "Itália" },
  { ddi: "81", iso2: "JP", nome: "Japão" },
  { ddi: "352", iso2: "LU", nome: "Luxemburgo" },
  { ddi: "60", iso2: "MY", nome: "Malásia" },
  { ddi: "52", iso2: "MX", nome: "México" },
  { ddi: "258", iso2: "MZ", nome: "Moçambique" },
  { ddi: "377", iso2: "MC", nome: "Mônaco" },
  { ddi: "47", iso2: "NO", nome: "Noruega" },
  { ddi: "64", iso2: "NZ", nome: "Nova Zelândia" },
  { ddi: "507", iso2: "PA", nome: "Panamá" },
  { ddi: "595", iso2: "PY", nome: "Paraguai" },
  { ddi: "51", iso2: "PE", nome: "Peru" },
  { ddi: "48", iso2: "PL", nome: "Polônia" },
  { ddi: "351", iso2: "PT", nome: "Portugal" },
  { ddi: "974", iso2: "QA", nome: "Catar" },
  { ddi: "420", iso2: "CZ", nome: "Tchéquia" },
  { ddi: "40", iso2: "RO", nome: "Romênia" },
  { ddi: "7", iso2: "RU", nome: "Rússia" },
  { ddi: "65", iso2: "SG", nome: "Singapura" },
  { ddi: "46", iso2: "SE", nome: "Suécia" },
  { ddi: "41", iso2: "CH", nome: "Suíça" },
  { ddi: "66", iso2: "TH", nome: "Tailândia" },
  { ddi: "598", iso2: "UY", nome: "Uruguai" },
  { ddi: "58", iso2: "VE", nome: "Venezuela" },
  { ddi: "971", iso2: "AE", nome: "Emirados Árabes" },
];

export const BRASIL = PAISES[0] as Pais;

/**
 * Os países que casam com o que a pessoa digitou — por nome ou por código.
 *
 * ⚠️ BUSCA SEM ACENTO, porque ninguém digita "Suíça" com trema quando está com pressa. E o código
 * casa com e sem o "+", que é como as pessoas escrevem.
 */
export function buscarPaises(termo: string): Pais[] {
  const limpo = String(termo ?? "").trim().toLowerCase();
  if (!limpo) return PAISES;

  const semAcento = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const alvo = semAcento(limpo).replace(/^\+/, "");

  return PAISES.filter(
    (p) => semAcento(p.nome).includes(alvo) || p.ddi.startsWith(alvo) || p.iso2.toLowerCase() === alvo,
  );
}

/**
 * O telefone como se lê, dado o país.
 *
 * ⚠️ SÓ O BRASIL TEM MÁSCARA. `(31) 98765-4321` é a forma que todo brasileiro reconhece de
 * imediato; para os outros países cada um tem a sua (e várias mudam por região), e inventar uma
 * máscara errada é pior do que não ter máscara — o número fica com cara de errado quando está
 * certo. Lá o número sai agrupado de três em três, que é como se dita em qualquer lugar.
 */
export function formatarTelefoneDoPais(digitos: string, ddi: string): string {
  const d = String(digitos ?? "").replace(/\D/g, "");
  if (!d) return "";

  if (String(ddi) !== "55") {
    return d.replace(/(\d{1,3})(?=(\d{3})+$)/g, "$1 ").trim();
  }

  if (d.length <= 2) return d.length ? `(${d}` : "";
  const ddd = d.slice(0, 2);
  const corpo = d.slice(2, 11);
  if (corpo.length <= 4) return `(${ddd}) ${corpo}`.trimEnd();
  const quebra = corpo.length > 8 ? 5 : 4;
  return `(${ddd}) ${corpo.slice(0, quebra)}-${corpo.slice(quebra)}`;
}

/**
 * O número pronto para o gateway: só dígitos, com o país na frente.
 *
 * ⚠️ NÃO REPETE O DDI se a pessoa já o digitou. Colar "+55 31 98765-4321" com o Brasil escolhido
 * daria "5555319876..." — um número que não existe, e o erro só apareceria quando a mensagem não
 * chegasse.
 */
export function telefoneComPais(digitos: string, ddi: string): string {
  const d = String(digitos ?? "").replace(/\D/g, "");
  const codigo = String(ddi ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (!codigo) return d;
  return d.startsWith(codigo) && d.length > codigo.length + 6 ? d : `${codigo}${d}`;
}

/**
 * O telefone GUARDADO (E.164, só dígitos com o país) de volta na forma de leitura.
 *
 * ⚠️ É O PAR DE `telefoneComPais`, e existe porque a ficha mostrava `31983013616` — o número certo,
 * escrito de um jeito que ninguém lê de primeira. Formatar na entrada e esquecer a saída deixa o
 * dado bonito só para quem digitou.
 *
 * Brasil sai com a máscara de sempre; estrangeiro sai com o `+código` na frente, porque sem ele um
 * número de fora fica indistinguível de um nacional mal digitado.
 */
export function formatarTelefoneGuardado(valor: null | string | undefined): string {
  const d = String(valor ?? "").replace(/\D/g, "");
  if (!d) return "";

  // 12 ou 13 dígitos começando em 55 é brasileiro com DDI; 10 ou 11 é brasileiro sem ele.
  if ((d.startsWith("55") && (d.length === 12 || d.length === 13)) || d.length === 10 || d.length === 11) {
    const nacional = d.length > 11 ? d.slice(2) : d;
    return formatarTelefoneDoPais(nacional, "55");
  }

  // Estrangeiro: acha o código conhecido mais longo e separa o resto.
  const codigos = [...new Set(PAISES.map((p) => p.ddi))].sort((a, b) => b.length - a.length);
  const ddi = codigos.find((c) => c !== "55" && d.startsWith(c));
  if (!ddi) return formatarTelefoneDoPais(d, "0");

  return `+${ddi} ${formatarTelefoneDoPais(d.slice(ddi.length), ddi)}`.trim();
}
