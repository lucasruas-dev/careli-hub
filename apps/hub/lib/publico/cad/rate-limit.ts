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
  | "exigencias"
  | "identificacao"
  | "imobiliaria"
  | "ocr"
  | "upload";

type Regra = { janelaSegundos: number; teto: number };

// ⚠️ OS TETOS SÃO POR IP — e escritório de imobiliária inteiro (ou 4G com CGNAT) divide UM IP.
// Calibrados em 03/08 para o dia de trabalho em massa dos corretores, com números REAIS de
// produção: uma única CAD de casado consome 10-20 leituras de OCR (cada foto ruim = 2 rotações
// cobradas), e em 02/08 um só IP gastou 21 das antigas 30/dia. Com 3-4 corretores no mesmo
// Wi-Fi, os tetos antigos travavam o escritório na segunda CAD da manhã. A defesa contra abuso
// continua: os tetos novos seguram bot, não gente trabalhando.
const REGRAS: Record<Balde, Regra> = {
  // Widget de FAQ: conversa longa é legítima, conversa infinita é bot.
  assistente: { janelaSegundos: 60 * 60, teto: 40 },
  // Torneiras PAGAS: teto diário e 429 seco, sem atraso progressivo (atrasar não economiza).
  creci: { janelaSegundos: 24 * 60 * 60, teto: 60 },
  enviar: { janelaSegundos: 60 * 60, teto: 60 },
  // "Este empreendimento exige comprovante de renda?" — uma linha de settings, sem consulta paga e
  // sem oráculo (quem pergunta já tem sessão assinada, e a resposta é sobre o empreendimento que o
  // token dele já carimbou). Balde PRÓPRIO de propósito: pendurar no `identificacao` gastaria o
  // teto do CPF/CNPJ e empurraria o corretor legítimo para o atraso progressivo.
  exigencias: { janelaSegundos: 60 * 60, teto: 120 },
  identificacao: { janelaSegundos: 10 * 60, teto: 40 },
  imobiliaria: { janelaSegundos: 10 * 60, teto: 24 },
  ocr: { janelaSegundos: 24 * 60 * 60, teto: 400 },
  // Permissão de gravar UM documento grande direto no Storage. Não custa consulta paga, mas cada
  // permissão vira bytes no bucket, então tem teto. Uma CAD com tudo grande gasta ~6; o teto
  // aguenta o escritório inteiro no mesmo Wi-Fi sem travar na segunda CAD da manhã.
  upload: { janelaSegundos: 60 * 60, teto: 120 },
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
//
// ⚠️ O INCREMENTO É ATÔMICO POR COMPARAÇÃO (revisão do conjunto do portal, 16/09/2026). A versão
// anterior lia o contador e gravava `contador + 1` por upsert: 200 chamadas em paralelo liam o mesmo
// N e gravavam N+1, e as 200 leituras pagas da MOST passavam contra um teto de 400 por dia que
// registrou 1. Sem migration nova (uma RPC com `on conflict do update set contador = contador + 1`
// seria o ideal), a escrita virou "compare e grave": o update só vale se o contador ainda é o que foi
// lido (`.eq("contador", usado)`), e a linha nova nasce por insert, que o índice primário recusa em
// duplicata. Quem perde a corrida lê de novo e tenta outra vez; cada rodada tem ao menos um vencedor.
//
// `opcoes.teto`: o teto desta chave, quando não é o do balde (o teto do PORTAL inteiro,
// lib/apolo/incorporador/teto-do-portal.ts). A janela continua a do balde.
const TENTATIVAS_DO_CONTADOR = 8;

export async function consumir(
  adminClient: AdminClient,
  balde: Balde,
  chave: string,
  opcoes: { teto?: number } = {},
): Promise<Veredito> {
  const regra = REGRAS[balde];
  const teto = opcoes.teto ?? regra.teto;
  const agora = Date.now();
  const inicio = new Date(Math.floor(agora / (regra.janelaSegundos * 1000)) * regra.janelaSegundos * 1000);
  const liberado: Veredito = { esperaMs: 0, permitido: true, teto };

  for (let tentativa = 0; tentativa < TENTATIVAS_DO_CONTADOR; tentativa += 1) {
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
    // Falha de leitura real também deixa passar (o corretor legítimo não pode ficar refém do
    // contador), mas sem incrementar.
    if (error) return liberado;

    const visto = new Date(agora).toISOString();

    if (!data) {
      const { error: erroDoInsert } = await adminClient.from("publico_rate_limit").insert({
        balde,
        chave_hash: chave,
        contador: 1,
        janela_inicio: inicio.toISOString(),
        visto_em: visto,
      });
      if (!erroDoInsert) return vereditoDoContador(balde, 1, teto);
      // Outra chamada criou a linha no meio: lê de novo e disputa o update.
      if (chaveDuplicada(erroDoInsert)) continue;
      return liberado;
    }

    const usado = data.contador ?? 0;
    const { data: gravadas, error: erroDoUpdate } = await adminClient
      .from("publico_rate_limit")
      .update({ contador: usado + 1, visto_em: visto })
      .eq("balde", balde)
      .eq("chave_hash", chave)
      .eq("janela_inicio", inicio.toISOString())
      .eq("contador", usado)
      .select("contador");
    if (erroDoUpdate) return liberado;
    if (Array.isArray(gravadas) && gravadas.length > 0) {
      return vereditoDoContador(balde, usado + 1, teto);
    }
    // Ninguém gravado: outra chamada somou antes. Lê de novo.
  }

  // ⚠️ DISPUTA QUE NÃO ACABA É RAJADA, NÃO GENTE. Nenhuma pessoa dispara oito chamadas na mesma chave
  // no mesmo instante; um laço paralelo, sim. Aqui a chamada é recusada (sem espera), em vez de passar
  // sem contar, que era exatamente o buraco.
  return { esperaMs: 0, permitido: false, teto };
}

function vereditoDoContador(balde: Balde, novo: number, teto: number): Veredito {
  if (novo <= teto) return { esperaMs: 0, permitido: true, teto };

  const excedente = novo - teto;
  if (PROGRESSIVO.includes(balde) && excedente <= 3) {
    return { esperaMs: atrasoProgressivo(excedente), permitido: true, teto };
  }
  return { esperaMs: 0, permitido: false, teto };
}

function chaveDuplicada(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key/i.test(error.message ?? "");
}

// 2s, 4s, 8s.
export function atrasoProgressivo(excedente: number): number {
  return Math.min(8000, 2000 * 2 ** (excedente - 1));
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
