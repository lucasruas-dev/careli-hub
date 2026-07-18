// Busca de endereço por CEP (ViaCEP — público, sem chave). Usado no preenchimento manual do
// endereço quando a MOST não leu o comprovante: o operador digita o CEP e o resto vem sozinho.

export type EnderecoCep = {
  bairro: string;
  cidade: string;
  logradouro: string;
  uf: string;
};

export function soDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

// Devolve o endereço do CEP, ou null se o CEP for inválido/não encontrado. Nunca lança —
// é best-effort: se a busca falhar, o operador preenche na mão.
export async function buscarEnderecoPorCep(cep: string): Promise<EnderecoCep | null> {
  const digits = soDigitos(cep);
  if (digits.length !== 8) return null;

  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      bairro?: string;
      erro?: boolean;
      localidade?: string;
      logradouro?: string;
      uf?: string;
    };
    if (data.erro) return null;
    return {
      bairro: data.bairro ?? "",
      cidade: data.localidade ?? "",
      logradouro: data.logradouro ?? "",
      uf: data.uf ?? "",
    };
  } catch {
    return null;
  }
}
