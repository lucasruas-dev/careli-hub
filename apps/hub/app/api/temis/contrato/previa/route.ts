import { authorizeApoloRead } from "@/lib/apolo/auth";
import { previaDoContrato } from "@/lib/temis/contrato-servico";
import { atorDoHub } from "@/lib/temis/ator";

// A PRÉVIA DO CONTRATO — a minuta publicada mais os dados da proposta, preenchidos.
//
// Lucas, 08/09/2026: *"eu havia falado que deveria ter um campo para visualização do contrato
// preenchido, tipo uma prévia antes de enviar"*. E, na mesma manhã: *"garante então a construção
// para a gente emitir contratos, precisamos testar isso hoje"*.
//
// ⚠️ A PRÉVIA VEM ANTES DO PDF, E ANTES DE QUALQUER ENVIO. É o passo onde alguém confere se o
// contrato saiu certo — e é barato: HTML na tela, sem Chromium, sem gravar nada, sem gastar
// documento na plataforma de assinatura. Um contrato errado descoberto aqui custa um clique; o
// mesmo contrato descoberto depois de assinado custa um aditivo.
//
// ⚠️ ELA NÃO GRAVA NADA. Nenhuma linha em `temis_*`, nenhum arquivo no storage. Gerar prévia é uma
// LEITURA — e isso é o que permite gerá-la quantas vezes for preciso enquanto se ajusta a minuta,
// sem encher a base de rascunhos que ninguém vai olhar. Quem grava é
// `/api/temis/contrato/gerar`, e ele monta o contrato PELA MESMA FUNÇÃO — ver
// `lib/temis/contrato-da-proposta.ts`. É a única coisa que faz a conferência desta tela valer para
// o papel que sai do outro lado.
//
// ⚠️ E ELA DIZ O QUE FALTOU. `semValor` são as variáveis que o texto pedia e os dados não
// responderam; `avisos` são os dados que a proposta não tinha. As duas listas voltam para a tela
// porque a alternativa é a pessoa procurar `[cpf_cliente]` no meio de 50 mil caracteres — e porque
// `semValor` é o que BLOQUEIA a geração do documento do outro lado.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB (16/09/2026). A prévia inteira mora em `previaDoContrato`
// (`lib/temis/contrato-servico.ts`), a mesma função que o portal do incorporador chama por
// `/api/incorporador/temis/contrato/previa`. Aqui entra quem tem a leitura do Apolo, como sempre, e
// o ator do hub passa pelo recorte sem consulta nenhuma.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;

  return previaDoContrato(atorDoHub(autorizacao, "leitura"), request);
}
