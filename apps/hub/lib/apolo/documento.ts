// Validação e formatação de CPF/CNPJ para a EDIÇÃO de identidade na validação do Apolo.
//
// Por que um módulo novo em vez de reusar o que já existe: `cpfValido` mora em asana-ocr.ts
// (que fala com a MOST e não deve ser importado por tela) e **CNPJ não tinha validador nenhum**
// no repositório — a JFL entrou como pessoa física com o CPF do representante justamente
// porque ninguém checava.
//
// Também existem duas funções `documentKind` cegas hoje (cadastro-persist.ts e server.ts) que
// decidem o tipo só pelo tamanho. Aqui a decisão é validada de verdade, mas de propósito NÃO
// mexo naquelas: server.ts é o motor do sync do C2X e mexer ali é risco desnecessário.

export function soDigitos(valor: string): string {
  return String(valor ?? "").replace(/\D/g, "");
}

// CPF: dois dígitos verificadores, módulo 11, pesos decrescentes.
export function cpfValido(valor: string): boolean {
  const d = soDigitos(valor);
  if (d.length !== 11) return false;
  // Sequências iguais (000.000.000-00, 111...) passam no cálculo e não são CPF.
  if (/^(\d)\1{10}$/.test(d)) return false;

  for (const [inicio, posicao] of [
    [10, 9],
    [11, 10],
  ] as const) {
    let soma = 0;
    for (let i = 0; i < posicao; i += 1) soma += Number(d[i]) * (inicio - i);
    const resto = (soma * 10) % 11;
    const digito = resto === 10 ? 0 : resto;
    if (digito !== Number(d[posicao])) return false;
  }
  return true;
}

// CNPJ: módulo 11 com pesos 5..2 e 6..2.
export function cnpjValido(valor: string): boolean {
  const d = soDigitos(valor);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const calcular = (ate: number): number => {
    const pesos = ate === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(d[i]) * pesos[i]!;
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcular(12) === Number(d[12]) && calcular(13) === Number(d[13]);
}

export type TipoDocumento = "cnpj" | "cpf";

// Descobre o tipo pelo que o documento REALMENTE é, não pelo tamanho.
export function tipoDoDocumento(valor: string): TipoDocumento | null {
  if (cpfValido(valor)) return "cpf";
  if (cnpjValido(valor)) return "cnpj";
  return null;
}

// Formato COMPLETO, que é como o sync do C2X grava (4.133 registros) e como a busca do
// Apolo/Iris/CACÁ indexa. Gravar mascarado aqui faria a ficha sumir das buscas.
export function formatarDocumento(valor: string): string {
  const d = soDigitos(valor);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
}

// Coerência entre o tipo da entidade e o documento. PJ com CPF foi exatamente o defeito da
// JFL: empresa cadastrada como pessoa física, com o CPF do sócio.
export function documentoCombinaComTipo(
  entityKind: string,
  documento: string,
): { erro?: string; ok: boolean } {
  const tipo = tipoDoDocumento(documento);
  if (!tipo) return { erro: "Documento invalido (digito verificador nao confere).", ok: false };
  if (entityKind === "pj" && tipo !== "cnpj") {
    return { erro: "Pessoa juridica exige CNPJ.", ok: false };
  }
  if (entityKind === "pf" && tipo !== "cpf") {
    return { erro: "Pessoa fisica exige CPF.", ok: false };
  }
  return { ok: true };
}
