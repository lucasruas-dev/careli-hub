import { empreendimentosHabilitados } from "@/lib/publico/cad/dados";
import { erro, json, lerCorpo, prepararRota, responder } from "@/lib/publico/cad/rotas";
import { comEmpreendimento, sessaoDoRequest } from "@/lib/publico/cad/sessao";

// S5 — "só vai aparecer para ele os empreendimentos que a imobiliária está habilitada a
// trabalhar" (palavras do Lucas).
//
// GET lista; POST registra a escolha no token.
//
// ⚠️ O GET NÃO ACEITA PARÂMETRO. A imobiliária sai da sessão assinada, então não há id em
// query string e não há como pedir a lista de outra imobiliária. É também por isso que a
// lista nunca revela o total de empreendimentos ativos: só o recorte desta imobiliária.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);
  if (!sessao.ok) return erro("Sua sessão expirou. Informe o CPF novamente.", 401);

  const preparo = await prepararRota(request, "identificacao");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  try {
    const habilitados = await empreendimentosHabilitados(
      adminClient,
      sessao.sessao.imobiliariaEntityId,
    );
    return responder(inicio, json({ empreendimentos: habilitados }));
  } catch {
    return responder(inicio, erro(undefined, 500));
  }
}

export async function POST(request: Request) {
  const sessao = sessaoDoRequest(request);
  if (!sessao.ok) return erro("Sua sessão expirou. Informe o CPF novamente.", 401);

  const corpo = await lerCorpo<{ enterpriseId?: string }>(request);
  const escolhido = String(corpo?.enterpriseId ?? "").trim();
  if (!escolhido) return erro("Escolha um empreendimento para continuar.");

  // A validação real mora em `comEmpreendimento`: ele só aceita id que esteja na lista que o
  // SERVIDOR calculou e carimbou no token. Confiar no id que o cliente mandou seria deixar o
  // corretor subir CAD onde a imobiliária dele não está habilitada.
  const novo = comEmpreendimento(sessao.sessao, escolhido);
  if (!novo.ok) return erro(novo.error, 403);

  return json({ ok: true, sessao: novo.token });
}
