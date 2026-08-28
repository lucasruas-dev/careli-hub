// PROFISSÃO: a lista do C2X e o que o cliente DECLAROU são duas coisas diferentes.
//
// Pedido do Lucas (27/08): "na profissão, quando eu importo a cad, o pessoal está com dificuldades
// de achar a profissão, por isso, coloca uma opção outro para eles digitarem, na validação e
// padronizo". Quem preenche a CAD não acha a profissão entre as 234 do C2X e trava; agora ele pode
// digitar, e o backoffice escolhe a equivalente da lista na tela de VALIDAÇÃO.
//
// ⚠️ POR QUE UM CAMPO NOVO, E NÃO UM VALOR ESPECIAL DENTRO DE `profissaoId`.
// No C2X, `users.profession_id` é bigint FK (DEFAULT 25 = "PROFISSÃO NÃO DECLARADA"). O payload de
// escrita manda o RÓTULO de um id da lista e o Rails o resolve de volta para o número. Existem 7
// conversores id↔rótulo espalhados pelo repo (c2x-integracao, c2x-write, c2x-write-server,
// cad-de-entidade, incorporador/ficha-cadastro e dois no server.ts) e TODO caminho que exibe ou
// envia profissão passa por um deles. Texto livre dentro de `profissaoId` quebraria em algum
// caminho que ninguém olhou — por isso ele mora em `profissaoOutro`, separado, e NUNCA vai ao C2X.
//
// A regra de ouro deste arquivo: o C2X só recebe rótulo de id válido (`profissaoParaC2x`). Sem id,
// o campo vai vazio e o próprio C2X aplica o default dele — que é exatamente o comportamento de
// hoje para profissão em branco. Nada regride.

import { C2X_PROFISSOES } from "./c2x-professions";
import { C2X_PROFISSAO_NAO_DECLARADA, normalizeSearch, titleCase } from "./c2x-fields";

// Marca que acompanha o texto livre onde quer que a ficha seja lida por gente: o operador precisa
// enxergar, sem clicar em nada, que aquela profissão ainda não é a do catálogo.
export const MARCA_A_PADRONIZAR = "(a padronizar)";

// Teto do texto livre. É um nome de profissão, não um campo de observação: sem limite, uma colagem
// acidental viraria um parágrafo dentro da ficha e do PDF da CAD.
export const LIMITE_PROFISSAO_LIVRE = 80;

const texto = (valor: unknown): string =>
  typeof valor === "string" ? valor.trim() : valor == null ? "" : String(valor).trim();

/**
 * Limpa o que foi digitado: espaços colapsados e teto de caracteres. É o formato ÚNICO que entra
 * no estado, no metadata e na ficha — assim a comparação com a lista é estável.
 */
export function normalizarProfissaoLivre(valor: unknown): string {
  return texto(valor).replace(/\s+/g, " ").slice(0, LIMITE_PROFISSAO_LIVRE).trim();
}

/**
 * Rótulo do catálogo a partir do id (string ou número), como `opcao`/`label` nos demais leitores.
 *
 * Compara por texto E por número de propósito: os 7 conversores espalhados pelo repo se dividem
 * entre `String(o.id) === id` e `o.id === Number(id)`, e um id gravado como "04" casaria só no
 * segundo. Aceitar os dois é o que deixa este arquivo substituir qualquer um deles sem mudar
 * resultado — nenhuma ficha que hoje resolve passa a não resolver.
 */
export function rotuloDaProfissao(profissaoId: unknown): string {
  const alvo = texto(profissaoId);
  if (!alvo) return "";
  const porTexto = C2X_PROFISSOES.find((opcao) => String(opcao.id) === alvo);
  if (porTexto) return porTexto.label;
  const numero = Number(alvo);
  if (!Number.isFinite(numero)) return "";
  return C2X_PROFISSOES.find((opcao) => opcao.id === numero)?.label ?? "";
}

/**
 * O texto digitado É uma profissão do catálogo (só escrita de outro jeito)? Devolve o id.
 *
 * Serve para não deixar nascer pendência à toa: quem digita "advogado" em vez de achar
 * "ADVOGADO(A)" na busca sai da tela já padronizado, e a validação não recebe trabalho inventado.
 */
export function casarProfissaoNaLista(valorLivre: unknown): string {
  const alvo = normalizeSearch(normalizarProfissaoLivre(valorLivre));
  if (!alvo) return "";
  const achado = C2X_PROFISSOES.find((opcao) => normalizeSearch(opcao.label) === alvo);
  return achado ? String(achado.id) : "";
}

/** Existe profissão (padronizada OU declarada)? É o que habilita o avançar do wizard. */
export function temProfissao(profissaoId: unknown, profissaoOutro: unknown): boolean {
  return Boolean(texto(profissaoId) || normalizarProfissaoLivre(profissaoOutro));
}

/**
 * O id 25 é "PROFISSÃO NÃO DECLARADA" — o VAZIO do C2X, não uma profissão.
 *
 * 🔴 POR QUE ISTO EXISTE (revisão de 27/08). Ele é o DEFAULT da FK `users.profession_id` e já é o
 * valor de 803 pessoas da base. Sem esta regra, a pendência sumia sozinha exatamente no caso mais
 * comum: cliente que já existe no legado volta da leitura ao vivo com `profissaoId: "25"`, o merge
 * da validação o coloca por cima do que veio do cadastro, e "tem id" seria lido como "alguém já
 * padronizou" — moldura âmbar embora, tarefa invisível, e o texto que o cliente declarou virando
 * nota de rodapé. Pior: depois que a própria CAD sobe sem padronização, o C2X grava o 25 e a
 * pendência desaparecia para sempre, num caminho de mão única (o envio só faz POST).
 *
 * Para PADRONIZAR, portanto, 25 é o mesmo que vazio. `profissaoParaC2x` NÃO muda: mandar o rótulo
 * do 25 é idêntico ao que o C2X faria sozinho.
 */
export function ehProfissaoNaoDeclarada(profissaoId: unknown): boolean {
  const alvo = texto(profissaoId);
  return Boolean(alvo) && Number(alvo) === C2X_PROFISSAO_NAO_DECLARADA;
}

/** Falta padronizar: o cliente declarou algo e ninguém escolheu a profissão equivalente ainda. */
export function profissaoPendenteDePadronizacao(
  profissaoId: unknown,
  profissaoOutro: unknown,
): boolean {
  if (!normalizarProfissaoLivre(profissaoOutro)) return false;
  return !texto(profissaoId) || ehProfissaoNaoDeclarada(profissaoId);
}

/**
 * O que a ficha MOSTRA. A padronizada ganha; sem ela, o texto do corretor aparece marcado — a
 * pendência tem que ser visível em toda tela que lê a ficha, não só na validação.
 */
export function profissaoExibida(profissaoId: unknown, profissaoOutro: unknown): string {
  const livre = normalizarProfissaoLivre(profissaoOutro);
  // Pendente ganha do rótulo: com o id 25 ("não declarada") vindo do C2X, mostrar o rótulo dele
  // seria trocar o que o cliente DECLAROU por um campo em branco com outro nome.
  if (profissaoPendenteDePadronizacao(profissaoId, profissaoOutro)) {
    return `${titleCase(livre)} ${MARCA_A_PADRONIZAR}`;
  }
  const rotulo = rotuloDaProfissao(profissaoId);
  if (rotulo) return titleCase(rotulo);
  return livre ? `${titleCase(livre)} ${MARCA_A_PADRONIZAR}` : "";
}

/**
 * O texto original, para exibir ao LADO da profissão já padronizada. Devolve vazio quando não há
 * nada a dizer: sem texto livre, ou quando ele é só a mesma profissão escrita de outro jeito.
 *
 * Item 5 do desenho: o que o cliente declarou não pode se perder ao ser padronizado.
 */
export function profissaoDeclarada(profissaoId: unknown, profissaoOutro: unknown): string {
  const livre = normalizarProfissaoLivre(profissaoOutro);
  if (!livre) return "";
  // Ainda pendente (id vazio ou o 25 do C2X): o texto é o valor PRINCIPAL, não uma observação —
  // quem mostra é `profissaoExibida`, e repeti-lo aqui viraria a mesma linha duas vezes.
  if (profissaoPendenteDePadronizacao(profissaoId, profissaoOutro)) return "";
  const rotulo = rotuloDaProfissao(profissaoId);
  if (!rotulo) return "";
  if (normalizeSearch(rotulo) === normalizeSearch(livre)) return "";
  return titleCase(livre);
}

/**
 * O QUE VAI PARA O C2X. Só o rótulo de um id do catálogo — texto livre, JAMAIS.
 *
 * `null` (sem id) deixa o campo fora do payload e o C2X aplica o default dele
 * ("PROFISSÃO NÃO DECLARADA", id 25), que é o comportamento atual da profissão vazia.
 */
export function profissaoParaC2x(profissaoId: unknown): null | string {
  return rotuloDaProfissao(profissaoId) || null;
}
