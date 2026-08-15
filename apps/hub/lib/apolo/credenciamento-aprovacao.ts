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
  // vínculos que continuam pendentes (o operador liberou só uma parte)
  seguemPendentes: string[];
};

// O QUE MUDA, decidido sem tocar no banco — é o que dá para testar.
//
// Empreendimento não escolhido **continua `pending`**, não vira recusado: o operador pode
// liberar hoje o Vale do Ouro e o Garden semana que vem, sem a imobiliária pedir de novo.
export function planejarHabilitacao(input: {
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

  return {
    desconhecidos: [...escolhidos].filter((id) => !encontrados.has(id)),
    habilitar,
    jaHabilitados,
    // O papel sobe quando a imobiliária passa a trabalhar com PELO MENOS UM empreendimento.
    // Sem nenhum, ela ficaria "credenciada para nada": o CNPJ passaria a valer no formulário do
    // corretor e nenhum empreendimento apareceria para ele escolher.
    promoverPapel: habilitar.length + jaHabilitados.length > 0,
    seguemPendentes,
  };
}

// Mensagem do resultado, para a tela dizer o que de fato aconteceu em vez de um "ok" genérico.
export function resumoDaHabilitacao(plano: PlanoDeHabilitacao): string {
  const partes: string[] = [];

  if (plano.habilitar.length > 0) {
    partes.push(
      plano.habilitar.length === 1
        ? "1 empreendimento habilitado"
        : `${plano.habilitar.length} empreendimentos habilitados`,
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
