// O PAREAMENTO 1-PARA-1 DE DUAS LISTAS DE PESSOAS DO MESMO DOCUMENTO — puro, sem import.
//
// ⚠️ EXTRAÍDO DE `casarAssinantes` (lib/apolo/d4sign-assinaturas.ts), QUE PASSA A DELEGAR PARA CÁ (F3 do
// plano da fonte única). O espelho da D4Sign precisa da MESMA régua para pôr a marca "assinou" na
// pessoa certa do quadro que o C2X mandou: duas cópias dela divergiriam no primeiro conserto, e é
// exatamente o erro que a régua existe para não repetir.
//
// As três passadas, nesta ordem (o porquê de cada uma está em `casarAssinantes`):
//   1. E-MAIL (a chave forte: quem mandou o convite foi o C2X, então o e-mail é o mesmo dos dois lados);
//   2. NOME sem acento, caixa e espaço dobrado;
//   3. a SOBRA, e SÓ quando sobra EXATAMENTE UM de cada lado (palpite, contado à parte).
//
// ⚠️ 1-PARA-1, CONSUMINDO O PAR. Casar por e-mail com um `Map` sem consumir o par faz UM assinante casar
// com N linhas do mesmo e-mail e inventa assinatura (lib/guardian/d4sign-consulta.ts, "CUIDADO COM A
// MEDIÇÃO"). Aqui cada índice de cada lado entra em no máximo um par.

/** O mínimo que o pareamento lê de uma pessoa. */
export type PessoaParaParear = {
  email: null | string;
  nome: string;
};

export type PareamentoDePessoas = {
  /** Índice em `a` → índice em `b`. */
  pares: Map<number, number>;
  /** Índices de `a` casados pela SOBRA ÚNICA (palpite, não fato). Vazio no caminho normal. */
  paresPorPosicao: number[];
  /** Índices de `a` sem par. */
  soNoA: number[];
  /** Índices de `b` sem par. */
  soNoB: number[];
};

/** Tira acento, caixa e espaço dobrado: é o que faz "JOSÉ  DA SILVA" casar com "Jose da Silva". */
export function chaveDeNome(nome: string): string {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function chaveDeEmail(email: null | string): string {
  return String(email ?? "").trim().toLowerCase();
}

/**
 * Pareia `b` (quem o provedor diz) contra `a` (a lista do registro), 1-para-1.
 *
 * ⚠️ A ITERAÇÃO É POR `b`, NA ORDEM DE `b`, e cada pessoa de `b` pega o PRIMEIRO livre de `a` com a
 * mesma chave: é a ordem de `casarAssinantes`, e mudá-la mudaria qual de dois homônimos leva a marca.
 */
export function parearPessoas(
  a: readonly PessoaParaParear[],
  b: readonly PessoaParaParear[],
): PareamentoDePessoas {
  const pares = new Map<number, number>();
  const usadosEmA = new Set<number>();
  const usadosEmB = new Set<number>();

  const porEmail = new Map<string, number[]>();
  const porNome = new Map<string, number[]>();
  a.forEach((pessoa, indice) => {
    const email = chaveDeEmail(pessoa.email);
    if (email) porEmail.set(email, [...(porEmail.get(email) ?? []), indice]);
    const nome = chaveDeNome(pessoa.nome);
    if (nome) porNome.set(nome, [...(porNome.get(nome) ?? []), indice]);
  });

  const primeiroLivre = (indices: undefined | number[]): number | undefined =>
    indices?.find((indice) => !usadosEmA.has(indice));

  const parear = (alvoDe: (pessoa: PessoaParaParear) => number | undefined): void => {
    b.forEach((pessoa, indice) => {
      if (usadosEmB.has(indice)) return;
      const alvo = alvoDe(pessoa);
      if (alvo === undefined) return;
      usadosEmA.add(alvo);
      usadosEmB.add(indice);
      pares.set(alvo, indice);
    });
  };

  parear((p) => {
    const email = chaveDeEmail(p.email);
    return email ? primeiroLivre(porEmail.get(email)) : undefined;
  });
  parear((p) => primeiroLivre(porNome.get(chaveDeNome(p.nome))));

  const sobraA = a.map((_, i) => i).filter((i) => !usadosEmA.has(i));
  const sobraB = b.map((_, i) => i).filter((i) => !usadosEmB.has(i));

  // ⚠️ SÓ 1 × 1. Com dois ou mais sobrando de cada lado o par seria por índice, e as duas ordens não
  // são a mesma (o C2X vem por `after_position`, a D4Sign na ordem do convite, sem campo de ordem).
  const unicoA = sobraA.length === 1 ? sobraA[0] : undefined;
  const unicoB = sobraB.length === 1 ? sobraB[0] : undefined;
  if (unicoA !== undefined && unicoB !== undefined) {
    pares.set(unicoA, unicoB);
    return { pares, paresPorPosicao: [unicoA], soNoA: [], soNoB: [] };
  }

  return { pares, paresPorPosicao: [], soNoA: sobraA, soNoB: sobraB };
}
