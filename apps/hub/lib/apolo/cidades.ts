// BUSCA DE CIDADE para o cadastro (naturalidade e endereço).
//
// Pedido do Lucas (21/08/2026): *"esse campo de cidades tem que ser padrão, igual profissão:
// começo a digitar, ele puxa a cidade correta; se quiser colocar um UF antes para mitigar a busca,
// pode colocar"*.
//
// ⚠️ A UF PODE VIR EM QUALQUER LUGAR DO QUE FOI DIGITADO. Uma pessoa escreve "mg joão", outra
// "joão monlevade mg", outra "joão/mg". Exigir uma ordem seria transformar um atalho em pegadinha.
//
// ⚠️ E ELA IMPORTA: medido no C2X, 247 nomes de cidade se repetem entre estados diferentes. Sem a
// UF, quem digita "bom jesus" recebe uma lista de homônimos e escolhe no chute.

export type Cidade = { nome: string; uf: string };

export const UFS = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT",
  "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

const ehUf = (v: string): boolean => (UFS as readonly string[]).includes(v.toUpperCase());

// Sem acento, sem caixa, sem pontuação. É o que faz "sao joao" achar "São João" — e digitar com
// acento no celular, num campo de cadastro, é exatamente o que ninguém faz.
export function normalizar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCidade(linha: string): Cidade {
  const [nome, uf] = linha.split("|");
  return { nome: (nome ?? "").trim(), uf: (uf ?? "").trim().toUpperCase() };
}

/**
 * Separa o que foi digitado em UF (se houver) e termo de busca.
 *
 * ⚠️ SÓ TRATA COMO UF UM TOKEN ISOLADO DE 2 LETRAS. "PA" digitado sozinho é o Pará; mas quem
 * escreve "pará de minas" está começando o nome de uma cidade, e o primeiro token ("para") tem 4
 * letras, então não vira filtro. O caso perigoso é o inverso: tratar as duas primeiras letras de
 * qualquer palavra como UF faria "SP" de "Sapucaia" filtrar São Paulo.
 */
export function separarUf(entrada: string): { termo: string; uf: null | string } {
  const tokens = normalizar(entrada).split(" ").filter(Boolean);
  const indice = tokens.findIndex((t) => t.length === 2 && ehUf(t));

  if (indice === -1) return { termo: tokens.join(" "), uf: null };

  const uf = tokens[indice]!.toUpperCase();
  const resto = [...tokens.slice(0, indice), ...tokens.slice(indice + 1)].join(" ");

  return { termo: resto, uf };
}

/**
 * As cidades que combinam com o que foi digitado, melhores primeiro.
 *
 * Ordem: quem COMEÇA com o termo vem antes de quem apenas o contém — digitar "belo" tem que trazer
 * "Belo Horizonte" antes de "Monte Belo". Empate resolve por nome, para a lista não dançar entre
 * teclas.
 */
export function buscarCidades(
  entrada: string,
  linhas: readonly string[],
  limite = 20,
): Cidade[] {
  const { termo, uf } = separarUf(entrada);

  // Só a UF, sem nome ainda ("mg"): mostra as primeiras daquele estado em vez de nada. É o começo
  // natural de quem usa a UF para estreitar antes de digitar.
  if (!termo && !uf) return [];

  const comecam: Cidade[] = [];
  const contem: Cidade[] = [];

  for (const linha of linhas) {
    const cidade = parseCidade(linha);
    if (uf && cidade.uf !== uf) continue;

    if (!termo) {
      comecam.push(cidade);
      if (comecam.length >= limite) break;
      continue;
    }

    const alvo = normalizar(cidade.nome);
    if (alvo.startsWith(termo)) comecam.push(cidade);
    else if (alvo.includes(termo)) contem.push(cidade);
  }

  const porNome = (a: Cidade, b: Cidade) =>
    a.nome.localeCompare(b.nome, "pt-BR") || a.uf.localeCompare(b.uf);

  return [...comecam.sort(porNome), ...contem.sort(porNome)].slice(0, limite);
}

/**
 * O texto que fica gravado quando o operador escolhe uma cidade.
 *
 * ⚠️ SÓ O NOME, sem a UF. O C2X guarda `users.naturalness` como TEXTO LIVRE e o padrão dominante
 * hoje é o nome puro ("BELO HORIZONTE", 496 registros). Passar a gravar "Belo Horizonte / MG"
 * criaria um segundo formato para o mesmo dado — e há 235 registros que já usam esse outro
 * formato, o que mostra como a divergência nasce.
 *
 * A UF continua aparecendo na SUGESTÃO, que é onde ela resolve a ambiguidade: ela ajuda a escolher
 * certo, não precisa ir para o campo.
 */
export function textoDaCidade(cidade: Cidade): string {
  return cidade.nome;
}
