import {
  autorizarEmissaoDeContrato,
  autorizarLeituraDeContrato,
} from "@/lib/temis/autorizacao";
import {
  abrirCardDoTrabalho,
  atorDoHub,
  decidirSobreOTrabalho,
} from "@/lib/temis/trabalho-servico";

// A TELA DE TRABALHO DE UM CARD — o que abre quando o operador clica no quadro.
//
// Lucas (09/09/2026): *"ao clicar no card abrisse uma tela de trabalho. primeiro, na primeira
// etapa, acho que deveria trazer os dados dos proponentes, imobiliaria, a proposta"*.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB. Abrir o card (`abrirCardDoTrabalho`) e decidir sobre ele
// (`decidirSobreOTrabalho`: indeferir e voltar para análise, com o envelope da Clicksign) moram em
// `lib/temis/trabalho-servico.ts`, e são as mesmas funções que `/api/incorporador/temis/trabalho`
// chama com o ator do portal.
//
// ⚠️ LER É LEITURA, DECIDIR É COORDENAÇÃO. O GET usa `autorizarLeituraDeContrato` (a mesma régua
// de quem abre um contrato já gerado); o POST usa `autorizarEmissaoDeContrato`, que é o recorte
// estreito da coordenação — as duas ações que ele expõe mexem no caminho do trabalho e devolvem o
// processo a quem vendeu, então não são ato de quem só consulta.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// `dadosDaProposta` faz ~10 consultas ao Supabase. Folga para o pior caso.
//
// ⚠️ 60 PORQUE HÁ CHAMADA EXTERNA NO CAMINHO. Voltar um card de "em assinatura" CANCELA o envelope
// na Clicksign, e o cliente dela espera até 15 s por chamada (`lib/assinatura/clicksign/cliente.ts`).
// Com 30, uma Clicksign lenta somada às leituras do card acabaria cortada pela Vercel — e o corte
// cairia no pior lugar: ninguém saberia se o envelope morreu antes de a função ser morta.
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await autorizarLeituraDeContrato(request);
  if (!auth.ok) return auth.response;

  // ⚠️ `podeEmitir` CONTINUA SENDO A RÉGUA DA COORDENAÇÃO, perguntada DEPOIS de o card ser lido
  // (a função só a chama no fim): sem isto, o painel de assinatura nasceria mostrando recusa para
  // todo leitor que abrisse um card. É uma segunda checagem, não uma segunda trava.
  return abrirCardDoTrabalho(atorDoHub(auth, "leitura"), request, {
    podeEmitir: async () => (await autorizarEmissaoDeContrato(request)).ok,
  });
}

export async function POST(request: Request) {
  const auth = await autorizarEmissaoDeContrato(request);
  if (!auth.ok) return auth.response;

  return decidirSobreOTrabalho(atorDoHub(auth, "coordenacao"), request);
}
