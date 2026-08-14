// A PORTA DA API DO GLOTES: autenticação, teto de requisições, log de acesso e formato de erro.
//
// Esta API fica na allowlist do `proxy.ts` (o gate global exige Bearer de sessão em /api/*, e o
// GLOTES não tem sessão), então ela **se protege por dentro** — exatamente como os crons e os
// webhooks. Tudo o que guarda dado pessoal de 375 titulares está aqui.
import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

/** Teto por janela. Generoso para carga inicial (68 mil parcelas ÷ 1000 por página = 69 chamadas),
 *  apertado o bastante para não deixar ninguém martelar o legado, que tem pool de 5 conexões. */
const TETO_REQUISICOES = 120;
const JANELA_MS = 60_000;

const janelas = new Map<string, { ate: number; contagem: number }>();

export type Falha = { resposta: NextResponse };

function erro(status: number, codigo: string, mensagem: string, headers?: HeadersInit) {
  return NextResponse.json({ erro: codigo, mensagem }, { headers, status });
}

/**
 * Compara sem vazar tempo.
 *
 * Comparação com `===` termina no primeiro byte diferente, e a diferença de tempo entre "errou no
 * primeiro caractere" e "errou no último" é medível pela rede. Com o hash de cada lado, os dois
 * lados têm sempre o mesmo tamanho e a comparação é de tempo constante.
 */
function iguais(recebido: string, esperado: string): boolean {
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

/**
 * Valida o token do header `X-Glotes-Token`.
 *
 * NUNCA aceitar o token por query string, nem como fallback: token em URL aparece em log de
 * proxy, em histórico e no `Referer`, e este dá acesso a nome, CPF e endereço de 375 pessoas. O
 * contrato com o cliente já diz "sempre no header".
 */
export function autorizar(request: Request): Falha | { ok: true } {
  const esperado = process.env.GLOTES_API_TOKEN?.trim();

  if (!esperado) {
    // Sem token configurado a API fica FECHADA. O contrário (liberar quando falta configuração)
    // é como vazamento começa: alguém remove a env e a porta abre sozinha.
    console.error("[glotes] GLOTES_API_TOKEN ausente — API indisponível");
    return {
      resposta: erro(503, "indisponivel", "Integração não configurada."),
    };
  }

  const recebido = request.headers.get("x-glotes-token")?.trim() ?? "";
  if (!recebido || !iguais(recebido, esperado)) {
    return {
      resposta: erro(401, "nao_autorizado", "Token inválido ou revogado."),
    };
  }

  return { ok: true };
}

/** Teto simples por instância. Não é distribuído, e não precisa ser: o objetivo é impedir
 *  martelada acidental, não resistir a ataque coordenado. */
export function dentroDoTeto(chave: string): Falha | { ok: true } {
  const agora = Date.now();
  const atual = janelas.get(chave);

  if (!atual || atual.ate < agora) {
    janelas.set(chave, { ate: agora + JANELA_MS, contagem: 1 });
    return { ok: true };
  }

  atual.contagem += 1;
  if (atual.contagem > TETO_REQUISICOES) {
    const espera = Math.max(1, Math.ceil((atual.ate - agora) / 1000));
    return {
      resposta: erro(
        429,
        "teto_excedido",
        "Aguarde antes de tentar de novo.",
        { "Retry-After": String(espera) },
      ),
    };
  }

  return { ok: true };
}

export function pedidoInvalido(mensagem: string): NextResponse {
  return erro(400, "parametro_invalido", mensagem);
}

export function falhaInterna(): NextResponse {
  return erro(500, "falha_interna", "Não foi possível ler a carteira agora.");
}

/**
 * Log de acesso: quem pediu o quê, quando, e quantas linhas levou.
 *
 * SEM O CORPO DA RESPOSTA, de propósito: registrar as linhas devolvidas seria copiar CPF e
 * endereço para o log. O que fica é o suficiente para responder "quem viu o quê, quando", que é a
 * pergunta que aparece quando alguém questiona o tratamento do dado.
 */
export function registrarAcesso(entrada: {
  conjunto: string;
  filtros: Record<string, unknown>;
  ip: string;
  linhas: number;
}): void {
  console.log(
    "[glotes][acesso]",
    JSON.stringify({
      conjunto: entrada.conjunto,
      em: new Date().toISOString(),
      filtros: entrada.filtros,
      ip: entrada.ip,
      linhas: entrada.linhas,
    }),
  );
}

export function ipDe(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "desconhecido"
  );
}

/**
 * `alterado_desde` precisa vir COM FUSO.
 *
 * "2026-08-01T00:00:00" sem fuso é interpretado como horário local do servidor (UTC na Vercel), o
 * que joga a janela três horas para trás em relação ao Brasil e faz o cliente perder registros
 * sem perceber. O contrato exige o fuso; aqui a exigência é verificada.
 */
export function lerAlteradoDesde(valor: null | string): { erro: string } | { valor: null | string } {
  if (!valor) return { valor: null };

  const temFuso = /(z|[+-]\d{2}:?\d{2})$/i.test(valor.trim());
  if (!temFuso) {
    return { erro: "O parâmetro alterado_desde precisa incluir o fuso horário." };
  }

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return { erro: "O parâmetro alterado_desde não é uma data válida." };
  }

  // O MySQL recebe no formato dele, em UTC.
  return { valor: data.toISOString().slice(0, 19).replace("T", " ") };
}

export function lerLimite(valor: null | string): { erro: string } | { valor: null | number } {
  if (!valor) return { valor: null };
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || numero > 1000) {
    return { erro: "O parâmetro limite precisa ser um inteiro entre 1 e 1000." };
  }
  return { valor: numero };
}

export function lerData(valor: null | string, campo: string): { erro: string } | { valor: null | string } {
  if (!valor) return { valor: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) {
    return { erro: `O parâmetro ${campo} precisa estar no formato aaaa-mm-dd.` };
  }
  return { valor: valor.trim() };
}
