import { autorizarEmissaoDeContrato } from "@/lib/temis/autorizacao";
import { consertarSignatario } from "@/lib/temis/assinatura-servico";
import { atorDoHub } from "@/lib/temis/ator";

// CONSERTAR UM SIGNATÁRIO DE ENVELOPE JÁ ENVIADO — reenviar o convite, ou trocar o e-mail dele.
//
//   POST { acao: "reenviar",     envelopeId, signerId }
//   POST { acao: "trocar_email", email, envelopeId, signerId }
//
// ⚠️ ISTO EXISTE PORQUE UMA ASSINATURA MORREU POR UMA LETRA. Medido em produção (12/09/2026,
// envelope `3e9a331d-ec2f-4eb5-9ae1-aafbeae8b395`): o contrato saiu para dois signatários, o
// endereço do segundo tinha uma letra a menos, e quatro segundos depois do envio a Clicksign
// registrou `HardBounce` / `550 5.1.1 ... does not exist`. A compradora assinou; o cônjuge nunca
// recebeu nada. Até aqui o único caminho era voltar o card para a análise e CANCELAR o envelope de
// produção — jogando fora a assinatura que já existia. Lucas (12/09/2026): *"teria que ter um forma
// de editarmos o e-mail e enviar o contrato dele somente"* e *"ocorre muito do e-mail esta correto
// mais o cliente nao recebeu, ae teria que ter um botao para reenviar o contrato"*.
//
// ⚠️ O PORTÃO É O DE EMITIR (`autorizarEmissaoDeContrato`), E NÃO O DE LEITURA. Nada aqui é
// consulta: `trocar_email` REMOVE uma pessoa de um envelope pago e põe outra no lugar, e
// `reenviar` manda e-mail em nome da vendedora para o comprador. É o mesmo recorte do envio, pelo
// mesmo motivo — mexer em envelope vivo é mais grave do que gerar um PDF na gaveta.
//
// ⚠️ E A FRASE DO SERVIDOR SOBE INTEIRA PARA A TELA, com o status que veio. É por ela que o
// operador sabe a diferença entre "esta pessoa já assinou, a Clicksign recusa removê-la" (o 403
// deles) e "espere um minuto" (o teto de ~1 notificação por minuto por endpoint). Trocar as duas
// por um "não consegui" faria a tela pedir para tentar de novo justamente no caso em que tentar de
// novo nunca vai funcionar.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB (16/09/2026). A validação e as duas ações moram em
// `consertarSignatario` (`lib/temis/assinatura-servico.ts`), a mesma função de
// `/api/incorporador/temis/assinatura/signatario`, que acrescenta só o recorte do envelope.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A troca de e-mail são até quatro chamadas HTTP em sequência (remover o signatário, criar o novo,
// os DOIS requisitos dele — assinar e autenticar por e-mail) e, no fim, a notificação. O teto alto
// é o que evita o "erro de JSON na tela" que um timeout da Vercel produz
// ([[reference_vercel_timeout_vira_erro_de_json]]) — e aqui ele seria pior do que de costume: as
// chamadas já feitas CONTINUAM feitas do lado da Clicksign.
export const maxDuration = 60;

export async function POST(request: Request) {
  const autorizacao = await autorizarEmissaoDeContrato(request);
  if (!autorizacao.ok) return autorizacao.response;

  return consertarSignatario(atorDoHub(autorizacao, "coordenacao"), request);
}
