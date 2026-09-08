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
  | "anexo"
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
  | "valores"
  | "vendedora";

export type TipoDeVariavel =
  | "anexo"
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
  | "temis_categorias"
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
// A ficha do CAD vive em `apolo_esteira.ficha` (jsonb, migration 0058).
//
// ⚠️ A FICHA É PLANA, e este catálogo dizia que era aninhada. Corrigido em 08/09/2026, depois de
// medir: das 577 fichas em produção, ZERO têm as chaves `identificacao`, `perfil`, `endereco`,
// `conjuge` ou `empresa`. Tudo vive na RAIZ, em camelCase — `dataNascimento`, `nacionalidade`,
// `estadoCivilId`, `logradouro`, `conjugeNome`. Os três caminhos que gravam ficha (a migration
// 0058, o PATCH do board em `board-do-servidor.ts` e a importação do Asana) gravam plano.
//
// O shape aninhado EXISTE, e é de onde veio o erro: é o DTO que a leitura do MOSTQI devolve ao
// wizard (`app/api/apolo/cadastro/route.ts`), com `identificacao.cpf`, `endereco.logradouro` e
// `perfil`. Só que ele é efêmero — a rota responde e nada é gravado assim.
//
// ⚠️ E O CPF NÃO ESTÁ NA FICHA. Nem o CNPJ. Os dois moram em `apolo_entities.document_masked`, que
// guarda o documento COMPLETO E FORMATADO apesar do nome da coluna ("123.456.789-00"). Um motor que
// procurasse `ficha.cpf` acharia `undefined` em 100% das fichas.
//
// ⚠️ E A FICHA É A CAMADA DE CIMA, NÃO A ÚNICA. No cadastro pelo wizard, endereço, contato e cônjuge
// nascem em `apolo_addresses`, `apolo_contacts` e `apolo_relationships` — a ficha só recebe o que
// alguém editou depois, pela tela de validação. Quem lê resolve campo a campo com a ficha ganhando
// (`unirEndereco` e `unirConjuge` em `lib/apolo/cadastro-cascata.ts`), e é assim que o motor de
// contrato vai ter de ler: só a ficha perderia o endereço de quem nunca foi editado à mão.
//
// ⚠️ E OS `*Id` SÃO NÚMEROS, NÃO TEXTO. `estadoCivilId: "2"` é "Casado (a)"; `regimeBensId: "1"` é
// "Comunhão parcial de bens". A tradução vive em `lib/apolo/c2x-fields.ts` (e
// `c2x-professions.ts`, com 234 profissões) e é OBRIGATÓRIA: sem ela o contrato sai com o número.
const ENTIDADE = (campo: string): FonteDaVariavel => ({ campo, tabela: "apolo_entities" });
const FICHA = (caminho: string): FonteDaVariavel => ({ campo: `ficha.${caminho}`, tabela: "apolo_esteira" });
/** Campo da ficha que TAMBÉM existe em outra tabela — a ficha ganha, a outra é a base. Ver a nota acima. */
const FICHA_OU = (caminho: string, outra: string): FonteDaVariavel => ({
  campo: `ficha.${caminho} (ou ${outra}, quando a ficha não tem)`,
  tabela: "apolo_esteira",
});
/** O documento do titular: CPF ou CNPJ, completo e com máscara, na coluna da entidade. */
const DOCUMENTO: FonteDaVariavel = {
  campo: "document_masked (o documento COMPLETO, apesar do nome)",
  tabela: "apolo_entities",
};
/**
 * Um `*Id` que precisa ser traduzido para o rótulo antes de entrar no contrato.
 *
 * ⚠️ O NÚMERO É O VOCABULÁRIO HERDADO, mas a tradução é NOSSA e local: as listas vivem em
 * `lib/apolo/c2x-fields.ts` e `lib/apolo/c2x-professions.ts`, dentro do Panteon. Nada aqui consulta
 * o legado — o nome dos arquivos é herança, não dependência.
 */
const FICHA_ID = (chave: string, catalogo: string): FonteDaVariavel => ({
  campo: `ficha.${chave} → rótulo em ${catalogo}`,
  tabela: "apolo_esteira",
});
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
  { base: "nacionalidade_cliente", exemplo: "brasileiro", fonte: FICHA("nacionalidade"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Nacionalidade", tipo: "texto" },
  { base: "estado_civil_cliente", exemplo: "casado", fonte: FICHA_ID("estadoCivilId", "a lista de estados civis"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Estado civil", tipo: "texto" },
  { base: "regime_casamento_cliente", exemplo: "comunhão parcial de bens", fonte: FICHA_ID("regimeBensId", "a lista de regimes de bens"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Regime de casamento", tipo: "texto" },
  { base: "profissao_cliente", exemplo: "engenheiro", fonte: FICHA_ID("profissaoId (ou profissaoOutro, texto livre)", "a lista de profissões"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Profissão", tipo: "texto" },
  { base: "cpf_cliente", exemplo: "123.456.789-00", fonte: DOCUMENTO, grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "CPF", tipo: "texto" },
  // O RG chega pela importação do Asana (`asana-import.ts` grava `rg` e `orgaoEmissor` na ficha);
  // o wizard de cadastro manual ainda não o pede.
  { base: "rg_cliente", exemplo: "MG-12.345.678", fonte: FICHA("rg + orgaoEmissor"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "RG", tipo: "texto" },
  { base: "data_nascimento_cliente", exemplo: "15/03/1985", fonte: FICHA("dataNascimento"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Data de nascimento", tipo: "data" },
  { base: "email_cliente", exemplo: "thiago@exemplo.com.br", fonte: FICHA_OU("email", "apolo_contacts"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "E-mail", tipo: "texto" },
  { base: "telefone_cliente", exemplo: "(31) 99999-0000", fonte: FICHA_OU("telefone", "apolo_contacts"), grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Telefone", tipo: "texto" },
  { base: "rua_cliente", exemplo: "Rua das Acácias", fonte: FICHA_OU("logradouro", "apolo_addresses"), grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Logradouro", tipo: "texto" },
  { base: "numero_cliente", exemplo: "150", fonte: FICHA_OU("numero", "apolo_addresses"), grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Número", tipo: "texto" },
  { base: "bairro_cliente", exemplo: "Centro", fonte: FICHA_OU("bairro", "apolo_addresses"), grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Bairro", tipo: "texto" },
  { base: "cidade_cliente", exemplo: "João Monlevade/MG", fonte: FICHA_OU("cidade + uf", "apolo_addresses"), grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Cidade/UF", tipo: "texto" },
  { base: "cep_cliente", exemplo: "35930-000", fonte: FICHA_OU("cep", "apolo_addresses"), grupo: "comprador", origem: "Endereço do cadastro", rotulo: "CEP", tipo: "texto" },
  { base: "percentual_cliente", exemplo: "50%", fonte: VENDA("participantes[].percentual"), grupo: "comprador", origem: "Participação definida na venda", rotulo: "Percentual de participação", tipo: "texto" },
];

// ── COMPRADOR PESSOA JURÍDICA ────────────────────────────────────────────────
const EMPRESA: Base[] = [
  { base: "razao_social_cliente", exemplo: "SOUZA PARTICIPAÇÕES LTDA.", fonte: ENTIDADE("legal_name"), grupo: "empresa", origem: "Cadastro PJ", rotulo: "Razão social", tipo: "texto" },
  { base: "nome_fantasia_cliente", exemplo: "Souza Participações", fonte: ENTIDADE("trade_name"), grupo: "empresa", origem: "Cadastro PJ", rotulo: "Nome fantasia", tipo: "texto" },
  { base: "cnpj_cliente", exemplo: "11.115.899/0001-04", fonte: DOCUMENTO, grupo: "empresa", origem: "Cadastro PJ", rotulo: "CNPJ", tipo: "texto" },
];

// ── CÔNJUGE (um por comprador) ───────────────────────────────────────────────
const CONJUGE: Base[] = [
  { base: "nome_conjuge", exemplo: "MARIA DE SOUZA", fonte: FICHA_OU("conjugeNome", "apolo_relationships"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Nome do cônjuge", tipo: "texto" },
  { base: "nacionalidade_conjuge", exemplo: "brasileira", fonte: FICHA_OU("conjugeNacionalidade", "apolo_relationships"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Nacionalidade do cônjuge", tipo: "texto" },
  { base: "profissao_conjuge", exemplo: "professora", fonte: FICHA_ID("conjugeProfissaoId (ou conjugeProfissaoOutro)", "a lista de profissões"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Profissão do cônjuge", tipo: "texto" },
  { base: "cpf_conjuge", exemplo: "987.654.321-00", fonte: FICHA_OU("conjugeCpf", "apolo_relationships"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "CPF do cônjuge", tipo: "texto" },
  { base: "email_conjuge", exemplo: "maria@exemplo.com.br", fonte: FICHA_OU("conjugeEmail", "apolo_relationships"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "E-mail do cônjuge", tipo: "texto" },
  { base: "telefone_conjuge", exemplo: "(31) 98888-0000", fonte: FICHA_OU("conjugeTelefone", "apolo_relationships"), grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Telefone do cônjuge", tipo: "texto" },
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
  // ⚠️ ESTE PAR É A ORAÇÃO DO REGIME DE BENS, e existe porque "casado sob o regime de" é TEXTO da
  // minuta, não variável: num comprador solteiro a frase saía inteira, seguida do colchete vazio.
  // Escreva `[inicio_dados_casado]casado sob o regime de [regime_casamento_cliente][fim_dados_
  // casado]` e a oração some sozinha para quem não é casado.
  { fim: "fim_dados_casado", fonte: SISTEMA("decide por apolo_esteira.ficha.estadoCivilId — casado ou união estável"), inicio: "inicio_dados_casado", rotulo: "Só quando o comprador é casado ou tem união estável" },
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

// ── VENDEDORA (o incorporador ou a SPE) ──────────────────────────────────────
//
// Lucas, 07/09/2026, mandando o parágrafo real de um contrato do JDG: *"aqui é os dados do
// incorporador ou spe, vai estar no sistema também"* — e, logo depois, o motivo de não bastar
// prender isso ao empreendimento: *"acho legal ter pois agora com as categorias, eu posso dentro de
// um mesmo empreendimento ter dois vendedores"*.
//
// ⚠️ QUEM VENDE É A CATEGORIA, NÃO O EMPREENDIMENTO. É a mesma lógica que já vale para a minuta
// (`temis_categorias.minuta_id`): a categoria é o recorte que assina contrato próprio, e quem assina
// do lado de lá pode mudar junto. A cadeia de leitura é:
//
//     unidade → categoria → vendedor_entity_id      (o caso do recorte)
//              ↘ sem categoria → o vendedor do empreendimento   (o caso de todo dia)
//
// ⚠️ A VENDEDORA É UMA `apolo_entities` PJ, e não um cadastro novo — é o MESMO caminho da
// imobiliária, que já está neste catálogo: razão social em `legal_name`, CNPJ e natureza jurídica na
// ficha de PJ (`ficha.empresa`), sede em `ficha.endereco`. `apolo_incorporadores` (0083) existe para
// o ACESSO ao portal (slug, logo, o que ele enxerga) e não guarda CNPJ nem endereço; o elo entre os
// dois é o `entity_id` que ela já tem.
//
// ⚠️ A COLUNA `vendedor_entity_id` AINDA NÃO EXISTE — a migration está escrita e espera o OK. Até
// aplicá-la, estas variáveis saem vazias no contrato, como qualquer outra pendente.
// ⚠️ PENDENTE, e não `apolo_entities`. A entidade existe e os campos existem — o que não existe é a
// coluna que diz QUAL entidade vende: sem `vendedor_entity_id`, o motor não tem por onde começar a
// leitura, e uma fonte que aponta para uma tabela real faria a tela prometer um valor que sai
// vazio. Quando a migration for aplicada, estas duas viram `apolo_entities` / `apolo_esteira` e os
// nomes saem da lista de pendentes no teste.
const VENDEDORA = (campo: string): FonteDaVariavel =>
  PENDENTE(`apolo_entities.${campo} do vendedor_entity_id da categoria (coluna a criar)`);
const VENDEDORA_FICHA = (caminho: string): FonteDaVariavel =>
  PENDENTE(`apolo_esteira.ficha.${caminho} do vendedor_entity_id da categoria (coluna a criar)`);

const VENDEDORA_VARS: VariavelDoContrato[] = [
  { exemplo: "BILL EMPREENDIMENTOS IMOBILIÁRIOS EIRELI", fonte: VENDEDORA("legal_name"), grupo: "vendedora", nome: "vendedora_razao_social", origem: "Cadastro da vendedora (incorporador/SPE)", rotulo: "Razão social da vendedora", tipo: "texto" },
  { exemplo: "Bill Empreendimentos", fonte: VENDEDORA("trade_name"), grupo: "vendedora", nome: "vendedora_nome_fantasia", origem: "Cadastro da vendedora (incorporador/SPE)", rotulo: "Nome fantasia da vendedora", tipo: "texto" },
  { exemplo: "sociedade empresária limitada", fonte: VENDEDORA_FICHA("naturezaJuridica"), grupo: "vendedora", nome: "vendedora_natureza_juridica", origem: "Cadastro da vendedora (incorporador/SPE)", rotulo: "Natureza jurídica da vendedora", tipo: "texto" },
  { exemplo: "31.492.339/0001-86", fonte: VENDEDORA("document_masked (o documento completo)"), grupo: "vendedora", nome: "vendedora_cnpj", origem: "Cadastro da vendedora (incorporador/SPE)", rotulo: "CNPJ da vendedora", tipo: "texto" },
  { exemplo: "RUA MANACÁ", fonte: VENDEDORA_FICHA("logradouro (ou apolo_addresses)"), grupo: "vendedora", nome: "vendedora_rua", origem: "Sede da vendedora", rotulo: "Logradouro da sede", tipo: "texto" },
  { exemplo: "32", fonte: VENDEDORA_FICHA("numero (ou apolo_addresses)"), grupo: "vendedora", nome: "vendedora_numero", origem: "Sede da vendedora", rotulo: "Número da sede", tipo: "texto" },
  { exemplo: "ELDORADO", fonte: VENDEDORA_FICHA("bairro (ou apolo_addresses)"), grupo: "vendedora", nome: "vendedora_bairro", origem: "Sede da vendedora", rotulo: "Bairro da sede", tipo: "texto" },
  { exemplo: "CONTAGEM", fonte: VENDEDORA_FICHA("cidade (ou apolo_addresses)"), grupo: "vendedora", nome: "vendedora_cidade", origem: "Sede da vendedora", rotulo: "Cidade da sede", tipo: "texto" },
  // ⚠️ A SIGLA, NÃO O ESTADO POR EXTENSO. O contrato do JDG escreve "MINAS GERAIS" e a ficha guarda
  // "MG": quem quiser o nome inteiro escreve na minuta, porque inventar aqui um "por extenso" de UF
  // faria o mesmo estrago do "trezentos metros quadrados metros quadrados" (ver por-extenso.ts).
  { exemplo: "MG", fonte: VENDEDORA_FICHA("uf (ou apolo_addresses)"), grupo: "vendedora", nome: "vendedora_uf", origem: "Sede da vendedora", rotulo: "UF da sede", tipo: "texto" },
  { exemplo: "32.310-230", fonte: VENDEDORA_FICHA("cep (ou apolo_addresses)"), grupo: "vendedora", nome: "vendedora_cep", origem: "Sede da vendedora", rotulo: "CEP da sede", tipo: "texto" },
  // O representante legal é um relacionamento do grafo (`apolo_relationships.relationship_type =
  // representante_legal`, gravado pelo cadastro de PJ), não uma coluna da entidade.
  { exemplo: "JOSÉ CARLOS BILL", fonte: VENDEDORA("display_name do representante_legal em apolo_relationships"), grupo: "vendedora", nome: "vendedora_representante_nome", origem: "Representante legal da vendedora", rotulo: "Representante legal", tipo: "texto" },
  { exemplo: "123.456.789-00", fonte: VENDEDORA_FICHA("document_masked do representante_legal"), grupo: "vendedora", nome: "vendedora_representante_cpf", origem: "Representante legal da vendedora", rotulo: "CPF do representante legal", tipo: "texto" },
  // ⚠️ A QUALIFICAÇÃO REAL TRAZ MAIS QUE NOME E CPF. Lucas (07/09/2026), com o contrato do Villa
  // Paris na tela: *"trazer no bloco das partes o e-mail dos sócios"*. Lá está escrito o
  // representante inteiro — nacionalidade, estado civil, profissão, nascimento, filiação, RG, CPF,
  // endereço e e-mail. Sem essas variáveis, cada uma delas fica DIGITADA na minuta, e o contrato do
  // ano que vem sai com o sócio que saiu da empresa.
  { exemplo: "carlos@exemplo.com.br", fonte: VENDEDORA_FICHA("email do representante_legal"), grupo: "vendedora", nome: "vendedora_representante_email", origem: "Representante legal da vendedora", rotulo: "E-mail do representante legal", tipo: "texto" },
  { exemplo: "(31) 99999-0000", fonte: VENDEDORA_FICHA("telefone do representante_legal"), grupo: "vendedora", nome: "vendedora_representante_telefone", origem: "Representante legal da vendedora", rotulo: "Telefone do representante legal", tipo: "texto" },
  { exemplo: "brasileiro", fonte: VENDEDORA_FICHA("nacionalidade do representante_legal"), grupo: "vendedora", nome: "vendedora_representante_nacionalidade", origem: "Representante legal da vendedora", rotulo: "Nacionalidade do representante", tipo: "texto" },
  { exemplo: "casado", fonte: VENDEDORA_FICHA("estadoCivilId do representante_legal → rótulo"), grupo: "vendedora", nome: "vendedora_representante_estado_civil", origem: "Representante legal da vendedora", rotulo: "Estado civil do representante", tipo: "texto" },
  { exemplo: "empresário", fonte: VENDEDORA_FICHA("profissaoId do representante_legal → rótulo"), grupo: "vendedora", nome: "vendedora_representante_profissao", origem: "Representante legal da vendedora", rotulo: "Profissão do representante", tipo: "texto" },
  { exemplo: "MG-4.332.087", fonte: VENDEDORA_FICHA("rg + orgaoEmissor do representante_legal"), grupo: "vendedora", nome: "vendedora_representante_rg", origem: "Representante legal da vendedora", rotulo: "RG do representante", tipo: "texto" },
  { exemplo: "18/03/1968", fonte: VENDEDORA_FICHA("dataNascimento do representante_legal"), grupo: "vendedora", nome: "vendedora_representante_nascimento", origem: "Representante legal da vendedora", rotulo: "Nascimento do representante", tipo: "data" },
  { exemplo: "Rua Coronel Fabriciano, 225, Aclimação, João Monlevade/MG", fonte: VENDEDORA_FICHA("endereco do representante_legal"), grupo: "vendedora", nome: "vendedora_representante_endereco", origem: "Representante legal da vendedora", rotulo: "Endereço do representante", tipo: "texto" },
  // A categoria que decidiu qual vendedora sai — útil no cabeçalho da minuta e para conferir o que
  // o motor escolheu quando o empreendimento tem mais de uma.
  { exemplo: "Condomínio", fonte: { campo: "nome (categoria da unidade vendida)", tabela: "temis_categorias" }, grupo: "vendedora", nome: "categoria_nome", origem: "Categoria da unidade vendida", rotulo: "Nome da categoria", tipo: "texto" },
];

// ── ANEXOS: AS PEÇAS DO CONTRATO QUE NÃO SÃO TEXTO ───────────────────────────
//
// Lucas, 07/09/2026: *"muita peça do contrato são PDF prontos que podemos somente anexar, isso
// ajuda, por exemplo, convenção de condomínios e tal"*; *"vai ter situação que cada contrato tem que
// trazer a planta específica daquela unidade, então no campo de cadastro de unidades temos que ter
// opção de anexar arquivos que tem que ir como variável para dentro do contrato"*; e *"quero também
// ter um campo para capa"* — um arquivo pronto, desenhado fora do Panteon.
//
// ⚠️ O CONTRATO É UMA MONTAGEM, não um documento só: capa + corpo + anexos. Só o corpo se escreve
// no editor. As outras duas peças são arquivos, e cada uma tem um dono diferente:
//
//     CAPA            cadastro da MINUTA        vale para toda venda que usar aquela minuta
//     ANEXO FIXO      categoria (ou empreend.)  convenção, memorial — vale para o recorte inteiro
//     ANEXO DA UNIDADE cadastro da UNIDADE      a planta daquele lote, e só dele
//
// ⚠️ ESTA VARIÁVEL NÃO VIRA TEXTO — ela marca ONDE o arquivo entra. `[anexo_planta]` no meio de uma
// cláusula insere a planta ali; a mesma variável ausente do texto faz o arquivo entrar no fim, na
// ordem dos anexos. É o mesmo comportamento de `[imagem_unidade]`, que já existe e recorta o
// masterplan.
//
// ⚠️ TUDO AQUI ESTÁ PENDENTE: não há tabela de anexo de unidade nem campo de capa na minuta. Os
// nomes ficam no catálogo para a minuta já poder reconhecê-los (e para o editor oferecer), e saem
// vazios até as colunas existirem. Ver `project_contrato_pecas_anexos`.
const ANEXO = (onde: string): FonteDaVariavel => PENDENTE(`anexo ${onde} — tabela a construir`);

const ANEXOS: VariavelDoContrato[] = [
  { exemplo: "(capa do contrato)", fonte: ANEXO("da minuta (capa_path em temis_minutas)"), grupo: "anexo", nome: "capa_contrato", origem: "Capa cadastrada na minuta", rotulo: "Capa do contrato", tipo: "anexo" },
  // O curinga: tudo que estiver marcado como anexo de contrato entra aqui, na ordem do cadastro. É
  // o que evita ter de criar uma variável nova a cada PDF que o jurídico inventar.
  //
  // ⚠️ ELE TRAZ O QUE AINDA NÃO FOI POSICIONADO. Se a minuta já pôs `[anexo_planta]` no meio de uma
  // cláusula, a planta não entra de novo pelo curinga — senão a mesma página sai duas vezes no
  // contrato, e ninguém percebe até o cliente perguntar.
  { exemplo: "(os anexos restantes, na ordem)", fonte: ANEXO("os da unidade e do recorte que não foram posicionados no texto"), grupo: "anexo", nome: "anexos_do_contrato", origem: "Os anexos que o texto não posicionou", rotulo: "Os demais anexos", tipo: "anexo" },
];

// ── OS ANEXOS SÃO POSIÇÕES, NÃO NOMES ────────────────────────────────────────
//
// Duas correções do Lucas, em sequência (07/09/2026). Primeiro, sobre eu ter escrito `anexo_planta`,
// `anexo_convencao`, `anexo_memorial` e `anexo_matricula` no código: *"não queria esses nomes já de
// uma vez, dei somente exemplos"*. Depois, sobre a alternativa de deixar o nome livre: *"mas acho
// que podemos ter já definido os campos anexo, 1,2,3 — se não vamos ter muitas variáveis se for
// buscar pelo nome"*.
//
// Ele está certo nas duas. Uma lista de TIPOS fixos pediria deploy a cada PDF novo que uma
// incorporadora inventasse (ART, laudo ambiental, regulamento interno…). Mas o nome livre criaria um
// catálogo sem fundo: cada empreendimento inventaria as suas chaves, e o painel de variáveis — que
// hoje já tem 280 linhas — viraria uma lista que ninguém percorre.
//
// A POSIÇÃO resolve os dois: `[anexo_1]` num empreendimento é a convenção; em outro, a ART. O que
// cada número É fica no cadastro, e a minuta é do empreendimento — quem escreve sabe o que numerou.
//
// ⚠️ E A QUANTIDADE VEM DO CADASTRO, NÃO DO CÓDIGO. Lucas: *"não precisa deixar 20 campos, à medida
// que eu vou importando os anexos vai fazendo essa conta"*. Não existe lista fixa de posições aqui:
// o painel oferece tantas quantas o empreendimento tiver importado — três anexos, três variáveis.
// Vinte posições vazias no painel seriam vinte linhas que não levam a lugar nenhum, e ainda dariam
// a impressão de que existe um teto.
//
// O LIMITE DE 99 abaixo não é um teto de negócio: é sanidade de formato. Ele existe para que
// `[anexo_0]`, `[anexo_007]` e `[anexo_9999]` — digitação errada, não anexo — caiam no mesmo aviso
// de "variável desconhecida" que pega `[nome_clientes]`, em vez de saírem impressos no contrato.
//
// ⚠️ A POSIÇÃO É ESCOLHIDA NO CADASTRO, não pela ordem em que os arquivos foram enviados. Se fosse
// pela ordem de upload, anexar um arquivo novo empurraria todos os outros e as minutas publicadas
// passariam a imprimir a peça errada — sem erro nenhum, no contrato assinado. Quem cadastra escolhe
// o número, e o número é o contrato entre o cadastro e a minuta.
//
// ⚠️ E OS TRÊS NÍVEIS COMPARTILHAM A NUMERAÇÃO. O anexo 1 pode estar cadastrado na unidade
// (a planta daquele lote), na categoria (a convenção do condomínio) ou no empreendimento; o mais
// específico vence — unidade sobre categoria, categoria sobre empreendimento. É a mesma precedência
// da minuta, e é o que permite "a planta é do lote, a convenção é de todos" sem cadastrar 400 vezes.

/** Prefixo da variável de anexo: `[anexo_1]`, `[anexo_2]`, … */
export const PREFIXO_ANEXO = "anexo_";

/** Prefixo do par que só imprime o trecho quando aquela posição tem arquivo: `[inicio_tem_anexo_1]`. */
export const PREFIXO_BLOCO_DE_ANEXO = "tem_anexo_";

/** Sufixo da variável que traz o NOME do anexo como texto: `[anexo_1_nome]`. */
export const SUFIXO_NOME_DO_ANEXO = "_nome";

/** Sanidade de FORMATO, não teto de negócio — ver a nota acima. */
const MAIOR_POSICAO_ACEITA = 99;

/**
 * A posição que a variável de anexo aponta, ou null.
 *
 * Aceita `anexo_3`, `inicio_tem_anexo_3` e `fim_tem_anexo_3`. Devolve null para o que não é anexo e
 * para o que não é posição plausível (`anexo_0`, `anexo_007`, `anexo_9999`): esses são erro de
 * digitação, e a tela precisa reclamar deles como reclama de `[nome_clientes]`.
 */
export function posicaoDoAnexo(nome: string): null | number {
  const semLado = nome.startsWith("inicio_")
    ? nome.slice("inicio_".length)
    : nome.startsWith("fim_")
      ? nome.slice("fim_".length)
      : nome;
  const cru = semLado.startsWith(PREFIXO_BLOCO_DE_ANEXO)
    ? semLado.slice(PREFIXO_BLOCO_DE_ANEXO.length)
    : semLado.startsWith(PREFIXO_ANEXO)
      ? semLado.slice(PREFIXO_ANEXO.length)
      : null;
  if (cru === null) return null;
  // `anexo_1_nome` é a MESMA posição do `anexo_1`: o rótulo do arquivo, em texto.
  const soONumero = cru.endsWith(SUFIXO_NOME_DO_ANEXO)
    ? cru.slice(0, -SUFIXO_NOME_DO_ANEXO.length)
    : cru;
  if (!/^[1-9][0-9]*$/.test(soONumero)) return null;
  const posicao = Number(soONumero);
  return posicao <= MAIOR_POSICAO_ACEITA ? posicao : null;
}

/**
 * As variáveis dos anexos que aquele empreendimento importou — uma trinca por anexo.
 *
 * Recebe os NOMES na ordem das posições: `["Convenção de condomínio", "Memorial descritivo"]` dá
 * duas posições, e o painel mostra "Anexo 1 — Convenção de condomínio". É o que o Lucas pediu ao
 * fechar o desenho: *"pode trazer o nome do anexo que foi importado na hora de ir para o contrato,
 * ou se tiver algo para nomear os anexos"*.
 *
 * ⚠️ O NOME É VARIÁVEL, e não só rótulo de tela. `[anexo_1_nome]` no texto faz a cláusula se
 * escrever sozinha — "ANEXO I — Convenção de condomínio" sem ninguém digitar o título. Sem ela, o
 * jurídico datilografa o nome na minuta, e no dia em que o arquivo é trocado o contrato passa a
 * anunciar um documento com o nome do anterior.
 *
 * ⚠️ Nada disto vive no catálogo estático — a quantidade vem do cadastro, não do código.
 */
export function variaveisDeAnexo(nomes: readonly string[]): VariavelDoContrato[] {
  const saida: VariavelDoContrato[] = [];
  const lista = nomes.slice(0, MAIOR_POSICAO_ACEITA);
  for (const [indice, cru] of lista.entries()) {
    const posicao = indice + 1;
    const nomeDoAnexo = cru.trim();
    const fonte = ANEXO(`na posição ${posicao} (unidade, categoria ou empreendimento)`);
    const origem = nomeDoAnexo
      ? `"${nomeDoAnexo}", cadastrado na posição ${posicao}`
      : `Arquivo cadastrado na posição ${posicao}`;
    saida.push(
      {
        exemplo: `(o arquivo da posição ${posicao})`,
        fonte,
        grupo: "anexo",
        nome: `${PREFIXO_ANEXO}${posicao}`,
        origem,
        // ⚠️ O RÓTULO CARREGA O NOME REAL. "Anexo 3" numa lista de doze não diz nada a quem escreve
        // a minuta — e escolher o anexo errado é um defeito que só aparece no papel assinado.
        rotulo: nomeDoAnexo ? `Anexo ${posicao} — ${nomeDoAnexo}` : `Anexo ${posicao}`,
        tipo: "anexo",
      },
      {
        exemplo: nomeDoAnexo || `(nome do anexo ${posicao})`,
        fonte,
        grupo: "anexo",
        nome: `${PREFIXO_ANEXO}${posicao}${SUFIXO_NOME_DO_ANEXO}`,
        origem,
        rotulo: nomeDoAnexo ? `Nome do anexo ${posicao} ("${nomeDoAnexo}")` : `Nome do anexo ${posicao}`,
        tipo: "texto",
      },
      // ⚠️ O PAR EXISTE PORQUE A POSIÇÃO PODE ESTAR VAZIA. A cláusula que anuncia "a planta é
      // reproduzida a seguir:" e não traz nada é pior do que não existir — o contrato assinado
      // promete uma peça que não está lá. Com o par, a frase inteira some junto com o arquivo.
      {
        exemplo: "",
        fonte,
        grupo: "bloco",
        nome: `inicio_${PREFIXO_BLOCO_DE_ANEXO}${posicao}`,
        origem: `Sai só quando a posição ${posicao} tem arquivo`,
        rotulo: `Início — só quando o anexo ${posicao} existe`,
        tipo: "bloco_inicio",
      },
      {
        exemplo: "",
        fonte,
        grupo: "bloco",
        nome: `fim_${PREFIXO_BLOCO_DE_ANEXO}${posicao}`,
        origem: `Sai só quando a posição ${posicao} tem arquivo`,
        rotulo: `Fim — só quando o anexo ${posicao} existe`,
        tipo: "bloco_fim",
      },
    );
  }
  return saida;
}

// ── VALORES DA VENDA ─────────────────────────────────────────────────────────
const VALORES: VariavelDoContrato[] = [
  { exemplo: "R$ 185.400,00", fonte: VENDA("valor_negociado"), grupo: "valores", nome: "valor_imovel_venda", origem: "Preço da venda", rotulo: "Valor da unidade", tipo: "dinheiro" },
  { exemplo: "cento e oitenta e cinco mil e quatrocentos reais", extensoDe: "valor_imovel_venda", fonte: EXTENSO_DE("valor_imovel_venda"), grupo: "valores", nome: "valor_imovel_venda_extenso", origem: "Escrito pelo sistema", rotulo: "Valor da unidade por extenso", tipo: "extenso" },
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
  // AS ANUAIS (migration 0138). Lucas, ao ver o cadastro do plano: *"aqui faltou as anuais, pode ter
  // plano que já vem configurado isso"*. ⚠️ NEM TODO PLANO TEM — o par `inicio_tem_anuais`/
  // `fim_tem_anuais` é o que faz o parágrafo sumir quando não há, em vez de imprimir "0 parcelas de".
  // A coluna é CHECK "os dois ou nenhum", então basta uma condição para os dois.
  { exemplo: "10", fonte: PLANO("anuais_quantidade (via hercules_vendas.plano_snapshot)"), grupo: "plano", nome: "plano_anuais_quantidade", origem: "Parcelas anuais do plano", rotulo: "Quantidade de parcelas anuais", tipo: "numero" },
  { exemplo: "R$ 8.000,00", fonte: PLANO("anuais_valor (via hercules_vendas.plano_snapshot)"), grupo: "plano", nome: "plano_anuais_valor", origem: "Parcelas anuais do plano", rotulo: "Valor da parcela anual", tipo: "dinheiro" },
  { exemplo: "oito mil reais", extensoDe: "plano_anuais_valor", fonte: EXTENSO_DE("plano_anuais_valor"), grupo: "plano", nome: "plano_anuais_valor_extenso", origem: "Escrito pelo sistema", rotulo: "Valor da parcela anual por extenso", tipo: "extenso" },
];

/** Blocos que não repetem por comprador: dependem do PLANO, não de quem compra. */
const BLOCOS_DO_PLANO: VariavelDoContrato[] = [
  {
    exemplo: "",
    fonte: PLANO("anuais_quantidade não nulo (via hercules_vendas.plano_snapshot)"),
    grupo: "bloco",
    nome: "inicio_tem_anuais",
    origem: "Sai só quando o plano tem parcelas anuais",
    rotulo: "Início — só quando o plano tem anuais",
    tipo: "bloco_inicio",
  },
  {
    exemplo: "",
    fonte: PLANO("anuais_quantidade não nulo (via hercules_vendas.plano_snapshot)"),
    grupo: "bloco",
    nome: "fim_tem_anuais",
    origem: "Sai só quando o plano tem parcelas anuais",
    rotulo: "Fim — só quando o plano tem anuais",
    tipo: "bloco_fim",
  },
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
  { exemplo: "11.222.333/0001-44", fonte: VINCULADO("document_masked (o documento completo, PF ou PJ)"), grupo: "corretagem", nome: "cpf_cnpj_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "CPF/CNPJ do vinculado", tipo: "texto" },
  { exemplo: "CRECI 12345", fonte: VINCULADO_FICHA("creci"), grupo: "corretagem", nome: "creci_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "CRECI do vinculado", tipo: "texto" },
  { exemplo: "(31) 3333-0000", fonte: VINCULADO_FICHA("telefone (ou apolo_contacts)"), grupo: "corretagem", nome: "telefone_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "Telefone do vinculado", tipo: "texto" },
  { exemplo: "contato@imobiliaria.com.br", fonte: VINCULADO_FICHA("email (ou apolo_contacts)"), grupo: "corretagem", nome: "email_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "E-mail do vinculado", tipo: "texto" },
  { exemplo: "Careli Vendas", fonte: COORDENADORA("nome fantasia"), grupo: "corretagem", nome: "nome_fantasia_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Coordenadora de vendas", tipo: "texto" },
  { exemplo: "11.115.899/0001-04", fonte: COORDENADORA("CNPJ"), grupo: "corretagem", nome: "cnpj_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "CNPJ da coordenadora", tipo: "texto" },
  { exemplo: "Avenida Central", fonte: COORDENADORA("logradouro"), grupo: "corretagem", nome: "rua_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Logradouro da coordenadora", tipo: "texto" },
  { exemplo: "1000", fonte: COORDENADORA("número"), grupo: "corretagem", nome: "numero_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Número da coordenadora", tipo: "texto" },
  { exemplo: "Centro", fonte: COORDENADORA("bairro"), grupo: "corretagem", nome: "bairro_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Bairro da coordenadora", tipo: "texto" },
  { exemplo: "Belo Horizonte/MG", fonte: COORDENADORA("cidade/UF"), grupo: "corretagem", nome: "cidade_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Cidade da coordenadora", tipo: "texto" },
  { exemplo: "30110-000", fonte: COORDENADORA("CEP"), grupo: "corretagem", nome: "cep_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "CEP da coordenadora", tipo: "texto" },
  { exemplo: "(31) 3333-1111", fonte: COORDENADORA("telefone"), grupo: "corretagem", nome: "telefone_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Telefone da coordenadora", tipo: "texto" },
  { exemplo: "vendas@careli.adm.br", fonte: COORDENADORA("e-mail"), grupo: "corretagem", nome: "email_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "E-mail da coordenadora", tipo: "texto" },
  // ⚠️ O CRECI DA COORDENADORA VIRA VARIÁVEL, e não fica digitado na minuta. O contrato de
  // corretagem que o Lucas mandou em 08/09/2026 traz "CRECI: 8.015" escrito TRÊS vezes no mesmo
  // documento. Registro profissional muda (renovação, transferência de jurisdição, troca da pessoa
  // jurídica que coordena) — e uma minuta com o número digitado em três lugares é uma minuta em que
  // a atualização esquece um deles, e ninguém confere um número no meio de vinte cláusulas.
  { exemplo: "8.015", fonte: COORDENADORA("CRECI"), grupo: "corretagem", nome: "creci_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "CRECI da coordenadora", tipo: "texto" },
  // A comissão por empreendimento não tem coluna no Panteon (o legado a tinha por empreendimento:
  // VAL 7,5%, VLO 6%). Pendente até o Hércules cadastrá-la.
  { exemplo: "R$ 11.124,00", fonte: PENDENTE("percentual de comissão do empreendimento × valor_negociado — sem coluna"), grupo: "corretagem", nome: "valor_total_comissao", origem: "Comissão do empreendimento sobre o preço", rotulo: "Comissão total", tipo: "dinheiro" },
  { exemplo: "onze mil cento e vinte e quatro reais", extensoDe: "valor_total_comissao", fonte: EXTENSO_DE("valor_total_comissao"), grupo: "corretagem", nome: "valor_total_comissao_extenso", origem: "Escrito pelo sistema", rotulo: "Comissão total por extenso", tipo: "extenso" },
  { exemplo: "R$ 3.708,00", fonte: PENDENTE("rateio da comissão — sem coluna"), grupo: "corretagem", nome: "valor_pago_coordenadora_vendas", origem: "Rateio da comissão", rotulo: "Parte da coordenadora", tipo: "dinheiro" },
  { exemplo: "três mil setecentos e oito reais", extensoDe: "valor_pago_coordenadora_vendas", fonte: EXTENSO_DE("valor_pago_coordenadora_vendas"), grupo: "corretagem", nome: "valor_pago_coordenadora_vendas_extenso", origem: "Escrito pelo sistema", rotulo: "Parte da coordenadora por extenso", tipo: "extenso" },
  { exemplo: "R$ 7.416,00", fonte: PENDENTE("rateio da comissão — sem coluna"), grupo: "corretagem", nome: "valor_corretagem_menos_coordenadora_vendas", origem: "Rateio da comissão", rotulo: "Corretagem menos a coordenadora", tipo: "dinheiro" },
  { exemplo: "sete mil quatrocentos e dezesseis reais", extensoDe: "valor_corretagem_menos_coordenadora_vendas", fonte: EXTENSO_DE("valor_corretagem_menos_coordenadora_vendas"), grupo: "corretagem", nome: "valor_corretagem_menos_coordenadora_vendas_extenso", origem: "Escrito pelo sistema", rotulo: "Corretagem menos coordenadora por extenso", tipo: "extenso" },
  // ⚠️ O RATEIO É POR PERCENTUAL, E O PERCENTUAL NÃO É CONSTANTE. O contrato de 08/09/2026 escreve
  // 3% para a coordenadora e 4% para o corretor — mas a comissão já é POR EMPREENDIMENTO no legado
  // (VAL 7,5%, VLO 6%: ver `reference_c2x_comissao_por_empreendimento`), e um contrato com o
  // percentual digitado sai errado no empreendimento seguinte sem que nada acuse.
  { exemplo: "3%", fonte: PENDENTE("percentual do rateio da coordenadora — sem coluna"), grupo: "corretagem", nome: "percentual_comissao_coordenadora_vendas", origem: "Rateio da comissão", rotulo: "Percentual da coordenadora", tipo: "texto" },
  { exemplo: "4%", fonte: PENDENTE("percentual do rateio do vinculado — sem coluna"), grupo: "corretagem", nome: "percentual_comissao_vinculado", origem: "Rateio da comissão", rotulo: "Percentual do vinculado", tipo: "texto" },
  // ⚠️ O CUSTO TOTAL NÃO É O PREÇO. Ele é preço do lote MAIS a comissão, e é o número que o
  // contrato de corretagem chama de "custo total da aquisição" (item 4.3). Sem variável própria, a
  // minuta cai em `[preco_venda]` — que é o MESMO campo de `[valor_imovel_venda]` do item 4.1 — e o
  // contrato imprime o custo total igual ao preço do lote, sem a comissão, em cima da frase que diz
  // "corresponde à soma". Nenhum motor acusa isso: os dois números existem e são válidos.
  { exemplo: "R$ 196.524,00", fonte: PENDENTE("valor_negociado + comissão total — soma sem coluna"), grupo: "corretagem", nome: "valor_custo_total_aquisicao", origem: "Preço da unidade mais a comissão", rotulo: "Custo total da aquisição", tipo: "dinheiro" },
  { exemplo: "cento e noventa e seis mil quinhentos e vinte e quatro reais", extensoDe: "valor_custo_total_aquisicao", fonte: EXTENSO_DE("valor_custo_total_aquisicao"), grupo: "corretagem", nome: "valor_custo_total_aquisicao_extenso", origem: "Escrito pelo sistema", rotulo: "Custo total por extenso", tipo: "extenso" },
  // Novos em 02/09/2026: imobiliária e corretor separados, cada um pelo seu vínculo na venda.
  { exemplo: "IMOBILIÁRIA CENTRAL LTDA.", fonte: ENTIDADE("display_name (imobiliaria_entity_id da venda)"), grupo: "corretagem", nome: "imobiliaria_nome", origem: "Imobiliária da venda", rotulo: "Nome da imobiliária", tipo: "texto" },
  { exemplo: "11.222.333/0001-44", fonte: ENTIDADE("document_masked (imobiliaria_entity_id da venda)"), grupo: "corretagem", nome: "imobiliaria_cnpj", origem: "Imobiliária da venda", rotulo: "CNPJ da imobiliária", tipo: "texto" },
  { exemplo: "CRECI J-1234", fonte: FICHA("creci (imobiliaria_entity_id da venda)"), grupo: "corretagem", nome: "imobiliaria_creci", origem: "Imobiliária da venda", rotulo: "CRECI da imobiliária", tipo: "texto" },
  { exemplo: "CARLOS ALBERTO LIMA", fonte: ENTIDADE("display_name (corretor_entity_id da venda)"), grupo: "corretagem", nome: "corretor_nome", origem: "Corretor da venda", rotulo: "Nome do corretor", tipo: "texto" },
  { exemplo: "111.222.333-44", fonte: ENTIDADE("document_masked (corretor_entity_id da venda)"), grupo: "corretagem", nome: "corretor_cpf", origem: "Corretor da venda", rotulo: "CPF do corretor", tipo: "texto" },
  // ⚠️ `corretores` É UM ARRAY NA RAIZ DA FICHA, e ele existe mesmo — não é nível inventado como os
  // que foram corrigidos em 08/09/2026. Mas ele fica na ficha da IMOBILIÁRIA, não na do corretor:
  // quem procurar o CRECI na ficha do próprio corretor não acha nada.
  { exemplo: "CRECI 12345", fonte: FICHA("corretores[].creci — na ficha da IMOBILIÁRIA, casando pelo CPF do corretor"), grupo: "corretagem", nome: "corretor_creci", origem: "Corretor da venda", rotulo: "CRECI do corretor", tipo: "texto" },
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

// ── O LAÇO: ESCREVE UMA VEZ, REPETE POR COMPRADOR ────────────────────────────
//
// Decisão do Lucas em 07/09/2026: *"não vamos rodar contrato mais no c2x, tudo será via panteon"*.
// Sem a obrigação de gerar no legado, a minuta deixa de repetir a qualificação cinco vezes com os
// sufixos `_2`…`_5` — que custavam ~90 marcadores e 15 pares de bloco, e ainda assim paravam
// calados no sexto comprador. O trecho entre `[inicio_cada_comprador]` e `[fim_cada_comprador]` sai
// uma vez por comprador da venda, sem teto, e o cônjuge de cada um nasce do `[inicio_dados_conjuge]`
// de dentro do laço.
//
// ⚠️ OS SUFIXOS CONTINUAM NO CATÁLOGO, e não é indecisão: as 41 minutas do legado ainda vão ser
// importadas, e enquanto não forem convertidas o painel precisa reconhecer o que elas trazem. O que
// se escreve NOVO usa o laço — é o que os blocos prontos (`blocos-prontos.ts`) inserem.
const LACO_COMPRADOR: VariavelDoContrato[] = [
  {
    exemplo: "",
    fonte: SISTEMA("repete o trecho por hercules_vendas.participantes"),
    grupo: "bloco",
    nome: "inicio_cada_comprador",
    origem: "Repete o trecho, um por comprador da venda",
    rotulo: "Início — para cada comprador",
    tipo: "bloco_inicio",
  },
  {
    exemplo: "",
    fonte: SISTEMA("repete o trecho por hercules_vendas.participantes"),
    grupo: "bloco",
    nome: "fim_cada_comprador",
    origem: "Repete o trecho, um por comprador da venda",
    rotulo: "Fim — para cada comprador",
    tipo: "bloco_fim",
  },
];

function expandirBlocos(): VariavelDoContrato[] {
  const saida: VariavelDoContrato[] = [...LACO_COMPRADOR];

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
  ...VENDEDORA_VARS,
  ...ANEXOS,
  ...VALORES,
  ...expandirPlanos(),
  ...PLANO_DA_VENDA,
  ...BLOCOS_DO_PLANO,
  ...CORRETAGEM,
  ...CONTRATO,
  ...GERADOS,
];

const PORNOME = new Map(VARIAVEIS_DO_CONTRATO.map((v) => [v.nome, v]));

/** A variável, se o Temis souber preenchê-la. */
export function acharVariavel(nome: string): undefined | VariavelDoContrato {
  const doCatalogo = PORNOME.get(nome);
  if (doCatalogo) return doCatalogo;
  // ⚠️ OS ANEXOS NÃO ESTÃO NO CATÁLOGO ESTÁTICO — a quantidade vem do cadastro, não do código. Mas
  // quem AUDITA a minuta chama esta função, e sem este caminho um `[anexo_3]` legítimo cairia no
  // mesmo aviso de "variável desconhecida" que existe para pegar `[nome_clientes]` digitado errado.
  // O resultado sai sem o nome do arquivo (quem tem o nome é o cadastro); serve para reconhecer.
  const posicao = posicaoDoAnexo(nome);
  if (posicao === null) return undefined;
  return variaveisDeAnexo(Array.from({ length: posicao }, () => "")).find((v) => v.nome === nome);
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
    if (!v?.extensoDe || presentes.has(v.extensoDe)) continue;
    // ⚠️ DATA POR EXTENSO SOZINHA NÃO É ÓRFÃ — é a norma do fecho de contrato. Todo instrumento
    // termina em "João Monlevade/MG, sete de setembro de dois mil e vinte e seis"; ninguém escreve
    // "07/09/2026 (sete de setembro…)". A regra existe para DINHEIRO, onde o extenso sem o número
    // perde o valor. Sem esta exceção, toda minuta com o fecho normal levaria um aviso falso ao
    // publicar — e aviso que sempre aparece é aviso que ninguém lê.
    if (PORNOME.get(v.extensoDe)?.tipo === "data") continue;
    orfaos.push(nome);
  }
  return orfaos.sort();
}

/** Rótulo do grupo, para o menu do editor. */
export function rotuloDoGrupo(grupo: GrupoDeVariavel): string {
  const mapa: Record<GrupoDeVariavel, string> = {
    anexo: "Anexos e capa",
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
    vendedora: "Vendedora (incorporador/SPE)",
  };
  return mapa[grupo];
}

/** A ordem em que os grupos aparecem no menu: do mais usado ao mais raro. */
export const ORDEM_DOS_GRUPOS: GrupoDeVariavel[] = [
  "vendedora",
  "comprador",
  "conjuge",
  "empresa",
  "unidade",
  "empreendimento",
  "valores",
  "plano",
  "corretagem",
  "contrato",
  "anexo",
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
