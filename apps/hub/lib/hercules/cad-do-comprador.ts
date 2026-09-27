// A CAD DO COMPRADOR DA CARTEIRA NASCE CREDENCIADA, NA GRAVAÇÃO DA PROPOSTA.
//
// Lucas (26/09/2026), escolhendo "Nasce a CAD credenciada" para a pergunta "como o comprador antigo
// aparece no Apolo quando gerar a proposta": o sistema cria sozinho a CAD já credenciada, marcada
// "comprador da carteira", e ela aparece no Board e no CRM do coordenador como qualquer outra. A
// esteira continua sendo a fonte única.
//
// ⚠️ SÓ NA GRAVAÇÃO (POST), NUNCA NA LEITURA. O GET que abre a modal não escreve nada: abrir a tela
// de proposta de um comprador e desistir não pode deixar CAD no Board.
//
// ⚠️ INSERT DIRETO, E NÃO `atualizarEtapa` (lib/apolo/esteira.ts). Aquela é o ponto autoritativo de
// transição de etapa e tem três efeitos que aqui seriam errados: põe a pessoa na fila do lançamento
// do Prometeu, manda WhatsApp ao corretor e ao coordenador (`avisarEtapa`) e SOBE A PESSOA AO C2X
// pela API de escrita (`subirParaC2xAoCredenciar`). O comprador da carteira já está no C2X (é de lá
// que o contrato veio), e os únicos avisos desta venda são os três de sempre da proposta. O molde é
// o da CAD pública (`gravarVinculoEsteira`, lib/publico/cad/dados.ts), sem trigger nem realtime em
// `apolo_esteira` (conferido em pg_trigger e pg_publication_tables, 26/09/2026).
//
// ⚠️ NÃO SOBRESCREVE CAD NENHUMA. `ON CONFLICT (entity_id, enterprise_id) DO NOTHING`
// (`ignoreDuplicates`): se a pessoa já tem CAD naquele empreendimento, ela fica como está. Pela régua
// do titular isso nem deveria acontecer (quem tem CAD no escopo é decidido pela CAD), mas duas
// propostas no mesmo segundo, ou uma CAD aberta por outra tela entre a leitura e a gravação, chegam
// aqui, e a resposta certa é "já existia", não uma CAD em revisão virando credenciada.
//
// ⚠️ NUNCA LANÇA. A proposta já está gravada quando isto roda; uma CAD que não nasce vira uma linha
// no retorno (e no log), nunca um 503 numa venda que deu certo. É o "efeito colateral que não
// derruba": por isso mesmo ele PRECISA ser contado depois do primeiro uso em produção
// (propostas 'panteon' cujo titular não tem CAD na família = as que ficaram sem).

import type { SupabaseClient } from "@supabase/supabase-js";

import type { LinhaDaFamilia } from "@/lib/apolo/incorporador/familia-no-portal";

import { type CompraAtiva, ORIGEM_COMPRADOR_DA_CARTEIRA } from "./compra-ativa";

type Cliente = Pick<SupabaseClient, "from">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResultadoDaCadDoComprador =
  | { enterpriseId: string; estado: "criada" | "ja_existia" }
  | { estado: "erro"; motivo: string };

export type EntradaDaCadDoComprador = {
  /** Quem gerou a proposta (usuário da sessão). Só é gravado quando é um uuid. */
  atualizadoPor: null | string;
  /** O instante da gravação, em ISO. */
  agora: string;
  /** O código da venda nova (a proposta que está nascendo). */
  codigoDaVenda: null | string;
  compra: CompraAtiva;
  corretorEntityId: null | string;
  corretorNome: null | string;
  /** O nome do empreendimento como o cadastro do Panteon o escreve. */
  empreendimentoNome: null | string;
  /** Onde a CAD mora: `enterpriseIdDaCad`. Nunca vazio. */
  enterpriseId: string;
  /** A entidade do contrato (a sincronizada do C2X). */
  entityId: null | string;
  imobiliariaEntityId: null | string;
  imobiliariaNome: null | string;
};

/**
 * O `enterprise_id` em que a CAD do comprador nasce. Pura.
 *
 * ⚠️ O PAI QUANDO ELE TEM ID NO C2X, SENÃO O DA UNIDADE. É onde as CADs daquele empreendimento já
 * moram (medido em 26/09/2026, 842 linhas, nenhuma com 'group:'): no Vale do Ouro 692 das 697 CADs
 * reais estão no 35, o pai; a Lagoa Bonita pública grava no 31, o pai do LAB; o Veredas (19) não tem
 * pai e grava no 19. É a mesma conta do espelho em `escopoDaEsteiraDoPortal`, e é por isso que a CAD
 * escrita aqui é achada de volta pela régua do titular em qualquer portal (o espelho entra no escopo
 * do titular, que tem o CPF inteiro).
 */
export function enterpriseIdDaCad(cadastro: readonly LinhaDaFamilia[], c2xIdDaUnidade: string): string {
  const alvo = String(c2xIdDaUnidade ?? "").trim();
  const linha = cadastro.find((l) => l.c2xEnterpriseId === alvo);
  const pai = linha?.paiId ? cadastro.find((l) => l.id === linha.paiId) : undefined;
  const espelho = pai?.c2xEnterpriseId ? String(pai.c2xEnterpriseId).trim() : "";
  return espelho || alvo;
}

/**
 * A linha que vai para `apolo_esteira`. Pura (os testes conferem coluna por coluna).
 *
 * ⚠️ SEM `ficha`, SEM `analista_id`, SEM `pago_em`: a CAD da carteira não passou pela esteira, e
 * inventar uma ficha aqui esconderia a ficha de verdade da pessoa (a Têmis prefere a ficha da CAD do
 * empreendimento da venda; ver `dados-do-contrato.ts`, que agora ignora ficha vazia).
 */
export function linhaDaCadDoComprador(
  entrada: EntradaDaCadDoComprador,
  corretorEmail: null | string,
): Record<string, unknown> {
  const { compra } = entrada;
  const papel = compra.papel === "titular" ? "titular" : "co-comprador";
  const contrato = [compra.codigo ? `venda ${compra.codigo}` : null, compra.unidade ? `unidade ${compra.unidade}` : null]
    .filter(Boolean)
    .join(", ");
  const motivo =
    `Comprador da carteira: ${papel} de contrato ativo (faturado) no mesmo empreendimento` +
    (contrato ? ` (${contrato})` : "") +
    `. CAD aberta credenciada pela proposta${entrada.codigoDaVenda ? ` ${entrada.codigoDaVenda}` : ""}, sem passar pela esteira.`;

  return {
    atualizado_em: entrada.agora,
    atualizado_por: entrada.atualizadoPor && UUID.test(entrada.atualizadoPor) ? entrada.atualizadoPor : null,
    chegou_em: entrada.agora,
    corretor: entrada.corretorNome?.trim() || null,
    corretor_email: corretorEmail?.trim() || null,
    corretor_entity_id:
      entrada.corretorEntityId && UUID.test(entrada.corretorEntityId) ? entrada.corretorEntityId : null,
    empreendimento: entrada.empreendimentoNome?.trim() || null,
    enterprise_id: entrada.enterpriseId,
    entity_id: entrada.entityId,
    etapa: "credenciado",
    imobiliaria: entrada.imobiliariaNome?.trim() || null,
    imobiliaria_entity_id:
      entrada.imobiliariaEntityId && UUID.test(entrada.imobiliariaEntityId)
        ? entrada.imobiliariaEntityId
        : null,
    motivo,
    origem: ORIGEM_COMPRADOR_DA_CARTEIRA,
  };
}

/** O e-mail do corretor, para a coluna que o Board usa. Best-effort: sem ele, `null`. */
async function emailDoCorretor(admin: Cliente, corretorEntityId: null | string): Promise<null | string> {
  if (!corretorEntityId || !UUID.test(corretorEntityId)) return null;
  try {
    const { data, error } = await admin
      .from("apolo_contacts")
      .select("value")
      .eq("entity_id", corretorEntityId)
      .eq("contact_type", "email")
      .order("is_primary", { ascending: false })
      .limit(1);
    if (error) return null;
    const valor = ((data ?? []) as Array<{ value: null | string }>)[0]?.value ?? null;
    return valor?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Abre a CAD credenciada do comprador da carteira, se ela ainda não existir. Idempotente.
 *
 * @returns `criada`, `ja_existia` ou `erro` (com o motivo). Nunca lança.
 */
export async function garantirCadDoComprador(
  admin: Cliente,
  entrada: EntradaDaCadDoComprador,
): Promise<ResultadoDaCadDoComprador> {
  // ⚠️ O BANCO NÃO GUARDA ISTO SOZINHO: o CHECK `enterprise_id_presente` da 0080 não existe em prod
  // (conferido em 26/09/2026), então string vazia passaria e viraria uma CAD sem empreendimento.
  const enterpriseId = String(entrada.enterpriseId ?? "").trim();
  if (!enterpriseId) return { estado: "erro", motivo: "empreendimento da CAD vazio" };
  if (!entrada.entityId || !UUID.test(entrada.entityId)) {
    return { estado: "erro", motivo: "sem a entidade do contrato no Apolo" };
  }

  try {
    const corretorEmail = await emailDoCorretor(admin, entrada.corretorEntityId);
    const linha = linhaDaCadDoComprador({ ...entrada, enterpriseId }, corretorEmail);

    // ⚠️ O `.select()` NÃO É ENFEITE: com `ignoreDuplicates` o PostgREST devolve SÓ as linhas que
    // entraram. Lista vazia = já existia uma CAD neste (pessoa, empreendimento), e ela ficou intacta.
    const { data, error } = await admin
      .from("apolo_esteira")
      .upsert(linha, { ignoreDuplicates: true, onConflict: "entity_id,enterprise_id" })
      .select("entity_id");

    if (error) return { estado: "erro", motivo: error.message };
    const entrou = Array.isArray(data) && data.length > 0;
    return { enterpriseId, estado: entrou ? "criada" : "ja_existia" };
  } catch (erro) {
    return { estado: "erro", motivo: erro instanceof Error ? erro.message : String(erro) };
  }
}
