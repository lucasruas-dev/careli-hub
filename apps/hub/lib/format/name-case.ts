// Regra GLOBAL do Hub (Lucas, 13/jul): todo dado exibido segue "Primeira Maiúscula".
// As fontes legadas (C2X) vêm em CAIXA ALTA — a normalização é na exibição, nunca no dado.
//
// Conectivos ficam minúsculos ("Praia da Saudade"), e o que é claramente sigla/acrônimo
// (LTDA, SPE, ME, CPF...) é preservado em caixa alta.

const CONNECTORS = new Set([
  "a",
  "as",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "o",
  "os",
  "para",
  "por",
]);

const ACRONYMS = new Set([
  "cnpj",
  "cpf",
  "eireli",
  "epp",
  "ltda",
  "me",
  "mei",
  "s.a",
  "sa",
  "spe",
]);

export function toTitleCase(value?: string | null): string {
  const normalized = value?.trim();

  if (!normalized) {
    return "";
  }

  return normalized
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .map((word, index) => {
      if (ACRONYMS.has(word)) {
        return word.toLocaleUpperCase("pt-BR");
      }

      // Conectivo no meio do nome fica minúsculo; no começo, capitaliza.
      if (index > 0 && CONNECTORS.has(word)) {
        return word;
      }

      // Capitaliza depois de hífen/apóstrofo também (ex.: "D'Angelo", "Santa-Rita").
      return word.replace(/(^|[-'`])(\p{L})/gu, (_, prefix: string, letter: string) => {
        return `${prefix}${letter.toLocaleUpperCase("pt-BR")}`;
      });
    })
    .join(" ");
}
