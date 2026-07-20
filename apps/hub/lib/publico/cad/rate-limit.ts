// Teto de uso das rotas públicas do CAD.
//
// POR QUE PRECISA NASCER: não existe rate limit nenhum no repositório e não há Redis/KV. O
// único anti-abuso de rota pública hoje é um teto de tamanho de texto (`MAX_TTS_TEXT` na voz
// do Prometeu, público justamente por ser pago). Aqui há DUAS torneiras caras (OCR da MOST a
// ~R$ 0,50 por imagem e enriquecimento de CRECI a ~R$ 1,60 por consulta) e um oráculo de
// enumeração ("esse CNPJ é parceiro da Careli?") apontado para a internet.
//
// CALIBRAGEM PELO COMPORTAMENTO REAL: um corretor legítimo digita 1 CPF e 1 CNPJ. Erra e
// repete duas ou três vezes. Nunca chega a 10. Um scanner faz centenas. Por isso o teto é
// generoso e o que segura o abuso antes dele é o ATRASO PROGRESSIVO: quem erra 3 vezes não
// sente nada; o scanner cai para 8s por tentativa e o ataque deixa de compensar muito antes
// de qualquer humano ser bloqueado.
//
// O IP vai HASHEADO: IP é dado pessoal e guardar em claro não se justifica para contar.
import { createHash } from "node:crypto";

import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type Balde =
  | "assistente"
  | "creci"
  | "enviar"
  | "identificacao"
  | "imobiliaria"
  | "ocr";

type Regra = { janelaSegundos: number; teto: number };

const REGRAS: Record<Balde, Regra> = {
  // Widget de FAQ: conversa longa é legítima, conversa infinita é bot.
  assistente: { janelaSegundos: 60 * 60, teto: 40 },
  // Torneiras PAGAS: teto diário e 429 seco, sem atraso progressivo (atrasar não economiza).
  creci: { janelaSegundos: 24 * 60 * 60, teto: 30 },
  enviar: { janelaSegundos: 60 * 60, teto: 10 },
  identificacao: { janelaSegundos: 10 * 60, teto: 12 },
  imobiliaria: { janelaSegundos: 10 * 60, teto: 12 },
  ocr: { janelaSegundos: 24 * 60 * 60, teto: 30 },
};

// Baldes onde o excesso vira espera antes de virar bloqueio. Só os de identificação: nas
// torneiras pagas, segurar a conexão aberta custa function-time e não economiza a consulta.
const PROGRESSIVO: Balde[] = ["identificacao", "imobiliaria"];

export function chaveDoRequest(request: Request): string {
  // x-forwarded-for na Vercel: o primeiro é o cliente real.
  const encaminhado = request.headers.get("x-forwarded-for") ?? "";
  const ip = encaminhado.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "sem-ip";
  return createHash("sha256").update(`publico-cad:${ip}`).digest("hex");
}

export type Veredito = { esperaMs: number; permitido: boolean; teto: number };

// Contador por janela fixa. Janela fixa (e não deslizante) de propósito: uma linha por
// chave/balde/janela, sem histórico de acessos guardado — o que conta é o volume, e guardar
// timestamp por tentativa seria acumular rastro de navegação de gente que não é cliente.
export async function consumir(
  adminClient: AdminClient,
  balde: Balde,
  chave: string,
): Promise<Veredito> {
  const regra = REGRAS[balde];
  const agora = Date.now();
  const inicio = new Date(Math.floor(agora / (regra.janelaSegundos * 1000)) * regra.janelaSegundos * 1000);

  const { data, error } = await adminClient
    .from("publico_rate_limit")
    .select("contador")
    .eq("balde", balde)
    .eq("chave_hash", chave)
    .eq("janela_inicio", inicio.toISOString())
    .maybeSingle<{ contador: number }>();

  // Tabela ausente (migration 0063 pendente) NÃO derruba o formulário: sem ela o fluxo segue,
  // e as travas que restam são a validação de forma e a exigência de CNPJ credenciado antes
  // de qualquer chamada paga.
  // ⚠️ APLICAR A 0063 ANTES DE DIVULGAR O LINK: até lá as torneiras pagas ficam sem teto.
  if (error && tabelaAusente(error)) {
    return { esperaMs: 0, permitido: true, teto: regra.teto };
  }
  if (error) {
    // Falha de leitura real: deixa passar (o corretor legítimo não pode ficar refém do
    // contador), mas sem incrementar.
    return { esperaMs: 0, permitido: true, teto: regra.teto };
  }

  const usado = data?.contador ?? 0;
  const novo = usado + 1;

  const { error: upsertError } = await adminClient.from("publico_rate_limit").upsert(
    {
      balde,
      chave_hash: chave,
      contador: novo,
      janela_inicio: inicio.toISOString(),
      visto_em: new Date(agora).toISOString(),
    },
    { onConflict: "balde,chave_hash,janela_inicio" },
  );
  if (upsertError && !tabelaAusente(upsertError)) {
    return { esperaMs: 0, permitido: true, teto: regra.teto };
  }

  if (novo <= regra.teto) return { esperaMs: 0, permitido: true, teto: regra.teto };

  const excedente = novo - regra.teto;
  if (PROGRESSIVO.includes(balde) && excedente <= 3) {
    return { esperaMs: atrasoProgressivo(excedente), permitido: true, teto: regra.teto };
  }
  return { esperaMs: 0, permitido: false, teto: regra.teto };
}

// 2s, 4s, 8s.
export function atrasoProgressivo(excedente: number): number {
  return Math.min(8000, 2000 * 2 ** (excedente - 1));
}

function tabelaAusente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || /does not exist/i.test(error.message ?? "");
}

// Piso de latência: quem responde "não credenciada" em 8ms e "credenciada" em 180ms está
// respondendo pelo relógio, e o relógio é enumerável. Achatar os dois caminhos no mesmo piso
// tira esse canal.
export const PISO_LATENCIA_MS = 250;

export async function comPisoDeLatencia<T>(inicio: number, valor: T): Promise<T> {
  const decorrido = Date.now() - inicio;
  if (decorrido < PISO_LATENCIA_MS) {
    await new Promise((resolve) => setTimeout(resolve, PISO_LATENCIA_MS - decorrido));
  }
  return valor;
}
