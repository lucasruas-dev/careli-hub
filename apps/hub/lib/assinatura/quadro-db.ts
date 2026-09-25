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
//
// ⚠️ O QUADRO É A ÚNICA FONTE, E NADA MAIS É HERDADO DA FICHA (25/09/2026). Até esta data
// `assinantesDoQuadro` acrescentava o representante legal da empresa vendedora e o da coordenadora
// de vendas (`apolo_relationships` + `apolo_entities` + o primeiro e-mail de `apolo_contacts`)
// quando ninguém ocupava o papel, e a tela fazia o mesmo quando a LINHA 1 estava livre. As duas
// regras divergiam: no VOR a Nívea gravou coordenadores nas linhas 2 e 3, a tela mostrava o
// Fabricio herdado na linha 1 e o contrato saía sem ele. Lucas, no mesmo dia: *"todas assinaturas eu
// tenho que conseguir excluir e editar, esse cadeado esta errado"* e *"nao tem que ter mais sync com
// c2x referente a contrato"* (as fichas nasceram da sincronização do C2X). Quem herdava virou linha
// gravada pela migration 0191, com o e-mail que o Lucas escolheu; daqui em diante quem assina é
// exatamente o que está em `temis_assinantes`, e a tela lê a mesma tabela.

/**
 * Como o papel do quadro se chama dentro do contrato.
 *
 * ⚠️ O MAPA É A FRONTEIRA DO CONTRATO, e o que não está nele NÃO ENTRA no envelope — `assinantesDoQuadro`
 * descarta a linha (`if (!papel || !nome) continue`). É por isso que `termos_vendedora`, o papel que
 * nasceu em 20/09/2026 para o termo de acordo, está fora daqui de propósito: ele é lido por
 * `assinanteDeTermosDaVendedora`, logo abaixo, e só pelo Hades. Acrescentá-lo a este mapa poria o
 * analista apontado para assinar termos dentro de TODO contrato de venda daquele empreendimento.
 */
const PAPEL_DO_QUADRO: Record<string, PapelNoContrato> = {
  coordenador: "coordenadora",
  testemunha: "testemunha",
  vendedora: "vendedora",
};

/**
 * O papel, no quadro, de quem a incorporadora apontou para assinar os TERMOS dela.
 *
 * Lucas (20/09/2026): *"nessa tela vc pode abrir mais um campo para assinatura de termos vendedora,
 * ae eu posso apontar quem vai assinar os termos, não precisa necessariamente ser os representantes
 * legais, pode ser o juridico, analista, enfim"*. Liberado no banco pela migration 0180.
 */
export const PAPEL_DE_TERMOS_DA_VENDEDORA = "termos_vendedora";

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
  alvo: { enterpriseId: null | string },
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

    return pessoas;
  } catch (e) {
    console.warn("[assinatura/quadro] falhou:", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * QUEM A INCORPORADORA APONTOU PARA ASSINAR OS TERMOS DELA — ou `null`, quando ninguém foi apontado.
 *
 * Lucas (20/09/2026), depois de ver que o envio do termo de acordo exige uma pessoa física pela
 * vendedora: *"essa tela determina os assinantes, vamos ter o comprador e a vendedora, então temos
 * uma fonte de busca para quem vai assinar os acordos"*, e *"não precisa necessariamente ser os
 * representantes legais, pode ser o juridico, analista, enfim"*.
 *
 * ⚠️ O PAPEL SAI DAQUI COMO `vendedora`, E ISSO NÃO É DESLEIXO. No quadro ele se chama
 * `termos_vendedora` porque é ali que ele se diferencia de quem assina a compra e venda; no
 * ENVELOPE DO TERMO ele é a parte vendedora — é o nome que a ordem do acordo (`ORDEM_DO_ACORDO`)
 * numera e o rótulo que a tela de conferência mostra ao lado do comprador e da Careli. Inventar um
 * sétimo `PapelNoContrato` só para o termo obrigaria `ordensCanonicas` a renumerar todo mundo e a
 * tela de categorias a aprender um papel que não assina contrato nenhum.
 *
 * ⚠️ NÃO HÁ QUEDA AQUI DENTRO, E É DE PROPÓSITO. Quem encadeia é `incorporadorDoAcordo`, em
 * `envio-db.ts`: o apontado vence, depois a vendedora do quadro, e o segundo degrau sai pronto de
 * `assinantesDoQuadro`. Repetir a queda aqui faria duas versões da mesma precedência, que é como a
 * tela e o envio passam a discordar sem ninguém perceber. (Até 25/09/2026 havia um terceiro degrau,
 * o representante legal herdado da ficha; ele saiu com a herança, e a migration 0191 gravou como
 * linha de vendedora quem ele alcançaria. Medido no dia: ninguém, porque nenhuma incorporadora tem
 * representante legal cadastrado.)
 *
 * ⚠️ E É ELE TAMBÉM QUE PERCORRE PAI E FILHO. Esta função responde por UM empreendimento; a cadeia
 * (divisão da unidade, empreendimento da proposta, pai) é do chamador, pela mesma razão: a regra de
 * herança da casa mora num lugar só.
 *
 * ⚠️ FALHA DE LEITURA DEVOLVE `null`, E NÃO DERRUBA O ENVIO — a mesma disciplina de
 * `assinantesDoQuadro`: um timeout do PostgREST vira "ninguém apontado", o envio cai na vendedora
 * do quadro e, se nem ela existir, o operador lê a frase de impedimento em vez de uma tela de erro.
 *
 * ⚠️ O MENOR `posicao` VENCE, e só ele vai. O termo tem UMA linha para a vendedora; cadastrar dois
 * apontados é o operador trocando de pessoa sem apagar a antiga, e nesse caso a linha 1 é a que ele
 * enxerga primeiro no quadro. Mandar as duas poria no envelope alguém que o termo não qualifica.
 */
export async function assinanteDeTermosDaVendedora(
  sb: SupabaseClient,
  enterpriseId: null | string,
): Promise<null | Pessoa> {
  const id = String(enterpriseId ?? "").trim();
  if (!id) return null;

  try {
    const { data, error } = await sb
      .from("temis_assinantes")
      .select("nome,cpf,email,telefone")
      .eq("workspace_id", "careli")
      .eq("enterprise_id", id)
      .eq("papel", PAPEL_DE_TERMOS_DA_VENDEDORA)
      .eq("ativo", true)
      .order("posicao", { ascending: true })
      .limit(1);

    if (error) {
      console.warn("[assinatura/quadro] assinante de termos falhou:", error.message);
      return null;
    }

    const linha = (data ?? [])[0] as
      | undefined
      | Omit<LinhaDoQuadro, "ordem_assinatura" | "papel" | "posicao">;
    const nome = String(linha?.nome ?? "").trim();
    if (!nome) return null;

    // ⚠️ SEM `ordemPropria`, E A COLUNA NEM É LIDA. `ordem_assinatura` existe na linha do quadro
    // porque no CONTRATO a testemunha pode furar a fila do próprio papel. No termo de acordo a fila
    // é do Lucas e tem três degraus fixos (*"na ordem comprador, incorporador e nivea careli"*):
    // deixar o cadastro do empreendimento mandar aqui permitiria, por um número digitado numa tela
    // sobre contrato, o incorporador assinar ANTES do comprador — e a razão de o comprador vir
    // primeiro é que é ele quem pode não aceitar o acordo. A tela dos termos não oferece o campo,
    // pelo mesmo motivo.
    return {
      cpf: linha?.cpf ?? null,
      email: String(linha?.email ?? "").trim(),
      nome,
      papel: "vendedora",
      telefone: linha?.telefone ?? null,
    };
  } catch (e) {
    console.warn(
      "[assinatura/quadro] assinante de termos falhou:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
