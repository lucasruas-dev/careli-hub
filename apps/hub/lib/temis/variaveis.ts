// AS VARIÁVEIS DO CONTRATO — o vocabulário que o jurídico já escreve.
//
// ⚠️ ESTE CATÁLOGO NÃO FOI INVENTADO. Ele foi MEDIDO: `scripts/temis/variaveis-das-minutas.mjs` leu
// as 60 minutas vivas do legado e contou 223 nomes distintos no formato `[nome_da_variavel]`.
// Manter o mesmo vocabulário é o que permite o jurídico subir a minuta que já usa e reconhecer
// tudo — se renomeássemos para algo "melhor", cada minuta existente viraria retrabalho manual.
//
// ⚠️ MAS O VALOR NASCE DO PANTEON, E SÓ DELE. Lucas (02/09/2026), ao ver a barra do editor: *"não
// quero nada do c2x, todas as variáveis tem que nascer do panteon, esquece c2x como consulta"*.
// Cada variável traz `fonte`: a TABELA do Panteon e o campo de onde o valor sai. O que o Panteon
// ainda não guarda entra como `pendente` — e NUNCA vai buscar no legado. O nome continua o medido
// (a minuta reconhece); só a origem mudou de casa.
//
// O QUE O LEVANTAMENTO REVELOU, e que muda o desenho do módulo:
//
// 1. ATÉ CINCO COMPRADORES. Cada um com cônjuge, endereço e percentual de participação próprios
//    (`nome_cliente`, `nome_cliente_2` … `_5`). O primeiro NÃO tem sufixo e NÃO tem bloco
//    condicional — ele sempre existe. Do segundo em diante tudo vive dentro de
//    `[inicio_dados_cliente_N]` … `[fim_dados_cliente_N]`.
//
// 2. OS BLOCOS CONDICIONAIS SÃO O CORAÇÃO DA MINUTA, e são onde o legado erra. `[inicio_dados_
//    cliente_pf]` … `[fim_dados_cliente_pf]` marca o trecho que só sai para pessoa física, e o par
//    `_pj` o de jurídica. No contrato real do Villa Paris que auditamos, o bloco de PJ SAIU IMPRESSO
//    num comprador pessoa física — o motor do legado não respeitou o par. É por isso que
//    `conferirBlocos` existe aqui e roda antes de publicar.
//
// 3. O "POR EXTENSO" É PAR, NÃO ENFEITE. Cada `[x]` numérico tem seu `[x_extenso]`, e os dois têm de
//    contar a mesma história. `lib/temis/por-extenso.ts` é quem escreve — e é ele que impede o
//    "trezentos metros quadrados metros quadrados" que saiu no contrato do Villa Paris.
//
// 4. HÁ VARIÁVEL FANTASMA NAS MINUTAS ANTIGAS: `[Nome]` e `[CPF]`, seis ocorrências, que nenhum
//    motor preenche — saem no papel como estão. Por isso `classificarVariaveis` separa as
//    desconhecidas em vez de ignorá-las: elas viram aviso na tela, antes de o contrato ir a
//    assinatura.
//
// 5. NO EDITOR A VARIÁVEL É UM NÓ (`{ type: "variavel", nome }`, desde 02/09/2026), não texto.
//    Este arquivo não sabe disso de propósito: ele lê TEXTO (`[nome]`), que é o que o serializador
//    `documento-html.ts` emite e o que o motor de contrato procura. Regex canônica:
//    `variaveisDoTexto`.

export type GrupoDeVariavel =
  | "bloco"
  | "comprador"
  | "conjuge"
  | "contrato"
  | "corretagem"
  | "empreendimento"
  | "empresa"
  | "gerado"
  | "plano"
  | "unidade"
  | "valores";

export type TipoDeVariavel =
  | "bloco_fim"
  | "bloco_inicio"
  | "data"
  | "dinheiro"
  | "extenso"
  | "gerado"
  | "numero"
  | "texto";

/**
 * As tabelas do Panteon de onde um valor pode sair. É uma lista FECHADA de propósito: o legado
 * (C2X) não está nela e não vai entrar.
 *
 * - `sistema`: o Panteon escreve (extensos, datas, parágrafos e tabelas gerados, blocos).
 * - `pendente`: o Panteon ainda não guarda o dado. O nome fica no catálogo (a minuta reconhece);
 *   quem for construir a coluna troca a fonte aqui.
 */
export type TabelaDoPanteon =
  | "apolo_entities"
  | "apolo_enterprise_settings"
  | "apolo_esteira"
  | "hercules_empreendimentos"
  | "hercules_masterplans"
  | "hercules_reservas"
  | "hercules_unidades"
  | "hercules_vendas"
  | "pendente"
  | "sistema"
  | "temis_planos";

export type FonteDaVariavel = {
  /** O campo (ou o caminho no jsonb, ou a conta) de onde o valor sai. Livre, para a tela mostrar. */
  campo?: string;
  tabela: TabelaDoPanteon;
};

export type VariavelDoContrato = {
  /** O que a tela mostra ao jurídico: de onde vem, em português. */
  origem: string;
  exemplo: string;
  /** Quando é `x_extenso`, o nome da variável numérica que ela escreve. */
  extensoDe?: string;
  /** A tabela e o campo do PANTEON de onde o valor sai. Nunca o legado. */
  fonte: FonteDaVariavel;
  grupo: GrupoDeVariavel;
  /** Nome exato entre colchetes, sem os colchetes. */
  nome: string;
  rotulo: string;
  tipo: TipoDeVariavel;
};

/** O comprador 1 não tem sufixo; do 2 ao 5, sim. */
const SUFIXOS = ["", "_2", "_3", "_4", "_5"] as const;

type Base = Omit<VariavelDoContrato, "nome"> & { base: string };

// ── FONTES QUE SE REPETEM ────────────────────────────────────────────────────
//
// A ficha do CAD vive em `apolo_esteira.ficha` (jsonb, migration 0058): `identificacao`, `perfil`,
// `endereco`, `conjuge`, `empresa` — o shape é o de `lib/apolo/cadastro-persist.ts`. O nome de
// exibição e a razão social têm coluna própria em `apolo_entities`.
const ENTIDADE = (campo: string): FonteDaVariavel => ({ campo, tabela: "apolo_entities" });
const FICHA = (caminho: string): FonteDaVariavel => ({ campo: `ficha.${caminho}`, tabela: "apolo_esteira" });
const UNIDADE_ = (campo: string): FonteDaVariavel => ({ campo, tabela: "hercules_unidades" });
const VENDA = (campo: string): FonteDaVariavel => ({ campo, tabela: "hercules_vendas" });
const PLANO = (campo: string): FonteDaVariavel => ({ campo, tabela: "temis_planos" });
const EMPREENDIMENTO = (campo: string): FonteDaVariavel => ({ campo, tabela: "hercules_empreendimentos" });
const SISTEMA = (campo: string): FonteDaVariavel => ({ campo, tabela: "sistema" });
const PENDENTE = (campo: string): FonteDaVariavel => ({ campo, tabela: "pendente" });
/** O extenso é sempre escrito pelo sistema a partir do número. */
const EXTENSO_DE = (nome: string): FonteDaVariavel => SISTEMA(`por-extenso.ts sobre [${nome}]`);

// ── COMPRADOR (repete de 1 a 5) ──────────────────────────────────────────────
const COMPRADOR: Base[] = [
  { base: "nome_cliente", exemplo: "THIAGO HENRIQUE DE SOUZA", fonte: ENTIDADE("display_name"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Nome", tipo: "texto" },
  { base: "identificacao_cliente", exemplo: "COMPRADOR", fonte: VENDA("participantes[].papel"), grupo: "comprador", origem: "Papel na venda", rotulo: "Identificação (comprador, cedente…)", tipo: "texto" },
  { base: "nacionalidade_cliente", exemplo: "brasileiro", fonte: FICHA("identificacao.nacionalidade"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Nacionalidade", tipo: "texto" },
  { base: "estado_civil_cliente", exemplo: "casado", fonte: FICHA("perfil.estadoCivilId"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Estado civil", tipo: "texto" },
  { base: "regime_casamento_cliente", exemplo: "comunhão parcial de bens", fonte: FICHA("perfil.regimeBensId"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Regime de casamento", tipo: "texto" },
  { base: "profissao_cliente", exemplo: "engenheiro", fonte: FICHA("perfil.profissaoId / perfil.profissaoOutro"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Profissão", tipo: "texto" },
  { base: "cpf_cliente", exemplo: "123.456.789-00", fonte: FICHA("identificacao.cpf"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "CPF", tipo: "texto" },
  // O RG chega pela importação do Asana (`asana-import.ts` grava `rg` e `orgaoEmissor` na ficha);
  // o wizard de cadastro manual ainda não o pede.
  { base: "rg_cliente", exemplo: "MG-12.345.678", fonte: FICHA("rg + orgaoEmissor"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "RG", tipo: "texto" },
  { base: "data_nascimento_cliente", exemplo: "15/03/1985", fonte: FICHA("identificacao.dataNascimento"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Data de nascimento", tipo: "data" },
  { base: "email_cliente", exemplo: "thiago@exemplo.com.br", fonte: FICHA("perfil.email"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "E-mail", tipo: "texto" },
  { base: "telefone_cliente", exemplo: "(31) 99999-0000", fonte: FICHA("perfil.telefone"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Telefone", tipo: "texto" },
  { base: "rua_cliente", exemplo: "Rua das Acácias", fonte: FICHA("endereco.logradouro"), grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Logradouro", tipo: "texto" },
  { base: "numero_cliente", exemplo: "150", fonte: FICHA("endereco.numero"), grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Número", tipo: "texto" },
  { base: "bairro_cliente", exemplo: "Centro", fonte: FICHA("endereco.bairro"), grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Bairro", tipo: "texto" },
  { base: "cidade_cliente", exemplo: "João Monlevade/MG", fonte: FICHA("endereco.cidade + endereco.uf"), grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Cidade/UF", tipo: "texto" },
  { base: "cep_cliente", exemplo: "35930-000", fonte: FICHA("endereco.cep"), grupo: "comprador", origem: "Endereço do cadastro", rotulo: "CEP", tipo: "texto" },
  { base: "percentual_cliente", exemplo: "50%", fonte: VENDA("participantes[].percentual"), grupo: "comprador", origem: "Participação definida na venda", rotulo: "Percentual de participação", tipo: "texto" },
];

// ── COMPRADOR PESSOA JURÍDICA ────────────────────────────────────────────────
const EMPRESA: Base[] = [
  { base: "razao_social_cliente", exemplo: "SOUZA PARTICIPAÇÕES LTDA.", fonte: ENTIDADE("legal_name"), grupo: "empresa", origem: "Cadastro PJ", rotulo: "Razão social", tipo: "texto" },
  { base: "nome_fantasia_cliente", exemplo: "Souza Participações", fonte: ENTIDADE("trade_name"), grupo: "empresa", origem: "Cadastro PJ", rotulo: "Nome fantasia", tipo: "texto" },
  { base: "cnpj_cliente", exemplo: "11.115.899/0001-04", fonte: FICHA("empresa.cnpj"), grupo: "empresa", origem: "Cadastro PJ", rotulo: "CNPJ", tipo: "texto" },
];

// ── CÔNJUGE (um por comprador) ───────────────────────────────────────────────
const CONJUGE: Base[] = [
  { base: "nome_conjuge", exemplo: "MARIA DE SOUZA", fonte: FICHA("conjuge.nome"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Nome do cônjuge", tipo: "texto" },
  { base: "nacionalidade_conjuge", exemplo: "brasileira", fonte: FICHA("conjuge.nacionalidade"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Nacionalidade do cônjuge", tipo: "texto" },
  { base: "profissao_conjuge", exemplo: "professora", fonte: FICHA("conjuge.profissaoId / conjuge.profissaoOutro"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Profissão do cônjuge", tipo: "texto" },
  { base: "cpf_conjuge", exemplo: "987.654.321-00", fonte: FICHA("conjuge.cpf"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "CPF do cônjuge", tipo: "texto" },
  { base: "email_conjuge", exemplo: "maria@exemplo.com.br", fonte: FICHA("conjuge.email"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "E-mail do cônjuge", tipo: "texto" },
  { base: "telefone_conjuge", exemplo: "(31) 98888-0000", fonte: FICHA("conjuge.telefone"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Telefone do cônjuge", tipo: "texto" },
];

// ── BLOCOS CONDICIONAIS (repetem por comprador) ──────────────────────────────
//
// ⚠️ O par `pf`/`pj` é o que decide QUAL parágrafo sai. Ele existe porque um contrato de pessoa
// jurídica não pode trazer estado civil e regime de bens, e um de pessoa física não pode trazer
// razão social. É exatamente aqui que o contrato do Villa Paris saiu errado.
const BLOCOS_POR_COMPRADOR: { fim: string; fonte: FonteDaVariavel; inicio: string; rotulo: string }[] = [
  { fim: "fim_dados_cliente_pf", fonte: SISTEMA("decide por apolo_entities.entity_kind = pf"), inicio: "inicio_dados_cliente_pf", rotulo: "Só quando o comprador é pessoa FÍSICA" },
  { fim: "fim_dados_cliente_pj", fonte: SISTEMA("decide por apolo_entities.entity_kind = pj"), inicio: "inicio_dados_cliente_pj", rotulo: "Só quando o comprador é pessoa JURÍDICA" },
  { fim: "fim_dados_conjuge", fonte: SISTEMA("decide por apolo_esteira.ficha.conjuge"), inicio: "inicio_dados_conjuge", rotulo: "Só quando o comprador tem cônjuge" },
];

// ── UNIDADE ──────────────────────────────────────────────────────────────────
const UNIDADE: VariavelDoContrato[] = [
  { exemplo: "12", fonte: UNIDADE_("quadra"), grupo: "unidade", nome: "numero_quadra", origem: "Unidade vendida (Hércules)", rotulo: "Quadra", tipo: "texto" },
  { exemplo: "doze", extensoDe: "numero_quadra", fonte: EXTENSO_DE("numero_quadra"), grupo: "unidade", nome: "numero_quadra_extenso", origem: "Escrito pelo sistema", rotulo: "Quadra por extenso", tipo: "extenso" },
  { exemplo: "07", fonte: UNIDADE_("lote"), grupo: "unidade", nome: "numero_lote", origem: "Unidade vendida (Hércules)", rotulo: "Lote", tipo: "texto" },
  { exemplo: "sete", extensoDe: "numero_lote", fonte: EXTENSO_DE("numero_lote"), grupo: "unidade", nome: "numero_lote_extenso", origem: "Escrito pelo sistema", rotulo: "Lote por extenso", tipo: "extenso" },
  { exemplo: "300,00 m²", fonte: UNIDADE_("area"), grupo: "unidade", nome: "area_lote", origem: "Unidade vendida (Hércules)", rotulo: "Área do lote", tipo: "numero" },
  // ⚠️ SEM A UNIDADE NO EXTENSO: ver `areaPorExtenso` em por-extenso.ts. Foi o dado que já trazia
  // "m²" somado ao template que produziu "trezentos metros quadrados metros quadrados".
  // `hercules_unidades.area_extenso` existe (carga inicial); quando estiver vazio, o sistema escreve.
  { exemplo: "trezentos metros quadrados", extensoDe: "area_lote", fonte: UNIDADE_("area_extenso (ou por-extenso.ts sobre area)"), grupo: "unidade", nome: "area_lote_extenso", origem: "Escrito pelo sistema", rotulo: "Área por extenso", tipo: "extenso" },
  { exemplo: "45.678", fonte: UNIDADE_("matricula"), grupo: "unidade", nome: "numero_matricula", origem: "Matrícula da unidade", rotulo: "Matrícula", tipo: "texto" },
  { exemplo: "3", fonte: UNIDADE_("matricula_livro"), grupo: "unidade", nome: "numero_ficha_matricula", origem: "Matrícula da unidade", rotulo: "Ficha/livro da matrícula", tipo: "texto" },
  { exemplo: "(recorte do masterplan)", fonte: { campo: "svg_path publicado, recortado pelo codigo da unidade", tabela: "hercules_masterplans" }, grupo: "unidade", nome: "imagem_unidade", origem: "Masterplan do empreendimento", rotulo: "Imagem do lote", tipo: "gerado" },
  { exemplo: "12", fonte: UNIDADE_("quadra"), grupo: "unidade", nome: "unidade_quadra", origem: "Unidade vendida (Hércules)", rotulo: "Quadra (nome alternativo)", tipo: "texto" },
  { exemplo: "07", fonte: UNIDADE_("lote"), grupo: "unidade", nome: "unidade_lote", origem: "Unidade vendida (Hércules)", rotulo: "Lote (nome alternativo)", tipo: "texto" },
  { exemplo: "300,00", fonte: UNIDADE_("area"), grupo: "unidade", nome: "unidade_area", origem: "Unidade vendida (Hércules)", rotulo: "Área (nome alternativo)", tipo: "numero" },
  // Novos em 02/09/2026: o Panteon já guarda, o catálogo medido não tinha.
  { exemplo: "Q12-L07", fonte: UNIDADE_("codigo"), grupo: "unidade", nome: "codigo_unidade", origem: "Unidade vendida (Hércules)", rotulo: "Código da unidade", tipo: "texto" },
  { exemplo: "lote", fonte: UNIDADE_("tipo_unidade"), grupo: "unidade", nome: "tipo_unidade", origem: "Unidade vendida (Hércules)", rotulo: "Tipo da unidade (lote, apartamento…)", tipo: "texto" },
  { exemplo: "R$ 185.400,00", fonte: UNIDADE_("preco_tabela"), grupo: "unidade", nome: "preco_tabela_unidade", origem: "Tabela de preço da unidade (Hércules)", rotulo: "Preço de tabela", tipo: "dinheiro" },
  { exemplo: "cento e oitenta e cinco mil e quatrocentos reais", extensoDe: "preco_tabela_unidade", fonte: UNIDADE_("preco_extenso (ou por-extenso.ts sobre preco_tabela)"), grupo: "unidade", nome: "preco_tabela_unidade_extenso", origem: "Escrito pelo sistema", rotulo: "Preço de tabela por extenso", tipo: "extenso" },
];

// ── EMPREENDIMENTO ───────────────────────────────────────────────────────────
//
// Novo em 02/09/2026. As minutas do legado traziam o nome do loteamento ESCRITO no texto — cada
// minuta era de um empreendimento só. Com a variável, a mesma minuta serve a mais de um.
const EMPREENDIMENTO_VARS: VariavelDoContrato[] = [
  { exemplo: "Jardim das Gerais", fonte: EMPREENDIMENTO("nome"), grupo: "empreendimento", nome: "empreendimento_nome", origem: "Cadastro do empreendimento (Hércules)", rotulo: "Nome do empreendimento", tipo: "texto" },
  { exemplo: "JDG", fonte: EMPREENDIMENTO("codigo"), grupo: "empreendimento", nome: "empreendimento_codigo", origem: "Cadastro do empreendimento (Hércules)", rotulo: "Código do empreendimento", tipo: "texto" },
  { exemplo: "João Monlevade", fonte: EMPREENDIMENTO("cidade"), grupo: "empreendimento", nome: "empreendimento_cidade", origem: "Cadastro do empreendimento (Hércules)", rotulo: "Cidade do empreendimento", tipo: "texto" },
  { exemplo: "MG", fonte: EMPREENDIMENTO("uf"), grupo: "empreendimento", nome: "empreendimento_uf", origem: "Cadastro do empreendimento (Hércules)", rotulo: "UF do empreendimento", tipo: "texto" },
  { exemplo: "2,5%", fonte: { campo: "gestao_carteira_percentual", tabela: "apolo_enterprise_settings" }, grupo: "empreendimento", nome: "empreendimento_gestao_carteira_percentual", origem: "Configuração do empreendimento (Apolo)", rotulo: "Percentual de gestão de carteira", tipo: "texto" },
  { exemplo: "R$ 500,00", fonte: { campo: "taxa_cessao", tabela: "apolo_enterprise_settings" }, grupo: "empreendimento", nome: "empreendimento_taxa_cessao", origem: "Configuração do empreendimento (Apolo)", rotulo: "Taxa de cessão", tipo: "dinheiro" },
];

// ── VALORES DA VENDA ─────────────────────────────────────────────────────────
const VALORES: VariavelDoContrato[] = [
  { exemplo: "R$ 185.400,00", fonte: VENDA("valor_negociado"), grupo: "valores", nome: "valor_imovel_venda", origem: "Preço da venda", rotulo: "Valor do imóvel", tipo: "dinheiro" },
  { exemplo: "cento e oitenta e cinco mil e quatrocentos reais", extensoDe: "valor_imovel_venda", fonte: EXTENSO_DE("valor_imovel_venda"), grupo: "valores", nome: "valor_imovel_venda_extenso", origem: "Escrito pelo sistema", rotulo: "Valor do imóvel por extenso", tipo: "extenso" },
  { exemplo: "R$ 185.400,00", fonte: VENDA("valor_negociado"), grupo: "valores", nome: "preco_venda", origem: "Preço da venda", rotulo: "Preço de venda", tipo: "dinheiro" },
  { exemplo: "cento e oitenta e cinco mil e quatrocentos reais", extensoDe: "preco_venda", fonte: EXTENSO_DE("preco_venda"), grupo: "valores", nome: "preco_venda_extenso", origem: "Escrito pelo sistema", rotulo: "Preço de venda por extenso", tipo: "extenso" },
  { exemplo: "R$ 148.320,00", fonte: VENDA("valor_negociado - valor_entrada - valor_sinal"), grupo: "valores", nome: "valor_divida_financiada", origem: "Preço menos entrada e sinal", rotulo: "Valor financiado", tipo: "dinheiro" },
  { exemplo: "cento e quarenta e oito mil trezentos e vinte reais", extensoDe: "valor_divida_financiada", fonte: EXTENSO_DE("valor_divida_financiada"), grupo: "valores", nome: "valor_divida_financiada_extenso", origem: "Escrito pelo sistema", rotulo: "Valor financiado por extenso", tipo: "extenso" },
  // ⚠️ O MESMO NÚMERO COM DOIS PAPÉIS. Na minuta auditada, 185.400 aparecia como preço E como
  // garantia fiduciária. Trocar um pelo outro numa substituição global trocaria os dois — foi o que
  // o teste do marcador pegou, e é por isso que a substituição aqui nunca é cega.
  // A garantia não tem coluna no Panteon: fica PENDENTE (não é o valor negociado por definição).
  { exemplo: "R$ 185.400,00", fonte: PENDENTE("valor da garantia fiduciária — sem coluna em hercules_vendas"), grupo: "valores", nome: "valor_garantia_fiduciaria", origem: "Garantia definida no contrato", rotulo: "Valor da garantia fiduciária", tipo: "dinheiro" },
  { exemplo: "cento e oitenta e cinco mil e quatrocentos reais", extensoDe: "valor_garantia_fiduciaria", fonte: EXTENSO_DE("valor_garantia_fiduciaria"), grupo: "valores", nome: "valor_garantia_fiduciaria_extenso", origem: "Escrito pelo sistema", rotulo: "Garantia fiduciária por extenso", tipo: "extenso" },
  { exemplo: "120", fonte: VENDA("plano_snapshot.parcelas (temis_planos.parcelas na venda)"), grupo: "valores", nome: "prazo_meses_amortizacao", origem: "Parcelas do plano", rotulo: "Prazo em meses", tipo: "numero" },
  { exemplo: "cento e vinte", extensoDe: "prazo_meses_amortizacao", fonte: EXTENSO_DE("prazo_meses_amortizacao"), grupo: "valores", nome: "prazo_meses_amortizacao_extenso", origem: "Escrito pelo sistema", rotulo: "Prazo por extenso", tipo: "extenso" },
  // Novos em 02/09/2026: colunas de `hercules_vendas` que o catálogo medido não expunha.
  { exemplo: "R$ 37.080,00", fonte: VENDA("valor_entrada"), grupo: "valores", nome: "valor_entrada", origem: "Entrada da venda", rotulo: "Valor da entrada", tipo: "dinheiro" },
  { exemplo: "trinta e sete mil e oitenta reais", extensoDe: "valor_entrada", fonte: EXTENSO_DE("valor_entrada"), grupo: "valores", nome: "valor_entrada_extenso", origem: "Escrito pelo sistema", rotulo: "Entrada por extenso", tipo: "extenso" },
  { exemplo: "R$ 5.000,00", fonte: VENDA("valor_sinal"), grupo: "valores", nome: "valor_sinal", origem: "Sinal da venda", rotulo: "Valor do sinal", tipo: "dinheiro" },
  { exemplo: "cinco mil reais", extensoDe: "valor_sinal", fonte: EXTENSO_DE("valor_sinal"), grupo: "valores", nome: "valor_sinal_extenso", origem: "Escrito pelo sistema", rotulo: "Sinal por extenso", tipo: "extenso" },
  { exemplo: "10", fonte: VENDA("dia_vencimento"), grupo: "valores", nome: "dia_vencimento", origem: "Dia de vencimento das parcelas", rotulo: "Dia de vencimento", tipo: "numero" },
  { exemplo: "dez", extensoDe: "dia_vencimento", fonte: EXTENSO_DE("dia_vencimento"), grupo: "valores", nome: "dia_vencimento_extenso", origem: "Escrito pelo sistema", rotulo: "Dia de vencimento por extenso", tipo: "extenso" },
  { exemplo: "01 de setembro de 2026", fonte: VENDA("vendida_em"), grupo: "valores", nome: "data_venda", origem: "Data da venda", rotulo: "Data da venda", tipo: "data" },
];

// ── PLANOS NA FOLHA DA PROPOSTA ──────────────────────────────────────────────
//
// Estes nomes casam um a um com o `slot` do plano (`avista`, `curto`, `investidor`, `normal`) — foi
// o legado que fixou o vocabulário, e o cadastro do Temis o preservou (`temis_planos.slot`).
const SLOTS_NA_MINUTA = ["normal", "normal_2", "investidor", "curto"] as const;
const CAMPOS_DO_PLANO: { campo: string; rotulo: string; sufixo: string; tipo: TipoDeVariavel }[] = [
  { campo: "cálculo de lib/apolo/planos-comerciais.ts sobre hercules_unidades.preco_tabela", rotulo: "valor de tabela", sufixo: "valor_tabela", tipo: "dinheiro" },
  { campo: "entrada_percentual sobre o valor de tabela", rotulo: "sinal", sufixo: "valor_sinal", tipo: "dinheiro" },
  { campo: "parcelas", rotulo: "quantidade de parcelas", sufixo: "quantidade_parcelas", tipo: "numero" },
  { campo: "cálculo de lib/apolo/planos-comerciais.ts (parcelas, juros_taxa, sistema_amortizacao)", rotulo: "valor da parcela", sufixo: "valor_parcelas", tipo: "dinheiro" },
];

// O PLANO DA VENDA (não o da folha da PA): o que ficou congelado em `hercules_vendas.plano_snapshot`.
// Novos em 02/09/2026.
const PLANO_DA_VENDA: VariavelDoContrato[] = [
  { exemplo: "Normal 120x", fonte: PLANO("nome (via hercules_vendas.plano_snapshot)"), grupo: "plano", nome: "plano_nome", origem: "Plano da venda", rotulo: "Nome do plano", tipo: "texto" },
  { exemplo: "120", fonte: PLANO("parcelas (via hercules_vendas.plano_snapshot)"), grupo: "plano", nome: "plano_quantidade_parcelas", origem: "Plano da venda", rotulo: "Quantidade de parcelas do plano", tipo: "numero" },
  { exemplo: "20%", fonte: PLANO("entrada_percentual (via hercules_vendas.plano_snapshot)"), grupo: "plano", nome: "plano_entrada_percentual", origem: "Plano da venda", rotulo: "Entrada (%) do plano", tipo: "texto" },
  { exemplo: "12% ao ano", fonte: PLANO("juros_taxa + juros_periodicidade (via hercules_vendas.plano_snapshot)"), grupo: "plano", nome: "plano_juros", origem: "Plano da venda", rotulo: "Juros do plano", tipo: "texto" },
  { exemplo: "IPCA anual", fonte: PLANO("indice_correcao (via hercules_vendas.plano_snapshot)"), grupo: "plano", nome: "plano_indice_correcao", origem: "Plano da venda", rotulo: "Índice de correção do plano", tipo: "texto" },
  { exemplo: "SACOC", fonte: PLANO("sistema_amortizacao (via hercules_vendas.plano_snapshot)"), grupo: "plano", nome: "plano_sistema_amortizacao", origem: "Plano da venda", rotulo: "Sistema de amortização do plano", tipo: "texto" },
];

// ── CORRETAGEM ───────────────────────────────────────────────────────────────
//
// O "vinculado" é a imobiliária OU o corretor da venda (`hercules_vendas.imobiliaria_entity_id` /
// `corretor_entity_id`, ambos `apolo_entities`). A COORDENADORA DE VENDAS não tem cadastro no
// Panteon: fica pendente até existir.
const VINCULADO = (campo: string): FonteDaVariavel => ({ campo: `${campo} (imobiliaria_entity_id ou corretor_entity_id da venda)`, tabela: "apolo_entities" });
const VINCULADO_FICHA = (campo: string): FonteDaVariavel => ({ campo: `ficha.${campo} (imobiliaria_entity_id ou corretor_entity_id da venda)`, tabela: "apolo_esteira" });
const COORDENADORA = (campo: string): FonteDaVariavel => PENDENTE(`coordenadora de vendas do empreendimento — sem cadastro no Panteon (${campo})`);

const CORRETAGEM: VariavelDoContrato[] = [
  { exemplo: "IMOBILIÁRIA CENTRAL LTDA.", fonte: VINCULADO("display_name"), grupo: "corretagem", nome: "nome_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "Nome do vinculado", tipo: "texto" },
  { exemplo: "11.222.333/0001-44", fonte: VINCULADO_FICHA("empresa.cnpj / identificacao.cpf"), grupo: "corretagem", nome: "cpf_cnpj_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "CPF/CNPJ do vinculado", tipo: "texto" },
  { exemplo: "CRECI 12345", fonte: VINCULADO_FICHA("empresa.creci"), grupo: "corretagem", nome: "creci_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "CRECI do vinculado", tipo: "texto" },
  { exemplo: "(31) 3333-0000", fonte: VINCULADO_FICHA("empresa.telefone / perfil.telefone"), grupo: "corretagem", nome: "telefone_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "Telefone do vinculado", tipo: "texto" },
  { exemplo: "contato@imobiliaria.com.br", fonte: VINCULADO_FICHA("empresa.email / perfil.email"), grupo: "corretagem", nome: "email_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "E-mail do vinculado", tipo: "texto" },
  { exemplo: "Careli Vendas", fonte: COORDENADORA("nome fantasia"), grupo: "corretagem", nome: "nome_fantasia_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Coordenadora de vendas", tipo: "texto" },
  { exemplo: "11.115.899/0001-04", fonte: COORDENADORA("CNPJ"), grupo: "corretagem", nome: "cnpj_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "CNPJ da coordenadora", tipo: "texto" },
  { exemplo: "Avenida Central", fonte: COORDENADORA("logradouro"), grupo: "corretagem", nome: "rua_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Logradouro da coordenadora", tipo: "texto" },
  { exemplo: "1000", fonte: COORDENADORA("número"), grupo: "corretagem", nome: "numero_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Número da coordenadora", tipo: "texto" },
  { exemplo: "Centro", fonte: COORDENADORA("bairro"), grupo: "corretagem", nome: "bairro_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Bairro da coordenadora", tipo: "texto" },
  { exemplo: "Belo Horizonte/MG", fonte: COORDENADORA("cidade/UF"), grupo: "corretagem", nome: "cidade_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Cidade da coordenadora", tipo: "texto" },
  { exemplo: "30110-000", fonte: COORDENADORA("CEP"), grupo: "corretagem", nome: "cep_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "CEP da coordenadora", tipo: "texto" },
  { exemplo: "(31) 3333-1111", fonte: COORDENADORA("telefone"), grupo: "corretagem", nome: "telefone_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Telefone da coordenadora", tipo: "texto" },
  { exemplo: "vendas@careli.adm.br", fonte: COORDENADORA("e-mail"), grupo: "corretagem", nome: "email_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "E-mail da coordenadora", tipo: "texto" },
  // A comissão por empreendimento não tem coluna no Panteon (o legado a tinha por empreendimento:
  // VAL 7,5%, VLO 6%). Pendente até o Hércules cadastrá-la.
  { exemplo: "R$ 11.124,00", fonte: PENDENTE("percentual de comissão do empreendimento × valor_negociado — sem coluna"), grupo: "corretagem", nome: "valor_total_comissao", origem: "Comissão do empreendimento sobre o preço", rotulo: "Comissão total", tipo: "dinheiro" },
  { exemplo: "onze mil cento e vinte e quatro reais", extensoDe: "valor_total_comissao", fonte: EXTENSO_DE("valor_total_comissao"), grupo: "corretagem", nome: "valor_total_comissao_extenso", origem: "Escrito pelo sistema", rotulo: "Comissão total por extenso", tipo: "extenso" },
  { exemplo: "R$ 3.708,00", fonte: PENDENTE("rateio da comissão — sem coluna"), grupo: "corretagem", nome: "valor_pago_coordenadora_vendas", origem: "Rateio da comissão", rotulo: "Parte da coordenadora", tipo: "dinheiro" },
  { exemplo: "três mil setecentos e oito reais", extensoDe: "valor_pago_coordenadora_vendas", fonte: EXTENSO_DE("valor_pago_coordenadora_vendas"), grupo: "corretagem", nome: "valor_pago_coordenadora_vendas_extenso", origem: "Escrito pelo sistema", rotulo: "Parte da coordenadora por extenso", tipo: "extenso" },
  { exemplo: "R$ 7.416,00", fonte: PENDENTE("rateio da comissão — sem coluna"), grupo: "corretagem", nome: "valor_corretagem_menos_coordenadora_vendas", origem: "Rateio da comissão", rotulo: "Corretagem menos a coordenadora", tipo: "dinheiro" },
  { exemplo: "sete mil quatrocentos e dezesseis reais", extensoDe: "valor_corretagem_menos_coordenadora_vendas", fonte: EXTENSO_DE("valor_corretagem_menos_coordenadora_vendas"), grupo: "corretagem", nome: "valor_corretagem_menos_coordenadora_vendas_extenso", origem: "Escrito pelo sistema", rotulo: "Corretagem menos coordenadora por extenso", tipo: "extenso" },
  // Novos em 02/09/2026: imobiliária e corretor separados, cada um pelo seu vínculo na venda.
  { exemplo: "IMOBILIÁRIA CENTRAL LTDA.", fonte: ENTIDADE("display_name (imobiliaria_entity_id da venda)"), grupo: "corretagem", nome: "imobiliaria_nome", origem: "Imobiliária da venda", rotulo: "Nome da imobiliária", tipo: "texto" },
  { exemplo: "11.222.333/0001-44", fonte: FICHA("empresa.cnpj (imobiliaria_entity_id da venda)"), grupo: "corretagem", nome: "imobiliaria_cnpj", origem: "Imobiliária da venda", rotulo: "CNPJ da imobiliária", tipo: "texto" },
  { exemplo: "CRECI J-1234", fonte: FICHA("empresa.creci (imobiliaria_entity_id da venda)"), grupo: "corretagem", nome: "imobiliaria_creci", origem: "Imobiliária da venda", rotulo: "CRECI da imobiliária", tipo: "texto" },
  { exemplo: "CARLOS ALBERTO LIMA", fonte: ENTIDADE("display_name (corretor_entity_id da venda)"), grupo: "corretagem", nome: "corretor_nome", origem: "Corretor da venda", rotulo: "Nome do corretor", tipo: "texto" },
  { exemplo: "111.222.333-44", fonte: FICHA("identificacao.cpf (corretor_entity_id da venda)"), grupo: "corretagem", nome: "corretor_cpf", origem: "Corretor da venda", rotulo: "CPF do corretor", tipo: "texto" },
  { exemplo: "CRECI 12345", fonte: FICHA("corretores[].creci (corretor_entity_id da venda)"), grupo: "corretagem", nome: "corretor_creci", origem: "Corretor da venda", rotulo: "CRECI do corretor", tipo: "texto" },
];

// ── CONTRATO E TRECHOS GERADOS ───────────────────────────────────────────────
const CONTRATO: VariavelDoContrato[] = [
  { exemplo: "01 de setembro de 2026", fonte: SISTEMA("data de hoje ao gerar"), grupo: "contrato", nome: "data_emissao_contrato", origem: "Data em que o contrato é gerado", rotulo: "Data de emissão", tipo: "data" },
  { exemplo: "primeiro de setembro de dois mil e vinte e seis", extensoDe: "data_emissao_contrato", fonte: EXTENSO_DE("data_emissao_contrato"), grupo: "contrato", nome: "data_emissao_contrato_extenso", origem: "Escrito pelo sistema", rotulo: "Data de emissão por extenso", tipo: "extenso" },
];

// ⚠️ ESTES NÃO SÃO CAMPOS, SÃO TRECHOS INTEIROS que o sistema escreve — parágrafo e tabela. Quem
// edita a minuta posiciona o marcador; o texto sai do plano da venda. Apagar o marcador não deixa a
// frase em branco: some com o parágrafo do contrato.
const GERADO = SISTEMA("escrito a partir de hercules_vendas + plano_snapshot");
const GERADOS: VariavelDoContrato[] = [
  { exemplo: "(parágrafo do sinal, com valor e vencimento)", fonte: GERADO, grupo: "gerado", nome: "paragrafo_sinal", origem: "Plano da venda", rotulo: "Parágrafo do sinal", tipo: "gerado" },
  { exemplo: "(parágrafo do parcelamento)", fonte: GERADO, grupo: "gerado", nome: "paragrafo_parcelamento", origem: "Plano da venda", rotulo: "Parágrafo do parcelamento", tipo: "gerado" },
  { exemplo: "(parágrafo dos vencimentos)", fonte: GERADO, grupo: "gerado", nome: "paragrafo_vencimento", origem: "Plano da venda", rotulo: "Parágrafo do vencimento", tipo: "gerado" },
  { exemplo: "(tabela das parcelas)", fonte: GERADO, grupo: "gerado", nome: "tabela_pagamentos", origem: "Plano da venda", rotulo: "Tabela de pagamentos", tipo: "gerado" },
  { exemplo: "(tabela geral das parcelas)", fonte: GERADO, grupo: "gerado", nome: "tabela_geral_pagamentos", origem: "Plano da venda", rotulo: "Tabela geral de pagamentos", tipo: "gerado" },
];

/** Acrescenta o sufixo ao nome mantendo a leitura ("nome_cliente" + "_2"). */
function comSufixo(base: string, sufixo: string): string {
  return `${base}${sufixo}`;
}

function expandirPorComprador(bases: Base[]): VariavelDoContrato[] {
  const saida: VariavelDoContrato[] = [];
  for (const [indice, sufixo] of SUFIXOS.entries()) {
    const ordinal = indice + 1;
    for (const b of bases) {
      saida.push({
        exemplo: b.exemplo,
        // Do 2º comprador em diante o valor sai do participante N da venda, não da entidade principal.
        fonte: ordinal === 1 ? b.fonte : { ...b.fonte, campo: `${b.fonte.campo ?? ""} (participante ${ordinal} de hercules_vendas.participantes)`.trim() },
        grupo: b.grupo,
        nome: comSufixo(b.base, sufixo),
        origem: b.origem,
        rotulo: ordinal === 1 ? b.rotulo : `${b.rotulo} — ${ordinal}º comprador`,
        tipo: b.tipo,
      });
    }
  }
  return saida;
}

function expandirBlocos(): VariavelDoContrato[] {
  const saida: VariavelDoContrato[] = [];

  for (const [indice, sufixo] of SUFIXOS.entries()) {
    const ordinal = indice + 1;

    // ⚠️ O PRIMEIRO COMPRADOR NÃO TEM BLOCO PRÓPRIO, e não é esquecimento do legado: ele sempre
    // existe. Do segundo em diante o bloco é o que faz o trecho sumir quando a venda tem menos gente.
    if (ordinal > 1) {
      const fonte = SISTEMA(`decide por hercules_vendas.participantes ter o ${ordinal}º comprador`);
      saida.push(
        {
          exemplo: "",
          fonte,
          grupo: "bloco",
          nome: `inicio_dados_cliente${sufixo}`,
          origem: "Sai só quando a venda tem esse comprador",
          rotulo: `Início — dados do ${ordinal}º comprador`,
          tipo: "bloco_inicio",
        },
        {
          exemplo: "",
          fonte,
          grupo: "bloco",
          nome: `fim_dados_cliente${sufixo}`,
          origem: "Sai só quando a venda tem esse comprador",
          rotulo: `Fim — dados do ${ordinal}º comprador`,
          tipo: "bloco_fim",
        },
      );
    }

    for (const bloco of BLOCOS_POR_COMPRADOR) {
      saida.push(
        {
          exemplo: "",
          fonte: bloco.fonte,
          grupo: "bloco",
          nome: comSufixo(bloco.inicio, sufixo),
          origem: bloco.rotulo,
          rotulo: ordinal === 1 ? `Início — ${bloco.rotulo}` : `Início — ${bloco.rotulo} (${ordinal}º)`,
          tipo: "bloco_inicio",
        },
        {
          exemplo: "",
          fonte: bloco.fonte,
          grupo: "bloco",
          nome: comSufixo(bloco.fim, sufixo),
          origem: bloco.rotulo,
          rotulo: ordinal === 1 ? `Fim — ${bloco.rotulo}` : `Fim — ${bloco.rotulo} (${ordinal}º)`,
          tipo: "bloco_fim",
        },
      );
    }
  }

  return saida;
}

function expandirPlanos(): VariavelDoContrato[] {
  const saida: VariavelDoContrato[] = [];
  for (const slot of SLOTS_NA_MINUTA) {
    for (const campo of CAMPOS_DO_PLANO) {
      saida.push({
        exemplo: campo.tipo === "dinheiro" ? "R$ 185.400,00" : "120",
        fonte: PLANO(`slot = "${slot.replace("_2", "")}": ${campo.campo}`),
        grupo: "plano",
        nome: `plano_${slot}_${campo.sufixo}`,
        origem: `Plano na posição "${slot.replace("_2", " (segundo)")}" do empreendimento`,
        rotulo: `Plano ${slot.replace("_", " ")} — ${campo.rotulo}`,
        tipo: campo.tipo,
      });
    }
  }
  return saida;
}

/**
 * Todas as variáveis que o Temis sabe preencher.
 *
 * ⚠️ Os NOMES são os medidos nas minutas do legado (a minuta reconhece); os VALORES saem do
 * Panteon — ver a nota do topo e o `fonte` de cada uma.
 */
export const VARIAVEIS_DO_CONTRATO: VariavelDoContrato[] = [
  ...expandirPorComprador(COMPRADOR),
  ...expandirPorComprador(EMPRESA),
  ...expandirPorComprador(CONJUGE),
  ...expandirBlocos(),
  ...UNIDADE,
  ...EMPREENDIMENTO_VARS,
  ...VALORES,
  ...expandirPlanos(),
  ...PLANO_DA_VENDA,
  ...CORRETAGEM,
  ...CONTRATO,
  ...GERADOS,
];

const PORNOME = new Map(VARIAVEIS_DO_CONTRATO.map((v) => [v.nome, v]));

/** A variável, se o Temis souber preenchê-la. */
export function acharVariavel(nome: string): undefined | VariavelDoContrato {
  return PORNOME.get(nome);
}

/** As variáveis que o Panteon ainda não tem de onde tirar. Para a tela avisar — e para o backlog. */
export function variaveisPendentes(): VariavelDoContrato[] {
  return VARIAVEIS_DO_CONTRATO.filter((v) => v.fonte.tabela === "pendente");
}

/** A fonte em uma linha, para o hover do chip e o painel: "hercules_unidades.quadra", "pendente no Panteon". */
export function descreverFonte(fonte: FonteDaVariavel): string {
  if (fonte.tabela === "pendente") return `pendente no Panteon${fonte.campo ? ` (${fonte.campo})` : ""}`;
  if (fonte.tabela === "sistema") return `escrito pelo sistema${fonte.campo ? ` (${fonte.campo})` : ""}`;
  return fonte.campo ? `${fonte.tabela}.${fonte.campo}` : fonte.tabela;
}

/** Os nomes entre colchetes que aparecem no texto, na ordem em que aparecem. */
export function variaveisDoTexto(texto: string): string[] {
  return [...texto.matchAll(/\[([A-Za-z0-9_]{2,80})\]/g)].map((m) => m[1] as string);
}

export type Classificacao = {
  /** Quantas vezes cada variável conhecida aparece. */
  conhecidas: { nome: string; ocorrencias: number; variavel: VariavelDoContrato }[];
  /** Aparecem no texto mas nenhum motor preenche — saem impressas como estão. */
  desconhecidas: { nome: string; ocorrencias: number }[];
};

/**
 * Separa o que o sistema preenche do que vai sair impresso literalmente.
 *
 * ⚠️ ISTO É O AVISO QUE FALTAVA NO LEGADO. `[Nome]` e `[CPF]` existem em minutas antigas e nenhum
 * motor os conhece: o contrato sai com "[Nome]" escrito no papel. Aqui elas aparecem na tela antes
 * de o documento ir para assinatura.
 */
export function classificarVariaveis(texto: string): Classificacao {
  const contagem = new Map<string, number>();
  for (const nome of variaveisDoTexto(texto)) {
    contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
  }

  const conhecidas: Classificacao["conhecidas"] = [];
  const desconhecidas: Classificacao["desconhecidas"] = [];

  for (const [nome, ocorrencias] of contagem) {
    const variavel = PORNOME.get(nome);
    if (variavel) conhecidas.push({ nome, ocorrencias, variavel });
    else desconhecidas.push({ nome, ocorrencias });
  }

  conhecidas.sort((a, b) => b.ocorrencias - a.ocorrencias);
  desconhecidas.sort((a, b) => b.ocorrencias - a.ocorrencias);
  return { conhecidas, desconhecidas };
}

export type ProblemaDeBloco = {
  bloco: string;
  problema: "abre_sem_fechar" | "fecha_sem_abrir" | "fora_de_ordem";
  texto: string;
};

/**
 * Confere se cada `[inicio_x]` tem o seu `[fim_x]`, na ordem certa.
 *
 * ⚠️ ESTE É O DEFEITO QUE JÁ CHEGOU AO CLIENTE. No contrato do Villa Paris o bloco de pessoa
 * jurídica saiu impresso num comprador pessoa física. Um bloco desbalanceado faz o motor imprimir o
 * trecho que devia sumir — ou sumir com o trecho que devia sair. Nenhum dos dois dá erro; os dois
 * saem no papel que o cliente assina. Por isso a conferência roda ANTES de publicar a minuta.
 */
export function conferirBlocos(texto: string): ProblemaDeBloco[] {
  const problemas: ProblemaDeBloco[] = [];
  const pilha: string[] = [];

  for (const nome of variaveisDoTexto(texto)) {
    if (nome.startsWith("inicio_")) {
      pilha.push(nome.slice("inicio_".length));
      continue;
    }
    if (!nome.startsWith("fim_")) continue;

    const bloco = nome.slice("fim_".length);
    const topo = pilha[pilha.length - 1];

    if (topo === bloco) {
      pilha.pop();
      continue;
    }

    if (pilha.includes(bloco)) {
      // Fecha um bloco que não é o mais interno: os trechos se cruzam, e o motor decide sozinho
      // onde cada um termina.
      problemas.push({
        bloco,
        problema: "fora_de_ordem",
        texto: `O bloco "${bloco}" fecha antes de "${topo}", que foi aberto depois dele. Os trechos estão cruzados.`,
      });
      // Descarta até o bloco fechado para não repetir o mesmo aviso em cascata.
      while (pilha.length && pilha.pop() !== bloco) {
        /* desempilha */
      }
      continue;
    }

    problemas.push({
      bloco,
      problema: "fecha_sem_abrir",
      texto: `Existe [fim_${bloco}] sem o [inicio_${bloco}] correspondente.`,
    });
  }

  for (const bloco of pilha) {
    problemas.push({
      bloco,
      problema: "abre_sem_fechar",
      texto: `Existe [inicio_${bloco}] sem o [fim_${bloco}] correspondente.`,
    });
  }

  return problemas;
}

/**
 * Pares valor/extenso em que só um dos dois está na minuta.
 *
 * O contrato que escreve "R$ 185.400,00" sem o extenso ao lado é aceito pelo cartório, mas o que
 * escreve só o extenso perde o número — e o que tem o extenso de um valor que não aparece no texto
 * quase sempre é sobra de um copiar e colar.
 */
export function extensosOrfaos(texto: string): string[] {
  const presentes = new Set(variaveisDoTexto(texto));
  const orfaos: string[] = [];
  for (const nome of presentes) {
    const v = PORNOME.get(nome);
    if (v?.extensoDe && !presentes.has(v.extensoDe)) orfaos.push(nome);
  }
  return orfaos.sort();
}

/** Rótulo do grupo, para o menu do editor. */
export function rotuloDoGrupo(grupo: GrupoDeVariavel): string {
  const mapa: Record<GrupoDeVariavel, string> = {
    bloco: "Blocos condicionais",
    comprador: "Comprador",
    conjuge: "Cônjuge",
    contrato: "Contrato",
    corretagem: "Corretagem",
    empreendimento: "Empreendimento",
    empresa: "Comprador pessoa jurídica",
    gerado: "Trechos escritos pelo sistema",
    plano: "Planos de pagamento",
    unidade: "Unidade",
    valores: "Valores da venda",
  };
  return mapa[grupo];
}

/** A ordem em que os grupos aparecem no menu: do mais usado ao mais raro. */
export const ORDEM_DOS_GRUPOS: GrupoDeVariavel[] = [
  "comprador",
  "conjuge",
  "empresa",
  "unidade",
  "empreendimento",
  "valores",
  "plano",
  "corretagem",
  "contrato",
  "gerado",
  "bloco",
];

export type CodigoPartido = {
  /** O nome como aparece no texto, já remontado. */
  nome: string;
  /** Quantas vezes ele existe no texto renderizado. */
  noTexto: number;
  /** Quantas vezes existe INTEIRO no HTML. A diferença é o que o motor não vai achar. */
  noHtml: number;
};

/**
 * Códigos que o texto mostra inteiros mas o HTML tem partidos por tag.
 *
 * ⚠️ ESTE É O DEFEITO MAIS TRAIÇOEIRO QUE ACHAMOS, e ele chegou ao contrato. Em 01/09/2026, o
 * primeiro contrato de teste do Jardim das Gerais saiu com `[nome_cliente]` impresso no lugar do
 * nome do comprador — enquanto CPF, e-mail, telefone, endereço e todo o resto preencheram. A causa
 * estava no HTML da minuta:
 *
 *     <strong>[nome_cl</strong></span><span ...><strong>iente]</strong>
 *
 * Alguém posicionou o cursor no meio da palavra e o CKEditor partiu o `<span>` de fonte ali. Na
 * tela lê-se `[nome_cliente]` normalmente; o texto renderizado é idêntico. Mas o motor do legado
 * procura a string no HTML, e no HTML ela não existe — existem `[nome_cl` e `iente]` em elementos
 * separados.
 *
 * Nenhuma revisão visual pega isso. Nenhuma conferência que olhe só o texto pega isso. Só comparar
 * o texto com o HTML pega. (Desde 02/09/2026 a variável é um nó atômico no editor, o que impede o
 * defeito de NASCER lá; a conferência continua para o que chega de fora — .docx, HTML colado.)
 */
export function codigosPartidos(html: string): CodigoPartido[] {
  const texto = html.replace(/<[^>]+>/g, "");
  const noTexto = new Map<string, number>();
  for (const nome of variaveisDoTexto(texto)) {
    noTexto.set(nome, (noTexto.get(nome) ?? 0) + 1);
  }

  const partidos: CodigoPartido[] = [];
  for (const [nome, vezesNoTexto] of noTexto) {
    const marcador = `[${nome}]`;
    let vezesNoHtml = 0;
    let de = 0;
    while ((de = html.indexOf(marcador, de)) !== -1) {
      vezesNoHtml += 1;
      de += marcador.length;
    }
    if (vezesNoHtml < vezesNoTexto) {
      partidos.push({ nome, noHtml: vezesNoHtml, noTexto: vezesNoTexto });
    }
  }

  return partidos.sort((a, b) => a.nome.localeCompare(b.nome));
}
