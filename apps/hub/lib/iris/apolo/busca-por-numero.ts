// Quando o operador digita só números na busca da Iris, o que ele quer dizer?
//
// ⚠️ ONZE DÍGITOS SÃO CPF **E** CELULAR COM DDD. Não dá para adivinhar: 04610713632 é um CPF
// válido e também a cara de um telefone. Por isso a tela PERGUNTA, mostrando o número com as
// duas máscaras — a pessoa reconhece o que digitou de bater o olho.
//
// ⚠️ NA BASE DE HOJE A COLISÃO NÃO ACONTECE: medidos 4.291 CPFs distintos contra 4.227
// telefones de 11 dígitos, ZERO em comum. Isso torna seguro pré-selecionar um dos dois, mas
// NÃO torna seguro escolher sozinho e calar: o primeiro CPF que coincidir com um telefone
// devolveria a pessoa errada, e ninguém perceberia.
//
// CNPJ tem 14 e telefone brasileiro no máximo 13 (55 + DDD + 9 dígitos), então aí não há dúvida.

export type TipoDeNumero = "cnpj" | "cpf" | "telefone";

export type LeituraDoNumero = {
  ambiguo: boolean;
  opcoes: Array<{ mascara: string; tipo: TipoDeNumero }>;
};

export function apenasDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

// Verdadeiro só quando o termo é número puro. "31 99866-2052" conta (pontuação de telefone),
// "Maria 2" não — aí a pessoa está buscando por nome e o número é parte dele.
export function ehSoNumero(termo: string): boolean {
  const limpo = (termo ?? "").trim();

  return limpo.length > 0 && /^[\d\s().+-]+$/.test(limpo);
}

export function mascaraDeCpf(digitos: string): string {
  const d = apenasDigitos(digitos);

  return d.length === 11
    ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
    : d;
}

export function mascaraDeCnpj(digitos: string): string {
  const d = apenasDigitos(digitos);

  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : d;
}

export function mascaraDeTelefone(digitos: string): string {
  const cru = apenasDigitos(digitos);
  const d = cru.length > 11 && cru.startsWith("55") ? cru.slice(2) : cru;

  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }

  return cru;
}

export function interpretarDigitos(termo: string): LeituraDoNumero {
  if (!ehSoNumero(termo)) {
    return { ambiguo: false, opcoes: [] };
  }

  const d = apenasDigitos(termo);

  if (d.length === 14) {
    return { ambiguo: false, opcoes: [{ mascara: mascaraDeCnpj(d), tipo: "cnpj" }] };
  }

  // O caso que obriga a perguntar.
  if (d.length === 11) {
    return {
      ambiguo: true,
      opcoes: [
        { mascara: mascaraDeTelefone(d), tipo: "telefone" },
        { mascara: mascaraDeCpf(d), tipo: "cpf" },
      ],
    };
  }

  if (d.length >= 8 && d.length <= 13) {
    return {
      ambiguo: false,
      opcoes: [{ mascara: mascaraDeTelefone(d), tipo: "telefone" }],
    };
  }

  return { ambiguo: false, opcoes: [] };
}
