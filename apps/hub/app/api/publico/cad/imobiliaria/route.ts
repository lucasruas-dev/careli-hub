import { consultarImobiliariaCredenciada } from "@/lib/publico/cad/dados";
import { cnpjValido, normalizarCnpj } from "@/lib/publico/cad/regras";
import { erro, json, lerCorpo, prepararRota, responder } from "@/lib/publico/cad/rotas";
import { emitirPreSessao } from "@/lib/publico/cad/sessao";

// S1 — "se o CNPJ passar, isso quer dizer que a imobiliária está credenciada com a gente"
// (palavras do Lucas). Esta rota responde SÓ isso.
//
// ⚠️ ORÁCULO DE ENUMERAÇÃO: a base de CNPJs do Brasil é pública, então esta rota permitiria
// mapear nossa rede de parceiros em uma tarde. As três contenções, todas obrigatórias:
//   1. teto por IP com atraso progressivo (prepararRota);
//   2. piso de latência (responder) — sem ele o "sim" e o "não" se distinguem pelo relógio;
//   3. resposta mínima: o nome só sai quando é `true`, e o entityId nunca sai (vai dentro de
//      um token assinado, que o browser não consegue ler nem forjar).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const preparo = await prepararRota(request, "imobiliaria");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const corpo = await lerCorpo<{ cnpj?: string }>(request);
  const cnpj = normalizarCnpj(corpo?.cnpj);

  if (!cnpjValido(cnpj)) {
    return responder(inicio, erro("Confira o CNPJ: parece que faltou um dígito."));
  }

  try {
    const consulta = await consultarImobiliariaCredenciada(adminClient, cnpj);
    if (!consulta.credenciada || !consulta.entityId) {
      return responder(inicio, json({ credenciada: false }));
    }

    const pre = emitirPreSessao({
      imobiliariaEntityId: consulta.entityId,
      imobiliariaNome: consulta.nome ?? "Imobiliária",
    });
    if (!pre.ok) return responder(inicio, erro(pre.error, 503));

    return responder(
      inicio,
      json({ credenciada: true, nome: consulta.nome, preSessao: pre.token }),
    );
  } catch {
    return responder(inicio, erro(undefined, 500));
  }
}
