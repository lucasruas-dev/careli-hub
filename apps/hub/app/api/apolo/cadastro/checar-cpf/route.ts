import { NextResponse } from "next/server";

import { conferirCpfNoEmpreendimento } from "@/lib/apolo/cadastro-checar-cpf";
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { cpfValidoParaNucleo } from "@/lib/apolo/nucleo-familiar";
import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// CHECAGEM DO CPF NA IDENTIFICAÇÃO — versão INTERNA (operador logado).
//
// Gêmea de /api/publico/cad/checar-cpf. A diferença é só a porta: aqui o operador está logado no
// Hub e o empreendimento vem do corpo, porque é ele quem escolhe no wizard; no público vem do
// token assinado, já que lá não há usuário autenticado.
//
// A conferência mora em lib/apolo/cadastro-checar-cpf.ts desde 16/09/2026 (o CRM do portal do
// incorporador faz a mesma pergunta). Ver o porquê da regra em lib/apolo/nucleo-familiar.ts.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
// ⚠️ FUNÇÃO, NÃO CONSTANTE DE MÓDULO. Uma `Response` tem corpo de leitura única: a constante criada
// no carregamento do módulo era a MESMA instância em toda chamada da função quente da Vercel, e a
// segunda resposta "não conferido" podia sair com o corpo já consumido (o wizard lia como falha).
// Cada chamada precisa da sua resposta (o mesmo cuidado de /api/incorporador/produto/imobiliarias).
function semConflito(): NextResponse {
  return NextResponse.json(
    { data: { conferido: false, conflito: null } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const authorization = await authorizeApoloRead(request);
  if (!authorization.ok) return authorization.response;

  let corpo: { cpf?: unknown; cpfConjuge?: unknown; enterpriseId?: unknown };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return semConflito();
  }

  const cpf = digitos(corpo.cpf);
  const cpfConjuge = digitos(corpo.cpfConjuge);
  // CPF pela metade não é erro: o operador ainda está digitando, ou o MOST ainda não fechou.
  if (!cpfValidoParaNucleo(cpf)) return semConflito();

  const enterpriseId = normalizarEnterpriseId(corpo.enterpriseId ?? null);
  // Sem empreendimento não há o que comparar: a duplicidade é POR empreendimento.
  if (!enterpriseId) return semConflito();

  const adminClient = createApoloAdminClient();
  if (!adminClient) return semConflito();

  const resultado = await conferirCpfNoEmpreendimento(adminClient, {
    cpf,
    cpfConjuge,
    enterpriseId,
  });
  if (!resultado) return semConflito();

  return NextResponse.json(
    {
      data: {
        conferido: true,
        conflito: resultado.conflito
          ? { mensagem: resultado.conflito.mensagem, tipo: resultado.conflito.tipo }
          : null,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
