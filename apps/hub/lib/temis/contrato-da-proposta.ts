// O CONTRATO DE UMA PROPOSTA — a minuta publicada mais os dados, num HTML só.
//
// ⚠️ ESTE ARQUIVO EXISTE PARA QUE A PRÉVIA E O PDF NÃO POSSAM DIVERGIR. Até 08/09/2026 a montagem
// morava dentro de `/api/temis/contrato/previa`: escolher a minuta, resolver os dados, preencher e
// serializar. Quando a geração do documento entrou (09/09/2026), copiar essas quatro linhas para a
// segunda rota criaria duas verdades sobre o MESMO contrato — e a divergência não apareceria no
// dia em que fosse escrita, e sim meses depois, quando alguém mudasse a regra da minuta em um lugar
// só e o revisor aprovasse na tela um documento diferente do que foi a cartório.
//
// A prévia é a CONFERÊNCIA do papel. Se ela conferisse outro papel, não conferiria nada.
//
// ⚠️ AQUI NÃO SE GRAVA NADA. Montar é leitura pura — é o que permite gerar prévia à vontade
// enquanto se ajusta a minuta. Quem guarda é `contrato-guardado-db.ts`, e ele chama esta função.

import type { SupabaseClient } from "@supabase/supabase-js";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";

import {
  type AnexoDaVenda,
  anexosParaOMotor,
  lerAnexosDaVenda,
} from "./anexos-da-venda";
import {
  type DegrauDoContrato,
  NOME_DO_DEGRAU,
  resolverCadeiaDoContrato,
} from "./cadeia-do-contrato";
import { type IdentidadeDoContrato, identidadeDoContrato } from "./contrato-guardado";
import { dadosDaProposta } from "./dados-do-contrato";
import { documentoParaHtml, type NoDoDocumento } from "./documento-html";
import {
  type EscolhaDaMinuta,
  escolherMinutaDaCadeia,
  fraseDaOrigem,
  minutaFoiHerdada,
} from "./minuta-da-cadeia";
import { type DadosDoContrato, preencherContrato } from "./preencher-contrato";

export type MinutaDoContrato = {
  /** A capa cadastrada nesta minuta. Vazio = o contrato começa no corpo. */
  capaNome: string;
  capaPath: string;
  /**
   * O modelo veio de um degrau ACIMA do mais específico que a venda tinha?
   *
   * ⚠️ É O QUE A TELA DESTACA. No caso normal a linha fica discreta e ninguém precisa ler nada;
   * quando o modelo foi herdado, ela fica em evidência, porque é aí que a herança pode estar
   * errada e é aí que quem emite tem de olhar antes de clicar.
   */
  herdada: boolean;
  id: string;
  nome: string;
  /** O degrau que respondeu: categoria, divisão, empreendimento, pai. */
  origem: DegrauDoContrato | "pedida";
  /** A frase pronta: "modelo herdado do Vale do Ouro". Montada no servidor, de propósito. */
  origemFrase: string;
  /** O nome humano do degrau: "Condomínio", "Vale do Ouro VOL". Nunca um id. */
  rotulo: string;
  versao: null | number;
};

export type ContratoMontado = {
  /**
   * As peças que vão junto com o corpo, na ordem em que entram no PDF.
   *
   * ⚠️ ELAS VÊM PARA A PRÉVIA TAMBÉM, e não só para a geração. A prévia é a CONFERÊNCIA do papel,
   * e ela não mostra páginas de PDF: sem esta lista, quem confere fica cego justamente na peça que
   * o texto promete em cláusula.
   */
  anexos: AnexoDaVenda[];
  /** O que a proposta não tinha, em frases curtas. */
  avisos: string[];
  /** As chaves gerais do preenchimento — nem toda variável mora aqui: ver `identidade`. */
  gerais: Record<string, string>;
  html: string;
  /**
   * Empreendimento, unidade e TITULAR — o que dá nome ao arquivo guardado.
   *
   * ⚠️ MONTADA AQUI porque é aqui que os dois lados existem juntos. O nome do comprador vive em
   * `compradores[0].valores` (uma variável por comprador, dentro do laço) e o resto em `gerais`;
   * quem só tivesse `gerais` geraria um arquivo sem o nome de ninguém.
   */
  identidade: IdentidadeDoContrato;
  /** Os marcadores de montagem que a minuta usou: `capa_contrato`, `anexo_3`. Ver `preencher-contrato`. */
  marcadores: string[];
  minuta: MinutaDoContrato;
  ok: true;
  /** Variáveis que o texto pedia e o dado não respondeu. Saem impressas como `[nome]` no corpo. */
  semValor: string[];
  vezesDoLaco: number;
};

export type FalhaAoMontar = {
  erro: string;
  ok: false;
  status: 404 | 409;
};

/**
 * Monta o contrato desta proposta.
 *
 * `minutaId` força uma minuta específica (ainda precisa estar publicada e servir à proposta); sem
 * ele vale a CADEIA — categoria da unidade, divisão da unidade, empreendimento da proposta, pai.
 */
export async function montarContratoDaProposta(
  sb: SupabaseClient,
  { minutaId = "", propostaId }: { minutaId?: string; propostaId: string },
): Promise<ContratoMontado | FalhaAoMontar> {
  const resolvido = await dadosDaProposta(propostaId, sb);
  if (!resolvido) {
    return { erro: "Proposta não encontrada.", ok: false, status: 404 };
  }

  const gerais = resolvido.dados.gerais;
  const doEmpreendimento = gerais.__empreendimento_id ?? "";
  const daUnidade = gerais.__unidade_enterprise_id ?? "";

  // ⚠️ A CADEIA VEM ANTES DA MINUTA, E ELA SERVE AOS DOIS LADOS. É ela que sabe a categoria do
  // lote, a divisão onde ele mora e o pai da divisão — e é a MESMA travessia que escolhe o modelo
  // e soma os anexos. Duas travessias diferentes fariam o contrato sair com o texto de um degrau e
  // os anexos de outro, que é a dívida que a 0156 nomeia como PAN-070.
  const cadeia = await resolverCadeiaDoContrato(sb, {
    categoriaId: gerais.__unidade_categoria_id ?? "",
    divisaoId: daUnidade,
    empreendimentoId: doEmpreendimento,
    empreendimentoNome: gerais.empreendimento_nome ?? "",
    unidadeId: gerais.__unidade_id ?? "",
  });
  if (!cadeia.ok) return { erro: cadeia.erro, ok: false, status: 409 };

  // ⚠️ DOIS CAMINHOS PARA O MESMO ID, e o segundo salvou o primeiro teste real. A minuta é indexada
  // por `enterprise_id` (o id do C2X), e três empreendimentos do Hércules — LOX, PDX e RDX — têm
  // esse campo NULO: para eles a busca ia com string vazia e NENHUMA minuta seria achada nunca. A
  // unidade guarda o mesmo id na sua própria coluna, e ela costuma estar preenchida quando a do
  // empreendimento não está, porque veio de outra carga. Na cadeia isso deixou de ser remendo: a
  // divisão da unidade é um degrau de verdade, e vem ANTES.
  const escolha = minutaId
    ? await minutaPedida(sb, { empreendimentoId: doEmpreendimento || daUnidade, pedida: minutaId })
    : await escolherMinutaDaCadeia(sb, cadeia.cadeia);

  if (!escolha.ok) return { erro: escolha.erro, ok: false, status: 409 };

  if (!escolha.minuta) {
    // ⚠️ A MENSAGEM DIZ ONDE ELE PROCUROU, E AGORA SÃO VÁRIOS LUGARES. "Não há minuta publicada"
    // era verdadeiro para causas MUITO diferentes — a minuta não existe, ou a proposta não sabe a
    // que empreendimento pertence — e mandar publicar de novo uma minuta que JÁ ESTÁ publicada é o
    // caminho mais curto para alguém achar que o sistema está quebrado. Foi o que aconteceu no
    // primeiro teste, em 08/09/2026: a minuta do Veredas estava publicada e a tela mandou publicar.
    // Com a cadeia, dizer só o empreendimento da proposta esconderia que a divisão do lote também
    // foi consultada — e é lá que o jurídico costuma ter publicado.
    const procurados = cadeia.cadeia.niveis
      .filter((n) => n.degrau !== "unidade")
      .map((n) => `${NOME_DO_DEGRAU[n.degrau]} ${n.rotulo}`);
    const causa =
      procurados.length > 0
        ? `Procurei minuta publicada do tipo "contrato" em ${listar(procurados)} e não achei nenhuma. Publique a minuta na Têmis e tente de novo.`
        : "O empreendimento desta proposta não tem o código que liga às minutas (é o caso de LOX, PDX e RDX) e a unidade também não. Sem ele não há por onde procurar — e não adianta publicar de novo.";
    return { erro: `Não consegui montar o contrato. ${causa}`, ok: false, status: 409 };
  }

  const minuta = escolha.minuta;
  const conteudo = Array.isArray(minuta.conteudo) ? (minuta.conteudo as NoDoDocumento[]) : [];
  if (conteudo.length === 0) {
    return { erro: "A minuta publicada está vazia.", ok: false, status: 409 };
  }

  // ⚠️ OS ANEXOS SOMAM OS NÍVEIS, e é aqui que eles chegam ao motor pela primeira vez. `dados.anexos`
  // existia no tipo desde 07/09/2026 e NUNCA era preenchido em produção: o bloco
  // `[inicio_tem_anexo_1]` da minuta publicada do VOL v6 era removido em silêncio, sem entrar em
  // `semValor` e sem aviso na prévia. Ver `anexos-da-venda.ts`.
  const somados = await lerAnexosDaVenda(sb, cadeia.cadeia);
  if (!somados.ok) return { erro: somados.erro, ok: false, status: 409 };

  const dados: DadosDoContrato =
    somados.anexos.length > 0
      ? { ...resolvido.dados, anexos: anexosParaOMotor(somados.anexos) }
      : resolvido.dados;

  const preenchido = preencherContrato(conteudo, dados);

  // ⚠️ O TITULAR É O PRIMEIRO COMPRADOR, pela ordem do contrato (ver `DadosDoContrato.compradores`:
  // *"na ordem do contrato. O primeiro é o titular"*). Com dois compradores o arquivo leva o nome de
  // um só — de propósito: o nome existe para achar o papel, e "João e mais 1" já é o suficiente
  // para isso sem estourar o limite da coluna.
  const titular = resolvido.dados.compradores[0]?.valores.nome_cliente ?? "";

  return {
    anexos: somados.anexos,
    // ⚠️ O QUE A CADEIA DEIXOU DE FORA VIAJA JUNTO COM O QUE O CADASTRO DEIXOU EM BRANCO. São a
    // mesma coisa para quem confere: um recado que precisa ser lido antes de o papel ir para a
    // assinatura. Ver `resolverCadeiaDoContrato`.
    avisos: [...resolvido.avisos, ...(cadeia.cadeia.avisos ?? [])],
    gerais: resolvido.dados.gerais,
    // ⚠️ UM SERIALIZADOR SÓ, e é esta linha que a prévia e o PDF compartilham. Ver o topo.
    html: documentoParaHtml(preenchido.nos),
    identidade: identidadeDoContrato(resolvido.dados.gerais, titular),
    marcadores: preenchido.marcadores,
    minuta: {
      capaNome: minuta.capaNome,
      capaPath: minuta.capaPath,
      herdada: minutaFoiHerdada(cadeia.cadeia, minuta),
      id: minuta.id,
      nome: minuta.nome,
      origem: minuta.origem,
      origemFrase: fraseDaOrigem(minuta),
      rotulo: minuta.rotulo,
      versao: minuta.versao,
    },
    ok: true,
    semValor: preenchido.semValor,
    vezesDoLaco: preenchido.vezesDoLaco,
  };
}

function listar(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * A minuta que alguém PEDIU pelo id — o caminho que nenhuma tela usa, e que por isso precisa de
 * trava própria.
 *
 * ⚠️ SÓ PUBLICADA. Rascunho é trabalho em andamento: gerar contrato de rascunho é como imprimir um
 * documento que alguém ainda está escrevendo — e a `temis_minutas` tem a checagem que só exige
 * `conteudo_html` quando a situação é `publicada`, justamente porque publicar é o ato de dizer "esta
 * pode ser usada".
 *
 * ⚠️ E A CADEIA NÃO SUBSTITUI ESTA CONFERÊNCIA. A cadeia decide qual minuta VALE quando ninguém
 * pediu nenhuma; quando alguém pede, o que importa é se aquela minuta SERVE à proposta — e a régua
 * disso é `empreendimentosQueServem`, que é mais larga (inclui o consolidado do catálogo) e existe
 * para fechar um vazamento, não para escolher modelo.
 */
async function minutaPedida(
  sb: SupabaseClient,
  { empreendimentoId, pedida }: { empreendimentoId: string; pedida: string },
): Promise<EscolhaDaMinuta> {
  // ⚠️ PRIMEIRO O DONO DA MINUTA, DEPOIS O TEXTO. O id vem do corpo do pedido, e até 16/09/2026
  // qualquer minuta publicada servia para qualquer proposta: bastava trocar o `minutaId` para
  // imprimir o contrato de um loteamento com o modelo (e as cláusulas) de outro. A conferência
  // vem ANTES de o conteúdo sair do banco, na mesma disciplina de `unidadeNoEscopo`.
  const { data: cabecalho } = await sb
    .from("temis_minutas")
    .select("id, enterprise_id, situacao")
    .eq("id", pedida)
    .maybeSingle();
  const dona = cabecalho as null | { enterprise_id: null | string; id: string; situacao: string };

  // ⚠️ A MINUTA PEDIDA TAMBÉM PRECISA ESTAR PUBLICADA. Aceitar um id de rascunho pela porta dos
  // fundos derrubaria a regra inteira.
  if (!dona || dona.situacao !== "publicada") return { minuta: null, ok: true };

  // ⚠️ E ELA PRECISA SERVIR A ESTA PROPOSTA: ser do empreendimento dela, do PAI dela no cadastro
  // do Panteon (VOC 37 → VLO 35) ou do CONSOLIDADO do catálogo (LBF 33 → `group:Lagoa Bonita`). É
  // correção de vazamento, e vale para o hub também: nenhuma tela manda `minutaId` na prévia nem
  // na geração (medido em 16/09/2026), então o único caminho que isto fecha é o de quem chama a
  // rota direto. Proposta sem empreendimento não tem a quem pertencer, e fica sem minuta pedida.
  const servem = await empreendimentosQueServem(sb, empreendimentoId);
  if (!servem.has(String(dona.enterprise_id ?? "").trim())) {
    console.warn(
      `[temis][contrato] minuta ${dona.id} recusada: é do empreendimento ${dona.enterprise_id ?? "(nenhum)"} e a proposta é do ${empreendimentoId || "(nenhum)"}.`,
    );
    return { minuta: null, ok: true };
  }

  const { data } = await sb
    .from("temis_minutas")
    .select("capa_nome, capa_path, id, nome, versao, conteudo, situacao")
    .eq("id", dona.id)
    .maybeSingle();
  const linha = data as null | {
    capa_nome: null | string;
    capa_path: null | string;
    conteudo: unknown;
    id: string;
    nome: null | string;
    situacao: string;
    versao: null | number;
  };
  if (!linha || linha.situacao !== "publicada") return { minuta: null, ok: true };

  return {
    minuta: {
      capaNome: String(linha.capa_nome ?? "").trim(),
      capaPath: String(linha.capa_path ?? "").trim(),
      conteudo: linha.conteudo,
      id: linha.id,
      nome: String(linha.nome ?? "").trim(),
      origem: "pedida",
      rotulo: "escolha manual",
      versao: typeof linha.versao === "number" ? linha.versao : null,
    },
    ok: true,
  };
}

/**
 * Os `enterprise_id` cujas minutas servem a um empreendimento: ele mesmo, o pai dele no cadastro
 * do Panteon e o consolidado do catálogo que o contém.
 *
 * ⚠️ É A CHAVE DE VÍNCULO DA TÊMIS, E ELA TEM TRÊS FORMATOS VIVOS: o id do C2X da divisão ("37"), o
 * do pai que responde pelo conjunto ("35") e o rótulo do consolidado (`group:Lagoa Bonita`, que não
 * é id de tabela nenhuma — ver `/api/temis/empreendimentos`). Comparar só o primeiro recusaria a
 * minuta que o jurídico gravou no conjunto, e em silêncio.
 *
 * ⚠️ SÓ SOBE, NUNCA DESCE. A divisão enxerga a minuta do pai; o pai NÃO enxerga a de uma divisão
 * (VOL e VOC são de donos diferentes). É a mesma assimetria de `idsDaSessao`.
 *
 * ⚠️ FALHA DE LEITURA ENCOLHE A LISTA, NUNCA A ALARGA. Sem o cadastro ou sem o catálogo do C2X,
 * vale só o próprio empreendimento: a minuta do pai fica recusada até a leitura voltar, que é o
 * lado barato de errar (um 409 com a frase do que procurou, e não o modelo de outro loteamento).
 */
async function empreendimentosQueServem(
  sb: SupabaseClient,
  empreendimentoId: string,
): Promise<Set<string>> {
  const base = String(empreendimentoId ?? "").trim();
  const servem = new Set<string>();
  if (!base) return servem;
  servem.add(base);

  const pais: string[] = [];
  try {
    const { data: filhos, error } = await sb
      .from("hercules_empreendimentos")
      .select("pai_id")
      .eq("workspace_id", "careli")
      .eq("c2x_enterprise_id", base)
      .limit(50);
    if (error) throw error;

    const paiIds = [
      ...new Set(
        ((filhos ?? []) as Array<{ pai_id: null | string }>)
          .map((l) => String(l.pai_id ?? "").trim())
          .filter(Boolean),
      ),
    ];

    if (paiIds.length > 0) {
      const { data: doPai, error: erroDoPai } = await sb
        .from("hercules_empreendimentos")
        .select("c2x_enterprise_id")
        .eq("workspace_id", "careli")
        .in("id", paiIds);
      if (erroDoPai) throw erroDoPai;
      for (const l of (doPai ?? []) as Array<{ c2x_enterprise_id: null | string }>) {
        const id = String(l.c2x_enterprise_id ?? "").trim();
        if (id) pais.push(id);
      }
    }
  } catch (erro) {
    console.error("[temis][contrato] falha ao ler o pai do empreendimento da proposta", erro);
  }
  for (const id of pais) servem.add(id);

  try {
    const catalogo = await catalogoDeEmpreendimentos(Date.now());
    const doConjunto = new Set([base, ...pais]);
    for (const emp of catalogo) {
      if (emp.stageIds.some((stageId) => doConjunto.has(String(stageId).trim()))) {
        servem.add(emp.id);
      }
    }
  } catch (erro) {
    console.error("[temis][contrato] falha ao ler o catálogo para achar o consolidado", erro);
  }

  return servem;
}
