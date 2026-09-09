import { lerRegraDeOrdem, ORDEM_PADRAO, type RegraDeOrdem } from "@/lib/assinatura/ordem";
import { PAPEIS, type PapelNoContrato } from "@/lib/assinatura/tipos";

// A ORDEM DE ASSINATURA DA CATEGORIA — o degrau do meio da cadeia.
//
// Lucas, 08/09/2026: *"a ordem de assinatura queremos criar dentro do empreendimento, em uma aba de
// setup"*, *"eu posso ter uma ordem por empreendimento ou por categoria"*, *"isso seria legal, posso
// cadastrar os dois"*.
//
//     unidade → categoria → ordem própria        o recorte que assina diferente
//              ↘ sem ordem própria → empreendimento
//                          ↘ sem ordem → padrão da casa (lib/assinatura/ordem.ts)
//
// É a MESMA cadeia da minuta (0140) e da vendedora (0141), e isso é de propósito: um recorte que
// assina com outra vendedora costuma assinar em outra ordem.
//
// ⚠️ "HERDA" É O PAR INTACTO — `assinatura_ordenada = false` E `assinatura_ordem = null`, os dois
// defaults da 0142. Não é o booleano sozinho: ele é `not null default false` nas duas tabelas, e se
// bastasse ele para decidir, toda categoria nasceria afirmando "todos assinam ao mesmo tempo" e
// cancelaria a ordem do empreendimento sem ninguém ter pedido. Criar uma categoria apagaria, em
// silêncio, a ordem daquele recorte.
//
// ⚠️ E A LISTA VAZIA NUNCA CHEGA A SER GRAVADA. `[]` e `null` são valores diferentes em jsonb que
// significariam a mesma coisa para quem lê ("não sei ordenar nada"), e a diferença sobreviveria no
// banco esperando alguém tropeçar. A gravação recusa (ver `lerOrdemDoCorpo`) e manda limpar; quem
// quer voltar a herdar manda a lista NULA, que é o estado que o motor do envio reconhece.
//
// ⚠️ `ordenada: false` COM LISTA CONTINUA SENDO REGRA PRÓPRIA — é o "todos ao mesmo tempo"
// DELIBERADO. Sem ele, uma categoria dentro de um empreendimento ordenado não teria como voltar ao
// paralelo: qualquer tentativa cairia na herança e sairia ordenada do mesmo jeito.

/** De onde saiu a ordem que vai valer. */
export type OrigemDaOrdem = "categoria" | "empreendimento" | "padrao";

/**
 * Um degrau da cadeia, do jeito que sai do banco.
 *
 * `ordem` é o jsonb CRU de propósito: quem chama não precisa saber que a coluna guarda uma lista de
 * strings, e o que estiver sujo lá (papel renomeado, objeto de uma versão antiga) é filtrado aqui.
 */
export type NivelDeOrdem = {
  /** O jsonb cru de `assinatura_ordem`. Nulo (ou lista vazia) = este degrau não decide. */
  ordem: unknown;
  /** O booleano de `assinatura_ordenada`. Só vale quando `ordem` é uma lista. */
  ordenada: boolean;
  origem: OrigemDaOrdem;
  /** Como a tela chama este degrau: "Condomínio", "Lagoa Bonita", "Padrão da casa". */
  rotulo: string;
};

export type OrdemResolvida = {
  origem: OrigemDaOrdem;
  regra: RegraDeOrdem;
  rotulo: string;
};

/**
 * O degrau decide, ou passa adiante?
 *
 * ⚠️ É O MESMO PREDICADO DE `foiCadastrada`, EM `lib/assinatura/ordem-db.ts` — o motor que resolve a
 * ordem na hora de mandar o contrato. Os dois PRECISAM concordar sobre o que é "tem regra própria":
 * se a tela achasse que uma linha herda e o motor achasse que ela decide (ou o contrário), a tela
 * mostraria uma ordem e o contrato sairia em outra, sem erro nenhum e sem ninguém para ligar as
 * duas coisas. Mudou aqui, muda lá.
 */
export function temOrdemPropria(nivel: { ordem: unknown; ordenada: boolean }): boolean {
  return nivel.ordenada === true || nivel.ordem != null;
}

/**
 * A regra de um degrau que decide.
 *
 * ⚠️ REAPROVEITA `lerRegraDeOrdem` EM VEZ DE REIMPLEMENTAR: a coluna guarda só a LISTA, e a função
 * do provedor espera `{ ordenada, papeis }`. Montar o objeto aqui é o que faz o descarte de papel
 * desconhecido, a deduplicação e o completamento dos ausentes ("papel fora da lista assina por
 * último") continuarem valendo num lugar só — duas implementações da mesma regra divergiriam no
 * primeiro papel novo.
 */
export function regraDoNivel(nivel: NivelDeOrdem): RegraDeOrdem {
  return lerRegraDeOrdem({ ordenada: nivel.ordenada, papeis: nivel.ordem });
}

/**
 * Quem manda, percorrendo a cadeia do mais específico para o mais geral.
 *
 * ⚠️ A CADEIA CHEGA PRONTA, e a ordem dos degraus é de quem chama: categoria → (mãe, avó…) →
 * empreendimento. Subcategoria herdando da mãe é o mesmo problema uma camada abaixo — "condomínio
 * dentro de loteamento, fase dentro de condomínio" —, e resolver aqui evita que cada tela invente
 * a sua própria subida.
 */
export function resolverOrdemDeAssinatura(cadeia: NivelDeOrdem[]): OrdemResolvida {
  for (const nivel of cadeia) {
    if (!temOrdemPropria(nivel)) continue;
    return { origem: nivel.origem, regra: regraDoNivel(nivel), rotulo: nivel.rotulo };
  }
  return { origem: "padrao", regra: ORDEM_PADRAO, rotulo: "Padrão da casa" };
}

/** O par que vai para o banco. Os dois nomes são os das colunas da 0142. */
export type OrdemGravavel = {
  assinatura_ordem: null | PapelNoContrato[];
  assinatura_ordenada: boolean;
};

export type LeituraDaOrdem =
  | { erro: string; ok: false }
  /** `mudancas: null` = o corpo não falou de ordem nenhuma; não mexe nas colunas. */
  | { mudancas: null | OrdemGravavel; ok: true };

/** O que a rota aceita no corpo. Ausente ≠ nulo — ver a nota do `lerOrdemDoCorpo`. */
export type CorpoComOrdem = {
  assinaturaOrdem?: null | unknown;
  assinaturaOrdenada?: unknown;
};

const LISTA_DE_PAPEIS = PAPEIS.join(", ");

/**
 * Lê o par do corpo da requisição, com a disciplina do resto da casa: AUSENTE = não mexeu, NULO =
 * limpou (volta a herdar).
 *
 * ⚠️ AS DUAS CHAVES VIAJAM JUNTAS, e mandar só o liga/desliga é recusado. `assinatura_ordenada` é
 * `not null` e `assinatura_ordem` é nula por padrão: gravar o booleano sozinho produziria
 * `ordenada = true` com lista nula — um cadastro que a tela mostra como "assina em ordem" e o envio
 * do contrato resolve como herança, discordando um do outro para sempre e sem erro nenhum.
 *
 * ⚠️ E A VALIDAÇÃO É AQUI, E NÃO NO ENVIO DO CONTRATO. Papel inexistente ou repetido não quebra
 * nada na hora de salvar: quebra semanas depois, na geração, longe da tela onde foi digitado e sem
 * ninguém para associar uma coisa à outra. `lerRegraDeOrdem` tolera lixo de propósito (para não
 * derrubar contrato por causa de um papel renomeado), então se a porta de entrada também tolerar,
 * o lixo entra calado e o contrato sai numa ordem que ninguém cadastrou.
 */
export function lerOrdemDoCorpo(corpo: CorpoComOrdem): LeituraDaOrdem {
  const mandouOrdem = "assinaturaOrdem" in corpo;
  const mandouFlag = "assinaturaOrdenada" in corpo;

  if (!mandouOrdem && !mandouFlag) return { mudancas: null, ok: true };

  if (!mandouOrdem) {
    return {
      erro: "Mande a ordem junto com o liga/desliga: sem a lista de papéis não dá para ordenar.",
      ok: false,
    };
  }

  const flag = corpo.assinaturaOrdenada;
  if (mandouFlag && typeof flag !== "boolean") {
    return { erro: 'O campo "assinam em ordem" precisa ser verdadeiro ou falso.', ok: false };
  }
  const ordenada = flag === true;

  const ordem = corpo.assinaturaOrdem;

  // O caminho de VOLTAR A HERDAR. Zera o booleano junto porque sem lista ele não tem o que ordenar.
  if (ordem === null) {
    if (ordenada) {
      return {
        erro: "Para assinar em ordem é preciso informar a lista de papéis, ou limpar os dois para a categoria voltar a herdar do empreendimento.",
        ok: false,
      };
    }
    return { mudancas: { assinatura_ordem: null, assinatura_ordenada: false }, ok: true };
  }

  if (!Array.isArray(ordem)) {
    return {
      erro: `A ordem precisa ser uma lista de papéis (${LISTA_DE_PAPEIS}), ou nula para herdar do empreendimento.`,
      ok: false,
    };
  }

  if (ordem.length === 0) {
    return {
      erro: "A ordem está vazia. Para a categoria voltar a seguir o empreendimento, limpe a ordem (nula) em vez de salvar uma lista sem papéis.",
      ok: false,
    };
  }

  const desconhecidos: string[] = [];
  const repetidos: string[] = [];
  const vistos = new Set<string>();
  const papeis: PapelNoContrato[] = [];

  for (const bruto of ordem) {
    const papel = typeof bruto === "string" ? bruto.trim() : String(bruto);
    if (!PAPEIS.includes(papel as PapelNoContrato)) {
      if (!desconhecidos.includes(papel)) desconhecidos.push(papel);
      continue;
    }
    if (vistos.has(papel)) {
      if (!repetidos.includes(papel)) repetidos.push(papel);
      continue;
    }
    vistos.add(papel);
    papeis.push(papel as PapelNoContrato);
  }

  if (desconhecidos.length > 0) {
    return {
      erro: `Papel que não existe na ordem: ${desconhecidos.map((p) => `"${p}"`).join(", ")}. Os válidos são ${LISTA_DE_PAPEIS}.`,
      ok: false,
    };
  }

  if (repetidos.length > 0) {
    return {
      erro: `Papel repetido na ordem: ${repetidos.map((p) => `"${p}"`).join(", ")}. Cada papel assina em um lugar só.`,
      ok: false,
    };
  }

  return { mudancas: { assinatura_ordem: papeis, assinatura_ordenada: ordenada }, ok: true };
}
