// QUAL CAD? — a pergunta que a esteira passou a ter que responder.
//
// Até a migration 0080, `apolo_esteira` tinha `entity_id` como CHAVE PRIMÁRIA: uma CAD por
// pessoa, para sempre. Todo o código nasceu com essa suposição e busca a esteira por pessoa,
// com `.eq("entity_id", x).maybeSingle()`. Com a chave `(entity_id, enterprise_id)` isso passa a
// poder voltar VÁRIAS linhas — e `maybeSingle()` LANÇA ERRO quando volta mais de uma.
//
// Este módulo é a resposta única para "de qual CAD desta pessoa estamos falando":
//
//   • COM empreendimento no escopo  -> a CAD daquele empreendimento. É sempre o caminho certo, e
//     é para cá que todo chamador deve migrar quando tiver o id em mãos.
//   • SEM empreendimento no escopo  -> a CAD MAIS RECENTE, com `order` EXPLÍCITO. Nunca confiar
//     na ordem natural da tabela: sem `order`, qual linha volta é decisão do planner e muda entre
//     execuções — o mesmo clique daria respostas diferentes.
//
// O desempate é determinístico até o fim: `atualizado_em desc` (NOT NULL, com default now()),
// depois `created_at desc`, depois `enterprise_id desc`. Como `(entity_id, enterprise_id)` é
// único, o último critério sozinho já decide qualquer empate.

import type { SupabaseClient } from "@supabase/supabase-js";

import { canonizador, type ComDivisoes } from "@/lib/apolo/empreendimento-equivalencia";
// ⚠️ SÓ SERVIDOR (24/09/2026): as listas de grupo, espelho e excluídos moram em c2x-analytics, que
// importa lib/guardian/db.ts (mysql2). Este arquivo nunca foi de tela, e a varredura
// lib/cliente-sem-mysql.varredura.test.ts barra o "use client" que passar a alcançá-lo.
import {
  ENTERPRISE_GROUPS,
  EXCLUDED_ENTERPRISE_IDS,
  MIRROR_ENTERPRISE_IDS,
} from "@/lib/guardian/c2x-analytics";

// Só o que estes helpers usam. Aceita tanto o admin client do Apolo quanto um SupabaseClient
// cru — os dois convivem no módulo (lib/apolo/* usa os dois estilos).
type ClienteEsteira = Pick<SupabaseClient, "from">;

// Id do empreendimento no C2X. A COLUNA É `text` (migration 0061), não inteiro: o código antigo
// declarava `number` em alguns pontos e comparar tipo trocado devolve zero linha em silêncio.
// Aceita number por conveniência dos chamadores e devolve sempre texto normalizado, ou null.
export function normalizarEnterpriseId(valor: unknown): null | string {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo ? limpo : null;
}

// UMA linha da esteira desta pessoa.
//
// `enterpriseId` presente = a CAD daquele empreendimento (e só ela: se não existir, devolve null,
// nunca a CAD de outro loteamento). Ausente = a mais recente.
export async function lerCadDaEsteira<T>(
  client: ClienteEsteira,
  entityId: string,
  colunas: string,
  opts: { enterpriseId?: unknown } = {},
): Promise<null | T> {
  const enterpriseId = normalizarEnterpriseId(opts.enterpriseId);

  let query = client.from("apolo_esteira").select(colunas).eq("entity_id", entityId);
  if (enterpriseId) query = query.eq("enterprise_id", enterpriseId);

  // `.limit(1)` ANTES do `.maybeSingle()` é o que impede o erro "mais de uma linha": o PostgREST
  // corta no servidor e o maybeSingle só decide entre 0 e 1.
  const { data, error } = await query
    .order("atualizado_em", { ascending: false })
    .order("created_at", { ascending: false })
    .order("enterprise_id", { ascending: false })
    .limit(1)
    .maybeSingle<T>();

  // ⚠️ FAIL-CLOSED. Uma leitura que FALHOU (blip de rede, RLS, timeout) NÃO é "não tem CAD" — é
  // "não sei". Devolver null aqui fazia o dedup concluir que a pessoa não tem CAD e liberar o
  // upsert POR CIMA da CAD viva do empreendimento (etapa volta pra validação, corretor/origem
  // trocam). Propagar o erro força quem chama a barrar em vez de sobrescrever às cegas.
  if (error) throw new Error(`apolo_esteira: leitura falhou (${error.message})`);

  return (data ?? null) as null | T;
}

// TODAS as CADs desta pessoa, da mais recente para a mais antiga. É o que passa a fazer sentido
// onde a resposta é para uma PESSOA (a CACÁ atende por CPF e não sabe de empreendimento).
export async function lerCadsDaEsteira<T>(
  client: ClienteEsteira,
  entityId: string,
  colunas: string,
  opts: { limite?: number } = {},
): Promise<T[]> {
  const { data, error } = await client
    .from("apolo_esteira")
    .select(colunas)
    .eq("entity_id", entityId)
    .order("atualizado_em", { ascending: false })
    .order("created_at", { ascending: false })
    .order("enterprise_id", { ascending: false })
    .limit(opts.limite ?? 20);

  // ⚠️ FAIL-CLOSED (mesmo motivo do `lerCadDaEsteira`). Uma lista vazia por FALHA de leitura é
  // indistinguível de "pessoa sem CAD", e é justamente essa confusão que abre a trava de
  // duplicidade sozinha. Erro na leitura vira exceção; quem chama decide barrar.
  if (error) throw new Error(`apolo_esteira: leitura falhou (${error.message})`);

  return ((data ?? []) as unknown as T[]) ?? [];
}

// Colapsa um lote de linhas (uma leitura `.in("entity_id", ...)`) num mapa por pessoa.
//
// ⚠️ ISTO É UMA PERDA CONSCIENTE: com várias CADs por pessoa, um `Map` chaveado por `entity_id`
// só cabe uma. Onde a consequência é grave (a ficha que sobe para o C2X, a ordem da fila do
// lançamento) a escolha é sempre a CAD MAIS RECENTE, e nunca "a última que o banco devolveu".
// Quem puder chavear pelo par (entity_id, enterprise_id) deve fazer isso em vez de usar isto.
export function maisRecentePorEntidade<T extends { entity_id: string }>(linhas: T[]): Map<string, T> {
  const mapa = new Map<string, T>();
  for (const linha of linhas) {
    const atual = mapa.get(linha.entity_id);
    if (!atual || compararRecencia(linha, atual) < 0) mapa.set(linha.entity_id, linha);
  }
  return mapa;
}

// Mesmo critério do `order` do banco, aplicado em memória. Negativo = `a` é mais recente.
function compararRecencia(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  return (
    texto(b.atualizado_em).localeCompare(texto(a.atualizado_em)) ||
    texto(b.created_at).localeCompare(texto(a.created_at)) ||
    texto(b.enterprise_id).localeCompare(texto(a.enterprise_id))
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
// DE QUAL PRODUTO É ESTA CAD? O id de MERCADO, e a trava do vínculo arquivado (24/09/2026)
// ═══════════════════════════════════════════════════════════════════════════════════════════
//
// O CASO QUE CRIOU ISTO (24/09/2026): a CAD do JONATAS nasceu no VEREDAS DO OURO (19) quando era do
// VALE DO OURO (35). O time trocou só o VÍNCULO no Apolo (arquivou o 19, criou o 35); a CAD ficou no
// 19. O card mostrou "Vale do Ouro" (rótulo do vínculo) e agiu no 19 (id da esteira): o crédito leu a
// configuração do Veredas (análise desligada) e credenciou sem Serasa, e o coordenador do Vale do
// Ouro não via o cliente. A correção tem três peças que precisam falar a MESMA língua sobre "este
// empreendimento é o mesmo que aquele": a ação Mover CAD (lib/apolo/mover-cad.ts), a trava do
// arquivamento do vínculo (relationships/archive) e a trava do crédito (lib/serasa/consulta-servico).
// Por isso a régua mora aqui, num lugar só.

/**
 * ONDE se troca o empreendimento de uma CAD, na MESMA frase em todas as travas (decisão do Zeus na
 * revisão de 24/09/2026): o 409 do arquivamento do vínculo, o 409 do Consultar crédito do hub e as
 * dicas do painel de relacionamentos (a tela repete o literal: este módulo é só servidor).
 *
 * ⚠️ A FRASE DIZ QUEM FAZ. O analista (operator) cai nas duas travas, porque as duas rotas aceitam
 * `authorizeApoloWrite`, mas o Mover CAD é só da coordenação (admin/leader). A frase anterior ("use
 * Mover CAD no Board") mandava o analista a um botão que ele não enxerga, sem saída.
 */
export const FRASE_TROCA_DE_EMPREENDIMENTO =
  "Para trocar o empreendimento, a coordenação usa Mover CAD no Board.";

/** O pedaço de `hercules_empreendimentos` (o cadastro do Panteon) que a régua de mercado usa. */
export type EmpreendimentoDoCadastro = {
  c2xEnterpriseId: null | string;
  codigo: null | string;
  id: string;
  nome: null | string;
  paiId: null | string;
};

const PREFIXO_GRUPO = "group:";

/**
 * O id de MERCADO do empreendimento: o id em que a CAD daquele produto deve morar.
 *
 * Regra do Lucas, repetida até cansar (ver [[feedback_pai_e_a_fonte_unidade_unica]]): o PAI é a
 * fonte. VOC (37), VOL (36), VOR (41) e o id de grupo legado "group:Vale do Ouro" são o Vale do
 * Ouro, e o Vale do Ouro é o 35 (VLO), onde já moram 692 CADs e onde o CAD público grava.
 *
 * Passo a passo, o mesmo recorte que a lista operacional de empreendimentos já faz
 * (`groupEnterpriseRows` em lib/apolo/empreendimentos.ts):
 *   1. divisão de um grupo de ENTERPRISE_GROUPS vira o id do grupo, pelo `canonizador` de
 *      lib/apolo/empreendimento-equivalencia.ts ("37" -> "group:Vale do Ouro");
 *   2. o grupo cujo PAI no cadastro (`hercules_empreendimentos.pai_id`) é o ESPELHO do C2X (hoje só
 *      o VLO) vira o id do pai ("group:Vale do Ouro" -> "35"). É o pai que "veste" o grupo;
 *   3. fora dos grupos, o filho sobe ao pai do cadastro quando o pai tem id do C2X.
 *
 * ⚠️ O LAGOA BONITA FICA "group:Lagoa Bonita", e é de propósito. O pai dele no cadastro é o LAB (31),
 * que está em EXCLUDED_ENTERPRISE_IDS: fora do catálogo, sem configuração de crédito, fora do escopo
 * dos coordenadores, e o CAD público do Lagoa Bonita grava "group:Lagoa Bonita". Mover uma CAD para o
 * 31 seria repetir o caso do Jonatas: a CAD num id que ninguém enxerga. O mesmo vale para Lavra do
 * Ouro, Rio de Pedras e Portal dos Vales, cujo pai não é espelho: o mercado os conhece pelo grupo.
 *
 * Id que o cadastro não conhece volta como veio (19, 29...): não é papel desta régua inventar
 * equivalência para o que ela não sabe.
 *
 * ⚠️ PELO ID DO C2X, E NÃO PELA SIGLA (PAN-124, 25/09/2026). "Excluído" e "espelho" eram decididos pela
 * `codigo` do cadastro contra as listas de siglas, e as divisões dos grupos eram achadas casando a
 * sigla de `ENTERPRISE_GROUPS.codes` com a `codigo` do cadastro. A sigla muda quando alguém renomeia
 * (no C2X ou no cadastro do Panteon); o id do C2X, não. Agora os três casam pelo `c2xEnterpriseId`:
 * `EXCLUDED_ENTERPRISE_IDS`, `MIRROR_ENTERPRISE_IDS` e `ENTERPRISE_GROUPS.ids`. É IDÊNTICO ao de antes,
 * medido no cadastro de produção em 25/09/2026: a única linha excluída é o LAB (31), o único espelho é
 * o VLO (35), e as siglas das divisões no cadastro são as mesmas dos grupos, com os mesmos ids.
 */
export function idDeMercado(
  enterpriseId: unknown,
  cadastro: readonly EmpreendimentoDoCadastro[],
): null | string {
  const id = normalizarEnterpriseId(enterpriseId);
  if (!id) return null;

  const porC2x = new Map<string, EmpreendimentoDoCadastro>();
  const porId = new Map<string, EmpreendimentoDoCadastro>();
  for (const linha of cadastro) {
    porId.set(linha.id, linha);
    const c2x = normalizarEnterpriseId(linha.c2xEnterpriseId);
    if (c2x) porC2x.set(c2x, linha);
  }
  // Pelo id do C2X que a linha guarda (PAN-124). Linha sem id do C2X (os pais LOX, RDX e PDX, e o
  // produto nascido no Panteon) não é excluída nem espelho, como a sigla dela também não era.
  const idDoC2xDaLinha = (linha: EmpreendimentoDoCadastro | undefined) =>
    Number(normalizarEnterpriseId(linha?.c2xEnterpriseId) ?? Number.NaN);
  const excluido = (linha: EmpreendimentoDoCadastro | undefined) =>
    EXCLUDED_ENTERPRISE_IDS.includes(idDoC2xDaLinha(linha));
  const espelho = (linha: EmpreendimentoDoCadastro | undefined) =>
    MIRROR_ENTERPRISE_IDS.includes(idDoC2xDaLinha(linha));

  // 1. Os grupos do catálogo, com as divisões pelos IDS de `ENTERPRISE_GROUPS` (PAN-124). O
  //    `canonizador` reconhece a divisão ("37") e o próprio id do grupo ("group:Vale do Ouro").
  //
  //    ⚠️ SÓ A DIVISÃO QUE O CADASTRO CONHECE, como antes: a sigla que o cadastro não tinha não virava
  //    id nenhum, e o resto da régua (o pai comum das divisões) só funciona com a linha do cadastro.
  //    Com o cadastro inteiro (produção), são exatamente as divisões de antes; num cadastro parcial
  //    também, porque o que faltava lá falta aqui.
  const grupos: Array<ComDivisoes & { stageIds: string[] }> = ENTERPRISE_GROUPS.map((grupo) => ({
    id: `${PREFIXO_GRUPO}${grupo.display}`,
    stageIds: grupo.ids.map((c2x) => String(c2x)).filter((c2x) => porC2x.has(c2x)),
  }));
  const canon = canonizador(grupos);
  const linha = porC2x.get(id);
  let grupo = grupos.find((g) => g.id === canon(id));
  // O PAI de um grupo também é o grupo (35 é o Vale do Ouro; o 31 do LAB é o Lagoa Bonita): ele é a
  // raiz das divisões no cadastro.
  if (!grupo && linha) {
    const raizId = linha.paiId ?? linha.id;
    grupo = grupos.find((g) => g.stageIds.some((c2x) => porC2x.get(c2x)?.paiId === raizId));
  }

  if (grupo) {
    // 2. O pai comum das divisões, se for o ESPELHO, responde pelo grupo.
    const pais = new Set(grupo.stageIds.map((c2x) => porC2x.get(c2x)?.paiId ?? null));
    const [paiId] = [...pais];
    const pai = pais.size === 1 && paiId ? porId.get(paiId) : undefined;
    const doPai = normalizarEnterpriseId(pai?.c2xEnterpriseId);
    if (doPai && espelho(pai) && !excluido(pai)) return doPai;
    return grupo.id;
  }

  // 3. Fora dos grupos: o filho sobe UM nível (o cadastro não tem neto).
  const pai = linha?.paiId ? porId.get(linha.paiId) : undefined;
  const doPai = normalizarEnterpriseId(pai?.c2xEnterpriseId);
  if (doPai && !excluido(pai)) return doPai;
  return id;
}

/** Os dois ids são o MESMO produto para o mercado? (grupo, divisões e pai contam como um só) */
export function mesmoEmpreendimento(
  a: unknown,
  b: unknown,
  cadastro: readonly EmpreendimentoDoCadastro[],
): boolean {
  const ma = idDeMercado(a, cadastro);
  return ma !== null && ma === idDeMercado(b, cadastro);
}

/**
 * O cadastro de empreendimentos do Panteon, com pai, código e id do C2X.
 *
 * ⚠️ PAGINADO (o PostgREST corta em 1.000 sem avisar) e ⚠️ LANÇA NA FALHA: sem o cadastro não dá para
 * provar equivalência, e quem chama decide (as travas respondem 503, nunca "é o mesmo").
 */
export async function lerEmpreendimentosDoCadastro(
  client: ClienteEsteira,
): Promise<EmpreendimentoDoCadastro[]> {
  const PAGINA = 1000;
  const saida: EmpreendimentoDoCadastro[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await client
      .from("hercules_empreendimentos")
      .select("id, pai_id, c2x_enterprise_id, codigo, nome")
      .eq("workspace_id", "careli")
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(`hercules_empreendimentos: leitura falhou (${error.message})`);
    const pagina = (data ?? []) as Array<{
      c2x_enterprise_id: null | number | string;
      codigo: null | string;
      id: string;
      nome: null | string;
      pai_id: null | string;
    }>;
    for (const linha of pagina) {
      saida.push({
        c2xEnterpriseId: normalizarEnterpriseId(linha.c2x_enterprise_id),
        codigo: linha.codigo ?? null,
        id: String(linha.id),
        nome: linha.nome ?? null,
        paiId: linha.pai_id ?? null,
      });
    }
    if (pagina.length < PAGINA) break;
  }
  return saida;
}

export type VinculoDeEmpreendimento = {
  /**
   * QUANDO o vínculo foi arquivado (só para `status === "archived"`; nos outros é null). Vem de
   * `metadata.arquivadoEm`, que o arquivamento manual (relationships/archive) e o Mover CAD gravam,
   * e na falta dele de `updated_at`, que os dois gravam com o MESMO instante. Null = sem data legível.
   */
  arquivadoEm: null | string;
  enterpriseId: null | string;
  id: string;
  /** O metadata inteiro, para quem arquiva preservar o que já estava lá. */
  metadata: Record<string, unknown>;
  status: string;
};

/** Um instante ISO legível, em milissegundos; `null` para vazio ou texto que não é data. */
function instante(valor: unknown): null | number {
  if (typeof valor !== "string" || !valor.trim()) return null;
  const ms = Date.parse(valor);
  return Number.isNaN(ms) ? null : ms;
}

/** Os vínculos `empreendimento` desta pessoa (qualquer status). ⚠️ Lança na falha. */
export async function lerVinculosDeEmpreendimento(
  client: ClienteEsteira,
  entityId: string,
): Promise<VinculoDeEmpreendimento[]> {
  const { data, error } = await client
    .from("apolo_relationships")
    .select("id, status, metadata, updated_at")
    .eq("entity_id", entityId)
    .eq("relationship_type", "empreendimento")
    .limit(500);
  if (error) throw new Error(`apolo_relationships: leitura falhou (${error.message})`);
  return (
    (data ?? []) as Array<{
      id: string;
      metadata: unknown;
      status: null | string;
      updated_at?: null | string;
    }>
  ).map((linha) => {
    const meta =
      linha.metadata && typeof linha.metadata === "object" && !Array.isArray(linha.metadata)
        ? (linha.metadata as Record<string, unknown>)
        : {};
    const status = (linha.status ?? "").trim();
    const arquivadoEm =
      status !== "archived"
        ? null
        : instante(meta.arquivadoEm) !== null
          ? String(meta.arquivadoEm)
          : instante(linha.updated_at) !== null
            ? String(linha.updated_at)
            : null;
    return {
      arquivadoEm,
      enterpriseId: normalizarEnterpriseId(meta.enterpriseId),
      id: String(linha.id),
      metadata: { ...meta },
      status,
    };
  });
}

/**
 * A CAD ficou ÓRFÃ DO VÍNCULO? (a trava do crédito)
 *
 * `true` quando o vínculo de empreendimento DA CAD foi ARQUIVADO e nenhum vínculo ativo (status
 * diferente de `archived`) cobre o empreendimento dela. É exatamente o estado do Jonatas: CAD no 19,
 * vínculo 19 arquivado, vínculo 35 ativo. Nesse estado a CAD está no produto errado, e decidir crédito
 * nela é decidir com a configuração de outro empreendimento.
 *
 * ⚠️ REGRA ESTREITA, de propósito (medido em 24/09/2026 na esteira inteira: pega 1 CAD de 840, o
 * Jonatas). NÃO trava CAD sem vínculo nenhum: as 575 do Asana, as manuais e as de teste não têm
 * vínculo de empreendimento e seguem normais. NÃO trava quem tem CAD antiga num produto e vínculo novo
 * em outro sem ter arquivado nada (pessoa com CAD do Asana no X que manda um CAD público no Y). O que
 * denuncia a troca feita pela metade é o ARQUIVAMENTO do vínculo da própria CAD.
 *
 * A comparação é pela régua de mercado (`mesmoEmpreendimento`), nunca por igualdade crua: CAD em
 * "group:Vale do Ouro" com vínculo no 35 é o mesmo produto ([[reference_empreendimento_grupo_vs_divisao_id]]).
 *
 * ⚠️ SÓ CONTA O ARQUIVAMENTO FEITO DEPOIS QUE A CAD EXISTIA (revisão de 24/09/2026). O que denuncia a
 * troca pela metade é arquivar o vínculo de uma CAD VIVA. Sem o critério de tempo, a trava pegava
 * também a CAD que nasce DEPOIS de o vínculo ter sido arquivado, e ela não tinha saída: depois de um
 * Mover do 35 para o 19 (vínculo 35 arquivado pelo próprio Mover), uma CAD NOVA no 35 pelo portal ou
 * pelo wizard (que não criam vínculo de empreendimento para prospect) nascia barrada no crédito, e o
 * Mover não resolvia (o 19 já tem CAD). Agora:
 *   • a data do arquivamento é `metadata.arquivadoEm` (o que relationships/archive e o Mover gravam),
 *     e na falta dela `updated_at` (NOT NULL, gravado no mesmo instante pelos dois);
 *   • a data da CAD é a MAIS ANTIGA entre `chegou_em` e `created_at` da linha da esteira. `chegou_em`
 *     sozinho não basta: o reenvio pelo CAD público e pelo wizard faz upsert com `chegou_em = agora`
 *     na MESMA linha (lib/publico/cad/dados.ts e cadastro-salvar.ts), e reenviar a CAD do Jonatas
 *     depois do arquivamento reabriria a trava. `created_at` só nasce no INSERT;
 *   • arquivado no MESMO instante ou depois da CAD trava; antes, não.
 *
 * ⚠️ AS AUSÊNCIAS, e por que não reabrem o caso do Jonatas (medido em produção em 24/09/2026: há UM
 * vínculo de empreendimento arquivado no banco inteiro, o 19 dele, com `metadata.arquivadoEm` e
 * `updated_at` iguais, 24/09 15:50:13; a CAD tem `chegou_em` 21/09 18:14:52 e `created_at` 21/09
 * 18:14:52):
 *   • vínculo arquivado SEM data legível não trava. Não acontece com linha real (`updated_at` é NOT
 *     NULL e é lido junto); só uma linha malformada cairia aqui, e travar sem prova de tempo é
 *     exatamente o beco sem saída que esta revisão tira;
 *   • CAD SEM data (a linha não foi achada) trava, como antes: sem saber desde quando a CAD existe,
 *     não dá para provar que o arquivamento é anterior a ela.
 *
 * Barata no caso comum: sem vínculo arquivado (quase todas), nem lê o cadastro nem a esteira.
 * ⚠️ LANÇA na falha de leitura: quem chama responde 503, nunca "pode seguir".
 */
export async function cadComVinculoArquivado(
  client: ClienteEsteira,
  entityId: string,
  enterpriseIdDaCad: unknown,
): Promise<boolean> {
  const cad = normalizarEnterpriseId(enterpriseIdDaCad);
  if (!cad) return false;

  const vinculos = (await lerVinculosDeEmpreendimento(client, entityId)).filter(
    (v) => v.enterpriseId !== null,
  );
  const arquivados = vinculos.filter((v) => v.status === "archived");
  const ativos = vinculos.filter((v) => v.status !== "archived");
  if (arquivados.length === 0) return false;
  // Vínculo ativo com o MESMO id cru da CAD: coberta, sem precisar do cadastro.
  if (ativos.some((v) => v.enterpriseId === cad)) return false;

  const cadastro = await lerEmpreendimentosDoCadastro(client);
  const daCad = (v: VinculoDeEmpreendimento) => mesmoEmpreendimento(v.enterpriseId, cad, cadastro);
  const arquivadosDaCad = arquivados.filter(daCad);
  if (arquivadosDaCad.length === 0 || ativos.some(daCad)) return false;

  // Desde quando esta CAD existe? A leitura é a da própria CAD (pessoa + empreendimento), e LANÇA na
  // falha como as outras.
  const linha = await lerCadDaEsteira<{ chegou_em: null | string; created_at: null | string }>(
    client,
    entityId,
    "chegou_em, created_at",
    { enterpriseId: cad },
  );
  const datas = [instante(linha?.chegou_em), instante(linha?.created_at)].filter(
    (ms): ms is number => ms !== null,
  );
  if (datas.length === 0) return true;
  const cadDesde = Math.min(...datas);

  return arquivadosDaCad.some((v) => {
    const arquivadoEm = instante(v.arquivadoEm);
    return arquivadoEm !== null && arquivadoEm >= cadDesde;
  });
}
