// QUEM PODE VENDER NESTE EMPREENDIMENTO — a lista que a reserva oferece.
//
// Lucas (03/09/2026): *"para criar uma reserva em nome de um corretor ou imobiliária é OBRIGATÓRIO
// que esses dois estejam habilitados para vender nesse empreendimento"*.
//
// ⚠️ O FILTRO DE PAPEL NÃO É OPCIONAL. O vínculo `empreendimento` do Apolo não é só de imobiliária:
// prospect e corretor recebem o MESMO `relationship_type`, e das 151 linhas medidas 71 são de
// prospect ou corretor. Sem cruzar com `apolo_entity_profiles`, o painel do coordenador já contou
// 76 "imobiliárias" onde havia 30 — e aqui o efeito seria pior: a reserva sairia no nome de um
// prospect. Quem resolve isso é `lerImobiliariasVinculadas`, e é ela que esta camada usa.
//
// ⚠️ O CORRETOR NÃO PRECISA DE VÍNCULO PRÓPRIO COM O EMPREENDIMENTO — quem precisa é a
// IMOBILIÁRIA dele. A primeira versão exigia os dois, lendo ao pé da letra o *"é obrigatório que
// esses dois estejam habilitados"*, e o Lucas corrigiu na hora em que viu o efeito: *"não entendi o
// motivo de não trazer todos os corretores"*. O dado dava razão a ele — dos 65 corretores das 37
// imobiliárias do Vale do Ouro, só 23 tinham vínculo individual, e os outros 42 apareciam cinza sem
// que isso significasse nada sobre o direito de vender.
//
// A regra que sobrou é a que corresponde ao mundo: a imobiliária é credenciada no empreendimento, e
// o corretor é credenciado NA IMOBILIÁRIA. As duas continuam sendo conferidas na gravação.

import type { SupabaseClient } from "@supabase/supabase-js";

import { corretoresDaImobiliaria } from "@/lib/apolo/disparo-credenciamento";
import { lerImobiliariasVinculadas } from "@/lib/apolo/incorporador/crm";

/**
 * O empreendimento da unidade e TODA a família dele (pai e filhos), em ids do C2X.
 *
 * ⚠️ SEM ISSO A LISTA VEM VAZIA, e foi o que aconteceu na primeira reserva de verdade: o Lucas
 * clicou num lote do Vale do Ouro e leu "nenhuma imobiliária habilitada". As unidades do Vale do
 * Ouro estão espalhadas entre VLO (35), VOL (36) e VOC (37) — mas as 37 imobiliárias credenciadas
 * estão vinculadas ao 35, e só a ele. Perguntar "quem vende no 37?" devolve zero, e a tela conclui
 * que ninguém pode vender num empreendimento onde quase quarenta imobiliárias podem.
 *
 * A família é o recorte certo porque é o mesmo loteamento: o pai é o espelho de onde saem as
 * unidades, e os filhos são as visões que respondem pela burocracia. Uma imobiliária credenciada em
 * qualquer um deles vende o mesmo produto.
 */
export function familiaDoEmpreendimento(
  cadastro: Array<{ c2xEnterpriseId: null | string; id: string; paiId: null | string }>,
  c2xEnterpriseId: string,
): string[] {
  const alvo = String(c2xEnterpriseId).trim();
  if (!alvo) return [];

  const linha = cadastro.find((l) => l.c2xEnterpriseId === alvo);
  // Empreendimento fora do cadastro do Hércules: sobra o que veio, que é melhor do que nada.
  if (!linha) return [alvo];

  const raizId = linha.paiId ?? linha.id;
  const familia = cadastro.filter((l) => l.id === raizId || l.paiId === raizId);

  const ids = new Set<string>([alvo]);
  for (const membro of familia) {
    if (membro.c2xEnterpriseId) ids.add(membro.c2xEnterpriseId);
  }
  return [...ids];
}

export type ImobiliariaQueVende = {
  documento: null | string;
  id: string;
  nome: string;
  /** Vínculo verificado no Apolo. Não impede a reserva; a tela mostra a diferença. */
  verificada: boolean;
};

export type CorretorQueVende = {
  id: string;
  imobiliariaId: string;
  imobiliariaNome: string;
  nome: string;
  telefone: null | string;
};

export type QuemPodeVender = {
  corretores: CorretorQueVende[];
  imobiliarias: ImobiliariaQueVende[];
};

/**
 * Quem pode vender neste empreendimento: as imobiliárias e os corretores delas.
 *
 * ⚠️ UMA CARGA SÓ, E A BUSCA É NA TELA. São ~30 imobiliárias e ~58 corretores no total medido —
 * cabe numa resposta. Autocomplete no servidor exigiria debounce, estado de carregando e uma rota
 * por tecla, para procurar dentro de uma lista que já cabe na memória do navegador.
 */
export async function quemPodeVender(
  admin: SupabaseClient,
  enterpriseIds: string[],
): Promise<QuemPodeVender> {
  const vinculadas = await lerImobiliariasVinculadas(admin, enterpriseIds);
  if (!vinculadas.ok) throw new Error(vinculadas.erro);

  const imobiliarias: ImobiliariaQueVende[] = vinculadas.credenciadas
    .map((i) => ({
      documento: i.documento,
      id: i.id,
      nome: i.nome,
      verificada: i.verificada,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  if (imobiliarias.length === 0) return { corretores: [], imobiliarias: [] };

  // Os corretores de cada imobiliária, em paralelo: são poucas, e em série a tela esperaria a soma.
  const listas = await Promise.all(
    imobiliarias.map(async (imobiliaria) => {
      const corretores = await corretoresDaImobiliaria(admin, imobiliaria.id);
      return corretores.map((c) => ({
        id: c.entityId,
        imobiliariaId: imobiliaria.id,
        imobiliariaNome: imobiliaria.nome,
        nome: c.nome,
        telefone: c.telefone,
      }));
    }),
  );

  return {
    corretores: listas.flat().sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    imobiliarias,
  };
}

/**
 * A imobiliária e o corretor estão habilitados para vender AQUI?
 *
 * ⚠️ É A CONFERÊNCIA DA GRAVAÇÃO, e ela não confia na tela. A lista já vem filtrada, mas quem
 * grava é um POST: sem esta checagem, um pedido montado à mão criaria reserva no nome de qualquer
 * entidade do Apolo.
 */
export async function podemVender(
  admin: SupabaseClient,
  enterpriseIds: string[],
  alvos: { corretorId?: null | string; imobiliariaId: string },
): Promise<{ motivo: string; ok: false } | { ok: true }> {
  const vinculadas = await lerImobiliariasVinculadas(admin, enterpriseIds);
  if (!vinculadas.ok) return { motivo: vinculadas.erro, ok: false };

  if (!vinculadas.credenciadas.some((i) => i.id === alvos.imobiliariaId)) {
    return { motivo: "Esta imobiliária não está habilitada a vender neste empreendimento.", ok: false };
  }

  if (!alvos.corretorId) return { ok: true };

  // ⚠️ A TRAVA DO CORRETOR É A IMOBILIÁRIA DELE, e continua existindo: sem esta linha, um pedido
  // montado à mão colocaria na reserva um corretor de outra imobiliária — ou qualquer entidade do
  // Apolo — e a comissão iria para quem não vendeu.
  const daImobiliaria = await corretoresDaImobiliaria(admin, alvos.imobiliariaId);
  if (!daImobiliaria.some((c) => c.entityId === alvos.corretorId)) {
    return { motivo: "Este corretor não está ligado a esta imobiliária.", ok: false };
  }

  return { ok: true };
}

// ── O COORDENADOR, QUANDO ELE NÃO VEM DO C2X ────────────────────────────────
//
// ⚠️ O COORDENADOR DE VENDAS MORA NO LEGADO (`players`, relação `coordenador_vendas`), e é de lá
// que `coordenadoresDosEmpreendimentos` o tira. Isso funciona para os empreendimentos que existem
// no C2X — e deixa sem coordenador todo empreendimento que só existe no Panteon: o de TESTE
// (Lucas, 03/09/2026: *"um empreendimento em produção, mas ele será para teste (...) eu posso ser
// coordenador"*) e, no futuro, qualquer produto novo antes de ser cadastrado no legado.
//
// ⚠️ VÍNCULO, E NÃO COLUNA NOVA. `apolo_relationships` já é onde o Apolo guarda "esta pessoa tem
// este papel neste empreendimento", com o mesmo formato do vínculo de imobiliária
// (`metadata.enterpriseId`). Uma coluna em `apolo_enterprise_settings` pediria migration para
// guardar o que a tabela de vínculos já sabe guardar.
//
// ⚠️ É FALLBACK, NÃO SUBSTITUIÇÃO: quem chama só cai aqui quando o C2X não devolveu ninguém. Um
// coordenador cadastrado no Panteon nunca esconde o coordenador de verdade do legado.

export type CoordenadorDoPanteon = {
  nome: string;
  telefone: null | string;
};

export async function coordenadoresDoPanteon(
  admin: SupabaseClient,
  enterpriseIds: string[],
): Promise<CoordenadorDoPanteon[]> {
  const alvos = new Set(enterpriseIds.map((id) => String(id).trim()).filter(Boolean));
  if (alvos.size === 0) return [];

  const { data, error } = await admin
    .from("apolo_relationships")
    .select("entity_id, status, metadata")
    .eq("relationship_type", "coordenador")
    .limit(500);

  if (error) {
    // Falha aqui não pode derrubar a reserva: ela já está gravada quando o aviso sai.
    console.error("[hercules] falha ao ler coordenador do Panteon", error);
    return [];
  }

  const ids = [
    ...new Set(
      ((data ?? []) as Array<{
        entity_id: string;
        metadata: null | { enterpriseId?: null | number | string };
        status: null | string;
      }>)
        .filter((l) => l.status !== "archived")
        .filter((l) => alvos.has(String(l.metadata?.enterpriseId ?? "").trim()))
        .map((l) => l.entity_id),
    ),
  ];
  if (ids.length === 0) return [];

  const [{ data: entidades }, { data: contatos }] = await Promise.all([
    admin.from("apolo_entities").select("id, display_name").in("id", ids),
    admin
      .from("apolo_contacts")
      .select("entity_id, value, is_primary")
      .eq("contact_type", "phone")
      .in("entity_id", ids),
  ]);

  const telefonePorId = new Map<string, string>();
  for (const c of (contatos ?? []) as Array<{
    entity_id: string;
    is_primary: boolean | null;
    value: null | string;
  }>) {
    const valor = (c.value ?? "").trim();
    if (!valor) continue;
    if (c.is_primary === true || !telefonePorId.has(c.entity_id)) {
      telefonePorId.set(c.entity_id, valor);
    }
  }

  return ((entidades ?? []) as Array<{ display_name: null | string; id: string }>).map((e) => ({
    nome: (e.display_name ?? "").trim() || "Coordenador",
    telefone: telefonePorId.get(e.id) ?? null,
  }));
}
