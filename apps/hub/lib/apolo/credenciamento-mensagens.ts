// AS DUAS MENSAGENS DA HABILITAÇÃO (pedido do Lucas, 15/08/2026).
//
// Saem pelo CELULAR DO RELACIONAMENTO (gateway Evolution, número 31 97250-6566), NÃO pela Meta.
// Por isso **não precisam de template aprovado** e não têm janela de 24h: é o mesmo caminho que
// a coordenadora já usa para falar com corretor e imobiliária.
//
// Regras da casa aplicadas aqui:
//   • negrito do WhatsApp é *um* asterisco, nunca **dois** ([[feedback_whatsapp_negrito]]);
//   • sem travessão em texto que vai para fora ([[feedback_sem_travessao]]);
//   • vocabulário do corretor: "credenciada", "CAD", "empreendimento" são palavras dele
//     ([[feedback_vocabulario_do_corretor]]);
//   • nada de divisão interna na peça externa ([[feedback_corretor_nao_ve_divisao_interna]]).

export type EmpreendimentoHabilitado = { label: string };

function listaDeEmpreendimentos(empreendimentos: EmpreendimentoHabilitado[]): string {
  return empreendimentos.map((e) => `• ${e.label}`).join("\n");
}

// SÓ O PRIMEIRO NOME, e com inicial maiúscula (Lucas, 15/08).
//
// O cadastro guarda o sócio em CAIXA ALTA ("FERNANDO BARBOSA MACHADO"), então usar o valor cru
// mandaria "Olá, FERNANDO!" — parece grito e denuncia texto montado por máquina. Também derruba
// as partículas ("DE", "DOS"), que nunca são o primeiro nome de fato.
function primeiroNome(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  if (!primeiro) {
    return nome.trim();
  }

  return primeiro.charAt(0).toLocaleUpperCase("pt-BR") +
    primeiro.slice(1).toLocaleLowerCase("pt-BR");
}

// 1) PARA O REPRESENTANTE DA IMOBILIÁRIA.
//
// ⚠️ SÃO DOIS AVISOS DIFERENTES, e confundi-los soa mal dos dois lados (Lucas, 15/08):
//
//   • `primeiraVez: true`  -> imobiliária NOVA. Fez o cadastro completo (CNPJ, contrato social,
//     sócios, corretores) e passou a ser credenciada. A mensagem dá as boas-vindas.
//   • `primeiraVez: false` -> imobiliária que JÁ trabalha com a gente e só pediu habilitação
//     num empreendimento novo (rota `/credenciar` do portal). Dizer "seu cadastro foi aprovado"
//     para quem é parceiro há anos soa como se tivéssemos perdido o cadastro dela.
export function mensagemImobiliariaHabilitada(input: {
  empreendimentos: EmpreendimentoHabilitado[];
  imobiliaria: string;
  linkCad?: string | null;
  primeiraVez: boolean;
  representante?: string | null;
}): string {
  const saudacao = input.representante
    ? `Olá, ${primeiroNome(input.representante)}!`
    : "Olá!";
  const um = input.empreendimentos.length === 1;

  const linhas = [saudacao, ""];

  if (input.primeiraVez) {
    linhas.push(
      `O cadastro da *${input.imobiliaria}* foi aprovado e a imobiliária já está *credenciada* com a Careli.`,
      "",
      um ? "Empreendimento liberado:" : "Empreendimentos liberados:",
      listaDeEmpreendimentos(input.empreendimentos),
      "",
      "A partir de agora seus corretores já podem enviar CAD nos empreendimentos acima.",
    );
  } else {
    linhas.push(
      um
        ? `A *${input.imobiliaria}* está habilitada em mais um empreendimento:`
        : `A *${input.imobiliaria}* está habilitada em mais empreendimentos:`,
      "",
      listaDeEmpreendimentos(input.empreendimentos),
      "",
      um
        ? "Seus corretores já podem enviar CAD nele, do mesmo jeito que já fazem nos outros."
        : "Seus corretores já podem enviar CAD neles, do mesmo jeito que já fazem nos outros.",
    );
  }

  if (input.linkCad) {
    linhas.push("", `É por aqui: ${input.linkCad}`);
  }

  linhas.push("", "Qualquer dúvida, é só chamar por aqui mesmo.");

  return linhas.join("\n");
}

// 2) PARA O COORDENADOR DO EMPREENDIMENTO — aviso de que entrou imobiliária nova na praça dele.
//
// É peça INTERNA, então pode falar de operação. Traz o número de corretores porque é o que diz
// o tamanho da novidade para quem coordena a equipe de vendas.
export function mensagemCoordenadorHabilitacao(input: {
  cnpj?: string | null;
  corretores: number;
  empreendimentos: EmpreendimentoHabilitado[];
  imobiliaria: string;
  // Mesma distinção da mensagem da imobiliária: para o coordenador, "chegou parceiro novo" e
  // "uma que já roda com a gente entrou no seu produto" pedem reações diferentes — a primeira
  // costuma render treinamento e apresentação; a segunda, só material do empreendimento.
  primeiraVez: boolean;
  responsavel?: string | null;
}): string {
  const linhas = [
    input.primeiraVez
      ? "*Imobiliária credenciada*"
      : "*Imobiliária habilitada no seu empreendimento*",
    "",
    `*${input.imobiliaria}*`,
  ];

  if (input.cnpj) {
    linhas.push(`CNPJ ${input.cnpj}`);
  }

  linhas.push(
    "",
    input.empreendimentos.length === 1
      ? "Habilitada em:"
      : "Habilitada nos empreendimentos:",
    listaDeEmpreendimentos(input.empreendimentos),
    "",
    input.corretores === 0
      ? "Ainda sem corretor cadastrado."
      : input.corretores === 1
        ? "1 corretor cadastrado."
        : `${input.corretores} corretores cadastrados.`,
  );

  if (!input.primeiraVez) {
    linhas.push("", "Ela já trabalha com a gente em outros empreendimentos.");
  }

  if (input.responsavel) {
    linhas.push("", `Aprovado por ${input.responsavel}.`);
  }

  return linhas.join("\n");
}

// ── INDEFERIMENTO ────────────────────────────────────────────────────────────
// Pedido do Lucas (15/08): recusar também avisa, com o MOTIVO. Recusa silenciosa é pior que
// demora, porque a imobiliária refaz o cadastro achando que se perdeu (foi o que a FN
// Consultoria fez, pedindo duas vezes).

function listaDeMotivos(motivos: string[]): string {
  return motivos
    .map((m) => m.trim())
    .filter(Boolean)
    .map((m) => `• ${m}`)
    .join("\n");
}

// 3) PARA A IMOBILIÁRIA — indeferido, com o motivo e o caminho de volta.
//
// O texto NÃO fecha a porta: quase todo indeferimento é documento ilegível ou faltando, e a
// imobiliária resolve em minutos se souber o que corrigir. Sem o "como voltar", a mensagem só
// gera uma ligação para a central.
export function mensagemImobiliariaIndeferida(input: {
  imobiliaria: string;
  motivos: string[];
  observacao?: string | null;
  representante?: string | null;
}): string {
  const saudacao = input.representante
    ? `Olá, ${primeiroNome(input.representante)}!`
    : "Olá!";

  const linhas = [
    saudacao,
    "",
    `O cadastro da *${input.imobiliaria}* não pôde ser aprovado por enquanto.`,
    "",
    input.motivos.length === 1 ? "Motivo:" : "Motivos:",
    listaDeMotivos(input.motivos),
  ];

  if (input.observacao?.trim()) {
    linhas.push("", input.observacao.trim());
  }

  linhas.push(
    "",
    "Assim que isso for ajustado, é só responder esta mensagem que retomamos o cadastro daqui mesmo, sem precisar preencher tudo de novo.",
  );

  return linhas.join("\n");
}

// 3.5) PARA A IMOBILIÁRIA — PENDÊNCIA A CORRIGIR. Não é recusa.
//
// ⚠️ POR QUE ESTA MENSAGEM EXISTE, separada do indeferimento (regra do Lucas, 17/08): "documento
// errado" não é motivo para recusar, é pedido de ajuste. A Beatriz Teodora foi INDEFERIDA TRÊS
// VEZES por ter enviado o Cartão de CNPJ no lugar do contrato social — um caso de correção, que
// não tinha ação própria. Recusar quem só mandou o arquivo trocado passa a mensagem errada para o
// parceiro e ainda esconde o caso na coluna de recusadas, como se estivesse encerrado.
//
// O tom é o de quem espera resposta: diz o que falta, diz que o cadastro CONTINUA de pé, e não
// pede para começar de novo.
export function mensagemImobiliariaCorrecao(input: {
  imobiliaria: string;
  motivos: string[];
  observacao?: null | string;
  representante?: null | string;
}): string {
  const saudacao = input.representante
    ? `Olá, ${primeiroNome(input.representante)}!`
    : "Olá!";

  const linhas = [
    saudacao,
    "",
    `Estamos finalizando o cadastro da *${input.imobiliaria}* e faltou um ajuste.`,
    "",
    input.motivos.length === 1 ? "O que precisamos:" : "O que precisamos:",
    listaDeMotivos(input.motivos),
  ];

  if (input.observacao?.trim()) {
    linhas.push("", input.observacao.trim());
  }

  linhas.push(
    "",
    "Seu cadastro está guardado, nada se perdeu. É só responder esta mensagem com o que falta que seguimos daqui, e assim que estiver certo liberamos o acesso.",
  );

  return linhas.join("\n");
}

// 4) PARA O COORDENADOR — a recusa também é informação de operação: ele precisa saber que
// aquela imobiliária NÃO vai enviar CAD, para não ficar esperando.
export function mensagemCoordenadorIndeferimento(input: {
  cnpj?: string | null;
  empreendimentos: EmpreendimentoHabilitado[];
  imobiliaria: string;
  motivos: string[];
  responsavel?: string | null;
}): string {
  const linhas = ["*Credenciamento indeferido*", "", `*${input.imobiliaria}*`];

  if (input.cnpj) {
    linhas.push(`CNPJ ${input.cnpj}`);
  }

  if (input.empreendimentos.length > 0) {
    linhas.push(
      "",
      input.empreendimentos.length === 1 ? "Pedia:" : "Pedia os empreendimentos:",
      listaDeEmpreendimentos(input.empreendimentos),
    );
  }

  linhas.push("", input.motivos.length === 1 ? "Motivo:" : "Motivos:", listaDeMotivos(input.motivos));

  if (input.responsavel) {
    linhas.push("", `Indeferido por ${input.responsavel}.`);
  }

  return linhas.join("\n");
}

// ⚠️ A LISTA DE MOTIVOS NÃO MORA AQUI. O Board já tinha `MOTIVOS_CORRECAO` e
// `MOTIVOS_REPROVACAO` como sugestões de um clique no `ModalMotivo`; a de credenciamento entrou
// ao lado delas (`MOTIVOS_RECUSA_IMOBILIARIA`, board-view.tsx), e não num arquivo à parte.
// Duas listas de motivo em lugares diferentes divergem na primeira vez que alguém edita uma.
