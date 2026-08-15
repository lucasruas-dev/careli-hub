// TRAVA: um corretor não trabalha o MESMO empreendimento por DUAS imobiliárias.
//
// Regra do Lucas (15/08/2026): *"temos que ter uma trava para o corretor, o corretor não pode
// trabalhar no mesmo empreendimento duas imobiliárias diferentes"*.
//
// Por que importa: quem define a comissão é o vínculo corretor↔imobiliária no empreendimento.
// O mesmo corretor em duas imobiliárias no mesmo produto torna a CAD ambígua — não dá para
// saber qual imobiliária recebe, e a disputa aparece depois da venda, quando é cara de desfazer.
//
// ⚠️ A TRAVA É POR (CORRETOR, EMPREENDIMENTO), não por corretor. O mesmo corretor PODE
// trabalhar em imobiliárias diferentes desde que em empreendimentos diferentes: é comum, e
// proibir isso quebraria o mercado real.
//
// Medido em 15/08/2026, antes de existir a trava: **zero conflitos** na base. Ela nasce
// preventiva, e não para limpar estrago.

export type VinculoDeCorretor = {
  // CPF só de dígitos quando houver; sem CPF, cai no nome normalizado (é o que o cadastro
  // simples de corretor aceita hoje: nada além de nome+CPF é obrigatório).
  chave: string;
  enterpriseId: string;
  imobiliariaId: string;
  imobiliariaNome: string;
  nome: string;
};

export type ConflitoDeCorretor = {
  corretor: string;
  empreendimento: string;
  enterpriseId: string;
  imobiliariaAtual: string;
};

export function chaveDoCorretor(input: { cpf?: null | string; nome?: null | string }): string {
  const cpf = (input.cpf ?? "").replace(/\D/g, "");
  if (cpf.length === 11) {
    return cpf;
  }

  return (input.nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Quais corretores desta imobiliária JÁ estão em outra imobiliária, nos empreendimentos que ela
// quer trabalhar. `jaVinculados` vem do banco: todos os vínculos corretor↔imobiliária das
// imobiliárias que trabalham esses empreendimentos.
export function conflitosDeCorretor(input: {
  // corretores que ESTA imobiliária declarou
  corretores: { cpf?: null | string; nome: string }[];
  empreendimentos: { enterpriseId: string; label: string }[];
  imobiliariaId: string;
  jaVinculados: VinculoDeCorretor[];
}): ConflitoDeCorretor[] {
  const meus = new Map(
    input.corretores.map((c) => [chaveDoCorretor(c), c.nome] as const),
  );
  const empreendimentos = new Map(
    input.empreendimentos.map((e) => [e.enterpriseId, e.label] as const),
  );
  const conflitos: ConflitoDeCorretor[] = [];
  const vistos = new Set<string>();

  for (const vinculo of input.jaVinculados) {
    // A própria imobiliária não conflita consigo mesma: reenviar o mesmo corretor é normal.
    if (vinculo.imobiliariaId === input.imobiliariaId) {
      continue;
    }
    if (!meus.has(vinculo.chave)) {
      continue;
    }
    if (!empreendimentos.has(vinculo.enterpriseId)) {
      continue;
    }

    // Um corretor em três imobiliárias vira UM conflito por empreendimento, não três linhas
    // dizendo a mesma coisa para o operador.
    const id = `${vinculo.chave}::${vinculo.enterpriseId}`;
    if (vistos.has(id)) {
      continue;
    }
    vistos.add(id);

    conflitos.push({
      corretor: meus.get(vinculo.chave) ?? vinculo.nome,
      empreendimento: empreendimentos.get(vinculo.enterpriseId) ?? "empreendimento",
      enterpriseId: vinculo.enterpriseId,
      imobiliariaAtual: vinculo.imobiliariaNome,
    });
  }

  return conflitos;
}

// Texto para o operador (e para a imobiliária, no portal). Nomeia quem está em conflito e ONDE,
// porque "há um conflito de corretor" não dá para agir.
export function explicarConflitos(conflitos: ConflitoDeCorretor[]): string {
  if (conflitos.length === 0) {
    return "";
  }

  const itens = conflitos
    .map(
      (c) =>
        `${c.corretor} já trabalha ${c.empreendimento} pela ${c.imobiliariaAtual}`,
    )
    .join("; ");

  return conflitos.length === 1
    ? `Este corretor já está em outra imobiliária neste empreendimento: ${itens}.`
    : `Estes corretores já estão em outra imobiliária nestes empreendimentos: ${itens}.`;
}
