// Credenciamento de imobiliárias: a triagem que roda ANTES do cadastro completo.
//
// Regra de negócio (Lucas 18/jul): a imobiliária quer trabalhar um empreendimento da nossa
// gestão. O portal oferece SOMENTE os empreendimentos "na ativa" (apolo_enterprise_settings).
// Se ela já é cadastrada, mostramos os que ela AINDA NÃO trabalha, pra pedir habilitação;
// se não achamos o CNPJ, abre o cadastro de imobiliária completo.
//
// ⚠️ O C2X NÃO tem vínculo imobiliária↔empreendimento (Lucas): a única ligação real são as
// VENDAS (users.vinculed_by_id -> acquisition_requests -> enterprises), o mesmo caminho da
// carteira por papel. O credenciamento é justamente o que passa a registrar esse vínculo
// EXPLICITAMENTE no Apolo (apolo_relationships tipo 'empreendimento').
// Ver [[project_apolo_cadastro_imobiliaria]].
import type { RowDataPacket } from "mysql2";

import { filtroSemExcluidos } from "@/lib/apolo/c2x-pelo-id";
import { type ApoloEnterpriseRow, loadApoloEnterprises } from "@/lib/apolo/empreendimentos";
import { chaveDaLogo, listEnterpriseLogos } from "@/lib/apolo/enterprise-logos";
import { listEnterprisesAtivos, listEnterprisesRecebendo } from "@/lib/apolo/enterprise-settings";
import { hashIdentifier } from "@/lib/apolo/server";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { getHadesDbPool } from "@/lib/guardian/db";
import { carregarCadastroDeEmpreendimentos, type LinhaDoCadastro } from "@/lib/hercules/cadastro";
import { ehIdDoPanteon } from "@/lib/hercules/produto-novo";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type CredenciamentoEmpreendimento = {
  code: string;
  // Códigos reais de um grupo consolidado; vazio quando o empreendimento é simples.
  codes: string[];
  // Os enterprise_id REAIS por trás de um grupo. É o que o credenciamento precisa gravar:
  // o id do grupo (`group:Lagoa Bonita`) não casa com nada no C2X.
  stageIds: string[];
  id: string;
  // Incorporador do C2X (row.incorporador). Consumido pelo Setup do Prometeu.
  incorporador: string | null;
  logoUrl: string | null;
  name: string;
};

export type ConsultaImobiliaria = {
  encontrada: boolean;
  entityId: string | null;
  // Ids de empreendimento que ela JÁ trabalha (vendas no C2X ∪ credenciamentos no Apolo).
  jaTrabalha: string[];
  nome: string | null;
};

function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

// Empreendimentos "na ativa" (SÓ o master `credenciamento_ativo`), com a logo que o operador
// subiu. O nome/sigla vem do C2X; se o legado estiver fora do ar, o empreendimento ainda aparece
// (com a sigla salva no settings).
//
// ⚠️ É a lista dos fluxos INTERNOS (board/habilitar, credenciamento interno, Prometeu) e de
// lookups de nome. Os formulários PÚBLICOS usam os portões abaixo (`listEmpreendimentosParaCad` /
// `listEmpreendimentosParaImobiliaria`), porque CAD e habilitação de imobiliária abrem em
// momentos diferentes (caso Recanto do Vale, Lucas 26/08).
export async function listEmpreendimentosAtivos(
  adminClient: AdminClient,
): Promise<CredenciamentoEmpreendimento[]> {
  return montarEmpreendimentos(adminClient, await listEnterprisesAtivos(adminClient));
}

// Portão público de CAD: master ligado E `recepcao_cad` ligada. É o recorte que o formulário
// público de CAD oferece ao corretor.
export async function listEmpreendimentosParaCad(
  adminClient: AdminClient,
): Promise<CredenciamentoEmpreendimento[]> {
  return montarEmpreendimentos(adminClient, await listEnterprisesRecebendo(adminClient, "cad"));
}

// Portão público de imobiliária: master ligado E `recepcao_imobiliaria` ligada. É o recorte da
// vitrine e da validação server-side do credenciamento público de imobiliária.
export async function listEmpreendimentosParaImobiliaria(
  adminClient: AdminClient,
): Promise<CredenciamentoEmpreendimento[]> {
  return montarEmpreendimentos(
    adminClient,
    await listEnterprisesRecebendo(adminClient, "imobiliaria"),
  );
}

// Montagem comum das três listas acima: muda SÓ o filtro de ids que entra.
async function montarEmpreendimentos(
  adminClient: AdminClient,
  ativos: string[],
): Promise<CredenciamentoEmpreendimento[]> {
  if (!ativos.length) return [];
  const logos = await listEnterpriseLogos(adminClient);

  const { data: settingsRows } = await adminClient
    .from("apolo_enterprise_settings")
    .select("enterprise_id, code")
    .in("enterprise_id", ativos);
  const codeById = new Map(
    ((settingsRows ?? []) as { code: string | null; enterprise_id: string }[]).map((row) => [
      row.enterprise_id,
      row.code ?? "",
    ]),
  );

  // Só a lista (nome, código, id): a situação das unidades não é usada aqui, e lê-la custaria
  // as propostas e reservas do banco inteiro a cada chamada.
  const c2x = await loadApoloEnterprises({ comSituacao: false });

  // O cadastro do Panteon só é lido quando há produto dele na lista: a vitrine pública abre muito, e
  // hoje quase sempre só com o C2X. Falha na leitura não derruba a vitrine (o card sai com a sigla
  // do settings, como no C2X fora do ar).
  const catalogo = c2x.ok ? c2x.data.rows : null;
  const conhecidos = new Set((catalogo ?? []).map((row) => row.id));
  const cadastro = ativos.some((id) => ehIdDoPanteon(id) && !conhecidos.has(id))
    ? await carregarCadastroDeEmpreendimentos().catch((erro: unknown): LinhaDoCadastro[] | null => {
        console.warn(
          "[apolo][credenciamento] cadastro do Panteon indisponível; o produto novo sai com a sigla do settings",
          erro instanceof Error ? erro.message : erro,
        );
        return null;
      })
    : null;

  return vitrineDoCredenciamento({ ativos, cadastro, catalogo, codeById, logos });
}

/**
 * O núcleo PURO da vitrine: dos ids ligados no settings, os cards que a tela desenha.
 *
 * @param catalogo As linhas do C2X; `null` = o legado está fora do ar.
 * @param cadastro O cadastro do Panteon; `null` = não lido (ou fora do ar).
 */
export function vitrineDoCredenciamento(entrada: {
  ativos: readonly string[];
  cadastro: readonly LinhaDoCadastro[] | null;
  catalogo: readonly ApoloEnterpriseRow[] | null;
  codeById: ReadonlyMap<string, string>;
  logos: Readonly<Record<string, string>>;
}): CredenciamentoEmpreendimento[] {
  const { ativos, codeById, logos } = entrada;
  const rowById = new Map((entrada.catalogo ?? []).map((row) => [row.id, row]));
  const doPanteonPorId = new Map<string, LinhaDoCadastro>();
  for (const linha of entrada.cadastro ?? []) {
    const id = String(linha.c2xEnterpriseId ?? "").trim();
    if (ehIdDoPanteon(id) && !doPanteonPorId.has(id)) doPanteonPorId.set(id, linha);
  }

  // ⚠️ ID QUE O CATÁLOGO NÃO CONHECE É RESÍDUO, E NÃO PODE VIRAR CARD NA VITRINE PÚBLICA.
  //
  // Lucas, 15/09/2026, com o print do cadastro de imobiliária: *"Vale do Ouro, os filhos estão
  // aparecendo"*. Medido na própria rota: a vitrine devolvia DUAS linhas do mesmo loteamento —
  // `id=35 code=VLO name=VALE DO OURO` e `id=group:Vale do Ouro code=VOC + VOL + VOR
  // name=VOC + VOL + VOR`, esta última com o CÓDIGO no lugar do nome, `codes=[]` e `stageIds=[]`.
  //
  // A causa é resíduo do conserto do dia anterior. Até 14/09 o consolidado tinha id sintético
  // (`group:Vale do Ouro`), e foi com ESSE id que a linha entrou em `apolo_enterprise_settings`.
  // Naquele dia, a pedido do próprio Lucas (*"VLO é o pai... ainda estou vendo dois vale do
  // ouro"*), o grupo passou a VESTIR o id do pai (`groupEnterpriseRows`, empreendimentos.ts), e o
  // registro antigo ficou órfão: `rowById.get("group:Vale do Ouro")` não acha nada, o nome cai no
  // `code` e a vitrine ganha um card fantasma. A Lagoa Bonita não sofre disso porque não tem
  // espelho em `ENTERPRISE_MIRRORS` — o grupo dela continua com id sintético, que casa.
  //
  // ⚠️ O DESCARTE SÓ VALE COM O CATÁLOGO NA MÃO, e é isso que o `c2x.ok` guarda. Com o legado fora
  // do ar, `rowById` nasce vazio e descartar por ausência apagaria a vitrine inteira — a regra
  // antiga (aparecer com a sigla do settings) é justamente a rede de segurança para esse caso, e
  // ela continua valendo. Descartamos o órfão quando SABEMOS que ele não existe, nunca quando não
  // conseguimos saber.
  const catalogoNaMao = entrada.catalogo !== null;

  // ⚠️ O PRODUTO NASCIDO NO PANTEON NÃO É RESÍDUO (16/09/2026). Ele tem id a partir de 100000 e o C2X
  // não o conhece por definição: o descarte acima o apagava da vitrine mesmo com o credenciamento
  // ligado, e a imobiliária nunca via o prédio novo. `ehIdDoPanteon` passa; o nome e a sigla vêm do
  // cadastro. Id desconhecido abaixo de 100000 continua sendo o órfão de antes e segue descartado.
  return ativos
    .filter((id) => !catalogoNaMao || rowById.has(id) || ehIdDoPanteon(id))
    .map((id) => {
      const row = rowById.get(id);
      const doPanteon = row ? undefined : doPanteonPorId.get(id);
      const code = row?.code ?? doPanteon?.codigo ?? codeById.get(id) ?? "";
      return {
        code,
        // Os códigos reais por trás de um grupo consolidado (Lagoa Bonita = LBF, LBR, LBP).
        // Vazio quando o empreendimento é simples.
        codes: row?.codes ?? [],
        id,
        stageIds: (row?.stages ?? []).map((stage) => String(stage.id)),
        incorporador: row?.incorporador ?? null,
        // ⚠️ `chaveDaLogo` e não `id` cru: o upload troca `:` e espaço por `_`, então a chave do
        // mapa é `group_Lagoa_Bonita` enquanto o id é `group:Lagoa Bonita`.
        logoUrl: logos[chaveDaLogo(id)] ?? null,
        // Caixa alta para o card do portal, que é o pedido do Lucas: o nome dos empreendimentos
        // simples vem do C2X já em caixa alta, e só o do grupo vinha "Lagoa Bonita", destoando
        // da fileira. Normalizar aqui não mexe no `display` do ENTERPRISE_GROUPS, que o BI usa.
        name: (row?.name ?? doPanteon?.nome ?? (code || "Empreendimento")).toLocaleUpperCase("pt-BR"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Procura a imobiliária pelo CNPJ no read-model do Apolo e descobre onde ela já atua.
export async function consultarImobiliariaPorCnpj(
  adminClient: AdminClient,
  cnpj: string,
): Promise<ConsultaImobiliaria> {
  const vazio: ConsultaImobiliaria = {
    encontrada: false,
    entityId: null,
    jaTrabalha: [],
    nome: null,
  };

  const digits = onlyDigits(cnpj);
  if (digits.length !== 14) return vazio;

  const hash = hashIdentifier("cnpj", digits);

  // ⚠️ PROCURA EM DOIS LUGARES, e a ordem importa.
  //
  // `apolo_entities.document_hash` só é preenchido por quem NASCE no Apolo (o wizard). As 412
  // imobiliárias que vieram do sync do C2X têm esse campo NULO: o CNPJ delas mora em
  // `apolo_entity_identifiers.value_hash`. Medido em 20/jul: 0 de 412 com document_hash, 395 com
  // identificador de CNPJ.
  //
  // Buscar só por document_hash reprovava TODA imobiliária real. Foi o que aconteceu no primeiro
  // teste do Lucas: ele digitou o CNPJ da RAIANE IMOBILIARIA, que está cadastrada e tem CAD
  // nossa, e o portal respondeu "não credenciada".
  const { data: porIdentificador, error: erroIdent } = await adminClient
    .from("apolo_entity_identifiers")
    .select("entity_id")
    .eq("identifier_type", "cnpj")
    .eq("value_hash", hash)
    .limit(1)
    .maybeSingle<{ entity_id: string }>();

  // Erro de leitura não pode virar "não credenciada": isso barraria um parceiro legítimo por
  // falha nossa. Melhor devolver vazio e deixar o chamador tratar como indisponibilidade.
  if (erroIdent && erroIdent.code !== "PGRST116") return vazio;

  let entityId = porIdentificador?.entity_id ?? null;

  if (!entityId) {
    const { data: porDocumento } = await adminClient
      .from("apolo_entities")
      .select("id")
      .eq("document_hash", hash)
      .maybeSingle<{ id: string }>();
    entityId = porDocumento?.id ?? null;
  }

  if (!entityId) return vazio;

  const { data: entity } = await adminClient
    .from("apolo_entities")
    .select("id, display_name, legal_name")
    .eq("id", entityId)
    .maybeSingle<{ display_name: string | null; id: string; legal_name: string | null }>();

  if (!entity?.id) return vazio;

  const [porVendas, porCredenciamento] = await Promise.all([
    empreendimentosPorVendas(adminClient, entity.id),
    empreendimentosPorCredenciamento(adminClient, entity.id),
  ]);

  return {
    encontrada: true,
    entityId: entity.id,
    jaTrabalha: Array.from(new Set([...porVendas, ...porCredenciamento])),
    nome: entity.legal_name || entity.display_name,
  };
}

// Vínculos JÁ registrados no Apolo (o que o próprio credenciamento grava).
async function empreendimentosPorCredenciamento(
  adminClient: AdminClient,
  entityId: string,
): Promise<string[]> {
  const { data } = await adminClient
    .from("apolo_relationships")
    .select("metadata")
    .eq("entity_id", entityId)
    .eq("relationship_type", "empreendimento")
    .limit(500);

  return ((data ?? []) as { metadata: { enterpriseId?: string } | null }[])
    .map((row) => row.metadata?.enterpriseId)
    .filter((id): id is string => Boolean(id));
}

// Onde ela JÁ VENDEU (única ligação real no C2X). Mesmo caminho da carteira por papel.
async function empreendimentosPorVendas(
  adminClient: AdminClient,
  entityId: string,
): Promise<string[]> {
  const c2xId = await c2xIdDaEntidade(adminClient, entityId);
  if (!c2xId) return [];

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return [];

  // ⚠️ A EXCLUSÃO É PELO ID (`EXCLUDED_ENTERPRISE_IDS`: SDT, LAB, TSC), e não mais pela sigla
  // (PAN-124): a lista por sigla deixou de excluir o 30 quando o LAG virou ADT no C2X, e um
  // empreendimento de teste renomeado voltaria a entrar no `jaTrabalha` da imobiliária.
  const semExcluidosDoC2x = filtroSemExcluidos();
  try {
    const [rows] = await poolResult.pool.query<(RowDataPacket & { id: number })[]>(
      `select distinct e.id
         from acquisition_requests ar
         join enterprise_unities eu on eu.id = ar.enterprise_unity_id
         join enterprises e on e.id = eu.enterprise_id
        where ar.client_id in (select id from users where vinculed_by_id = ?)
          and ${semExcluidosDoC2x.sql}`,
      [c2xId, ...semExcluidosDoC2x.params],
    );
    return rows.map((row) => String(row.id));
  } catch {
    // C2X fora do ar: devolve só o que o Apolo sabe (não trava a triagem).
    return [];
  }
}

// O id do usuário no C2X, guardado no source_link da entidade.
async function c2xIdDaEntidade(
  adminClient: AdminClient,
  entityId: string,
): Promise<number | null> {
  const { data } = await adminClient
    .from("apolo_source_links")
    .select("source_id, source_table")
    .eq("entity_id", entityId)
    .eq("source_system", "c2x")
    .limit(20);

  for (const row of (data ?? []) as { source_id: string; source_table: string }[]) {
    if (row.source_table === "users") {
      const id = Number(onlyDigits(row.source_id));
      if (Number.isInteger(id) && id > 0) return id;
    }
  }
  return null;
}
