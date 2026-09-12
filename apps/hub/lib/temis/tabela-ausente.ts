// "A TABELA AINDA NÃO EXISTE" — a régua, escrita uma vez só.
//
// ⚠️ `42P01` É O CÓDIGO DO POSTGRES, E ELE SÓ APARECE QUANDO A QUERY CHEGA A EXECUTAR. Contra uma
// tabela que não está no schema cache do PostgREST, a Supabase nem manda a query: responde 404 com
// `code: "PGRST205"` e a mensagem `Could not find the table 'public.x' in the schema cache` — que
// não casa com `42P01` nem com `does not exist`. Um guard que testa só esses dois deixa passar
// justamente o caso de HOJE (migration pendente), e cada clique vira um `console.error`.
//
// ⚠️ A CASA JÁ TINHA MEDIDO ISSO. `isChronosSchemaMissingError` (lib/chronos/server.ts) e
// `isGoogleCalendarStorageMissingError` (lib/chronos/google-calendar.ts) tratam os dois códigos e as
// três frases desde o incidente das tabelas do Chronos, e `lib/apolo/server.ts` traduz `PGRST205`
// direto para "tabelas ainda não aplicadas". Este arquivo é a mesma régua, pura e testável, para
// quem não pode importar o Chronos.

/**
 * Os códigos que dizem TABELA, sem ambiguidade nenhuma.
 *
 * ⚠️ `42703` FICOU DE FORA, E A DECISÃO É DELIBERADA. Ele é "coluna não existe", não "tabela não
 * existe" — e as duas causas pedem reações opostas. Tabela ausente é a pendência conhecida da 0153,
 * que se resolve aplicando a migration e cujo lugar é um `console.info` uma vez. Coluna ausente é
 * migration aplicada pela metade, ou erro de digitação no nome de uma das onze colunas do insert —
 * e engolir isso faria o histórico NUNCA ser gravado, calado, para sempre. Falha por silêncio no
 * ponto exato em que a auditoria do contrato vai procurar depois. `42703` continua caindo no
 * `console.error`, que é onde ele tem de doer.
 */
const CODIGOS_DE_TABELA_AUSENTE = new Set(["42P01", "PGRST205"]);

/** As três frases: a do Postgres, a do schema cache e a do PostgREST que não acha a tabela. */
const FRASES_DE_TABELA_AUSENTE = ["does not exist", "schema cache", "could not find"];

/**
 * A mensagem fala de COLUNA?
 *
 * ⚠️ SEM ISTO, O RAMO DA MENSAGEM ENGOLIRIA O ERRO DE COLUNA. O Postgres escreve `column "quem_nome"
 * of relation "temis_trabalho_etapas" does not exist` e o PostgREST escreve `Could not find the
 * 'quem_nome' column of 'temis_trabalho_etapas' in the schema cache` (PGRST204): as duas citam a
 * tabela E uma das frases, e passariam como se a tabela inteira estivesse faltando — desfazendo, pela
 * mensagem, a decisão tomada acima sobre o `42703`.
 */
function falaDeColuna(mensagem: string): boolean {
  return /\bcolumns?\b/i.test(mensagem);
}

/**
 * O erro do Supabase é "esta tabela ainda não existe"?
 *
 * `tabela` é o nome cru (`temis_trabalho_etapas`), e ele existe para estreitar o ramo da mensagem:
 * `does not exist` aparece em erro de papel, de função e de coluna também, e um guard que aceita a
 * frase solta transforma qualquer um deles em silêncio.
 */
export function ehTabelaAusente(erro: unknown, tabela: string): boolean {
  if (!erro || typeof erro !== "object") return false;

  const { code, message } = erro as { code?: unknown; message?: unknown };
  if (typeof code === "string" && CODIGOS_DE_TABELA_AUSENTE.has(code)) return true;

  const mensagem = typeof message === "string" ? message.toLowerCase() : "";
  if (!mensagem || falaDeColuna(mensagem)) return false;

  return (
    mensagem.includes(tabela.toLowerCase()) &&
    FRASES_DE_TABELA_AUSENTE.some((frase) => mensagem.includes(frase))
  );
}
