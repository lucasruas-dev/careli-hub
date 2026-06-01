import type { QueueClient } from "@/modules/guardian/attendance/types";

const EMPTY_FIELD = "-";

export type ClientProfileItem = {
  label: string;
  value: string;
};

export type ClientProfileSummary = {
  expandedItems: ClientProfileItem[];
  primaryItems: ClientProfileItem[];
  spouseItems: ClientProfileItem[];
  spouseName: string;
};

export function buildClientProfileSummary(
  client: QueueClient,
): ClientProfileSummary {
  const spouse = client.dados360.conjugeDados;
  const spouseItems =
    isKnownProfileValue(client.dados360.conjuge) && spouse
      ? buildSpouseProfileItems(spouse)
      : [];

  return {
    primaryItems: [
      { label: "Nome", value: client.nome },
      { label: "CPF/CNPJ", value: client.cpf },
      {
        label: "Razão social",
        value: client.dados360.razaoSocial ?? EMPTY_FIELD,
      },
      {
        label: "Nome fantasia",
        value: client.dados360.nomeFantasia ?? EMPTY_FIELD,
      },
      { label: "Telefone", value: client.dados360.telefone },
      { label: "E-mail", value: client.dados360.email },
      {
        label: "Endereço",
        value: client.dados360.endereco ?? EMPTY_FIELD,
      },
    ],
    expandedItems: [
      { label: "Tipo pessoa", value: client.dados360.tipoPessoa },
      { label: "RG", value: client.dados360.rg ?? EMPTY_FIELD },
      {
        label: "Documento",
        value: client.dados360.documentoIdentidade ?? EMPTY_FIELD,
      },
      { label: "Nascimento", value: client.dados360.nascimento },
      { label: "Idade", value: client.dados360.idade },
      { label: "Sexo", value: client.dados360.sexo },
      { label: "Estado civil", value: client.dados360.estadoCivil },
      {
        label: "Regime de bens",
        value: client.dados360.regimeBens ?? EMPTY_FIELD,
      },
      { label: "Profissão", value: client.dados360.profissao },
      { label: "Renda", value: client.dados360.faixaSalarial },
      { label: "Escolaridade", value: client.dados360.escolaridade },
      { label: "Cidade", value: client.dados360.cidade },
      { label: "CEP", value: client.dados360.cep ?? EMPTY_FIELD },
      { label: "Bairro", value: client.dados360.bairro ?? EMPTY_FIELD },
      {
        label: "Número",
        value: client.dados360.numeroEndereco ?? EMPTY_FIELD,
      },
      {
        label: "Complemento",
        value: client.dados360.complementoEndereco ?? EMPTY_FIELD,
      },
      { label: "Naturalidade", value: client.dados360.naturalidade },
      { label: "Nacionalidade", value: client.dados360.nacionalidade },
      {
        label: "Nome da mãe",
        value: client.dados360.nomeMae ?? EMPTY_FIELD,
      },
      { label: "Relacionamento", value: client.dados360.relacionamento },
    ],
    spouseItems,
    spouseName: client.dados360.conjuge,
  };
}

export function isKnownProfileValue(value?: string | null) {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR");

  return Boolean(
    normalized &&
      ![
        "-",
        "nao informado",
        "não informado",
        "sem telefone",
        "sem e-mail",
        "sem email",
      ].includes(normalized),
  );
}

function buildSpouseProfileItems(
  spouse: NonNullable<QueueClient["dados360"]["conjugeDados"]>,
): ClientProfileItem[] {
  return [
    { label: "Cônjuge CPF", value: spouse.cpf },
    { label: "Cônjuge telefone", value: spouse.telefone },
    { label: "Cônjuge e-mail", value: spouse.email },
    { label: "Cônjuge nascimento", value: spouse.nascimento },
    { label: "Cônjuge idade", value: spouse.idade },
    { label: "Cônjuge sexo", value: spouse.sexo },
    { label: "Cônjuge profissão", value: spouse.profissao },
    { label: "Cônjuge documento", value: spouse.documentoIdentidade },
    { label: "Cônjuge nacionalidade", value: spouse.nacionalidade },
    {
      label: "Cônjuge naturalidade",
      value: spouse.naturalidade ?? EMPTY_FIELD,
    },
    { label: "Cônjuge endereço", value: spouse.endereco },
  ];
}
