// O LINK DO ESPELHO PÚBLICO — o mapa de lotes que o corretor manda para o cliente.
//
// ⚠️ O LINK É CURTO E LEGÍVEL, E ISSO É REQUISITO. Lucas (10/09/2026): *"o url tem que ser mais
// personalizada, está longa, pode encurtar ela"*. Ele circula por WhatsApp, é lido em voz alta e
// às vezes digitado — um token JWT-like de 70 caracteres não serve:
//
//     antes   c2x.app.br/publico/espelho?e=eyJlIjoiVkxPIiwiayI6ImVzcCJ9.ltfr_4zh_CN9BBGV...
//     agora   c2x.app.br/e/vale-do-ouro-3f9c2a7b
//
// A forma é `<apelido>-<selo>`: o apelido sai do NOME do empreendimento (é o que o cliente
// reconhece) e o selo são 8 caracteres da mesma assinatura HS256 de sempre.
//
// ⚠️ POR QUE 8 CARACTERES DE ASSINATURA BASTAM AQUI, e não bastariam noutro lugar: são 32 bits,
// ou ~4 bilhões de combinações. Isso não protegeria uma sessão — mas aqui o segredo não é o
// CONTEÚDO (preço de tabela e disponibilidade são o que o corretor anuncia), e sim evitar que
// alguém varra `/e/<nome>` e monte um catálogo dos empreendimentos da casa sem ter recebido link
// nenhum. Para esse trabalho, 4 bilhões de tentativas por apelido é barreira de sobra. Nada de
// pessoal viaja nesta URL — é a mesma regra do link da fila do Prometeu.
//
// ⚠️ E O TOKEN NÃO TEM `iat`, AO CONTRÁRIO DOS OUTROS DA CASA. É deliberado: sem `iat` ele é
// DETERMINÍSTICO, e o mesmo empreendimento devolve sempre o mesmo link. O link do espelho é feito
// para ser copiado, colado no WhatsApp e reencontrado depois na aba de Links; com `iat`, cada
// abertura da tela geraria um link novo, todos válidos ao mesmo tempo e nenhum igual ao que já
// circula.
//
// ⚠️ O DISCRIMINANTE `k` É OBRIGATÓRIO. Todos os links públicos do repo assinam com a MESMA
// SESSAO_CAD_SECRET, e o token do telão do Prometeu tem payload `{ e: <uuid>, iat }` — mesma
// forma que este teria sem o `k`. Sem discriminar, um token do telão validaria como espelho.
import { createHmac, timingSafeEqual } from "node:crypto";

// Fixo, e não NEXT_PUBLIC_APP_URL: a env vem errada em alguns ambientes e o link sairia apontando
// para preview. É a mesma decisão de lib/prometeu/link-da-fila.ts.
const BASE_URL = "https://c2x.app.br";

/** `k` discrimina este token dos outros assinados com o mesmo segredo. */
const ESPECIE = "esp";

/** Quantos caracteres da assinatura entram no link curto. Ver o aviso no topo. */
const TAMANHO_DO_SELO = 8;

type EspelhoPayload = { e: string; k: string };

function segredo(): null | string {
  return process.env.SESSAO_CAD_SECRET?.trim() || null;
}

const b64url = (buffer: Buffer): string => buffer.toString("base64url");
const assinar = (conteudo: string, chave: string): string =>
  b64url(createHmac("sha256", chave).update(conteudo).digest());

function corpoDe(codigo: string): string {
  return b64url(
    Buffer.from(JSON.stringify({ e: codigo.trim().toUpperCase(), k: ESPECIE })),
  );
}

/**
 * O apelido do empreendimento na URL.
 *
 * Sai do NOME, e não do código: `vale-do-ouro` diz ao cliente o que ele vai abrir; `vlo` não diz
 * nada a quem está de fora. Acento sai, pontuação vira hífen, e o resultado é minúsculo — é o
 * que sobrevive a ser colado em qualquer lugar.
 */
export function apelidoDoEspelho(nome: string): string {
  return nome
    .normalize("NFD")
    // Tira os acentos, mantendo a letra: "Veredas do Ouro · VOR" → "Veredas do Ouro  VOR".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * O selo — os primeiros caracteres da assinatura do código.
 *
 * `null` quando não há segredo: falha FECHADA, e a tela mostra o aviso em vez de um link que
 * ninguém conseguiria abrir.
 */
export function seloDoEspelho(codigo: string): null | string {
  const chave = segredo();
  const limpo = codigo.trim().toUpperCase();
  if (!chave || !limpo) return null;
  return assinar(corpoDe(limpo), chave)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, TAMANHO_DO_SELO)
    .toLowerCase();
}

/**
 * Confere um link curto e devolve o selo esperado para o código, ou `null`.
 *
 * Quem chama precisa ter resolvido o apelido num empreendimento (é o banco que sabe), e então
 * pergunta aqui se o selo confere. A comparação é em tempo constante.
 */
export function seloConfere(codigo: string, selo: string): boolean {
  const esperado = seloDoEspelho(codigo);
  if (!esperado) return false;
  const a = Buffer.from(esperado);
  const b = Buffer.from(selo.trim().toLowerCase());
  // timingSafeEqual exige mesmo tamanho e nunca `===`: comparação de string vaza o prefixo certo
  // pelo tempo de resposta.
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Separa `vale-do-ouro-3f9c2a7b` em apelido e selo.
 *
 * `null` quando não há selo com o tamanho certo no fim — nesse caso não vale nem consultar o
 * banco.
 */
export function partirLinkCurto(
  caminho: string,
): null | { apelido: string; selo: string } {
  const limpo = caminho.trim().toLowerCase();
  const corte = limpo.lastIndexOf("-");
  if (corte <= 0) return null;

  const selo = limpo.slice(corte + 1);
  const apelido = limpo.slice(0, corte);
  if (selo.length !== TAMANHO_DO_SELO || !apelido) return null;
  if (!/^[a-z0-9]+$/.test(selo)) return null;

  return { apelido, selo };
}

/** A URL curta pronta para copiar. `null` quando não há segredo configurado. */
export function linkDoEspelho(codigo: string, nome: string): null | string {
  const selo = seloDoEspelho(codigo);
  const apelido = apelidoDoEspelho(nome);
  if (!selo || !apelido) return null;
  return `${BASE_URL}/e/${apelido}-${selo}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// O TOKEN LONGO — ainda é ele que as rotas de API usam.
//
// A PÁGINA autoriza pelo link curto; as três rotas que ela chama (arte, geometria, situação)
// continuam recebendo o token completo, que a página passa ao componente. É de propósito: a URL
// curta é para o humano copiar, e as chamadas internas não ganham nada em ser curtas — mas
// ganham em carregar o payload inteiro, sem depender de resolver apelido a cada requisição.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** O token do espelho de um empreendimento. `codigo` é o do PAI — o dono do masterplan. */
export function emitirTokenDoEspelho(codigo: string): null | string {
  const chave = segredo();
  const limpo = codigo.trim().toUpperCase();
  if (!chave || !limpo) return null;
  const corpo = corpoDe(limpo);
  return `${corpo}.${assinar(corpo, chave)}`;
}

/** Devolve o código autorizado pelo token, ou null. */
export function validarTokenDoEspelho(
  token: null | string | undefined,
): null | string {
  const chave = segredo();
  if (!chave || !token) return null;

  const [corpo, assinatura] = token.split(".");
  if (!corpo || !assinatura) return null;

  const a = Buffer.from(assinatura);
  const b = Buffer.from(assinar(corpo, chave));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(corpo, "base64url").toString(),
    ) as EspelhoPayload;
    // O `k` é conferido DEPOIS da assinatura, e a falta dele reprova: é o que impede um token do
    // telão (payload `{e, iat}`, mesmo segredo, assinatura válida) de abrir um espelho.
    if (payload.k !== ESPECIE) return null;
    return typeof payload.e === "string" && payload.e ? payload.e : null;
  } catch {
    return null;
  }
}
