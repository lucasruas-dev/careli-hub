// O NOME DE MERCADO DO EMPREENDIMENTO: o que sai impresso para corretor, imobiliária e coordenador.
//
// Nasceu para o cabeçalho da CAD em PDF. Lucas (24/09/2026): *"vamos trazer o empreendimento a qual
// aquela cad esta vinculada? pode ser abaixo de corretor"*. A mesma CAD vai para o coordenador e para
// o corretor, então o nome tem de ser o que o MERCADO conhece.
//
// ⚠️ O PAI É A REFERÊNCIA; O FILHO É RECORTE INTERNO E NÃO APARECE. VOC, VOL, VOR, LBF, LBP, LBR, LOS,
// LOU, PDV, PVS, RDP, RPC e RPS são divisões da Careli; para quem está de fora existe "Vale do Ouro",
// "Lagoa Bonita", "Lavra do Ouro" ([[feedback_corretor_nao_ve_divisao_interna]],
// [[feedback_pai_e_a_fonte_unidade_unica]]). Imprimir "Vale do Ouro · VOC" numa CAD que o corretor
// recebe é expor a divisão.
//
// A FONTE É `hercules_empreendimentos`: acha a linha pelo `c2x_enterprise_id` e, se ela tiver
// `pai_id`, usa o `nome` do pai. Sobe UM nível só, como `lib/hercules/masterplan-do-empreendimento.ts`:
// a tabela não tem neto, e subir recursivamente inventaria uma hierarquia que não existe.
//
// ⚠️ O NOME DO FILHO NO CADASTRO CARREGA A DIVISÃO ("Vale do Ouro · VOC"). Medido em 24/09/2026: os 13
// filhos têm o sufixo " · SIGLA", e o prefixo é sempre o nome do pai. Por isso o sufixo sai de
// QUALQUER fonte (cadastro, reserva, grupo), e não só do texto da esteira.
//
// O texto de `apolo_esteira.empreendimento` é só RESERVA, para id fora do cadastro: ele guarda o que o
// C2X gravou ("VALE DO OURO") ou nome de filho ("Vale do Ouro · VOL"). Os ids que nem o C2X nomeou
// ficaram como "EMPREENDIMENTO 30" (medido: '2', '30' e '34', uma CAD cada). Isso não é nome de nada e
// não vai para o papel: a linha é omitida.
//
// ⚠️ NUNCA DERRUBA A GERAÇÃO DA CAD. O supabase-js não lança em erro de consulta (devolve
// `{ data: null, error }`), então o `error` é conferido nas duas leituras; e o que lançar de verdade
// cai no `catch`. Sem nome confiável, a CAD sai sem a linha, nunca deixa de sair.
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";

/** O pedaço de `hercules_empreendimentos` que a resolução usa. */
export type LinhaDoCadastro = {
  c2x_enterprise_id: null | string;
  id: string;
  nome: null | string;
  pai_id: null | string;
};

type ClienteDoCadastro = Pick<SupabaseClient, "from">;

const COLUNAS = "c2x_enterprise_id, id, nome, pai_id";

// Id de GRUPO que o portal público grava ("group:Lagoa Bonita"). Para o mercado o grupo JÁ É o nome
// ([[reference_empreendimento_grupo_vs_divisao_id]]).
const PREFIXO_GRUPO = "group:";

// O separador que o cadastro põe entre o nome do pai e a sigla da divisão ("Vale do Ouro · VOC").
const SEPARADOR_DE_DIVISAO = "·";

// O texto que a esteira grava quando o id não tem nome em lugar nenhum.
const SEM_NOME = /^empreendimento\s+\d+$/i;

/** "Vale do Ouro · VOC" vira "Vale do Ouro". Texto sem divisão volta só aparado. */
export function semDivisao(nome: null | string | undefined): string {
  return ((nome ?? "").split(SEPARADOR_DE_DIVISAO)[0] ?? "").trim();
}

function daReserva(reserva: null | string | undefined): string {
  const nome = semDivisao(reserva);
  return SEM_NOME.test(nome) ? "" : nome;
}

/**
 * O nome de mercado, PURO: recebe as linhas do cadastro já lidas. Devolve `""` quando não há nome
 * confiável, e quem monta a CAD omite a linha.
 */
export function nomeDeMercado(
  enterpriseId: unknown,
  cadastro: readonly LinhaDoCadastro[],
  reserva?: null | string,
): string {
  const id = normalizarEnterpriseId(enterpriseId);
  if (id?.startsWith(PREFIXO_GRUPO)) return semDivisao(id.slice(PREFIXO_GRUPO.length));

  const linha = id ? cadastro.find((l) => (l.c2x_enterprise_id ?? "").trim() === id) : undefined;
  if (!linha) return daReserva(reserva);

  // Empreendimento sem pai: ele mesmo é o nome de mercado.
  if (!linha.pai_id) return semDivisao(linha.nome) || daReserva(reserva);

  const doPai = semDivisao(cadastro.find((l) => l.id === linha.pai_id)?.nome);
  if (doPai) return doPai;

  // ⚠️ FILHO COM O PAI AUSENTE (leitura do pai falhou ou não voltou). O nome do filho NÃO vai para o
  // papel. O prefixo antes do "·" é o nome do pai, por convenção do cadastro, e só ele é usado; filho
  // sem o separador não diz quem é o pai, então vale a reserva (ou nada).
  const nomeDoFilho = linha.nome ?? "";
  if (nomeDoFilho.includes(SEPARADOR_DE_DIVISAO)) {
    const prefixo = semDivisao(nomeDoFilho);
    if (prefixo) return prefixo;
  }
  return daReserva(reserva);
}

/**
 * O nome de mercado lido do banco. `enterpriseId` é o id da CAD (`apolo_esteira.enterprise_id`, o do
 * token, o do vínculo), NUNCA um texto vindo do browser. `reserva` é o texto que a esteira ou o
 * catálogo já têm, usado só quando o id não está no cadastro.
 */
export async function nomeDeMercadoDoEmpreendimento(
  client: ClienteDoCadastro,
  enterpriseId: unknown,
  reserva?: null | string,
): Promise<string> {
  const id = normalizarEnterpriseId(enterpriseId);
  if (!id || id.startsWith(PREFIXO_GRUPO)) return nomeDeMercado(id, [], reserva);

  try {
    const { data: proprio, error } = await client
      .from("hercules_empreendimentos")
      .select(COLUNAS)
      .eq("c2x_enterprise_id", id)
      .limit(1);
    // Sem o cadastro não se sabe se o id é pai ou filho: só a reserva (sem sufixo) é segura.
    if (error) return nomeDeMercado(id, [], reserva);

    const linhas = [...((proprio ?? []) as LinhaDoCadastro[])];
    const paiId = linhas[0]?.pai_id;
    if (paiId) {
      const { data: pai, error: erroDoPai } = await client
        .from("hercules_empreendimentos")
        .select(COLUNAS)
        .eq("id", paiId)
        .limit(1);
      // ⚠️ Leitura do pai que falhou é tratada como PAI AUSENTE: `nomeDeMercado` nunca devolve o nome
      // do filho nesse caso (usa o prefixo antes do "·" ou a reserva).
      if (!erroDoPai) linhas.push(...((pai ?? []) as LinhaDoCadastro[]));
    }
    return nomeDeMercado(id, linhas, reserva);
  } catch {
    return nomeDeMercado(id, [], reserva);
  }
}
