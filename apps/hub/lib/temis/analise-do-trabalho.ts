// A ETAPA 1 DA TELA DE TRABALHO — o que o operador confere antes de abrir o contrato.
//
// Lucas (09/09/2026): *"na primeira etapa, acho que deveria trazer os dados dos proponentes,
// imobiliaria, a proposta"*.
//
// ⚠️ LEITURA PURA, E REUSA O QUE JÁ MONTA O CONTRATO. `dadosDaProposta` é a mesma função que
// alimenta a geração do documento (`lib/temis/dados-do-contrato.ts`) — ela lê seis tabelas do
// Apolo e quatro do Hércules e devolve os valores já formatados para papel. Montar aqui uma
// segunda leitura dos mesmos dados criaria duas versões da verdade: a tela diria uma coisa e o
// contrato sairia com outra, e a divergência só apareceria no papel assinado.
//
// ⚠️ E NÃO PASSA PELA MINUTA. `montarContratoDaProposta` é a camada acima, que exige minuta
// publicada e responde 409 sem ela. A etapa 1 tem de funcionar ANTES de existir minuta: é
// justamente onde se descobre que falta uma.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ComercialDaAnalise } from "./comercial-da-analise";

import { comercialDaProposta } from "./comercial-da-analise";
import { dadosDaProposta } from "./dados-do-contrato";

/** Um campo como a tela mostra: rótulo humano, valor, e se está faltando. */
export type CampoDaAnalise = {
  /** `true` quando o dado não existe no cadastro. A tela pinta como pendência. */
  faltando: boolean;
  rotulo: string;
  valor: string;
};

export type ProponenteDaAnalise = {
  campos: CampoDaAnalise[];
  conjuge: CampoDaAnalise[] | null;
  /** O nome no topo do bloco. "Sem nome" quando o cadastro não tem. */
  nome: string;
};

export type AnaliseDoTrabalho = {
  /** Os avisos que `dadosDaProposta` já produz — lacunas que impedem o contrato. */
  avisos: string[];
  /**
   * A proposta comercial: os números grandes e o fluxo de pagamento combinado.
   *
   * `null` quando a proposta não tem cronograma gravado — as 4.857 importadas do C2X nasceram sem
   * `condicoes`. A tela diz isso, em vez de desenhar uma tabela de zeros.
   */
  comercial: ComercialDaAnalise | null;
  imobiliaria: CampoDaAnalise[];
  proponentes: ProponenteDaAnalise[];
  /**
   * O dinheiro combinado em texto — RESERVA de `comercial`, e não um segundo lugar para o mesmo
   * número. A tela mostra este bloco só quando `comercial` é `null` (proposta importada, sem
   * cronograma gravado): sem ele, essas vendas ficariam sem valor nenhum na tela.
   */
  proposta: CampoDaAnalise[];
  /** Onde é: empreendimento, quadra, lote, área e matrícula. Independe do cronograma. */
  unidade: CampoDaAnalise[];
};

/**
 * ⚠️ CHAVE AUSENTE É PENDÊNCIA, E NÃO CAMPO VAZIO. `dadosDaProposta` segue a regra "chave sem
 * valor não entra" — não há string vazia, há chave que não existe. Renderizar isso como campo em
 * branco esconderia a falta; a etapa 1 existe para MOSTRAR o que falta, então a ausência vira uma
 * linha marcada, com o rótulo do que deveria estar ali.
 */
function campo(
  valores: Record<string, string>,
  chave: string,
  rotulo: string,
): CampoDaAnalise {
  const valor = String(valores[chave] ?? "").trim();
  return { faltando: !valor, rotulo, valor: valor || "não informado" };
}

/** Pessoa física e jurídica têm qualificações diferentes; o bloco segue a flag do dado. */
function camposDoProponente(comprador: {
  ehPessoaFisica: boolean;
  valores: Record<string, string>;
}): CampoDaAnalise[] {
  const v = comprador.valores;

  if (!comprador.ehPessoaFisica) {
    return [
      campo(v, "razao_social_cliente", "Razão social"),
      campo(v, "nome_fantasia_cliente", "Nome fantasia"),
      campo(v, "cnpj_cliente", "CNPJ"),
      campo(v, "email_cliente", "E-mail"),
      campo(v, "rua_cliente", "Rua"),
      campo(v, "numero_cliente", "Número"),
      campo(v, "bairro_cliente", "Bairro"),
      campo(v, "cep_cliente", "CEP"),
      campo(v, "percentual_cliente", "Participação"),
    ];
  }

  return [
    campo(v, "cpf_cliente", "CPF"),
    // ⚠️ NÃO trocar por `identificacao_cliente`: aquela chave é o PAPEL na venda, e sai como
    // o literal "COMPRADOR" para todo mundo (dados-do-contrato.ts, `por("identificacao_cliente",
    // "COMPRADOR")`). O RG é este, montado como "número + órgão" — e só quando o número existe,
    // porque o órgão sozinho imprimia "cédula de identidade nº SSP/MG".
    campo(v, "rg_cliente", "RG"),
    campo(v, "data_nascimento_cliente", "Nascimento"),
    campo(v, "estado_civil_cliente", "Estado civil"),
    campo(v, "regime_casamento_cliente", "Regime de bens"),
    campo(v, "nacionalidade_cliente", "Nacionalidade"),
    campo(v, "email_cliente", "E-mail"),
    campo(v, "telefone_cliente", "Telefone"),
    campo(v, "rua_cliente", "Rua"),
    campo(v, "numero_cliente", "Número"),
    campo(v, "bairro_cliente", "Bairro"),
    campo(v, "cep_cliente", "CEP"),
    campo(v, "percentual_cliente", "Participação"),
  ];
}

/**
 * ⚠️ O CÔNJUGE SÓ APARECE QUANDO EXISTE, e `temConjuge` é quem decide — não a presença do nome.
 * A distinção importa: `ehCasado` indefinido NÃO é "não casado" (a regra está em
 * `preencher-contrato.ts`), e um bloco de cônjuge vazio num contrato de solteiro é exatamente o
 * tipo de campo que alguém preenche à mão sem perceber.
 */
function camposDoConjuge(comprador: {
  temConjuge: boolean;
  valores: Record<string, string>;
}): CampoDaAnalise[] | null {
  if (!comprador.temConjuge) return null;
  const v = comprador.valores;
  return [
    campo(v, "nome_conjuge", "Nome"),
    campo(v, "cpf_conjuge", "CPF"),
    campo(v, "email_conjuge", "E-mail"),
    campo(v, "telefone_conjuge", "Telefone"),
    campo(v, "profissao_conjuge", "Profissão"),
    campo(v, "nacionalidade_conjuge", "Nacionalidade"),
  ];
}

/**
 * Os três blocos da etapa 1, prontos para a tela.
 *
 * `null` quando a proposta não existe — o card sem `proposta_id` (os antigos, nascidos antes da
 * migration 0134) cai aqui, e a tela mostra "sem venda ligada" em vez de blocos vazios.
 */
export async function analiseDoTrabalho(
  sb: SupabaseClient,
  propostaId: string,
): Promise<AnaliseDoTrabalho | null> {
  const montado = await dadosDaProposta(propostaId, sb);
  if (!montado) return null;

  const { avisos, dados } = montado;
  const g = dados.gerais;

  // ⚠️ EM PARALELO NÃO, DE PROPÓSITO — `dadosDaProposta` já decidiu se a proposta existe. Buscar o
  // comercial antes disso gastaria duas consultas em todo card sem venda ligada.
  const comercial = await comercialDaProposta(sb, propostaId);

  return {
    avisos,
    comercial,
    // ⚠️ SEM COMISSÃO AQUI. `gerais` traz `percentual_comissao_*` e `valor_total_comissao`, que
    // são política comercial — a etapa 1 confere QUEM vendeu, não QUANTO se paga a quem.
    imobiliaria: [
      campo(g, "imobiliaria_nome", "Imobiliária"),
      campo(g, "corretor_nome", "Corretor"),
      // ⚠️ A COORDENADORA É DO EMPREENDIMENTO, NÃO DA PROPOSTA. Ela vem de
      // `apolo_enterprise_settings.coordenadora_entity_id` (migration 0145) e é a terceira ponta
      // do processo de venda: coordena a imobiliária, recebe a sua parte da comissão e entra no
      // contrato como interveniente, com CNPJ e endereço próprios (bloco "a." da minuta).
      //
      // ⚠️ E É A MESMA CHAVE QUE O CONTRATO IMPRIME. Ler daqui garante que a tela e o papel
      // dizem o mesmo nome; um segundo caminho até a coordenadora seria uma segunda verdade.
      campo(g, "nome_fantasia_coordenadora_vendas", "Coordenadora"),
    ],
    proponentes: dados.compradores.map((c) => ({
      campos: camposDoProponente(c),
      conjuge: camposDoConjuge(c),
      nome: String(c.valores.nome_cliente ?? c.valores.razao_social_cliente ?? "").trim() || "Sem nome",
    })),
    proposta: [
      campo(g, "preco_venda", "Valor da venda"),
      campo(g, "plano_nome", "Plano"),
      campo(g, "valor_entrada", "Entrada"),
      campo(g, "valor_divida_financiada", "A financiar"),
      campo(g, "prazo_meses_amortizacao", "Parcelas"),
      campo(g, "dia_vencimento", "Vencimento"),
    ],
    unidade: [
      campo(g, "empreendimento_nome", "Empreendimento"),
      campo(g, "unidade_quadra", "Quadra"),
      campo(g, "unidade_lote", "Lote"),
      campo(g, "area_lote", "Área"),
      campo(g, "numero_matricula", "Matrícula"),
    ],
  };
}
