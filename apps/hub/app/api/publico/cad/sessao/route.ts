import { randomUUID } from "node:crypto";

import { buscarCorretorPorCpf, empreendimentosHabilitados } from "@/lib/publico/cad/dados";
import { anotarContexto } from "@/lib/publico/cad/log-erros";
import { cpfValido, normalizarCpf, resolverVinculo } from "@/lib/publico/cad/regras";
import {
  erro,
  json,
  lerCorpo,
  prepararRota,
  registrarBarreira,
  responder,
} from "@/lib/publico/cad/rotas";
import { emitirSessao } from "@/lib/publico/cad/sessao";

// S0 — o corretor se identifica pelo CPF. É a porta do formulário público.
//
// ⚠️ ZONA HOSTIL: rota anônima. O CPF vem no CORPO do POST, nunca em query string.
//
// "Não achou" NÃO é erro: é o convite ao cadastro. Palavras do Lucas: "ae abre para ele um
// formulário" — a tela não manda o corretor embora, ela oferece o cadastro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const preparo = await prepararRota(request, "identificacao");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const corpo = await lerCorpo<{ cpf?: string }>(request);
  const cpf = normalizarCpf(corpo?.cpf);

  // "Desde o início, quando informa o CPF" (Lucas). O CPF é do CORRETOR, nosso parceiro, e entra
  // MASCARADO — serve para achar quem travou, não para virar base de CPF.
  anotarContexto(request, { corretorCpf: cpf });

  // Validação de FORMA antes de qualquer I/O: é o que barra scanner burro de graça.
  if (!cpfValido(cpf)) {
    return responder(request, inicio, erro("Confira o CPF: parece que faltou um dígito."));
  }

  try {
    const corretor = await buscarCorretorPorCpf(adminClient, cpf);

    // Não cadastrado: segue para o auto-cadastro. A resposta é a MESMA forma do caminho
    // "conhecido mas sem imobiliária credenciada" — quem enumera não distingue os dois.
    if (!corretor) {
      return responder(request, inicio, json({ status: "novo" }));
    }

    anotarContexto(request, { corretorNome: corretor.nome });

    const vinculo = resolverVinculo(corretor.candidatos);
    if (!vinculo.ok) {
      // Corretor existe, mas a imobiliária dele não está credenciada (ou nunca esteve).
      // Terminal cordial: a tela NÃO diz o motivo — mas NÓS precisamos saber, porque este é o
      // corretor que ficou de fora com a imobiliária esperando credenciamento.
      registrarBarreira(request, "Corretor existe, mas a imobiliária dele não está credenciada.");
      return responder(request, inicio, json({ status: "central" }));
    }

    anotarContexto(request, {
      imobiliariaEntityId: vinculo.vinculo.imobiliariaEntityId,
      imobiliariaNome: vinculo.vinculo.imobiliariaNome,
    });

    const habilitados = await empreendimentosHabilitados(
      adminClient,
      vinculo.vinculo.imobiliariaEntityId,
    );
    if (!habilitados.length) {
      // Credenciada, mas sem nenhum empreendimento habilitado: é falha nossa de configuração, e o
      // corretor não tem como resolver do lado dele.
      registrarBarreira(
        request,
        "Imobiliária credenciada, mas sem nenhum empreendimento habilitado.",
      );
      return responder(request, inicio, json({ status: "sem-empreendimento" }));
    }

    const sessao = emitirSessao({
      corretorEmail: corretor.email,
      corretorEntityId: corretor.entityId,
      corretorNome: corretor.nome,
      // Só um empreendimento: já carimba a escolha no token e a tela pula a etapa.
      enterpriseId: habilitados.length === 1 ? String(habilitados[0]?.id) : undefined,
      enterpriseIds: habilitados.map((emp) => String(emp.id)),
      imobiliariaEntityId: vinculo.vinculo.imobiliariaEntityId,
      imobiliariaNome: vinculo.vinculo.imobiliariaNome,
      sessaoId: randomUUID(),
    });
    if (!sessao.ok) return responder(request, inicio, erro(sessao.error, 503));

    return responder(
      request,
      inicio,
      json({
        // Só o que a TELA precisa mostrar. Nenhum entityId sai daqui: um id vazado vira
        // handle para outra rota.
        empreendimentos: habilitados,
        imobiliaria: vinculo.vinculo.imobiliariaNome,
        nome: corretor.nome,
        sessao: sessao.token,
        status: "conhecido",
      }),
    );
  } catch {
    return responder(request, inicio, erro(undefined, 500));
  }
}
