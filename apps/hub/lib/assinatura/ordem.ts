import { PAPEIS, PAPEIS_DO_CONTRATO, type PapelNoContrato, type Signatario } from "./tipos";

// A ORDEM DE ASSINATURA — quem assina primeiro, e quem espera.
//
// Lucas, 07/09/2026: *"eu uso bastante a ordem de assinatura, ou seja, temos que ter isso também —
// de ter ou não a ordem; se ter, eu apontar essa ordem. (não sei onde isso ia existir) se é na
// geração, ou deixa fixo por empreendimento. Só sei que isso hoje traz um trabalho enorme para
// gente, pois fazemos isso de forma manual."*
//
// ⚠️ O TRABALHO MANUAL É O PROBLEMA A RESOLVER, e ele não é digitar: é LEMBRAR. Hoje alguém abre o
// D4Sign a cada contrato e numera os signatários um por um. Errar a ordem não trava nada — o
// contrato sai, o cliente assina antes da vendedora, e só se descobre quando o jurídico confere.
//
// ── ONDE A REGRA MORA ────────────────────────────────────────────────────────
//
// Na CATEGORIA, com queda para o empreendimento — a mesma cadeia da minuta (0140) e da vendedora
// (0141):
//
//     unidade → categoria → regra de ordem          o recorte que assina diferente
//              ↘ sem categoria → o empreendimento   o caso de todo dia
//
// ⚠️ POR QUE NÃO NA GERAÇÃO, que foi a outra hipótese do Lucas. Porque na geração a pergunta volta a
// cada contrato, e é exatamente aí que se erra por pressa. A ordem de assinatura de um produto não
// muda de venda para venda: ela muda quando o incorporador muda de política — e aí muda para todos
// os contratos daquele produto de uma vez, que é o comportamento certo.
//
// ⚠️ E POR QUE POR PAPEL, e não por pessoa. Quem assina muda a cada venda (outro comprador, outro
// cônjuge, às vezes três compradores); o que NÃO muda é "a vendedora assina depois dos compradores".
// Uma lista de pessoas envelheceria no primeiro contrato; uma lista de papéis vale para a carteira
// inteira.

/**
 * A regra de ordem de um recorte.
 *
 * ⚠️ `ordenada: false` NÃO É "SEM REGRA", é uma decisão: todos assinam ao mesmo tempo. Os dois
 * provedores tratam isso como ordem 0 para todo mundo, e é o que a maioria dos contratos usa hoje.
 */
export type RegraDeOrdem = {
  ordenada: boolean;
  /**
   * O número de cada papel. ⚠️ MESMO NÚMERO = ASSINAM JUNTOS.
   *
   * ⚠️ ISTO ERA UMA FILA, E VIROU UM NÚMERO POR PAPEL. Lucas, 13/09/2026: *"tem uma situação que
   * eu preciso colocar o comprador como primeiro e todos os outros depois"*, *"eu posso colocar o
   * comprador como 1 e o resto como 2"* e, fechando: *"essa personalização é bem comum para
   * gente"*.
   *
   * A lista de papéis anterior era uma PERMUTAÇÃO: cada papel ganhava um número próprio, 1, 2, 3,
   * 4, 5 — e não havia como dizer "estes três ao mesmo tempo, depois do comprador". Com seis
   * papéis, a única coisa que a tela sabia montar era uma fila de seis degraus, que é o contrário
   * do que a casa faz na mão.
   */
  ordens: Record<PapelNoContrato, number>;
};

/** O número canônico de cada papel: a posição dele em `PAPEIS`, começando em 1. */
function ordensCanonicas(): Record<PapelNoContrato, number> {
  return Object.fromEntries(PAPEIS.map((p, i) => [p, i + 1])) as Record<
    PapelNoContrato,
    number
  >;
}

/**
 * O padrão da casa, quando ninguém configurou nada.
 *
 * É a ordem que o Lucas faz hoje na mão, e ela tem uma lógica: o COMPRADOR assina primeiro porque é
 * ele que pode desistir — colher a assinatura da vendedora antes gastaria a formalidade do lado de
 * cá num contrato que talvez não aconteça. As TESTEMUNHAS vão por último porque testemunham um
 * documento já assinado pelas partes.
 *
 * ⚠️ MAS O PADRÃO NASCE DESLIGADO (`ordenada: false`). Ligar a ordem em toda a carteira de uma vez
 * mudaria o comportamento de contratos que hoje saem em paralelo, sem ninguém ter pedido — e o
 * sintoma seria contrato "parado" esperando alguém que antes assinava a qualquer hora.
 */
export const ORDEM_PADRAO: RegraDeOrdem = {
  ordenada: false,
  ordens: ordensCanonicas(),
};

/** O teto de um número de ordem. Sanidade de formato: fila de assinatura não tem 100 degraus. */
export const ORDEM_MAXIMA = 20;

/**
 * Distribui a ordem entre quem assina.
 *
 * ⚠️ MESMO PAPEL, MESMO NÚMERO. Três compradores assinam em paralelo entre si e todos antes da
 * vendedora — pôr um comprador para esperar o outro é o que transforma uma venda de casal numa fila
 * de dois dias. Os dois provedores entendem número repetido como "ao mesmo tempo".
 *
 * ⚠️ E OS NÚMEROS SÃO COMPACTADOS, MAS OS EMPATES SOBREVIVEM. Se o contrato não tem cônjuge nem
 * corretor, o que sobra vira 1, 2, 3 — e não 1, 3, 6: a Clicksign aceita buracos, o D4Sign se
 * confunde com eles, e a tela mostraria degraus que não significam nada. O que a compactação NÃO
 * pode fazer é desempatar: cadastrar comprador 1 e os outros cinco 2 tem de sair 1 e 2, e nunca
 * 1, 2, 3, 4, 5, 6 — senão a configuração mais usada da casa viraria exatamente a fila que ela
 * existe para evitar.
 *
 * ⚠️ A TESTEMUNHA PODE TER NÚMERO PRÓPRIO, e por isso `ordemPropria` vence o número do papel.
 * Lucas, 13/09/2026: *"dentro das testemunha eu posso colocar uma testemunha assina na ordem 1 e
 * outra na ordem 4"*. É o único papel onde as pessoas são CADASTRADAS uma a uma
 * (`temis_testemunhas`), então é o único onde a ordem pode ser por pessoa sem envelhecer no
 * primeiro contrato.
 *
 * ⚠️ PAPEL FORA DA REGRA ASSINA POR ÚLTIMO, e não primeiro. Um papel que a regra salva não previa
 * — porque nasceu depois dela — esperando o resto é seguro; ele na frente da vendedora não é.
 */
/**
 * O nome do signatário no padrão da casa: CAIXA ALTA.
 *
 * ⚠️ TRÊS FONTES, TRÊS FORMATOS, UM DOCUMENTO SÓ. O comprador e o incorporador chegam do cadastro,
 * que guarda em caixa alta; a Careli chega do `display_name` do usuário do hub, que é "Nivea
 * Careli". No termo que foi para o cliente em 23/09/2026 saiu, em sequência, "MARIA DE FATIMA
 * RODRIGUES DOS SANTOS", "ANTÔNIO BARBOSA DA COSTA JÚNIOR" e "Nivea Careli". Nívea: *"ajusta, por
 * favor, o padrão do nome dos assinantes"*.
 *
 * ⚠️ CAIXA ALTA, E NÃO "Nome Próprio", e a escolha foi do Lucas no mesmo dia. Subir a caixa não
 * inventa nada: é o único dos dois caminhos que não depende de adivinhar. O contrário — baixar a
 * caixa e recapitalizar — precisaria acertar as preposições ("de", "da", "dos") e, pior, NÃO
 * devolve acento que o cadastro não tem: "FATIMA" viraria "Fatima", nunca "Fátima", e o nome sairia
 * errado num papel que vai a cartório.
 *
 * ⚠️ E VALE TAMBÉM PARA O ENVELOPE, não só para a tela: a lista que a tela mostra é a mesma que vai
 * para a Clicksign. Por isso ela é chamada nos DOIS montadores — `signatariosDoContrato` e
 * `signatariosDoAcordo` —, e não dentro de `ordenarSignatarios`: ordenar não muda dado, e um teste
 * de ordem que recebesse o nome trocado estaria certo em reclamar.
 */
export function nomeDeSignatario(nome: string): string {
  return String(nome ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function ordenarSignatarios(
  pessoas: Omit<Signatario, "ordem">[],
  regra: RegraDeOrdem = ORDEM_PADRAO,
): Signatario[] {
  if (!regra.ordenada) return pessoas.map((p) => ({ ...p, ordem: 0 }));

  const foraDaRegra = ORDEM_MAXIMA + 1;
  const numeroCru = (p: Omit<Signatario, "ordem">): number => {
    // A ordem da PESSOA vence a do papel — hoje só a testemunha tem uma.
    if (typeof p.ordemPropria === "number" && Number.isFinite(p.ordemPropria)) {
      return p.ordemPropria;
    }
    const doPapel = regra.ordens[p.papel];
    return typeof doPapel === "number" && Number.isFinite(doPapel) ? doPapel : foraDaRegra;
  };

  const crus = pessoas.map(numeroCru);

  // Os números DISTINTOS que este contrato usa, do menor para o maior. Compactar o conjunto — e
  // não as pessoas — é o que preserva o empate.
  const distintos = [...new Set(crus)].sort((a, b) => a - b);
  const compacto = new Map(distintos.map((n, i) => [n, i + 1]));

  return pessoas.map((p, i) => ({ ...p, ordem: compacto.get(crus[i]!) ?? distintos.length }));
}

/**
 * A regra, lida do que está gravado — na categoria, ou no empreendimento.
 *
 * ⚠️ TOLERA O JSONB SUJO DE PROPÓSITO. A coluna guarda uma lista de papéis, e um papel que saiu do
 * código (renomeado, removido) continuaria gravado lá. Descartar o desconhecido e completar o que
 * falta é melhor do que recusar a regra inteira: uma regra recusada faria o contrato voltar
 * silenciosamente ao paralelo, que é justamente o trabalho manual que isto veio eliminar.
 */
export function lerRegraDeOrdem(cru: unknown): RegraDeOrdem {
  if (!cru || typeof cru !== "object") return ORDEM_PADRAO;

  const bruto = cru as { ordenada?: unknown; ordens?: unknown; papeis?: unknown };
  const ordenada = bruto.ordenada === true;
  const ordens = ordensCanonicas();

  // ⚠️ O FORMATO NOVO PRIMEIRO: um número por papel.
  if (bruto.ordens && typeof bruto.ordens === "object") {
    for (const [papel, valor] of Object.entries(bruto.ordens as Record<string, unknown>)) {
      if (!PAPEIS.includes(papel as PapelNoContrato)) continue;
      const n = Math.trunc(Number(valor));
      if (!Number.isFinite(n) || n < 1 || n > ORDEM_MAXIMA) continue;
      ordens[papel as PapelNoContrato] = n;
    }
    return { ordenada, ordens };
  }

  // ⚠️ E O FORMATO ANTIGO CONTINUA SENDO LIDO, porque ele está GRAVADO. Até 13/09/2026 a coluna
  // guardava uma PERMUTAÇÃO de papéis (`papeis: [...]`), e a posição na lista era o número. Uma
  // linha assim continua valendo exatamente o que valia: o primeiro vira 1, o segundo vira 2, e
  // assim por diante. Recusar o formato velho faria a única regra cadastrada da casa voltar ao
  // padrão em silêncio — contrato saindo em paralelo sem ninguém ter pedido.
  if (Array.isArray(bruto.papeis)) {
    const listados = bruto.papeis.filter((x): x is PapelNoContrato =>
      PAPEIS.includes(x as PapelNoContrato),
    );
    const vistos = new Set(listados);
    const fila = [...new Set(listados), ...PAPEIS.filter((p) => !vistos.has(p))];
    for (const [i, papel] of fila.entries()) ordens[papel] = i + 1;
  }

  return { ordenada, ordens };
}

/**
 * A regra a partir do que está GRAVADO NA COLUNA, seja qual for o formato dela.
 *
 * ⚠️ A COLUNA GUARDA DUAS FORMAS, E QUEM LÊ PRECISA ESCOLHER A CERTA. Até 13/09/2026 ela guardava
 * uma LISTA de papéis (a posição era o número); desde a troca do modelo guarda um MAPA
 * `{papel: número}`, em que o mesmo número significa "assinam juntos". `lerRegraDeOrdem` sabe ler
 * as duas, mas só se receber a lista em `papeis` e o mapa em `ordens` — passar um mapa como
 * `papeis` não casa com nenhum dos dois ramos e devolve o PADRÃO, calado.
 *
 * ⚠️ E ERA ISSO QUE ACONTECIA NO ENVIO. Medido em 23/09/2026: `ordem-db.ts` e `ordem-da-categoria`
 * montavam sempre `{ papeis: coluna }`, enquanto a tela do Setup escolhia entre as duas formas. O
 * empreendimento com o mapa gravado assinava na ordem padrão da casa, e a tela do Setup mostrava
 * outra coisa — duas telas discordando sobre a mesma linha do banco.
 *
 * Existe para que a escolha aconteça UM LUGAR SÓ. Quem tem a coluna na mão chama isto; ninguém
 * mais decide entre `papeis` e `ordens`.
 */
export function regraDaColuna(ordenada: boolean, coluna: unknown): RegraDeOrdem {
  return lerRegraDeOrdem(
    Array.isArray(coluna) ? { ordenada, papeis: coluna } : { ordenada, ordens: coluna },
  );
}

/**
 * Uma FILA de papéis virando números: o primeiro é 1, o segundo é 2, e assim por diante.
 *
 * ⚠️ EXISTE PARA AS TELAS QUE AINDA ARRASTAM UMA LISTA. O cadastro do empreendimento passou a
 * editar números (é o que permite "comprador 1, o resto 2"), mas a tela de categoria e a de envio
 * ainda montam uma permutação com setas — e uma permutação É um caso particular do modelo novo: a
 * fila estrita, sem empate. Converter aqui é melhor do que deixar cada tela inventar a sua
 * conversão, que é como duas verdades nascem.
 */
export function regraDeLista(ordenada: boolean, papeis: PapelNoContrato[]): RegraDeOrdem {
  const ordens = ordensCanonicas();
  const vistos = new Set(papeis);
  const fila = [...new Set(papeis), ...PAPEIS.filter((p) => !vistos.has(p))];
  for (const [i, papel] of fila.entries()) ordens[papel] = i + 1;
  return { ordenada, ordens };
}

/**
 * Os papéis agrupados por número, do menor para o maior. Quem empata assina junto.
 *
 * É o que a tela usa para escrever a fila e o que `descreverRegra` resume numa linha.
 */
export function gruposDaRegra(regra: RegraDeOrdem): PapelNoContrato[][] {
  const porNumero = new Map<number, PapelNoContrato[]>();
  // ⚠️ `PAPEIS_DO_CONTRATO`, E NÃO `PAPEIS`. Esta função descreve a fila de assinatura de uma VENDA,
  // e a Careli não é parte dela — ela assina o TERMO DE ACORDO do Hades, que tem ordem própria
  // (`ORDEM_DO_ACORDO`, em `lib/hades/acordo/signatarios-do-acordo.ts`). Iterar a lista inteira faria
  // toda venda da casa exibir "... → Careli" numa frase sobre um documento que ela não assina.
  for (const papel of PAPEIS_DO_CONTRATO) {
    const n = regra.ordens[papel] ?? PAPEIS.length;
    const grupo = porNumero.get(n);
    if (grupo) grupo.push(papel);
    else porNumero.set(n, [papel]);
  }
  return [...porNumero.entries()].sort((a, b) => a[0] - b[0]).map(([, papeis]) => papeis);
}

/** A regra em uma linha, para a tela. */
export function descreverRegra(regra: RegraDeOrdem, rotulo: (p: PapelNoContrato) => string): string {
  if (!regra.ordenada) return "Todos assinam ao mesmo tempo.";
  // ⚠️ VÍRGULA DENTRO DO GRUPO, SETA ENTRE GRUPOS. "Vendedora, Coordenadora → Testemunha" diz
  // duas coisas de uma vez: as duas primeiras assinam ao mesmo tempo, e a terceira espera as duas.
  // Uma seta entre todas diria que a coordenadora espera a vendedora, que é outra operação.
  return gruposDaRegra(regra)
    .map((grupo) => grupo.map(rotulo).join(", "))
    .join(" → ");
}
