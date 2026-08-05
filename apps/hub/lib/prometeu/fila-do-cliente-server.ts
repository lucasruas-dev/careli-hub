// A LEITURA que alimenta a pagina publica da fila (server-side, service role).
//
// Separado de `fila-do-cliente.ts` (que e' puro) pelo mesmo motivo de `operador-server.ts`: o
// tipo e a regra podem ser importados pela tela; o acesso ao banco, nao.
//
// ⚠️ CUSTO. Esta rota e' o unico ponto do Prometeu chamado por CENTENAS de celulares ao mesmo
// tempo, a cada 15s, por horas. Ler o evento inteiro por requisicao seria repetir o incidente de
// fatura do Hermes. Por isso existe o SNAPSHOT abaixo: quem chega dentro da janela de cache
// reaproveita a leitura que ja' esta em curso, e o banco ve um punhado de consultas por segundo
// em vez de uma por celular.
//
// POR QUE REUSAR `listCredenciados` + `filaDaRecepcao` em vez de uma consulta enxuta so' com o
// que a tela precisa: a posicao TEM que ser o mesmo numero que o organizador ve. A ordem da fila
// da recepcao depende da prioridade do PIX, do ajuste manual do admin e da data de chegada da
// CAD; reescrever isso aqui criaria uma segunda fonte de verdade que divergiria no primeiro
// ajuste de fila do dia — e a divergencia apareceria na mao do cliente.
import {
  filaDaRecepcao,
  filaDaSecretaria,
  getEvento,
  listCredenciados,
  listEmTransito,
  listMesas,
} from "./data";
import {
  derivarAcompanhamento,
  type AcompanhamentoDaFila,
} from "./fila-do-cliente";
import { nomeDoLancamento } from "./lancamento";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import type { PrometeuCredenciado, PrometeuMesa } from "./types";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// 4s: curto o bastante para o "voce foi chamado" nao atrasar de forma perceptivel (o pior caso
// e' cache + intervalo de poll) e longo o bastante para colapsar a rajada de celulares que
// chegam juntos. Nao adianta subir: quem manda no atraso e' o poll de 15s da tela.
const TTL_DO_SNAPSHOT_MS = 4000;

type SnapshotDoEvento = {
  credenciados: PrometeuCredenciado[];
  emTransito: { credenciadoId: string }[];
  filaRecepcao: PrometeuCredenciado[];
  filaSecretaria: PrometeuCredenciado[];
  lancamento: string;
  mesas: PrometeuMesa[];
  // Minutos que cada pessoa na frente adiciona a espera: tempo por atendimento (meta do Setup, ou
  // 10 min de default) dividido pela capacidade de mesas. Alimenta a PERSPECTIVA da tela do cliente.
  ritmoPorPessoaMin: number;
};

// Guardamos a PROMESSA, nao o resultado: cem celulares que caem no mesmo instante do mesmo
// lambda compartilham uma unica ida ao banco, em vez de dispararem cem iguais antes de a
// primeira voltar.
const emCache = new Map<string, { dados: Promise<SnapshotDoEvento | null>; em: number }>();

async function carregarSnapshot(
  client: AdminClient,
  eventoId: string,
): Promise<SnapshotDoEvento | null> {
  const [evento, credenciados, mesas, emTransito] = await Promise.all([
    getEvento(client, eventoId),
    listCredenciados(client, eventoId),
    listMesas(client, eventoId),
    listEmTransito(client, eventoId),
  ]);

  if (!evento) return null;

  const idsEmTransito = new Set(emTransito.map((t) => t.credenciadoId));

  // Ritmo da fila: tempo por atendimento (meta do Setup, senao 10 min) dividido pela capacidade de
  // atendimento em paralelo (mesas da secretaria, senao o nº de mesas conhecidas, minimo 1). E' uma
  // estimativa grosseira DE PROPOSITO — a tela mostra faixa, nao numero exato.
  const metaMin = evento.config?.metas?.tempoMedioAtendimento;
  const tempoPorAtendimentoMin = metaMin && metaMin > 0 ? metaMin : 10;
  const capacidade = Math.max(1, evento.config?.mesasSecretaria || mesas.length || 1);

  return {
    credenciados,
    emTransito,
    ritmoPorPessoaMin: tempoPorAtendimentoMin / capacidade,
    // Mesmo recorte da rota de operacao (/api/prometeu/fila): quem foi chamado sai da fila e
    // passa a viver no painel de transito. Sem o filtro, o cliente chamado continuaria vendo
    // uma posicao — e a de todo mundo atras dele ficaria uma casa maior do que a real.
    filaRecepcao: filaDaRecepcao(
      credenciados,
      evento.config?.checkinHabilitado ?? true,
    ).filter((c) => !idsEmTransito.has(c.id)),
    filaSecretaria: filaDaSecretaria(credenciados),
    lancamento: nomeDoLancamento(evento),
    mesas,
  };
}

async function snapshotDoEvento(
  client: AdminClient,
  eventoId: string,
): Promise<SnapshotDoEvento | null> {
  const guardado = emCache.get(eventoId);
  if (guardado && Date.now() - guardado.em < TTL_DO_SNAPSHOT_MS) {
    return guardado.dados;
  }

  const dados = carregarSnapshot(client, eventoId).catch((erro: unknown) => {
    // Falha NAO fica cacheada: senao um soluco do banco congelaria a tela de todo mundo pelos
    // proximos segundos, quando o proximo poll ja' teria resolvido.
    emCache.delete(eventoId);
    throw erro;
  });

  emCache.set(eventoId, { dados, em: Date.now() });
  return dados;
}

export type ResultadoDoAcompanhamento = {
  acompanhamento?: AcompanhamentoDaFila;
  error?: string;
};

// Mensagem unica para "nao achei essa pessoa neste evento". Cobre link de um lancamento antigo,
// credenciado arquivado no fim do dia e exclusao por no-show: para o cliente sao a mesma coisa,
// e detalhar so' serviria para contar ao mundo o que aconteceu com aquela pessoa.
export const ACOMPANHAMENTO_ENCERRADO =
  "Este acompanhamento nao esta mais ativo. Procure a organizacao do evento.";

export async function acompanhamentoDoCliente(
  client: AdminClient,
  input: { credenciadoId: string; eventoId: string },
): Promise<ResultadoDoAcompanhamento> {
  const snapshot = await snapshotDoEvento(client, input.eventoId);
  if (!snapshot) return { error: ACOMPANHAMENTO_ENCERRADO };

  // `listCredenciados` ja' esconde quem tem `encerrado_em`: nao achar aqui e' o mesmo que estar
  // fora da operacao. Nao vale ir buscar a linha arquivada so' para exibir o nome — a pessoa saiu.
  const credenciado = snapshot.credenciados.find((c) => c.id === input.credenciadoId);
  if (!credenciado) return { error: ACOMPANHAMENTO_ENCERRADO };

  return {
    acompanhamento: derivarAcompanhamento({
      credenciado,
      emTransito: snapshot.emTransito,
      filaRecepcao: snapshot.filaRecepcao,
      filaSecretaria: snapshot.filaSecretaria,
      lancamento: snapshot.lancamento,
      mesas: snapshot.mesas,
      ritmoPorPessoaMin: snapshot.ritmoPorPessoaMin,
    }),
  };
}
