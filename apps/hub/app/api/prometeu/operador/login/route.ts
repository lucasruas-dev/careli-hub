import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  criarTokenSessao,
  PROMETEU_SESSION_COOKIE,
  PROMETEU_SESSION_TTL_MS,
  verificarSenha,
} from "@/lib/prometeu/operador-auth";
import {
  buscarOperadorAtivoPorUsername,
  registrarLoginOperador,
} from "@/lib/prometeu/operadores";
import type {
  PrometeuOperadorEu,
  PrometeuPapel,
  PrometeuZona,
} from "@/lib/prometeu/types";

// Login do OPERADOR do evento (conta propria, nao e' usuario do hub). ROTA PUBLICA (esta na
// allowlist do proxy.ts): nao ha Bearer de sessao do hub — a credencial e' o par username+senha,
// e a prova de sessao volta como cookie httpOnly assinado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Rate limit em memoria (por instancia). Nao e' uma barreira absoluta — em serverless ha varias
// instancias — mas segura o brute force ingenuo de uma origem sem custo de infra. A conta real
// contra forca bruta e a mensagem generica + o scrypt caro do verificarSenha.
const LIMITE_TENTATIVAS = 8;
const JANELA_MS = 5 * 60 * 1000;
const tentativasPorChave = new Map<string, { expira: number; total: number }>();

// Conta a tentativa atual. Devolve false quando ja passou do teto na janela.
function registrarTentativa(chave: string, agora: number): boolean {
  const atual = tentativasPorChave.get(chave);
  if (!atual || atual.expira <= agora) {
    tentativasPorChave.set(chave, { expira: agora + JANELA_MS, total: 1 });
    return true;
  }
  atual.total += 1;
  return atual.total <= LIMITE_TENTATIVAS;
}

function limparTentativas(chave: string): void {
  tentativasPorChave.delete(chave);
}

function ipDoRequest(request: Request): string {
  const encaminhado = request.headers.get("x-forwarded-for") ?? "";
  const primeiro = encaminhado.split(",")[0]?.trim();
  return primeiro || request.headers.get("x-real-ip") || "sem-ip";
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    senha?: string;
    username?: string;
  };
  const username = (body.username ?? "").trim();
  const senha = body.senha ?? "";

  const chave = `${ipDoRequest(request)}::${username.toLowerCase()}`;
  const agora = Date.now();

  if (!registrarTentativa(chave, agora)) {
    return NextResponse.json(
      { error: "Muitas tentativas. Aguarde alguns minutos e tente de novo." },
      { status: 429 },
    );
  }

  if (!username || !senha) {
    return NextResponse.json(
      { error: "Usuário ou senha inválidos." },
      { status: 401 },
    );
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Serviço indisponível." }, { status: 503 });
  }

  const operador = await buscarOperadorAtivoPorUsername(client, username);
  // Mensagem generica de proposito: nao revelar se foi o usuario ou a senha (evita enumeracao).
  const senhaOk = operador
    ? await verificarSenha(senha, operador.senha_hash)
    : false;

  if (!operador || !senhaOk) {
    return NextResponse.json(
      { error: "Usuário ou senha inválidos." },
      { status: 401 },
    );
  }

  const token = criarTokenSessao(
    {
      eventoId: operador.evento_id,
      mesaId: operador.mesa_id,
      operadorId: operador.id,
      perfil: operador.perfil,
      username: operador.username,
      zona: operador.zona,
    },
    agora,
  );

  await registrarLoginOperador(client, operador.id);
  limparTentativas(chave);

  const eu: PrometeuOperadorEu = {
    eventoId: operador.evento_id,
    mesaId: operador.mesa_id,
    nome: operador.nome,
    operadorId: operador.id,
    perfil: operador.perfil as PrometeuPapel,
    username: operador.username,
    zona: operador.zona as PrometeuZona,
  };

  const resposta = NextResponse.json({ data: eu });
  resposta.cookies.set(PROMETEU_SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: Math.floor(PROMETEU_SESSION_TTL_MS / 1000),
    path: "/",
    sameSite: "lax",
    secure: true,
  });
  return resposta;
}
