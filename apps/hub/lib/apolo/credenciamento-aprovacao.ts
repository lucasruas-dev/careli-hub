// HABILITAÇÃO DA IMOBILIÁRIA — a "virada de chave" que o portal público sempre prometeu.
//
// `/api/publico/imobiliaria/cadastro` e `/credenciar` gravam o PEDIDO rebaixado de propósito:
// papel em `review`, empreendimentos e corretores em `pending`. O comentário de lá diz "só
// quando alguém nosso vira a chave para 'active'/'verified'". **Essa chave nunca existiu**:
// medido em 15/08/2026, 16 imobiliárias reais estavam paradas desde 11/08, uma delas tendo
// pedido duas vezes por não receber resposta.
//
// ⚠️ A IMOBILIÁRIA NÃO PASSA PELA ESTEIRA, e isso é decisão, não omissão. `apolo_esteira` tem
// PRIMARY KEY `(entity_id, enterprise_id)` — não aceita nulo — porque cada linha é uma CAD de
// uma pessoa NUM empreendimento. Credenciamento de imobiliária é outra coisa: uma empresa, N
// empreendimentos, uma validação só. Por isso o Board a lista pela perna que lê entidades em
// `review` direto, e a habilitação mexe em papel + vínculos, nunca em etapa de esteira.

export type EmpreendimentoPedido = {
  // id da linha em apolo_relationships
  id: string;
  // id do empreendimento no C2X (metadata.enterpriseId)
  enterpriseId: string;
  label: string;
  status: string;
};

export type PlanoDeHabilitacao = {
  // vínculos que passam para 'verified' agora
  habilitar: string[];
  // escolhidos que já estavam habilitados: não são erro, só não têm o que fazer
  jaHabilitados: string[];
  // o papel sobe para 'active'?
  promoverPapel: boolean;
  // enterpriseIds que o operador mandou e não estão entre os pedidos desta imobiliária
  desconhecidos: string[];
  // enterpriseIds legítimos que ainda NÃO têm vínculo e precisam ser CRIADOS já habilitados.
  // Só é preenchido quando quem chama informa a lista de empreendimentos abertos (`ativos`).
  novos: string[];
  // vínculos que continuam pendentes (o operador liberou só uma parte)
  seguemPendentes: string[];
};

// O QUE MUDA, decidido sem tocar no banco — é o que dá para testar.
//
// Empreendimento não escolhido **continua `pending`**, não vira recusado: o operador pode
// liberar hoje o Vale do Ouro e o Garden semana que vem, sem a imobiliária pedir de novo.
//
// `ativos` é OPCIONAL e muda o tratamento do que não tem vínculo. Sem ele (fluxo do Board), o
// escolhido sem pedido é `desconhecido` e vira 400 — o operador não deve habilitar às escondidas
// um empreendimento que a imobiliária não pediu. Com ele (habilitação de quem JÁ é credenciada,
// que pela regra do Lucas não passa pela fila), o escolhido que consta na lista de
// empreendimentos abertos entra em `novos` e o vínculo nasce já habilitado. O que não estiver
// nem nos pedidos nem nos ativos continua sendo `desconhecido` nos dois casos.
export function planejarHabilitacao(input: {
  ativos?: string[];
  escolhidos: string[];
  pedidos: EmpreendimentoPedido[];
}): PlanoDeHabilitacao {
  const escolhidos = new Set(input.escolhidos.map((id) => id.trim()).filter(Boolean));
  const habilitar: string[] = [];
  const jaHabilitados: string[] = [];
  const seguemPendentes: string[] = [];
  const encontrados = new Set<string>();

  for (const pedido of input.pedidos) {
    const jaEstava = pedido.status === "verified";

    if (!escolhidos.has(pedido.enterpriseId)) {
      // ⚠️ O QUE JÁ ESTAVA HABILITADO NÃO VOLTA A SER PENDENTE por não ter sido remarcado.
      // O operador reabre o card para liberar UM empreendimento novo; se os antigos caíssem
      // aqui, a tela diria "seguem aguardando" para quem já trabalha, e um descredenciamento
      // acidental seria só uma linha de código de distância. Desabilitar é ação própria.
      if (jaEstava) {
        jaHabilitados.push(pedido.id);
      } else {
        seguemPendentes.push(pedido.id);
      }
      continue;
    }

    encontrados.add(pedido.enterpriseId);

    if (jaEstava) {
      jaHabilitados.push(pedido.id);
    } else {
      habilitar.push(pedido.id);
    }
  }

  const semVinculo = [...escolhidos].filter((id) => !encontrados.has(id));
  const ativos = input.ativos ? new Set(input.ativos.map((id) => id.trim()).filter(Boolean)) : null;
  const novos = ativos ? semVinculo.filter((id) => ativos.has(id)) : [];
  const desconhecidos = ativos ? semVinculo.filter((id) => !ativos.has(id)) : semVinculo;

  return {
    desconhecidos,
    habilitar,
    jaHabilitados,
    novos,
    // O papel sobe quando a imobiliária passa a trabalhar com PELO MENOS UM empreendimento.
    // Sem nenhum, ela ficaria "credenciada para nada": o CNPJ passaria a valer no formulário do
    // corretor e nenhum empreendimento apareceria para ele escolher.
    promoverPapel: habilitar.length + jaHabilitados.length + novos.length > 0,
    seguemPendentes,
  };
}

// Mensagem do resultado, para a tela dizer o que de fato aconteceu em vez de um "ok" genérico.
export function resumoDaHabilitacao(plano: PlanoDeHabilitacao): string {
  const partes: string[] = [];

  // Conta os CRIADOS junto com os promovidos: para quem pede resultado, "habilitado" é
  // habilitado — a resposta dizia "nenhum empreendimento habilitado" logo depois de criar dois.
  const habilitadosAgora = plano.habilitar.length + plano.novos.length;
  if (habilitadosAgora > 0) {
    partes.push(
      habilitadosAgora === 1
        ? "1 empreendimento habilitado"
        : `${habilitadosAgora} empreendimentos habilitados`,
    );
  }

  if (plano.jaHabilitados.length > 0) {
    partes.push(`${plano.jaHabilitados.length} já estava habilitado`);
  }

  if (plano.seguemPendentes.length > 0) {
    partes.push(
      plano.seguemPendentes.length === 1
        ? "1 segue aguardando"
        : `${plano.seguemPendentes.length} seguem aguardando`,
    );
  }

  return partes.length > 0 ? partes.join(", ") : "Nada a habilitar";
}
