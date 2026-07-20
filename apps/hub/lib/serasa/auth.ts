// Token da API de Crédito do Serasa, com cache.
//
// A documentação é explícita: o token vale 60 MINUTOS e eles recomendam reaproveitar em vez de
// gerar um por consulta. Gerar sempre também é risco operacional: em homologação existe teto
// de 200 chamadas/dia por IP, e o login provavelmente conta nesse teto.
//
// O cache é por INSTÂNCIA do processo (serverless: cada lambda tem o seu). Isso é aceitável e
// já economiza a maior parte das chamadas; um cache compartilhado exigiria KV/Redis e não vale
// a complexidade agora.
import { type ConfigSerasa } from "@/lib/serasa/config";

type TokenCache = { expiraEm: number; token: string };

// Chave = authUrl + clientId, para o cache não vazar entre homologação e produção caso as duas
// configurações coexistam num mesmo processo.
const cache = new Map<string, TokenCache>();

// Renova aos 55 minutos, não aos 60. A margem existe porque o nome do campo de expiração da
// resposta NÃO está confirmado na documentação (só `accessToken` está), então não dá para
// confiar no valor devolvido pela API — assumimos os 60 minutos documentados e tiramos 5.
const VALIDADE_MS = 55 * 60 * 1000;

export type ResultadoToken =
  | { erro: string; ok: false; status?: number }
  | { ok: true; token: string };

export async function obterToken(
  config: ConfigSerasa,
  opcoes?: { forcarNovo?: boolean },
): Promise<ResultadoToken> {
  const chave = `${config.authUrl}|${config.clientId}`;
  const agora = Date.now();
  const guardado = cache.get(chave);

  if (!opcoes?.forcarNovo && guardado && guardado.expiraEm > agora) {
    return { ok: true, token: guardado.token };
  }

  // HTTP Basic com clientId:clientSecret. É o único lugar onde a credencial é usada; as
  // consultas levam apenas o Bearer.
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");

  let resposta: Response;
  try {
    resposta = await fetch(config.authUrl, {
      cache: "no-store",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch (erro) {
    return { erro: `Falha de rede ao autenticar: ${(erro as Error).message}`, ok: false };
  }

  if (!resposta.ok) {
    // A documentação lista três causas: credencial de um ambiente usada no outro, credencial
    // inconsistente e token quebrado. A primeira é a mais provável e a mais cara de descobrir
    // tarde, então ela vai citada na mensagem.
    const corpo = await resposta.text().catch(() => "");
    return {
      erro:
        `Serasa recusou a autenticacao (HTTP ${resposta.status}). Verifique se a credencial ` +
        `e do mesmo ambiente da URL configurada. ${corpo.slice(0, 200)}`,
      ok: false,
      status: resposta.status,
    };
  }

  const json = (await resposta.json().catch(() => ({}))) as Record<string, unknown>;

  // `accessToken` (camelCase) é o único nome confirmado na documentação. Os outros entram como
  // tolerância: se o Serasa devolver noutro formato, a integração não quebra silenciosamente.
  const token =
    (typeof json.accessToken === "string" && json.accessToken) ||
    (typeof json.access_token === "string" && json.access_token) ||
    (typeof json.token === "string" && json.token) ||
    "";

  if (!token) {
    return {
      erro: `Autenticacao respondeu ${resposta.status} mas sem token reconhecivel no corpo.`,
      ok: false,
      status: resposta.status,
    };
  }

  cache.set(chave, { expiraEm: agora + VALIDADE_MS, token });
  return { ok: true, token };
}

// Só para teste: limpa o cache entre casos.
export function limparCacheToken(): void {
  cache.clear();
}
