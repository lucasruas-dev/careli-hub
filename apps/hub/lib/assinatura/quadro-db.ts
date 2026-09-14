import type { SupabaseClient } from "@supabase/supabase-js";

import type { Pessoa } from "./signatarios";
import type { PapelNoContrato } from "./tipos";

// O QUADRO DE ASSINATURA DO EMPREENDIMENTO, lido para o envelope.
//
// Lucas (13/09/2026): *"a vendedora eu posso ter mais de um assinante (...) Testemunha a mesma
// coisa, e coordenador de vendas a mesma coisa, eu posso ter mais de um como coordenador"*.
//
// ⚠️ ESTE É O FIO QUE FALTAVA, e a falta dele era o defeito mais caro da assinatura: medido em
// 13/09/2026, os três envelopes já enviados em produção têm 2, 1 e 1 signatário — todos comprador
// ou cônjuge, zero vendedora. Um deles está FECHADO como assinado com um único signatário: uma
// compra e venda concluída sem a parte vendedora. Eram do ZZ TESTE, mas o fluxo permitia.
//
// ⚠️ O `coordenador` DO QUADRO VIRA O PAPEL `coordenadora`. Os nomes divergem de propósito: o papel
// no código é a chave que está GRAVADA no jsonb de `assinatura_ordem`, e `lerRegraDeOrdem` descarta
// chave que não conhece — renomeá-la faria a ordem cadastrada do empreendimento voltar ao padrão em
// silêncio. A tela já diz "Coordenador de Vendas"; a chave fica como está. Mesma disciplina de
// `valor_imovel_venda`, que mantém o nome porque as 41 minutas do legado o trazem.

/** Como o papel do quadro se chama dentro do contrato. */
const PAPEL_DO_QUADRO: Record<string, PapelNoContrato> = {
  coordenador: "coordenadora",
  testemunha: "testemunha",
  vendedora: "vendedora",
};

type LinhaDoQuadro = {
  cpf: null | string;
  email: null | string;
  nome: string;
  ordem_assinatura: null | number;
  papel: string;
  posicao: number;
  telefone: null | string;
};

/**
 * Quem assina por esta empresa, segundo o cadastro dela.
 *
 * ⚠️ O REPRESENTANTE NÃO MORA NO QUADRO, e é por isso que ele é lido aqui. Ele vem de
 * `apolo_relationships` do cadastro da PJ; copiá-lo para `temis_assinantes` criaria uma segunda
 * verdade sobre quem representa a empresa, e o dia em que o cadastro mudasse o envelope continuaria
 * indo para o nome antigo.
 */
async function representanteLegal(
  sb: SupabaseClient,
  entityId: string,
  papel: PapelNoContrato,
): Promise<null | Pessoa> {
  const { data: vinculo } = await sb
    .from("apolo_relationships")
    .select("related_entity_id")
    .eq("entity_id", entityId)
    .eq("relationship_type", "representante_legal")
    .limit(1)
    .maybeSingle<{ related_entity_id: null | string }>();

  const pessoaId = vinculo?.related_entity_id;
  if (!pessoaId) return null;

  const [{ data: pessoa }, { data: contatos }] = await Promise.all([
    sb
      .from("apolo_entities")
      .select("display_name, document_masked")
      .eq("id", pessoaId)
      .maybeSingle<{ display_name: null | string; document_masked: null | string }>(),
    sb
      .from("apolo_contacts")
      .select("value")
      .eq("entity_id", pessoaId)
      .eq("contact_type", "email")
      .limit(1),
  ]);

  const nome = String(pessoa?.display_name ?? "").trim();
  if (!nome) return null;

  return {
    cpf: pessoa?.document_masked ?? null,
    email: String((contatos ?? [])[0]?.value ?? "").trim(),
    nome,
    papel,
    telefone: null,
  };
}

/**
 * As pessoas do quadro deste empreendimento, prontas para virar signatárias.
 *
 * ⚠️ FALHA DE LEITURA DEVOLVE LISTA VAZIA, E NÃO DERRUBA O ENVIO. Um timeout do PostgREST aqui não
 * pode impedir um contrato de ir para assinatura — mas o operador VÊ a lista antes de confirmar, e
 * uma lista sem a vendedora é visível. O contrário (derrubar) transformaria um blip de rede numa
 * tela de erro sobre um cadastro que está certo.
 *
 * ⚠️ ORDENADO POR PAPEL E POSIÇÃO, e não pelo que o banco devolver. A ordem desta lista é a ordem em
 * que a tela mostra as pessoas para conferência, e ela tem de bater com a ordem das linhas no
 * papel — ler fora de ordem é o que faz alguém aprovar a testemunha errada.
 */
export async function assinantesDoQuadro(
  sb: SupabaseClient,
  alvo: {
    /** O COORDENADOR daquele empreendimento (0159) — não a Coordenação de Vendas da casa. */
    coordenadorEntityId?: null | string;
    enterpriseId: null | string;
    vendedoraEntityId?: null | string;
  },
): Promise<Pessoa[]> {
  const enterpriseId = String(alvo.enterpriseId ?? "").trim();
  if (!enterpriseId) return [];

  try {
    const { data, error } = await sb
      .from("temis_assinantes")
      .select("papel,posicao,ordem_assinatura,nome,cpf,email,telefone")
      .eq("workspace_id", "careli")
      .eq("enterprise_id", enterpriseId)
      .eq("ativo", true)
      .order("papel", { ascending: true })
      .order("posicao", { ascending: true });

    if (error) {
      console.warn("[assinatura/quadro] leitura falhou:", error.message);
      return [];
    }

    const linhas = (data ?? []) as LinhaDoQuadro[];
    const pessoas: Pessoa[] = [];

    for (const l of linhas) {
      const papel = PAPEL_DO_QUADRO[l.papel];
      const nome = String(l.nome ?? "").trim();
      if (!papel || !nome) continue;
      pessoas.push({
        cpf: l.cpf,
        email: String(l.email ?? "").trim(),
        nome,
        // ⚠️ O NÚMERO VAI CRU. Quem compacta é `ordenarSignatarios`, na hora de numerar: cadastrar
        // 1 e 4 sai como 1 e 2 se não houver ninguém no meio. Compactar aqui perderia a folga que o
        // operador deixou de propósito.
        ordemPropria: l.ordem_assinatura,
        papel,
        telefone: l.telefone,
      });
    }

    // ⚠️ O REPRESENTANTE ENTRA SÓ SE NINGUÉM OCUPOU A VENDEDORA. Quem digitou uma linha de vendedora
    // no quadro decidiu quem assina pela empresa; somar o herdado por cima poria duas pessoas na
    // mesma linha do contrato. É a mesma regra que a tela aplica, e de propósito: duas versões dela
    // divergiriam no primeiro ajuste.
    const herdar = async (
      entityId: null | string | undefined,
      papel: PapelNoContrato,
    ) => {
      if (!entityId) return;
      if (pessoas.some((p) => p.papel === papel)) return;
      const rep = await representanteLegal(sb, entityId, papel);
      if (rep) pessoas.unshift(rep);
    };

    await herdar(alvo.vendedoraEntityId, "vendedora");
    // ⚠️ O COORDENADOR TAMBÉM HERDA. Lucas (13/09/2026): *"o coordenador pode vir preenchido, só
    // vamos incluir se precisar, vendedora também que vir"*. O papel no código continua `coordenadora`
    // porque é a chave gravada no jsonb da ordem — só o RÓTULO da tela mudou para o masculino.
    await herdar(alvo.coordenadorEntityId, "coordenadora");

    return pessoas;
  } catch (e) {
    console.warn("[assinatura/quadro] falhou:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * As duas empresas do empreendimento de quem o quadro herda representante.
 *
 * ⚠️ TRÊS COLUNAS PARECIDAS, E UMA DELAS NÃO ENTRA AQUI. `vendedor_entity_id` é a incorporadora,
 * `coordenador_entity_id` (0159) é o coordenador DAQUELE empreendimento, e `coordenadora_entity_id`
 * é a Coordenação de Vendas da casa — esta última aparece no TEXTO do contrato e não assina. Trocar
 * as três já pôs o captador no lugar do coordenador uma vez.
 */
export async function empresasDoEmpreendimento(
  sb: SupabaseClient,
  enterpriseId: null | string,
): Promise<{ coordenador: null | string; vendedora: null | string }> {
  const vazio = { coordenador: null, vendedora: null };
  const id = String(enterpriseId ?? "").trim();
  if (!id) return vazio;
  try {
    const { data } = await sb
      .from("apolo_enterprise_settings")
      .select("vendedor_entity_id, coordenador_entity_id")
      .eq("enterprise_id", id)
      .maybeSingle<{
        coordenador_entity_id: null | string;
        vendedor_entity_id: null | string;
      }>();
    return {
      coordenador: data?.coordenador_entity_id ?? null,
      vendedora: data?.vendedor_entity_id ?? null,
    };
  } catch {
    return vazio;
  }
}
