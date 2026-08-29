"use client";

// Cliente das rotas /api/prometeu/*. Mesmo contrato do Apolo: pega o Bearer da sessao do hub
// e chama a rota; a rota valida papel e fala com o banco.
import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  PrometeuAtividade,
  PrometeuChamada,
  PrometeuCredenciado,
  PrometeuEtapa,
  PrometeuEvento,
  PrometeuEventoConfig,
  PrometeuIndicadorDaMesa,
  PrometeuJanela,
  PrometeuMesa,
  PrometeuOperadorEu,
  PrometeuOperadorResumo,
  PrometeuPapel,
  PrometeuPassoJornada,
  PrometeuResumoDaMesa,
  PrometeuZona,
} from "@/lib/prometeu/types";

async function getAccessToken(): Promise<string | null> {
  const client = getHubSupabaseClient();
  if (!client) return null;

  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

// `status` viaja junto porque nem toda recusa é falha: o bip do salão devolve 409 quando a
// pessoa não foi chamada, e a tela precisa separar "o sistema barrou de propósito" de "deu
// erro, tenta de novo". Sem o código, as duas chegariam como texto e ficariam iguais.
async function chamar<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data?: T; error?: string; status?: number }> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const resposta = await fetch(url, {
      ...init,
      headers: { ...headers, ...init?.headers },
    });
    const corpo = (await resposta.json().catch(() => ({}))) as {
      data?: T;
      error?: string;
    };

    if (!resposta.ok) {
      return {
        error: corpo.error ?? `Falha (${resposta.status}).`,
        status: resposta.status,
      };
    }

    return { data: corpo.data, status: resposta.status };
  } catch (erro) {
    return { error: (erro as Error).message };
  }
}

export async function fetchEventos() {
  return chamar<PrometeuEvento[]>("/api/prometeu/eventos");
}

// Empreendimentos com credenciamento ativo no Apolo (nome e sigla vem do C2X).
export type PrometeuEmpreendimento = {
  code: string;
  id: string;
  // Incorporador do C2X — vira o pre-preenchimento da construtora no Setup.
  incorporador?: string | null;
  logoUrl: string | null;
  name: string;
};

export async function fetchEmpreendimentos() {
  return chamar<PrometeuEmpreendimento[]>("/api/prometeu/empreendimentos");
}

export async function criarEventoRemoto(input: {
  dataEvento?: string | null;
  enterpriseCode?: string | null;
  enterpriseId?: string | null;
  nome: string;
}) {
  return chamar<PrometeuEvento>("/api/prometeu/eventos", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

// Cria (submete à Meta) o template de boas-vindas do check-in. Ação única, disparada pelo botão do
// Setup. A aprovação fica com a Meta (pode levar horas a dias).
export async function criarTemplateBoasVindasRemoto() {
  return chamar<{ id: string | null; name: string; status: string }>(
    "/api/prometeu/boas-vindas-template",
    { method: "POST" },
  );
}

// Cria (submete à Meta) o template do chamado ("É a sua vez"). Ação única, disparada pelo botão do
// Setup. A aprovação fica com a Meta (pode levar horas a dias).
export async function criarTemplateChamadoRemoto() {
  return chamar<{ id: string | null; name: string; status: string }>(
    "/api/prometeu/chamado-template",
    { method: "POST" },
  );
}

export async function salvarEventoRemoto(input: {
  config?: PrometeuEventoConfig;
  dataEvento?: string | null;
  enterpriseCode?: string | null;
  enterpriseId?: string | null;
  eventoId: string;
  nome?: string;
}) {
  return chamar<PrometeuEvento>("/api/prometeu/eventos", {
    body: JSON.stringify(input),
    method: "PATCH",
  });
}

// Libera a preparacao: CAD, etiqueta, PIX, fila e os testes do time.
export async function ativarEventoRemoto(eventoId: string) {
  return chamar<{ fila?: ResumoDaFilaAberta; ok: boolean; status: string }>(
    "/api/prometeu/eventos/status",
    {
      body: JSON.stringify({ acao: "ativar", eventoId }),
      method: "POST",
    },
  );
}

// O que a ROTINA DE ABERTURA do lancamento fez. Volta na criacao e na ativacao.
export type ResumoDaFilaAberta = {
  comPix: boolean;
  credenciadas: number;
  entraram: number;
  erro?: string;
  jaEstavam: number;
  recusadas: number;
  recusasPorMotivo: Record<string, number>;
};

// TRAZ para a fila as CADs que ja estavam CREDENCIADAS antes do lancamento existir.
//
// ⚠️ A fila e alimentada por EVENTO (quando a CAD muda de etapa). Quem ja estava em `credenciado`
// ha semanas nunca mais muda de etapa, entao nao entra sozinho num lancamento criado hoje.
export async function importarCredenciadosRemoto(input: {
  dryRun?: boolean;
  eventoId: string;
}) {
  return chamar<{
    credenciadas: number;
    dryRun?: boolean;
    empreendimento?: null | string;
    entraram?: number;
    jaEstavam?: number;
    recusadas?: number;
    recusasPorMotivo?: Record<string, number>;
  }>("/api/prometeu/eventos/importar-credenciados", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

// ARQUIVA (ou devolve) o lancamento. Restrito ao DONO.
//
// ⚠️ NAO APAGA NADA. Arquivar so tira das telas: credenciados, movimentacoes, chamadas e mesas
// continuam no banco, e `desarquivar` devolve tudo. Nao existe rota de apagar evento de
// proposito — as FKs sao ON DELETE CASCADE e um clique errado levaria o historico inteiro.
export async function arquivarEventoRemoto(input: {
  arquivar: boolean;
  eventoId: string;
}) {
  return chamar<{ arquivado: boolean; ok: boolean }>(
    "/api/prometeu/eventos/status",
    {
      body: JSON.stringify({
        acao: input.arquivar ? "arquivar" : "desarquivar",
        eventoId: input.eventoId,
      }),
      method: "POST",
    },
  );
}

// ⚠️ DESTRUTIVO e restrito ao DONO do evento (verificado por e-mail no servidor).
// Só roda ANTES do evento começar: depois que entra em andamento, fica bloqueado em definitivo.
export async function iniciarEventoRealRemoto(input: { eventoId: string }) {
  return chamar<{ ok: boolean; resetados: number; status: string }>(
    "/api/prometeu/eventos/status",
    {
      body: JSON.stringify({
        acao: "iniciar-real",
        confirmado: true,
        ...input,
      }),
      method: "POST",
    },
  );
}

// ⚠️ Fim de um dia do evento, restrito ao DONO. Arquiva quem não concluiu o fluxo (some da
// operação, fica no histórico pra medir performance) e preserva quem concluiu.
// `encerrarEvento` só no ÚLTIMO dia — nos intermediários o evento segue em andamento.
export async function encerrarDiaRemoto(input: {
  encerrarEvento?: boolean;
  eventoId: string;
}) {
  return chamar<{ arquivados: number; concluidos: number; ok: boolean }>(
    "/api/prometeu/eventos/status",
    {
      body: JSON.stringify({
        acao: "encerrar-dia",
        confirmado: true,
        ...input,
      }),
      method: "POST",
    },
  );
}

export async function fetchJanelas(eventoId: string) {
  return chamar<PrometeuJanela[]>(
    `/api/prometeu/janelas?eventoId=${encodeURIComponent(eventoId)}`,
  );
}

export async function salvarJanelaRemoto(input: {
  data: string;
  eventoId: string;
  horaFim: string;
  horaInicio: string;
}) {
  return chamar<{ ok: boolean }>("/api/prometeu/janelas", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export type FilaPayload = {
  // Feed "Atividade ao vivo" do Painel: as últimas trocas de etapa.
  atividade: PrometeuAtividade[];
  // Card "Últimas chamadas" do Painel.
  chamadas: PrometeuChamada[];
  // A fila do EVENTO: ordem do PIX (e os ajustes do admin). Todos os habilitados.
  credenciados: PrometeuCredenciado[];
  evento: PrometeuEvento;
  // A fila da RECEPÇÃO: quem já fez check-in e ainda espera. É de onde o SALÃO chama.
  filaRecepcao: PrometeuCredenciado[];
  // A fila do SALÃO: quem está em negociação. É de onde a SECRETARIA chama.
  filaSalao: PrometeuCredenciado[];
  // A fila da SECRETARIA: quem o organizador dela ja bipou na chegada e espera atendimento.
  filaSecretaria: PrometeuCredenciado[];
  // Chamados que nao apareceram. Saem das filas normais; chamar de novo os traz de volta.
  noShow: PrometeuCredenciado[];
  // Chamados que ainda não apareceram. Vem do banco porque UMA pessoa chama VÁRIAS de uma vez,
  // e o organizador do outro celular precisa enxergar o que o colega chamou.
  // ⚠️ Esta lista vem FILTRADA (só chamadas SEM mesa) — é a do painel do salão, onde o "Não veio"
  // não pode alcançar chamado de mesa. A tela do ATENDENTE precisa da completa (abaixo).
  emTransito: { chamadoEm: string; credenciadoId: string }[];
  // TODAS as chamadas abertas, com a mesa. É daqui que o atendente reconhece a chamada da PRÓPRIA
  // mesa (overlay Compareceu/Não veio/Rechamar) — regressão de 01/08: a lista filtrada acima nunca
  // traz chamada com mesa, e o overlay parou de abrir. Opcional para atravessar deploy misto.
  emTransitoTodos?: {
    chamadoEm: string;
    credenciadoId: string;
    mesaId: string | null;
  }[];
  mesas: PrometeuMesa[];
  // Os indicadores da MESA (atendimentos do dia, tempo médio e começo do atendimento em curso).
  // Só vem preenchido para quem passou `mesaId` — as outras telas não pedem e não pagam a conta.
  resumoDaMesa: PrometeuResumoDaMesa | null;
  // Indicadores de TODAS as mesas (por mesaId), só quando a Central pede `resumoMesas`.
  resumoDeMesas: Record<string, PrometeuIndicadorDaMesa>;
};

// `mesaId` é opcional de propósito: quem informa a mesa recebe também o resumo dela.
// `resumoMesas` faz o servidor devolver os indicadores de TODAS as mesas (só a Central usa).
export async function fetchFila(
  eventoId: string,
  mesaId?: string,
  opcoes?: { resumoMesas?: boolean },
) {
  const mesa = mesaId ? `&mesaId=${encodeURIComponent(mesaId)}` : "";
  const resumo = opcoes?.resumoMesas ? "&resumoMesas=1" : "";

  return chamar<FilaPayload>(
    `/api/prometeu/fila?eventoId=${encodeURIComponent(eventoId)}${mesa}${resumo}`,
  );
}

// A jornada de UM cliente (modal da Central). Buscada só ao abrir, fora do polling da fila.
export async function fetchJornada(credenciadoId: string) {
  return chamar<{ passos: PrometeuPassoJornada[] }>(
    `/api/prometeu/jornada?credenciadoId=${encodeURIComponent(credenciadoId)}`,
  );
}

export async function moverCredenciado(input: {
  credenciadoId: string;
  etapa: PrometeuEtapa;
  motivo?: string;
}) {
  return chamar<{ ok: boolean }>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "mover", ...input }),
    method: "PATCH",
  });
}

export async function confirmarPagamento(input: {
  credenciadoId: string;
  pagoEm?: string;
}) {
  return chamar<{ ok: boolean }>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "pagamento", ...input }),
    method: "PATCH",
  });
}

// O check-in (leitura do QR) na recepcao. Devolve `naJanela`, que decide o regime da fila
// desse cliente.
export async function fazerCheckInRemoto(input: {
  credenciadoId: string;
  eventoId: string;
}) {
  return chamar<{ naJanela: boolean; ok: boolean }>(
    "/api/prometeu/credenciados",
    {
      body: JSON.stringify({ acao: "checkin", ...input }),
      method: "PATCH",
    },
  );
}

// OS OUTROS DOIS BIPS DO DIA. Mesma leitura de QR do check-in, postos diferentes:
//  • SALAO confirma uma chamada — se a pessoa NAO foi chamada o servidor devolve 409 e nada se
//    move (e' a trava anti-fura-fila; a tela precisa mostrar a recusa, nao engolir);
//  • SECRETARIA registra a chegada de quem foi por conta propria, sem chamada previa.
// `credenciado` volta com o nome pra tela confirmar em voz alta quem acabou de passar.
export type BipDePosto = {
  credenciado: { etapa: string; nome: string } | null;
  ok: boolean;
};

// O organizador do salão chamando o próximo da fila. NÃO move etapa: quem move é o bip do QR,
// que é a confirmação de que apareceu a pessoa certa.
export async function chamarDoSalaoRemoto(input: {
  credenciadoId: string;
  eventoId: string;
}) {
  return chamar<{ ok: boolean }>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "chamar-do-salao", ...input }),
    method: "PATCH",
  });
}

// A PA (folha A4 com a proposta feita no salão), fotografada no bip da secretaria.
//
// Sobe DIRETO pro Storage: a foto de um A4 passa fácil dos 4,5 MB que a function da Vercel
// aceita no corpo. O servidor só assina a URL e depois carimba o caminho no credenciado.
//
// Devolve o `path` para quem chamou registrar em seguida — e é justamente esse caminho que não
// pode se perder no meio (foi o que deixou anexo invisível no Zeus).
export async function enviarPaRemoto(input: {
  arquivo: Blob;
  credenciadoId: string;
  eventoId: string;
}): Promise<{ error?: string; path?: string }> {
  const preparo = await chamar<{ bucket: string; path: string; token: string }>(
    "/api/prometeu/pa",
    {
      body: JSON.stringify({
        credenciadoId: input.credenciadoId,
        eventoId: input.eventoId,
      }),
      method: "POST",
    },
  );

  if (preparo.error || !preparo.data) {
    return { error: preparo.error ?? "Falha ao preparar o envio da PA." };
  }

  const client = getHubSupabaseClient();

  if (!client) {
    return { error: "Conexao indisponivel para enviar a PA." };
  }

  const envio = await client.storage
    .from(preparo.data.bucket)
    .uploadToSignedUrl(preparo.data.path, preparo.data.token, input.arquivo, {
      contentType: "image/jpeg",
    });

  if (envio.error) {
    return { error: envio.error.message };
  }

  // Só DEPOIS de o arquivo estar no bucket o caminho é gravado. Na ordem inversa, uma falha de
  // upload deixaria o credenciado apontando para um arquivo que não existe.
  const carimbo = await chamar<{ ok: boolean }>("/api/prometeu/pa", {
    body: JSON.stringify({
      credenciadoId: input.credenciadoId,
      path: preparo.data.path,
    }),
    method: "PATCH",
  });

  if (carimbo.error) return { error: carimbo.error };

  return { path: preparo.data.path };
}

// URL temporária para ABRIR a PA (o atendente remoto lançando a proposta).
export async function urlDaPaRemoto(path: string) {
  return chamar<{ url: string }>(
    `/api/prometeu/pa?path=${encodeURIComponent(path)}`,
  );
}

// AS RESERVAS DO DIA, LIDAS DO C2X. O hub não registra reserva (Lucas, 01/08: "esses dados vem
// tudo do C2X, nada é feito no hub") — o corretor lança o pedido de aquisição lá e aqui a gente
// reflete. Vem agrupado por CLIENTE, com as unidades dele, porque a aba lista pessoas.
// Uma unidade na mão de alguém AGORA, em qualquer etapa do C2X.
export type UnidadeDoC2x = {
  etapa: string;
  lote: string;
  quadra: string;
  unidade: string;
  // Contrato em diante: já é venda, não volta para o balcão.
  vendida: boolean;
};

export type ReservaC2x = {
  cliente: string;
  corretor: string | null;
  cpf: string;
  credenciadoId: string | null;
  // Hora da reserva mais antiga da pessoa: base do "tempo na reserva" e do alerta de 30 min.
  desde: string;
  etapaNoEvento: string | null;
  imobiliaria: string | null;
  // Reservou no C2X mas não passou pelo credenciamento do evento. Aparece, marcado.
  naFilaDoEvento: boolean;
  unidades: string[];
};

export async function fetchReservas(eventoId?: string) {
  const qs = eventoId ? `?eventoId=${encodeURIComponent(eventoId)}` : "";
  return chamar<{
    atualizadoEm: string;
    clientes: ReservaC2x[];
    resumo: { clientes: number; foraDaFila: number; unidades: number };
    // CPF -> unidades na mao da pessoa agora, em qualquer etapa (vem do C2X).
    unidadesPorCpf: Record<string, UnidadeDoC2x[]>;
  }>(`/api/prometeu/reservas${qs}`);
}

// Chamou, rechamou, ninguem apareceu: tira do painel de transito sem perder a pessoa. `zona` = o
// posto que marcou, pra o no-show aparecer so' na tela dele (o do salao nao vaza pra recepcao).
export async function marcarNoShowRemoto(input: {
  credenciadoId: string;
  zona?: string;
}) {
  return chamar<{ ok: boolean }>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "no-show", ...input }),
    method: "PATCH",
  });
}

// EXCLUIR DA OPERAÇÃO — o "No-show" definitivo (decisão D2 do Lucas, 27/07). Não confundir com
// `marcarNoShowRemoto`, que é o "Não veio" recuperável: aquele manda para a aba Aguardando
// retorno, este carimba `encerrado_em` e a pessoa some das filas, da aba de retorno e das demais
// telas do evento. Não é delete — o registro fica no histórico para o relatório do dia.
export async function excluirCredenciadoRemoto(input: {
  credenciadoId: string;
  motivo?: string;
}) {
  return chamar<{ ok: boolean }>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "excluir", ...input }),
    method: "PATCH",
  });
}

// O LINK DA FILA daquele cliente (pagina publica /publico/fila, assinada por HMAC). E' o que o
// botao de WhatsApp da fila reenvia: nao e' mensagem nova, e' o MESMO link que a pessoa deveria
// ter recebido no check-in para acompanhar a propria posicao no celular (decisao D1 do Lucas,
// 27/07). A URL so' pode ser montada no servidor, que e' onde vive a chave da assinatura.
export async function linkDaFilaRemoto(input: {
  credenciadoId: string;
  eventoId: string;
}) {
  return chamar<{ link: string }>(
    `/api/prometeu/link-fila?credenciadoId=${encodeURIComponent(input.credenciadoId)}&eventoId=${encodeURIComponent(input.eventoId)}`,
  );
}

// ── MAESTRO dos telões: fundo (música/vídeo) sincronizado em todas as TVs ──
export type PalcoEstado = {
  atualizadoEm?: string;
  mudo?: boolean;
  tocando?: boolean;
  videoId?: string | null;
  volume?: number;
};

export async function fetchPalco() {
  return chamar<{
    eventoId: string;
    // Links da TV independente (token HMAC, sem login) — o Setup mostra com botão copiar.
    linksTv?: { salao?: string | null; secretaria?: string | null };
    palco: PalcoEstado | null;
  }>("/api/prometeu/palco");
}

export async function comandarPalco(cmd: PalcoEstado) {
  return chamar<{ eventoId: string; palco: PalcoEstado }>(
    "/api/prometeu/palco",
    {
      body: JSON.stringify(cmd),
      method: "POST",
    },
  );
}

export async function bipDoSalaoRemoto(input: {
  credenciadoId: string;
  eventoId: string;
}) {
  return chamar<BipDePosto>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "bip-salao", ...input }),
    method: "PATCH",
  });
}

export async function bipDaSecretariaRemoto(input: {
  credenciadoId: string;
  eventoId: string;
}) {
  return chamar<BipDePosto>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "bip-secretaria", ...input }),
    method: "PATCH",
  });
}

// Carimba que a etiqueta daquele cliente ja foi impressa (etiqueta_impressa_em). E o que deixa
// a tela mostrar quem falta, em vez de o time reimprimir o lote inteiro por via das duvidas.
export async function marcarEtiquetaImpressaRemoto(credenciadoId: string) {
  return chamar<{ ok: boolean }>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "etiqueta", credenciadoId }),
    method: "PATCH",
  });
}

// Admin furando a fila. `motivo` e obrigatorio e fica auditado.
export async function ajustarOrdemRemoto(input: {
  credenciadoId: string;
  motivo: string;
  ordemAnterior?: number | null;
  ordemSeguinte?: number | null;
}) {
  return chamar<{ ok: boolean; ordem: number }>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "ordem", ...input }),
    method: "PATCH",
  });
}

export async function adicionarCredenciadoRemoto(input: {
  corretor?: string;
  documento?: string;
  eventoId: string;
  imobiliaria?: string;
  nome: string;
}) {
  return chamar<{ credenciadoId: string }>("/api/prometeu/credenciados", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

// -------------------------------------------------------------- operacao do dia

// CHAMAR o cliente: para uma mesa (secretaria) ou para uma zona (salao, com moverPara).
export async function chamarCredenciadoRemoto(input: {
  credenciadoId: string;
  eventoId: string;
  mesaId?: string;
  moverPara?: PrometeuEtapa;
  zona?: PrometeuZona;
}) {
  return chamar<{ ok: boolean }>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "chamar", ...input }),
    method: "PATCH",
  });
}

// ATENDER: o cliente compareceu na mesa (ocupada -> atendimento).
export async function atenderRemoto(input: {
  credenciadoId: string;
  mesaId: string;
}) {
  return chamar<{ ok: boolean }>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "atender", ...input }),
    method: "PATCH",
  });
}

// LIBERAR a mesa (fim do atendimento). `etapa` opcional avanca/direciona o cliente no mesmo ato.
export async function liberarMesaRemoto(input: {
  credenciadoId?: string;
  etapa?: PrometeuEtapa;
  mesaId: string;
  motivo?: string;
}) {
  return chamar<{ ok: boolean }>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "liberar", ...input }),
    method: "PATCH",
  });
}

// SENTAR na mesa: registra que ESTE atendente esta na mesa (o Mapa do salao mostra o nome).
export async function sentarNaMesaRemoto(input: {
  mesaId: string;
  nome: string;
}) {
  return chamar<{ ok: boolean }>("/api/prometeu/mesa", {
    body: JSON.stringify({ acao: "sentar", ...input }),
    method: "PATCH",
  });
}

// SAIR da mesa: limpa o atendente da mesa.
export async function sairDaMesaRemoto(input: { mesaId: string }) {
  return chamar<{ ok: boolean }>("/api/prometeu/mesa", {
    body: JSON.stringify({ acao: "sair", ...input }),
    method: "PATCH",
  });
}

// -------------------------------------------------------------- operadores

// LOGIN do operador do evento (conta propria, nao e' usuario do hub). O cookie de sessao e' setado
// pelo SERVIDOR na resposta; o fetch same-origin do helper `chamar` ja carrega/recebe o cookie.
export async function loginOperador(username: string, senha: string) {
  return chamar<PrometeuOperadorEu>("/api/prometeu/operador/login", {
    body: JSON.stringify({ senha, username }),
    method: "POST",
  });
}

// LOGOUT: o servidor apaga o cookie de sessao.
export async function logoutOperador() {
  return chamar<{ ok: boolean }>("/api/prometeu/operador/logout", {
    method: "POST",
  });
}

// "Quem sou eu": le o cookie de sessao. Devolve null quando nao ha operador logado.
export async function fetchOperadorEu() {
  return chamar<PrometeuOperadorEu>("/api/prometeu/operador/eu");
}

// ADMIN (Setup, com sessao do hub): lista, cria e remove operadores do evento.
export async function fetchOperadores(eventoId: string) {
  return chamar<PrometeuOperadorResumo[]>(
    `/api/prometeu/operadores?eventoId=${encodeURIComponent(eventoId)}`,
  );
}

export async function criarOperadorRemoto(input: {
  eventoId: string;
  mesaId?: string | null;
  nome: string;
  perfil: PrometeuPapel;
  senha: string;
  username: string;
  zona: PrometeuZona;
}) {
  return chamar<{ id: string; ok: boolean }>("/api/prometeu/operadores", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export async function removerOperadorRemoto(id: string) {
  return chamar<{ ok: boolean }>(
    `/api/prometeu/operadores?id=${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

// ── POSIÇÃO DE RESERVA (tela touch — Lucas, 24/08) ──────────────────────────

export type ReservaTouchUnidade = {
  area: string;
  c2xId: string;
  codigo: string;
  lote: string;
  preco: null | number;
  quadra: string;
};

export type ReservaTouchQuadra = {
  disponiveis: ReservaTouchUnidade[];
  quadra: string;
};

export type ReservaTouchContadores = {
  finalizadas: number;
  propostas: number;
  reservas: number;
};

export async function fetchReservaTouch(eventoId?: string) {
  const q = eventoId ? `?eventoId=${encodeURIComponent(eventoId)}` : "";
  return chamar<{
    contadores: ReservaTouchContadores;
    eventoId: string;
    quadras: ReservaTouchQuadra[];
  }>(`/api/prometeu/reserva-touch${q}`);
}

// O bip da etiqueta: uuid lido do QR → nome/etapa para a conferência antes de reservar.
export async function buscarClienteDaReserva(
  credenciadoId: string,
  eventoId?: string,
) {
  const extra = eventoId ? `&eventoId=${encodeURIComponent(eventoId)}` : "";
  return chamar<{
    credenciado: {
      corretor: null | string;
      documento: null | string;
      etapa: string;
      id: string;
      imobiliaria: null | string;
      nome: string;
    };
  }>(
    `/api/prometeu/reserva-touch?credenciadoId=${encodeURIComponent(credenciadoId)}${extra}`,
  );
}

export type ReservaTouchProponente = {
  credenciadoId: string;
  documento: null | string;
  nome: string;
  percentual: number;
};

export async function criarReservaTouchRemoto(input: {
  credenciadoId: string;
  eventoId: string;
  proponentes: ReservaTouchProponente[];
  unidades: ReservaTouchUnidade[];
}) {
  return chamar<{ cliente: string; grupoId: string; unidades: string[] }>(
    "/api/prometeu/reserva-touch",
    { body: JSON.stringify(input), method: "POST" },
  );
}

// ── ÁREA DE IMPRESSÃO DA PA (bip do cupom — Lucas, 24/08) ───────────────────

export type CupomReservaLinha = {
  area: null | string;
  codigo: string;
  createdAt: string;
  credenciadoId: string;
  grupoId: string;
  id: string;
  lote: string;
  paImpressaEm: null | string;
  paImpressaVezes: number;
  precoTabela: null | number;
  proponentes: ReservaTouchProponente[];
  propostaLancadaEm: null | string;
  quadra: string;
  situacao: string;
};

export async function fetchCupom(grupoId: string) {
  return chamar<{
    cliente: {
      corretor: null | string;
      documento: null | string;
      imobiliaria: null | string;
      nome: string;
    };
    evento: { id: string; incorporadora: null | string; nome: string } | null;
    reservas: CupomReservaLinha[];
  }>(`/api/prometeu/cupom?grupoId=${encodeURIComponent(grupoId)}`);
}

export async function marcarPaImpressaRemoto(grupoId: string) {
  return chamar<{ ok: boolean }>("/api/prometeu/cupom", {
    body: JSON.stringify({ grupoId }),
    method: "POST",
  });
}

// A secretária LANÇA A PROPOSTA bipando o cupom da reserva (Lucas, 24/08).
export async function lancarPropostaDoCupomRemoto(input: {
  grupoId: string;
  lancadoPor?: string;
}) {
  return chamar<{ jaLancada: boolean; ok: boolean }>("/api/prometeu/cupom", {
    body: JSON.stringify({ acao: "lancar-proposta", ...input }),
    method: "POST",
  });
}

// Os links públicos dos relatórios do lançamento (Inteligência de Dados).
export async function fetchRelatoriosDoLancamento(eventoId?: string) {
  const q = eventoId ? `?eventoId=${encodeURIComponent(eventoId)}` : "";
  return chamar<{ comercial: string; eventoId: string; performance: string }>(
    `/api/prometeu/relatorios${q}`,
  );
}

// AS RESERVAS DO EVENTO — a lista que o posto da PA usa para imprimir sem bipar.
//
// ⚠️ Existe porque o bip não é o único caminho (Lucas, 29/08): *"na parte de impressão PA
// colocar a impressão manual, a qual lista as unidades em reserva, ae eu posso clicar e mandar
// imprimir (...) para amanhã terá que ser manualmente mesmo"*. O leitor fica para depois; a
// lista é o que faz o evento andar.
//
// De quebra, é por ela que se REEMITE uma proposta e se CANCELA uma reserva — as três coisas
// pedem a mesma pergunta ("quais reservas existem?") e não valia a pena três telas.
export type ReservaDoEventoLinha = {
  canceladaEm: null | string;
  canceladaMotivo: null | string;
  cliente: null | string;
  criadaEm: string;
  grupoId: string;
  lotes: string[];
  origem: null | string;
  paImpressaEm: null | string;
  propostaLancadaEm: null | string;
  situacao: string;
};

export async function fetchReservasDoEvento(eventoId?: string) {
  const query = eventoId ? `?eventoId=${encodeURIComponent(eventoId)}` : "";
  return chamar<{ eventoId: string; reservas: ReservaDoEventoLinha[] }>(
    `/api/prometeu/reservas-do-evento${query}`,
  );
}

/** Cancela o cupom inteiro (todos os lotes daquele grupo). */
export async function cancelarReservaRemoto(input: {
  eventoId?: string;
  grupoId: string;
  motivo?: string;
}) {
  const query = input.eventoId
    ? `?eventoId=${encodeURIComponent(input.eventoId)}`
    : "";
  return chamar<{ codigos: string[]; quantos: number }>(
    `/api/prometeu/reservas-do-evento${query}`,
    {
      body: JSON.stringify({ grupoId: input.grupoId, motivo: input.motivo }),
      method: "POST",
    },
  );
}
