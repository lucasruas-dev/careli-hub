// O COORDENADOR DE VENDAS DE UM EMPREENDIMENTO, ACHADO PELO ID E NUNCA PELA SIGLA.
//
// ⚠️ POR QUE ISTO EXISTE (Lucas, 24/09/2026: *"Tivemos que mudar de nome"* · *"4 - pode"*). Todo
// aviso ao coordenador ia ao C2X pela SIGLA: `apolo_enterprise_settings.code` -> `enterprises.code
// in (...)`. Às 16:47 de 24/09 a Nivea renomeou o 43 no C2X de RECANTO DO VALE/RDV para PORTAL DO
// IBITURUNA/PDI (o MESMO id). A sigla gravada no Panteon continuou RDV, a consulta voltou vazia, e a
// CONECTTA IMOVEIS foi habilitada às 16:55 sem a LUNA saber. Nada ficou registrado: a lista vazia de
// coordenadores simplesmente não mandava nada. O mesmo já tinha acontecido com o 30 (LAG -> ADT em
// 16/07, ADT -> ACT em 21/09), e o `group:Lagoa Bonita` falhava SEMPRE (6 de 6): a "sigla" dele no
// Panteon é "LBF + LBR + LBP", que não é sigla de nada no C2X.
//
// A ORDEM, decidida no mesmo dia:
//   1. `apolo_enterprise_settings.coordenador_entity_id` (migration 0159) PREVALECE. É o cadastro do
//      Panteon, e o cadastro do empreendimento vive no banco do Panteon (Lucas, 21/09/2026). O
//      telefone sai do `apolo_contacts` da entidade pela mesma régua do aviso da venda
//      (`telefonesPorEntidade`: whatsapp antes de phone, o primário desempata), e só por último do
//      `metadata.cadastro`.
//   2. Sem ele, o C2X pelo `enterprises.id` (o `manager_id`, que o legado chama de "Gerente" e na
//      Careli é o coordenador de vendas). O id não muda quando alguém renomeia; a sigla muda.
//   3. `group:<Nome>` se resolve pelas DIVISÕES do pai no cadastro do Panteon
//      (`hercules_empreendimentos`): Lagoa Bonita -> LBF 33, LBR 27, LBP 32.
//
// ⚠️ NÃO ACHAR É UMA RESPOSTA, COM MOTIVO. Quem chama registra o disparo como `falhou` com esse
// motivo. O silêncio foi o que escondeu a CONECTTA.
//
// ⚠️ NADA AQUI LANÇA. Quando o coordenador é procurado, a habilitação (ou a etapa, ou a reserva) já
// está gravada: uma exceção viraria 500 numa operação que deu certo.

import type { SupabaseClient } from "@supabase/supabase-js";

import { cadastroEfetivo } from "@/lib/apolo/cadastro-efetivo";
import { loadApoloEnterpriseCadastroPorId } from "@/lib/apolo/empreendimentos";
import { ENTERPRISE_GROUPS } from "@/lib/guardian/c2x-analytics";
import { carregarCadastroDeEmpreendimentos, type LinhaDoCadastro } from "@/lib/hercules/cadastro";
import {
  type ContatoDoAviso,
  telefonesPorEntidade,
  TIPOS_DE_CONTATO_DO_AVISO,
} from "@/lib/hercules/telefone-do-aviso";

export type CoordenadorAchado = {
  /** A entidade no Apolo: a do cadastro do Panteon, ou a derivada do user do C2X. */
  entityId: string;
  fonte: "c2x" | "panteon";
  /** Por que não há telefone, quando não há. Vira o `erro` do disparo que não pôde sair. */
  motivoSemTelefone?: string;
  nome: string;
  /** Como está no cadastro (sem DDI). Nulo = não há para onde mandar. */
  telefone: null | string;
};

export type CoordenadoresDoPedido = {
  coordenadores: CoordenadorAchado[];
  /** Presente quando `coordenadores` está vazio: por que ninguém foi achado. */
  motivo?: string;
};

/** O pedaço do cadastro do C2X que esta busca usa (o `loadApoloEnterpriseCadastroPorId` devolve mais). */
export type CadastroDoC2xPorId = {
  enterpriseId: string;
  players: { entityId: string; name: string; phone: null | string; relation: string }[];
};

/** O pedaço do cadastro do Panteon que resolve um grupo nas suas divisões. */
export type LinhaDoCadastroDoPanteon = Pick<
  LinhaDoCadastro,
  "c2xEnterpriseId" | "codigo" | "id" | "nome" | "paiId"
>;

/** As duas leituras de fora do Supabase, trocáveis no teste. */
export type FontesDoCoordenador = {
  cadastroDoC2x: (
    ids: string[],
  ) => Promise<{ cadastros: CadastroDoC2xPorId[]; ok: true } | { error: string; ok: false }>;
  cadastroDoPanteon: () => Promise<LinhaDoCadastroDoPanteon[]>;
};

// ⚠️ EMBRULHADAS EM FUNÇÃO, e não referências diretas: o acesso ao import fica para a hora da
// chamada. Com referência direta, todo teste que já troca `@/lib/apolo/empreendimentos` por um mock
// sem a busca nova quebraria no carregamento deste arquivo, mesmo sem nunca procurar coordenador.
function fontesReais(): FontesDoCoordenador {
  return {
    cadastroDoC2x: (ids) => loadApoloEnterpriseCadastroPorId(ids),
    cadastroDoPanteon: () => carregarCadastroDeEmpreendimentos(),
  };
}

export const MOTIVO_SEM_COORDENADOR =
  "Empreendimento sem coordenador de vendas no Panteon nem no C2X.";
export const MOTIVO_C2X_FORA_DO_AR =
  "Não foi possível ler o cadastro do empreendimento no C2X.";
export const MOTIVO_GRUPO_SEM_DIVISOES =
  "Empreendimento consolidado sem divisões no cadastro do Panteon: não dá para achar o coordenador.";
export const MOTIVO_FALHA_DE_LEITURA =
  "Não foi possível ler o coordenador do empreendimento agora.";

const PREFIXO_DO_GRUPO = "group:";

function normalizar(texto: null | string | undefined): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function limpo(valor: null | string | undefined): null | string {
  const texto = String(valor ?? "").trim();
  return texto ? texto : null;
}

function unicos(lista: readonly (null | string | undefined)[]): string[] {
  return [...new Set(lista.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

/**
 * Os ids do C2X que respondem por um pedido: o próprio id, ou as divisões do grupo.
 *
 * ⚠️ O GRUPO SE RESOLVE PELO CADASTRO DO PANTEON, e não pelo catálogo do C2X: o catálogo junta as
 * divisões pela SIGLA do legado, que é justamente o que muda quando alguém renomeia lá. O pai tem o
 * nome do grupo (`group:Lagoa Bonita` -> o LAB, "Lagoa Bonita") e as divisões apontam para ele.
 *
 * ⚠️ O PAI NÃO ENTRA, SÓ AS DIVISÕES. É a mesma composição de `ENTERPRISE_GROUPS` e da equivalência
 * (lib/apolo/empreendimento-equivalencia.ts), e não é detalhe: o LAB (31) tem no C2X a LUNA como
 * gerente, e as três glebas têm a MATHEUS GUEDES (medido em 24/09/2026). Com o pai junto, a
 * habilitação no Lagoa Bonita avisaria uma coordenadora que não é do produto.
 *
 * Se o pai não for achado pelo nome (renomeado no Panteon, por exemplo), `ENTERPRISE_GROUPS` dá as
 * siglas das divisões, casadas no CÓDIGO DO CADASTRO DO PANTEON (o nosso, não o do legado).
 *
 * Exportada (e pura) para o teste.
 */
export function idsDoC2xDoPedido(
  pedido: null | string | undefined,
  cadastro: readonly LinhaDoCadastroDoPanteon[],
): string[] {
  const id = String(pedido ?? "").trim();
  if (!id) return [];
  if (!id.startsWith(PREFIXO_DO_GRUPO)) return [id];

  const nome = normalizar(id.slice(PREFIXO_DO_GRUPO.length));
  const pais = new Set(
    cadastro.filter((linha) => !linha.paiId && normalizar(linha.nome) === nome).map((l) => l.id),
  );
  const dasDivisoes = unicos(
    cadastro
      .filter((linha) => linha.paiId !== null && pais.has(linha.paiId))
      .map((linha) => linha.c2xEnterpriseId),
  );
  if (dasDivisoes.length > 0) return dasDivisoes;

  const siglas = new Set(
    (ENTERPRISE_GROUPS.find((grupo) => normalizar(grupo.display) === nome)?.codes ?? []).map((c) =>
      c.toUpperCase(),
    ),
  );
  return unicos(
    cadastro
      .filter((linha) => siglas.has(String(linha.codigo ?? "").toUpperCase()))
      .map((linha) => linha.c2xEnterpriseId),
  );
}

type Entidade = { nome: string; telefone: null | string };

/**
 * Nome e telefone das entidades que o Panteon cadastrou como coordenador.
 *
 * Devolve `null` quando a leitura falha: "não consegui ler" e "a entidade não existe mais" são
 * coisas diferentes, e as duas mandam a busca para o C2X, mas só a segunda é normal.
 */
async function entidadesDoPanteon(
  client: SupabaseClient,
  ids: string[],
): Promise<Map<string, Entidade> | null> {
  if (ids.length === 0) return new Map();

  const [entidades, contatos] = await Promise.all([
    client
      .from("apolo_entities")
      .select("id, display_name, trade_name, legal_name, metadata")
      .in("id", ids),
    client
      .from("apolo_contacts")
      .select("entity_id, value, is_primary, contact_type")
      .in("contact_type", [...TIPOS_DE_CONTATO_DO_AVISO])
      .in("entity_id", ids),
  ]);

  if (entidades.error) {
    console.error("[apolo][coordenador] falha ao ler a entidade do coordenador", entidades.error);
    return null;
  }
  if (contatos.error) {
    // Sem os contatos a entidade ainda vale: o telefone cai no metadata e, se faltar, no C2X da
    // mesma pessoa. Perder o nome por causa do telefone seria trocar o coordenador certo por outro.
    console.error("[apolo][coordenador] falha ao ler o telefone do coordenador", contatos.error);
  }

  const telefones = telefonesPorEntidade((contatos.data ?? []) as ContatoDoAviso[]);
  const saida = new Map<string, Entidade>();

  for (const linha of (entidades.data ?? []) as Array<{
    display_name: null | string;
    id: string;
    legal_name: null | string;
    metadata: null | Record<string, unknown>;
    trade_name: null | string;
  }>) {
    const doCadastro = cadastroEfetivo(
      linha.metadata as Parameters<typeof cadastroEfetivo>[0],
    ).telefone;
    saida.set(String(linha.id), {
      // Nome de exibição primeiro, como no resto dos avisos (decisão do Lucas em 26/07/2026).
      nome:
        limpo(linha.display_name) ?? limpo(linha.trade_name) ?? limpo(linha.legal_name) ?? "Coordenador",
      telefone:
        telefones.get(String(linha.id)) ?? (typeof doCadastro === "string" ? limpo(doCadastro) : null),
    });
  }

  return saida;
}

type Plano = {
  /** As entidades do Panteon e as unidades do C2X que cada uma cobre. */
  doPanteon: { entityId: string; unidades: string[] }[];
  /** Unidades sem coordenador no Panteon: vão ao C2X. */
  paraOC2x: string[];
  unidades: string[];
};

/**
 * O coordenador de cada empreendimento pedido, com o motivo quando não há.
 *
 * Aceita o id numérico do C2X (o que o Panteon guarda em todo lugar) e o `group:<Nome>` do
 * consolidado. A chave do mapa devolvido é o id como veio, aparado.
 */
export async function coordenadoresDosPedidos(
  client: SupabaseClient,
  enterpriseIds: readonly (null | number | string | undefined)[],
  fontes: FontesDoCoordenador = fontesReais(),
): Promise<Map<string, CoordenadoresDoPedido>> {
  const pedidos = unicos(enterpriseIds.map((id) => (id === null || id === undefined ? null : String(id))));
  const resultado = new Map<string, CoordenadoresDoPedido>();
  if (pedidos.length === 0) return resultado;

  try {
    // ── 1. As divisões dos grupos, pelo cadastro do Panteon ────────────────────────────────────
    let cadastro: LinhaDoCadastroDoPanteon[] = [];
    if (pedidos.some((p) => p.startsWith(PREFIXO_DO_GRUPO))) {
      try {
        cadastro = await fontes.cadastroDoPanteon();
      } catch (erro) {
        console.error("[apolo][coordenador] cadastro do Panteon indisponível", erro);
      }
    }
    const unidadesDoPedido = new Map(pedidos.map((p) => [p, idsDoC2xDoPedido(p, cadastro)]));

    // ── 2. O coordenador que o Panteon cadastrou (prevalece) ───────────────────────────────────
    const todos = unicos([...pedidos, ...[...unidadesDoPedido.values()].flat()]);
    const coordenadorCadastrado = new Map<string, string>();
    const { data: settings, error: erroDoSettings } = await client
      .from("apolo_enterprise_settings")
      .select("enterprise_id, coordenador_entity_id")
      .in("enterprise_id", todos);
    if (erroDoSettings) {
      // Sem o cadastro do Panteon, o C2X por id ainda responde: é o comportamento de antes de a
      // coluna existir, e melhor que não avisar ninguém.
      console.error("[apolo][coordenador] falha ao ler apolo_enterprise_settings", erroDoSettings);
    }
    for (const linha of (settings ?? []) as Array<{
      coordenador_entity_id: null | string;
      enterprise_id: string;
    }>) {
      const entidade = limpo(linha.coordenador_entity_id);
      if (entidade) coordenadorCadastrado.set(String(linha.enterprise_id).trim(), entidade);
    }

    const planos = new Map<string, Plano>();
    for (const pedido of pedidos) {
      const unidades = unidadesDoPedido.get(pedido) ?? [];
      // O coordenador do GRUPO, quando cadastrado na linha do grupo, vale para todas as divisões.
      const doPedido = coordenadorCadastrado.get(pedido);
      if (doPedido) {
        planos.set(pedido, { doPanteon: [{ entityId: doPedido, unidades }], paraOC2x: [], unidades });
        continue;
      }
      const plano: Plano = { doPanteon: [], paraOC2x: [], unidades };
      for (const unidade of unidades) {
        const entidade = coordenadorCadastrado.get(unidade);
        if (entidade) plano.doPanteon.push({ entityId: entidade, unidades: [unidade] });
        else plano.paraOC2x.push(unidade);
      }
      planos.set(pedido, plano);
    }

    const entidades = await entidadesDoPanteon(
      client,
      unicos([...planos.values()].flatMap((p) => p.doPanteon.map((d) => d.entityId))),
    );

    // ⚠️ ENTIDADE QUE NÃO EXISTE MAIS (merge, arquivamento; a 0159 não tem FK de propósito) OU
    // LEITURA QUE FALHOU: a unidade volta para o C2X. A entidade SEM TELEFONE também consulta o
    // C2X, mas só para achar o telefone da MESMA pessoa (ver abaixo).
    const paraTelefone = new Set<string>();
    for (const plano of planos.values()) {
      for (const doPanteon of plano.doPanteon) {
        const entidade = entidades?.get(doPanteon.entityId);
        if (!entidade) plano.paraOC2x.push(...doPanteon.unidades);
        else if (!entidade.telefone) doPanteon.unidades.forEach((u) => paraTelefone.add(u));
      }
    }

    // ── 3. O C2X, pelo id ──────────────────────────────────────────────────────────────────────
    const idsNoC2x = unicos([...[...planos.values()].flatMap((p) => p.paraOC2x), ...paraTelefone]).filter(
      (id) => /^\d+$/.test(id),
    );
    const doC2x = new Map<string, CadastroDoC2xPorId["players"][number]>();
    let c2xFalhou = false;
    if (idsNoC2x.length > 0) {
      try {
        const lido = await fontes.cadastroDoC2x(idsNoC2x);
        if (lido.ok) {
          for (const cadastroDoC2x of lido.cadastros) {
            const coordenador = cadastroDoC2x.players.find((p) => p.relation === "coordenador_vendas");
            if (coordenador) doC2x.set(String(cadastroDoC2x.enterpriseId).trim(), coordenador);
          }
        } else {
          c2xFalhou = true;
          console.error("[apolo][coordenador] C2X indisponível:", lido.error);
        }
      } catch (erro) {
        c2xFalhou = true;
        console.error("[apolo][coordenador] falha ao ler o cadastro no C2X", erro);
      }
    }

    // ── 4. A resposta de cada pedido ───────────────────────────────────────────────────────────
    for (const [pedido, plano] of planos) {
      const achados: CoordenadorAchado[] = [];

      for (const doPanteon of plano.doPanteon) {
        const entidade = entidades?.get(doPanteon.entityId);
        if (!entidade) continue;
        // ⚠️ O TELEFONE DO C2X SÓ ENTRA SE FOR A MESMA PESSOA. Medido em 24/09/2026: SDT, CDJ, ADT e
        // GDN têm no Panteon a CARELI ACESSORIA (sem telefone) e no C2X a CARELI ASSESSORIA
        // FINANCEIRA, outra entidade. Pegar o número do legado ali mandaria o aviso para quem o
        // Panteon NÃO cadastrou, que é o contrário de "o Panteon prevalece".
        const telefone =
          entidade.telefone ??
          limpo(
            doPanteon.unidades
              .map((unidade) => doC2x.get(unidade))
              .find((player) => player?.entityId === doPanteon.entityId && limpo(player.phone))?.phone,
          );
        achados.push({
          entityId: doPanteon.entityId,
          fonte: "panteon",
          nome: entidade.nome,
          telefone,
          ...(telefone
            ? {}
            : { motivoSemTelefone: `Coordenador ${entidade.nome} sem telefone no cadastro do Panteon.` }),
        });
      }

      for (const unidade of plano.paraOC2x) {
        const player = doC2x.get(unidade);
        if (!player) continue;
        const telefone = limpo(player.phone);
        achados.push({
          entityId: player.entityId,
          fonte: "c2x",
          nome: player.name,
          telefone,
          ...(telefone ? {} : { motivoSemTelefone: `Coordenador ${player.name} sem telefone no C2X.` }),
        });
      }

      // A mesma pessoa em várias divisões (a MATHEUS GUEDES nas três glebas) é UM coordenador. Entre
      // duas leituras da mesma pessoa, fica a que tem telefone.
      const porEntidade = new Map<string, CoordenadorAchado>();
      for (const achado of achados) {
        const atual = porEntidade.get(achado.entityId);
        if (!atual || (!atual.telefone && achado.telefone)) porEntidade.set(achado.entityId, achado);
      }
      const coordenadores = [...porEntidade.values()];

      resultado.set(
        pedido,
        coordenadores.length > 0
          ? { coordenadores }
          : {
              coordenadores,
              motivo:
                plano.unidades.length === 0
                  ? MOTIVO_GRUPO_SEM_DIVISOES
                  : c2xFalhou && plano.paraOC2x.length > 0
                    ? MOTIVO_C2X_FORA_DO_AR
                    : MOTIVO_SEM_COORDENADOR,
            },
      );
    }
  } catch (erro) {
    console.error("[apolo][coordenador] falha ao procurar o coordenador", erro);
    for (const pedido of pedidos) {
      if (!resultado.has(pedido)) {
        resultado.set(pedido, { coordenadores: [], motivo: MOTIVO_FALHA_DE_LEITURA });
      }
    }
  }

  return resultado;
}

/**
 * UM coordenador para UM aviso (a etapa da CAD, a reprovação): o primeiro com telefone que sirva
 * para WhatsApp, ou o motivo de não haver.
 *
 * ⚠️ O MOTIVO DISTINGUE "SEM COORDENADOR" DE "SEM TELEFONE": os dois mandam o operador para lugares
 * diferentes (o cadastro do empreendimento ou a ficha do coordenador), e o registro de falha precisa
 * dizer qual foi.
 */
export async function coordenadorParaAviso(
  client: SupabaseClient,
  enterpriseId: string,
  fontes?: FontesDoCoordenador,
): Promise<{ motivo?: string; nome: null | string; telefone: null | string }> {
  const id = String(enterpriseId ?? "").trim();
  const resposta = (await coordenadoresDosPedidos(client, [id], fontes)).get(id);
  const coordenadores = resposta?.coordenadores ?? [];

  // Menos de 10 dígitos não é número que o gateway entregue (é o mesmo corte de `telefoneParaEnvio`).
  const serve = (telefone: null | string) => (telefone ?? "").replace(/\D/g, "").length >= 10;
  const comTelefone = coordenadores.find((c) => serve(c.telefone));
  if (comTelefone) return { nome: comTelefone.nome, telefone: comTelefone.telefone };

  const primeiro = coordenadores[0];
  if (primeiro) {
    return {
      motivo:
        primeiro.motivoSemTelefone ??
        `Coordenador ${primeiro.nome} com telefone que não serve para WhatsApp.`,
      nome: primeiro.nome,
      telefone: null,
    };
  }

  return { motivo: resposta?.motivo ?? MOTIVO_SEM_COORDENADOR, nome: null, telefone: null };
}
