// A FAMÍLIA DO EMPREENDIMENTO VISTA DE UM PORTAL QUE NÃO É A CARELI.
//
// Por que existe (revisão da onda do Cecílio, 16/09/2026): `familiaDoEmpreendimento` (pai e filhos)
// nasceu para o comercial, que é a própria Careli vendendo. Ela responde "onde mora a CAD deste
// cliente?" e a resposta, no Vale do Ouro, é quase sempre o ESPELHO DO PAI: das CADs do loteamento,
// 688 estão no 35 (VLO), 2 no 36 (VOL), 1 no 37 (VOC) e 1 no 41 (VOR) (medido em 16/09/2026,
// leitura agregada de `apolo_esteira`). Para o comercial, ler a família inteira é o certo.
//
// Com o Cecílio operando a própria venda (*"a Cecilio quem vai fazer é o proprio time deles"*), a
// mesma leitura virou vazamento. A sessão do Cecílio tem o 37 (VOC) e o 39 (Garden); a família do
// 37 é 35 + 36 + 37 + 41, e o 36 é a carteira do Lino. A busca de proponentes devolvia nome, CPF e
// etapa de QUALQUER comprador do Vale do Ouro, e bastava varrer prefixos de CPF para levar a lista
// inteira.
//
// A régua daqui, para quem NÃO é o comercial:
//   • ABERTOS: só a família que a sessão alcança (mais o id do grupo, quando as divisões dela cobrem
//     o grupo inteiro). Busca por nome e por pedaço de CPF só olha estes.
//   • SÓ COM O CPF INTEIRO: o espelho do pai. É onde mora a CAD do próprio cliente do Cecílio, então
//     não dá para cortá-lo (a proposta do VOC nunca sairia), mas ele é compartilhado com o Lino.
//     Quem digita os onze dígitos já tem o documento do cliente na mão: a resposta confirma o que ele
//     sabe, não entrega uma lista.
//   • IRMÃOS FORA DA SESSÃO (o 36 do Lino, o 41): nunca.
//
// ⚠️ O COMERCIAL NÃO MUDA: para ele a saída é exatamente a de antes (família inteira + grupo).
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { familiaDoEmpreendimento } from "@/lib/hercules/quem-pode-vender";

import { comIdsDoGrupo } from "./resumo-do-produto";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** O mínimo do cadastro do Panteon (`hercules_empreendimentos`) que a família precisa. */
export type LinhaDaFamilia = {
  c2xEnterpriseId: null | string;
  id: string;
  paiId: null | string;
};

export type EscopoDaEsteiraDoPortal = {
  /** Os ids que valem para qualquer busca (nome, pedaço de CPF) e para a decisão. */
  abertos: string[];
  /** Os ids que só valem quando quem pergunta já tem o CPF inteiro (o espelho do pai). */
  soComCpfInteiro: string[];
};

/**
 * Os `enterprise_id` de `apolo_esteira` que este portal pode consultar para a unidade `c2xId`.
 *
 * ⚠️ SÓ REDUZ. Nada sai daqui que não esteja na família da unidade; para quem não é comercial, os
 * abertos ainda passam por `permitidos` (a lista de `idsDaSessao`).
 */
export function escopoDaEsteiraDoPortal(entrada: {
  c2xId: string;
  cadastro: readonly LinhaDaFamilia[];
  catalogo: Array<{ id: string; stageIds: string[] }>;
  comercial: boolean;
  permitidos: ReadonlySet<string>;
}): EscopoDaEsteiraDoPortal {
  const permitidos = new Set(entrada.permitidos);
  const familia = familiaDoEmpreendimento([...entrada.cadastro], entrada.c2xId);

  if (entrada.comercial) {
    return { abertos: comIdsDoGrupo(familia, entrada.catalogo, permitidos), soComCpfInteiro: [] };
  }

  const dentro = familia.filter((id) => permitidos.has(String(id).trim()));
  const abertos = comIdsDoGrupo(dentro, entrada.catalogo, permitidos);

  const alvo = String(entrada.c2xId).trim();
  const linha = entrada.cadastro.find((l) => l.c2xEnterpriseId === alvo);
  const pai = linha?.paiId ? entrada.cadastro.find((l) => l.id === linha.paiId) : undefined;
  const espelho = pai?.c2xEnterpriseId ? String(pai.c2xEnterpriseId).trim() : "";

  const soComCpfInteiro =
    espelho && !abertos.includes(espelho) && familia.includes(espelho) ? [espelho] : [];

  return { abertos, soComCpfInteiro };
}

/** O escopo da CAD do TITULAR da reserva: o CPF dele é conhecido, então valem as duas metades. */
export function escopoDoTitular(escopo: EscopoDaEsteiraDoPortal): string[] {
  return [...new Set([...escopo.abertos, ...escopo.soComCpfInteiro])];
}

/** A frase única de "sem CAD" para quem não é o comercial. */
export const SEM_CAD_NO_EMPREENDIMENTO = "Este cliente não tem CAD neste empreendimento.";

/**
 * A resposta de `credenciadoParaVender` como o portal que não é a Careli pode recebê-la.
 *
 * ⚠️ "ESTE CPF NÃO TEM CADASTRO NO APOLO" É UM ORÁCULO. A frase é diferente de "não tem CAD neste
 * empreendimento" e, por isso, diz se o CPF existe em QUALQUER ponto da base da Careli. Para o
 * comercial (a própria Careli) a distinção ajuda; para o Cecílio, as duas viram a mesma frase. O
 * caso é reconhecido pela forma (CPF inteiro, nenhuma entidade, nenhuma etapa), não pelo texto, para
 * não depender da redação da lib.
 */
export function credenciamentoParaOPortal<
  T extends { credenciado: boolean; desde: null | string; entityId: null | string; etapa: null | string; motivo: null | string },
>(credenciamento: T, contexto: { comercial: boolean; cpf: string }): T {
  if (contexto.comercial || credenciamento.credenciado) return credenciamento;
  const digitos = String(contexto.cpf ?? "").replace(/\D/g, "");
  const semEntidade =
    credenciamento.entityId === null && credenciamento.etapa === null && credenciamento.desde === null;
  if (digitos.length === 11 && semEntidade) {
    return { ...credenciamento, motivo: SEM_CAD_NO_EMPREENDIMENTO };
  }
  return credenciamento;
}

/**
 * O recorte de LEITURA com o espelho do pai: quando alguma divisão do recorte é filha de um pai do
 * cadastro do Panteon, o `c2x_enterprise_id` desse pai entra junto.
 *
 * ⚠️ SÓ PARA LEITURA DE QUEM JÁ ESTÁ NO ESCOPO. As CADs do Vale do Ouro moram no 35 (VLO), que é
 * linha própria no catálogo e fica fora de `group:Vale do Ouro`: o portal que alcança só o 37
 * (VOC) nunca tem o 35 em `idsDaSessao`. Sem esta equivalência a CAD em PDF do próprio comprador
 * do VOC sumia do CRM e do board (688 CADs no 35, medido em 16/09/2026). A pessoa já provou estar
 * no escopo por outra porta (a unidade, a CAD no recorte); a pergunta aqui é só "este documento é
 * do mesmo produto?", e o espelho do pai é o mesmo loteamento.
 *
 * ⚠️ NÃO USAR EM ESCRITA NEM EM BUSCA: o espelho é compartilhado entre divisões de donos diferentes
 * (o 36 é do Lino). Para decidir se o portal pode MEXER em algo, o recorte é o cru.
 */
export function recorteComEspelhoDoPai(
  recorte: ReadonlySet<string>,
  cadastro: readonly LinhaDaFamilia[],
  // (16/09/2026, revisão do conjunto) Os empreendimentos da PESSOA (CADs e vínculos). Quando vem, o
  // espelho de um pai só entra se a pessoa tem CAD ou vínculo numa DIVISÃO filha dele que esteja no
  // recorte cru. Ver `recorteDeLeituraDoPortal`.
  daPessoa?: Iterable<string>,
): Set<string> {
  const saida = new Set(recorte);
  const ids = daPessoa ? new Set([...daPessoa].map((id) => String(id).trim())) : null;
  for (const linha of cadastro) {
    if (!linha.paiId || !linha.c2xEnterpriseId) continue;
    const filho = String(linha.c2xEnterpriseId).trim();
    if (!recorte.has(filho)) continue;
    if (ids && !ids.has(filho)) continue;
    const pai = cadastro.find((l) => l.id === linha.paiId);
    const espelho = pai?.c2xEnterpriseId ? String(pai.c2xEnterpriseId).trim() : "";
    if (espelho) saida.add(espelho);
  }
  return saida;
}

/**
 * O recorte de LEITURA de documentos e do histórico de uma pessoa, por tipo de portal.
 *
 * (16/09/2026, revisão do conjunto) ⚠️ NO PORTAL QUE OPERA SOZINHO O ESPELHO DO PAI SÓ ENTRA COM
 * PROVA DA PESSOA. A premissa do espelho era "a pessoa já está no escopo por outra porta". Com a
 * decisão D5 do Lucas (o cadastro pelo portal APROVEITA a ficha da Careli), essa porta ficou trivial:
 * cadastrar no Garden (39) o CPF de um comprador do Vale do Ouro põe a pessoa no escopo, e o espelho
 * (35) somado ao recorte {37, 39, 41} cobria {35, 39}, liberando RG, CAD em PDF, comprovante do
 * Serasa e o histórico da Careli (medido: 710 pessoas com tudo dentro de {35, 37, 39, 41}, com 4.195
 * documentos sem marca). Agora, para o portal que opera sozinho, o 35 só entra quando a pessoa tem
 * CAD ou vínculo numa divisão do Vale do Ouro que está no recorte cru (37 ou 41). Uma CAD num produto
 * sem parentesco (o Garden) nunca abre o espelho.
 *
 * ⚠️ O PREÇO: o comprador do VOC cuja CAD mora só no 35 não mostra os documentos sem marca à Cecílio.
 * O VOC é só consulta para ela (D1), e esconder é o lado seguro. O comercial e os portais padrão
 * seguem com o espelho de sempre (a porta do cadastro que acrescenta é só do portal que opera).
 */
export function recorteDeLeituraDoPortal(entrada: {
  cadastro: readonly LinhaDaFamilia[];
  daPessoa: { esteira: readonly string[]; vinculos: readonly string[] };
  operaSozinho: boolean;
  recorte: ReadonlySet<string>;
}): Set<string> {
  if (!entrada.operaSozinho) return recorteComEspelhoDoPai(entrada.recorte, entrada.cadastro);
  return recorteComEspelhoDoPai(entrada.recorte, entrada.cadastro, [
    ...entrada.daPessoa.esteira,
    ...entrada.daPessoa.vinculos,
  ]);
}

/**
 * Pai, filho e id do C2X de cada empreendimento do cadastro do Panteon, pelo cliente recebido.
 *
 * ⚠️ PAGINADO: o PostgREST corta em 1.000 linhas sem avisar. ⚠️ ERRO LANÇA: sem o cadastro não dá
 * para provar a equivalência, e quem chama decide (a leitura de documentos responde erro, nunca a
 * lista crua).
 */
export async function lerFamiliasDoCadastro(admin: AdminClient): Promise<LinhaDaFamilia[]> {
  const PAGINA = 1000;
  const saida: LinhaDaFamilia[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from("hercules_empreendimentos")
      .select("id, pai_id, c2x_enterprise_id")
      .eq("workspace_id", "careli")
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as Array<{
      c2x_enterprise_id: null | number | string;
      id: string;
      pai_id: null | string;
    }>;
    for (const linha of pagina) {
      saida.push({
        c2xEnterpriseId:
          linha.c2x_enterprise_id === null || linha.c2x_enterprise_id === undefined
            ? null
            : String(linha.c2x_enterprise_id).trim() || null,
        id: linha.id,
        paiId: linha.pai_id ?? null,
      });
    }
    if (pagina.length < PAGINA) break;
  }
  return saida;
}
