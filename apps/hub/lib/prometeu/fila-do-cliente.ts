// O QUE O CLIENTE VE NO CELULAR DELE: a regra que reduz o estado inteiro do evento a UMA frase
// sobre UMA pessoa.
//
// ESTE TIPO E' A BARREIRA DE PRIVACIDADE da pagina publica — nao o CSS da tela. O que nao esta
// em `AcompanhamentoDaFila` nao chega ao browser do cliente: nada de CPF, telefone, PIX, PA,
// imobiliaria, corretor, nem o nome de nenhuma outra pessoa da fila. Quem for mexer aqui, mexe
// no que vaza.
//
// Arquivo PURO de proposito (so' importa ./types): assim a regra e' testavel sem banco e o tipo
// pode ser importado pelo componente de cliente sem arrastar service role para o bundle.
import {
  PROMETEU_ZONAS,
  type PrometeuCredenciado,
  type PrometeuMesa,
  type PrometeuZona,
} from "./types";

export type EstadoDoCliente =
  // Fez a pre-venda mas ainda nao foi credenciado na entrada (sem check-in).
  | "aguardando_entrada"
  // Esperando a vez numa fila, com posicao.
  | "na_fila"
  // Foi chamado e ainda nao apareceu: e' o estado que a tela grita.
  | "chamado"
  // Sentado com o corretor (salao) ou na mesa (secretaria), ou tocando reserva/proposta/pagamento.
  | "em_atendimento"
  // Foi chamado, nao apareceu e o posto marcou. Nao e' desistencia: chamar de novo o traz de volta.
  | "nao_localizado"
  | "concluido"
  // Saiu da operacao do dia (cancelou ou foi arquivado no fim do dia).
  | "encerrado";

export type AcompanhamentoDaFila = {
  // Hora do SERVIDOR em que este retrato foi tirado. A tela mostra "atualizado as HH:MM" para o
  // cliente saber que a pagina esta viva — o relogio do celular dele nao serve para isso.
  atualizadoEm: string;
  // Numero da mesa quando a chamada e' para uma mesa (secretaria). Nulo na chamada para o salao.
  destinoMesa: string | null;
  // Para onde ele foi chamado / onde ele esta sendo atendido.
  destinoZona: PrometeuZona | null;
  // PERSPECTIVA de atendimento, em MINUTOS, como FAIXA ("20 a 35 min"). Faixa, nao numero unico:
  // cravar um minuto exato vira reclamacao quando erra (decisao do Lucas 30/jul). Nulo quando nao
  // da' pra estimar (sem posicao, ele e' o proximo, ou sem base de tempo do evento).
  etaMinutos: { ate: number; de: number } | null;
  estado: EstadoDoCliente;
  // Em qual fila ele espera. Nulo quando ele nao esta esperando em fila nenhuma.
  filaZona: PrometeuZona | null;
  lancamento: string;
  nome: string;
  // Derivado de `posicao`. Vem separado para a tela nao ter que saber que "na frente" e' -1.
  pessoasNaFrente: number | null;
  posicao: number | null;
};

function zonaConhecida(zona: string | null | undefined): PrometeuZona | null {
  return PROMETEU_ZONAS.find((z) => z.id === zona)?.id ?? null;
}

// A ORDEM DOS TESTES E' A REGRA. Do mais urgente para o mais calmo, porque um mesmo credenciado
// satisfaz varias condicoes ao mesmo tempo (quem foi chamado para a mesa continua com
// `etapa = "secretaria"`, e quem esta em no-show continua com a etapa em que parou). Trocar a
// ordem troca o que o cliente le na tela.
export function derivarAcompanhamento(input: {
  agora?: string;
  credenciado: PrometeuCredenciado;
  emTransito: { credenciadoId: string }[];
  filaRecepcao: PrometeuCredenciado[];
  filaSecretaria: PrometeuCredenciado[];
  lancamento: string;
  mesas: PrometeuMesa[];
  // Minutos estimados que cada pessoa na frente adiciona a espera (tempo por atendimento dividido
  // pela capacidade de atendimento em paralelo). Vem do servidor; sem ele, a tela nao mostra ETA.
  ritmoPorPessoaMin?: number;
}): AcompanhamentoDaFila {
  const c = input.credenciado;
  const base = {
    atualizadoEm: input.agora ?? new Date().toISOString(),
    destinoMesa: null,
    destinoZona: null,
    etaMinutos: null,
    filaZona: null,
    lancamento: input.lancamento,
    nome: c.nome,
    pessoasNaFrente: null,
    posicao: null,
  } satisfies Omit<AcompanhamentoDaFila, "estado">;

  // A mesa que estiver apontando para ele diz onde ele senta — vale tanto para a chamada
  // ("Mesa 03, pode vir") quanto para o atendimento em curso.
  const mesa = input.mesas.find((m) => m.credenciadoId === c.id) ?? null;
  const naMesa = mesa
    ? { destinoMesa: mesa.numero, destinoZona: zonaConhecida(mesa.zona) }
    : { destinoMesa: null, destinoZona: null };

  // 1. Desfechos: acabou, acabou. Nem chamada aberta nem mesa presa mudam isso.
  if (c.etapa === "concluido") return { ...base, estado: "concluido" };
  if (c.etapa === "cancelado") return { ...base, estado: "encerrado" };

  // 2. Ja' sentou: a mesa so' vai para "atendimento" quando o atendente confirma que ele chegou.
  if (mesa && mesa.estado === "atendimento") {
    return { ...base, ...naMesa, estado: "em_atendimento" };
  }

  // 3. CHAMADO. Chamada em aberto (sem `atendido_em`) e' o que segura a pessoa "a caminho" nos
  // paineis dos postos; e' tambem o unico momento em que esta pagina precisa gritar.
  if (input.emTransito.some((t) => t.credenciadoId === c.id)) {
    // Sem mesa, a chamada veio do salao (o organizador de la' chama por zona, sem mesa fixa).
    // Nao havendo nem mesa nem etapa de recepcao, preferimos nao inventar destino: a tela manda
    // procurar a organizacao em vez de mandar a pessoa para o lugar errado.
    const destino = mesa
      ? naMesa
      : c.etapa === "recepcao"
        ? { destinoMesa: null, destinoZona: "salao" as const }
        : { destinoMesa: null, destinoZona: null };

    return { ...base, ...destino, estado: "chamado" };
  }

  // 4. Chamaram e ele nao apareceu. Vem DEPOIS do trânsito porque chamar de novo limpa a marca:
  // se as duas condicoes valerem no mesmo retrato, o que vale para o cliente e' "voce foi chamado".
  if (c.noShow) return { ...base, estado: "nao_localizado" };

  // 5. Ainda nao passou pela entrada. Acontece quando o link e' enviado antes do check-in.
  if (!c.entrouEm) return { ...base, estado: "aguardando_entrada" };

  // 6. As duas filas de ESPERA em que ele pode ter posicao. A posicao sai do indice na lista que
  // o servidor ja' montou com as regras do dia (`filaDaRecepcao` respeita a prioridade do PIX);
  // recalcular aqui criaria uma segunda fonte de verdade e o cliente veria um numero diferente
  // do que o organizador ve na tela dele.
  const fila =
    c.etapa === "recepcao"
      ? { lista: input.filaRecepcao, zona: "recepcao" as const }
      : c.etapa === "secretaria"
        ? { lista: input.filaSecretaria, zona: "secretaria" as const }
        : null;

  if (fila) {
    const indice = fila.lista.findIndex((p) => p.id === c.id);

    // Fora da lista (o servidor pode te-lo filtrado por um motivo que nao chegou ate' aqui):
    // dizemos que ele espera, sem numero. Chutar "1" seria mandar a pessoa levantar por engano.
    if (indice < 0) return { ...base, estado: "na_fila", filaZona: fila.zona };

    // PERSPECTIVA: so' quando ha' gente na frente (indice>=1) e o servidor mandou o ritmo. Faixa
    // de +-30% pra comunicar que e' estimativa, arredondada em minutos (piso 1, teto minimo 2).
    const eta =
      input.ritmoPorPessoaMin && indice >= 1
        ? {
            ate: Math.max(2, Math.round(indice * input.ritmoPorPessoaMin * 1.3)),
            de: Math.max(1, Math.round(indice * input.ritmoPorPessoaMin * 0.7)),
          }
        : null;

    return {
      ...base,
      estado: "na_fila",
      etaMinutos: eta,
      filaZona: fila.zona,
      pessoasNaFrente: indice,
      posicao: indice + 1,
    };
  }

  // 7. Etapas sem fila de espera (negociacao, reserva, proposta, pagamento): ele esta com alguem
  // do time agora. Negociacao acontece no salao; as demais nao tem lugar fixo.
  return {
    ...base,
    estado: "em_atendimento",
    ...(c.etapa === "negociacao"
      ? { destinoMesa: null, destinoZona: "salao" as const }
      : naMesa),
  };
}
