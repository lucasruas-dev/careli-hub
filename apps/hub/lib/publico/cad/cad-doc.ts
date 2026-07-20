// Monta a ESTRUTURA da CAD do formulário público.
//
// ⚠️ Roda no SERVIDOR, a partir dos dados já validados, e NUNCA do `cad` que o browser
// mandaria pronto. No wizard interno o `CadDoc` inteiro é montado no browser e a rota apenas
// repassa; num formulário anônimo isso significaria o corretor ditando o que sai impresso na
// própria CAD, inclusive a que imobiliária ela pertence.
import { formatarDocumento } from "@/lib/apolo/documento";
import { formatarTelefoneBR } from "@/lib/format/phone-br";
import type { CadDoc, CadSecao } from "@/modules/apolo/blocks/cadastro/cad-pdf";

export type FichaPublica = {
  endereco: {
    bairro?: string;
    cep?: string;
    cidade?: string;
    complemento?: string;
    logradouro?: string;
    numero?: string;
    uf?: string;
  };
  identidade: {
    cpf?: string;
    dataNascimento?: string;
    nacionalidade?: string;
    naturalidade?: string;
    nome?: string;
    nomeMae?: string;
    nomePai?: string;
    orgaoEmissor?: string;
    rg?: string;
    sexo?: string;
  };
  perfil: { email?: string; estadoCivil?: string; telefone?: string };
};

function t(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export type ContextoCad = {
  corretorNome: string;
  empreendimentoNome: string;
  imobiliariaNome: string;
};

export function montarFichaCad(ficha: FichaPublica, contexto: ContextoCad): Omit<CadDoc, "autenticacao"> {
  const agora = new Date();
  const data = agora.toLocaleDateString("pt-BR");
  const hora = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const nome = t(ficha.identidade.nome) || "Cliente";

  const secoes: CadSecao[] = [
    {
      fields: [
        { label: "Nome completo", value: nome, full: true },
        { label: "CPF", value: formatarDocumento(t(ficha.identidade.cpf)) },
        { label: "Data de nascimento", value: t(ficha.identidade.dataNascimento) },
        { label: "RG", value: t(ficha.identidade.rg) },
        { label: "Orgao emissor", value: t(ficha.identidade.orgaoEmissor) },
        { label: "Sexo", value: t(ficha.identidade.sexo) },
        { label: "Estado civil", value: t(ficha.perfil.estadoCivil) },
        { label: "Nacionalidade", value: t(ficha.identidade.nacionalidade) },
        { label: "Naturalidade", value: t(ficha.identidade.naturalidade) },
        { label: "Nome da mae", value: t(ficha.identidade.nomeMae), full: true },
        { label: "Nome do pai", value: t(ficha.identidade.nomePai), full: true },
      ],
      title: "Identificacao",
    },
    {
      fields: [
        { label: "E-mail", value: t(ficha.perfil.email), full: true },
        { label: "Telefone", value: formatarTelefoneBR(t(ficha.perfil.telefone)) },
      ],
      title: "Contato",
    },
    {
      fields: [
        { label: "CEP", value: t(ficha.endereco.cep) },
        { label: "Logradouro", value: t(ficha.endereco.logradouro), full: true },
        { label: "Numero", value: t(ficha.endereco.numero) },
        { label: "Complemento", value: t(ficha.endereco.complemento) },
        { label: "Bairro", value: t(ficha.endereco.bairro) },
        { label: "Cidade", value: t(ficha.endereco.cidade) },
        { label: "UF", value: t(ficha.endereco.uf) },
      ],
      title: "Endereco",
    },
    {
      fields: [
        { label: "Empreendimento", value: contexto.empreendimentoNome, full: true },
      ],
      title: "Origem do envio",
    },
  ];

  return {
    arquivo: `CAD - ${nome} - ${data} ${hora}`,
    // Imobiliária e corretor vão em campos PRÓPRIOS, não concatenados: foi a concatenação que
    // fez só a imobiliária chegar ao PDF até agora.
    corretor: contexto.corretorNome,
    data,
    hora,
    imobiliaria: contexto.imobiliariaNome,
    nome,
    papel: "Prospect",
    secoes,
    titulo: "Cadastro de CAD",
    vinculo: "",
  };
}
