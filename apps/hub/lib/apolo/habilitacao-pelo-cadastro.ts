import type { SupabaseClient } from "@supabase/supabase-js";

import {
  idsDoC2xDoPedido,
  type LinhaDoCadastroDoPanteon,
} from "@/lib/apolo/coordenador-do-empreendimento";
import { mensagemCoordenadorHabilitacao } from "@/lib/apolo/credenciamento-mensagens";
import {
  coordenadoresDosEmpreendimentosPorId,
  enviarPeloRelacionamento,
} from "@/lib/apolo/disparo-credenciamento";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";

// A HABILITAÇÃO PELO CADASTRO INTERNO — auditoria e aviso ao coordenador.
//
// ⚠️ POR QUE EXISTE (Lucas, 24/09/2026, "3 - Isso ae"). O wizard do hub habilita imobiliária sem fila
// (regra de 17/08: o cadastro feito pelo operador já vale como validação), e até aqui fazia isso em
// SILÊNCIO: sem linha de auditoria e sem aviso a ninguém. Em 24/09/2026 a VIDA IMOVEIS, a SANTA FE e a
// VINICIUS JOHNNY entraram no 43 assim, e a LUNA (coordenadora do 43) não soube de nenhuma. O aviso ao
// coordenador é a mesma contenção da auto-aprovação pública: habilitação que ninguém decidiu no Board
// aparece na hora para quem vende o produto.
//
// ⚠️ SÓ O COORDENADOR. A imobiliária NÃO recebe boas-vindas e os corretores dela não são avisados por
// aqui: não foi pedido, e quem cadastrou pelo wizard é o próprio time da Careli, que está falando com
// ela. Se isso mudar, é `avisarCredenciamentoAprovado` (que manda os três) no lugar deste envio.
//
// ⚠️ BEST-EFFORT, NUNCA DERRUBA O SALVAMENTO. Quando isto roda, a ficha e o vínculo já estão gravados;
// uma falha de leitura, de auditoria ou de WhatsApp não pode desfazer o cadastro nem virar erro na tela
// do operador. Coordenador não achado ou sem telefone vira disparo `falhou` com o motivo
// (`enviarPeloRelacionamento` com `impedimento`), que é o que a tela de status mostra.

export type HabilitacaoPeloCadastro = {
  /** `hub_users.id` de quem cadastrou (já validado como uuid pelo persist), ou null. */
  autorUserId: null | string;
  /** CNPJ formatado da imobiliária; null quando ela é PF. Vai na mensagem ao coordenador. */
  cnpj: null | string;
  /** SÓ os vínculos NOVOS desta gravação: o que a ficha já tinha habilitado não é avisado de novo. */
  empreendimentos: Array<{ enterpriseId: string; label: string }>;
  entityId: string;
  imobiliaria: string;
  /** true = a imobiliária não tinha o papel `imobiliaria` ativo antes desta gravação. */
  primeiraVez: boolean;
};

/**
 * Das linhas que o cadastro vai gravar, tira os vínculos de EMPREENDIMENTO que a ficha já tem
 * habilitados e devolve os que são NOVOS. Pura, exportada para o teste.
 *
 * ⚠️ O VÍNCULO JÁ HABILITADO NÃO É GRAVADO DE NOVO, E NÃO É AVISADO DE NOVO. Medido em 24/09/2026: das
 * três imobiliárias que o wizard habilitou no 43 naquele dia, a SANTA FE (desde 27/08) e a VINICIUS
 * JOHNNY (desde 31/08) JÁ estavam habilitadas no 43 pela página pública, e o wizard gravou uma segunda
 * linha `verified` para cada uma. Com o aviso ligado, a LUNA receberia "imobiliária habilitada no seu
 * empreendimento" sobre quem já vendia o produto dela havia semanas; e a linha repetida, recém-criada,
 * poria o card no Board como habilitação nova.
 *
 * `expandir` traduz o id no que ele cobre (o `group:Lagoa Bonita` são as três glebas, o 35 do Vale do
 * Ouro são o 36, o 37 e o 41): a página pública grava as divisões, o wizard grava o grupo ou o pai, e os
 * formatos são a mesma habilitação. Sem ele, só o id idêntico conta como repetido. Ver
 * `expandirPeloCadastro`.
 */
export function separarVinculosNovos(
  relacionamentos: Array<Record<string, unknown>>,
  jaHabilitados: readonly string[],
  expandir: (id: string) => string[] = (id) => [id],
): {
  novos: Array<{ enterpriseId: string; label: string }>;
  relacionamentos: Array<Record<string, unknown>>;
} {
  const cobertos = new Set<string>();
  const cobrir = (id: string) => {
    cobertos.add(id);
    for (const equivalente of expandir(id)) cobertos.add(equivalente);
  };
  for (const id of jaHabilitados) {
    const limpo = String(id ?? "").trim();
    if (limpo) cobrir(limpo);
  }

  const novos: Array<{ enterpriseId: string; label: string }> = [];
  const mantidos: Array<Record<string, unknown>> = [];
  for (const linha of relacionamentos) {
    const metadata = (linha.metadata ?? {}) as { enterpriseId?: unknown };
    const id = String(metadata.enterpriseId ?? "").trim();
    if (linha.relationship_type !== "empreendimento" || !id) {
      mantidos.push(linha);
      continue;
    }

    const equivalentes = expandir(id);
    const alvo = equivalentes.length > 0 ? equivalentes : [id];
    if (cobertos.has(id) || alvo.every((equivalente) => cobertos.has(equivalente))) continue;

    mantidos.push(linha);
    novos.push({ enterpriseId: id, label: String(linha.label ?? "").trim() || "Empreendimento" });
    // Dois do mesmo produto na mesma gravação: o segundo é repetido.
    cobrir(id);
  }

  return { novos, relacionamentos: mantidos };
}

/**
 * O que um id de empreendimento COBRE, pelo cadastro do Panteon: o `group:<Nome>` são as divisões do
 * pai de mesmo nome; o PAI com divisões (o VLO, 35, do Vale do Ouro; o LAB, 31, do Lagoa Bonita) são as
 * divisões dele (`pai_id`); qualquer outro id é ele mesmo. Pura, exportada para o teste.
 *
 * ⚠️ O PAI TAMBÉM EXPANDE (revisão de 24/09/2026), não só o `group:`. O wizard grava o Vale do Ouro como
 * "35" (medido: é o id dos vínculos `apolo` do Vale do Ouro) e a página pública grava as divisões 36, 37
 * e 41. Com só o `group:` expandido, salvar pelo wizard a IMOBILIARIA PALHARES E FILHO (36, 37 e 41
 * `verified` desde 14/09) marcando Vale do Ouro gravaria uma linha repetida, mandaria ao HUBER
 * "habilitada no Vale do Ouro" sobre quem já vende o produto e poria o card no Board com o selo
 * "cadastro interno" por 30 dias: o caso SANTA FE que `separarVinculosNovos` existe para evitar. É a
 * mesma equivalência do Board e do Mover CAD (o pai veste as divisões; ver `idDeMercado` em
 * lib/apolo/esteira-cad.ts).
 */
export function expandirPeloCadastro(
  id: null | string | undefined,
  cadastro: readonly LinhaDoCadastroDoPanteon[],
): string[] {
  const limpo = String(id ?? "").trim();
  if (!limpo) return [];
  if (limpo.startsWith("group:")) return idsDoC2xDoPedido(limpo, cadastro);

  const pai = cadastro.find(
    (linha) => !linha.paiId && String(linha.c2xEnterpriseId ?? "").trim() === limpo,
  );
  if (pai) {
    const divisoes = [
      ...new Set(
        cadastro
          .filter((linha) => linha.paiId === pai.id)
          .map((linha) => String(linha.c2xEnterpriseId ?? "").trim())
          .filter(Boolean),
      ),
    ];
    if (divisoes.length > 0) return divisoes;
  }
  return [limpo];
}

/**
 * O tradutor de cada id no que ele cobre (`expandirPeloCadastro`), pelo cadastro do PANTEON
 * (`hercules_empreendimentos`), nunca pelo C2X. Lê o cadastro uma vez (são ~40 linhas) sempre que houver
 * id: só com ele se sabe quem é pai. Leitura que falha cai na identidade: pior caso, um aviso repetido,
 * nunca um salvamento derrubado.
 */
export async function expansorDeEmpreendimentos(
  ids: readonly string[],
): Promise<(id: string) => string[]> {
  const identidade = (id: string) => [id];
  if (!ids.some((id) => String(id ?? "").trim())) return identidade;
  try {
    const cadastro = await carregarCadastroDeEmpreendimentos();
    return (id: string) => expandirPeloCadastro(id, cadastro);
  } catch (erro) {
    console.error("[apolo][cadastro] falha ao ler o cadastro para expandir o empreendimento", erro);
    return identidade;
  }
}

/**
 * O que o vínculo de empreendimento que o MODAL DE RELACIONAMENTO da ficha vai gravar significa:
 *   • `nao-e-habilitacao`: a ficha não tem o papel `imobiliaria` ativo (prospect, cliente, imobiliária
 *     ainda em validação), ou o papel não pôde ser lido. Grava como sempre, sem aviso;
 *   • `ja-habilitada`: ela já tem este empreendimento `verified` (pela mesma régua do wizard, com o pai
 *     e o grupo expandidos). Nada novo: nem linha repetida, nem aviso;
 *   • `nova`: habilitação nova de imobiliária credenciada, pelo cadastro interno. Avisa o coordenador.
 */
export type HabilitacaoPeloVinculo =
  | { aviso: Omit<HabilitacaoPeloCadastro, "autorUserId">; tipo: "nova" }
  | { tipo: "ja-habilitada" }
  | { tipo: "nao-e-habilitacao" };

const CNPJ_FORMATADO = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;

/**
 * ⚠️ O MODAL DA FICHA TAMBÉM HABILITA POR DENTRO (revisão de 24/09/2026). O ramo "Empreendimento" de
 * /api/apolo/relationships/create grava o vínculo já `verified`, com `source: "apolo"` e o autor: para
 * a imobiliária credenciada, é habilitação pelo cadastro interno, com o mesmo selo no Board. Só o
 * wizard avisava o coordenador; pelo modal (CONECTTA e RICAJ no 35, RAIANE no 40 e no 38, ELLO MINAS
 * no 35) a coordenação não sabia de nada e não ficava linha em `apolo_disparos` nem em
 * `apolo_audit_events`. Contraria a decisão do Lucas ("3 - Isso ae"): a habilitação pelo cadastro
 * interno avisa o coordenador.
 *
 * Lido ANTES do insert, pela mesma régua de "já habilitado" do wizard (`separarVinculosNovos`). NUNCA
 * LANÇA: falha vira `nao-e-habilitacao`, e o vínculo é gravado como sempre foi.
 */
export async function habilitacaoPeloVinculo(
  client: SupabaseClient,
  input: { enterpriseId: string; entityId: string; label: string },
): Promise<HabilitacaoPeloVinculo> {
  try {
    const [papel, vinculos, entidade] = await Promise.all([
      client
        .from("apolo_entity_profiles")
        .select("status")
        .eq("entity_id", input.entityId)
        .eq("profile", "imobiliaria")
        .maybeSingle<{ status: null | string }>(),
      client
        .from("apolo_relationships")
        .select("metadata")
        .eq("entity_id", input.entityId)
        .eq("relationship_type", "empreendimento")
        .eq("status", "verified")
        .limit(1000),
      client
        .from("apolo_entities")
        .select("display_name, legal_name, document_masked, entity_kind")
        .eq("id", input.entityId)
        .maybeSingle<{
          display_name: null | string;
          document_masked: null | string;
          entity_kind: null | string;
          legal_name: null | string;
        }>(),
    ]);

    // Papel ilegível: não dá para afirmar que é imobiliária credenciada, e avisar a coordenação de uma
    // habilitação que talvez nem seja uma é pior do que o vínculo sem aviso (que o Board ainda mostra).
    if (papel.error) {
      console.error("[apolo][relacionamento] falha ao ler o papel da ficha", papel.error);
      return { tipo: "nao-e-habilitacao" };
    }
    if (papel.data?.status !== "active") return { tipo: "nao-e-habilitacao" };

    // ⚠️ VÍNCULOS ILEGÍVEIS NÃO CALAM O AVISO: tudo é tratado como novo, como no wizard (o aviso
    // repetido se vê; a habilitação que ninguém fica sabendo, não).
    if (vinculos.error) {
      console.error("[apolo][relacionamento] falha ao ler os vinculos da ficha", vinculos.error);
    }
    const jaHabilitados = vinculos.error
      ? []
      : ((vinculos.data ?? []) as Array<{ metadata: { enterpriseId?: unknown } | null }>)
          .map((linha) => String(linha.metadata?.enterpriseId ?? "").trim())
          .filter(Boolean);

    const expandir = await expansorDeEmpreendimentos([...jaHabilitados, input.enterpriseId]);
    const { novos } = separarVinculosNovos(
      [{ label: input.label, metadata: { enterpriseId: input.enterpriseId }, relationship_type: "empreendimento" }],
      jaHabilitados,
      expandir,
    );
    if (novos.length === 0) return { tipo: "ja-habilitada" };

    const ficha = entidade.data;
    const documento = String(ficha?.document_masked ?? "").trim();
    return {
      aviso: {
        cnpj: ficha?.entity_kind === "pj" && CNPJ_FORMATADO.test(documento) ? documento : null,
        empreendimentos: novos,
        entityId: input.entityId,
        imobiliaria:
          String(ficha?.display_name ?? "").trim() || String(ficha?.legal_name ?? "").trim() || "Imobiliária",
        // O papel já estava ativo: ela já trabalha com a gente.
        primeiraVez: false,
      },
      tipo: "nova",
    };
  } catch (erro) {
    console.error("[apolo][relacionamento] falha ao avaliar a habilitacao pelo modal", erro);
    return { tipo: "nao-e-habilitacao" };
  }
}

export type ResultadoDaHabilitacaoPeloCadastro = {
  auditou: boolean;
  coordenadores: { avisados: number; falharam: number };
};

export async function registrarHabilitacaoPeloCadastro(
  client: SupabaseClient,
  input: HabilitacaoPeloCadastro,
): Promise<ResultadoDaHabilitacaoPeloCadastro> {
  const resultado: ResultadoDaHabilitacaoPeloCadastro = {
    auditou: false,
    coordenadores: { avisados: 0, falharam: 0 },
  };
  if (input.empreendimentos.length === 0) return resultado;

  // A MESMA AÇÃO do Board e da página pública, para o histórico da ficha e a contagem de habilitações
  // lerem as três portas juntas. `automatico: false` porque alguém da Careli decidiu; a porta vai em
  // `origem`.
  try {
    const { error } = await client.from("apolo_audit_events").insert({
      action: "credenciamento_habilitado",
      actor_user_id: input.autorUserId,
      entity_id: input.entityId,
      field_name: "credenciamento",
      metadata: {
        automatico: false,
        empreendimentos: input.empreendimentos.length,
        origem: "cadastro-interno",
      },
      status: "mapped",
    });
    resultado.auditou = !error;
    if (error) console.error("[apolo][cadastro] falha ao auditar a habilitacao", error);
  } catch (erro) {
    console.error("[apolo][cadastro] falha ao auditar a habilitacao", erro);
  }

  try {
    // O NÚMERO REAL de corretores da ficha, lido DEPOIS da gravação: numa ficha que já existia, os
    // corretores dela contam, e não só os que vieram neste cadastro.
    const { count } = await client
      .from("apolo_relationships")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", input.entityId)
      .eq("relationship_type", "corretor");

    // Pelo ID do empreendimento, nunca pela sigla (a busca que achou a LUNA depois do renome do 43).
    const coordenadores = await coordenadoresDosEmpreendimentosPorId(client, input.empreendimentos);

    const envios = await Promise.all(
      coordenadores.map((coordenador) =>
        enviarPeloRelacionamento(client, {
          destinatario: `coordenador:${coordenador.nome}`,
          entityId: input.entityId,
          impedimento: coordenador.motivo,
          telefone: coordenador.telefone,
          texto: mensagemCoordenadorHabilitacao({
            cnpj: input.cnpj,
            corretores: count ?? 0,
            // Só os empreendimentos DELE: o coordenador do Garden não lê sobre o Vale do Ouro.
            empreendimentos: coordenador.empreendimentos,
            imobiliaria: input.imobiliaria,
            primeiraVez: input.primeiraVez,
          }),
          tipo: "credenciamento_coordenador",
        }),
      ),
    );
    resultado.coordenadores = {
      avisados: envios.filter((envio) => envio.ok).length,
      falharam: envios.filter((envio) => !envio.ok).length,
    };
  } catch (erro) {
    console.error("[apolo][cadastro] falha ao avisar o coordenador da habilitacao", erro);
  }

  return resultado;
}
