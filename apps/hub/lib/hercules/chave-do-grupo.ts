// A CHAVE DO GRUPO NÃO É O NOME (PAN-124, fatia F4).
//
// Um empreendimento com divisões (pai e filhos do cadastro) é identificado pelo texto
// `group:<chave>`, e esse texto está GRAVADO: medido em 01/10/2026, 33 ocorrências de
// `group:Lagoa Bonita` em vínculos, esteira, documentos, auditoria, links de origem e settings. Até a
// F4 a chave era o NOME do pai, que vai ser editável na tela (F10): renomear "Lagoa Bonita" faria o
// código montar `group:<nome novo>`, e as 33 linhas deixariam de casar. A migration 0203 congela a
// chave na coluna `hercules_empreendimentos.chave_do_grupo` (nasce com o nome do pai no dia do
// primeiro filho e não muda depois).
//
// A REGRA, EM TODO LUGAR QUE MONTA OU CASA `group:`: a chave da coluna; sem ela (pai que ainda não
// é grupo, ou a 0203 não aplicada), o nome do pai, que é o que valia antes e que hoje é idêntico à
// chave nos 5 pais. Nunca o nome quando há chave: é exatamente o renome que a F4 protege.
//
// ⚠️ A CHAVE NÃO SE MOSTRA. Tela e documento mostram o `nome` do pai; quem tem só o id `group:<x>` e
// quer o nome acha o pai pela chave (`paiDaChave`) e mostra o nome dele.

/** Normaliza para casar: sem acento, sem caixa e sem espaço nas pontas. */
function normalizar(texto: string): string {
  return texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

/** A chave do grupo de um pai: a coluna da 0203, ou o nome como reserva. `""` sem os dois. */
export function chaveDoGrupoDe(linha: {
  chaveDoGrupo?: null | string;
  nome?: null | string;
}): string {
  const chave = String(linha.chaveDoGrupo ?? "").trim();
  return chave || String(linha.nome ?? "").trim();
}

/** A chave casa com o sufixo de `group:<x>`? Sem acento e sem caixa, como sempre se casou. */
export function chaveCasa(
  linha: { chaveDoGrupo?: null | string; nome?: null | string },
  sufixo: string,
): boolean {
  const alvo = normalizar(sufixo);
  return alvo !== "" && normalizar(chaveDoGrupoDe(linha)) === alvo;
}

/**
 * O pai (raiz) cuja chave casa com o sufixo de `group:<x>`, ou `null`. É assim que quem só tem o id
 * acha o NOME atual do grupo para mostrar.
 */
export function paiDaChave<T extends { chaveDoGrupo?: null | string; nome?: null | string; paiId?: null | string }>(
  cadastro: readonly T[],
  sufixo: string,
): T | null {
  return cadastro.find((linha) => !linha.paiId && chaveCasa(linha, sufixo)) ?? null;
}

/**
 * O erro do Supabase é "a coluna chave_do_grupo ainda não existe" (0203 não aplicada)?
 *
 * ⚠️ SÓ ESTA COLUNA, e pelo nome dela na mensagem, como `ehColunaDoProdutoAusente`
 * (./produto-novo): 42703 e PGRST204 valem para QUALQUER coluna, e engolir os dois sem olhar o nome
 * faria um erro de digitação virar, calado, um cadastro sem chave.
 */
export function ehColunaDaChaveAusente(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const { code, message } = erro as { code?: unknown; message?: unknown };
  if (code !== "42703" && code !== "PGRST204") return false;
  return typeof message === "string" && message.toLowerCase().includes("chave_do_grupo");
}

// ⚠️ MEMÓRIA CURTA DA 0203 PENDENTE, no molde da 0170 (./cadastro): sem ela, cada leitura faria duas
// requisições e o log do Supabase encheria de "column does not exist". Depois de uma falha, as
// leituras dos próximos 60 s já vão sem a coluna; passado isso, a primeira tenta de novo, e é assim
// que a aplicação da 0203 passa a valer sozinha.
const MEMORIA_DA_0203_MS = 60 * 1000;
let sem0203Ate = 0;

/** Esquece a memória da 0203 pendente (para o teste; e para quem acabou de aplicar a migration). */
export function limparMemoriaDaMigration0203(): void {
  sem0203Ate = 0;
}

/** A 0203 está marcada como pendente agora? Quem monta o select usa isto para nem tentar a coluna. */
export function chaveDoGrupoPendente(agora = Date.now()): boolean {
  return agora < sem0203Ate;
}

/** Marca a 0203 como pendente pelos próximos 60 s. */
export function marcarChaveDoGrupoPendente(agora = Date.now()): void {
  sem0203Ate = agora + MEMORIA_DA_0203_MS;
}

/** A resposta do Supabase, sem tipo de linha: com o select montado em texto, quem chama faz o cast. */
export type RespostaDaLeitura = { data: unknown; error: unknown };

/**
 * Lê com a coluna `chave_do_grupo` acrescentada às `colunas`; se ela ainda não existir, repete sem.
 * Qualquer outro erro volta como veio. `ler` recebe o texto do select.
 */
export async function lerComChaveDoGrupo(
  colunas: string,
  ler: (selecao: string) => PromiseLike<RespostaDaLeitura>,
): Promise<RespostaDaLeitura> {
  if (chaveDoGrupoPendente()) {
    return ler(colunas);
  }

  const comChave = await ler(`${colunas}, chave_do_grupo`);

  if (comChave.error && ehColunaDaChaveAusente(comChave.error)) {
    marcarChaveDoGrupoPendente();
    return ler(colunas);
  }

  return comChave;
}
