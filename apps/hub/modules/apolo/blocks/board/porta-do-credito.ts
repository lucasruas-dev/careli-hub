// A ANÁLISE DE CRÉDITO DO BOARD, POR PORTA: onde a consulta ao Serasa e a aprovação com restrição
// batem, e com que palavras a tela fala do crédito.
//
// Por que existe (16/09/2026): decisão do Lucas, *"A Cecílio, no portal"* faz a análise de crédito e
// o credenciamento dos clientes dela, com a consulta paga na conta da Careli e o registro de quem
// consultou. As rotas do servidor já existem nas duas portas, com o MESMO corpo e a MESMA resposta:
//   • hub: /api/apolo/serasa/{consultar,aprovar-restricao}, com o Bearer do hub;
//   • portal: /api/incorporador/board/<id>/serasa/{consultar,aprovar-restricao}?emp=, com o cookie.
// A tela só troca a base. Esta régua mora fora do board-view.tsx para ter teste: aquele arquivo
// arrasta o Supabase e o Board inteiro.
//
// ⚠️ SEM A PORTA, NADA MUDA: a API do hub devolve exatamente as URLs de antes (a consulta com
// `?entityId=` no GET, a aprovação sem query) e o vocabulário de sempre, com a coordenação.

/** O prefixo das rotas do board no hub. Qualquer outro prefixo é a porta do portal. */
export const BASE_DO_BOARD_NO_HUB = "/api/apolo/board";

/** O pedaço da porta do Board que a análise de crédito usa (o mesmo `BoardApi` do board-view). */
export type ApiDoCredito = {
  base: string;
  /** Query anexada a toda URL do portal (o `emp`). O hub não usa. */
  query?: string;
  /** Sem Bearer do hub: o cookie do portal vai sozinho. */
  semToken: boolean;
};

export const API_DO_CREDITO_NO_HUB: ApiDoCredito = { base: BASE_DO_BOARD_NO_HUB, semToken: false };

/**
 * A porta é a do portal? É a mesma pergunta que o board faz para os documentos: no portal as rotas
 * moram por baixo do `[id]` do board, para passar pelo mesmo escopo, e o que só a Careli tem (a
 * bancada do Serasa, o reenvio do aviso, seguir pelo cônjuge, baixar o comprovante e a CAD) não tem
 * rota nenhuma.
 */
export function ehPortaDoPortal(api: ApiDoCredito): boolean {
  return api.base !== BASE_DO_BOARD_NO_HUB;
}

export type RotasDoCredito = {
  /** POST da aprovação com restrição. */
  aprovarRestricao: (entityId: string) => string;
  /** POST da consulta. */
  consultar: (entityId: string) => string;
  /** GET da situação (ambiente, última consulta, teto do dia). */
  situacao: (entityId: string) => string;
};

export function rotasDoCredito(api: ApiDoCredito): RotasDoCredito {
  if (!ehPortaDoPortal(api)) {
    // Exatamente as URLs que a tela sempre chamou.
    return {
      aprovarRestricao: () => "/api/apolo/serasa/aprovar-restricao",
      consultar: () => "/api/apolo/serasa/consultar",
      situacao: (entityId) => `/api/apolo/serasa/consultar?entityId=${encodeURIComponent(entityId)}`,
    };
  }

  // No portal a ficha vai no ENDEREÇO (é o `[id]` que o servidor confere contra o escopo) e o `emp`
  // em toda chamada. O `entityId` do corpo, que a tela continua mandando, tem que ser o mesmo.
  const comQuery = (url: string) => (api.query ? `${url}?${api.query}` : url);
  const daFicha = (entityId: string, rota: string) =>
    comQuery(`${api.base}/${encodeURIComponent(entityId)}/serasa/${rota}`);
  return {
    aprovarRestricao: (entityId) => daFicha(entityId, "aprovar-restricao"),
    consultar: (entityId) => daFicha(entityId, "consultar"),
    situacao: (entityId) => daFicha(entityId, "consultar"),
  };
}

// ── O VOCABULÁRIO ───────────────────────────────────────────────────────────

/** As palavras com que o Board fala do desfecho do crédito da CAD. */
export type VocabularioDoCredito = {
  /** Selo da ficha em revisão (crédito reprovado esperando quem decide). */
  aguardandoDecisao: string;
  /** Botão da aprovação com restrição. */
  aprovarComRestricao: string;
  /** Frase do modal da aprovação com restrição, depois do nome do cliente. */
  aprovarComRestricaoExplicacao: string;
  /** Linha do histórico local depois da aprovação com restrição. */
  eventoAprovadoComRestricao: string;
  /** Coluna, selo e dica da CAD indeferida. */
  indeferido: string;
  /** Título do modal de indeferir a CAD. */
  indeferirTitulo: string;
  /** Dica da bolinha vermelha do crédito em revisão. */
  reprovadoAguardando: string;
};

// A Careli (hub e comercial): quem decide o crédito reprovado é a COORDENAÇÃO da casa, e o
// indeferimento da CAD é o do crédito. São as palavras que a tela sempre usou.
const VOCABULARIO_DA_CARELI: VocabularioDoCredito = {
  aguardandoDecisao: "Aguardando o coordenador",
  aprovarComRestricao: "Aprovar com restrição (coordenação)",
  aprovarComRestricaoExplicacao:
    "teve o crédito reprovado. A coordenação pode aprovar mesmo assim, anexando a evidência do de-acordo. Fica registrado quem aprovou e quando.",
  eventoAprovadoComRestricao: "Crédito aprovado com restrição pela coordenação",
  indeferido: "Crédito indeferido",
  indeferirTitulo: "Indeferir crédito",
  reprovadoAguardando: "Crédito reprovado: aguardando a coordenação",
};

// O PORTAL QUE OPERA SOZINHO. Não há coordenação da Careli acima do time do cliente: quem decide é
// ele mesmo, e "aguardando a coordenação" mandaria procurar alguém que não existe no fluxo dele. E o
// indeferimento é da CAD, não só do crédito: o próprio time indefere, e entre os motivos estão
// "Documentação inconsistente" e "Não atende aos critérios do empreendimento". "CAD indeferida" é
// também o que as mensagens da esteira dizem a quem é de fora (esteira-mensagens.ts,
// credenciamento-disparos.ts).
const VOCABULARIO_DO_PORTAL_SOZINHO: VocabularioDoCredito = {
  aguardandoDecisao: "Aguardando decisão",
  aprovarComRestricao: "Aprovar com restrição",
  aprovarComRestricaoExplicacao:
    "teve o crédito reprovado. Dá para aprovar mesmo assim, anexando a evidência do de-acordo. Fica registrado quem aprovou e quando.",
  eventoAprovadoComRestricao: "Crédito aprovado com restrição",
  indeferido: "CAD indeferida",
  indeferirTitulo: "Indeferir a CAD",
  reprovadoAguardando: "Crédito reprovado: aguardando decisão",
};

export function vocabularioDoCredito(operaSozinho: boolean): VocabularioDoCredito {
  return operaSozinho ? VOCABULARIO_DO_PORTAL_SOZINHO : VOCABULARIO_DA_CARELI;
}

/**
 * O rótulo de uma coluna do Board nesta porta. Só a coluna `indeferido` da CAD muda de palavra; a da
 * imobiliária ("Recusada") e as demais seguem o rótulo da própria coluna.
 */
export function rotuloDaColuna(
  coluna: { id: string; label: string },
  contexto: { imob: boolean; operaSozinho: boolean },
): string {
  if (contexto.imob || coluna.id !== "indeferido") return coluna.label;
  return vocabularioDoCredito(contexto.operaSozinho).indeferido;
}
