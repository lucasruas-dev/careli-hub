import type { SupabaseClient } from "@supabase/supabase-js";

import {
  conferirBloqueio,
  ehBloqueioNativo,
  type ErroDoBloqueio,
  motivoDoBloqueio,
  type PedidoDeBloqueio,
} from "./bloqueio-de-unidade";
import { ETAPAS_DO_FLUXO } from "./fluxo-de-venda";
import { lerComColunasDoApartamento, nomeDaUnidade } from "./nome-da-unidade";
import {
  acharUnidade,
  estaLivre,
  lerSituacaoDasUnidades,
  rotuloDaSituacao,
  type SituacaoDasUnidades,
  type SituacaoDaUnidade,
} from "./situacao-da-unidade";
import { fraseDoConflito, outrosDonosDoLote } from "./trava-do-lote";

// BLOQUEAR E DESBLOQUEAR A UNIDADE — UMA REGRA SÓ, DUAS PORTAS.
//
// Lucas (18/09/2026): *"cadastro apolo, interações comerciais hercules"* · *"eu posso por exemplo,
// bloquear uma unidade dentro do apolo e isso tem que refletir no hercules"*.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE. Até aqui o bloqueio morava inteiro dentro da rota do portal
// (/api/incorporador/venda/bloqueio). O Apolo ganhou o mesmo botão, e a saída fácil seria copiar a
// rota: duas cópias de "só bloqueia lote livre" são duas réguas no dia em que uma delas mudar, e é
// exatamente a queixa do Lucas (*"esses status tem que morar em um so lugar"*). Aqui fica a REGRA
// (o que pode, o que grava, com qual trava); cada rota fica só com a PORTA dela (quem é a sessão,
// qual o escopo).
//
// ⚠️ O BLOQUEIO GRAVA NO CADASTRO (`hercules_unidades`), que é o que as duas telas leem pela régua
// única (`situacao-da-unidade.ts`). Bloqueou no Apolo, a Venda do Hércules vê `bloqueada` na mesma
// hora; bloqueou no Hércules, o Apolo vê. Nenhuma das duas guarda estado próprio.
//
// ⚠️ SEM SABER, NÃO GRAVA. Toda leitura que falha termina em recusa (500), nunca em gravação.

const WORKSPACE = "careli";

// O autor vai para `bloqueado_por`, que é `uuid` sem FK (0163). O hub e o portal têm usuários em
// tabelas diferentes, os dois com id uuid; o que não for uuid (o atalho de ambiente local do hub,
// "local-hub-user") vira nulo em vez de derrubar o UPDATE com erro de tipo. O NOME é o que o
// histórico lê, e ele vai sempre.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UnidadeDoBloqueio = {
  /** Só no prédio (0171). Ausente quando a coluna ainda não existe. */
  apartamento?: null | string;
  bloqueado_em: null | string;
  codigo: null | string;
  enterprise_id: null | string;
  espelho_de: null | string;
  id: string;
  lote: null | string;
  quadra: null | string;
  situacao: null | string;
  /** Só no prédio. Nulo = torre única. */
  torre?: null | string;
};

/** Quem está bloqueando: o id vai para `bloqueado_por` (se for uuid), o nome é copiado no ato. */
export type QuemBloqueia = { id: null | string; nome: null | string };

/**
 * A resposta de cada verbo, já no formato que a rota devolve.
 *
 * ⚠️ `corpo` E NÃO SÓ UMA FRASE, porque o 422 do bloqueio fala no formato da casa (`erros`, campo +
 * frase), que a modal lê para pintar o erro embaixo do campo certo (ver `ErroDoBloqueio`).
 */
export type ResultadoDoBloqueio =
  | { data: { bloqueadoPor: null | string; motivo: string; unidade: string }; ok: true }
  | { corpo: { error: string } | { erros: ErroDoBloqueio[] }; ok: false; status: 409 | 422 | 500 };

export type ResultadoDoDesbloqueio =
  | { data: { unidade: string }; ok: true }
  | { corpo: { error: string }; ok: false; status: 409 | 500 };

/**
 * A unidade pelo id, com as colunas do prédio quando a 0171 já existe.
 *
 * ⚠️ UMA LEITURA PARA OS DOIS VERBOS (16/09/2026). É desta linha que sai o nome devolvido à tela
 * ("Torre A · Apto 304"); sem a 0171, a leitura repete sem as colunas.
 *
 * ⚠️ ERRO LANÇA (quem chama responde 500). Até 18/09/2026 a rota do portal tratava o erro de banco
 * como "Unidade não encontrada" (404): nada era gravado, mas a frase mentia sobre o motivo.
 */
export async function lerUnidadeDoBloqueio(
  client: SupabaseClient,
  unidadeId: string,
): Promise<null | UnidadeDoBloqueio> {
  const { data, error } = await lerComColunasDoApartamento((extras) =>
    client
      .from("hercules_unidades")
      .select(`id,codigo,quadra,lote,situacao,enterprise_id,espelho_de,bloqueado_em${extras}`)
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle(),
  );
  if (error) {
    throw new Error(String((error as { message?: string }).message ?? error));
  }
  return (data ?? null) as unknown as null | UnidadeDoBloqueio;
}

/** O nome da unidade para a resposta, com as colunas do prédio quando vieram. */
export function nomeDaUnidadeDoBloqueio(unidade: UnidadeDoBloqueio): string {
  return nomeDaUnidade({
    apartamento: unidade.apartamento,
    codigo: unidade.codigo ?? "",
    lote: unidade.lote,
    quadra: unidade.quadra,
    torre: unidade.torre,
  });
}

/** A situação é um passo do caminho da venda (reserva, proposta, contrato, assinatura, faturado)? */
function emProcessoDeVenda(situacao: SituacaoDaUnidade): boolean {
  return (ETAPAS_DO_FLUXO as readonly string[]).includes(situacao);
}

/**
 * A situação do TERRENO desta unidade, pela régua única, e a leitura inteira (a trava do
 * desbloqueio precisa dela para procurar outro dono).
 *
 * ⚠️ É A MESMA RESPOSTA QUE AS GRADES MOSTRAM (a Venda do Hércules e a aba Unidades do Apolo), e é
 * por isso que ninguém mais faz esta conta na mão. A régua pergunta pelo terreno inteiro (a linha
 * viva e a antiga do pai, que aponta para ela por `espelho_de`) e enxerga a reserva do Hércules e a
 * do evento de lançamento, que a conta antiga da rota não via.
 *
 * ⚠️ `situacao` NULA = NÃO SE SABE, e quem chama trata como ocupado. Falha de leitura LANÇA.
 */
async function situacaoDoTerreno(
  client: SupabaseClient,
  unidade: UnidadeDoBloqueio,
): Promise<{ situacao: null | SituacaoDaUnidade; situacoes: SituacaoDasUnidades }> {
  const situacoes = await lerSituacaoDasUnidades(client, [String(unidade.enterprise_id ?? "")]);
  const achada = acharUnidade(situacoes, { linhaId: unidade.id });
  // Só a própria linha responde: `porLinha` também acha pela linha antiga do pai, e a pergunta
  // aqui é sobre a linha que se vai gravar.
  return { situacao: achada && achada.id === unidade.id ? achada.situacao : null, situacoes };
}

/**
 * BLOQUEAR — a empresa tira o lote da venda, com o motivo escrito.
 *
 * Lucas (14/09/2026): *"não pode ter nenhuma proposta, reserva, contrato, o bloqueio aparece somente
 * quando não há nada na unidade. se tiver uma reserva, primeiro ele cancela a reserva para depois
 * bloquear o lote"*.
 *
 * A porta (sessão, escopo, quem opera o produto) já passou quando esta função é chamada; aqui só
 * mora o que vale para as duas portas.
 */
export async function bloquearUnidade(
  client: SupabaseClient,
  entrada: { autor: QuemBloqueia; pedido: PedidoDeBloqueio; unidade: UnidadeDoBloqueio },
): Promise<ResultadoDoBloqueio> {
  const { autor, pedido, unidade } = entrada;

  // ⚠️ A MESMA conferência da modal, de novo aqui: pedido forjado não passa por nenhuma das portas.
  const erros = conferirBloqueio(pedido);
  if (erros.length > 0) return { corpo: { erros }, ok: false, status: 422 };

  // ⚠️ A LINHA ESPELHO NÃO RESPONDE POR NADA, E BLOQUEÁ-LA NÃO TIRA O LOTE DA VENDA. O mesmo terreno
  // tem DUAS linhas nos produtos divididos (Lagoa Bonita, Vale do Ouro): a do pai, que é história
  // parada, e a da gleba que vende. Bloquear a do pai deixaria o lote sendo oferecido normalmente
  // pela gleba, e quem clicou olharia a tela achando que resolveu.
  if (unidade.espelho_de) {
    return {
      corpo: { error: "Esta linha é o registro antigo do terreno. Bloqueie o lote pela gleba que vende." },
      ok: false,
      status: 409,
    };
  }

  try {
    // ⚠️ SÓ BLOQUEIA LOTE LIVRE, E QUEM DIZ SE ESTÁ LIVRE É A RÉGUA ÚNICA. Ela já responde pela
    // proposta viva (pela etapa, e não por `aberta`, que nunca volta a falso), pelo terreno inteiro
    // e pela reserva, do Hércules ou do evento de lançamento.
    //
    // ⚠️ ESTA CONFERÊNCIA DÁ A FRASE; A TRAVA DE VERDADE É O UPDATE CONDICIONAL abaixo. Entre esta
    // leitura e a gravação cabe uma reserva de outra pessoa, e só o banco decide isso.
    const { situacao } = await situacaoDoTerreno(client, unidade);
    if (!situacao) {
      return {
        corpo: { error: "Não foi possível confirmar a situação desta unidade. Recarregue a tela." },
        ok: false,
        status: 409,
      };
    }
    if (!estaLivre(situacao)) {
      return {
        corpo: {
          error: emProcessoDeVenda(situacao)
            ? `Esta unidade tem um processo de venda em andamento (${rotuloDaSituacao(situacao)}). Cancele antes de bloquear o lote.`
            : `Situação da unidade: ${rotuloDaSituacao(situacao)}. Só unidade disponível pode ser bloqueada.`,
        },
        ok: false,
        status: 409,
      };
    }

    const agora = new Date().toISOString();
    const motivo = motivoDoBloqueio(pedido);
    const nome = String(autor.nome ?? "").trim() || null;

    // ⚠️ O UPDATE É CONDICIONAL, E É ELE A TRAVA. `.update()` sem `.select()` devolve sucesso mesmo
    // casando ZERO linhas. Repetindo `situacao = 'disponivel'` no `eq`, o banco decide: quem chegar
    // depois de uma reserva não casa linha nenhuma, e o `select` devolve lista vazia em vez de um
    // sucesso mentiroso.
    const { data: gravadas, error } = await client
      .from("hercules_unidades")
      .update({
        atualizado_em: agora,
        bloqueado_em: agora,
        bloqueado_por: autor.id && UUID.test(autor.id) ? autor.id : null,
        bloqueado_por_nome: nome,
        bloqueio_motivo: motivo,
        situacao: "bloqueada",
      })
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidade.id)
      .eq("situacao", "disponivel")
      .select("id");

    if (error) {
      console.error("[hercules][bloqueio] update falhou", error.message);
      return { corpo: { error: "Não foi possível bloquear a unidade." }, ok: false, status: 500 };
    }
    if (!Array.isArray(gravadas) || gravadas.length === 0) {
      // Alguém chegou primeiro entre a leitura e a gravação.
      return {
        corpo: { error: "A unidade deixou de estar disponível. Recarregue a tela." },
        ok: false,
        status: 409,
      };
    }

    return {
      data: { bloqueadoPor: nome, motivo, unidade: nomeDaUnidadeDoBloqueio(unidade) },
      ok: true,
    };
  } catch (erro) {
    // Falha de leitura da régua: nada foi gravado, e o lote não é tratado como livre.
    console.error("[hercules][bloqueio]", erro);
    return { corpo: { error: "Não foi possível bloquear a unidade." }, ok: false, status: 500 };
  }
}

/**
 * DESBLOQUEAR — o lote volta ao estoque.
 *
 * ⚠️ A VOLTA NÃO É SIMÉTRICA, e é a direção perigosa: desbloquear é pôr um lote de volta na
 * prateleira. Medido em 14/09/2026: 38 unidades estão `bloqueada` no cadastro E TÊM PROPOSTA VIVA
 * (bloqueios herdados do C2X em cima de vendas que andam no legado). Devolvê-las às cegas seria
 * convidar a segunda venda, que é o erro que dá processo (Lucas, 18/09/2026: *"eu não posso vender
 * dois lotes para pessoas diferentes"*). Por isso a volta exige TRÊS provas:
 *   1. o bloqueio foi feito NO PANTEON (tem carimbo). O herdado do C2X a próxima carga refaria
 *      sozinha, e o lote voltaria a se bloquear horas depois sem ninguém ter mexido;
 *   2. a régua única diz `bloqueada` (com o cadastro `bloqueada`, qualquer proposta viva no terreno
 *      responde a etapa dela, e qualquer reserva viva responde `reservado`);
 *   3. a trava do lote (`trava-do-lote.ts`) não acha OUTRO DONO vivo em nenhuma linha do terreno,
 *      em leitura fresca. É a mesma pergunta que a reserva e a proposta fazem antes de gravar, e
 *      ela vê o que a régua não conta (reserva do Hércules na situação `proposta`).
 *
 * ⚠️ O CARIMBO SAI JUNTO. Sem limpar `bloqueado_em`, a unidade continuaria protegida da carga do C2X
 * como se ainda estivesse bloqueada, e o motivo antigo ficaria pendurado numa unidade disponível.
 */
export async function desbloquearUnidade(
  client: SupabaseClient,
  entrada: { unidade: UnidadeDoBloqueio },
): Promise<ResultadoDoDesbloqueio> {
  const { unidade } = entrada;

  if (unidade.situacao !== "bloqueada") {
    return { corpo: { error: "Esta unidade não está bloqueada." }, ok: false, status: 409 };
  }

  if (!ehBloqueioNativo(unidade)) {
    return {
      corpo: {
        error:
          "Este bloqueio veio do C2X, e é lá que ele se desfaz. Aqui só é possível desfazer bloqueio feito no Panteon.",
      },
      ok: false,
      status: 409,
    };
  }

  try {
    const { situacao, situacoes } = await situacaoDoTerreno(client, unidade);
    if (situacao !== "bloqueada") {
      return {
        corpo: {
          error:
            situacao && emProcessoDeVenda(situacao)
              ? "Esta unidade tem um processo de venda em andamento e não pode voltar ao estoque."
              : "Não foi possível confirmar a situação desta unidade. Recarregue a tela.",
        },
        ok: false,
        status: 409,
      };
    }

    // ⚠️ NULO = NÃO DEU PARA SABER, e sem saber quem é dono o lote não volta à prateleira.
    const donos = await outrosDonosDoLote(client, situacoes, unidade.id, {});
    if (donos === null) {
      return { corpo: { error: fraseDoConflito(null) }, ok: false, status: 500 };
    }
    if (donos.length > 0) {
      return {
        corpo: {
          error: `Esta unidade tem um processo de venda em andamento (${donos[0]?.descricao ?? "outro dono"}) e não pode voltar ao estoque.`,
        },
        ok: false,
        status: 409,
      };
    }

    const { data: gravadas, error } = await client
      .from("hercules_unidades")
      .update({
        atualizado_em: new Date().toISOString(),
        bloqueado_em: null,
        bloqueado_por: null,
        bloqueado_por_nome: null,
        bloqueio_motivo: null,
        situacao: "disponivel",
      })
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidade.id)
      .eq("situacao", "bloqueada")
      .select("id");

    if (error) {
      console.error("[hercules][bloqueio] desbloquear falhou", error.message);
      return { corpo: { error: "Não foi possível desbloquear a unidade." }, ok: false, status: 500 };
    }
    if (!Array.isArray(gravadas) || gravadas.length === 0) {
      return { corpo: { error: "A unidade mudou de estado. Recarregue a tela." }, ok: false, status: 409 };
    }

    return { data: { unidade: nomeDaUnidadeDoBloqueio(unidade) }, ok: true };
  } catch (erro) {
    console.error("[hercules][bloqueio][desbloquear]", erro);
    return { corpo: { error: "Não foi possível desbloquear a unidade." }, ok: false, status: 500 };
  }
}

// ── O QUE A ABA UNIDADES DO APOLO MOSTRA DO BLOQUEIO ────────────────────────

/** O bloqueio feito no Panteon, como a tela o escreve. */
export type BloqueioNativo = { em: string; motivo: null | string; porNome: null | string };

/**
 * Os bloqueios feitos NO PANTEON (com carimbo) destas linhas: quem, quando e por quê.
 *
 * ⚠️ LÊ OS CARIMBADOS DO BANCO INTEIRO E FILTRA EM MEMÓRIA, e não `.in(id, ...)`: são poucas linhas
 * (o índice parcial `hercules_unidades_bloqueio_nativo` da 0163 existe para esta pergunta), e um
 * `.in()` com as centenas de ids de um loteamento estouraria a URL.
 *
 * ⚠️ ERRO LANÇA. Quem chama decide: a aba Unidades segue sem os detalhes (a situação não depende
 * disto, e o servidor reconfere tudo antes de desbloquear).
 */
export async function lerBloqueiosNativos(
  client: SupabaseClient,
  linhaIds: readonly string[],
): Promise<Map<string, BloqueioNativo>> {
  const alvo = new Set(linhaIds.map((id) => String(id)).filter(Boolean));
  const saida = new Map<string, BloqueioNativo>();
  if (alvo.size === 0) return saida;

  const PAGINA = 1000;
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await client
      .from("hercules_unidades")
      .select("id,bloqueado_em,bloqueado_por_nome,bloqueio_motivo")
      .eq("workspace_id", WORKSPACE)
      .not("bloqueado_em", "is", null)
      .order("id")
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    const pagina = (data ?? []) as Array<{
      bloqueado_em: null | string;
      bloqueado_por_nome: null | string;
      bloqueio_motivo: null | string;
      id: string;
    }>;
    for (const linha of pagina) {
      if (!alvo.has(String(linha.id)) || !linha.bloqueado_em) continue;
      saida.set(String(linha.id), {
        em: linha.bloqueado_em,
        motivo: linha.bloqueio_motivo ?? null,
        porNome: linha.bloqueado_por_nome ?? null,
      });
    }
    if (pagina.length < PAGINA) break;
  }
  return saida;
}
