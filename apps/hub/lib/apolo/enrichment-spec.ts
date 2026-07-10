// Spec do laboratorio de enriquecimento (/apolo/enriquecimento).
//
// Descreve COMO o dado do MOST vira campo do Apolo: em que aba mora, de qual
// dataset sai, como se le no payload e qual a politica sugerida:
//   auto     = enriquece sozinho no momento do cadastro (custa no CAD)
//   operador = so consulta quando o operador pedir (custa sob demanda)
//   fora     = nao usamos
//
// A conta: o MOST cobra POR CONSULTA, EM REAIS (ver most-precos.ts). Uma query
// nomeada (CARELI_PF_01 etc) dispara varios datasets, entao o custo de um
// cadastro e a soma dos precos dos datasets distintos marcados como "auto".
// O plano contratado muda o preco unitario e impoe um faturamento minimo.

import {
  type PlanoId,
  PLANO_ATUAL,
  custoOcrImagem,
  precoDataset,
} from "@/lib/apolo/most-precos";

export type Politica = "auto" | "fora" | "operador";

export type Origem = "bestinfo" | "cad" | "enriquecimento";

export type Render = "bool" | "data" | "dinheiro" | "itens" | "lista" | "objeto" | "texto";

export type AbaId =
  | "contato"
  | "digital"
  | "endereco"
  | "financeiro"
  | "identificacao"
  | "profissional"
  | "rede"
  | "risco";

export type Persona = "pf" | "pj";

export type CampoSpec = {
  aba: AbaId;
  dataset: string;
  id: string;
  keys: string[];
  label: string;
  // Traducao de codigos crus do MOST (ex.: sexo "M" -> "Masculino").
  mapa?: Record<string, string>;
  nota?: string;
  novo?: boolean;
  origem: Origem;
  persona: Persona;
  politica: Politica;
  query: string;
  render: Render;
  sub?: string[];
};

export const ABAS: Array<{ id: AbaId; label: string }> = [
  { id: "identificacao", label: "Identificação" },
  { id: "contato", label: "Contato" },
  { id: "endereco", label: "Endereço" },
  { id: "profissional", label: "Profissional" },
  { id: "financeiro", label: "Financeiro" },
  { id: "risco", label: "Risco" },
  { id: "rede", label: "Rede" },
  { id: "digital", label: "Digital" },
];

export type QuerySpec = {
  descricao: string;
  label: string;
  persona: Persona;
  proposta?: boolean;
  query: string;
};

export const QUERIES: QuerySpec[] = [
  {
    descricao: "Cadastro, contato, trabalho e renda. É a que o cadastro usa hoje.",
    label: "Cadastro",
    persona: "pf",
    query: "CARELI_PF_01",
  },
  {
    descricao: "Certidões emitidas na hora, com PDF. Demora mais.",
    label: "Certidões",
    persona: "pf",
    query: "CARELI_PF_02",
  },
  {
    descricao:
      "Um único dataset (pf_gold) com score, melhor contato, negativações, consultas e protestos. É a consulta mais cara da tabela.",
    label: "GOLD",
    persona: "pf",
    query: "CARELI_PF_03",
  },
  {
    descricao:
      "Criada pela MOST em 10/jul: escolaridade, CRECI, validação de contato, KYC, rede, benefícios e comportamento. Nove datasets.",
    label: "Perfil ampliado",
    persona: "pf",
    query: "CARELI_PF_04",
  },
  {
    descricao: "Cadastro da empresa, sócios, KYC, processos e contato.",
    label: "Cadastro",
    persona: "pj",
    query: "CARELI_PJ_01",
  },
  {
    descricao: "Certidões da empresa e quadro societário na Receita.",
    label: "Certidões",
    persona: "pj",
    query: "CARELI_PJ_02",
  },
  {
    descricao: "Score e negativações da empresa.",
    label: "GOLD",
    persona: "pj",
    query: "CARELI_PJ_03",
  },
];

// RG (frente+verso) + comprovante de endereco = 3 imagens no iOCR.
export const IMAGENS_POR_CADASTRO_PADRAO = 3;

export const CAMPOS: CampoSpec[] = [
  // ---------------- PF · Identificação ----------------
  { aba: "identificacao", dataset: "basic_data", id: "nome", keys: ["name"], label: "Nome completo", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "texto" },
  { aba: "identificacao", dataset: "basic_data", id: "nascimento", keys: ["birthDate"], label: "Data de nascimento", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "data" },
  { aba: "identificacao", dataset: "basic_data", id: "idade", keys: ["age"], label: "Idade", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "texto" },
  { aba: "identificacao", dataset: "basic_data", id: "sexo", keys: ["gender"], label: "Sexo", mapa: { F: "Feminino", M: "Masculino" }, origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "texto" },
  { aba: "identificacao", dataset: "basic_data", id: "nomeMae", keys: ["motherName"], label: "Nome da mãe", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "texto" },
  { aba: "identificacao", dataset: "basic_data", id: "nomePai", keys: ["fatherName"], label: "Nome do pai", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "texto" },
  { aba: "identificacao", dataset: "basic_data", id: "estadoCivil", keys: ["maritalStatus"], label: "Estado civil", nota: "Dispara a etapa de cônjuge e certidão no cadastro.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "texto" },
  { aba: "identificacao", dataset: "basic_data", id: "situacaoCpf", keys: ["taxIdStatus"], label: "Situação do CPF", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "texto" },
  { aba: "identificacao", dataset: "basic_data", id: "obito", keys: ["hasObitIndication"], label: "Indicação de óbito", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "bool" },
  { aba: "identificacao", dataset: "basic_data", id: "documentos", keys: ["alternativeIdNumbers"], label: "Outros documentos", nota: "RG, CNH, título de eleitor e PIS.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "objeto" },
  { aba: "identificacao", dataset: "demographic_data", id: "escolaridade", keys: ["estimatedInstructionLevel"], label: "Escolaridade estimada", nota: "Hoje o corretor digita na mão.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_04", render: "texto" },
  { aba: "identificacao", dataset: "demographic_data", id: "classeSocial", keys: ["socialClass"], label: "Classe social", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_04", render: "texto" },
  { aba: "identificacao", dataset: "demographic_data", id: "rendaDemografica", keys: ["estimatedIncomeRange"], label: "Renda demográfica", nota: "Redundante com a renda do financial_data.", origem: "enriquecimento", persona: "pf", politica: "fora", query: "CARELI_PF_04", render: "texto" },
  { aba: "identificacao", dataset: "class_organization", id: "conselho", keys: ["memberships"], label: "Conselho de classe (CRECI)", nota: "Valida o corretor sem pedir carteirinha.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_04", render: "itens", sub: ["entity", "registrationNumber", "status"] },

  // ---------------- PF · Contato ----------------
  { aba: "contato", dataset: "pf_gold", id: "telefoneSugerido", keys: ["BestInfo.Phone"], label: "Telefone sugerido", nota: "O melhor telefone já consolidado. O GOLD BEST INFO sozinho é bem mais barato, mas não traz o score.", origem: "bestinfo", persona: "pf", politica: "auto", query: "CARELI_PF_03", render: "texto" },
  { aba: "contato", dataset: "pf_gold", id: "emailSugerido", keys: ["BestInfo.Email"], label: "E-mail sugerido", nota: "Sugestão para o operador confirmar com o cliente.", origem: "bestinfo", persona: "pf", politica: "auto", query: "CARELI_PF_03", render: "texto" },
  { aba: "contato", dataset: "auth_score_gold", id: "telefoneConfirmado", keys: ["IsConfirmedPhone"], label: "Telefone confere?", nota: "AUTHSCORE GOLD saiu da CARELI_PF_04: precisa do telefone, CEP, endereço e e-mail declarados como entrada. Roda como validação no fim do cadastro, não na consulta por CPF.", novo: true, origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_04", render: "bool" },
  { aba: "contato", dataset: "auth_score_gold", id: "emailConfirmado", keys: ["IsConfirmedEmail"], label: "E-mail confere?", nota: "AUTHSCORE GOLD saiu da CARELI_PF_04: precisa do telefone, CEP, endereço e e-mail declarados como entrada. Roda como validação no fim do cadastro, não na consulta por CPF.", novo: true, origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_04", render: "bool" },
  { aba: "contato", dataset: "phones_extended", id: "telefones", keys: ["phones"], label: "Todos os telefones", nota: "Passagens altas e zero suspeitas = telefone bom.", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_01", render: "itens", sub: ["areaCode", "number", "type", "phoneEntityTotalPassages"] },
  { aba: "contato", dataset: "emails_extended", id: "emails", keys: ["emails"], label: "Todos os e-mails", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_01", render: "itens", sub: ["emailAddress", "type"] },
  { aba: "contato", dataset: "related_people_phones", id: "telefonesParentes", keys: ["relatedPeoplePhones"], label: "Telefones de parentes", nota: "Munição de localização pra cobrança.", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_04", render: "itens", sub: ["relatedEntityName", "areaCode", "number"] },

  // ---------------- PF · Endereço ----------------
  { aba: "endereco", dataset: "addresses_extended", id: "enderecos", keys: ["addresses"], label: "Endereços na base", nota: "Comparamos com o comprovante. Se divergir, vale o comprovante.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "itens", sub: ["addressMain", "number", "neighborhood", "city", "state", "zipCode"] },
  { aba: "endereco", dataset: "auth_score_gold", id: "enderecoConfirmado", keys: ["AddressConfirmationStatus"], label: "Endereço confere?", nota: "AUTHSCORE GOLD saiu da CARELI_PF_04: precisa do telefone, CEP, endereço e e-mail declarados como entrada. Roda como validação no fim do cadastro, não na consulta por CPF.", novo: true, origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_04", render: "texto" },
  { aba: "endereco", dataset: "pf_gold", id: "enderecoBest", keys: ["BestInfo.Address"], label: "Endereço sugerido", origem: "bestinfo", persona: "pf", politica: "operador", query: "CARELI_PF_03", render: "texto" },

  // ---------------- PF · Profissional ----------------
  { aba: "profissional", dataset: "occupation_data", id: "empregado", keys: ["isEmployed"], label: "Está empregado?", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "bool" },
  { aba: "profissional", dataset: "occupation_data", id: "vinculos", keys: ["professions"], label: "Vínculos de trabalho", nota: "Empresa, CNPJ, cargo, renda do vínculo, admissão.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "itens", sub: ["companyName", "level", "status", "income"] },
  { aba: "profissional", dataset: "occupation_data", id: "rendaTrabalho", keys: ["totalIncome"], label: "Renda do trabalho", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "dinheiro" },
  { aba: "profissional", dataset: "occupation_data", id: "totalVinculos", keys: ["totalProfessions"], label: "Total de vínculos", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_01", render: "texto" },
  { aba: "profissional", dataset: "professional_turnover", id: "empreendedor", keys: ["isEntrepeneur"], label: "É empreendedor?", nota: "Não entrou na CARELI_PF_04. A MOST confirmou por e-mail que existe, a R$ 0,18. Pedir se decidirmos usar.", novo: true, origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_04", render: "bool" },
  { aba: "profissional", dataset: "professional_turnover", id: "rotatividade", keys: ["avgYearsBetweenProfessionalTurnover"], label: "Rotatividade média (anos)", nota: "Não entrou na CARELI_PF_04. A MOST confirmou por e-mail que existe, a R$ 0,18. Pedir se decidirmos usar.", novo: true, origem: "enriquecimento", persona: "pf", politica: "fora", query: "CARELI_PF_04", render: "texto" },
  { aba: "profissional", dataset: "professional_turnover", id: "primeiroEmprego", keys: ["ageOfFirstJob"], label: "Idade no 1º emprego", nota: "Não entrou na CARELI_PF_04. A MOST confirmou por e-mail que existe, a R$ 0,18. Pedir se decidirmos usar.", novo: true, origem: "enriquecimento", persona: "pf", politica: "fora", query: "CARELI_PF_04", render: "texto" },

  // ---------------- PF · Financeiro ----------------
  { aba: "financeiro", dataset: "financial_data", id: "faixaRenda", keys: ["bigdatA_V2", "bigdata"], label: "Faixa de renda estimada", nota: "Pré-preenche o seletor de renda do C2X.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "texto" },
  { aba: "financeiro", dataset: "financial_data", id: "patrimonio", keys: ["totalAssets"], label: "Patrimônio estimado", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_01", render: "texto" },
  { aba: "financeiro", dataset: "financial_data", id: "restituicao", keys: ["taxReturns"], label: "Restituição do IR", nota: "Ano, status e banco. Sinal de renda declarada.", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_01", render: "itens", sub: ["year", "status", "bank"] },
  { aba: "financeiro", dataset: "pf_gold", id: "scoreCredito", keys: ["Score.Score"], label: "Score de crédito", nota: "Você pediu no CAD. Vem dentro do GOLD completo, que é o item mais caro do cadastro.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_03", render: "texto" },
  { aba: "financeiro", dataset: "pf_gold", id: "scoreCompromisso", keys: ["Score.PaymentCommitmentScore"], label: "Score de compromisso de pagamento", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_03", render: "texto" },
  { aba: "financeiro", dataset: "pf_gold", id: "scoreCapacidade", keys: ["Score.ProfileScore"], label: "Score de capacidade de pagamento", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_03", render: "texto" },
  { aba: "financeiro", dataset: "pf_gold", id: "temNegativacao", keys: ["HasNegativeData"], label: "Tem negativação?", nota: "O GOLD completo já traz isto. Comprar o indicador e o score separados custa mais caro que o pacote.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_03", render: "bool" },
  { aba: "financeiro", dataset: "pf_gold", id: "temConsultas", keys: ["HasInquiryData"], label: "Consultado por terceiros?", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_03", render: "bool" },
  { aba: "financeiro", dataset: "pf_gold", id: "valorNegativado", keys: ["PendenciesControlCred"], label: "Valor total negativado", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_03", render: "dinheiro" },
  { aba: "financeiro", dataset: "pf_gold", id: "negativacoes", keys: ["Apontamentos"], label: "Negativações", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_03", render: "itens", sub: ["CompanyName", "Nature", "Amount", "DateOccurred"] },
  { aba: "financeiro", dataset: "pf_gold", id: "cheques", keys: ["CcfApontamentos"], label: "Cheques sem fundo (CCF)", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_03", render: "itens", sub: ["ReportingCodeBank", "ReasonBounce", "CountBounce"] },
  { aba: "financeiro", dataset: "pf_gold", id: "protestos", keys: ["TotalProtests"], label: "Protestos", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_03", render: "texto" },
  { aba: "financeiro", dataset: "social_assistance", id: "beneficio", keys: ["isReceivingAssistance"], label: "Recebe benefício social?", nota: "Sinal forte de renda real.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_04", render: "bool" },

  // ---------------- PF · Risco ----------------
  { aba: "risco", dataset: "auth_score_gold", id: "falecido", keys: ["IsDeceased"], label: "Falecido?", nota: "AUTHSCORE GOLD saiu da CARELI_PF_04: precisa do telefone, CEP, endereço e e-mail declarados como entrada. Roda como validação no fim do cadastro, não na consulta por CPF.", novo: true, origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_04", render: "bool" },
  { aba: "risco", dataset: "kyc", id: "pep", keys: ["isCurrentlyPep"], label: "É PEP hoje?", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_04", render: "bool" },
  { aba: "risco", dataset: "kyc", id: "sancionado", keys: ["isCurrentlySanctioned"], label: "Está sancionado?", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_04", render: "bool" },
  { aba: "risco", dataset: "kyc", id: "sancoes365", keys: ["last365DaysSanctions"], label: "Sanções nos últimos 365 dias", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_04", render: "texto" },
  { aba: "risco", dataset: "ondemand_rf_status", id: "rfStatus", keys: ["baseStatus"], label: "CPF na Receita Federal (certidão)", nota: "Redundante no cadastro: o basic_data já traz a situação do CPF em 2s. Esta é a certidão lenta (a PF_02 inteira leva ~188s).", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_02", render: "texto" },
  { aba: "risco", dataset: "ondemand_pf_antecedente", id: "antecedentesPf", keys: ["baseStatus"], label: "Antecedentes (Polícia Federal)", nota: "Certidão com PDF, emitida na hora.", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_02", render: "texto" },
  { aba: "risco", dataset: "ondemand_cert_labor_debt_absence", id: "cndt", keys: ["baseStatus"], label: "CND Trabalhista", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_02", render: "texto" },
  { aba: "risco", dataset: "ondemand_nada_consta", id: "nadaConsta", keys: ["baseStatus"], label: "Nada consta (Justiça Federal)", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_02", render: "texto" },
  { aba: "risco", dataset: "ondemand_administrative_sanctions", id: "sancoesBacen", keys: ["baseStatus"], label: "Sanções do Banco Central", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_02", render: "texto" },

  // ---------------- PF · Rede ----------------
  { aba: "rede", dataset: "related_people", id: "parentes", keys: ["personalRelationships"], label: "Pessoas relacionadas", nota: "Cônjuge, parentes, vizinhos. Vira aresta no grafo do Apolo.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_04", render: "itens", sub: ["relatedEntityName", "relationshipType"] },
  { aba: "rede", dataset: "related_people", id: "totalParentes", keys: ["totalRelatives"], label: "Total de parentes", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_04", render: "texto" },
  { aba: "rede", dataset: "business_relationships", id: "empresas", keys: ["businessRelationships"], label: "Empresas e vínculos econômicos", nota: "Liga a pessoa física à jurídica.", origem: "enriquecimento", persona: "pf", politica: "auto", query: "CARELI_PF_04", render: "itens", sub: ["relatedEntityName", "relatedEntityTaxIdNumber", "relationshipType"] },
  { aba: "rede", dataset: "business_relationships", id: "totalEmpresas", keys: ["totalOwnerships"], label: "Empresas que possui", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_04", render: "texto" },

  // ---------------- PF · Digital ----------------
  { aba: "digital", dataset: "interests_and_behaviors", id: "cartao", keys: ["creditCardScore"], label: "Uso de cartão de crédito", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_04", render: "texto" },
  { aba: "digital", dataset: "interests_and_behaviors", id: "investidor", keys: ["onlineInvestor"], label: "Investe online?", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_04", render: "bool" },
  { aba: "digital", dataset: "interests_and_behaviors", id: "interesses", keys: ["categoriesOfInterest"], label: "Categorias de interesse", origem: "enriquecimento", persona: "pf", politica: "operador", query: "CARELI_PF_04", render: "lista" },
  { aba: "digital", dataset: "interests_and_behaviors", id: "milhas", keys: ["milesProgram"], label: "Programa de milhas", origem: "enriquecimento", persona: "pf", politica: "fora", query: "CARELI_PF_04", render: "bool" },
  { aba: "digital", dataset: "interests_and_behaviors", id: "revendedor", keys: ["productReseller"], label: "Revendedor porta a porta", origem: "enriquecimento", persona: "pf", politica: "fora", query: "CARELI_PF_04", render: "bool" },
  { aba: "digital", dataset: "online_presence", id: "eShopper", keys: ["eShopper_v3"], label: "Comprador online (A a H)", origem: "enriquecimento", persona: "pf", politica: "fora", query: "CARELI_PF_04", render: "texto" },
  { aba: "digital", dataset: "online_presence", id: "eSeller", keys: ["eSeller_v3"], label: "Vendedor online (A a H)", origem: "enriquecimento", persona: "pf", politica: "fora", query: "CARELI_PF_04", render: "texto" },
  { aba: "digital", dataset: "online_presence", id: "usoInternet", keys: ["internetUsageLevel_v3"], label: "Uso de internet (A a H)", origem: "enriquecimento", persona: "pf", politica: "fora", query: "CARELI_PF_04", render: "texto" },

  // ---------------- PJ · Identificação ----------------
  { aba: "identificacao", dataset: "basic_data", id: "pjRazao", keys: ["officialName"], label: "Razão social", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "texto" },
  { aba: "identificacao", dataset: "basic_data", id: "pjFantasia", keys: ["tradeName"], label: "Nome fantasia", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "texto" },
  { aba: "identificacao", dataset: "basic_data", id: "pjFundacao", keys: ["foundedDate"], label: "Fundação", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "data" },
  { aba: "identificacao", dataset: "basic_data", id: "pjIdade", keys: ["age"], label: "Idade da empresa (anos)", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "texto" },
  { aba: "identificacao", dataset: "basic_data", id: "pjSituacao", keys: ["taxIdStatus"], label: "Situação do CNPJ", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "texto" },
  { aba: "identificacao", dataset: "ondemand_rf_status", id: "pjRf", keys: ["baseStatus"], label: "CNPJ na Receita Federal", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_02", render: "texto" },
  { aba: "identificacao", dataset: "activity_indicators", id: "pjAtividade", keys: ["hasActivity"], label: "Tem atividade real?", novo: true, origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "bool" },
  { aba: "identificacao", dataset: "activity_indicators", id: "pjFuncionarios", keys: ["employeesRange"], label: "Faixa de funcionários", novo: true, origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "texto" },
  { aba: "identificacao", dataset: "activity_indicators", id: "pjFaturamento", keys: ["incomeRange"], label: "Faixa de faturamento", novo: true, origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "texto" },
  { aba: "identificacao", dataset: "activity_indicators", id: "pjFiliais", keys: ["numberOfBranches"], label: "Filiais", novo: true, origem: "enriquecimento", persona: "pj", politica: "operador", query: "CARELI_PJ_01", render: "texto" },

  // ---------------- PJ · Contato ----------------
  { aba: "contato", dataset: "phones_extended", id: "pjTelefones", keys: ["phones"], label: "Telefones", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "itens", sub: ["areaCode", "number", "type"] },
  { aba: "contato", dataset: "emails_extended", id: "pjEmails", keys: ["emails"], label: "E-mails", novo: true, origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "itens", sub: ["emailAddress", "type"] },

  // ---------------- PJ · Endereço ----------------
  { aba: "endereco", dataset: "addresses_extended", id: "pjEnderecos", keys: ["addresses"], label: "Endereços", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "itens", sub: ["addressMain", "number", "neighborhood", "city", "state", "zipCode"] },

  // ---------------- PJ · Rede ----------------
  { aba: "rede", dataset: "relationships", id: "pjSocios", keys: ["relationships"], label: "Sócios e relacionados", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "itens", sub: ["relatedEntityName", "relatedEntityTaxIdNumber", "relationshipType"] },
  { aba: "rede", dataset: "ondemand_rf_qsa", id: "pjQsa", keys: ["qsa"], label: "Quadro societário na Receita", nota: "Quem assina pela empresa.", novo: true, origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_02", render: "itens", sub: ["name", "qualification"] },
  { aba: "rede", dataset: "ondemand_legal_representative", id: "pjRepresentante", keys: ["legalRepresentative"], label: "Representante legal", nota: "Vai direto pro contrato.", novo: true, origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_02", render: "objeto" },

  // ---------------- PJ · Risco ----------------
  { aba: "risco", dataset: "kyc", id: "pjSancionada", keys: ["isCurrentlySanctioned"], label: "Empresa sancionada?", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "bool" },
  { aba: "risco", dataset: "owners_kyc", id: "pjSociosPep", keys: ["totalPepOwners"], label: "Sócios PEP", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "texto" },
  { aba: "risco", dataset: "owners_lawsuits", id: "pjSociosProcessos", keys: ["totalLawsuits"], label: "Processos dos sócios", origem: "enriquecimento", persona: "pj", politica: "operador", query: "CARELI_PJ_01", render: "texto" },
  { aba: "risco", dataset: "processes", id: "pjProcessos", keys: ["totalLawsuits"], label: "Processos da empresa", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_01", render: "texto" },
  { aba: "risco", dataset: "ondemand_pgfn", id: "pjPgfn", keys: ["baseStatus"], label: "Certidão PGFN", origem: "enriquecimento", persona: "pj", politica: "operador", query: "CARELI_PJ_02", render: "texto" },
  { aba: "risco", dataset: "ondemand_fgts", id: "pjFgts", keys: ["baseStatus"], label: "Regularidade do FGTS", origem: "enriquecimento", persona: "pj", politica: "operador", query: "CARELI_PJ_02", render: "texto" },
  { aba: "risco", dataset: "ondemand_cert_labor_debt_absence", id: "pjCndt", keys: ["baseStatus"], label: "CND Trabalhista", origem: "enriquecimento", persona: "pj", politica: "operador", query: "CARELI_PJ_02", render: "texto" },

  // ---------------- PJ · Financeiro ----------------
  { aba: "financeiro", dataset: "pj_gold_score", id: "pjScore", keys: ["Score.Score"], label: "Score de crédito", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_03", render: "texto" },
  { aba: "financeiro", dataset: "pj_gold_negative_flag", id: "pjTemNegativacao", keys: ["HasNegativeData"], label: "Tem negativação?", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_03", render: "bool" },
  { aba: "financeiro", dataset: "pj_gold_negative_info", id: "pjValorNegativado", keys: ["PendenciesControlCred"], label: "Valor total negativado", origem: "enriquecimento", persona: "pj", politica: "auto", query: "CARELI_PJ_03", render: "dinheiro" },
];

// ---------- leitura tolerante do payload ----------
//
// Cada dataset embrulha o conteudo num objeto proprio (basicData, extendedPhones,
// finantialData...). Em vez de fixar o caminho de cada um, procuramos a chave
// pelo nome, sem diferenciar maiuscula. Aceita caminho pontuado ("Score.Score").

function deepFind(node: unknown, key: string, seen: Set<unknown>): unknown {
  if (!node || typeof node !== "object" || seen.has(node)) return undefined;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = deepFind(item, key, seen);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  const record = node as Record<string, unknown>;
  for (const [name, value] of Object.entries(record)) {
    if (name.toLowerCase() === key) return value;
  }
  for (const value of Object.values(record)) {
    const hit = deepFind(value, key, seen);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function propriedade(node: unknown, key: string): unknown {
  if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
  const record = node as Record<string, unknown>;
  for (const [name, value] of Object.entries(record)) {
    if (name.toLowerCase() === key) return value;
  }
  return undefined;
}

export function pickValue(data: unknown, keys: string[]): unknown {
  for (const key of keys) {
    const partes = key.toLowerCase().split(".");
    let atual = deepFind(data, partes[0] ?? "", new Set());
    for (const parte of partes.slice(1)) {
      atual = propriedade(atual, parte);
    }
    if (atual !== undefined && atual !== null && atual !== "") return atual;
  }
  return undefined;
}

export function temValor(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function textoDe(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : String(value);
}

function dataBr(value: unknown): string {
  const bruto = textoDe(value);
  const match = bruto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : bruto;
}

function dinheiroBr(value: unknown): string {
  const numero = typeof value === "number" ? value : Number(textoDe(value).replace(",", "."));
  if (!Number.isFinite(numero)) return textoDe(value);
  return numero.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

// Monta uma linha legivel de um item de lista a partir das subchaves da spec.
function linhaDoItem(item: unknown, sub: string[]): string {
  if (!item || typeof item !== "object") return textoDe(item);
  const partes = sub
    .map((key) => propriedade(item, key.toLowerCase()))
    .filter((value) => temValor(value))
    .map((value) => (typeof value === "number" ? String(value) : textoDe(value)));
  return partes.length ? partes.join(" · ") : JSON.stringify(item).slice(0, 120);
}

// Devolve as linhas a exibir para um campo (uma linha para valor simples,
// varias para listas), ja formatadas.
export function formatarCampo(campo: CampoSpec, value: unknown): string[] {
  if (!temValor(value)) return [];

  switch (campo.render) {
    case "bool":
      return [value === true ? "Sim" : "Não"];
    case "data":
      return [dataBr(value)];
    case "dinheiro":
      return [dinheiroBr(value)];
    case "itens": {
      const lista = Array.isArray(value) ? value : [value];
      return lista.slice(0, 6).map((item) => linhaDoItem(item, campo.sub ?? []));
    }
    case "lista": {
      const lista = Array.isArray(value) ? value : [value];
      return [lista.map(textoDe).join(", ")];
    }
    case "objeto": {
      if (!value || typeof value !== "object") return [textoDe(value)];
      return Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => temValor(item))
        .slice(0, 8)
        .map(([name, item]) => `${name}: ${textoDe(item)}`);
    }
    default: {
      const texto = textoDe(value);
      return [campo.mapa?.[texto] ?? texto];
    }
  }
}

// ---------- custo (em reais, conforme a proposta da MOST) ----------

export type LinhaCusto = {
  codigo: string;
  dataset: string;
  preco: number;
};

export type Custo = {
  // R$ que todo cadastro paga, sempre.
  custoAuto: number;
  // R$ se o operador acionar TODOS os datasets sob demanda de um cadastro.
  custoOperador: number;
  custoOcr: number;
  datasetsAuto: LinhaCusto[];
  datasetsOperador: LinhaCusto[];
  novosPendentes: string[];
  // Datasets marcados que a proposta nao precifica: nao dizemos que sao gratis.
  semPreco: string[];
};

export function calcularCusto(
  campos: CampoSpec[],
  politicas: Record<string, Politica>,
  persona: Persona,
  imagensPorCadastro: number,
  plano: PlanoId = PLANO_ATUAL,
): Custo {
  const auto = new Set<string>();
  const operador = new Set<string>();
  const novos = new Set<string>();

  for (const campo of campos) {
    const politica = politicas[campo.id] ?? campo.politica;
    if (politica === "auto") {
      auto.add(campo.dataset);
      if (campo.novo) novos.add(campo.dataset);
    } else if (politica === "operador") {
      operador.add(campo.dataset);
      if (campo.novo) novos.add(campo.dataset);
    }
  }

  // Um dataset ja consultado no cadastro nao volta a custar sob demanda.
  for (const dataset of auto) operador.delete(dataset);

  const semPreco: string[] = [];
  const linhas = (nomes: Set<string>): LinhaCusto[] =>
    [...nomes]
      .map((dataset) => {
        const preco = precoDataset(persona, dataset, plano);
        if (!preco) {
          semPreco.push(dataset);
          return null;
        }
        return { codigo: preco.codigo, dataset, preco: preco.preco };
      })
      .filter((linha): linha is LinhaCusto => linha !== null)
      .sort((a, b) => b.preco - a.preco);

  const datasetsAuto = linhas(auto);
  const datasetsOperador = linhas(operador);
  const somar = (lista: LinhaCusto[]) =>
    lista.reduce((total, linha) => total + linha.preco, 0);

  return {
    custoAuto: somar(datasetsAuto),
    custoOcr: Math.max(0, imagensPorCadastro) * custoOcrImagem(plano),
    custoOperador: somar(datasetsOperador),
    datasetsAuto,
    datasetsOperador,
    novosPendentes: [...novos].sort(),
    semPreco: [...new Set(semPreco)].sort(),
  };
}
