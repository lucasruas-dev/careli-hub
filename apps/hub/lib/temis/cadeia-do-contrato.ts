// A CADEIA DO CONTRATO — os degraus que respondem pela minuta e pelos anexos de uma venda.
//
// Pedido do Lucas (21/09/2026): *"preciso garantir que consigamos vincular os anexos por filho,
// categoria. também as minutas."*
//
//     unidade → categoria (e as mães dela) → divisão da unidade → empreendimento da proposta → pai
//
// ⚠️ DUAS REGRAS OPOSTAS PERCORREM A MESMA CADEIA, E ISSO É DE PROPÓSITO.
//
//   MINUTA — o mais específico VENCE e os outros calam. Dois contratos não somam: ou o lote assina
//            o modelo da categoria, ou o da divisão, ou o do empreendimento. Um só.
//   ANEXOS — os níveis SOMAM. O contrato leva a convenção do pai MAIS o memorial da divisão MAIS a
//            planta da categoria. É a decisão do Lucas de 21/09/2026, e ela INVERTE o que estava
//            escrito na 0156 ("só o nível mais específico vale"), que passa a valer só para a
//            minuta. Ver `anexos-da-venda.ts`.
//
// ⚠️ A DIVISÃO DA UNIDADE VEM ANTES DO EMPREENDIMENTO DA PROPOSTA, e é isso que paga a frente.
// Medido em produção em 21/09/2026, sobre as 4.898 propostas: 594 achavam minuta publicada pela
// igualdade exata com o empreendimento da proposta (o que o código fazia até aqui). As 559 do Vale
// do Ouro penduram no PAI (35) e as unidades moram nos filhos (VOL 36, VOC 37, VOR 41); 189 delas
// têm unidade no VOL, cuja v6 ESTÁ publicada, e nenhuma achava contrato. Subir para o pai não
// destrava nenhuma — nenhum pai tem minuta publicada hoje —, então herança só para cima não
// resolveria o pedido.
//
// ⚠️ E A INVERSÃO NÃO TIRA A MINUTA DE NINGUÉM. Medido na mesma data: as propostas em que o
// empreendimento da proposta E a divisão da unidade têm, os dois, minuta publicada, e são
// empreendimentos diferentes, são ZERO. Nenhum dos 594 contratos que saem hoje troca de modelo.
//
// ⚠️ SÓ SOBE, NUNCA DESCE — a regra de `empreendimentosQueServem` continua de pé. O pai NÃO enxerga
// a minuta da divisão: deixar o VLO (35) enxergar a minuta do VOL (36) mandaria o texto do VOL para
// 192 contratos de unidades do VOC e 174 do próprio VLO. O caminho legítimo é publicar a minuta do
// pai e a do VOC.
//
// ⚠️ FALHA DE LEITURA AQUI RECUSA A MONTAGEM INTEIRA, e este é o ponto em que a disciplina antiga
// se inverte. Em `empreendimentosQueServem` a falha ENCOLHE a lista, porque o lado barato de errar
// era um 409 dizendo o que procurou. Numa CADEIA que soma anexos o barato é o contrário: pular um
// degrau em silêncio imprime o contrato do empreendimento no lote que tinha modelo próprio, ou
// emite o papel sem a convenção que ele promete — sem erro, sem log e sem ninguém para ligar as
// duas coisas. Aqui a leitura que falha para a montagem e diz o que não conseguiu ler.

import type { SupabaseClient } from "@supabase/supabase-js";

const WORKSPACE = "careli";

/** O prefixo da ficha CONSOLIDADA do Apolo. Ver `NivelDaCadeia.alias`. */
export const PREFIXO_DO_CONSOLIDADO = "group:";

/** Quantas mães uma categoria pode ter acima dela. Sanidade: a linhagem real tem uma ou nenhuma. */
const MAXIMO_DE_MAES = 5;

/**
 * De onde a peça veio. A ordem da união é a ordem da cadeia, do mais específico ao mais geral, e é
 * ela que `ORDEM_DOS_DEGRAUS` transforma em número.
 */
export type DegrauDoContrato = "unidade" | "categoria" | "divisao" | "empreendimento" | "pai";

/** Do mais específico (0) ao mais geral (4). Empate de posição entre anexos desempata por aqui. */
export const ORDEM_DOS_DEGRAUS: Record<DegrauDoContrato, number> = {
  unidade: 0,
  categoria: 1,
  divisao: 2,
  empreendimento: 3,
  pai: 4,
};

/** Como o operador chama cada degrau quando a tela precisa explicar de onde a peça veio. */
export const NOME_DO_DEGRAU: Record<DegrauDoContrato, string> = {
  categoria: "categoria",
  divisao: "divisão",
  empreendimento: "empreendimento",
  pai: "empreendimento pai",
  unidade: "unidade",
};

export type NivelDaCadeia = {
  /**
   * O OUTRO nome pelo qual este mesmo degrau é gravado: o consolidado do catálogo,
   * `group:Lagoa Bonita`. Só a RAIZ de uma família o tem.
   *
   * ⚠️ ELE EXISTE PORQUE A FICHA CONSOLIDADA NÃO TEM ID DE EMPREENDIMENTO. Quando o produto é
   * agrupado e não está em `ENTERPRISE_MIRRORS`, o Apolo monta a linha com `id: "group:<nome>"`
   * (`lib/apolo/empreendimentos.ts`) — um rótulo, não uma chave — e é esse rótulo que a tela de
   * anexos mandava para `temis_anexos.enterprise_id`. Sem o alias, a peça cadastrada pela ficha do
   * Lagoa Bonita nunca entrava em contrato nenhum: a cadeia só conhece o id numérico, e nada
   * avisava. Medido em 21/09/2026: `apolo_enterprise_settings` tem exatamente dois ids assim
   * (`group:Lagoa Bonita` e `group:Vale do Ouro`), e os dois batem letra por letra com o `nome` da
   * raiz em `hercules_empreendimentos` (LAB 31 e VLO 35).
   *
   * ⚠️ O QUE ESTE ALIAS **NÃO** ALCANÇA são as três famílias cuja raiz está sem `c2x_enterprise_id`
   * (LOX, PDX, RDX): elas nem viram degrau. Quem fecha essa porta é a GRAVAÇÃO, que recusa um
   * alcance sem produto no cadastro. Ver `lerAlcance`, em `estrutura-servico.ts`.
   */
  alias?: string;
  degrau: DegrauDoContrato;
  /**
   * O id que casa com a coluna daquele nível: uuid na unidade e na categoria, id do C2X (texto) na
   * divisão, no empreendimento e no pai. São chaves de tabelas diferentes de propósito — é assim
   * que `temis_anexos` guarda o alcance desde a 0156.
   */
  id: string;
  /** Só na categoria: a minuta que ELA cadastrou. Nula = este degrau herda o modelo de cima. */
  minutaId: null | string;
  /** O nome que o operador conhece: "Condomínio", "Vale do Ouro VOL", "Lagoa Bonita". */
  rotulo: string;
};

export type CadeiaDoContrato = {
  /**
   * O que a travessia precisou deixar de fora, com a frase do motivo. Vai para `avisos` do contrato.
   *
   * ⚠️ DEGRAU QUE NÃO ENTRA NUNCA SAI EM SILÊNCIO. Hoje a lista só recebe um caso — a divisão da
   * unidade que é de OUTRA família —, e ele é zero em produção (medido em 21/09/2026). É
   * justamente por ser zero que a frase importa: no dia em que aparecer, o cadastro está errado e
   * alguém precisa ler isso antes do papel sair.
   */
  avisos?: string[];
  /** Os degraus na ordem, do mais específico ao mais geral. Pode vir vazia. */
  niveis: NivelDaCadeia[];
};

export type CadeiaResolvida =
  | { cadeia: CadeiaDoContrato; ok: true }
  | { erro: string; ok: false };

/** O que a proposta já sabe, sem viagem nenhuma ao banco. Sai de `dados-do-contrato`. */
export type PontosDePartida = {
  /** `hercules_unidades.categoria_id`. Vazio = a unidade não foi carimbada. */
  categoriaId: string;
  /** `hercules_unidades.enterprise_id` — o id do C2X da DIVISÃO onde o lote mora. */
  divisaoId: string;
  /** `hercules_empreendimentos.c2x_enterprise_id` do empreendimento da PROPOSTA. */
  empreendimentoId: string;
  /** O nome dele, que `dados-do-contrato` já leu. Evita uma viagem só para rotular. */
  empreendimentoNome: string;
  /** `hercules_propostas.unidade_id` (uuid). */
  unidadeId: string;
};

type LinhaDaCategoria = {
  categoria_pai_id: null | string;
  id: string;
  minuta_id: null | string;
  nome: null | string;
};

type LinhaDoProduto = {
  c2x_enterprise_id: null | string;
  id: string;
  nome: null | string;
  pai_id: null | string;
};

/**
 * Monta a cadeia desta venda.
 *
 * Duas viagens ao banco no pior caso, as duas em tabelas pequenas: a linhagem da categoria (só
 * quando a unidade tem categoria) e o cadastro dos produtos, que traz o NOME da divisão e o pai
 * dela. A segunda só procura o pai quando existe `pai_id` — 20 dos 25 empreendimentos não têm.
 */
export async function resolverCadeiaDoContrato(
  sb: SupabaseClient,
  partida: PontosDePartida,
): Promise<CadeiaResolvida> {
  const niveis: NivelDaCadeia[] = [];
  const avisos: string[] = [];

  const unidadeId = texto(partida.unidadeId);
  if (unidadeId) {
    niveis.push({ degrau: "unidade", id: unidadeId, minutaId: null, rotulo: "esta unidade" });
  }

  const categoriaId = texto(partida.categoriaId);
  if (categoriaId) {
    const linhagem = await linhagemDaCategoria(sb, categoriaId);
    if (!linhagem.ok) return linhagem;
    for (const c of linhagem.categorias) {
      niveis.push({
        degrau: "categoria",
        id: c.id,
        minutaId: texto(c.minuta_id) || null,
        rotulo: texto(c.nome) || "categoria sem nome",
      });
    }
  }

  const divisaoId = texto(partida.divisaoId);
  const empreendimentoId = texto(partida.empreendimentoId);
  const produtos = await produtosDaCadeia(sb, [divisaoId, empreendimentoId]);
  if (!produtos.ok) return produtos;

  // ⚠️ A DIVISÃO SÓ VIRA DEGRAU PRÓPRIO QUANDO ELA NÃO É O EMPREENDIMENTO DA PROPOSTA. Nas 3.977
  // propostas em que os dois são o mesmo id, um degrau só responde pelos dois — repetir o id faria
  // o anexo do empreendimento entrar duas vezes no PDF.
  //
  // ⚠️ E SÓ QUANDO ELA É DA MESMA FAMÍLIA. A divisão vem ANTES do empreendimento da proposta, ou
  // seja, ela DECIDE a minuta — e até 21/09/2026 nada perguntava de quem ela era: um lote apontando
  // para um produto de outro loteamento imprimiria o contrato daquele outro loteamento numa venda
  // desta. Hoje são ZERO propostas nessa situação (medido em 21/09/2026: toda unidade mora no
  // empreendimento da proposta ou num filho dele), e é por isso que dá para fechar de graça.
  //
  // ⚠️ SEM CADASTRO NOS DOIS LADOS, A DIVISÃO CONTINUA VALENDO. Não dá para provar que ela é de
  // outra família quando um dos dois não tem linha em `hercules_empreendimentos` — e tirar o degrau
  // por falta de prova tiraria a minuta das 189 vendas do Vale do Ouro que esta onda acabou de
  // destravar. Só sai quando as duas raízes são conhecidas E diferentes.
  if (divisaoId && divisaoId !== empreendimentoId) {
    const raizDaDivisao = produtos.raizPorC2x.get(divisaoId);
    const raizDoEmpreendimento = produtos.raizPorC2x.get(empreendimentoId);
    const deOutraFamilia =
      Boolean(raizDaDivisao) && Boolean(raizDoEmpreendimento) && raizDaDivisao !== raizDoEmpreendimento;

    if (deOutraFamilia) {
      const nomeDaDivisao = produtos.nomePorC2x.get(divisaoId) || `produto ${divisaoId}`;
      const nomeDoEmpreendimento =
        texto(partida.empreendimentoNome) ||
        produtos.nomePorC2x.get(empreendimentoId) ||
        `produto ${empreendimentoId}`;
      avisos.push(
        `A unidade desta proposta está cadastrada em ${nomeDaDivisao}, que não é uma divisão de ${nomeDoEmpreendimento}. ` +
          `O contrato foi montado com o modelo e os anexos de ${nomeDoEmpreendimento}; ${nomeDaDivisao} ficou de fora. Confira o empreendimento da unidade.`,
      );
    } else {
      niveis.push({
        degrau: "divisao",
        id: divisaoId,
        minutaId: null,
        rotulo: produtos.nomePorC2x.get(divisaoId) || `produto ${divisaoId}`,
      });
    }
  }

  if (empreendimentoId) {
    niveis.push({
      ...aliasDoConsolidado(produtos, empreendimentoId),
      degrau: "empreendimento",
      id: empreendimentoId,
      minutaId: null,
      // O nome do empreendimento da proposta `dados-do-contrato` já leu; o cadastro é o reserva.
      rotulo:
        texto(partida.empreendimentoNome) ||
        produtos.nomePorC2x.get(empreendimentoId) ||
        `produto ${empreendimentoId}`,
    });
  }

  // ⚠️ O PAI ENTRA UMA VEZ SÓ, mesmo quando a divisão e o empreendimento da proposta são irmãos.
  //
  // ⚠️ E SÓ O PAI DE QUEM FICOU NA CADEIA. Quando a divisão foi recusada por ser de outra família,
  // o pai DELA não pode entrar pela porta dos fundos — seria o mesmo contrato de outro loteamento,
  // um degrau acima.
  const raizesNaCadeia = new Set(
    niveis
      .filter((n) => n.degrau === "divisao" || n.degrau === "empreendimento")
      .map((n) => produtos.raizPorC2x.get(n.id))
      .filter(Boolean),
  );
  const jaNaCadeia = new Set(niveis.map((n) => n.id));
  for (const pai of produtos.pais) {
    if (!raizesNaCadeia.has(pai.id)) continue;
    const id = texto(pai.c2x_enterprise_id);
    if (!id || jaNaCadeia.has(id)) continue;
    jaNaCadeia.add(id);
    const nome = texto(pai.nome);
    niveis.push({
      // O pai É a raiz da família: o consolidado do catálogo se chama pelo nome dele.
      ...(nome ? { alias: `${PREFIXO_DO_CONSOLIDADO}${nome}` } : {}),
      degrau: "pai",
      id,
      minutaId: null,
      rotulo: nome || `produto ${id}`,
    });
  }

  return { cadeia: { avisos, niveis }, ok: true };
}

/**
 * A categoria e as mães dela, da mais específica para a mais geral.
 *
 * ⚠️ SUBCATEGORIA HERDA DA MÃE, e é o mesmo problema uma camada abaixo — "condomínio dentro de
 * loteamento, fase dentro de condomínio". A coluna `categoria_pai_id` existe desde a 0140 e hoje
 * está nula nas 6 categorias cadastradas (medido em 21/09/2026); percorrer agora custa nada e evita
 * que a primeira subcategoria cadastrada perca a minuta da mãe em silêncio.
 */
async function linhagemDaCategoria(
  sb: SupabaseClient,
  categoriaId: string,
): Promise<{ categorias: LinhaDaCategoria[]; ok: true } | { erro: string; ok: false }> {
  const categorias: LinhaDaCategoria[] = [];
  const vistas = new Set<string>();
  let alvo = categoriaId;

  for (let volta = 0; volta <= MAXIMO_DE_MAES && alvo; volta += 1) {
    // ⚠️ CICLO NÃO TRAVA A GERAÇÃO. Uma categoria que aponte para si mesma (ou duas que apontem
    // uma para a outra) é cadastro defeituoso, e o contrato não é o lugar de descobrir isso — mas
    // é o lugar de não entrar em laço infinito.
    if (vistas.has(alvo)) break;
    vistas.add(alvo);

    const { data, error } = await sb
      .from("temis_categorias")
      .select("categoria_pai_id, id, minuta_id, nome")
      .eq("id", alvo)
      .maybeSingle();

    if (error) {
      console.error("[temis][cadeia] falha ao ler a categoria da unidade", error);
      return {
        erro: "Não consegui ler a categoria desta unidade, e é ela que decide o modelo e os anexos do contrato. Tente de novo em instantes.",
        ok: false,
      };
    }

    const linha = data as LinhaDaCategoria | null;
    // ⚠️ CATEGORIA APAGADA NÃO É ERRO. A FK de `hercules_unidades.categoria_id` é `SET NULL`
    // (0139), então a linha some junto; chegar aqui com um id que não existe mais é corrida entre
    // a leitura da unidade e a exclusão, e o certo é seguir para o degrau de cima.
    if (!linha) break;

    categorias.push(linha);
    alvo = texto(linha.categoria_pai_id);
  }

  return { categorias, ok: true };
}

/**
 * O cadastro dos produtos da cadeia: o NOME de cada um e o pai deles.
 *
 * ⚠️ DUAS CONSULTAS, E A SEGUNDA QUASE NUNCA RODA. `pai_id` é nulo em 20 dos 25 empreendimentos
 * (medido em 21/09/2026), e sem pai a segunda viagem nem começa.
 */
async function produtosDaCadeia(
  sb: SupabaseClient,
  ids: readonly string[],
): Promise<
  | { erro: string; ok: false }
  | {
      /** Os `c2x_enterprise_id` que são RAIZ de família (sem `pai_id`). Só eles têm consolidado. */
      ehRaizPorC2x: Set<string>;
      nomePorC2x: Map<string, string>;
      ok: true;
      pais: LinhaDoProduto[];
      /**
       * `c2x_enterprise_id` → a RAIZ da família dele (o `id` do pai, ou o próprio `id` quando não
       * tem pai). É por ela que se responde "estes dois produtos são da mesma família?".
       */
      raizPorC2x: Map<string, string>;
    }
> {
  const alvos = [...new Set(ids.map(texto).filter(Boolean))];
  const nomePorC2x = new Map<string, string>();
  const raizPorC2x = new Map<string, string>();
  const ehRaizPorC2x = new Set<string>();
  if (alvos.length === 0) return { ehRaizPorC2x, nomePorC2x, ok: true, pais: [], raizPorC2x };

  const { data, error } = await sb
    .from("hercules_empreendimentos")
    .select("c2x_enterprise_id, id, nome, pai_id")
    .eq("workspace_id", WORKSPACE)
    .in("c2x_enterprise_id", alvos)
    .limit(50);

  if (error) {
    console.error("[temis][cadeia] falha ao ler o cadastro dos produtos da venda", error);
    return { erro: falhaNaHierarquia(), ok: false };
  }

  const linhas = (data ?? []) as LinhaDoProduto[];
  for (const l of linhas) {
    const c2x = texto(l.c2x_enterprise_id);
    const nome = texto(l.nome);
    if (c2x && nome && !nomePorC2x.has(c2x)) nomePorC2x.set(c2x, nome);
    if (c2x && !raizPorC2x.has(c2x)) raizPorC2x.set(c2x, texto(l.pai_id) || texto(l.id));
    if (c2x && !texto(l.pai_id)) ehRaizPorC2x.add(c2x);
  }

  const paiIds = [...new Set(linhas.map((l) => texto(l.pai_id)).filter(Boolean))];
  if (paiIds.length === 0) return { ehRaizPorC2x, nomePorC2x, ok: true, pais: [], raizPorC2x };

  const doPai = await sb
    .from("hercules_empreendimentos")
    .select("c2x_enterprise_id, id, nome, pai_id")
    .eq("workspace_id", WORKSPACE)
    .in("id", paiIds);

  if (doPai.error) {
    console.error("[temis][cadeia] falha ao ler o pai dos produtos da venda", doPai.error);
    return { erro: falhaNaHierarquia(), ok: false };
  }

  return {
    ehRaizPorC2x,
    nomePorC2x,
    ok: true,
    pais: (doPai.data ?? []) as LinhaDoProduto[],
    raizPorC2x,
  };
}

/**
 * O `alias` deste produto, quando ele é a RAIZ de uma família. `{}` quando não é.
 *
 * ⚠️ SÓ A RAIZ, porque só ela vira ficha consolidada. Dar alias a uma divisão faria o `.or()` da
 * leitura procurar `group:Lagoa Bonita · LBF`, que não existe em canto nenhum.
 */
function aliasDoConsolidado(
  produtos: { ehRaizPorC2x: Set<string>; nomePorC2x: Map<string, string> },
  id: string,
): { alias?: string } {
  if (!produtos.ehRaizPorC2x.has(id)) return {};
  const nome = produtos.nomePorC2x.get(id);
  return nome ? { alias: `${PREFIXO_DO_CONSOLIDADO}${nome}` } : {};
}

function falhaNaHierarquia(): string {
  return "Não consegui ler a hierarquia do empreendimento desta venda, e é ela que diz quais anexos e qual modelo entram no contrato. Tente de novo em instantes.";
}

/** Os níveis de um degrau, na ordem da cadeia. */
export function niveisDoDegrau(
  cadeia: CadeiaDoContrato,
  degrau: DegrauDoContrato,
): NivelDaCadeia[] {
  return cadeia.niveis.filter((n) => n.degrau === degrau);
}

/** O nível que responde por um id, para a tela nomear a peça que veio dele. */
export function nivelPorId(cadeia: CadeiaDoContrato, id: string): null | NivelDaCadeia {
  const alvo = texto(id);
  if (!alvo) return null;
  return cadeia.niveis.find((n) => n.id === alvo) ?? null;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : valor == null ? "" : String(valor).trim();
}
