// Tipos de cadastro do Apolo (CAD) e o FORMATO que cada um abre no wizard.
//
// ⚠️ O CORRETOR AUTÔNOMO É UM TIPO PRÓPRIO, E NUNCA UMA IMOBILIÁRIA. Decisão do Lucas (27/09/2026):
// *"Preciso cadastrar corretor autonomo, tipo, ele nao sera vinculado a uma imobiliaria, ele sera uma
// entidade. Quem fara esse cadastro e time nosso interno"*, e sobre o rótulo: *"NAO QUERO TER A
// INFORMACAO QUE PODE TER PESSOA FISICA COMO IMOBILIARIA, isso sera bem restrito"*. Por isso ele não
// entra como persona PJ nem pede imobiliária: é PF com papel próprio.
//
// ⚠️ ATÉ 27/09/2026 A PORTA NÃO EXISTIA, E ABRIA A ERRADA EM SILÊNCIO. `CADASTRO_TIPOS` não tinha
// corretor e `findCadastroTipo` devolve PROSPECT para slug desconhecido: `/apolo/cadastro?tipo=corretor`
// abria o cadastro de CLIENTE sem avisar nada. O fallback continua (é ele que protege link velho e
// digitação errada); o que mudou é o corretor existir na lista.
//
// ⚠️ O FORMATO MORA AQUI, E NÃO EM BOOLEANOS NA TELA. O wizard tinha dois formatos escritos como
// `isImobiliaria ? ... : ...` espalhados em 5.500 linhas; um terceiro formato nesse molde é a próxima
// regra que discorda de si mesma. Quem decide persona, Vínculo e esteira é este módulo, e a tela lê.
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
  // ⚠️ "Autônomo, sem vínculo" é o que o time interno lê na hora de escolher. Não diz "imobiliária"
  // de propósito: é o mesmo motivo por que ele tem tipo próprio.
  { descricao: "Autônomo, sem vínculo", disponivel: true, label: "Corretor", slug: "corretor" },
  { descricao: "Equipe interna", disponivel: false, label: "Colaborador", slug: "colaborador" },
  { descricao: "Prestador ou fornecedor", disponivel: false, label: "Fornecedor", slug: "fornecedor" },
  { descricao: "Parceiro de negócio", disponivel: false, label: "Parceiro", slug: "parceiro" },
];

export function findCadastroTipo(slug: string | null | undefined): CadastroTipo {
  return CADASTRO_TIPOS.find((t) => t.slug === slug) ?? CADASTRO_PROSPECT;
}

/**
 * Quem decide se o cadastro é de pessoa física ou jurídica.
 *
 *   • `documento` → o documento lido decide (o prospect pode ser PF ou PJ);
 *   • `pf`        → travado em pessoa física (o corretor autônomo É uma pessoa);
 *   • `pj`        → travado em empresa (a imobiliária).
 */
export type PersonaDoCadastro = "documento" | "pf" | "pj";

export type FormatoDoCadastro = {
  /**
   * A CAD entra na fila de validação do Board.
   *
   * ⚠️ O CORRETOR FICA FORA, E ISSO ESTÁ CERTO (regra do Lucas, 05/08/2026): a esteira existe para
   * VALIDAR DOCUMENTO DE COMPRADOR. O corretor não compra nada, então não há o que validar.
   */
  entraNaEsteira: boolean;
  /** A tela pede o bloco Vínculo (imobiliária -> empreendimento -> corretor). */
  exigeVinculo: boolean;
  /** Papel de nascimento gravado na entidade (`apolo_entity_profiles.profile`). */
  papel: "corretor" | "imobiliaria" | "prospect";
  /** Como a ficha chama o papel na tela e no PDF. */
  papelLabel: string;
  persona: PersonaDoCadastro;
  /** Prefixo do arquivo que vai para o drive ("CAD - Maria", "Corretor - João"). */
  rotuloDoDocumento: string;
  slug: string;
  /** Título da tela do wizard. */
  titulo: string;
};

const FORMATO_PROSPECT: FormatoDoCadastro = {
  entraNaEsteira: true,
  exigeVinculo: true,
  papel: "prospect",
  papelLabel: "Prospect",
  persona: "documento",
  rotuloDoDocumento: "CAD",
  slug: "prospect",
  titulo: "Cadastro de CAD",
};

const FORMATOS: Record<string, FormatoDoCadastro> = {
  // ⚠️ A IMOBILIÁRIA TEM DOCUMENTO PARA VALIDAR (contrato social, ficha dos sócios): ela continua
  // entrando na esteira, como sempre entrou.
  imobiliaria: {
    entraNaEsteira: true,
    exigeVinculo: false,
    papel: "imobiliaria",
    papelLabel: "Imobiliária",
    persona: "pj",
    rotuloDoDocumento: "Imobiliaria",
    slug: "imobiliaria",
    titulo: "Cadastro de Imobiliária",
  },
  corretor: {
    entraNaEsteira: false,
    exigeVinculo: false,
    papel: "corretor",
    papelLabel: "Corretor autônomo",
    persona: "pf",
    rotuloDoDocumento: "Corretor",
    slug: "corretor",
    titulo: "Cadastro de Corretor Autônomo",
  },
  prospect: FORMATO_PROSPECT,
};

/** O formato do wizard para um slug. Slug sem formato cai no do prospect, como `findCadastroTipo`. */
export function formatoDoCadastro(slug: string | null | undefined): FormatoDoCadastro {
  return FORMATOS[String(slug ?? "")] ?? FORMATO_PROSPECT;
}

/**
 * O documento de identificação que a etapa 1 aceita, e a frase que ela pede na tela.
 *
 * ⚠️ UMA LISTA SÓ PARA OS DOIS. O aviso da tela e a conferência do que a MOST leu discordarem é o
 * jeito de pedir uma coisa e aceitar outra. E o corretor autônomo aceita SÓ identificação: aceitar
 * cartão CNPJ ali é exatamente a "pessoa física como imobiliária" que o Lucas não quer.
 */
export function documentoDaIdentificacao(formato: FormatoDoCadastro): {
  aceitos: Array<"cnpj" | "identidade">;
  frase: string;
} {
  if (formato.persona === "pj") {
    return { aceitos: ["cnpj"], frase: "o cartão CNPJ da imobiliária" };
  }
  if (formato.persona === "pf") {
    return {
      aceitos: ["identidade"],
      frase: "o documento de identificação (RG, CNH ou passaporte)",
    };
  }
  return {
    aceitos: ["identidade", "cnpj"],
    frase: "o documento de identificação (RG, CNH ou passaporte) ou o cartão CNPJ",
  };
}

/**
 * O que falta no bloco Vínculo para a etapa 1 avançar.
 *
 * ⚠️ A MESMA LISTA HABILITA O BOTÃO E MONTA O AVISO (pedido do Lucas, 05/08/2026). Duas listas um dia
 * discordam, e a tela diz "está tudo certo" com o botão travado.
 *
 * ⚠️ O QUE NÃO PEDE VÍNCULO NÃO PEDE IMOBILIÁRIA. É o caso do corretor autônomo: ele não é vinculado
 * a nenhuma. No público o vínculo vem do token e o browser não o preenche, como sempre.
 *
 * ⚠️ A CAD DO CLIENTE PODE TER IMOBILIÁRIA **OU** CORRETOR AUTÔNOMO (fatia 2, 28/09/2026). Lucas
 * (27/09/2026): *"Sim, empreendimento a empreendimento"*, sobre habilitar o autônomo produto por
 * produto. Com o autônomo escolhido, o corretor NÃO é uma pendência à parte: ele É o corretor da
 * venda. Por isso a segunda pendência muda de texto, em vez de existir uma segunda lista.
 */
export function faltaNoVinculo(params: {
  /** (fatia 2) A entidade do corretor autônomo escolhido como vínculo, quando for o caso. */
  autonomoId?: string;
  formato: FormatoDoCadastro;
  imobiliariaId: string;
  modoPublico: boolean;
  vinculoOk: boolean;
}): string[] {
  if (!params.formato.exigeVinculo || params.modoPublico) return [];
  const autonomo = (params.autonomoId ?? "").trim();
  return [
    autonomo || params.imobiliariaId.trim() ? null : "imobiliária ou corretor autônomo",
    params.vinculoOk ? null : autonomo ? "empreendimento" : "empreendimento e corretor",
  ].filter((item): item is string => item !== null);
}
