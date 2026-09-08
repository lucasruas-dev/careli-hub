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
import { unirConjuge, unirEndereco } from "@/lib/apolo/cadastro-cascata";
import { formatarDocumento, soDigitos } from "@/lib/apolo/documento";

import {
  areaPorExtenso,
  dinheiroPorExtenso,
  inteiroPorExtenso,
  quantidadePorExtenso,
} from "./por-extenso";
import type { DadosDoComprador, DadosDoContrato } from "./preencher-contrato";

// ── AS LINHAS COMO ELAS CHEGAM ───────────────────────────────────────────────

type LinhaDaProposta = {
  cliente_documento: null | string;
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
  dia_vencimento: null | number | string;
  empreendimento_id: null | string;
  plano_nome: null | string;
  unidade_id: null | string;
  valor: null | number | string;
};

type LinhaDaUnidade = {
  area: null | number | string;
  area_extenso: null | string;
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
};

type LinhaDoEmpreendimento = {
  c2x_enterprise_id: null | string;
  cidade: null | string;
  codigo: null | string;
  nome: null | string;
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
  rua: string;
  telefone: string;
};

/** O que a política comercial do empreendimento respondeu sobre a corretagem desta venda. */
type ComissaoDaVenda = {
  coordenadora: CadastroDaCoordenadora | null;
  percentuais: LinhaDaComissao | null;
};

type LinhaDaEsteira = { enterprise_id: null | string; entity_id: string; ficha: unknown };

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
  cpf?: unknown;
  /** A grafia da importação do C2X para o mesmo campo que a proposta nativa chama de `cpf`. */
  documento?: unknown;
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
): Promise<{ avisos: string[]; dados: DadosDoContrato } | null> {
  const avisos: string[] = [];

  const proposta = await umaLinha<LinhaDaProposta>(
    sb
      .from("hercules_propostas")
      .select(
        "cliente_documento, cliente_nome, compradores, condicoes, contrato_parcelas, corretor_entity_id, corretor_nome, dia_vencimento, empreendimento_id, imobiliaria_entity_id, imobiliaria_nome, plano_nome, unidade_id, valor",
      )
      .eq("id", propostaId)
      .maybeSingle(),
    "hercules_propostas",
  );

  if (!proposta) return null;

  const [unidade, empreendimento, doVinculado] = await Promise.all([
    proposta.unidade_id
      ? umaLinha<LinhaDaUnidade>(
          sb
            .from("hercules_unidades")
            .select(
              "area, area_extenso, codigo, enterprise_id, lote, matricula, matricula_livro, preco_extenso, preco_tabela, quadra, tipo_unidade",
            )
            .eq("id", proposta.unidade_id)
            .maybeSingle(),
          "hercules_unidades",
        )
      : Promise.resolve(null),
    proposta.empreendimento_id
      ? umaLinha<LinhaDoEmpreendimento>(
          sb
            .from("hercules_empreendimentos")
            .select("c2x_enterprise_id, cidade, codigo, nome, uf")
            .eq("id", proposta.empreendimento_id)
            .maybeSingle(),
          "hercules_empreendimentos",
        )
      : Promise.resolve(null),
    cadastroDoVinculado(sb, proposta.imobiliaria_entity_id, proposta.corretor_entity_id),
  ]);

  // ⚠️ A COMISSÃO É UMA SEGUNDA VIAGEM, e não cabe no `Promise.all` de cima: a chave de
  // `apolo_enterprise_settings` só se conhece DEPOIS de ler o empreendimento (ver
  // `comissaoDoEmpreendimento`). Mas ela roda junto com os compradores, que é a leitura cara — assim
  // as duas viagens extras não somam tempo à prévia do contrato.
  const [compradores, comissao] = await Promise.all([
    montarCompradores(sb, proposta, empreendimento, avisos),
    comissaoDoEmpreendimento(sb, empreendimento, unidade),
  ]);

  return {
    avisos,
    dados: {
      compradores,
      condicoes: condicoesDoContrato(proposta),
      gerais: gerais(proposta, unidade, empreendimento, doVinculado, comissao, avisos),
    },
  };
}

// ── OS COMPRADORES ───────────────────────────────────────────────────────────

async function montarCompradores(
  sb: SupabaseClient,
  proposta: LinhaDaProposta,
  empreendimento: LinhaDoEmpreendimento | null,
  avisos: string[],
): Promise<DadosDoComprador[]> {
  const daProposta = compradoresDaProposta(proposta);

  if (daProposta.length === 0) {
    avisos.push("A proposta não tem comprador nenhum: a qualificação do contrato sai em branco.");
    return [];
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

  // ⚠️ A ARQUIVADA SÓ ENTRA SE NÃO HOUVER OUTRA. O `order("status")` acima já traz `active` antes de
  // `archived` alfabeticamente — mas depender disso seria depender de um acaso do alfabeto, que a
  // primeira renomeação de status quebraria em silêncio. Aqui a regra está escrita.
  const porDocumento = new Map<string, LinhaDaEntidade>();
  for (const e of entidades) {
    const chave = soDigitos(e.document_masked ?? "");
    if (!chave) continue;
    const atual = porDocumento.get(chave);
    if (!atual || (ehArquivada(atual) && !ehArquivada(e))) porDocumento.set(chave, e);
  }

  const ids = [...new Set(entidades.map((e) => e.id).filter(Boolean))];
  const { conjuges, contatos, enderecos, fichas } = await camadasDoCadastro(
    sb,
    ids,
    empreendimento?.c2x_enterprise_id ?? null,
  );

  return daProposta.map((cru) => {
    const digitos = documentoDoComprador(cru);
    const entidade = digitos ? (porDocumento.get(digitos) ?? null) : null;
    return umComprador({
      avisos,
      conjuge: entidade ? (conjuges.get(entidade.id) ?? null) : null,
      contatos: entidade ? (contatos.get(entidade.id) ?? []) : [],
      daProposta: cru,
      digitos,
      endereco: entidade ? (enderecos.get(entidade.id) ?? null) : null,
      entidade,
      // ⚠️ AS DUAS CAMADAS DO CADASTRO, unidas aqui. A ficha da esteira é o que alguém corrigiu na
      // tela; `metadata.cadastro` é o que o wizard capturou na entrada — e era ignorado, deixando
      // 222 estados civis, 212 nascimentos e 205 profissões sem chegar ao contrato.
      ficha: cadastroDaEntidade(entidade ? (fichas.get(entidade.id) ?? null) : null, entidade),
    });
  });
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
  fichas: Map<string, Record<string, unknown>>;
}> {
  const vazio = {
    conjuges: new Map<string, LinhaDoRelacionamento>(),
    contatos: new Map<string, LinhaDoContato[]>(),
    enderecos: new Map<string, LinhaDoEndereco>(),
    fichas: new Map<string, Record<string, unknown>>(),
  };
  if (ids.length === 0) return vazio;

  const [linhasDaEsteira, linhasDeEndereco, linhasDeContato, linhasDeConjuge] = await Promise.all([
    varias<LinhaDaEsteira>(
      sb
        .from("apolo_esteira")
        .select("enterprise_id, entity_id, ficha")
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

  return { conjuges, contatos, enderecos, fichas };
}

/**
 * O cadastro da imobiliária (ou do corretor) da venda, quando a proposta guarda o vínculo.
 *
 * ⚠️ A IMOBILIÁRIA VENCE O CORRETOR, e é a mesma precedência do split do C2X: quem recebe a
 * comissão é a imobiliária quando ela existe, e o corretor autônomo quando a venda foi direta.
 * Inverter faria o contrato de corretagem nomear como beneficiário quem não recebe.
 *
 * ⚠️ SÓ AS PROPOSTAS NASCIDAS NO PANTEON TÊM ESSE VÍNCULO. As importadas do C2X guardam apenas o
 * nome em texto (`imobiliaria_nome`), e para elas ele não será reconstruído — decisão do Lucas em
 * 08/09/2026: *"o que foi gerado antes do Panteon, deixa sem mesmo"*. Reconciliar por nome casaria
 * pouco mais de um terço e criaria vínculo ERRADO nos outros, que é pior do que campo vazio num
 * contrato de corretagem.
 */
async function cadastroDoVinculado(
  sb: SupabaseClient,
  imobiliariaId: null | string,
  corretorId: null | string,
): Promise<null | { documento: string; email: string; telefone: string }> {
  const id = imobiliariaId ?? corretorId;
  if (!id) return null;

  const [entidade, contatos] = await Promise.all([
    umaLinha<LinhaDaEntidade>(
      sb.from("apolo_entities").select("document_masked, id").eq("id", id).maybeSingle(),
      "apolo_entities",
    ),
    varias<LinhaDoContato>(
      sb.from("apolo_contacts").select("contact_type, entity_id, value").eq("entity_id", id),
      "apolo_contacts",
    ),
  ]);

  if (!entidade) return null;

  return {
    documento: documentoImprimivel(texto(entidade.document_masked)),
    email: primeiroContato(contatos, ["email"]),
    // ⚠️ WHATSAPP PRIMEIRO. No Apolo o `whatsapp` é o tipo que a maioria das entidades tem; ler só
    // `phone` deixaria o contrato de corretagem sem telefone na maior parte das vendas.
    telefone: primeiroContato(contatos, ["whatsapp", "phone"]),
  };
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
 */
async function comissaoDoEmpreendimento(
  sb: SupabaseClient,
  empreendimento: LinhaDoEmpreendimento | null,
  unidade: LinhaDaUnidade | null,
): Promise<ComissaoDaVenda> {
  const chave = texto(empreendimento?.c2x_enterprise_id) || texto(unidade?.enterprise_id);
  if (!chave) return { coordenadora: null, percentuais: null };

  const percentuais = await umaLinha<LinhaDaComissao>(
    sb
      .from("apolo_enterprise_settings")
      .select(
        "comissao_coordenadora_percentual, comissao_imobiliaria_percentual, coordenadora_entity_id",
      )
      .eq("enterprise_id", chave)
      .maybeSingle(),
    "apolo_enterprise_settings",
  );

  return {
    coordenadora: await cadastroDaCoordenadora(sb, texto(percentuais?.coordenadora_entity_id)),
    percentuais,
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
  contatos: LinhaDoContato[];
  daProposta: CompradorDaProposta;
  digitos: string;
  endereco: LinhaDoEndereco | null;
  entidade: LinhaDaEntidade | null;
  ficha: null | Record<string, unknown>;
}): DadosDoComprador {
  const { avisos, contatos, daProposta, digitos, endereco, entidade, ficha } = entrada;
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
  por("email_cliente", texto(ficha?.email) || primeiroContato(contatos, ["email"]));
  // ⚠️ `whatsapp` ANTES DE `phone`, e o jsonb da proposta por último. A ordem dos dois primeiros é a
  // mesma de `c2x-write-server.ts`: 3.941 entidades só têm a linha `whatsapp`, e preferir `phone`
  // faria o contrato imprimir o fixo enquanto o resto do Panteon fala com o celular da pessoa. O
  // terceiro degrau é o único contato que o comprador NÃO titular costuma ter — ele não tem
  // reserva, pode não ter CAD e pode nem ter entidade no Apolo (ver `CompradorDaProposta.telefone`).
  por(
    "telefone_cliente",
    texto(ficha?.telefone) ||
      primeiroContato(contatos, ["whatsapp", "phone"]) ||
      texto(daProposta.telefone),
  );

  const enderecoUnido = unirEndereco(ficha, {
    bairro: texto(endereco?.district),
    cep: texto(endereco?.postal_code),
    cidade: texto(endereco?.city),
    complemento: texto(endereco?.complement),
    logradouro: texto(endereco?.street),
    numero: texto(endereco?.number),
    uf: texto(endereco?.state),
  });
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
  const conjuge = unirConjuge(ficha, {
    cpf: entrada.conjuge?.metadata?.cpf,
    email: entrada.conjuge?.metadata?.email,
    nacionalidade: entrada.conjuge?.metadata?.nacionalidade,
    nome: entrada.conjuge?.label,
    profissaoId: entrada.conjuge?.metadata?.profissaoId,
    telefone: entrada.conjuge?.metadata?.phone,
  });

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
    if (!valores.rg_cliente) faltando.push("RG");
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
  doVinculado: null | { documento: string; email: string; telefone: string },
  comissao: ComissaoDaVenda,
  avisos: string[],
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
    avisos.push(
      "A proposta não aponta para nenhuma unidade: quadra, lote, área e matrícula ficaram em branco.",
    );
  }

  // ⚠️ O MESMO ID, PELA UNIDADE. Três empreendimentos (LOX, PDX, RDX) têm `c2x_enterprise_id` nulo,
  // e a minuta é indexada por esse id — para eles a prévia nunca acharia minuta. A unidade carrega o
  // mesmo número na sua própria coluna, vindo de outra carga, e serve de segundo caminho. Prefixo
  // `__` pelo mesmo motivo do outro: nenhuma minuta escreve `[__unidade_enterprise_id]`.
  const unidadeEnterpriseId = texto(unidade?.enterprise_id);
  if (unidadeEnterpriseId) por("__unidade_enterprise_id", unidadeEnterpriseId);

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
  // SEM BENEFICIÁRIO em quase toda venda de hoje. O nome basta para o texto; CRECI, CNPJ e contato
  // continuam pendentes e aparecem na lista de conferência da Têmis.
  const vinculado = texto(proposta.imobiliaria_nome) || texto(proposta.corretor_nome);
  if (vinculado) {
    por("nome_vinculado", vinculado);
    por("imobiliaria_nome", texto(proposta.imobiliaria_nome));
    por("corretor_nome", texto(proposta.corretor_nome));
  }

  // ⚠️ O CADASTRO DA IMOBILIÁRIA SÓ ENTRA COM VÍNCULO. Ver `cadastroDoVinculado`: as propostas
  // nascidas no Panteon guardam `imobiliaria_entity_id` (vem da reserva) e daí saem documento,
  // telefone e e-mail; as importadas do C2X têm só o nome, e ficam com estes três em branco.
  if (doVinculado) {
    por("cpf_cnpj_vinculado", doVinculado.documento);
    por("telefone_vinculado", doVinculado.telefone);
    por("email_vinculado", doVinculado.email);
  }

  // ⚠️ O CRECI NÃO ESTÁ NO PANTEON. Ele existe no C2X (`users.creci_number`) e não foi importado —
  // nenhuma tabela daqui tem a coluna. Fica em branco e aparece na conferência da Têmis.

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
      parDeDinheiro("valor_total_comissao", (daCoordenadora + doVinculadoEmCentavos) / 100);
    }
  }

  if (comissao.coordenadora) {
    por("nome_fantasia_coordenadora_vendas", comissao.coordenadora.nome);
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
  const parcelasDoContrato = numero(proposta.contrato_parcelas);
  const mensais = Array.isArray(condicoes?.mensais) ? condicoes.mensais.length : 0;
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
    avisos.push(
      "A proposta não tem cronograma gravado: entrada, financiado e parcelas anuais ficaram em branco.",
    );
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
