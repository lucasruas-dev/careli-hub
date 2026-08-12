import { NextResponse } from "next/server";

import { lerCadsDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import {
  conflitoDeNucleoFamiliar,
  cpfValidoParaNucleo,
  mensagemDeConflito,
} from "@/lib/apolo/nucleo-familiar";
import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient, hashIdentifier } from "@/lib/apolo/server";

// CHECAGEM DO CPF NA IDENTIFICAÇÃO — versão INTERNA (operador logado).
//
// Gêmea de /api/publico/cad/checar-cpf. A diferença é só a porta: aqui o operador está logado no
// Hub e o empreendimento vem do corpo, porque é ele quem escolhe no wizard; no público vem do
// token assinado, já que lá não há usuário autenticado.
//
// Ver o porquê da regra em lib/apolo/nucleo-familiar.ts.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const semConflito = NextResponse.json(
  { data: { conferido: false, conflito: null } },
  { headers: { "Cache-Control": "no-store" } },
);

export async function POST(request: Request) {
  const authorization = await authorizeApoloRead(request);
  if (!authorization.ok) return authorization.response;

  let corpo: { cpf?: unknown; cpfConjuge?: unknown; enterpriseId?: unknown };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return semConflito;
  }

  const cpf = digitos(corpo.cpf);
  const cpfConjuge = digitos(corpo.cpfConjuge);
  // CPF pela metade não é erro: o operador ainda está digitando, ou o MOST ainda não fechou.
  if (!cpfValidoParaNucleo(cpf)) return semConflito;

  const enterpriseId = normalizarEnterpriseId(corpo.enterpriseId ?? null);
  // Sem empreendimento não há o que comparar: a duplicidade é POR empreendimento.
  if (!enterpriseId) return semConflito;

  const adminClient = createApoloAdminClient();
  if (!adminClient) return semConflito;

  // Todas as fichas deste CPF, não uma: a mesma pessoa tem mais de uma ficha em 516 casos, e
  // olhar só a primeira foi o que deixou passar as CADs duplicadas de agosto.
  const docHash = hashIdentifier("cpf", cpf);
  const [{ data: porIdentificador }, { data: porDocumento }] = await Promise.all([
    adminClient
      .from("apolo_entity_identifiers")
      .select("entity_id")
      .eq("identifier_type", "cpf")
      .eq("value_hash", docHash),
    adminClient.from("apolo_entities").select("id").eq("document_hash", docHash),
  ]);

  const idsDoDocumento = [
    ...new Set([
      ...(porIdentificador ?? []).map((l: { entity_id: string }) => l.entity_id),
      ...(porDocumento ?? []).map((l: { id: string }) => l.id),
    ]),
  ].filter(Boolean);

  const responder = (conflito: null | { mensagem: string; tipo: string }) =>
    NextResponse.json(
      { data: { conferido: true, conflito } },
      { headers: { "Cache-Control": "no-store" } },
    );

  for (const id of idsDoDocumento) {
    let cads: { empreendimento: null | string; enterprise_id: null | string }[];
    try {
      cads = await lerCadsDaEsteira<{
        empreendimento: null | string;
        enterprise_id: null | string;
      }>(adminClient, id, "empreendimento, enterprise_id");
    } catch {
      // Esta rota é conveniência, não autoridade: em dúvida deixa seguir, e a trava do salvar
      // decide, que aquela é fail-closed.
      return semConflito;
    }

    const aqui = cads.find((c) => normalizarEnterpriseId(c.enterprise_id) === enterpriseId);
    if (aqui) {
      const onde = aqui.empreendimento?.trim();
      return responder({
        mensagem:
          `Este CPF já possui CAD ${onde ? `para o empreendimento ${onde}` : "para esse empreendimento"}.`,
        tipo: "cpf-ja-tem-cad",
      });
    }
  }

  const conflito = await conflitoDeNucleoFamiliar({
    adminClient,
    cpfConjuge,
    cpfTitular: cpf,
    enterpriseId,
    ignorarEntityIds: idsDoDocumento,
  });

  return responder(
    conflito ? { mensagem: mensagemDeConflito(conflito), tipo: conflito.motivo } : null,
  );
}
