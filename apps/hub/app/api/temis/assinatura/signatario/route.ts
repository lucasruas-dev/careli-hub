import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { autorizarEmissaoDeContrato } from "@/lib/temis/autorizacao";
import { reenviarConvite, trocarEmailDoSignatario } from "@/lib/temis/trocar-signatario";

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

  const corpo = (await request.json().catch(() => ({}))) as {
    acao?: unknown;
    email?: unknown;
    envelopeId?: unknown;
    signerId?: unknown;
  };

  const envelopeId = texto(corpo.envelopeId);
  const signerId = texto(corpo.signerId);
  if (!envelopeId) return NextResponse.json({ erro: "Sem envelope." }, { status: 400 });
  if (!signerId) return NextResponse.json({ erro: "Sem signatário." }, { status: 400 });

  // ⚠️ O SUPABASE NÃO É ENFEITE NESTA ROTA, E NÃO DÁ PARA PULÁ-LO. As duas ações leem
  // `temis_envelopes` pelo `envelope_id` ANTES de falar com a Clicksign, e é essa leitura que prova
  // que o id vindo do navegador é de um envelope NOSSO. A conta da Clicksign é de PRODUÇÃO, com
  // contratos de outras vendas dentro: sem esse filtro, um id trocado no corpo do POST removeria um
  // signatário do contrato de outra pessoa.
  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  if (corpo.acao === "reenviar") {
    const reenvio = await reenviarConvite(sb, { envelopeId, signerId });
    if (!reenvio.ok) {
      return NextResponse.json({ erro: reenvio.erro }, { status: reenvio.status });
    }
    return NextResponse.json({ data: { aviso: null, signerId } });
  }

  if (corpo.acao === "trocar_email") {
    const email = texto(corpo.email);
    // ⚠️ CONFERIDO AQUI ANTES DE SAIR DAQUI, e o motivo é o que a ação faz: o primeiro passo da
    // troca é REMOVER a pessoa do envelope. Um endereço vazio ou torto vindo do navegador tiraria
    // o signatário e falharia no passo seguinte, deixando o envelope de produção com uma pessoa a
    // menos e ninguém para assinar no lugar dela.
    //
    // ⚠️ A REGRA É SIMPLES DE PROPÓSITO, a mesma do envio (`lerEmailsEscolhidos`, na rota
    // `enviar`): quem valida e-mail de verdade é a Clicksign, e uma regex ambiciosa aqui recusaria
    // endereço legítimo (`+`, subdomínio, TLD longo).
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ erro: "Informe um e-mail válido." }, { status: 400 });
    }

    const troca = await trocarEmailDoSignatario(sb, { email, envelopeId, signerId });

    if (!troca.ok) {
      // ⚠️ `removido` SOBE JUNTO COM O ERRO, e é a diferença entre duas falhas que não se parecem em
      // nada: antes da remoção o envelope está inteiro e ninguém perdeu nada; depois dela há uma
      // pessoa FORA de um contrato que não fecha mais sozinho. A frase de `erro` já conta a
      // história, mas a bandeira é o que permite à tela pintar o desfecho grave de outro jeito.
      return NextResponse.json({ erro: troca.erro, removido: troca.removido }, { status: troca.status });
    }

    // ⚠️ `aviso` NÃO É ERRO, E RESPONDER 200 AQUI É O PONTO. Ele é "a troca foi feita, mas o convite
    // não saiu" (o teto de envio da Clicksign) ou "o nosso registro não atualizou": nos dois casos o
    // signatário novo JÁ ESTÁ no envelope, com os dois requisitos, e pode assinar. Devolver erro
    // faria o operador clicar em trocar de novo — e o segundo clique REMOVERIA quem acabou de
    // entrar, que é exatamente o estrago que esta rota existe para evitar.
    //
    // ⚠️ E O `signerId` QUE VOLTA É O NOVO: o antigo deixou de existir no envelope. A tela não
    // depende dele (ela recarrega o card e relê a lista), mas é o número que o suporte da Clicksign
    // pede quando alguma coisa não bate — e não dá para pescá-lo depois.
    return NextResponse.json({
      data: { aviso: troca.aviso, email: troca.email, nome: troca.nome, signerId: troca.signerId },
    });
  }

  return NextResponse.json({ erro: "Ação desconhecida." }, { status: 400 });
}

/** Campo de texto do corpo, já aparado. Qualquer outra coisa vira string vazia. */
function texto(bruto: unknown): string {
  return typeof bruto === "string" ? bruto.trim() : "";
}
