// Helpers comuns das rotas de /api/publico/*.
//
// Existem para que TODA resposta pública saia com a mesma forma: no-store, erro genérico e
// uniforme, e nenhum id interno vazando. Três mensagens de erro diferentes ("CNPJ inválido" x
// "não credenciado" x "suspensa") são três bits de informação para quem está enumerando.
import { after, NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  type ContextoDaTentativa,
  contextoDoRequest,
  registrarErroPublico,
} from "@/lib/publico/cad/log-erros";
import { comPisoDeLatencia, consumir, chaveDoRequest, type Balde } from "@/lib/publico/cad/rate-limit";

export const NO_STORE = { "Cache-Control": "no-store" } as const;

// A única mensagem de falha que o público vê. Diz o que fazer, não o que quebrou.
export const ERRO_GENERICO =
  "Não conseguimos concluir agora. Tente novamente em alguns instantes ou fale com a nossa central.";

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { headers: NO_STORE, status });
}

export function erro(mensagem = ERRO_GENERICO, status = 400): NextResponse {
  return json({ error: mensagem }, status);
}

export type PreparoResultado =
  | { ok: false; response: NextResponse }
  | { adminClient: NonNullable<ReturnType<typeof createApoloAdminClient>>; inicio: number; ok: true };

// Abre a rota: aplica o teto de uso e devolve o client. Toda rota pública começa por aqui.
export async function prepararRota(
  request: Request,
  balde: Balde,
): Promise<PreparoResultado> {
  const inicio = Date.now();
  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    // ⚠️ REGISTRA AQUI, e não na rota. As 14 rotas fazem `return preparo.response` direto, sem
    // passar por `responder()`/`recusar()` — então tudo que sai deste ponto escapava do log. E o
    // que sai daqui é exatamente o incidente: Supabase fora do ar derrubando o cadastro público
    // inteiro, com a tela do Log Erros dizendo "nenhuma tentativa recusada".
    registrarBarreira(request, "Supabase indisponível: o cadastro público não abriu.", {}, 503);
    return { ok: false, response: erro(ERRO_GENERICO, 503) };
  }

  const veredito = await consumir(adminClient, balde, chaveDoRequest(request));
  if (!veredito.permitido) {
    // Teto de uso batido. É o sinal de "alguém tentou muitas vezes seguidas" — pode ser varredura,
    // mas é também o corretor legítimo insistindo num formulário que não aceita a ficha dele.
    registrarBarreira(request, `Teto de tentativas atingido (${balde}).`, {}, 429);
    return {
      ok: false,
      response: json(
        {
          error:
            "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo, ou fale com a nossa central.",
        },
        429,
      ),
    };
  }
  if (veredito.esperaMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, veredito.esperaMs));
  }

  return { adminClient, inicio, ok: true };
}

// Achata a latência antes de responder (ver PISO_LATENCIA_MS) e REGISTRA a recusa.
//
// ⚠️ TODA RECUSA DO PÚBLICO PASSA POR AQUI, e é por isso que o log entra neste ponto: são 14 rotas
// e 85 `return erro(...)` espalhados, desde a tela do CPF até o salvar. Instrumentar um a um
// deixaria buracos e nunca ficaria completo.
//
// O registro é BEST-EFFORT e não segura a resposta: o corretor não pode esperar por causa de
// observabilidade. Se o log falhar, a requisição segue normal.
//
// ⚠️ VIA `after()`, NUNCA `void promise`. Na Vercel a função é CONGELADA assim que a resposta sai —
// uma promessa solta simplesmente não termina, e o insert some. A tela mostraria "nenhuma tentativa
// recusada" com o formulário quebrando na cara do corretor: um zero que parece boa notícia e é só
// log perdido. `after()` é o contrato do Next para "roda depois de responder, mas roda".
export async function responder(
  request: Request,
  inicio: number,
  response: NextResponse,
  contexto?: ContextoDaTentativa,
): Promise<NextResponse> {
  await registrarSeRecusa(request, response, Date.now() - inicio, contexto);
  return comPisoDeLatencia(inicio, response);
}

/**
 * Registra uma recusa que acontece ANTES do `prepararRota` — sessão expirada, corpo vazio, escolha
 * de empreendimento não habilitado.
 *
 * ⚠️ EXISTE PORQUE O PEDIDO É "DESDE O INÍCIO". Essas saídas ficam nas primeiras linhas do handler,
 * fora do caminho do `responder()`, e são justamente as que o corretor mais encontra: o link que
 * expirou, o empreendimento que a imobiliária não trabalha. Deixá-las de fora faria a tela mostrar
 * só o miolo do fluxo e dar a impressão de que a entrada está saudável.
 *
 * Sem piso de latência: aqui não houve consulta ao banco, então não há tempo de resposta a achatar.
 */
export async function recusar(
  request: Request,
  response: NextResponse,
  contexto?: ContextoDaTentativa,
): Promise<NextResponse> {
  await registrarSeRecusa(request, response, null, contexto);
  return response;
}

/**
 * Registra uma parede que NÃO passa por `responder()`/`recusar()`.
 *
 * ⚠️ NEM TODA PAREDE É UM ERRO HTTP, e as maiores não são. O corretor cuja imobiliária não está
 * credenciada recebe `status: "central"` com HTTP 200; o que não tem empreendimento habilitado
 * recebe `status: "sem-empreendimento"`, também 200. Os dois acabaram ali — não conseguiram
 * cadastrar ninguém. Se o log olhasse só para status ≥400, a tela mostraria "tudo certo" enquanto
 * a porta de entrada devolve gente todo dia. É o lead perdido que o Lucas pediu para enxergar.
 *
 * ⚠️ TAMBÉM COBRE O 429 E O 503 do `prepararRota`. As 14 rotas fazem `return preparo.response`
 * direto, sem passar pelo caminho do log — então teto de uso batido e Supabase fora do ar saíam
 * invisíveis, justamente nos dois incidentes em que a tela mais precisaria falar.
 *
 * `status` é o HTTP real, para a tela distinguir a parede silenciosa (200) do erro visível.
 */
export function registrarBarreira(
  request: Request,
  motivo: string,
  contexto?: ContextoDaTentativa,
  status = 200,
): void {
  agendarRegistro({
    contexto: { ...contextoDoRequest(request), ...contexto },
    duracaoMs: null,
    mensagem: motivo,
    origemHash: chaveDoRequest(request),
    request,
    status,
  });
}

/**
 * Enfileira o registro para depois da resposta.
 *
 * ⚠️ O `after()` VAI DENTRO DE TRY. Ele exige contexto de requisição e lança fora dele (script,
 * teste, chamada em outro runtime). Sem esta blindagem, uma exceção do LOG derrubaria a resposta
 * do corretor — o inverso exato da regra que este arquivo inteiro segue: observabilidade nunca
 * pode quebrar o fluxo que ela observa.
 */
function agendarRegistro(input: Parameters<typeof registrarErroPublico>[0]): void {
  try {
    after(registrarErroPublico(input));
  } catch {
    // Sem contexto de requisição: o registro se perde, a resposta segue normal.
  }
}

async function registrarSeRecusa(
  request: Request,
  response: NextResponse,
  duracaoMs: null | number,
  contexto?: ContextoDaTentativa,
): Promise<void> {
  if (response.status < 400) return;

  const juntos = { ...contextoDoRequest(request), ...contexto };

  // ⚠️ O MOTIVO CANÔNICO GANHA DA MENSAGEM. Quando a rota declara um motivo, é porque a mensagem
  // devolvida ao público carrega dado de terceiro (nome de cliente no conflito de núcleo familiar,
  // imobiliária concorrente no conflito de vínculo). O público continua vendo o texto completo; o
  // log guarda só a categoria. Ver `ContextoDaTentativa.motivo`.
  //
  // ⚠️ O CORPO É LIDO AGORA, e não dentro do `after`. O clone tem que ser consumido enquanto o
  // stream ainda está de pé; adiar a leitura para depois da resposta esvazia o corpo e a linha
  // entraria sem a mensagem, que é justamente o que o operador vai ler.
  const mensagem = juntos.motivo?.trim() || (await mensagemDaResposta(response));

  agendarRegistro({
    // O contexto anotado pela rota (`anotarContexto`) é a base; o passado aqui, quando existe,
    // refina o caso pontual.
    contexto: juntos,
    duracaoMs,
    mensagem,
    origemHash: chaveDoRequest(request),
    request,
    status: response.status,
  });
}

/** A mensagem que a pessoa VIU. É ela que responde "por que não consegui". */
async function mensagemDaResposta(response: NextResponse): Promise<null | string> {
  try {
    const corpo: unknown = await response.clone().json();
    if (corpo && typeof corpo === "object" && "error" in corpo) {
      return String((corpo as { error?: unknown }).error ?? "") || null;
    }
    return null;
  } catch {
    // Corpo não-JSON (ou já consumido): a linha entra sem mensagem, com o status.
    return null;
  }
}

export async function lerCorpo<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
