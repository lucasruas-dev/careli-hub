import { autorizarEmissaoDeContrato } from "@/lib/temis/autorizacao";
import { enviarContratoDoAtor, preparoDoEnvio } from "@/lib/temis/assinatura-servico";
import { atorDoHub } from "@/lib/temis/ator";

// MANDAR O CONTRATO PARA ASSINATURA — o passo depois de gerar.
//
//   GET  ?proposta=…   o que vai ser enviado: quem assina, em que ordem, e o que impede.
//   POST               envia de verdade.
//
// ⚠️ O GET EXISTE PARA QUE NINGUÉM DESCUBRA DEPOIS DE CLICAR. A conta da Clicksign é de PRODUÇÃO
// (Lucas, 08/09/2026 — o sandbox deles está com problema), cada envelope tem custo e, uma vez
// ativado, NÃO SE APAGA. A tela mostra a lista de signatários, a ordem e a origem dela ANTES de
// existir envelope; sem isso, o primeiro clique seria também a primeira conferência.
//
// ⚠️ O POST USA O MESMO PORTÃO DE EMITIR CONTRATO (`autorizarEmissaoDeContrato`), e não a leitura.
// Mandar para assinatura é mais grave do que gerar: gerar produz um PDF numa gaveta, enviar põe o
// documento na mão do comprador e começa a contar prazo. O GET fica no mesmo recorte de propósito —
// ele lista e-mail de comprador e cônjuge, que é dado de pessoa, e quem não pode enviar não precisa
// da lista.
//
// ⚠️ E A RESPOSTA DIZ QUAL AMBIENTE. Um contrato assinado no sandbox não tem validade jurídica, e a
// API responde 200 igual nos dois. O aviso viaja junto para a tela poder gritar.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB (16/09/2026). Preparar e enviar moram em `preparoDoEnvio` e
// `enviarContratoDoAtor` (`lib/temis/assinatura-servico.ts`), as mesmas funções de
// `/api/incorporador/temis/assinatura/enviar` — mesma conta da Clicksign, mesma guarda contra o
// segundo envelope. O nome de quem enviou vem do portão (`ApoloAuthResult.nome`).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// O envio são até 16 chamadas HTTP (1 envelope + 1 upload + 2 por signatário + ativar + notificar),
// e o upload leva o PDF inteiro em base64. O teto alto é o que evita o "erro de JSON na tela" que um
// timeout da Vercel produz.
export const maxDuration = 120;

export async function GET(request: Request) {
  const autorizacao = await autorizarEmissaoDeContrato(request);
  if (!autorizacao.ok) return autorizacao.response;

  return preparoDoEnvio(atorDoHub(autorizacao, "coordenacao"), request);
}

export async function POST(request: Request) {
  const autorizacao = await autorizarEmissaoDeContrato(request);
  if (!autorizacao.ok) return autorizacao.response;

  return enviarContratoDoAtor(atorDoHub(autorizacao, "coordenacao"), request);
}
