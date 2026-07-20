import { randomUUID } from "node:crypto";

import { criarCorretor, empreendimentosHabilitados } from "@/lib/publico/cad/dados";
import { validarCorretor, type DadosCorretor } from "@/lib/publico/cad/regras";
import { erro, json, lerCorpo, prepararRota, responder } from "@/lib/publico/cad/rotas";
import { emitirSessao, preSessaoDoRequest } from "@/lib/publico/cad/sessao";

// S4 — cria o corretor e abre a sessão. "Pronto, cadastrado. Agora pode subir CAD."
//
// A imobiliária vem da PRÉ-SESSÃO assinada, não do corpo: o anônimo não escolhe a que
// imobiliária se vincula, ele só prova que passou por um CNPJ credenciado em S1.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const pre = preSessaoDoRequest(request);
  if (!pre.ok) {
    return erro("Confirme o CNPJ da imobiliária antes de continuar.", 403);
  }

  const preparo = await prepararRota(request, "identificacao");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const corpo = await lerCorpo<Partial<DadosCorretor>>(request);
  const validacao = validarCorretor(corpo ?? {});
  if (!validacao.ok) {
    return responder(inicio, erro(validacao.erros.join(" ")));
  }

  try {
    const criado = await criarCorretor(adminClient, {
      dados: validacao.dados,
      imobiliariaEntityId: pre.pre.imobiliariaEntityId,
      imobiliariaNome: pre.pre.imobiliariaNome,
    });
    if (!criado.ok) return responder(inicio, erro(undefined, 500));

    const habilitados = await empreendimentosHabilitados(
      adminClient,
      pre.pre.imobiliariaEntityId,
    );
    if (!habilitados.length) {
      // Cadastro FEITO, mas sem empreendimento aberto para envio. A tela diz isso com todas
      // as letras (é o único "não" do fluxo que tem motivo explicável sem vazar nada).
      return responder(inicio, json({ status: "sem-empreendimento" }));
    }

    const sessao = emitirSessao({
      corretorEmail: validacao.dados.email,
      corretorEntityId: criado.entityId,
      corretorNome: validacao.dados.nome,
      enterpriseId: habilitados.length === 1 ? String(habilitados[0]?.id) : undefined,
      enterpriseIds: habilitados.map((emp) => String(emp.id)),
      imobiliariaEntityId: pre.pre.imobiliariaEntityId,
      imobiliariaNome: pre.pre.imobiliariaNome,
      sessaoId: randomUUID(),
    });
    if (!sessao.ok) return responder(inicio, erro(sessao.error, 503));

    return responder(
      inicio,
      json({
        empreendimentos: habilitados,
        imobiliaria: pre.pre.imobiliariaNome,
        nome: validacao.dados.nome,
        sessao: sessao.token,
        status: "cadastrado",
      }),
    );
  } catch {
    return responder(inicio, erro(undefined, 500));
  }
}
