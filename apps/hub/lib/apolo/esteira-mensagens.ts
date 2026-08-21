// AS MENSAGENS DA ESTEIRA DA CAD (correção, indeferimento, credenciamento).
//
// Regra do Lucas (15/08, reafirmada em 21/08/2026): *"todas as comunicações têm que ir para o
// coordenador e corretor via o telefone do relacionamento"*. Até aqui a etapa mudava no Board e
// NINGUÉM era avisado: o motivo da correção morria na tela. Medido em 21/08: a CAD do JOAO
// BATISTA FRAGA foi para correção em 20/08 e não tem uma única linha em `apolo_disparos`.
//
// Saem pelo CELULAR DO RELACIONAMENTO (Evolution, 31 97250-6566), então não têm template nem
// janela de 24h. Mesmas regras de casa das mensagens de credenciamento:
//   • negrito é *um* asterisco ([[feedback_whatsapp_negrito]]);
//   • sem travessão ([[feedback_sem_travessao]]);
//   • vocabulário do corretor: "CAD", "empreendimento", "cliente" ([[feedback_vocabulario_do_corretor]]);
//   • nada de divisão interna na peça externa ([[feedback_corretor_nao_ve_divisao_interna]]).

export type DadosDaCad = {
  cliente: string;
  corretor?: null | string;
  empreendimento?: null | string;
  imobiliaria?: null | string;
  motivo?: null | string;
};

// SÓ O PRIMEIRO NOME, com inicial maiúscula. O cadastro guarda em CAIXA ALTA ("IGOR FERNANDO"),
// e o valor cru mandaria "Olá, IGOR!" — parece grito e denuncia texto de máquina.
export function primeiroNome(nome: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? "";
  if (!primeiro) return nome.trim();

  return (
    primeiro.charAt(0).toLocaleUpperCase("pt-BR") +
    primeiro.slice(1).toLocaleLowerCase("pt-BR")
  );
}

// Nome próprio inteiro em caixa de título: o do CLIENTE aparece no corpo da mensagem e "JOAO
// BATISTA FRAGA" no meio de uma frase tem o mesmo problema do grito.
export function nomeProprio(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .map((parte) =>
      parte.length <= 2
        ? parte.toLocaleLowerCase("pt-BR")
        : parte.charAt(0).toLocaleUpperCase("pt-BR") + parte.slice(1).toLocaleLowerCase("pt-BR"),
    )
    .join(" ");
}

function linhaEmpreendimento(empreendimento?: null | string): string[] {
  return empreendimento ? [`Empreendimento: *${empreendimento}*`] : [];
}

// O MOTIVO É O CONTEÚDO DA MENSAGEM, não um detalhe. O operador escreve "Documento ilegível;
// falta o verso da identidade dos dois compradores" e é exatamente isso que o corretor precisa
// ler. O `;` que o Board usa para separar pendências vira lista, que é como se lê no WhatsApp.
function listaDeMotivos(motivo?: null | string): string[] {
  const texto = (motivo ?? "").trim();
  if (!texto) return [];

  const itens = texto
    .split(";")
    .map((item) => item.trim().replace(/\.$/, ""))
    .filter(Boolean);

  if (itens.length <= 1) return [texto];

  return itens.map((item) => `• ${item}`);
}

// 0a) CAD RECEBIDA (validação) — para o CORRETOR. É o "chegou, está na fila": sem isto ele manda
// a CAD pelo portal e não recebe nada de volta, o que gera a ligação perguntando se chegou.
export function mensagemCorretorRecebida(input: DadosDaCad): string {
  const linhas = [
    input.corretor ? `Olá, ${primeiroNome(input.corretor)}!` : "Olá!",
    "",
    `Recebemos a CAD de *${nomeProprio(input.cliente)}* e ela já está em análise.`,
    ...linhaEmpreendimento(input.empreendimento),
    "",
    "Assim que a análise terminar, aviso por aqui.",
  ];

  return linhas.join("\n");
}

// 0b) CAD RECEBIDA — para o COORDENADOR: entrou CAD nova na praça dele.
export function mensagemCoordenadorRecebida(input: DadosDaCad): string {
  const linhas = [
    input.corretor
      ? `CAD nova: *${nomeProprio(input.cliente)}*, com ${nomeProprio(input.corretor)}.`
      : `CAD nova: *${nomeProprio(input.cliente)}*.`,
    ...linhaEmpreendimento(input.empreendimento),
  ];

  if (input.imobiliaria) linhas.push(`Imobiliária: ${input.imobiliaria}`);
  linhas.push("", "Entrou para análise agora.");

  return linhas.join("\n");
}

// 0c) EM ANÁLISE DE CRÉDITO — para o CORRETOR.
//
// ⚠️ SÓ SAI QUANDO A CAD FICA PARADA AQUI. No caminho normal a consulta ao Serasa é automática e
// a ficha atravessa esta etapa em segundos, indo direto para o destino; avisar no trânsito seria
// duas mensagens no mesmo minuto. Quem cai aqui é a CAD movida à mão no Board, que fica esperando.
export function mensagemCorretorEmCredito(input: DadosDaCad): string {
  const linhas = [
    input.corretor ? `Olá, ${primeiroNome(input.corretor)}!` : "Olá!",
    "",
    `A CAD de *${nomeProprio(input.cliente)}* está na análise de crédito.`,
    ...linhaEmpreendimento(input.empreendimento),
    "",
    "Assim que sair o resultado, aviso por aqui.",
  ];

  return linhas.join("\n");
}

export function mensagemCoordenadorEmCredito(input: DadosDaCad): string {
  const linhas = [
    input.corretor
      ? `CAD em análise de crédito: *${nomeProprio(input.cliente)}*, com ${nomeProprio(input.corretor)}.`
      : `CAD em análise de crédito: *${nomeProprio(input.cliente)}*.`,
    ...linhaEmpreendimento(input.empreendimento),
  ];

  if (input.imobiliaria) linhas.push(`Imobiliária: ${input.imobiliaria}`);

  return linhas.join("\n");
}

// 0d) CRÉDITO REPROVADO (revisão) — para o CORRETOR.
//
// ⚠️ NÃO DIZ O MOTIVO DA RESTRIÇÃO, e isso é de propósito: score, negativação e valor de dívida
// são dados do CLIENTE, e o corretor é terceiro. Ele precisa saber que parou e com quem está a
// decisão, não o extrato financeiro de quem comprou.
export function mensagemCorretorReprovado(input: DadosDaCad): string {
  const linhas = [
    input.corretor ? `Olá, ${primeiroNome(input.corretor)}!` : "Olá!",
    "",
    `A CAD de *${nomeProprio(input.cliente)}* não passou na análise de crédito.`,
    ...linhaEmpreendimento(input.empreendimento),
    "",
    "Ela está com a coordenação para avaliação.",
    "Assim que houver decisão, aviso por aqui.",
  ];

  return linhas.join("\n");
}

// 0e) CRÉDITO REPROVADO — para o COORDENADOR. Aqui o motivo ENTRA: a decisão é dele.
export function mensagemCoordenadorReprovado(input: DadosDaCad): string {
  const linhas = [
    input.corretor
      ? `Crédito reprovado: *${nomeProprio(input.cliente)}*, com ${nomeProprio(input.corretor)}.`
      : `Crédito reprovado: *${nomeProprio(input.cliente)}*.`,
    ...linhaEmpreendimento(input.empreendimento),
  ];

  if (input.imobiliaria) linhas.push(`Imobiliária: ${input.imobiliaria}`);

  const motivos = listaDeMotivos(input.motivo);
  if (motivos.length) {
    linhas.push("", "Motivo:", ...motivos);
  }

  linhas.push("", "A CAD está parada aguardando sua avaliação.");

  return linhas.join("\n");
}

// 0f) PRÉ-VENDA — para o CORRETOR. O cliente recebe a cobrança pelo número de Atendimento; o
// corretor precisa saber que ela foi emitida para poder acompanhar o pagamento.
export function mensagemCorretorPrevenda(input: DadosDaCad): string {
  const linhas = [
    input.corretor ? `Olá, ${primeiroNome(input.corretor)}!` : "Olá!",
    "",
    `A CAD de *${nomeProprio(input.cliente)}* foi aprovada no crédito.`,
    ...linhaEmpreendimento(input.empreendimento),
    "",
    "A cobrança da pré-venda já foi enviada para o cliente.",
    "Assim que o pagamento cair, o credenciamento sai automático.",
  ];

  return linhas.join("\n");
}

export function mensagemCoordenadorPrevenda(input: DadosDaCad): string {
  const linhas = [
    input.corretor
      ? `Crédito aprovado: *${nomeProprio(input.cliente)}*, com ${nomeProprio(input.corretor)}.`
      : `Crédito aprovado: *${nomeProprio(input.cliente)}*.`,
    ...linhaEmpreendimento(input.empreendimento),
  ];

  if (input.imobiliaria) linhas.push(`Imobiliária: ${input.imobiliaria}`);
  linhas.push("", "Cobrança da pré-venda enviada, aguardando pagamento.");

  return linhas.join("\n");
}

// 1) CORREÇÃO — para o CORRETOR que enviou a CAD. É ele quem tem o documento na mão.
export function mensagemCorretorCorrecao(input: DadosDaCad): string {
  const linhas = [
    input.corretor ? `Olá, ${primeiroNome(input.corretor)}!` : "Olá!",
    "",
    `A CAD de *${nomeProprio(input.cliente)}* precisa de ajuste antes de seguir.`,
    ...linhaEmpreendimento(input.empreendimento),
  ];

  const motivos = listaDeMotivos(input.motivo);
  if (motivos.length) {
    linhas.push("", "O que falta:", ...motivos);
  }

  linhas.push(
    "",
    "Assim que enviar o que falta, a análise continua de onde parou.",
    "Qualquer dúvida, é só chamar por aqui mesmo.",
  );

  return linhas.join("\n");
}

// 2) CORREÇÃO — para o COORDENADOR do empreendimento. Ele não precisa da lista de documentos;
// precisa saber que TEM CAD parada na praça dele e com quem ela está.
export function mensagemCoordenadorCorrecao(input: DadosDaCad): string {
  const linhas = [
    input.corretor
      ? `CAD em correção: *${nomeProprio(input.cliente)}*, com ${nomeProprio(input.corretor)}.`
      : `CAD em correção: *${nomeProprio(input.cliente)}*.`,
    ...linhaEmpreendimento(input.empreendimento),
  ];

  if (input.imobiliaria) linhas.push(`Imobiliária: ${input.imobiliaria}`);

  const motivos = listaDeMotivos(input.motivo);
  if (motivos.length) {
    linhas.push("", "Pendência:", ...motivos);
  }

  linhas.push("", "O corretor já foi avisado do que falta.");

  return linhas.join("\n");
}

// 3) INDEFERIDO — para o CORRETOR. Fim de linha para esta CAD, e ele precisa saber por quê para
// não ficar perguntando (e para não reenviar a mesma coisa).
export function mensagemCorretorIndeferido(input: DadosDaCad): string {
  const linhas = [
    input.corretor ? `Olá, ${primeiroNome(input.corretor)}!` : "Olá!",
    "",
    `A CAD de *${nomeProprio(input.cliente)}* não seguiu.`,
    ...linhaEmpreendimento(input.empreendimento),
  ];

  const motivos = listaDeMotivos(input.motivo);
  if (motivos.length) {
    linhas.push("", "Motivo:", ...motivos);
  }

  linhas.push("", "Se aparecer informação nova, é só chamar por aqui que a gente reavalia.");

  return linhas.join("\n");
}

// 4) INDEFERIDO — para o COORDENADOR.
export function mensagemCoordenadorIndeferido(input: DadosDaCad): string {
  const linhas = [
    input.corretor
      ? `CAD indeferida: *${nomeProprio(input.cliente)}*, com ${nomeProprio(input.corretor)}.`
      : `CAD indeferida: *${nomeProprio(input.cliente)}*.`,
    ...linhaEmpreendimento(input.empreendimento),
  ];

  if (input.imobiliaria) linhas.push(`Imobiliária: ${input.imobiliaria}`);

  const motivos = listaDeMotivos(input.motivo);
  if (motivos.length) {
    linhas.push("", "Motivo:", ...motivos);
  }

  linhas.push("", "O corretor já foi avisado.");

  return linhas.join("\n");
}

// 5) CREDENCIADO — para o CORRETOR. A boa notícia do fluxo: a CAD passou.
export function mensagemCorretorCredenciada(input: DadosDaCad): string {
  const linhas = [
    input.corretor ? `Olá, ${primeiroNome(input.corretor)}!` : "Olá!",
    "",
    `A CAD de *${nomeProprio(input.cliente)}* foi aprovada e o cliente já está credenciado.`,
    ...linhaEmpreendimento(input.empreendimento),
    "",
    "Pode seguir com a venda.",
  ];

  return linhas.join("\n");
}

// 6) CREDENCIADO — para o COORDENADOR.
export function mensagemCoordenadorCredenciada(input: DadosDaCad): string {
  const linhas = [
    input.corretor
      ? `CAD aprovada: *${nomeProprio(input.cliente)}*, com ${nomeProprio(input.corretor)}.`
      : `CAD aprovada: *${nomeProprio(input.cliente)}*.`,
    ...linhaEmpreendimento(input.empreendimento),
  ];

  if (input.imobiliaria) linhas.push(`Imobiliária: ${input.imobiliaria}`);

  return linhas.join("\n");
}
