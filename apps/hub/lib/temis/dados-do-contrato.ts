// DA PROPOSTA GRAVADA PARA O MOTOR DO CONTRATO — quem responde "de onde sai cada variável".
//
// `preencher-contrato.ts` sabe SUBSTITUIR, e não sabe de banco nenhum: ele recebe um
// `DadosDoContrato` pronto e devolve o documento. Este arquivo é o outro lado — lê a proposta e
// monta esse objeto. Os dois juntos são o "gerar contrato pela minuta" que até 08/09/2026 era uma
// caixinha marcada à mão no board da Têmis.
//
// ⚠️ A LEITURA É A PARTE DIFÍCIL, E O COMPRADOR É O PIOR PEDAÇO DELA. A proposta guarda CPF e nome;
// a qualificação que o contrato imprime ("brasileiro, casado sob comunhão parcial, engenheiro,
// portador do RG…, residente à…") está espalhada por SEIS lugares do Apolo, e cada um deles pode
// estar vazio sem que nada acuse:
//
//     apolo_entities        nome, razão social, CNPJ/CPF, se é PF ou PJ
//     apolo_esteira.ficha   nacionalidade, estado civil, regime, profissão, RG, nascimento
//     apolo_addresses       o endereço de quem foi cadastrado pelo wizard e nunca editado
//     apolo_contacts        e-mail e telefone, idem
//     apolo_relationships   o cônjuge, idem — e SÓ o vínculo vivo (ver `camadasDoCadastro`)
//     hercules_propostas    a participação de cada um, e o telefone do comprador não titular
//
// ⚠️ O JSONB DA PROPOSTA TEM DUAS GRAFIAS, e é a armadilha desta leitura: a proposta nativa grava
// `cpf`/`participacao`, e as 4.857 importadas do C2X gravam `documento`/`percentual`. Ver a nota de
// `CompradorDaProposta` — ler uma grafia só não devolve lista vazia, devolve um comprador com nome
// e sem documento, e a qualificação inteira sai em branco sem que a reserva do titular dispare.
//
// ⚠️ A FICHA É A CAMADA DE CIMA, NÃO A ÚNICA — e um resolvedor que lesse só ela perderia o endereço
// de quase todo mundo. Medido em `cadastro-cascata.ts`: só 10 das 343 CADs do lançamento têm linha
// em `apolo_addresses`… e as outras 333 têm o endereço SOLTO NA FICHA, porque a ficha só recebe o
// que alguém editou depois. Nos dois sentidos o mesmo erro: quem lê uma fonte só perde a outra
// metade das pessoas. Por isso o casamento é campo a campo, com a ficha ganhando, e é REUSADO de
// `unirEndereco`/`unirConjuge` — a mesma regra que a CAD assinada e o envio ao C2X já seguem. Uma
// segunda versão dessa precedência aqui seria o contrato divergindo do papel que o cliente assinou.
//
// ⚠️ E OS `*Id` DA FICHA SÃO NÚMEROS. `estadoCivilId: "2"` impresso no contrato é o defeito perfeito:
// ninguém vê na tela, todo mundo vê no papel. A tradução para rótulo é obrigatória e mora em
// `c2x-fields.ts` / `c2x-professions.ts` — o nome dos arquivos é herança do vocabulário, não
// dependência do legado.
//
// ⚠️ O QUE NÃO EXISTE NÃO ENTRA. A regra de `preencherContrato` é que a variável sem valor VOLTA a
// aparecer como `[nome_cliente]` no papel, o que salta aos olhos de quem confere; uma string vazia,
// não. Então aqui: ou a chave tem valor de verdade, ou ela não é escrita. Nunca `""`.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  C2X_ESTADO_CIVIL,
  C2X_REGIME_BENS,
  type C2xOption,
  formatDateBR,
} from "@/lib/apolo/c2x-fields";
import { C2X_PROFISSOES } from "@/lib/apolo/c2x-professions";
import { type EnderecoDaFicha, unirConjuge, unirEndereco } from "@/lib/apolo/cadastro-cascata";
import { type CarteiraDaVenda, carteiraDaVendaImportada } from "@/lib/apolo/carteira-da-venda";
import { formatarDocumento, soDigitos } from "@/lib/apolo/documento";
import type { FatosApurados } from "@/lib/hercules/fatos-do-contrato";
import { lerFatosDoContrato } from "@/lib/hercules/fatos-do-contrato-server";
import { lerComColunasDoApartamento } from "@/lib/hercules/nome-da-unidade";

import {
  areaPorExtenso,
  dinheiroPorExtenso,
  inteiroPorExtenso,
  quantidadePorExtenso,
} from "./por-extenso";
import type { DadosDoComprador, DadosDoContrato } from "./preencher-contrato";
import { tabelaGeralDePagamentos } from "./tabela-de-pagamentos";

// ── AS LINHAS COMO ELAS CHEGAM ───────────────────────────────────────────────

type LinhaDaProposta = {
  /**
   * O usuário do C2X do titular — a PONTE EXATA entre a venda importada e a ficha do Apolo. É o
   * mesmo número que a CAD pública grava em `metadata.c2xUserId` e que o espelho do C2X carrega em
   * `apolo_source_links` (`c2x/users/<id>`). Ver `ordenarFichas`.
   */
  cliente_c2x_id?: null | number | string;
  cliente_documento: null | string;
  /**
   * A entidade que a proposta NATIVA aponta (a ficha da CAD do titular). Nula nas importadas.
   *
   * ⚠️ ELA NÃO ERA LIDA, e é por isso que 3 dos 4 contratos nativos em análise em 18/09/2026 saíam
   * com a ficha errada: o casamento era só por documento, e o espelho do C2X (status `active`) ganhava
   * da CAD (status `review`) pela ordem alfabética do status.
   */
  cliente_entity_id?: null | string;
  cliente_nome: null | string;
  compradores: unknown;
  condicoes: unknown;
  /** ⚠️ Nomes DESNORMALIZADOS — são o que as 4.857 propostas importadas têm. Ver a nota da corretagem. */
  corretor_entity_id: null | string;
  corretor_nome: null | string;
  imobiliaria_entity_id: null | string;
  imobiliaria_nome: null | string;
  /**
   * O PRAZO CONTRATADO — o único número de parcelas que é desta venda.
   *
   * ⚠️ NÃO É `plano_parcelas`. Aquele é o tamanho do MOLDE (o produto de onde a proposta saiu) e
   * escrevê-lo no contrato repete o erro que estampou "144x" no extrato de um contrato de 62
   * parcelas. E é por isto que ele está aqui e não só em `condicoes.mensais`: nas 4.857 propostas
   * importadas do C2X a coluna `condicoes` é NULA, e sem esta o prazo do contrato ficaria em branco
   * em todas elas.
   */
  contrato_parcelas: null | number | string;
  /** As três datas que `apurarFatosDoContrato` lê — só usadas quando a carteira da venda está vazia. */
  data_assinatura?: null | string;
  data_ato?: null | string;
  data_faturamento?: null | string;
  dia_vencimento: null | number | string;
  empreendimento_id: null | string;
  /** O estágio da venda no C2X, na carga. Reserva do estágio da carteira do Apolo. */
  etapa_c2x?: null | number | string;
  /**
   * A imobiliária da venda no C2X. Casa com `apolo_source_links` (`c2x/users/<id>`) e é o que traz
   * CNPJ, telefone e e-mail da imobiliária para a venda importada, que não guarda
   * `imobiliaria_entity_id`. Medido em 18/09/2026: as 2.611 importadas abertas sem corretor têm o link.
   */
  imobiliaria_c2x_id?: null | number | string;
  /** `acquisition_requests.id` da venda importada. Nula na nativa. É a chave da carteira do Apolo. */
  origem_c2x_id?: null | number | string;
  plano_nome: null | string;
  plano_parcelas?: null | number | string;
  unidade_id: null | string;
  valor: null | number | string;
};

type LinhaDaUnidade = {
  /** Só no prédio (0171). 0 = térreo, negativo = subsolo. Ausente sem a migration. */
  andar?: null | number | string;
  /** Só no prédio (0171). É ELA que diz que a unidade é apartamento. Ausente sem a migration. */
  apartamento?: null | string;
  area: null | number | string;
  area_extenso: null | string;
  /**
   * O recorte comercial do lote (`temis_categorias`, migration 0139). Nulo na maioria: 907 das
   * 5.541 unidades estão carimbadas, todas do Lagoa Bonita (medido em 21/09/2026).
   *
   * ⚠️ ELE É O PRIMEIRO DEGRAU DA CADEIA DO CONTRATO. É por ele que a categoria pode ter minuta
   * própria e anexos próprios — ver `cadeia-do-contrato.ts`. Até 21/09/2026 esta coluna não saía
   * do banco, e por isso a categoria simplesmente NÃO EXISTIA para o motor do contrato.
   *
   * ⚠️ E A CATEGORIA MORA NO PAI. As duas categorias com lote estão cadastradas no 31 (LAB) e
   * carimbam unidades de quatro produtos (27, 31, 32, 33): a unidade do FILHO aponta para a
   * categoria do PAI, de propósito, e nada no banco exige que os dois `enterprise_id` batam.
   */
  categoria_id: null | string;
  codigo: null | string;
  /** O id do C2X, o MESMO que `temis_minutas.enterprise_id` usa. Ver a nota em `__unidade_enterprise_id`. */
  enterprise_id: null | string;
  lote: null | string;
  matricula: null | string;
  matricula_livro: null | string;
  preco_extenso: null | string;
  preco_tabela: null | number | string;
  quadra: null | string;
  tipo_unidade: null | string;
  /** Só no prédio (0171). */
  tipologia?: null | string;
  /** Só no prédio (0171). Nula = prédio de torre única. */
  torre?: null | string;
  /** Só no prédio (0171). 0 = sem vaga. */
  vagas?: null | number | string;
};

type LinhaDoEmpreendimento = {
  c2x_enterprise_id: null | string;
  cidade: null | string;
  codigo: null | string;
  id?: null | string;
  nome: null | string;
  /** O pai no cadastro do Panteon (VOC → VLO). Nulo no pai e no empreendimento sem divisão. */
  pai_id?: null | string;
  uf: null | string;
};

type LinhaDaEntidade = {
  created_at?: null | string;
  display_name: null | string;
  /** ⚠️ `metadata.cadastro` é a TERCEIRA camada do cadastro. Ver `cadastroDaEntidade`. */
  metadata?: unknown;
  /** `active` / `review` / `archived`. O merge do Apolo arquiva a duplicada e esvazia. */
  status?: null | string;
  document_masked: null | string;
  entity_kind: null | string;
  id: string;
  legal_name: null | string;
  trade_name: null | string;
};

/**
 * As duas comissões e a coordenadora do empreendimento (`apolo_enterprise_settings`, migration 0145).
 *
 * ⚠️ OS PERCENTUAIS SÃO SOBRE O VALOR VENDIDO, E NÃO SOBRE A COMISSÃO. É a decisão do Lucas em
 * 08/09/2026 — *"vou apontar e vc tira esse valor do valor total vendido"* — e é o que faz o total
 * do contrato ser a SOMA das duas pontas, exatamente como o texto da minuta afirma: o total "refere-se
 * à intermediação", uma parte vai "à COORDENADORA DE VENDAS" e o resto "aos ASSOCIADOS".
 *
 * ⚠️ E ISTO É PALIATIVO ATÉ JANEIRO, palavra do Lucas. O rateio de verdade mora no C2X
 * (`split_enterprise_groups` → `split_enterprise_group_values`: quatro grupos, seis perfis) e vem com
 * a migração do financeiro. Duas colunas não o substituem — elas resolvem o contrato de corretagem.
 */
type LinhaDaComissao = {
  comissao_coordenadora_percentual: null | number | string;
  comissao_imobiliaria_percentual: null | number | string;
  coordenadora_entity_id: null | string;
};

/** Os nove campos do bloco "a. COORDENADORA DE VENDAS", já prontos para o papel. */
type CadastroDaCoordenadora = {
  bairro: string;
  cep: string;
  /** "Belo Horizonte/MG" — cidade e UF juntas, como o catálogo declara. */
  cidade: string;
  documento: string;
  email: string;
  nome: string;
  numero: string;
  /**
   * A RAZÃO SOCIAL, que é o nome que obriga.
   *
   * ⚠️ NÃO É O `nome`. Aquele é o FANTASIA ("GURGEL LANÇAMENTOS"), e foi ele que saiu na linha de
   * beneficiário do contrato de corretagem — Lucas, 20/09/2026: *"O nome da Gurgel está
   * incompleto"*. Medido no mesmo dia: a ficha tem fantasia "GURGEL LANÇAMENTOS" e razão social
   * "FABRICIO GURGEL NEGOCIOS IMOBILIARIOS LTDA". Quem assina e recebe é a razão social.
   */
  razaoSocial: string;
  rua: string;
  telefone: string;
};

/** O que a política comercial do empreendimento respondeu sobre a corretagem desta venda. */
type ComissaoDaVenda = {
  coordenadora: CadastroDaCoordenadora | null;
  percentuais: LinhaDaComissao | null;
};

type LinhaDaEsteira = {
  /** O nome do corretor em texto, como a CAD gravou. Reserva do nome da entidade. */
  corretor?: null | string;
  /** Quem mandou a CAD. É o corretor da venda importada, que a carga do C2X não trouxe. */
  corretor_entity_id?: null | string;
  enterprise_id: null | string;
  entity_id: string;
  ficha: unknown;
  imobiliaria?: null | string;
  imobiliaria_entity_id?: null | string;
};

type LinhaDoEndereco = {
  city: null | string;
  complement: null | string;
  district: null | string;
  entity_id: string;
  number: null | string;
  postal_code: null | string;
  state: null | string;
  street: null | string;
};

type LinhaDoContato = { contact_type: null | string; entity_id: string; value: null | string };

type LinhaDoRelacionamento = {
  entity_id: string;
  label: null | string;
  metadata: null | Record<string, unknown>;
  /** `active` / `verified` nos vivos, `archived` no que foi desfeito. Ver `camadasDoCadastro`. */
  status: null | string;
};

/**
 * O comprador como a proposta o guarda (`compradores`, jsonb).
 *
 * ⚠️ `participacao` É PERCENTUAL, NÃO FRAÇÃO — 60 é sessenta por cento, e está escrito assim em
 * `lib/hercules/proposta.ts`. Dividir por 100 aqui imprimiria "0,6%" no contrato.
 *
 * ⚠️ O MESMO JSONB TEM DUAS GRAFIAS, E A SEGUNDA É A DA MAIORIA. A proposta NATIVA grava
 * `{ cpf, nome, participacao, telefone, titular }` (a rota `/api/incorporador/venda/proposta`); as
 * 4.857 propostas IMPORTADAS do C2X gravam `{ c2x_user_id, documento, nome, percentual, titular }`
 * (`scripts/hercules/importar-fluxo-de-venda.mjs`). Ler só a primeira não devolve lista vazia — ela
 * devolve um comprador COM NOME e SEM DOCUMENTO, que é pior: o `.in()` de `apolo_entities` não roda,
 * a qualificação inteira sai em branco, todo comprador de proposta antiga vira "sem cadastro no
 * Apolo para este CPF", e uma compradora PJ é tratada como pessoa física (o bloco `_pj` some do
 * contrato). E a reserva de `cliente_documento`/`cliente_nome` NÃO salva o caso, porque a lista não
 * está vazia.
 */
type CompradorDaProposta = {
  /** O usuário do C2X deste comprador, na grafia da importação. É a ponte exata até a ficha. */
  c2x_user_id?: unknown;
  cpf?: unknown;
  /** A grafia da importação do C2X para o mesmo campo que a proposta nativa chama de `cpf`. */
  documento?: unknown;
  /** A entidade do Apolo que a proposta apontar para este comprador, quando apontar. */
  entity_id?: unknown;
  nome?: unknown;
  participacao?: unknown;
  /** A grafia da importação do C2X para `participacao`. */
  percentual?: unknown;
  /**
   * ⚠️ O ÚNICO TELEFONE QUE O SEGUNDO COMPRADOR TEM. Está escrito na rota que grava o jsonb: o
   * proponente que não é o titular não tem reserva, pode não ter CAD e pode não ter entidade no
   * Apolo — este campo é o lugar onde o contato dele existe. Sem ele, `[telefone_cliente]` do
   * segundo comprador sai vazio em toda venda de casal em que só um dos dois tem cadastro.
   */
  telefone?: unknown;
  titular?: unknown;
};

/** O documento do comprador, venha ele como `cpf` (nativa) ou `documento` (importada do C2X). */
function documentoDoComprador(c: CompradorDaProposta): string {
  return soDigitos(texto(c.cpf) || texto(c.documento));
}

/** A participação, `participacao` na proposta nativa e `percentual` na importada. */
function participacaoDoComprador(c: CompradorDaProposta): null | number {
  return numero(c.participacao) ?? numero(c.percentual);
}

/**
 * O cronograma que a proposta congelou (`condicoes`, jsonb).
 *
 * ⚠️ `parcelas_sinal` E `primeiro_sinal` NÃO SÃO LIDOS, e a ausência é deliberada: nenhuma variável
 * do catálogo aponta para eles. Os dois são a agenda da entrada, e quem a escreve é
 * `[paragrafo_sinal]` — um trecho GERADO, que este módulo não monta. Selecioná-los "por garantia"
 * daria a impressão, para quem ler depois, de que existe uma variável esperando por eles.
 *
 * ⚠️ TIPO LOCAL, E NÃO O `Cronograma` IMPORTADO. Nas 4.857 propostas importadas do C2X esta coluna é
 * NULA (o legado não tem cronograma), e nas nativas ela é a foto do que o PDF imprimiu — que pode
 * ter sido gravada por uma versão anterior do cronograma. Um tipo local declara só o que este módulo
 * lê, e é o que faz um campo novo lá não virar erro de compilação aqui.
 */
type CondicoesGravadas = {
  anuais?: { valor?: unknown }[];
  mensais?: unknown[];
  totais?: { entrada?: unknown; financiado?: unknown };
};

// ── A FUNÇÃO ─────────────────────────────────────────────────────────────────

/**
 * A proposta gravada, pronta para o motor do contrato.
 *
 * Devolve `null` quando a proposta não existe. `avisos` é o que faltou, em frases curtas, para a
 * tela mostrar a quem vai conferir o contrato antes de mandá-lo para assinatura.
 *
 * ⚠️ AVISO SÓ PARA O QUE DEVERIA ESTAR LÁ E NÃO ESTÁ. Vendedora e anexos continuam marcados
 * `pendente` no catálogo — o Panteon ainda não guarda esses dados, e listá-los aqui poria trinta
 * linhas em TODO contrato. É a mesma razão pela qual `extensosOrfaos` abre exceção para a data por
 * extenso: aviso que sempre aparece é aviso que ninguém lê.
 *
 * ⚠️ A COMISSÃO SAIU DESSA LISTA EM 08/09/2026, e por isso ela avisa. Desde a migration 0145 os dois
 * percentuais e a coordenadora são DADO do empreendimento, editável na aba Políticas comerciais: o
 * que falta agora tem onde ser preenchido, e um aviso que alguém pode resolver é aviso que se lê.
 */
export async function dadosDaProposta(
  propostaId: string,
  sb: SupabaseClient,
): Promise<{
  avisos: string[];
  /**
   * O financeiro da venda IMPORTADA sem cronograma, lido da carteira do Apolo. `null` na nativa e na
   * importada que tem cronograma gravado. Ver `carteira-da-venda.ts`.
   *
   * ⚠️ SAI DAQUI, E NÃO DE UMA SEGUNDA LEITURA NA TELA, pela regra do topo de
   * `analise-do-trabalho.ts`: a tela e o papel precisam dizer o mesmo número.
   */
  carteira: CarteiraDaVenda | null;
  dados: DadosDoContrato;
} | null> {
  const avisos: string[] = [];

  const proposta = await umaLinha<LinhaDaProposta>(
    sb
      .from("hercules_propostas")
      .select(
        "cliente_c2x_id, cliente_documento, cliente_entity_id, cliente_nome, compradores, condicoes, contrato_parcelas, corretor_entity_id, corretor_nome, data_assinatura, data_ato, data_faturamento, dia_vencimento, empreendimento_id, etapa_c2x, imobiliaria_c2x_id, imobiliaria_entity_id, imobiliaria_nome, origem_c2x_id, plano_nome, plano_parcelas, unidade_id, valor",
      )
      .eq("id", propostaId)
      .maybeSingle(),
    "hercules_propostas",
  );

  if (!proposta) return null;

  // ⚠️ O VÍNCULO DA PRÓPRIA PROPOSTA MANDA. Só a venda que não aponta nem imobiliária nem corretor
  // (as importadas do C2X, que a carga gravou sem vínculo) procura quem vendeu na CAD do titular —
  // ver `quemVendeuPeloApolo`.
  const temVinculoNaProposta = Boolean(proposta.imobiliaria_entity_id || proposta.corretor_entity_id);

  const [unidade, empreendimento, doVinculado, links] = await Promise.all([
    proposta.unidade_id
      ? umaLinha<LinhaDaUnidade>(
          // ⚠️ AS COLUNAS DO PRÉDIO VÊM JUNTO, E SEM ELAS SE A 0171 NÃO ENTROU (onda 2, vertical).
          // Sem a leitura, as variáveis do apartamento (torre, andar, apartamento, tipologia, vagas,
          // área privativa) saíam vazias no contrato de todo prédio. Sem a migration não existe
          // apartamento nenhum, então ler sem as colunas é exato.
          lerComColunasDoApartamento((extras) =>
            sb
              .from("hercules_unidades")
              .select(
                `area, area_extenso, categoria_id, codigo, enterprise_id, lote, matricula, matricula_livro, preco_extenso, preco_tabela, quadra, tipo_unidade${extras}`,
              )
              .eq("id", proposta.unidade_id)
              .maybeSingle(),
          ),
          "hercules_unidades",
        )
      : Promise.resolve(null),
    proposta.empreendimento_id
      ? umaLinha<LinhaDoEmpreendimento>(
          sb
            .from("hercules_empreendimentos")
            .select("c2x_enterprise_id, cidade, codigo, id, nome, pai_id, uf")
            .eq("id", proposta.empreendimento_id)
            .maybeSingle(),
          "hercules_empreendimentos",
        )
      : Promise.resolve(null),
    // ⚠️ A PRECEDÊNCIA DE SEMPRE: a imobiliária vence o corretor (ver `cadastroDoVinculado`).
    temVinculoNaProposta
      ? cadastroDoVinculado(sb, [
          texto(proposta.imobiliaria_entity_id) || texto(proposta.corretor_entity_id),
        ])
      : Promise.resolve(null),
    lerLinksDoC2x(sb, idsDoC2xDaProposta(proposta)),
  ]);

  // ⚠️ A CARTEIRA SÓ É PROCURADA PARA A VENDA IMPORTADA SEM CRONOGRAMA. Lucas (18/09/2026): *"a
  // única coisa que vamos utilizar o c2x é a questão financeira, mesmo assim ela tem que morar dentro
  // da carteira no apolo"*. A nativa tem o cronograma congelado na própria proposta, e ele continua
  // sendo a verdade dela: é o papel que o comprador leu.
  const importadaSemCronograma =
    !objeto(proposta.condicoes) && idDaVendaImportada(proposta.origem_c2x_id) !== null;

  // ⚠️ A COMISSÃO É UMA SEGUNDA VIAGEM, e não cabe no `Promise.all` de cima: a chave de
  // `apolo_enterprise_settings` só se conhece DEPOIS de ler o empreendimento (ver
  // `comissaoDoEmpreendimento`). Mas ela roda junto com os compradores, que é a leitura cara — assim
  // as duas viagens extras não somam tempo à prévia do contrato. A carteira vai junto pelo mesmo motivo.
  const [montados, comissao, carteira] = await Promise.all([
    montarCompradores(sb, proposta, empreendimento, links, avisos),
    comissaoDoEmpreendimento(sb, empreendimento, unidade),
    importadaSemCronograma
      ? carteiraDaVendaImportada(
          sb,
          {
            area: unidade?.area,
            codigoDaUnidade: unidade?.codigo,
            dataAssinatura: proposta.data_assinatura,
            dataAto: proposta.data_ato,
            empreendimentoCodigo: empreendimento?.codigo,
            empreendimentoNome: empreendimento?.nome,
            estagio: proposta.etapa_c2x,
            lote: unidade?.lote,
            origemC2xId: proposta.origem_c2x_id ?? null,
            planoParcelas: proposta.plano_parcelas,
            precoTabela: unidade?.preco_tabela,
            quadra: unidade?.quadra,
          },
          hojeEmBrasilia(new Date()),
        )
      : Promise.resolve(null),
  ]);

  if (carteira?.situacao === "erro") {
    console.error("[temis][dados] falha ao ler a carteira do Apolo", { erro: carteira.error, propostaId });
  }

  // ⚠️ QUEM VENDEU DEPENDE DO TITULAR JÁ ESCOLHIDO (é a CAD dele que responde), então vem depois dos
  // compradores. Só roda para a venda sem vínculo, e é aí que a viagem a mais se paga.
  const vendeu: QuemVendeu = temVinculoNaProposta
    ? { corretorNome: "", imobiliariaNome: "", vinculado: doVinculado }
    : await quemVendeuPeloApolo(sb, {
        dosCompradores: montados.dosCompradores,
        empreendimento,
        links,
        proposta,
        titular: montados.titular,
        unidade,
      });

  // ⚠️ CARTEIRA VAZIA É FATO, E O FATO PODE DIVERGIR DO HÉRCULES — o VOL 4881 tem "ato pago em
  // 22/08" registrado e a carteira sem parcela nenhuma. Só nesse caso os fatos são lidos: é a única
  // hora em que eles mudam o que a tela diz. Falha na leitura deles não derruba a análise; só deixa
  // de apontar a divergência.
  const fatos =
    carteira?.situacao === "sem_carteira" && carteira.motivo === "sem_parcela"
      ? await lerFatosDoContrato(sb, {
          data_assinatura: proposta.data_assinatura ?? null,
          data_ato: proposta.data_ato ?? null,
          data_faturamento: proposta.data_faturamento ?? null,
          id: propostaId,
        }).catch(() => null)
      : null;

  // ⚠️ O QUADRO DE PAGAMENTO É NÓ, NÃO TEXTO, e por isso viaja em `gerados` e não em `gerais` (ver
  // `tabela-de-pagamentos.ts`). Os DOIS nomes recebem a mesma tabela, pela mesma razão de
  // `preco_venda`/`valor_imovel_venda`: as minutas usam um ou outro, e escrever só um faria metade
  // delas imprimir o colchete. Sem cronograma não há quadro: a variável continua cobrando.
  //
  // ⚠️ MAS O AVISO NÃO SE REPETE. Quem não tem `condicoes` JÁ é avisado por `avisoSemCronograma`, e
  // lá a frase é escolhida pela CAUSA (nativa sem cronograma, carteira que ainda não separa a venda,
  // carteira sincronizada sem lançamento, leitura que falhou). Um segundo aviso aqui poria duas
  // frases para o mesmo buraco e, na venda IMPORTADA, a segunda mandaria o operador procurar um
  // cronograma que aquela venda nunca teve — exatamente o que a nota das quatro causas evita.
  //
  // ⚠️ SÓ QUE EXISTE UM QUINTO CASO, E ELE FICOU MUDO NO MERGE DE 20/09/2026: a venda importada cuja
  // carteira do Apolo respondeu `ok`. Aí `gerais` preenche entrada e financiado COM A CARTEIRA e
  // volta ANTES de `avisoSemCronograma` — ninguém fala nada —, e esta linha, que na `main` avisava
  // sempre que o quadro não saía, passou a exigir `condicoes`, que na importada é NULA. Resultado: o
  // documento é recusado por `tabela_geral_pagamentos` em `semValor` e nenhuma frase explica o
  // porquê. Hoje o caso é latente (`apolo_carteira_vendas` ainda não existe em produção, conferido
  // em 20/09/2026); no dia da migration ele vale para as ~4.9 mil propostas importadas.
  //
  // ⚠️ E A FRASE DELE É PRÓPRIA, pela regra da casa: cada causa tem a sua. A do cronograma vazio
  // manda conferir o que foi gravado na proposta; esta precisa dizer que a carteira já tem as
  // parcelas e que, mesmo assim, o quadro do CONTRATO depende do cronograma da proposta — senão o
  // operador vai procurar defeito na carteira, que está certa.
  const quadro = tabelaGeralDePagamentos(proposta.condicoes);
  const temCronogramaGravado = objeto(proposta.condicoes) !== null;
  if (!quadro && (temCronogramaGravado || carteira?.situacao === "ok")) {
    avisos.push(
      temCronogramaGravado
        ? "O cronograma gravado na proposta não tem parcela nenhuma: o quadro de pagamento não pôde ser montado."
        : "Venda importada do C2X: a carteira do Apolo já tem as parcelas desta venda, mas o quadro de pagamento do contrato é montado a partir do cronograma gravado na proposta, e esta proposta não tem cronograma.",
    );
  }

  return {
    avisos,
    carteira,
    dados: {
      compradores: montados.compradores,
      condicoes: condicoesDoContrato(proposta),
      gerais: gerais(proposta, unidade, empreendimento, vendeu, comissao, avisos, { carteira, fatos }),
      ...(quadro
        ? { gerados: { tabela_geral_pagamentos: [quadro], tabela_pagamentos: [quadro] } }
        : {}),
    },
  };
}

// ── OS COMPRADORES ───────────────────────────────────────────────────────────

async function montarCompradores(
  sb: SupabaseClient,
  proposta: LinhaDaProposta,
  empreendimento: LinhaDoEmpreendimento | null,
  links: LinksDoC2x,
  avisos: string[],
): Promise<CompradoresMontados> {
  const daProposta = compradoresDaProposta(proposta);

  if (daProposta.length === 0) {
    avisos.push("A proposta não tem comprador nenhum: a qualificação do contrato sai em branco.");
    return { compradores: [], dosCompradores: { documentos: new Set(), fichas: new Set() }, titular: null };
  }

  // ⚠️ UMA CONSULTA SÓ, E COM AS DUAS GRAFIAS DO DOCUMENTO. `document_masked` guarda o documento
  // COMPLETO E FORMATADO ("123.456.789-00") apesar do nome da coluna — mas a proposta pode ter
  // gravado o CPF só em dígitos. Mandar as duas formas no mesmo `.in()` custa o dobro de itens numa
  // lista de no máximo dez e resolve o caso em uma viagem; procurar por uma forma só devolveria
  // "sem cadastro no Apolo" para gente que está cadastrada.
  const variantes = new Set<string>();
  for (const c of daProposta) {
    const digitos = documentoDoComprador(c);
    if (!digitos) continue;
    variantes.add(digitos);
    variantes.add(formatarDocumento(digitos));
  }

  const entidades =
    variantes.size > 0
      ? await varias<LinhaDaEntidade>(
          sb
            .from("apolo_entities")
            .select("created_at, display_name, document_masked, entity_kind, id, legal_name, metadata, status, trade_name")
            .in("document_masked", [...variantes])
            // ⚠️ ORDEM EXPLÍCITA PORQUE O MESMO CPF PODE TER DUAS ENTIDADES. O dedup do Apolo é por
            // `document_hash` e o backfill de 22/08 zerou parte dele.
            //
            // ⚠️ E A MAIS ANTIGA ERA A ESCOLHA ERRADA. Medido em 08/09/2026: de 622 CPFs duplicados,
            // 415 têm como mais antiga a entidade ARQUIVADA pelo merge — e as 415 estão VAZIAS, sem
            // ficha, sem contato e sem endereço. Isso atingia 262 propostas em três empreendimentos
            // do Vale do Ouro, o próximo da fila depois do Veredas: o contrato sairia sem cidade,
            // sem telefone e sem e-mail, com o cadastro completo ali do lado.
            //
            // ⚠️ E `created_at` NÃO DESEMPATA SOZINHO: 18 documentos duplicados foram gravados no
            // MESMO MICROSSEGUNDO (um deles no Veredas), e aí quem volta primeiro é decisão do
            // planner — o mesmo contrato, gerado duas vezes, sai diferente. O `id` fecha a ordem:
            // é arbitrário, mas é ESTÁVEL, que é o que importa.
            .order("status", { ascending: true })
            .order("created_at", { ascending: true })
            .order("id", { ascending: true }),
          "apolo_entities",
        )
      : [];

  // ⚠️ TODAS AS FICHAS DO MESMO DOCUMENTO FICAM, na ordem do banco. Até 18/09/2026 ficava UMA por
  // documento — a primeira pela ordem alfabética do status —, e a escolha era esta linha. Ver
  // `ordenarFichas` para o porquê de não ser mais.
  const porDocumento = new Map<string, LinhaDaEntidade[]>();
  for (const e of entidades) {
    const chave = soDigitos(e.document_masked ?? "");
    if (!chave) continue;
    const lista = porDocumento.get(chave) ?? [];
    lista.push(e);
    porDocumento.set(chave, lista);
  }

  // ⚠️ AS CAMADAS SÃO LIDAS PARA TODAS, E ANTES DE ESCOLHER. "Tem cadastro preenchido" é critério de
  // escolha, e a ficha da esteira é metade dessa resposta; e a escolhida pode ser completada pelas
  // outras do mesmo documento. As quatro consultas já eram em lote pelos ids de todas.
  const ids = [...new Set(entidades.map((e) => e.id).filter(Boolean))];
  const { conjuges, contatos, enderecos, esteira, fichas } = await camadasDoCadastro(
    sb,
    ids,
    empreendimento?.c2x_enterprise_id ?? null,
  );

  // ⚠️ O COMPRADOR NÃO VENDE O PRÓPRIO LOTE. Todas as fichas dos documentos dos compradores (vivas e
  // arquivadas) e os próprios documentos: é o que `quemVendeuPeloApolo` confere antes de aceitar o
  // corretor ou a imobiliária que a CAD aponta.
  const dosCompradores: DosCompradores = {
    documentos: new Set(daProposta.map(documentoDoComprador).filter(Boolean)),
    fichas: new Set(ids),
  };

  let titular: null | TitularEscolhido = null;

  const compradores = daProposta.map((cru) => {
    const digitos = documentoDoComprador(cru);
    const ehTitular = cru.titular === true;
    const apontada = texto(cru.entity_id) || (ehTitular ? texto(proposta.cliente_entity_id) : "");
    const ligada = ligadaAoUsuarioDoC2x(
      texto(cru.c2x_user_id) || (ehTitular ? texto(proposta.cliente_c2x_id) : ""),
      links,
    );
    const ordenadas = ordenarFichas(digitos ? (porDocumento.get(digitos) ?? []) : [], {
      apontada,
      ligada,
      nomeDaProposta: texto(cru.nome),
      // ⚠️ FICHA VAZIA NÃO É CADASTRO. 137 das 835 linhas de `apolo_esteira` têm `ficha = {}` (medido
      // em 18/09/2026), e `Boolean({})` é verdadeiro: o espelho com uma linha vazia empatava com a CAD
      // preenchida, a ordem do banco decidia, e ganhava o espelho.
      temCadastro: (e) =>
        Object.values(fichas.get(e.id) ?? {}).some(preenchido) || temCadastroDoWizard(e),
    });
    const entidade = ordenadas[0] ?? null;
    // ⚠️ SÓ AS VIVAS COMPLETAM. A arquivada é a duplicada que o merge do Apolo esvaziou de propósito;
    // se sobrou algo nela, é o que o merge decidiu descartar.
    const vivas = ordenadas.slice(1).filter((e) => !ehArquivada(e));
    // ⚠️ E SÓ AS DA MESMA PESSOA. O mesmo CPF não prova a mesma pessoa no Apolo: medido em 18/09/2026,
    // um titular de 4 vendas importadas abertas tem o espelho (o dele) e uma CAD de OUTRO primeiro
    // nome com o mesmo CPF, com nascimento, estado civil, RG e endereço. É o defeito conhecido da CAD
    // gravada com o CPF do cônjuge. Completar a escolhida com ela poria no contrato, e no envelope de
    // assinatura, os dados pessoais de um terceiro. Ver `ehAMesmaPessoa`.
    const daMesmaPessoa = entidade
      ? vivas.filter((e) => ehAMesmaPessoa(e, entidade, { apontada, ligada }))
      : [];
    const deOutraPessoa = vivas.length - daMesmaPessoa.length;
    const pessoa = entidade ? [entidade, ...daMesmaPessoa] : [];

    if (ehTitular && !titular) {
      titular = {
        entidadeId: entidade?.id ?? null,
        esteira: esteira.filter((l) => pessoa.some((e) => e.id === l.entity_id && !ehArquivada(e))),
      };
    }

    // ⚠️ AS DUAS CAMADAS DO CADASTRO, unidas aqui. A ficha da esteira é o que alguém corrigiu na
    // tela; `metadata.cadastro` é o que o wizard capturou na entrada — e era ignorado, deixando 222
    // estados civis, 212 nascimentos e 205 profissões sem chegar ao contrato.
    const camadas: CamadasDaFicha[] = pessoa.map((e) => ({
      cadastro: cadastroDaEntidade(fichas.get(e.id) ?? null, e),
      conjuge: conjuges.get(e.id) ?? null,
      contatos: contatos.get(e.id) ?? [],
      endereco: enderecos.get(e.id) ?? null,
    }));

    const montado = umComprador({
      avisos,
      daProposta: cru,
      digitos,
      entidade,
      ...pessoaCompletada(camadas),
    });

    if (deOutraPessoa > 0) {
      const nome = montado.valores.nome_cliente || texto(cru.nome) || "Comprador sem nome";
      avisos.push(
        `${nome}: o Apolo tem outra ficha com este CPF e outro nome, e ela ficou de fora do contrato. Confira qual é a pessoa certa.`,
      );
    }

    return montado;
  });

  return { compradores, dosCompradores, titular };
}

/** As camadas de UMA ficha do Apolo, lidas por `camadasDoCadastro`. */
type CamadasDaFicha = {
  cadastro: null | Record<string, unknown>;
  conjuge: LinhaDoRelacionamento | null;
  contatos: LinhaDoContato[];
  endereco: LinhaDoEndereco | null;
};

/**
 * A escolhida, completada pelas outras fichas da MESMA pessoa (a escolhida é a primeira da lista).
 *
 * ⚠️ O QUE FALTAR NELA VEM DAS OUTRAS FICHAS, nunca de documento diferente nem de outra pessoa.
 * Lucas (18/09/2026), sobre o distrato que veio sem nascimento, estado civil e profissão: *"tudo
 * tem que ser alimentado pelo panteon"*. O dado estava no Panteon, numa das duas fichas da mesma
 * pessoa. A escolhida continua mandando em tudo que ela tem.
 *
 * ⚠️ ENDEREÇO, CÔNJUGE, E-MAIL E TELEFONE SÃO DA FICHA INTEIRA, e não da camada. Cada um deles mora em
 * duas camadas da mesma entidade (a ficha e a tabela: `apolo_addresses`, `apolo_relationships`,
 * `apolo_contacts`), e completar só a camada da ficha deixava a ficha de OUTRA entidade passar por
 * cima da tabela da escolhida. Medido na revisão de 18/09/2026: 9 importadas abertas saíam com rua,
 * bairro ou número de outra ficha tendo a escolhida o seu endereço na tabela, e 3 com o endereço
 * COSTURADO de dois cadastros (o bairro de um com a rua e o CEP do outro). Agora a escolhida que
 * tem o dado em QUALQUER camada fica com ele; sem nenhuma, ele vem inteiro (ficha e tabela) da
 * primeira outra ficha que o tenha.
 */
function pessoaCompletada(camadas: CamadasDaFicha[]): {
  conjuge: LinhaDoRelacionamento | null;
  email: string;
  endereco: LinhaDoEndereco | null;
  ficha: null | Record<string, unknown>;
  telefone: string;
} {
  const [daEscolhida, ...dasOutras] = camadas;
  const unida = fichaComplementada(
    daEscolhida?.cadastro ?? null,
    dasOutras.map((c) => c.cadastro),
  );

  const donaDoEndereco = camadas.find((c) =>
    unirEndereco(c.cadastro, enderecoDaTabela(c.endereco)),
  );
  const donaDoConjuge = camadas.find((c) => unirConjuge(c.cadastro, conjugeDaTabela(c.conjuge)));

  // O bloco inteiro sai da dona, e o pedaço que a escolhida tivesse sem ser dona (o bairro solto sem
  // rua nem CEP) sai junto: é o que costurava o endereço de dois cadastros.
  const ficha =
    unida || donaDoEndereco || donaDoConjuge
      ? {
          ...soAsChaves(unida, (k) => !ehDoEndereco(k) && !ehDoConjuge(k)),
          ...soAsChaves(donaDoEndereco?.cadastro ?? null, ehDoEndereco),
          ...soAsChaves(donaDoConjuge?.cadastro ?? null, ehDoConjuge),
        }
      : null;

  // A ficha antes da tabela DENTRO da mesma entidade (a regra de sempre), e a escolhida inteira antes
  // de qualquer outra: o WhatsApp de outra ficha não passa por cima do telefone da escolhida.
  const daPessoa = (chave: "email" | "telefone", tipos: string[]) =>
    camadas.map((c) => texto(c.cadastro?.[chave]) || primeiroContato(c.contatos, tipos)).filter(Boolean);
  // ⚠️ `whatsapp` ANTES DE `phone`: ver a nota em `umComprador`.
  const telefones = daPessoa("telefone", ["whatsapp", "phone"]);

  return {
    conjuge: donaDoConjuge?.conjuge ?? null,
    email: daPessoa("email", ["email"])[0] ?? "",
    endereco: donaDoEndereco?.endereco ?? null,
    ficha,
    telefone: comNonoDigito(telefones[0] ?? "", telefones.slice(1)),
  };
}

/**
 * O celular da escolhida escrito SEM o nono dígito, trocado pela grafia completa do MESMO número que
 * outra ficha da mesma pessoa tem.
 *
 * ⚠️ É A ÚNICA EXCEÇÃO À PRECEDÊNCIA DA ESCOLHIDA, e não troca de número: medido em 18/09/2026, ao
 * dar à escolhida a precedência no telefone, 2 compradores do estrato passavam a sair com o próprio
 * celular sem o nono dígito, que a outra ficha tinha completo. Número diferente continua sendo o da
 * escolhida.
 */
function comNonoDigito(escolhido: string, outros: string[]): string {
  const semPais = (t: string, tamanho: number) => {
    const d = soDigitos(t);
    return d.length === tamanho + 2 && d.startsWith("55") ? d.slice(2) : d;
  };
  const curto = semPais(escolhido, 10);
  if (curto.length !== 10) return escolhido;
  const completo = outros.find((outro) => {
    const d = semPais(outro, 11);
    return d.length === 11 && d[2] === "9" && d.slice(0, 2) === curto.slice(0, 2) && d.slice(3) === curto.slice(2);
  });
  return completo ?? escolhido;
}

/** A linha de `apolo_addresses` no formato de `unirEndereco`. */
function enderecoDaTabela(linha: LinhaDoEndereco | null): Partial<EnderecoDaFicha> | null {
  if (!linha) return null;
  return {
    bairro: texto(linha.district),
    cep: texto(linha.postal_code),
    cidade: texto(linha.city),
    complemento: texto(linha.complement),
    logradouro: texto(linha.street),
    numero: texto(linha.number),
    uf: texto(linha.state),
  };
}

/** A linha de `apolo_relationships` no formato de `unirConjuge`. */
function conjugeDaTabela(linha: LinhaDoRelacionamento | null) {
  if (!linha) return null;
  return {
    cpf: linha.metadata?.cpf,
    email: linha.metadata?.email,
    nacionalidade: linha.metadata?.nacionalidade,
    nome: linha.label,
    profissaoId: linha.metadata?.profissaoId,
    telefone: linha.metadata?.phone,
  };
}

const CHAVES_DO_ENDERECO = new Set(["bairro", "cep", "cidade", "complemento", "logradouro", "numero", "uf"]);

function ehDoEndereco(chave: string): boolean {
  return CHAVES_DO_ENDERECO.has(chave);
}

function ehDoConjuge(chave: string): boolean {
  return chave.startsWith("conjuge");
}

/** Só as chaves que o filtro aceita, e só as preenchidas. */
function soAsChaves(
  cadastro: null | Record<string, unknown>,
  aceita: (chave: string) => boolean,
): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cadastro ?? {})) if (aceita(k) && preenchido(v)) saida[k] = v;
  return saida;
}

/**
 * A outra ficha do mesmo documento é COMPROVADAMENTE a mesma pessoa da escolhida.
 *
 * ⚠️ O CPF IGUAL NÃO BASTA (ver a nota em `montarCompradores`). Vale o que prova por id: a ficha que a
 * proposta aponta e a que a ponte do C2X liga ao usuário do comprador. Sem id, vale o nome: o mesmo
 * nome, ou um contido no outro com o mesmo primeiro nome (o espelho do C2X às vezes guarda o nome
 * mais curto). Medido em 18/09/2026, nas fichas vivas dos titulares de vendas abertas: 97 pares do
 * mesmo documento, 94 com o nome igual, 2 com um contido no outro, e 1 com primeiro nome diferente,
 * que é a outra pessoa.
 */
function ehAMesmaPessoa(
  outra: LinhaDaEntidade,
  escolhida: LinhaDaEntidade,
  prova: { apontada: string; ligada: (e: LinhaDaEntidade) => boolean },
): boolean {
  if (prova.apontada && outra.id === prova.apontada) return true;
  if (prova.ligada(outra)) return true;
  return mesmoNome(nomeDaFicha(outra), nomeDaFicha(escolhida));
}

function nomeDaFicha(e: LinhaDaEntidade): string {
  return texto(e.display_name) || texto(e.legal_name);
}

/**
 * Dois nomes da mesma pessoa: iguais sem acento, caixa e pontuação, ou um contido no outro com o
 * mesmo primeiro nome ("MARIA SOUZA" e "MARIA DE SOUZA LIMA"). Nome vazio não prova nada.
 */
export function mesmoNome(a: string, b: string): boolean {
  const partes = (nome: string) =>
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean);
  const pa = partes(a);
  const pb = partes(b);
  if (pa.length === 0 || pb.length === 0) return false;
  if (pa[0] !== pb[0]) return false;
  const [curto, longo] = pa.length <= pb.length ? [pa, new Set(pb)] : [pb, new Set(pa)];
  return curto.every((p) => longo.has(p));
}

/** A ponte pelo usuário do C2X: `metadata.c2xUserId` (a CAD enviada) ou `c2x/users/<id>` (o espelho). */
function ligadaAoUsuarioDoC2x(c2xUserId: string, links: LinksDoC2x): (e: LinhaDaEntidade) => boolean {
  if (!c2xUserId) return () => false;
  const doEspelho = links.get(c2xUserId) ?? [];
  return (e) => texto(objeto(e.metadata)?.c2xUserId) === c2xUserId || doEspelho.includes(e.id);
}

/** O titular como a escolha o deixou: a entidade que ganhou e as linhas de esteira da mesma pessoa. */
type TitularEscolhido = {
  entidadeId: null | string;
  /** As linhas de `apolo_esteira` de todas as fichas VIVAS do documento do titular. */
  esteira: LinhaDaEsteira[];
};

/** Quem compra, para `quemVendeuPeloApolo` não pôr o comprador como quem vendeu. */
type DosCompradores = {
  /** Os documentos (só dígitos) de todos os compradores da proposta. */
  documentos: Set<string>;
  /** Todas as fichas desses documentos, vivas e arquivadas. */
  fichas: Set<string>;
};

type CompradoresMontados = {
  compradores: DadosDoComprador[];
  dosCompradores: DosCompradores;
  titular: null | TitularEscolhido;
};

/**
 * A ordem em que as fichas do MESMO documento disputam o comprador.
 *
 * ⚠️ A ORDEM ALFABÉTICA DO STATUS ESCOLHIA ERRADO, e foi o distrato do VOC Q09 L11 que mostrou.
 * Lucas (18/09/2026): *"tem um distrato mas não está trazendo as informações, analisa o porquê"*. A
 * mesma pessoa tinha duas fichas: o ESPELHO do C2X (`active`, sem `metadata.cadastro`) e a da CAD
 * pública (`review`, com nascimento, estado civil, nacionalidade e profissão). `active` vem antes de
 * `review` no alfabeto, e o card saía com a qualificação vazia com o cadastro completo ali do lado.
 * Medido no mesmo dia: 5 dos 6 distratos e 3 dos 4 contratos nativos em análise. Com esta régua, a
 * escolha muda em 121 compradores de 119 vendas importadas abertas e em 5 nativas, e em nenhum deles
 * a escolhida nova tem menos cadastro que a antiga.
 *
 * A régua, do mais forte para o mais fraco:
 *
 *   0. a ARQUIVADA só ganha se não houver outra — o merge do Apolo a esvaziou (a regra de 08/09);
 *   1. a entidade que a PROPOSTA APONTA (`cliente_entity_id`, `compradores[].entity_id`);
 *   2. a PONTE EXATA pelo usuário do C2X: `cliente_c2x_id`/`compradores[].c2x_user_id` casando com
 *      `metadata.c2xUserId` (a CAD que foi enviada ao C2X) ou com `apolo_source_links` `c2x/users/<id>`
 *      (o espelho). É id, não nome — não casa gente diferente;
 *   3. a que tem o NOME que a proposta gravou para o comprador (`mesmoNome`). Sem id que decida, é o
 *      que impede a CAD de outra pessoa com o mesmo CPF de ganhar só por ter cadastro (a revisão de
 *      18/09/2026 achou um CPF com duas pessoas, titular de 4 vendas abertas);
 *   4. a que tem CADASTRO PREENCHIDO (ficha da esteira ou `metadata.cadastro`) antes da que não tem;
 *   5. a ordem do banco: status, `created_at`, `id` — estável, para o mesmo contrato gerado duas
 *      vezes sair igual.
 *
 * ⚠️ SÓ ENTRE FICHAS DO MESMO DOCUMENTO. O apontamento e a ponte ordenam; nenhum dos dois traz para
 * dentro uma entidade de outro CPF. Medido em 18/09/2026: nas 12 nativas com `cliente_entity_id`, a
 * entidade apontada tem o mesmo documento do comprador em 12.
 */
function ordenarFichas(
  candidatas: LinhaDaEntidade[],
  criterio: {
    apontada: string;
    ligada: (e: LinhaDaEntidade) => boolean;
    nomeDaProposta: string;
    temCadastro: (e: LinhaDaEntidade) => boolean;
  },
): LinhaDaEntidade[] {
  const peso = (e: LinhaDaEntidade): number[] => [
    ehArquivada(e) ? 1 : 0,
    criterio.apontada && e.id === criterio.apontada ? 0 : 1,
    criterio.ligada(e) ? 0 : 1,
    mesmoNome(nomeDaFicha(e), criterio.nomeDaProposta) ? 0 : 1,
    criterio.temCadastro(e) ? 0 : 1,
  ];

  return candidatas
    .map((e, ordemDoBanco) => ({ e, ordemDoBanco, peso: peso(e) }))
    .sort((a, b) => {
      for (let i = 0; i < a.peso.length; i += 1) {
        const diferenca = (a.peso[i] ?? 0) - (b.peso[i] ?? 0);
        if (diferenca !== 0) return diferenca;
      }
      return a.ordemDoBanco - b.ordemDoBanco;
    })
    .map((x) => x.e);
}

/** `metadata.cadastro` com pelo menos um campo preenchido. */
function temCadastroDoWizard(e: LinhaDaEntidade): boolean {
  const cadastro = objeto(objeto(e.metadata)?.cadastro);
  return Boolean(cadastro && Object.values(cadastro).some(preenchido));
}

/**
 * Os campos que andam JUNTOS: ou vêm todos da mesma ficha, ou nenhum vem.
 *
 * ⚠️ É O QUE IMPEDE O CONTRATO DE COSTURAR DUAS VERSÕES DA MESMA PESSOA. O número de uma casa com o
 * CEP de outra é um endereço que não existe; o regime de bens de um cadastro com o estado civil de
 * outro é uma qualificação que ninguém declarou; e o órgão de um RG com o número de outro é o
 * defeito que a trava do número fechou em 08/09. O resto (nascimento, nacionalidade, e-mail) é um
 * dado por campo, e completa campo a campo.
 */
const CAMPOS_EM_BLOCO: readonly (readonly string[])[] = [
  ["orgaoEmissor", "rg"],
  ["estadoCivilId", "regimeBensId"],
  ["profissaoId", "profissaoOutro"],
];

/**
 * A qualificação da ficha escolhida, completada pelas outras fichas da MESMA pessoa.
 *
 * ⚠️ A ESCOLHIDA SEMPRE TEM PRECEDÊNCIA: o que ela tem, fica. As outras só preenchem o que falta,
 * na ordem de `ordenarFichas`.
 *
 * ⚠️ ENDEREÇO, CÔNJUGE, E-MAIL E TELEFONE NÃO SAEM DAQUI, E SAEM DA FICHA: a escolhida os tem também
 * nas tabelas, e só `pessoaCompletada` enxerga as duas camadas de cada entidade. As chaves deles que
 * a escolhida tiver ficam; as das outras não entram por aqui.
 */
function fichaComplementada(
  principal: null | Record<string, unknown>,
  outras: (null | Record<string, unknown>)[],
): null | Record<string, unknown> {
  const daEntidade = (chave: string) =>
    ehDoEndereco(chave) || ehDoConjuge(chave) || chave === "email" || chave === "telefone";
  let unida: null | Record<string, unknown> = principal ? { ...principal } : null;
  const emBloco = new Set(CAMPOS_EM_BLOCO.flat());

  for (const outra of outras) {
    if (!outra) continue;
    const alvo: Record<string, unknown> = unida ?? {};
    unida = alvo;

    for (const bloco of CAMPOS_EM_BLOCO) {
      if (bloco.some((k) => preenchido(alvo[k]))) continue;
      for (const k of bloco) if (preenchido(outra[k])) alvo[k] = outra[k];
    }

    for (const [k, v] of Object.entries(outra)) {
      if (emBloco.has(k) || daEntidade(k)) continue;
      if (!preenchido(alvo[k]) && preenchido(v)) alvo[k] = v;
    }
  }

  return unida;
}

function preenchido(v: unknown): boolean {
  return v !== null && v !== undefined && texto(v) !== "";
}

/**
 * Ficha, endereço, contatos e cônjuge dos compradores — quatro consultas, todas em lote.
 *
 * ⚠️ A FICHA É POR EMPREENDIMENTO. Desde a 0081 a chave de `apolo_esteira` é
 * `(entity_id, enterprise_id)`: quem já comprou em dois loteamentos tem DUAS fichas, e a do outro
 * empreendimento pode trazer o endereço antigo. Por isso a do empreendimento desta proposta ganha, e
 * a mais recente é só o desempate — a mesma precedência de `lerCadDaEsteira`.
 */
async function camadasDoCadastro(
  sb: SupabaseClient,
  ids: string[],
  enterpriseId: null | string,
): Promise<{
  conjuges: Map<string, LinhaDoRelacionamento>;
  contatos: Map<string, LinhaDoContato[]>;
  enderecos: Map<string, LinhaDoEndereco>;
  /** As linhas cruas da esteira, da mais recente para a mais antiga. É daqui que sai o corretor da CAD. */
  esteira: LinhaDaEsteira[];
  fichas: Map<string, Record<string, unknown>>;
}> {
  const vazio = {
    conjuges: new Map<string, LinhaDoRelacionamento>(),
    contatos: new Map<string, LinhaDoContato[]>(),
    enderecos: new Map<string, LinhaDoEndereco>(),
    esteira: [] as LinhaDaEsteira[],
    fichas: new Map<string, Record<string, unknown>>(),
  };
  if (ids.length === 0) return vazio;

  const [linhasDaEsteira, linhasDeEndereco, linhasDeContato, linhasDeConjuge] = await Promise.all([
    varias<LinhaDaEsteira>(
      sb
        .from("apolo_esteira")
        // ⚠️ O CORRETOR E A IMOBILIÁRIA VÊM NA MESMA VIAGEM DA FICHA: a venda importada não os tem, e
        // a CAD do titular tem (ver `quemVendeuPeloApolo`). Uma consulta a mais por card para ler
        // colunas da linha que já vinha seria desperdício.
        .select("corretor, corretor_entity_id, enterprise_id, entity_id, ficha, imobiliaria, imobiliaria_entity_id")
        .in("entity_id", ids)
        .order("atualizado_em", { ascending: false }),
      "apolo_esteira",
    ),
    varias<LinhaDoEndereco>(
      sb
        .from("apolo_addresses")
        .select("city, complement, district, entity_id, number, postal_code, state, street")
        .in("entity_id", ids)
        .order("is_primary", { ascending: false }),
      "apolo_addresses",
    ),
    varias<LinhaDoContato>(
      sb
        .from("apolo_contacts")
        .select("contact_type, entity_id, value")
        .in("entity_id", ids)
        .order("is_primary", { ascending: false }),
      "apolo_contacts",
    ),
    varias<LinhaDoRelacionamento>(
      sb
        .from("apolo_relationships")
        .select("entity_id, label, metadata, status")
        .in("entity_id", ids)
        .eq("relationship_type", "conjuge"),
      "apolo_relationships",
    ),
  ]);

  const fichas = new Map<string, Record<string, unknown>>();
  const doEmpreendimento = new Set<string>();
  for (const linha of linhasDaEsteira) {
    const ficha = objeto(linha.ficha);
    if (!ficha || !linha.entity_id) continue;
    const daVenda = Boolean(enterpriseId) && texto(linha.enterprise_id) === texto(enterpriseId);
    // A do empreendimento desta proposta sobrescreve a que a ordem por recência tinha escolhido.
    if (daVenda && !doEmpreendimento.has(linha.entity_id)) {
      fichas.set(linha.entity_id, ficha);
      doEmpreendimento.add(linha.entity_id);
      continue;
    }
    if (!fichas.has(linha.entity_id)) fichas.set(linha.entity_id, ficha);
  }

  const enderecos = new Map<string, LinhaDoEndereco>();
  for (const linha of linhasDeEndereco) {
    if (linha.entity_id && !enderecos.has(linha.entity_id)) enderecos.set(linha.entity_id, linha);
  }

  const contatos = new Map<string, LinhaDoContato[]>();
  for (const linha of linhasDeContato) {
    if (!linha.entity_id) continue;
    const lista = contatos.get(linha.entity_id) ?? [];
    lista.push(linha);
    contatos.set(linha.entity_id, lista);
  }

  // ⚠️ O CÔNJUGE ARQUIVADO NÃO É CÔNJUGE. `apolo_relationships` não apaga: desfazer um vínculo pela
  // tela grava `status = "archived"` (a rota `/api/apolo/relationships/archive`), e o casamento
  // desfeito, o cônjuge digitado na pessoa errada e o vínculo trocado numa correção de titular
  // continuam todos na tabela. Lê-los aqui não deixaria só um campo errado: `temConjuge` liga o
  // bloco `[inicio_dados_conjuge]` inteiro, e o contrato iria a cartório qualificando — e pedindo a
  // assinatura de — uma pessoa que não é mais parte do negócio.
  //
  // ⚠️ E O FILTRO É AQUI, NÃO NO `.neq()`. No PostgREST, `status <> 'archived'` descarta também a
  // linha com status NULO (a comparação devolve NULL, que não é verdadeiro), e vínculo antigo sem
  // status viraria "sem cônjuge" — o defeito oposto, igualmente calado.
  const conjuges = new Map<string, LinhaDoRelacionamento>();
  for (const linha of linhasDeConjuge) {
    if (!linha.entity_id || conjuges.has(linha.entity_id)) continue;
    if (texto(linha.status).toLowerCase() === "archived") continue;
    conjuges.set(linha.entity_id, linha);
  }

  return { conjuges, contatos, enderecos, esteira: linhasDaEsteira, fichas };
}

/**
 * O cadastro da imobiliária (ou do corretor) da venda, quando a proposta guarda o vínculo.
 *
 * ⚠️ A IMOBILIÁRIA VENCE O CORRETOR, e é a mesma precedência do split do C2X: quem recebe a
 * comissão é a imobiliária quando ela existe, e o corretor autônomo quando a venda foi direta.
 * Inverter faria o contrato de corretagem nomear como beneficiário quem não recebe.
 *
 * ⚠️ A IMPORTADA NÃO É RECONCILIADA POR NOME — decisão do Lucas em 08/09/2026: *"o que foi gerado
 * antes do Panteon, deixa sem mesmo"*. Reconciliar por nome casaria pouco mais de um terço e criaria
 * vínculo ERRADO nos outros. Desde 18/09/2026 ela é reconciliada por ID, que não erra de pessoa: o
 * `imobiliaria_c2x_id` da venda casa com `apolo_source_links` (`c2x/users/<id>`), e o corretor vem da
 * CAD do titular no Apolo. Ver `quemVendeuPeloApolo`.
 *
 * ⚠️ RECEBE UMA LISTA porque a mesma imobiliária pode ter duas entidades no Apolo (o espelho do C2X
 * e a do credenciamento, mesmo CNPJ — medido no ACP 4947). O documento sai da primeira que o tiver
 * inteiro, e os contatos das duas, na ordem da lista.
 */
async function cadastroDoVinculado(
  sb: SupabaseClient,
  ids: string[],
): Promise<null | DoVinculado> {
  const lidas = await lerEntidadesDoVinculo(sb, ids);
  const comEntidade = lidas.filter((l) => l.entidade);
  if (comEntidade.length === 0) return null;

  const contatos = comEntidade.flatMap((l) => l.contatos);
  return {
    // ⚠️ O CRECI VEM DA FICHA, COMO O CATÁLOGO SEMPRE DISSE (`VINCULADO_FICHA("creci")`), e até
    // 20/09/2026 ninguém o lia: o contrato de corretagem do Vale do Ouro saiu com
    // "CRECI: [creci_vinculado]" e travou a geração. Ele é o campo que o cadastro de imobiliária do
    // Apolo grava (`metadata.cadastro.creci`).
    //
    // ⚠️ E NÃO SE LÊ O C2X PARA COMPLETAR. O número existe lá (`users.creci_number`, 431 linhas), mas
    // a regra da casa é trazer o dado para o Panteon, não abrir leitura do legado numa peça de
    // contrato: imobiliária vinda do sync fica sem CRECI até alguém cadastrar, e a conferência da
    // Têmis acusa. Ver [[feedback_c2x_so_financeiro_via_carteira]].
    //
    // ⚠️ E ELE SAI DA PRIMEIRA ENTIDADE QUE O TIVER, pela mesma razão do documento: a imobiliária
    // pode ter duas entidades no Apolo (o espelho do C2X e a do credenciamento), e o CRECI está na
    // cadastrada aqui, que nem sempre é a primeira da lista.
    creci: comEntidade.map((l) => texto(cadastroDaEntidade(null, l.entidade)?.creci)).find(Boolean) ?? "",
    documento:
      comEntidade.map((l) => documentoImprimivel(texto(l.entidade?.document_masked))).find(Boolean) ?? "",
    email: primeiroContato(contatos, ["email"]),
    // ⚠️ WHATSAPP PRIMEIRO. No Apolo o `whatsapp` é o tipo que a maioria das entidades tem; ler só
    // `phone` deixaria o contrato de corretagem sem telefone na maior parte das vendas.
    telefone: primeiroContato(contatos, ["whatsapp", "phone"]),
  };
}

type DoVinculado = { creci: string; documento: string; email: string; telefone: string };

/** Entidade e contatos de cada id, uma consulta por id (são no máximo três). */
async function lerEntidadesDoVinculo(
  sb: SupabaseClient,
  ids: string[],
): Promise<{ contatos: LinhaDoContato[]; entidade: LinhaDaEntidade | null; id: string }[]> {
  const unicos = [...new Set(ids.map(texto).filter(Boolean))];
  return Promise.all(
    unicos.map(async (id) => {
      const [entidade, contatos] = await Promise.all([
        umaLinha<LinhaDaEntidade>(
          sb
            .from("apolo_entities")
            // ⚠️ `metadata` ENTRA AQUI PELO CRECI. Ele mora em `metadata.cadastro.creci` (ver
            // `cadastroDoVinculado`); sem a coluna na consulta, `[creci_vinculado]` volta a sair
            // como colchete no contrato de corretagem — e a variável trava a geração.
            .select("display_name, document_masked, id, legal_name, metadata, trade_name")
            .eq("id", id)
            .maybeSingle(),
          "apolo_entities",
        ),
        varias<LinhaDoContato>(
          sb.from("apolo_contacts").select("contact_type, entity_id, value").eq("entity_id", id),
          "apolo_contacts",
        ),
      ]);
      return { contatos, entidade: objeto(entidade) ? entidade : null, id };
    }),
  );
}

/** O que a corretagem precisa saber de quem vendeu, quando a proposta não guarda o vínculo. */
type QuemVendeu = {
  /** Vazio = não se soube. O nome da proposta, quando existir, continua ganhando (ver `gerais`). */
  corretorNome: string;
  imobiliariaNome: string;
  vinculado: DoVinculado | null;
};

/**
 * Quem vendeu a venda IMPORTADA, pelo que o Panteon sabe — sem ler o C2X.
 *
 * Lucas (18/09/2026): *"tudo tem que ser alimentado pelo panteon"*. A carga das importadas
 * (`importar-fluxo-de-venda.mjs`) grava o corretor vazio e nenhum vínculo; o card do distrato saía
 * "Corretor: não informado" e o contrato de corretagem sem CNPJ, telefone e e-mail da imobiliária.
 *
 * As duas fontes, as duas por ID:
 *
 *   • a IMOBILIÁRIA DA VENDA: `imobiliaria_c2x_id` → `apolo_source_links` `c2x/users/<id>`. Medido em
 *     18/09/2026: as 2.611 importadas abertas sem corretor têm esse link.
 *   • a CAD DO TITULAR no Apolo (`apolo_esteira`): `corretor_entity_id` e `imobiliaria_entity_id`.
 *     Medido: 160 dessas vendas têm CAD no escopo, 107 com corretor. Com as travas abaixo (o escopo, a
 *     imobiliária da venda, e o comprador que não é corretor de si mesmo), 81 ganham o corretor
 *     (rodada 2, 18/09/2026, no estrato de 209 vendas abertas medido contra a rodada 1, que dava 98).
 *
 * ⚠️ A CAD SÓ VALE NO EMPREENDIMENTO DA VENDA. Quem comprou em dois loteamentos tem duas CADs, e o
 * corretor do outro não vendeu este lote. O escopo é a família do empreendimento no cadastro do
 * Panteon (pai e filhos: VLO 35, VOC 37, VOL 36, VOR 41) mais o id do grupo (`group:Vale do Ouro`),
 * os dois formatos que `apolo_esteira.enterprise_id` guarda — a régua de `cliente-credenciado.ts`.
 *
 * ⚠️ E A CAD SÓ VALE SE A IMOBILIÁRIA DELA FOR A DA VENDA. Medido: das 160, 152 casam (pelo id ou
 * pelo mesmo CNPJ) e 8 não. Nessas 8 o corretor da CAD é de OUTRA imobiliária — nomeá-lo no contrato
 * de corretagem poria um beneficiário que não vendeu. Sem casar, fica "não informado", como antes.
 */
async function quemVendeuPeloApolo(
  sb: SupabaseClient,
  entrada: {
    dosCompradores: DosCompradores;
    empreendimento: LinhaDoEmpreendimento | null;
    links: LinksDoC2x;
    proposta: LinhaDaProposta;
    titular: null | TitularEscolhido;
    unidade: LinhaDaUnidade | null;
  },
): Promise<QuemVendeu> {
  const { dosCompradores, links, proposta, titular } = entrada;
  const idDaImobiliaria = texto(proposta.imobiliaria_c2x_id);
  const daVenda = idDaImobiliaria ? (links.get(idDaImobiliaria) ?? []) : [];

  const comVinculo = (titular?.esteira ?? []).filter(
    (l) => texto(l.corretor_entity_id) || texto(l.imobiliaria_entity_id),
  );

  let cad: LinhaDaEsteira | null = null;
  if (comVinculo.length > 0) {
    const escopo = await escopoDaVenda(sb, entrada.empreendimento, entrada.unidade);
    // A do titular escolhido primeiro; entre as dele (ou entre as outras), a mais recente — a ordem
    // em que a esteira já chega.
    const noEscopo = comVinculo.filter((l) => escopo.has(texto(l.enterprise_id)));
    cad =
      noEscopo.find((l) => l.entity_id === titular?.entidadeId) ?? noEscopo[0] ?? null;
  }

  const idImobDaCad = texto(cad?.imobiliaria_entity_id);
  const idCorretorDaCad = texto(cad?.corretor_entity_id);
  const lidas = await lerEntidadesDoVinculo(sb, [...daVenda, idImobDaCad, idCorretorDaCad]);
  const porId = new Map(lidas.map((l) => [l.id, l]));

  const docDe = (id: string) => soDigitos(texto(porId.get(id)?.entidade?.document_masked));
  // ⚠️ O COMPRADOR NÃO VENDEU O PRÓPRIO LOTE. O formulário público da CAD grava como corretor quem
  // preenche a primeira etapa, e o cliente que preenche sozinho vira corretor de si mesmo (a memória
  // "corretor do CAD público é o CLIENTE"). Medido em 18/09/2026: 24 das 179 linhas de `apolo_esteira`
  // com corretor apontam a própria ficha, e das 98 importadas que ganhavam corretor pela CAD, 17 a 19
  // imprimiam o comprador como corretor. Uma venda tinha também o link da imobiliária no próprio
  // comprador. Ficha de qualquer comprador, ou o mesmo documento, fica de fora: "não informado".
  const ehComprador = (id: string) =>
    dosCompradores.fichas.has(id) || dosCompradores.documentos.has(docDe(id));
  const docDaCad = idImobDaCad ? docDe(idImobDaCad) : "";
  const cadCasa =
    Boolean(cad) &&
    (daVenda.length === 0 ||
      (Boolean(idImobDaCad) &&
        (daVenda.includes(idImobDaCad) ||
          (docDaCad.length >= 11 && daVenda.some((id) => docDe(id) === docDaCad)))));

  const imobiliarias = [
    ...daVenda,
    ...(cadCasa && idImobDaCad && !daVenda.includes(idImobDaCad) ? [idImobDaCad] : []),
  ].filter((id) => porId.get(id)?.entidade && !ehComprador(id));
  const corretor =
    cadCasa && idCorretorDaCad && porId.get(idCorretorDaCad)?.entidade && !ehComprador(idCorretorDaCad)
      ? idCorretorDaCad
      : "";
  const imobiliariaDaCadValida = cadCasa && !(idImobDaCad && ehComprador(idImobDaCad));

  const nomeDe = (id: string) => {
    const e = porId.get(id)?.entidade;
    return texto(e?.trade_name) || texto(e?.display_name) || texto(e?.legal_name);
  };
  const nomeDePessoa = (id: string) => {
    const e = porId.get(id)?.entidade;
    return texto(e?.display_name) || texto(e?.legal_name);
  };

  // ⚠️ A IMOBILIÁRIA VENCE O CORRETOR na corretagem, a mesma precedência de sempre.
  const doVinculo = imobiliarias.length > 0 ? imobiliarias : corretor ? [corretor] : [];
  const vinculadas = doVinculo.map((id) => porId.get(id)).filter((l) => l?.entidade);
  const contatos = vinculadas.flatMap((l) => l?.contatos ?? []);

  return {
    corretorNome: corretor ? nomeDePessoa(corretor) || texto(cad?.corretor) : "",
    imobiliariaNome:
      (imobiliarias[0] ? nomeDe(imobiliarias[0]) : "") ||
      (imobiliariaDaCadValida ? texto(cad?.imobiliaria) : ""),
    vinculado:
      vinculadas.length > 0
        ? {
            // ⚠️ O CRECI TAMBÉM SAI POR AQUI, e não só pelo vínculo da proposta. Esta é a imobiliária
            // da venda IMPORTADA (achada pelo link do C2X ou pela CAD): se o CRECI só fosse lido em
            // `cadastroDoVinculado`, "CRECI: [creci_vinculado]" voltaria a travar a geração em
            // justamente as vendas que são a maioria de hoje. Mesma fonte e mesma regra de lá:
            // `metadata.cadastro.creci`, da primeira entidade que o tiver, sem ler o legado.
            creci:
              vinculadas.map((l) => texto(cadastroDaEntidade(null, l?.entidade)?.creci)).find(Boolean) ??
              "",
            documento:
              vinculadas
                .map((l) => documentoImprimivel(texto(l?.entidade?.document_masked)))
                .find(Boolean) ?? "",
            email: primeiroContato(contatos, ["email"]),
            telefone: primeiroContato(contatos, ["whatsapp", "phone"]),
          }
        : null,
  };
}

/**
 * Os `enterprise_id` que contam como "o empreendimento desta venda" na esteira do Apolo.
 *
 * ⚠️ SÓ O PANTEON, E NÃO O CATÁLOGO DO C2X. `catalogoDeEmpreendimentos` (que o resto do código usa
 * para achar o grupo) lê o legado; aqui o grupo sai do cadastro de pai e filhos do Hércules: o pai
 * que tem filhos é o consolidado, e o id dele é `group:<nome do pai>`. Medido em 18/09/2026: os cinco
 * pais com filhos (Lagoa Bonita, Lavra do Ouro, Portal dos Vales, Rio de Pedras, Vale do Ouro) têm o
 * nome igual ao do grupo do catálogo, e `apolo_esteira.enterprise_id` guarda hoje duas CADs como
 * `group:Lagoa Bonita` (o Vale do Ouro aparece como `group:Vale do Ouro` nos ajustes do empreendimento).
 *
 * ⚠️ FALHA DE LEITURA ENCOLHE O ESCOPO, NUNCA O ALARGA. Sem a família, vale o empreendimento e a
 * unidade: a CAD de outro loteamento continua de fora, que é o lado barato de errar.
 */
async function escopoDaVenda(
  sb: SupabaseClient,
  empreendimento: LinhaDoEmpreendimento | null,
  unidade: LinhaDaUnidade | null,
): Promise<Set<string>> {
  const escopo = new Set(
    [texto(empreendimento?.c2x_enterprise_id), texto(unidade?.enterprise_id)].filter(Boolean),
  );
  const raiz = texto(empreendimento?.pai_id) || texto(empreendimento?.id);
  if (!raiz) return escopo;

  type Membro = { c2x_enterprise_id: null | string; id: string; nome: null | string; pai_id: null | string };
  let familia: Membro[] = [];
  try {
    familia = await varias<Membro>(
      sb
        .from("hercules_empreendimentos")
        .select("c2x_enterprise_id, id, nome, pai_id")
        .or(`id.eq.${raiz},pai_id.eq.${raiz}`),
      "hercules_empreendimentos",
    );
  } catch (erro) {
    console.error("[temis][dados] falha ao ler a família do empreendimento da venda", erro);
    return escopo;
  }

  for (const membro of familia) {
    const id = texto(membro.c2x_enterprise_id);
    if (id) escopo.add(id);
  }
  const doPai = familia.find((m) => m.id === raiz);
  if (doPai && familia.some((m) => m.pai_id === raiz) && texto(doPai.nome)) {
    escopo.add(`group:${texto(doPai.nome)}`);
  }
  return escopo;
}

/** Usuário do C2X → entidades do Apolo, por `apolo_source_links` (`c2x/users/<id>`). */
type LinksDoC2x = Map<string, string[]>;

/**
 * Os usuários do C2X que esta proposta cita: os compradores, o titular e a imobiliária.
 *
 * ⚠️ A IMOBILIÁRIA SÓ ENTRA SEM VÍNCULO NA PROPOSTA. Com `imobiliaria_entity_id` (nativa) o vínculo
 * da própria proposta manda, e procurar outro seria uma viagem para não usar.
 */
function idsDoC2xDaProposta(proposta: LinhaDaProposta): string[] {
  const ids = new Set<string>();
  const crus = Array.isArray(proposta.compradores) ? (proposta.compradores as unknown[]) : [];
  for (const c of crus) {
    const id = texto(objeto(c)?.c2x_user_id);
    if (id) ids.add(id);
  }
  const doTitular = texto(proposta.cliente_c2x_id);
  if (doTitular) ids.add(doTitular);
  const daImobiliaria = texto(proposta.imobiliaria_c2x_id);
  if (daImobiliaria && !proposta.imobiliaria_entity_id && !proposta.corretor_entity_id) {
    ids.add(daImobiliaria);
  }
  return [...ids];
}

/** Uma consulta só, para todos os ids do C2X da proposta. */
async function lerLinksDoC2x(sb: SupabaseClient, ids: string[]): Promise<LinksDoC2x> {
  const links: LinksDoC2x = new Map();
  if (ids.length === 0) return links;
  const linhas = await varias<{ entity_id: null | string; source_id: null | string }>(
    sb
      .from("apolo_source_links")
      .select("entity_id, source_id")
      .eq("source_system", "c2x")
      .eq("source_table", "users")
      .in("source_id", ids),
    "apolo_source_links",
  );
  for (const l of linhas) {
    const origem = texto(l.source_id);
    const entidade = texto(l.entity_id);
    if (!origem || !entidade) continue;
    const lista = links.get(origem) ?? [];
    if (!lista.includes(entidade)) lista.push(entidade);
    links.set(origem, lista);
  }
  return links;
}

/** `origem_c2x_id` como número de venda do C2X; `null` na venda nativa. */
function idDaVendaImportada(bruto: unknown): null | number {
  const n = Number(texto(bruto));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A comissão do empreendimento e o cadastro da coordenadora de vendas.
 *
 * ⚠️ A CHAVE DE `apolo_enterprise_settings` É O ID DO C2X, NÃO O UUID DO HÉRCULES. Medido em
 * 08/09/2026: `enterprise_id` é a CHAVE PRIMÁRIA da tabela, é TEXTO, e casa com
 * `hercules_empreendimentos.c2x_enterprise_id` — 13 dos 38 empreendimentos têm linha lá, todas
 * casando por esse texto. Mandar `proposta.empreendimento_id` (um uuid) devolveria zero linha e a
 * comissão sairia em branco em TODO contrato, sem erro nenhum. É a mesma chave de
 * `__empreendimento_id` e de `temis_minutas.enterprise_id`.
 *
 * ⚠️ E TRÊS EMPREENDIMENTOS NÃO TÊM ESSE ID: LOX, PDX e RDX estão com `c2x_enterprise_id` NULO e
 * respondem por 1.822 propostas (777 do RDX, 573 do LOX, 472 do PDX, medidos em 08/09/2026) — os
 * mesmos três da nota de `__unidade_enterprise_id`. Para eles a unidade carrega o id na própria
 * coluna, e é por ela que a leitura passa. Hoje isso não muda uma linha do papel (nenhuma das
 * divisões desses três tem linha de settings), e existe para que cadastrar a comissão pela tela
 * funcione nos três sem uma segunda correção depois.
 *
 * ⚠️ A DIVISÃO DA UNIDADE VEM PRIMEIRO, E O PAI SÓ COMPLETA (18/09/2026). A venda importada aponta
 * para o PAI (VLO, 35), e a comissão lia só a chave do empreendimento: o VLO tem a coordenadora e os
 * percentuais NULOS, e o VOC (37), a divisão onde o lote está, tem 2% e 4%. O distrato do VOC Q09 L11
 * saía com "o empreendimento não tem os percentuais de comissão cadastrados" — medido: 416 vendas
 * vivas nessa situação. É a precedência que o Lucas deu para o pai e o filho (08/09/2026): *"o pai
 * sempre será o referencial, ele é o macro"*, e o filho que configurou usa o seu; o que o filho não
 * configurou, herda. A ordem é: a divisão da unidade, o empreendimento da proposta, o pai dele.
 *
 * ⚠️ HERDA CAMPO A CAMPO, e não linha a linha: a linha do VLO existe (tem a coordenadora) com os
 * percentuais nulos, e "tem linha" não pode significar "tem percentual". A MINUTA não muda: continua
 * a do pai (`__empreendimento_id`), porque o texto do contrato é do loteamento inteiro.
 */
async function comissaoDoEmpreendimento(
  sb: SupabaseClient,
  empreendimento: LinhaDoEmpreendimento | null,
  unidade: LinhaDaUnidade | null,
): Promise<ComissaoDaVenda> {
  const chaves = await chavesDaComissao(sb, empreendimento, unidade);
  if (chaves.length === 0) return { coordenadora: null, percentuais: null };

  const linhas = await Promise.all(
    chaves.map((chave) =>
      umaLinha<LinhaDaComissao>(
        sb
          .from("apolo_enterprise_settings")
          .select(
            "comissao_coordenadora_percentual, comissao_imobiliaria_percentual, coordenadora_entity_id",
          )
          .eq("enterprise_id", chave)
          .maybeSingle(),
        "apolo_enterprise_settings",
      ),
    ),
  );

  const percentuais = herdarComissao(linhas);

  return {
    coordenadora: await cadastroDaCoordenadora(sb, texto(percentuais?.coordenadora_entity_id)),
    percentuais,
  };
}

/** A divisão da unidade, o empreendimento da proposta e o pai dele — nessa ordem, sem repetição. */
async function chavesDaComissao(
  sb: SupabaseClient,
  empreendimento: LinhaDoEmpreendimento | null,
  unidade: LinhaDaUnidade | null,
): Promise<string[]> {
  const chaves = [texto(unidade?.enterprise_id), texto(empreendimento?.c2x_enterprise_id)];

  // O pai só é lido quando existe: o empreendimento da venda importada JÁ É o pai, e o nativo de uma
  // divisão (VOL 36) precisa subir um degrau para herdar do VLO o que não configurou.
  const paiId = texto(empreendimento?.pai_id);
  if (paiId) {
    const pai = await umaLinha<{ c2x_enterprise_id: null | string }>(
      sb.from("hercules_empreendimentos").select("c2x_enterprise_id").eq("id", paiId).maybeSingle(),
      "hercules_empreendimentos",
    );
    chaves.push(texto(pai?.c2x_enterprise_id));
  }

  return [...new Set(chaves.filter(Boolean))];
}

/** O primeiro valor NÃO NULO de cada campo, na ordem das chaves. Zero é valor (ver `gerais`). */
function herdarComissao(linhas: (LinhaDaComissao | null)[]): LinhaDaComissao | null {
  const vivas = linhas.filter((l): l is LinhaDaComissao => objeto(l) !== null);
  if (vivas.length === 0) return null;

  const primeiro = (campo: keyof LinhaDaComissao) =>
    vivas.map((l) => l[campo]).find((v) => v !== null && v !== undefined && texto(v) !== "") ?? null;

  return {
    comissao_coordenadora_percentual: primeiro("comissao_coordenadora_percentual"),
    comissao_imobiliaria_percentual: primeiro("comissao_imobiliaria_percentual"),
    coordenadora_entity_id: primeiro("coordenadora_entity_id") as null | string,
  };
}

/**
 * O cadastro da coordenadora de vendas — os nove campos que o bloco "a." do contrato imprime.
 *
 * ⚠️ ID ÓRFÃO É "SEM COORDENADORA", E NÃO ERRO. A 0145 deixou a coluna SEM foreign key de propósito
 * (`apolo_entities` recebe merge e arquivamento, e uma FK rígida transformaria uma limpeza de
 * cadastro em erro de gravação numa tela que não tem nada a ver com isso). Aqui o id que não acha
 * ninguém vira a mesma lacuna visível de sempre: os colchetes no papel e um aviso na conferência.
 *
 * ⚠️ E O ENDEREÇO PASSA PELA MESMA CASCATA DO COMPRADOR. A coordenadora é um cadastro do Apolo como
 * outro qualquer, e o endereço dela pode estar em `apolo_addresses` (587 das 591 entidades PJ têm
 * linha lá, medido em 08/09/2026) ou em `metadata.cadastro`, a camada que o wizard grava e que
 * ficava sem ser lida (50 das 591). `unirEndereco` é a mesma regra que a CAD assinada e o envio ao
 * C2X seguem — uma segunda precedência aqui faria o contrato divergir do papel já assinado.
 */
async function cadastroDaCoordenadora(
  sb: SupabaseClient,
  id: string,
): Promise<CadastroDaCoordenadora | null> {
  if (!id) return null;

  const [entidade, contatos, enderecos] = await Promise.all([
    umaLinha<LinhaDaEntidade>(
      sb
        .from("apolo_entities")
        .select("display_name, document_masked, entity_kind, id, legal_name, metadata, trade_name")
        .eq("id", id)
        .maybeSingle(),
      "apolo_entities",
    ),
    varias<LinhaDoContato>(
      sb
        .from("apolo_contacts")
        .select("contact_type, entity_id, value")
        .eq("entity_id", id)
        .order("is_primary", { ascending: false }),
      "apolo_contacts",
    ),
    varias<LinhaDoEndereco>(
      sb
        .from("apolo_addresses")
        .select("city, complement, district, entity_id, number, postal_code, state, street")
        .eq("entity_id", id)
        .order("is_primary", { ascending: false }),
      "apolo_addresses",
    ),
  ]);

  if (!entidade) return null;

  const primeiro = enderecos[0] ?? null;
  const endereco = unirEndereco(cadastroDaEntidade(null, entidade), {
    bairro: texto(primeiro?.district),
    cep: texto(primeiro?.postal_code),
    cidade: texto(primeiro?.city),
    complemento: texto(primeiro?.complement),
    logradouro: texto(primeiro?.street),
    numero: texto(primeiro?.number),
    uf: texto(primeiro?.state),
  });

  return {
    bairro: texto(endereco?.bairro),
    cep: texto(endereco?.cep),
    // ⚠️ A UF SOZINHA NÃO É UMA CIDADE — o mesmo corte de `cidade_cliente`. Juntar o que existir
    // faria o contrato dizer que a coordenadora fica "em MG": endereço que parece preenchido, não
    // entra nos avisos e não localiza ninguém.
    cidade: endereco?.cidade ? [endereco.cidade, endereco.uf].filter(Boolean).join("/") : "",
    // ⚠️ CPF TAMBÉM VALE AQUI, apesar de a variável se chamar `cnpj_coordenadora_vendas`: a linha do
    // contrato é "CPF/CNPJ DA COORDENADORA DE VENDAS", e coordenar venda como pessoa física é
    // possível. `documentoImprimivel` é quem barra o documento truncado, dos dois tipos.
    documento: documentoImprimivel(texto(entidade.document_masked)),
    email: primeiroContato(contatos, ["email"]),
    // ⚠️ NOME FANTASIA PRIMEIRO, COM O `display_name` DE RESERVA. A variável se chama
    // `nome_fantasia_coordenadora_vendas` e `trade_name` é o campo certo — mas 19 das 590 entidades
    // PJ do Apolo estão sem ele (medido em 08/09/2026), e as 19 têm `display_name`. Sem a reserva o
    // bloco sairia sem nome com o cadastro ali do lado.
    nome: texto(entidade.trade_name) || texto(entidade.display_name) || texto(entidade.legal_name),
    numero: texto(endereco?.numero),
    razaoSocial: texto(entidade.legal_name) || texto(entidade.display_name),
    // Ver `RUIDO_DE_CARGA`: "Endereco cadastral" está na coluna `street` de 4.633 linhas e já saiu
    // impresso num contrato real.
    rua: textoUtil(endereco?.logradouro),
    // ⚠️ WHATSAPP ANTES DE `phone` — a mesma ordem de `cadastroDoVinculado`, pelo mesmo motivo:
    // 3.941 entidades só têm a linha `whatsapp`.
    telefone: primeiroContato(contatos, ["whatsapp", "phone"]),
  };
}

function umComprador(entrada: {
  avisos: string[];
  conjuge: LinhaDoRelacionamento | null;
  daProposta: CompradorDaProposta;
  digitos: string;
  /** Já resolvido por `pessoaCompletada`: a ficha e depois `apolo_contacts`, a escolhida primeiro. */
  email: string;
  endereco: LinhaDoEndereco | null;
  entidade: LinhaDaEntidade | null;
  ficha: null | Record<string, unknown>;
  /** Idem, com `whatsapp` antes de `phone`. */
  telefone: string;
}): DadosDoComprador {
  const { avisos, daProposta, digitos, endereco, entidade, ficha } = entrada;
  const valores: Record<string, string> = {};
  const por = (nome: string, valor: string) => {
    // Ver a nota do topo: chave sem valor NÃO entra — o motor imprime `[nome]` e alguém vê.
    if (valor) valores[nome] = valor;
  };

  // ⚠️ O TIPO DECIDE QUAL PARÁGRAFO SAI, e errar aqui é o defeito do Villa Paris (bloco de pessoa
  // jurídica impresso num comprador pessoa física).
  //
  // ⚠️ O DOCUMENTO VENCE O `entity_kind` QUANDO OS DOIS DISCORDAM, e isso foi medido em 08/09/2026:
  // SEIS entidades têm documento de 11 dígitos — um CPF — e `entity_kind = 'pj'`, e CINCO delas são
  // compradoras de propostas reais (José Carlos de Arruda, no Cidade Jardim, é um MEI). No contrato
  // dessas pessoas o CPF era gravado no slot do CNPJ, formatado como CPF ("894.473.446-15" onde o
  // texto anuncia um CNPJ), e o bloco `[inicio_dados_cliente_pj]` substituía o de pessoa física: a
  // qualificação inteira — estado civil, regime de bens, cônjuge — SUMIA do papel.
  //
  // ⚠️ E NINGUÉM ERA AVISADO. A conferência só cobra `cnpj_cliente` e `razao_social_cliente` quando
  // o comprador não é PF, e os dois estavam preenchidos: zero avisos, contrato pronto para assinar.
  //
  // O tamanho do documento é o fato mais duro que existe aqui: 11 dígitos é CPF, 14 é CNPJ, e nenhum
  // cadastro mal marcado muda isso. O `entity_kind` só decide quando o documento não responde.
  const ehPessoaFisica = digitos.length === 11
    ? true
    : digitos.length === 14
      ? false
      : entidade
        ? texto(entidade.entity_kind).toLowerCase() !== "pj"
        : true;

  const nomeDaProposta = texto(daProposta.nome);
  const nome = texto(entidade?.display_name) || nomeDaProposta;
  // ⚠️ O DOCUMENTO SE RECONSTRÓI DOS DÍGITOS, e não se copia de onde veio. Ver `documentoImprimivel`:
  // meio CPF atravessa `formatarDocumento` intacto e sai impresso, e `document_masked` guarda o
  // número sem pontuação em parte das linhas.
  const documento =
    documentoImprimivel(digitos) || documentoImprimivel(texto(entidade?.document_masked));

  por("nome_cliente", nome);
  // Todo participante de uma proposta compra; cedente e demais papéis são de outro documento
  // (cessão), que tem minuta própria.
  por("identificacao_cliente", "COMPRADOR");

  if (ehPessoaFisica) {
    por("cpf_cliente", documento);
  } else {
    por("cnpj_cliente", documento);
    por("razao_social_cliente", texto(entidade?.legal_name));
    por("nome_fantasia_cliente", texto(entidade?.trade_name));
  }

  const participacao = participacaoDoComprador(daProposta);
  if (participacao !== null && participacao > 0) por("percentual_cliente", percentual(participacao));

  por("nacionalidade_cliente", texto(ficha?.nacionalidade));
  por("estado_civil_cliente", rotuloDoId(C2X_ESTADO_CIVIL, ficha?.estadoCivilId));
  por("regime_casamento_cliente", rotuloDoId(C2X_REGIME_BENS, ficha?.regimeBensId));
  // ⚠️ O TEXTO LIVRE GANHA DO ID. Quem digitou a profissão à mão o fez porque a lista não tinha a
  // dela; preferir o id nesse caso imprimiria no contrato a profissão que o operador RECUSOU.
  por(
    "profissao_cliente",
    texto(ficha?.profissaoOutro) || rotuloDoId(C2X_PROFISSOES, ficha?.profissaoId),
  );
  // ⚠️ O ÓRGÃO SOZINHO NÃO É UM RG. A ficha guarda `rg` e `orgaoEmissor` em campos separados, e
  // juntar o que existir produzia "portador da cédula de identidade nº SSP/MG" quando só o órgão
  // estava preenchido — um contrato que parece completo e não identifica ninguém. Sem o NÚMERO, a
  // variável não existe: aí ela sai como `[rg_cliente]` no texto e entra na lista de avisos, que é
  // como se descobre o buraco antes de imprimir.
  const numeroDoRg = texto(ficha?.rg);
  por(
    "rg_cliente",
    numeroDoRg ? [numeroDoRg, texto(ficha?.orgaoEmissor)].filter(Boolean).join(" ") : "",
  );
  por("data_nascimento_cliente", dataBR(texto(ficha?.dataNascimento)));

  // ⚠️ A FICHA GANHA, MAS `apolo_contacts` É QUEM TEM O DADO DE QUEM NUNCA FOI EDITADO À MÃO. É a
  // mesma cascata do endereço, e o motivo é o mesmo: no wizard o contato nasce na tabela.
  por("email_cliente", entrada.email);
  // ⚠️ `whatsapp` ANTES DE `phone`, e o jsonb da proposta por último. A ordem dos dois primeiros é a
  // mesma de `c2x-write-server.ts`: 3.941 entidades só têm a linha `whatsapp`, e preferir `phone`
  // faria o contrato imprimir o fixo enquanto o resto do Panteon fala com o celular da pessoa. O
  // terceiro degrau é o único contato que o comprador NÃO titular costuma ter — ele não tem
  // reserva, pode não ter CAD e pode nem ter entidade no Apolo (ver `CompradorDaProposta.telefone`).
  por("telefone_cliente", entrada.telefone || texto(daProposta.telefone));

  const enderecoUnido = unirEndereco(ficha, enderecoDaTabela(endereco));
  if (enderecoUnido) {
    // ⚠️ `textoUtil` E NÃO O VALOR CRU: 4.633 cadastros têm a string "Endereco cadastral" gravada na
    // coluna da rua, e ela saiu impressa num contrato real ("residente e domiciliado na Endereco
    // cadastral, nº..."). Ver `RUIDO_DE_CARGA`.
    por("rua_cliente", textoUtil(enderecoUnido.logradouro));
    por("numero_cliente", enderecoUnido.numero);
    por("bairro_cliente", enderecoUnido.bairro);
    por("cep_cliente", enderecoUnido.cep);
    // "João Monlevade/MG" — é como o catálogo pede e como a qualificação escreve.
    //
    // ⚠️ A UF SOZINHA NÃO É UMA CIDADE, e é o mesmo defeito do RG logo acima: juntar o que existir
    // faria o contrato dizer "residente e domiciliado em MG" — endereço que parece preenchido, não
    // entra nos avisos e não localiza ninguém.
    por(
      "cidade_cliente",
      enderecoUnido.cidade
        ? [enderecoUnido.cidade, enderecoUnido.uf].filter(Boolean).join("/")
        : "",
    );
  }

  // ⚠️ O CÔNJUGE VEM DAS DUAS FONTES, com a ficha ganhando campo a campo. No wizard ele nasce em
  // `apolo_relationships` e a ficha só o recebe se alguém editou — ler só a ficha faria um casado
  // sair no contrato sem cônjuge, que é o assinante que falta no cartório.
  const conjuge = unirConjuge(ficha, conjugeDaTabela(entrada.conjuge));

  if (conjuge) {
    por("nome_conjuge", conjuge.nome);
    // Mesma trava do documento do titular: "nao informado" ou meio CPF não viram campo preenchido.
    por("cpf_conjuge", documentoImprimivel(conjuge.cpf));
    por("email_conjuge", conjuge.email);
    por("telefone_conjuge", conjuge.telefone);
    por("nacionalidade_conjuge", conjuge.nacionalidade);
    por(
      "profissao_conjuge",
      texto(ficha?.conjugeProfissaoOutro) || rotuloDoId(C2X_PROFISSOES, conjuge.profissaoId),
    );
  }

  conferir({
    avisos,
    conjuge: Boolean(conjuge),
    ehPessoaFisica,
    ficha,
    nome: nome || nomeDaProposta || documento || "Comprador sem nome",
    participacao,
    temEndereco: Boolean(enderecoUnido),
    temEntidade: Boolean(entidade),
    valores,
  });

  return { ehCasado: ehCasado(ficha), ehPessoaFisica, temConjuge: Boolean(conjuge), valores };
}

/**
 * Casado ou em união estável — os dois estados civis que têm regime de bens.
 *
 * ⚠️ SEM ESTADO CIVIL A RESPOSTA É `undefined`, E NÃO `false`. Quem não preencheu a ficha fica com a
 * cláusula do regime LIGADA e com o `[regime_casamento_cliente]` visível no papel, que é o aviso que
 * faz alguém completar o cadastro. Devolver `false` apagaria a oração de um casado sem ficha — e o
 * contrato iria a cartório sem dizer o regime de bens, calado.
 */
function ehCasado(ficha: null | Record<string, unknown>): boolean | undefined {
  const civil = texto(ficha?.estadoCivilId);
  if (!civil) return undefined;
  return civil === "2" || civil === "6";
}

/** O que faltou neste comprador, numa frase só. Ver a nota de `dadosDaProposta` sobre ruído. */
function conferir(entrada: {
  avisos: string[];
  conjuge: boolean;
  ehPessoaFisica: boolean;
  ficha: null | Record<string, unknown>;
  nome: string;
  participacao: null | number;
  temEndereco: boolean;
  temEntidade: boolean;
  valores: Record<string, string>;
}): void {
  const { avisos, ficha, nome, valores } = entrada;

  if (!entrada.temEntidade) {
    // ⚠️ UM AVISO, E NÃO DOZE. Sem entidade não há ficha, endereço nem cônjuge: listar cada campo
    // faltando repetiria a mesma causa doze vezes e esconderia os outros compradores no meio.
    avisos.push(
      `${nome}: sem cadastro no Apolo para este CPF — a qualificação inteira ficou em branco.`,
    );
    return;
  }

  const faltando: string[] = [];
  if (!valores.nome_cliente) faltando.push("nome");
  if (entrada.ehPessoaFisica) {
    if (!valores.cpf_cliente) faltando.push("CPF");
    if (!valores.nacionalidade_cliente) faltando.push("nacionalidade");
    if (!valores.estado_civil_cliente) faltando.push("estado civil");
    if (!valores.profissao_cliente) faltando.push("profissão");
    // ⚠️ O RG NÃO É COBRADO. Lucas (18/09/2026): *"rg não precisa"*. E metade do Panteon não o tem:
    // medido no mesmo dia, `metadata.cadastro` tem o órgão emissor em 215 entidades e o número em
    // ZERO (ver `cadastroDaEntidade`), e a ficha da esteira tem o número em 406 de 835. Cobrá-lo punha
    // "falta RG" em quase todo card de CAD pública. Se o número existir, ele continua impresso; se não
    // existir, a oração do RG sai do papel (`semOracaoDoRg`, em `preencher-contrato.ts`).
    if (!valores.data_nascimento_cliente) faltando.push("data de nascimento");
  } else {
    if (!valores.cnpj_cliente) faltando.push("CNPJ");
    if (!valores.razao_social_cliente) faltando.push("razão social");
  }
  if (!entrada.temEndereco) faltando.push("endereço");
  if (entrada.participacao === null || entrada.participacao <= 0) faltando.push("participação");

  if (faltando.length > 0) {
    avisos.push(`${nome}: falta ${listar(faltando)} no cadastro.`);
  }

  // ⚠️ CASADO SEM CÔNJUGE É OUTRO PROBLEMA, e não "mais um campo vazio": o bloco
  // `[inicio_dados_conjuge]` some inteiro, e o contrato vai a cartório sem o assinante que a
  // comunhão de bens exige. Só a Separação de bens dispensa a assinatura, e mesmo ela costuma pedir.
  const civil = texto(ficha?.estadoCivilId);
  if (!entrada.conjuge && (civil === "2" || civil === "6")) {
    avisos.push(`${nome}: consta casado(a) e não tem cônjuge cadastrado.`);
  }

  // ⚠️ REGIME DE BENS FALTANDO SÓ IMPORTA PARA QUEM É CASADO. Cobrá-lo de solteiro poria um aviso
  // em quase todo contrato — e aviso que sempre aparece é aviso que ninguém lê.
  if ((civil === "2" || civil === "6") && !valores.regime_casamento_cliente) {
    avisos.push(`${nome}: casado(a) sem regime de bens no cadastro.`);
  }
}

// ── O QUE NÃO É POR COMPRADOR ────────────────────────────────────────────────

function gerais(
  proposta: LinhaDaProposta,
  unidade: LinhaDaUnidade | null,
  empreendimento: LinhaDoEmpreendimento | null,
  vendeu: QuemVendeu,
  comissao: ComissaoDaVenda,
  avisos: string[],
  financeiro: { carteira: CarteiraDaVenda | null; fatos: FatosApurados | null },
): Record<string, string> {
  const g: Record<string, string> = {};
  const por = (nome: string, valor: string) => {
    if (valor) g[nome] = valor;
  };

  /** O par valor/extenso, sempre junto — ver a nota 3 do catálogo. */
  const parDeDinheiro = (nome: string, valor: null | number, extensoPronto = "") => {
    if (valor === null) return;
    por(nome, emReais(valor));
    por(`${nome}_extenso`, extensoPronto || dinheiroPorExtenso(valor));
  };

  // ── A DATA DE EMISSÃO ──
  //
  // ⚠️ É HOJE, E NÃO A DATA DA PROPOSTA. O contrato se emite quando se emite; datá-lo com o dia em
  // que a proposta foi montada faria o documento nascer com semanas de atraso, e o prazo de
  // arrependimento e o primeiro vencimento contam a partir da assinatura, não da negociação.
  const hoje = hojeEmBrasilia(new Date());
  por("data_emissao_contrato", dataBR(hoje));
  por("data_emissao_contrato_extenso", dataPorExtenso(hoje));

  // ── UNIDADE ──
  if (unidade) {
    const quadra = texto(unidade.quadra);
    const lote = texto(unidade.lote);
    por("numero_quadra", quadra);
    por("unidade_quadra", quadra);
    por("numero_lote", lote);
    por("unidade_lote", lote);
    // ⚠️ QUADRA "A" NÃO TEM EXTENSO. Metade dos empreendimentos numera quadras com letra, e
    // `inteiroPorExtenso("A")` escreveria "zero" no contrato — pior do que não escrever nada.
    por("numero_quadra_extenso", extensoDeInteiro(quadra));
    por("numero_lote_extenso", extensoDeInteiro(lote));

    const area = numero(unidade.area);

    // ── O APARTAMENTO (onda 2, vertical) ──
    //
    // ⚠️ É O APARTAMENTO PREENCHIDO QUE DIZ "PRÉDIO", a mesma porta de `ehUnidadeVertical`: o
    // loteamento nunca tem a coluna, e o prédio nunca tem quadra e lote. As variáveis do prédio só
    // nascem nele; num lote elas não existem e a minuta de loteamento nem as pede.
    //
    // ⚠️ A ÁREA PRIVATIVA LÊ A MESMA COLUNA `area` (a 0171 não criou outra; ver o catálogo). O extenso
    // gravado ganha; sem ele, o número vira extenso aqui, porque a unidade cadastrada pelo Panteon
    // nasce com `area_extenso` nulo.
    const apartamento = texto(unidade.apartamento);
    if (apartamento) {
      por("numero_torre", texto(unidade.torre));
      por("numero_andar", inteiroComoTexto(unidade.andar));
      por("numero_apartamento", apartamento);
      // "304" tem extenso; "304-A" não, e não ganha um "zero" inventado (a régua da quadra com letra).
      por("numero_apartamento_extenso", extensoDeInteiro(apartamento));
      por("tipologia", texto(unidade.tipologia));
      por("vagas", inteiroComoTexto(unidade.vagas));
      if (area !== null) {
        por("area_privativa", `${comDuasCasas(area)} m²`);
        por("area_privativa_extenso", texto(unidade.area_extenso) || areaPorExtenso(area));
      }
    }

    if (area !== null) {
      por("area_lote", `${comDuasCasas(area)} m²`);
      por("unidade_area", comDuasCasas(area));
      // ⚠️ O EXTENSO NÃO REPETE A UNIDADE. `areaPorExtenso` devolve "trezentos metros quadrados", e
      // `[area_lote]` já traz o "m²": foi somar as duas coisas que produziu "trezentos metros
      // quadrados metros quadrados" num contrato real do Villa Paris.
      por("area_lote_extenso", texto(unidade.area_extenso) || areaPorExtenso(area));
    } else {
      avisos.push("A unidade não tem área cadastrada.");
    }

    por("numero_matricula", texto(unidade.matricula));
    por("numero_ficha_matricula", texto(unidade.matricula_livro));
    por("codigo_unidade", texto(unidade.codigo));
    por("tipo_unidade", texto(unidade.tipo_unidade));

    parDeDinheiro(
      "preco_tabela_unidade",
      numero(unidade.preco_tabela),
      texto(unidade.preco_extenso),
    );

    if (!texto(unidade.matricula)) {
      avisos.push("A unidade não tem matrícula: a qualificação do imóvel sai incompleta.");
    }
  } else {
    // ⚠️ SEM A UNIDADE NÃO SE SABE SE É LOTE OU APARTAMENTO, e o aviso fala dos dois: dizer só
    // "quadra e lote" num prédio mandaria alguém procurar o que o prédio não tem.
    avisos.push(
      "A proposta não aponta para nenhuma unidade: a identificação do imóvel (quadra e lote, ou torre e apartamento no prédio), a área e a matrícula ficaram em branco.",
    );
  }

  // ⚠️ O MESMO ID, PELA UNIDADE. Três empreendimentos (LOX, PDX, RDX) têm `c2x_enterprise_id` nulo,
  // e a minuta é indexada por esse id — para eles a prévia nunca acharia minuta. A unidade carrega o
  // mesmo número na sua própria coluna, vindo de outra carga, e serve de segundo caminho. Prefixo
  // `__` pelo mesmo motivo do outro: nenhuma minuta escreve `[__unidade_enterprise_id]`.
  const unidadeEnterpriseId = texto(unidade?.enterprise_id);
  if (unidadeEnterpriseId) por("__unidade_enterprise_id", unidadeEnterpriseId);

  // ⚠️ OS DOIS QUE FALTAVAM PARA A CADEIA DO CONTRATO EXISTIR (21/09/2026). Mesmo prefixo `__` e
  // mesmo motivo dos outros: nenhuma minuta escreve `[__unidade_categoria_id]`, então eles viajam
  // em `gerais` sem virar texto no papel.
  //
  // ⚠️ SEM A CATEGORIA AQUI, O DEGRAU MAIS ESPECÍFICO DA CADEIA NÃO EXISTE. O comentário de
  // `contrato-da-proposta.ts` já dizia, desde 08/09, que *"a CATEGORIA DEVERIA MANDAR, e ainda não
  // manda"*, e apontava para lá como "o único lugar a mudar" — mas o dado nem chegava ao motor, e
  // o primeiro lugar a mudar era este.
  //
  // ⚠️ E O ID DA UNIDADE É O ALCANCE MAIS FINO DOS ANEXOS. `temis_anexos.unidade_id` guarda o uuid
  // de `hercules_unidades`, que é o mesmo `proposta.unidade_id`: a planta daquele lote e só dele.
  const unidadeCategoriaId = texto(unidade?.categoria_id);
  if (unidadeCategoriaId) por("__unidade_categoria_id", unidadeCategoriaId);

  const unidadeId = texto(proposta.unidade_id);
  if (unidadeId) por("__unidade_id", unidadeId);

  // ── EMPREENDIMENTO ──
  if (empreendimento) {
    por("empreendimento_nome", texto(empreendimento.nome));
    por("empreendimento_codigo", texto(empreendimento.codigo));
    por("empreendimento_cidade", texto(empreendimento.cidade));
    por("empreendimento_uf", texto(empreendimento.uf));
    // ⚠️ ESTA CHAVE NÃO É UMA VARIÁVEL DO CONTRATO — é como a prévia acha a MINUTA. A rota
    // `/api/temis/contrato/previa` lê `dados.gerais.__empreendimento_id` para procurar a minuta
    // publicada do empreendimento; sem ela a busca ia com string vazia, não casava nunca, e TODA
    // prévia respondia "Não há minuta de contrato PUBLICADA para este empreendimento" — o motor
    // inteiro inalcançável por um campo que ninguém escrevia.
    //
    // ⚠️ E O ID É O DO C2X, NÃO O UUID DO HÉRCULES. `temis_minutas.enterprise_id` guarda o mesmo id
    // que `apolo_enterprise_settings.enterprise_id` e `hercules_unidades.enterprise_id` ("39" para o
    // JDG). Mandar o uuid de `hercules_empreendimentos.id` daria zero linha, calado.
    //
    // ⚠️ O PREFIXO `__` É O QUE A MANTÉM FORA DO PAPEL: `preencherContrato` só resolve o nome que a
    // minuta pede, e nenhuma minuta escreve `[__empreendimento_id]`.
    por("__empreendimento_id", texto(empreendimento.c2x_enterprise_id));
  } else {
    avisos.push("A proposta não aponta para nenhum empreendimento.");
  }

  // ── CORRETAGEM ──
  //
  // ⚠️ O "VINCULADO" É A IMOBILIÁRIA, E O CORRETOR ENTRA SÓ QUANDO NÃO HÁ UMA. É a mesma precedência
  // do split do C2X: quem recebe a comissão é a imobiliária quando ela existe, e o corretor autônomo
  // quando a venda foi direta. Inverter faria o contrato de corretagem nomear como beneficiário
  // quem não recebe.
  //
  // ⚠️ E AQUI SE LÊ O NOME DESNORMALIZADO DA PROPOSTA, não a entidade do Apolo. Nas propostas
  // importadas do C2X — que são a esmagadora maioria — `imobiliaria_nome` está preenchido e o
  // vínculo com `apolo_entities` não existe. Buscar pela entidade deixaria o contrato de corretagem
  // SEM BENEFICIÁRIO em quase toda venda de hoje. O nome basta para o texto.
  //
  // ⚠️ E O NOME DA PROPOSTA CONTINUA GANHANDO. O que `quemVendeuPeloApolo` achou só entra onde a
  // proposta está em branco — na importada, o corretor (a carga o gravou vazio em todas).
  const imobiliariaNome = texto(proposta.imobiliaria_nome) || vendeu.imobiliariaNome;
  const corretorNome = texto(proposta.corretor_nome) || vendeu.corretorNome;
  const vinculado = imobiliariaNome || corretorNome;
  if (vinculado) {
    por("nome_vinculado", vinculado);
    por("imobiliaria_nome", imobiliariaNome);
    por("corretor_nome", corretorNome);
  }

  // ⚠️ O CADASTRO DA IMOBILIÁRIA SÓ ENTRA COM VÍNCULO POR ID. Ver `cadastroDoVinculado`: as nativas
  // guardam `imobiliaria_entity_id` (vem da reserva); as importadas chegam pela ponte do
  // `imobiliaria_c2x_id` (ver `quemVendeuPeloApolo`). Sem nenhum dos dois, os três ficam em branco.
  const doVinculado = vendeu.vinculado;
  if (doVinculado) {
    por("creci_vinculado", doVinculado.creci);
    por("cpf_cnpj_vinculado", doVinculado.documento);
    por("telefone_vinculado", doVinculado.telefone);
    por("email_vinculado", doVinculado.email);
  }


  // ── VALORES ──
  //
  // ⚠️ O MESMO NÚMERO COM DOIS NOMES, DE PROPÓSITO. `valor_imovel_venda` e `preco_venda` são os dois
  // nomes que as minutas do legado usam para o preço; escrever só um faria metade delas imprimir
  // `[preco_venda]` no papel.
  const valor = numero(proposta.valor);
  if (valor === null) {
    avisos.push("A proposta não tem valor negociado.");
  } else {
    parDeDinheiro("valor_imovel_venda", valor);
    parDeDinheiro("preco_venda", valor);
  }

  // ── A COMISSÃO E A COORDENADORA DE VENDAS ──
  //
  // ⚠️ ESTA SEÇÃO FICA DEPOIS DO PREÇO, e não junto do bloco de corretagem lá em cima, porque as três
  // linhas de dinheiro são percentual SOBRE O VALOR VENDIDO: elas dependem do `valor` que a seção
  // anterior acabou de ler.
  //
  // ⚠️ NULO NÃO É ZERO, e essa distinção é a razão de ser do bloco. Percentual não cadastrado NÃO
  // escreve a variável: o motor imprime `[valor_total_comissao]` no papel, e o colchete é o aviso
  // para alguém cadastrar. Percentual ZERO é decisão — empreendimento em que aquela ponta não recebe
  // — e imprime R$ 0,00. Um contrato que imprime R$ 0,00 foi decidido; um que imprime o colchete foi
  // esquecido. Ver a migration 0145.
  //
  // ⚠️ E O TOTAL É A SOMA DAS DUAS LINHAS IMPRESSAS, somada em CENTAVOS INTEIROS. Medido: uma venda
  // de R$ 170.010,08 a 1,5% e 5% imprime R$ 2.550,15 e R$ 8.500,50 — que somam R$ 11.050,65. A
  // mesma conta feita em reais dá 11050.6552, que vira R$ 11.050,66 no papel: um centavo A MAIS do
  // que as duas quantias que o próprio contrato manda somar, na mesma frase. Um documento que se
  // contradiz por um centavo é um documento que volta do jurídico.
  const pctCoordenadora = numero(comissao.percentuais?.comissao_coordenadora_percentual);
  const pctVinculado = numero(comissao.percentuais?.comissao_imobiliaria_percentual);

  por("percentual_comissao_coordenadora_vendas", pctCoordenadora === null ? "" : percentual(pctCoordenadora));
  por("percentual_comissao_vinculado", pctVinculado === null ? "" : percentual(pctVinculado));

  if (valor !== null) {
    const emCentavos = Math.round(valor * 100);
    const daCoordenadora = pctCoordenadora === null ? null : parteEmCentavos(emCentavos, pctCoordenadora);
    const doVinculadoEmCentavos = pctVinculado === null ? null : parteEmCentavos(emCentavos, pctVinculado);

    if (daCoordenadora !== null) {
      parDeDinheiro("valor_pago_coordenadora_vendas", daCoordenadora / 100);
    }
    if (doVinculadoEmCentavos !== null) {
      parDeDinheiro("valor_corretagem_menos_coordenadora_vendas", doVinculadoEmCentavos / 100);
    }
    // ⚠️ O TOTAL SÓ EXISTE COM AS DUAS PONTAS. Com uma delas nula a soma é DESCONHECIDA, e escrever a
    // outra sozinha no lugar dela imprimiria no contrato uma comissão total menor do que a combinada
    // — em cima da frase que diz que o total "refere-se à intermediação". Melhor o colchete.
    if (daCoordenadora !== null && doVinculadoEmCentavos !== null) {
      const comissaoEmCentavos = daCoordenadora + doVinculadoEmCentavos;
      parDeDinheiro("valor_total_comissao", comissaoEmCentavos / 100);
      // ⚠️ O CUSTO TOTAL É O LOTE MAIS A COMISSÃO, e sem ele a minuta repete o preço do lote nas duas
      // linhas: Lucas, 20/09/2026, no contrato do Vale do Ouro — *"O preço do lote e da aquisição não
      // podem ser os mesmos"*. A soma é em CENTAVOS INTEIROS, pela mesma razão da nota acima: em
      // reais ela erra um centavo para cima e o documento se contradiz sozinho.
      parDeDinheiro("valor_custo_total_aquisicao", (emCentavos + comissaoEmCentavos) / 100);
    }
  }

  if (comissao.coordenadora) {
    por("nome_fantasia_coordenadora_vendas", comissao.coordenadora.nome);
    por("razao_social_coordenadora_vendas", comissao.coordenadora.razaoSocial);
    por("cnpj_coordenadora_vendas", comissao.coordenadora.documento);
    por("rua_coordenadora_vendas", comissao.coordenadora.rua);
    por("numero_coordenadora_vendas", comissao.coordenadora.numero);
    por("bairro_coordenadora_vendas", comissao.coordenadora.bairro);
    por("cidade_coordenadora_vendas", comissao.coordenadora.cidade);
    por("cep_coordenadora_vendas", comissao.coordenadora.cep);
    por("telefone_coordenadora_vendas", comissao.coordenadora.telefone);
    por("email_coordenadora_vendas", comissao.coordenadora.email);
  }

  // ⚠️ UM AVISO POR CAUSA, E NÃO UM POR CAMPO. Sem coordenadora cadastrada são NOVE variáveis vazias
  // e uma frase só; sem os percentuais são seis e outra frase. É a mesma regra de `conferir`: aviso
  // repetido esconde os outros no meio.
  if (pctCoordenadora === null && pctVinculado === null) {
    avisos.push(
      "O empreendimento não tem os percentuais de comissão cadastrados: os valores da corretagem saem em branco.",
    );
  } else if (pctCoordenadora === null) {
    avisos.push(
      "O empreendimento não tem o percentual da coordenadora: a parte dela e a comissão total saem em branco.",
    );
  } else if (pctVinculado === null) {
    avisos.push(
      "O empreendimento não tem o percentual da imobiliária: a parte dos associados e a comissão total saem em branco.",
    );
  }

  if (!comissao.coordenadora) {
    avisos.push(
      "O empreendimento não tem coordenadora de vendas cadastrada: nome, CNPJ, endereço, telefone e e-mail dela saem em branco.",
    );
  }

  const dia = numero(proposta.dia_vencimento);
  if (dia !== null && dia > 0) {
    por("dia_vencimento", String(Math.trunc(dia)));
    por("dia_vencimento_extenso", inteiroPorExtenso(Math.trunc(dia)));
  }

  por("plano_nome", texto(proposta.plano_nome));

  const condicoes = objeto(proposta.condicoes) as CondicoesGravadas | null;

  // ── O PRAZO ──
  //
  // ⚠️ ELE SAI DA COLUNA, E NÃO SÓ DO CRONOGRAMA. `contrato_parcelas` é o prazo DESTA venda em
  // ambos os mundos: a rota nativa a grava com o que o coordenador montou, e a importação do C2X a
  // trouxe para as 4.857 antigas — que não têm `condicoes` nenhuma. Contar `condicoes.mensais`
  // sozinho deixava `[prazo_meses_amortizacao]` em branco em todo contrato tirado de proposta
  // importada. O cronograma fica como reserva, para a proposta nativa que por algum motivo nasceu
  // sem a coluna.
  //
  // ⚠️ E NUNCA `plano_parcelas`: aquele é o tamanho do MOLDE. É a lição escrita na própria rota da
  // proposta — foi o molde no lugar do contrato que estampou "144x" no extrato de um contrato de 62
  // parcelas.
  // ⚠️ A CARTEIRA DO APOLO É A RESERVA DA VENDA IMPORTADA, e só dela: é o que o comprador está
  // pagando, lançamento a lançamento. Ver `carteira-da-venda.ts`.
  const daCarteira = financeiro.carteira?.situacao === "ok" ? financeiro.carteira : null;

  const parcelasDoContrato = numero(proposta.contrato_parcelas);
  const mensais = Array.isArray(condicoes?.mensais)
    ? condicoes.mensais.length
    : (daCarteira?.parcelasMensais ?? 0);
  const prazo =
    parcelasDoContrato !== null && parcelasDoContrato > 0
      ? Math.trunc(parcelasDoContrato)
      : mensais;
  if (prazo > 0) {
    por("prazo_meses_amortizacao", String(prazo));
    por("prazo_meses_amortizacao_extenso", quantidadePorExtenso(prazo));
  }

  // ── O CRONOGRAMA CONGELADO ──
  //
  // ⚠️ A ENTRADA E O FINANCIADO SAEM DAQUI, E NÃO DE UMA CONTA NOVA. `condicoes` é a foto do que o
  // PDF da proposta imprimiu e o cliente leu; recalcular aqui faria o contrato discordar do papel
  // que ele tem na mão no dia em que o plano do empreendimento mudar.
  if (!condicoes) {
    if (daCarteira) {
      // ⚠️ SÓ O QUE A CARTEIRA TEM LANÇADO. Sem ato nem sinal lançados, a entrada é DESCONHECIDA, e
      // não zero: "R$ 0,00" no contrato afirmaria uma venda sem entrada.
      const temEntrada = daCarteira.porTipo.ato.quantidade + daCarteira.porTipo.sinal.quantidade > 0;
      const temFinanciado =
        daCarteira.porTipo.mensal.quantidade + daCarteira.porTipo.reforco.quantidade > 0;
      if (temEntrada) parDeDinheiro("valor_entrada", daCarteira.entrada);
      if (temFinanciado) parDeDinheiro("valor_divida_financiada", daCarteira.financiado);
      return g;
    }
    avisos.push(avisoSemCronograma(financeiro.carteira, financeiro.fatos));
    return g;
  }

  parDeDinheiro("valor_entrada", numero(condicoes.totais?.entrada));
  parDeDinheiro("valor_divida_financiada", numero(condicoes.totais?.financiado));

  const anuais = Array.isArray(condicoes.anuais) ? condicoes.anuais : [];
  if (anuais.length > 0) {
    por("plano_anuais_quantidade", String(anuais.length));
    parDeDinheiro("plano_anuais_valor", numero(anuais[0]?.valor));
  }

  return g;
}

/**
 * Os pares ligado/desligado que não dependem de quem compra.
 *
 * ⚠️ SÓ O QUE ESTE MÓDULO SABE RESPONDER. `condicaoLigada`, no motor, trata o par desconhecido como
 * VERDADEIRO — a cláusula sai e alguém percebe. Declarar `false` aqui para um par que não sabemos
 * avaliar faria a cláusula sumir em silêncio do contrato assinado.
 */
function condicoesDoContrato(proposta: LinhaDaProposta): Record<string, boolean> {
  const condicoes = objeto(proposta.condicoes) as CondicoesGravadas | null;
  if (!condicoes) return {};
  const anuais = Array.isArray(condicoes.anuais) ? condicoes.anuais : [];
  return { tem_anuais: anuais.length > 0 };
}

/**
 * O que a tela escreve no lugar do valor quando a carteira do Apolo não responde por esta venda.
 *
 * ⚠️ TRÊS FRASES, E NENHUMA É "NÃO INFORMADO". "Não informado" diz que alguém esqueceu de preencher;
 * aqui ninguém esqueceu — o financeiro mora na carteira do Apolo. E cada frase só afirma o que se
 * sabe:
 *
 *   • SEM LANÇAMENTOS só quando a carteira da venda foi sincronizada e não tem parcela nenhuma.
 *   • AINDA NÃO SEPARA quando a carteira por venda não tem a venda. ⚠️ "Sem lançamentos" aqui era
 *     desmentido pela própria carteira do Apolo: o retrato por pessoa (`apolo_financial_snapshots`)
 *     de 18/09/2026 tem as parcelas de 4 dos 6 distratos em análise (62 a 185 parcelas, o total
 *     igual ao valor da venda). O que falta é a carteira separada por venda, não o lançamento.
 *   • NÃO CONSEGUI LER quando a leitura falhou: afirmar ausência num distrato é apurar a devolução
 *     como venda sem pagamento.
 */
export const SEM_LANCAMENTOS_NA_CARTEIRA = "sem lançamentos na carteira do Apolo";
export const CARTEIRA_AINDA_SEM_A_VENDA = "a carteira do Apolo ainda não separa esta venda por parcela";
export const CARTEIRA_ILEGIVEL = "não consegui ler a carteira do Apolo";

/** A frase do campo, conforme a razão de a carteira não ter respondido. */
export function semValorNaCarteira(carteira: CarteiraDaVenda | null): string {
  if (carteira?.situacao === "erro") return CARTEIRA_ILEGIVEL;
  // Com a carteira da venda lida ("ok" sem parcela daquele tipo, ou sincronizada e vazia), a ausência
  // é fato dela.
  if (
    carteira?.situacao === "ok" ||
    (carteira?.situacao === "sem_carteira" && carteira.motivo === "sem_parcela")
  ) {
    return SEM_LANCAMENTOS_NA_CARTEIRA;
  }
  return CARTEIRA_AINDA_SEM_A_VENDA;
}

/**
 * O aviso de "sem cronograma", dito conforme a razão.
 *
 * ⚠️ QUATRO CAUSAS, QUATRO FRASES. A nativa sem cronograma é defeito de gravação; a importada nunca
 * sincronizada é pendência da carteira; a sincronizada sem parcela é fato da venda; e a leitura que
 * falhou não é nenhuma das três. Uma frase só para as quatro mandaria o operador procurar no lugar
 * errado.
 */
function avisoSemCronograma(carteira: CarteiraDaVenda | null, fatos: FatosApurados | null): string {
  if (!carteira || carteira.situacao === "nativa" || carteira.situacao === "ok") {
    return "A proposta não tem cronograma gravado: entrada, financiado e parcelas anuais ficaram em branco.";
  }
  // ⚠️ SEM A MENSAGEM DO BANCO. O aviso vai para o card e para o portal do incorporador, e o texto do
  // Postgres é detalhe de schema da casa (a mesma regra de `abrirCardDoTrabalho`). Ele fica no log.
  if (carteira.situacao === "erro") {
    return "Não consegui ler a carteira do Apolo desta venda: entrada, financiado e parcelas ficaram em branco. Tente abrir de novo.";
  }
  if (carteira.motivo === "nunca_sincronizada") {
    return "Venda importada: a carteira do Apolo ainda não separa esta venda por parcela, então entrada, financiado, pago e em aberto ficaram em branco.";
  }
  const quando = carteira.sincronizadaEm ? ` em ${dataBR(carteira.sincronizadaEm.slice(0, 10))}` : "";
  const divergencia = fatos?.houvePagamento
    ? ` Mas o Hércules registra ${fatos.comoSoube.pagamento}: confira antes de seguir.`
    : "";
  return `Venda importada sem lançamentos na carteira do Apolo: a carteira foi sincronizada${quando} e não tem parcela nenhuma desta venda.${divergencia}`;
}

// ── A DATA DE HOJE ───────────────────────────────────────────────────────────

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * O dia de HOJE em Brasília, como `YYYY-MM-DD`.
 *
 * ⚠️ FUSO FIXO −03:00, e não o relógio da máquina. É a mesma trava de `cronograma.ts`: a Vercel roda
 * em UTC, e um contrato gerado às 21h30 de Brasília sairia datado de AMANHÃ — data errada num
 * documento que o cartório confere contra a assinatura.
 */
export function hojeEmBrasilia(agora: Date): string {
  const d = new Date(agora.getTime() - 3 * 3_600_000);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * `2026-09-08` → `8 de setembro de 2026`.
 *
 * ⚠️ LÊ OS DÍGITOS, NÃO CONSTRÓI `Date` — o mesmo motivo do fuso acima. O formatador equivalente de
 * `proposta-para-pdf.ts` é privado e mantém o zero à esquerda ("08 de setembro"), que serve à TABELA
 * de parcelas; num fecho de contrato, que é frase corrida, o zero não se escreve.
 */
export function dataPorExtenso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m?.[1] || !m[2] || !m[3]) return "";
  const mes = MESES[Number(m[2]) - 1];
  return mes ? `${Number(m[3])} de ${mes} de ${m[1]}` : "";
}

/** `1985-03-15` → `15/03/1985`. Vazio quando não é data — nunca a string crua. */
function dataBR(valor: string): string {
  if (!valor) return "";
  const formatada = formatDateBR(valor);
  // ⚠️ `formatDateBR` DEVOLVE A ENTRADA quando não reconhece. Num contrato isso imprimiria o lixo do
  // cadastro ("nao informado", "//") no lugar da data de nascimento; aqui ele vira ausência, e a
  // ausência salta aos olhos como `[data_nascimento_cliente]`.
  return /^\d{2}\/\d{2}\/\d{4}$/.test(formatada) ? formatada : "";
}

// ── AJUDANTES ────────────────────────────────────────────────────────────────

/**
 * O cadastro do comprador, unindo as DUAS camadas onde ele pode estar.
 *
 * ⚠️ O WIZARD NÃO ESCREVE NA FICHA DA ESTEIRA. `createApoloEntity` achata identidade, perfil e
 * empresa num objeto plano e grava em `apolo_entities.metadata.cadastro`; a `apolo_esteira.ficha` só
 * recebe o que alguém EDITOU depois, na tela de validação. São duas camadas do mesmo cadastro, e o
 * resolvedor lia uma só.
 *
 * ⚠️ E ISSO DEIXAVA O CONTRATO EM BRANCO COM O DADO NA MÃO. Medido em 08/09/2026: 222 entidades têm
 * estado civil, 212 têm nascimento, 205 profissão e 181 nacionalidade em `metadata.cadastro` — e
 * NENHUMA delas era lida. Lucas, ao ver o contrato com metade da qualificação vazia: *"o que se
 * refere a cadastro deveria estar dentro do Panteon, e esses serem usados na confecção das
 * minutas"*. Estava dentro; não era usado.
 *
 * ⚠️ A FICHA GANHA, sempre. Ela é a correção feita à mão na tela de validação, e existir ali
 * significa que alguém olhou e decidiu — o `metadata` é o que o wizard capturou na entrada.
 *
 * ⚠️ E O `rg` NÃO VEM DAQUI. `metadata.cadastro` tem `orgaoEmissor` em 201 entidades e `rg` em ZERO:
 * unir os dois em bloco traria o órgão sozinho, e `rg_cliente` voltaria a imprimir "portador da
 * cédula de identidade nº SSP/MG" — o defeito que a trava do número fechou hoje de manhã.
 */
function cadastroDaEntidade(
  ficha: null | Record<string, unknown>,
  entidade: LinhaDaEntidade | null | undefined,
): null | Record<string, unknown> {
  const doWizard = objeto((objeto(entidade?.metadata) ?? {}).cadastro);
  if (!doWizard) return ficha;
  if (!ficha) return semOrgaoSolto(doWizard);
  // A ficha por cima: chave preenchida nela vence a do wizard.
  const unido: Record<string, unknown> = { ...semOrgaoSolto(doWizard) };
  for (const [k, v] of Object.entries(ficha)) {
    if (v !== null && v !== undefined && v !== "") unido[k] = v;
  }
  return unido;
}

/** O órgão emissor sem o número do RG não é um RG. Ver a nota de `cadastroDaEntidade`. */
function semOrgaoSolto(cadastro: Record<string, unknown>): Record<string, unknown> {
  if (texto(cadastro.rg)) return cadastro;
  const { orgaoEmissor: _fora, ...resto } = cadastro;
  return resto;
}

/** A entidade que o merge do Apolo arquivou — ela fica sem ficha, sem contato e sem endereço. */
function ehArquivada(e: LinhaDaEntidade): boolean {
  return texto(e.status).toLowerCase() === "archived";
}

function texto(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Textos de PREENCHIMENTO que alguma carga gravou como se fossem dado.
 *
 * ⚠️ ISTO SAIU IMPRESSO NUM CONTRATO REAL, em 08/09/2026: *"residente e domiciliado na Endereco
 * cadastral, nº [numero_cliente]"*. Não era o endereço de ninguém — é um rótulo que uma carga pôs
 * na coluna `street` de **4.633** linhas de `apolo_addresses`, e que passou por toda a cascata como
 * se fosse uma rua.
 *
 * ⚠️ E ISSO É PIOR DO QUE O CAMPO VAZIO. Um `[rua_cliente]` impresso salta aos olhos de quem
 * confere e vira linha na lista de avisos; "Endereco cadastral" no meio da qualificação parece
 * preenchido, passa pela conferência e chega ao cartório. Um dado que não identifica ninguém não é
 * dado: aqui ele volta a ser ausência.
 *
 * ⚠️ A LISTA É CURTA E LITERAL DE PROPÓSITO. Adivinhar "endereço que parece falso" por heurística
 * apagaria rua de verdade — existe "Rua Sem Nome" no Brasil. Só entra aqui o que foi MEDIDO no
 * banco como preenchimento em massa.
 */
const RUIDO_DE_CARGA = new Set(["endereco cadastral", "endereço cadastral"]);

/** O texto, ou vazio quando ele é só um rótulo de carga. Ver `RUIDO_DE_CARGA`. */
function textoUtil(v: unknown): string {
  const t = texto(v);
  return RUIDO_DE_CARGA.has(t.toLowerCase()) ? "" : t;
}

function objeto(v: unknown): null | Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * O número, venha ele como número ou como texto.
 *
 * ⚠️ `numeric` DO POSTGRES CHEGA COMO STRING em algumas versões do PostgREST — é como ele preserva a
 * precisão. Um `typeof v === "number"` sozinho leria `"185400.00"` como ausente, e o contrato sairia
 * sem preço.
 */
function numero(v: unknown): null | number {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const bruto = texto(v);
  if (!bruto) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * `185400` → `R$ 185.400,00`.
 *
 * ⚠️ NÃO É `toLocaleString` COM `style: "currency"`. Ela devolve um ESPAÇO INSEPARÁVEL (U+00A0)
 * entre o "R$" e o número — invisível na tela, e no contrato ele quebra a busca por "R$ 185.400,00"
 * e vira caractere estranho em qualquer conversão de encoding no caminho até o PDF.
 */
function emReais(valor: number): string {
  const sinal = valor < 0 ? "-" : "";
  const [inteiro = "0", centavos = "00"] = Math.abs(valor).toFixed(2).split(".");
  return `${sinal}R$ ${milhar(inteiro)},${centavos}`;
}

/**
 * Uma parte percentual de um valor, em CENTAVOS INTEIROS.
 *
 * ⚠️ A CONTA É EM CENTAVOS PORQUE O CONTRATO MANDA SOMAR AS DUAS PARTES. `emReais` e
 * `dinheiroPorExtenso` arredondam no fim e escondem a sujeira do ponto flutuante em cada linha
 * isolada (R$ 185.400 a 1,234% é 2287.8360000000002), mas o TOTAL cai um centavo fora das duas
 * parcelas impressas logo acima dele: medido, R$ 170.010,08 a 1,5% e 5% imprime R$ 2.550,15 e
 * R$ 8.500,50, soma R$ 11.050,65 em centavos e R$ 11.050,66 em reais. É o mesmo cuidado de
 * `ajuste-de-preco.ts`, e pela mesma razão: dinheiro se soma inteiro.
 *
 * ⚠️ E O ARREDONDAMENTO É O DO CENTAVO, não o da casa decimal do percentual: R$ 187.333,33 a 1,5%
 * são 2809,99995 reais, que vão ao papel como R$ 2.810,00.
 */
function parteEmCentavos(valorEmCentavos: number, taxa: number): number {
  return Math.round((valorEmCentavos * taxa) / 100);
}

/** `300` → `300,00`. O número sem unidade nenhuma — quem escreve "m²" é quem chama. */
function comDuasCasas(valor: number): string {
  const [inteiro = "0", casas = "00"] = Math.abs(valor).toFixed(2).split(".");
  return `${valor < 0 ? "-" : ""}${milhar(inteiro)},${casas}`;
}

function milhar(inteiro: string): string {
  return inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** `50` → `50%`; `33.33` → `33,33%`. Sem casas quando é redondo — "50,00%" se lê pior. */
function percentual(valor: number): string {
  const n = Number(valor.toFixed(2));
  return `${String(n).replace(".", ",")}%`;
}

/**
 * O documento como ele vai para o papel: `123.456.789-00` / `11.115.899/0001-04`.
 *
 * ⚠️ MEIO CPF NÃO É UM CPF. `formatarDocumento` DEVOLVE A ENTRADA quando os dígitos não fecham 11
 * nem 14 — é o mesmo comportamento de `formatDateBR`, e a mesma armadilha: `cli_cpf` no legado é
 * texto livre, e um número truncado atravessava a importação e saía impresso como "portador do CPF
 * 1234567890". É o defeito exato do RG e da cidade logo acima — um campo que PARECE preenchido,
 * some da lista de avisos e passa por qualquer conferência automática e por nenhuma humana. Sem 11
 * ou 14 dígitos a variável não existe, `[cpf_cliente]` volta a aparecer no papel e o aviso dispara.
 *
 * ⚠️ E ELE REFORMATA SEMPRE, em vez de copiar o que está gravado. `document_masked` guarda o
 * documento COMPLETO na maioria das linhas, mas não em todas: parte delas tem "12345678900" cru, e
 * um CPF sem pontuação num contrato é o tipo de detalhe que o cartório devolve. A coluna também
 * guarda a frase "Documento em revisao" (`cadastro-persist.ts`) e, nos cadastros anteriores a
 * 22/jul, a máscara de verdade (`***.***.***-35`) — nenhuma das duas chega até aqui hoje, porque a
 * entidade é CASADA pelo documento e essas linhas não casam com ninguém; passar por esta função é o
 * que garante que continuem não chegando se o casamento mudar.
 */
function documentoImprimivel(bruto: unknown): string {
  const d = soDigitos(texto(bruto));
  return d.length === 11 || d.length === 14 ? formatarDocumento(d) : "";
}

/**
 * Um inteiro gravado (andar, vagas) como texto; vazio quando não há número.
 *
 * ⚠️ ZERO É VALOR, NÃO AUSÊNCIA: andar 0 é o térreo e 0 vaga é "sem vaga". Tratar 0 como vazio faria
 * o contrato imprimir `[vagas]` exatamente para quem comprou sem garagem.
 */
function inteiroComoTexto(bruto: unknown): string {
  const n = numero(bruto);
  return n !== null && Number.isInteger(n) ? String(n) : "";
}

/** O extenso de um rótulo que é número inteiro; vazio quando não é ("A", "Q7"). */
function extensoDeInteiro(bruto: string): string {
  return /^\d+$/.test(bruto) ? inteiroPorExtenso(Number(bruto)) : "";
}

/**
 * O rótulo do catálogo para um `*Id` da ficha.
 *
 * ⚠️ ID DESCONHECIDO VIRA AUSÊNCIA, E NÃO O NÚMERO. Devolver "2" faria o contrato imprimir
 * "brasileiro, 2, portador do CPF" — que passa por qualquer conferência automática e por nenhuma
 * humana, tarde demais. Sem rótulo, a variável volta como `[estado_civil_cliente]` e alguém vê.
 *
 * ⚠️ E O RÓTULO SAI COMO ESTÁ NO CATÁLOGO ("Casado (a)", "ENGENHEIRO(A)"). Enfeitá-lo — tirar o
 * "(a)", passar para minúsculas — exigiria decidir o gênero do comprador a partir de um campo que
 * pode estar vazio, e gênero errado num contrato é pior do que o "(a)".
 */
function rotuloDoId(catalogo: readonly C2xOption[], id: unknown): string {
  const bruto = texto(id);
  if (!bruto) return "";
  const n = Number(bruto);
  if (!Number.isFinite(n)) return "";
  return catalogo.find((o) => o.id === n)?.label ?? "";
}

function primeiroContato(contatos: LinhaDoContato[], tipos: string[]): string {
  for (const tipo of tipos) {
    const achado = contatos.find((c) => texto(c.contact_type).toLowerCase() === tipo);
    const valor = texto(achado?.value);
    if (valor) return valor;
  }
  return "";
}

/** `["a", "b", "c"]` → `"a, b e c"`. */
function listar(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * Os compradores da proposta, na ordem do contrato (o titular primeiro).
 *
 * ⚠️ O TITULAR VAI NA FRENTE porque `preencherContrato` documenta que "o primeiro é o titular", e as
 * minutas escrevem a primeira qualificação com o comprador principal. A ordem do jsonb é a que a
 * tela mandou e não garante isso.
 *
 * ⚠️ E A LISTA VAZIA CAI NAS COLUNAS DO TITULAR — reserva para a proposta que veio sem jsonb
 * nenhum. Ela NÃO é a rede das propostas importadas do C2X: aquelas têm o jsonb preenchido, só que
 * com as outras chaves (`documento`/`percentual`), e é `documentoDoComprador` quem as lê. Ver a
 * nota de `CompradorDaProposta`.
 */
function compradoresDaProposta(proposta: LinhaDaProposta): CompradorDaProposta[] {
  const crus = Array.isArray(proposta.compradores)
    ? (proposta.compradores as unknown[])
    : [];
  const lista = crus
    .map((c) => objeto(c) as CompradorDaProposta | null)
    .filter((c): c is CompradorDaProposta => c !== null)
    .filter((c) => Boolean(documentoDoComprador(c) || texto(c.nome)));

  if (lista.length > 0) {
    const titulares = lista.filter((c) => c.titular === true);
    return [...titulares, ...lista.filter((c) => c.titular !== true)];
  }

  const documento = soDigitos(texto(proposta.cliente_documento));
  const nome = texto(proposta.cliente_nome);
  if (!documento && !nome) return [];
  return [{ cpf: documento, nome, titular: true }];
}

// ── AS CONSULTAS ─────────────────────────────────────────────────────────────
//
// ⚠️ LEITURA QUE FALHOU NÃO É "NÃO TEM". É a lição de `lerCadDaEsteira`: engolir o erro faria um
// blip de rede virar "comprador sem cadastro no Apolo" — e o contrato sairia com a qualificação em
// branco, com um aviso plausível ao lado, sem ninguém suspeitar de nada. Parar é o certo aqui:
// contrato não sai pela metade.

type Resposta = { data?: unknown; error?: null | { message?: string } };

async function umaLinha<T>(consulta: PromiseLike<unknown>, tabela: string): Promise<null | T> {
  const { data, error } = ((await consulta) ?? {}) as Resposta;
  if (error) throw new Error(`${tabela}: leitura falhou (${error.message ?? "sem detalhe"})`);
  return (data ?? null) as null | T;
}

async function varias<T>(consulta: PromiseLike<unknown>, tabela: string): Promise<T[]> {
  const { data, error } = ((await consulta) ?? {}) as Resposta;
  if (error) throw new Error(`${tabela}: leitura falhou (${error.message ?? "sem detalhe"})`);
  return Array.isArray(data) ? (data as T[]) : [];
}
