// Tipos de cadastro do Apolo (CAD). Por enquanto só Prospect está construído;
// os demais entram no mesmo fluxo conforme forem liberados.
export type CadastroTipo = {
  descricao: string;
  disponivel: boolean;
  label: string;
  slug: string;
};

const CADASTRO_PROSPECT: CadastroTipo = {
  descricao: "Cliente em prospecção",
  disponivel: true,
  label: "Prospect",
  slug: "prospect",
};

export const CADASTRO_TIPOS: CadastroTipo[] = [
  CADASTRO_PROSPECT,
  { descricao: "Parceiro imobiliário", disponivel: true, label: "Imobiliária", slug: "imobiliaria" },
  { descricao: "Equipe interna", disponivel: false, label: "Colaborador", slug: "colaborador" },
  { descricao: "Prestador ou fornecedor", disponivel: false, label: "Fornecedor", slug: "fornecedor" },
  { descricao: "Parceiro de negócio", disponivel: false, label: "Parceiro", slug: "parceiro" },
];

export function findCadastroTipo(slug: string | null | undefined): CadastroTipo {
  return CADASTRO_TIPOS.find((t) => t.slug === slug) ?? CADASTRO_PROSPECT;
}
