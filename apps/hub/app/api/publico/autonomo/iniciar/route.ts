import {
  MENSAGEM_DO_PORTAO,
  situacaoDoCpf,
} from "@/lib/apolo/autonomo-do-link";
import { cpfValido } from "@/lib/apolo/documento";
import { anotarContexto } from "@/lib/publico/cad/log-erros";
import { normalizarCpf } from "@/lib/publico/cad/regras";
import { erro, json, lerCorpo, prepararRota, responder } from "@/lib/publico/cad/rotas";
import { assinarPreSessaoAutonomo } from "@/lib/publico/cad/sessao";

// O PORTÃO DO LINK DO CORRETOR AUTÔNOMO: confere o CPF e emite a pré-sessão que destrava o wizard.
//
// É o espelho de /api/publico/imobiliaria/iniciar. POR QUE PRECISA EXISTIR: o wizard que vem depois
// lê o documento (OCR) e enriquece o CPF, duas torneiras PAGAS, e a regra de ouro exige sessão para
// qualquer torneira paga. O token sai daqui amarrado ao CPF conferido (anti-troca no /cadastro).
//
// ⚠️ A RESPOSTA NÃO TEM DADO DE NINGUÉM. O portão da imobiliária devolve o nome da empresa, que é
// público; aqui é uma PESSOA, e a resposta diz só o estado ("já é autônomo", "em análise") para quem
// digitou saber o que fazer. Nunca nome, e-mail, telefone ou id de ficha. O balde `autonomo` do
// limite de tentativas segura quem tenta varrer CPFs.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const preparo = await prepararRota(request, "autonomo");
  if (!preparo.ok) return preparo.response;
  const { adminClient, inicio } = preparo;

  const corpo = await lerCorpo<{ cpf?: string }>(request);
  const cpf = normalizarCpf(corpo?.cpf);

  // Entra MASCARADO no log (a tela Log Erros mostra o passo em que a pessoa travou).
  anotarContexto(request, { corretorCpf: cpf });

  if (!cpfValido(cpf)) {
    return responder(request, inicio, erro("Confira o CPF: parece que algum número está trocado."));
  }

  try {
    const lido = await situacaoDoCpf(adminClient, cpf);
    if (!lido.ok) return responder(request, inicio, erro(undefined, 503));

    if (lido.situacao !== "liberado") {
      // 200 e não erro: não é falha, é o fim do caminho para este CPF. Ver `registrarBarreira`, que é
      // como a tela Log Erros enxerga parede silenciosa; aqui não registramos, porque "já é autônomo"
      // e "em análise" não são lead perdido.
      return responder(
        request,
        inicio,
        json({ mensagem: MENSAGEM_DO_PORTAO[lido.situacao], status: lido.situacao }),
      );
    }

    const pre = assinarPreSessaoAutonomo({ cpf });
    if (!pre.ok) return responder(request, inicio, erro(pre.error, 503));

    return responder(request, inicio, json({ preSessao: pre.token, status: "ok" }));
  } catch {
    return responder(request, inicio, erro(undefined, 500));
  }
}
