import { NextResponse } from "next/server";

import { ehUuid, type RecorteDaFila } from "@/lib/apolo/board-do-servidor";
import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";
import { ehIdDoPai, expandirIdDoPainel } from "@/lib/hercules/expandir-id-do-painel";

import { autorizar, foraDoEscopo, idsDaSessao } from "./escopo";
import { ehPortalComercial } from "./perfis-de-portal";
import type { SessaoIncorporador } from "./sessao";

// O BOARD DO APOLO DENTRO DO PORTAL COMERCIAL — o recorte que TODA rota `/api/incorporador/board/**`
// faz antes de tocar em qualquer CAD.
//
// Pedido do Lucas (02/09/2026), sobre a aba Cadastro do produto no Hércules: *"deixa cadastro
// mesmo e traz a mesma visão do apolo, imobiliária e cads"*. É o Board do Apolo por outra porta:
// cookie do coordenador no lugar do Bearer do hub, e SÓ as CADs e imobiliárias do produto dele.
//
// ⚠️ O ESCOPO VEM DO COOKIE, NUNCA DA URL — a mesma régua de vendas/route.ts, copiada daqui para
// não divergir: `idsDaSessao` é a única fonte dos ids; o `emp` da query apenas ESCOLHE um dos
// produtos que a sessão já alcança e só consegue REDUZIR. Produto que não é dele não dá erro
// revelador: 404, o mesmo de um produto inexistente (`foraDoEscopo`).
//
// ⚠️ SÓ O PORTAL COMERCIAL. O cookie do incorporador comum (o dono do loteamento) também passa em
// `sessaoDoRequest`, mas o Board carrega CPF, endereço e documento do comprador, e a regra das
// rotas do incorporador é "documento pessoal nunca sai daqui". Para ele estas rotas não existem.

export type RecorteDoProduto = {
  /**
   * Os enterprise_ids que o produto cobre, em TODOS os formatos vivos no banco: as divisões
   * reais ("33", "27", "32") e, quando o produto cobre o grupo inteiro, o id do grupo
   * ("group:Lagoa Bonita") — porque `apolo_esteira.enterprise_id` e o vínculo da imobiliária
   * podem estar gravados em qualquer um dos dois (medido em 17/08: 150 com divisão, 1 com grupo).
   */
  ids: Set<string>;
  /** Os nomes do catálogo cobertos: vira a lista `empreendimentos` da fila (rótulo da tela). */
  nomes: string[];
  sessao: SessaoIncorporador;
};

type Autorizacao =
  | { ok: false; response: NextResponse }
  | { ok: true; sessao: SessaoIncorporador };

/** Porta de entrada: sessão válida E portal comercial. Incorporador comum: 404, como se não existisse. */
export function autorizarComercial(request: Request): Autorizacao {
  const auth = autorizar(request);
  if (!auth.ok) return auth;
  if (!ehPortalComercial(auth.sessao.tipo)) {
    return { ok: false, response: foraDoEscopo() };
  }
  return { ok: true, sessao: auth.sessao };
}

/**
 * Traduz o `?emp=` da query no recorte do produto, DENTRO do que a sessão autoriza.
 *
 * O `emp` chega em DOIS formatos (mesma convenção de vendas/route.ts):
 *   • "pai:<uuid>", o PAI do cadastro do Panteon (hercules_empreendimentos) — o que a ficha do
 *     produto manda. Expande para os c2x ids dos filhos autorizados (ou o espelho do pai, quando
 *     não tem filho) pela MESMA regra que montou os cards do painel (`alcanceDoPai`);
 *   • o id do catálogo do C2X ("group:Lagoa Bonita" ou "37"). O id de GRUPO abre as divisões
 *     (é a assimetria de `idsDaSessao`: o grupo abre as divisões; a divisão vale só por ela).
 * Sem `emp`: tudo o que a sessão alcança.
 *
 * ⚠️ FAIL-CLOSED EM DUAS CAMADAS: a expansão cruza com `idsDaSessao` e o resultado ainda é
 * filtrado por ele. Cadastro fora do ar responde 503, não 404: sem cadastro não dá para provar
 * que o pai é dele, e "não encontrado" para um produto que É dele vira ligação.
 */
export async function recorteDoProduto(
  request: Request,
  sessao: SessaoIncorporador,
): Promise<{ ok: false; response: NextResponse } | { ok: true; recorte: RecorteDoProduto }> {
  const pedido = new URL(request.url).searchParams.get("emp");

  const permitidos = new Set(await idsDaSessao(sessao));
  // A sessão só existe com empreendimento (a leitura do token recusa lista vazia), então zero id
  // aqui é catálogo fora do ar, não falta de permissão.
  if (permitidos.size === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Não foi possível carregar os empreendimentos agora." },
        { status: 503 },
      ),
    };
  }

  const catalogo = await catalogoDeEmpreendimentos(Date.now());

  let reais: string[];

  if (ehIdDoPai(pedido)) {
    let cadastro;
    try {
      cadastro = await carregarCadastroDeEmpreendimentos();
    } catch {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Não foi possível carregar os empreendimentos agora." },
          { status: 503 },
        ),
      };
    }
    reais = expandirIdDoPainel(pedido, cadastro, permitidos);
  } else if (pedido?.trim()) {
    const alvo = pedido.trim();
    reais = permitidos.has(alvo) ? [alvo] : [];
    // Id de GRUPO do catálogo: as divisões vêm junto (a sessão com o grupo alcança todas).
    const grupo = catalogo.find((emp) => emp.id === alvo);
    if (grupo && reais.length > 0) reais.push(...grupo.stageIds.map(String));
  } else {
    reais = [...permitidos];
  }

  // Segunda camada: nada sai daqui que a sessão não alcance.
  const ids = new Set(
    reais.map((id) => String(id).trim()).filter((id) => id && permitidos.has(id)),
  );

  // Pedido que não sobra nada = produto que não é dele (ou que saiu do catálogo). Nunca cai na
  // visão consolidada.
  if (ids.size === 0) {
    return { ok: false, response: foraDoEscopo() };
  }

  // O ID DO GRUPO ENTRA QUANDO O PRODUTO COBRE O GRUPO INTEIRO. A CAD gravada como
  // "group:Lagoa Bonita" (o portal público grava assim, porque lá fora não existe divisão) é de
  // um produto que este coordenador cobre por inteiro — sem isto ela sumiria do recorte. Quem
  // cobre só uma divisão NÃO ganha o grupo: a CAD gravada no grupo não diz de qual gleba é.
  const nomes: string[] = [];
  for (const emp of catalogo) {
    const divisoes = emp.stageIds.map(String);
    const cobreTudo = divisoes.length > 0 && divisoes.every((d) => ids.has(d));
    if (cobreTudo || ids.has(emp.id)) {
      ids.add(emp.id);
      // O grupo no recorte traz as divisões, mas só as que a sessão alcança (fail-closed).
      for (const d of divisoes) if (permitidos.has(d)) ids.add(d);
    }
    if (ids.has(emp.id) || divisoes.some((d) => ids.has(d))) nomes.push(emp.name);
  }

  return { ok: true, recorte: { ids, nomes, sessao } };
}

/** O recorte no formato que `montarFilaDoBoard` recebe. */
export function recorteParaFila(recorte: RecorteDoProduto): RecorteDaFila {
  return {
    ids: recorte.ids,
    nomes: recorte.nomes,
    usuario: { id: recorte.sessao.usuarioId, nome: recorte.sessao.usuarioNome },
  };
}

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type CadNoEscopo = {
  /**
   * A CAD desta pessoa DENTRO do recorte: a pedida (`enterpriseIdPedido`) ou, sem pedido, a mais
   * recente entre as que o produto cobre. `null` = a entidade entrou pelo vínculo de imobiliária
   * (não tem esteira).
   */
  enterpriseId: null | string;
  imobiliaria: boolean;
};

/**
 * A CAD (entity_id + enterprise_id) está no escopo do produto?
 *
 * ⚠️ RODA ANTES DE QUALQUER LEITURA OU ESCRITA POR `[id]`. Sem isto, trocar o uuid na URL abriria
 * a ficha (CPF, endereço, documento) de um comprador de outro loteamento, ou moveria a etapa da
 * CAD que a pessoa tem em outro produto.
 *
 * Duas portas, e as duas fecham sozinhas:
 *   • CAD: alguma linha de `apolo_esteira` desta pessoa com `enterprise_id` no recorte. Com
 *     `enterpriseIdPedido`, tem que ser exatamente aquela — pedir uma CAD fora do recorte é 404,
 *     nunca "a mais recente" por baixo dos panos.
 *   • IMOBILIÁRIA: algum vínculo de empreendimento (pendente ou habilitado) no recorte. Pendente
 *     conta: é a imobiliária que PEDIU o produto e espera a habilitação.
 * Falha de leitura NÃO autoriza (fail-closed).
 *
 * ⚠️ A PORTA DO VÍNCULO EXIGE O PERFIL DE IMOBILIÁRIA. O vínculo `relationship_type =
 * 'empreendimento'` NÃO é só dela: o cliente da CAD também ganha um, `verified`, ao salvar
 * (publico/cad/salvar e cadastro-persist; memória: "vínculo empreendimento não é só de
 * imobiliária"). Sem esta régua, um cliente cuja CAD neste produto foi removida/mesclada (dedup
 * por document_hash de 22/08) mas que tem CAD viva em OUTRO produto entrava por aqui com
 * `enterpriseId: null`, e a ficha/histórico/PATCH caíam no default "CAD mais recente" — a de
 * outro loteamento. Imobiliária tem zero esteira (medido em 15/08), então para ela o default
 * não alcança CAD nenhuma. Mesma régua do `noRecorte` da fila (`papel === 'imobiliaria'`).
 */
export async function cadNoEscopo(
  adminClient: AdminClient,
  entityId: string,
  recorte: RecorteDoProduto,
  enterpriseIdPedido?: unknown,
): Promise<{ ok: false; response: NextResponse } | { escopo: CadNoEscopo; ok: true }> {
  if (!ehUuid(entityId)) return { ok: false, response: foraDoEscopo() };

  const pedido = normalizarEnterpriseId(enterpriseIdPedido);
  if (pedido && !recorte.ids.has(pedido)) return { ok: false, response: foraDoEscopo() };

  try {
    // Poucos ids (as divisões de UM produto): cabe num `.in()` sem estourar a URL do PostgREST.
    const { data: cads, error } = await adminClient
      .from("apolo_esteira")
      .select("enterprise_id")
      .eq("entity_id", entityId)
      .in("enterprise_id", [...recorte.ids].slice(0, 100))
      .order("atualizado_em", { ascending: false })
      .order("created_at", { ascending: false })
      .order("enterprise_id", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);

    const linhas = (cads ?? []) as Array<{ enterprise_id: null | string }>;
    const escolhida = pedido
      ? linhas.find((linha) => linha.enterprise_id === pedido)
      : linhas[0];
    if (escolhida?.enterprise_id) {
      return { escopo: { enterpriseId: escolhida.enterprise_id, imobiliaria: false }, ok: true };
    }

    // Sem CAD no recorte, a única outra porta é a da IMOBILIÁRIA — e só para quem tem o perfil.
    const { data: perfil, error: erroPerfil } = await adminClient
      .from("apolo_entity_profiles")
      .select("entity_id")
      .eq("entity_id", entityId)
      .eq("profile", "imobiliaria")
      .maybeSingle();
    if (erroPerfil) throw new Error(erroPerfil.message);
    if (!perfil) return { ok: false, response: foraDoEscopo() };

    const { data: vinculos, error: erroVinculos } = await adminClient
      .from("apolo_relationships")
      .select("metadata")
      .eq("entity_id", entityId)
      .eq("relationship_type", "empreendimento")
      .limit(500);
    if (erroVinculos) throw new Error(erroVinculos.message);

    const temVinculo = ((vinculos ?? []) as Array<{ metadata: { enterpriseId?: unknown } | null }>)
      .map((linha) => normalizarEnterpriseId(linha.metadata?.enterpriseId))
      .some((id) => id !== null && recorte.ids.has(id));

    if (temVinculo) return { escopo: { enterpriseId: null, imobiliaria: true }, ok: true };
  } catch {
    // Sem conseguir provar que a CAD é dele, ela não é dele.
  }

  return { ok: false, response: foraDoEscopo() };
}

/** Cliente admin ou a resposta 503 padrão do board. */
export function adminOu503(): { client: AdminClient; ok: true } | { ok: false; response: NextResponse } {
  const client = createApoloAdminClient();
  if (!client) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 }),
    };
  }
  return { client, ok: true };
}
