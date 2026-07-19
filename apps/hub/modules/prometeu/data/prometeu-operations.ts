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
  PrometeuJanela,
  PrometeuMesa,
} from "@/lib/prometeu/types";

async function getAccessToken(): Promise<string | null> {
  const client = getHubSupabaseClient();
  if (!client) return null;

  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

async function chamar<T>(
  url: string,
  init?: RequestInit,
): Promise<{ data?: T; error?: string }> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const resposta = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } });
    const corpo = (await resposta.json().catch(() => ({}))) as {
      data?: T;
      error?: string;
    };

    if (!resposta.ok) return { error: corpo.error ?? `Falha (${resposta.status}).` };
    return { data: corpo.data };
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
  return chamar<{ ok: boolean; status: string }>("/api/prometeu/eventos/status", {
    body: JSON.stringify({ acao: "ativar", eventoId }),
    method: "POST",
  });
}

// ⚠️ DESTRUTIVO e restrito ao DONO do evento (verificado por e-mail no servidor).
// Só roda ANTES do evento começar: depois que entra em andamento, fica bloqueado em definitivo.
export async function iniciarEventoRealRemoto(input: { eventoId: string }) {
  return chamar<{ ok: boolean; resetados: number; status: string }>(
    "/api/prometeu/eventos/status",
    {
      body: JSON.stringify({ acao: "iniciar-real", confirmado: true, ...input }),
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
      body: JSON.stringify({ acao: "encerrar-dia", confirmado: true, ...input }),
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
  // A fila da RECEPÇÃO: só quem já bipou, nos dois regimes da janela. É quem chamar agora.
  filaRecepcao: PrometeuCredenciado[];
  mesas: PrometeuMesa[];
};

export async function fetchFila(eventoId: string) {
  return chamar<FilaPayload>(`/api/prometeu/fila?eventoId=${encodeURIComponent(eventoId)}`);
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

// O bip do QR na recepcao. Devolve `naJanela`, que decide o regime da fila desse cliente.
export async function fazerCheckInRemoto(input: {
  credenciadoId: string;
  eventoId: string;
}) {
  return chamar<{ naJanela: boolean; ok: boolean }>("/api/prometeu/credenciados", {
    body: JSON.stringify({ acao: "checkin", ...input }),
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
