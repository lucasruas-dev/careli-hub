// OS DIAS DE VENCIMENTO DA PARCELA, POR EMPREENDIMENTO — a regra num lugar só.
//
// Lucas (02/10/2026): *"dentro do setup, do empreendimento na aba politicas comerciais, vamos colocar
// uma parte que apontamos os dias de vencimento da parcela. Hoje está padrão (...), agora passa a ter
// essa referencia. o usuario pode colocar as datas, inserir mais de uma o ideia seria ir cadastrando
// as datas para aquele empreendimento"*.
//
// Decisões do mesmo dia, uma rodada só:
//   1. O FILHO SEM CADASTRO HERDA O PAI, pela régua da casa (`itensDoMenorRecorte`): o menor recorte
//      configurado ganha; não configurado passa a vez para o de cima.
//   2. SEM CADASTRO EM LUGAR NENHUM, A PROPOSTA SÓ AVISA e continua oferecendo 10 e 20. Nada trava.
//   3. A LISTA É ATALHO, NÃO TRAVA. O servidor da proposta continua aceitando de 1 a 28 (venda
//      migrada, acerto pontual com o cliente), o mesmo raciocínio de `DIAS_DE_VENCIMENTO` em
//      `proposta.ts`.
//   4. O PORTAL DO INCORPORADOR SÓ LÊ, como as outras políticas dele.
//
// ⚠️ NULO É "NÃO CADASTRADO", E LISTA VAZIA NÃO EXISTE. A coluna (`dias_vencimento`, migration 0210)
// nasce nula, e o CHECK do banco recusa o array vazio: uma lista vazia gravada diria "este
// empreendimento não tem dia nenhum", que não é decisão que alguém toma, e mataria a herança do pai
// em silêncio. Remover o último dia na tela é VOLTAR A HERDAR, e por isso vira nulo aqui.
import { DIAS_DE_VENCIMENTO } from "@/lib/hercules/proposta";
import {
  type OrigemDoRecorte,
  itensDoMenorRecorte,
} from "@/lib/hercules/recorte-da-unidade";

/** A faixa que o servidor da proposta aceita. O cadastro obedece a MESMA, não uma mais estreita. */
export const DIA_DE_VENCIMENTO_MINIMO = 1;
export const DIA_DE_VENCIMENTO_MAXIMO = 28;

/** O que a proposta oferece quando ninguém cadastrou nada: o comportamento de antes desta frente. */
export const DIAS_SEM_CADASTRO: readonly number[] = DIAS_DE_VENCIMENTO;

/** Os dias que valem para um empreendimento, e de onde vieram. */
export type DiasDeVencimento = {
  /**
   * Há cadastro valendo (neste empreendimento ou no pai)? Falso = a lista é `DIAS_SEM_CADASTRO`, e a
   * tela avisa que falta cadastrar.
   */
  cadastrado: boolean;
  /** Em ordem, sem repetição, nunca vazia. O primeiro é o dia que a proposta já nasce marcando. */
  dias: number[];
  /** "filho" = cadastrado no próprio empreendimento; "pai" = herdado; nulo = sem cadastro. */
  origem: null | OrigemDoRecorte;
};

/** A linha de `apolo_enterprise_settings`, só com o que esta regra lê. */
export type LinhaDosDias = {
  dias: null | number[];
  enterpriseId: string;
};

export const SEM_CADASTRO: DiasDeVencimento = {
  cadastrado: false,
  dias: [...DIAS_SEM_CADASTRO],
  origem: null,
};

/**
 * Lê a coluna como o PostgREST devolve e devolve a lista limpa, ou nulo.
 *
 * ⚠️ FILTRA EM VEZ DE CONFIAR. O CHECK do banco garante a faixa, mas uma linha gravada por SQL
 * direto antes dele (ou um `"10"` de texto) chegaria aqui do mesmo jeito; um dia fora da faixa
 * oferecido como atalho faria a proposta ser recusada pelo próprio servidor depois do clique.
 */
export function diasDoBanco(bruto: unknown): null | number[] {
  if (!Array.isArray(bruto)) return null;
  const dias = [
    ...new Set(
      bruto
        .map((valor) => Number(valor))
        .filter(
          (dia) =>
            Number.isInteger(dia) &&
            dia >= DIA_DE_VENCIMENTO_MINIMO &&
            dia <= DIA_DE_VENCIMENTO_MAXIMO,
        ),
    ),
  ].sort((a, b) => a - b);
  return dias.length > 0 ? dias : null;
}

export type ConferenciaDosDias =
  | { dias: null | number[]; ok: true }
  | { erro: string; ok: false };

/**
 * Confere a lista que a tela mandou salvar.
 *
 * ⚠️ RECUSA COM FRASE, E NÃO CONSERTA CALADA. Um 31 digitado não vira 28, e um dia repetido não some:
 * o operador precisa ver o que digitou errado, senão a tela recarrega com uma lista diferente da que
 * ele montou. A ORDEM é a única coisa que se arruma sozinha, porque não muda o significado.
 *
 * `null` e lista vazia são o mesmo pedido, "voltar a herdar", e saem como `null`.
 */
export function conferirDiasDeVencimento(bruto: unknown): ConferenciaDosDias {
  if (bruto === null || bruto === undefined) return { dias: null, ok: true };
  if (!Array.isArray(bruto)) {
    return { erro: "Envie os dias de vencimento como uma lista.", ok: false };
  }
  if (bruto.length === 0) return { dias: null, ok: true };

  const vistos = new Set<number>();
  for (const valor of bruto) {
    // ⚠️ SÓ NÚMERO. `Number(true)` é 1 e `Number("")` é 0: um booleano ou um campo vazio virariam um
    // dia que ninguém escolheu.
    if (typeof valor !== "number" || !Number.isInteger(valor)) {
      return { erro: "Cada dia de vencimento precisa ser um número inteiro.", ok: false };
    }
    if (valor < DIA_DE_VENCIMENTO_MINIMO || valor > DIA_DE_VENCIMENTO_MAXIMO) {
      return {
        erro: `O dia ${valor} não vale: o vencimento vai do dia ${DIA_DE_VENCIMENTO_MINIMO} ao ${DIA_DE_VENCIMENTO_MAXIMO}.`,
        ok: false,
      };
    }
    if (vistos.has(valor)) {
      return { erro: `O dia ${valor} está repetido.`, ok: false };
    }
    vistos.add(valor);
  }

  return { dias: [...vistos].sort((a, b) => a - b), ok: true };
}

/**
 * Os dias que valem para o empreendimento, pela régua de filho → pai.
 *
 * ⚠️ NÃO HÁ DEGRAU DE CATEGORIA, e é de propósito: a coluna mora na configuração DO EMPREENDIMENTO,
 * que não tem categoria. A régua é a mesma de planos, faixas e premissas (`itensDoMenorRecorte`), e
 * não uma sétima cópia da precedência; só o primeiro degrau não se aplica.
 *
 * ⚠️ JUNTAR FILHO E PAI NÃO EXISTE. O filho que cadastrou um dia só fica com o dele, sem completar com
 * os do pai: é o "o menor ganha", e não "todo mundo ganha um pouco".
 */
export function diasDoEmpreendimento(
  recorte: { enterpriseId: null | string; paiEnterpriseId: null | string },
  linhas: readonly LinhaDosDias[],
): DiasDeVencimento {
  const comCadastro = linhas
    .map((linha) => ({ dias: diasDoBanco(linha.dias), enterpriseId: linha.enterpriseId }))
    .filter((linha): linha is { dias: number[]; enterpriseId: string } => linha.dias !== null);

  const escolha = itensDoMenorRecorte(
    { categoriaId: null, enterpriseId: recorte.enterpriseId, paiEnterpriseId: recorte.paiEnterpriseId },
    comCadastro,
  );
  const linha = escolha.itens[0];
  if (!linha || !escolha.origem) return { ...SEM_CADASTRO, dias: [...SEM_CADASTRO.dias] };

  return { cadastrado: true, dias: linha.dias, origem: escolha.origem };
}

/** O dia que a proposta já nasce marcando: o primeiro da lista. */
export function primeiroDia(dias: Pick<DiasDeVencimento, "dias">): number {
  return dias.dias[0] ?? DIAS_SEM_CADASTRO[0] ?? 10;
}

/**
 * O `c2x_enterprise_id` do PAI no cadastro do Panteon, para quem já tem o cadastro na mão.
 *
 * Um nível só, como `lerFamilia` das premissas. Nulo quando não há pai, quando o pai é o próprio
 * empreendimento, e quando o pai só existe no Panteon sem id do C2X (o LOX da Lavra do Ouro): a
 * configuração é chaveada por esse id, então não há o que herdar dele.
 */
export function paiNoCadastro(
  cadastro: ReadonlyArray<{ c2xEnterpriseId: null | string; id: string; paiId: null | string }>,
  enterpriseId: string,
): null | string {
  const alvo = String(enterpriseId ?? "").trim();
  if (!alvo) return null;
  const linha = cadastro.find((l) => l.c2xEnterpriseId === alvo && l.paiId) ??
    cadastro.find((l) => l.c2xEnterpriseId === alvo);
  if (!linha?.paiId) return null;
  const pai = cadastro.find((l) => l.id === linha.paiId);
  const id = String(pai?.c2xEnterpriseId ?? "").trim();
  return id && id !== alvo ? id : null;
}

/**
 * Em qual empreendimento a aba do Apolo grava: o id da ficha ou, num agrupamento, o PAI das divisões.
 *
 * ⚠️ `group:<nome>` NÃO É EMPREENDIMENTO. É a linha que a lista do Apolo monta quando o produto
 * dividido não tem o registro do pai no catálogo do C2X (o Lagoa Bonita, medido em 15/09/2026:
 * `ENTERPRISE_MIRRORS` só conhece o VLO). Nenhuma unidade carrega esse id, então um dia gravado nele
 * não chegaria a proposta nenhuma. O pai, sim: as divisões herdam dele. Por isso o agrupamento é
 * traduzido para o pai que o cadastro do Panteon declara para TODAS as suas divisões, e só quando é
 * um pai só e tem id do C2X. Qualquer outra coisa é nulo, e a rota recusa com a frase.
 */
export function empreendimentoDoCadastro(
  cadastro: ReadonlyArray<{
    c2xEnterpriseId: null | string;
    codigo: null | string;
    id: string;
    paiId: null | string;
  }>,
  enterpriseId: string,
  codigos: readonly string[],
): null | string {
  const id = String(enterpriseId ?? "").trim();
  if (!id) return null;
  if (!id.startsWith("group:")) return id;

  const pedidos = new Set(codigos.map((c) => String(c ?? "").trim().toUpperCase()).filter(Boolean));
  if (pedidos.size === 0) return null;

  const divisoes = cadastro.filter((l) => pedidos.has(String(l.codigo ?? "").trim().toUpperCase()));
  // Toda divisão pedida tem de estar no cadastro: uma que falta pode ser de outro pai.
  const achadas = new Set(divisoes.map((l) => String(l.codigo ?? "").trim().toUpperCase()));
  if ([...pedidos].some((c) => !achadas.has(c))) return null;

  const pais = new Set(divisoes.map((l) => l.paiId ?? ""));
  if (pais.size !== 1 || pais.has("")) return null;

  const pai = cadastro.find((l) => l.id === [...pais][0]);
  return String(pai?.c2xEnterpriseId ?? "").trim() || null;
}

/** "dias 10 e 20", "dia 5", "dias 5, 10 e 15" — a frase curta da tela. */
export function diasPorExtenso(dias: readonly number[]): string {
  if (dias.length === 0) return "";
  if (dias.length === 1) return `dia ${dias[0]}`;
  return `dias ${dias.slice(0, -1).join(", ")} e ${dias[dias.length - 1]}`;
}
