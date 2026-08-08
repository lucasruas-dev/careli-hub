import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { jaEstaNoC2x } from "@/lib/apolo/c2x-alerta-board";
import type { ResultadoSubidaC2x } from "@/lib/apolo/c2x-envio-card";
import {
  envioEmVooC2x,
  hostDeDestino,
  MSG_ENVIO_EM_VOO,
  perfilDaFicha,
  processarLoteC2x,
} from "@/lib/apolo/c2x-write-server";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Sobe UMA CAD para o C2X. É o gatilho do botão dentro do card do Board.
//
// ⚠️ O MIOLO MUDOU (08/08) E O MOTIVO IMPORTA: antes esta rota chamava `enviarEntidadeParaC2x`
// CRUA. Chamada assim, direto do card, ela (a) esperava receber o `vinculedById` pronto no corpo —
// e sem ele devolve "Cliente sem imobiliária vinculada no C2X" para praticamente toda CAD — e (b)
// NÃO passava pelo diagnóstico de campos obrigatórios, ou seja, mandaria ficha incompleta direto
// para o C2X, que NÃO TEM DESFAZER (o endpoint é genérico: cada POST cria de novo).
//
// Agora o caminho é `processarLoteC2x({ apenasEntityId })` — o mesmo que o envio automático ao
// credenciar já usa (lib/apolo/credenciado-para-c2x.ts). Ele resolve a imobiliária, roda o
// diagnóstico, aplica as travas de identidade e devolve o HOST de destino. Uma regra só, num
// lugar só: quando ela mudar, muda para o lote, para o gancho de credenciar e para o botão.
//
// Autoriza pela sessão admin do hub OU pelo CRON_SECRET (Bearer), como as demais rotas do sync.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// ⚠️ TRAVA DE ENSAIO — O BOTÃO NASCE SIMULANDO.
//
// Criar cadastro no C2X não tem desfazer, e o histórico recente é feio: em 28/jul e 01/08 a env
// `C2X_WRITE_API_URL` apontava para o ambiente de TESTE e 8 cadastros "subiram com sucesso" para o
// lugar errado (é daí que vêm os 6 casos de "a API respondeu sucesso mas o usuário não foi
// encontrado"). Um botão novo, em 651 cards, não pode nascer disparando.
//
// Enquanto `C2X_ENVIO_CARD_LIBERADO` não for exatamente "true", esta rota roda o caminho INTEIRO
// (imobiliária, diagnóstico, travas, host de destino) em `dryRun` e devolve o que ACONTECERIA —
// sem tocar o C2X. A trava é do SERVIDOR de propósito: nenhum corpo de requisição a burla.
//
// Para liberar: conferir que `C2X_WRITE_API_URL` aponta para https://sistema.careli.adm.br (o host
// vem no `hostDestino` de toda resposta, dá para ver na própria tela) e só então ligar a env.
function envioLiberado(): boolean {
  return process.env.C2X_ENVIO_CARD_LIBERADO?.trim() === "true";
}

// POR QUE ESTA FICHA NÃO ENTROU NA FILA.
//
// O lote simplesmente ignora quem não é candidata — para ele, tanto faz. Para quem clicou um botão
// não: sem explicação, o clique parece ter se perdido e o time deixa de confiar na tela. Aqui a
// ausência ganha nome, na mesma ordem em que `processarLoteC2x` filtra as candidatas.
async function motivoForaDaFila(entityId: string): Promise<string> {
  const client = createApoloAdminClient();
  if (!client) return "Supabase indisponível para conferir esta ficha.";

  const { data } = await client
    .from("apolo_entities")
    .select("entity_kind, metadata")
    .eq("id", entityId)
    .single();
  if (!data) return "Ficha não encontrada no Apolo.";

  const linha = data as { entity_kind: string | null; metadata: Record<string, unknown> | null };
  const meta = linha.metadata ?? {};

  if (meta.source !== "apolo") {
    return "Esta ficha veio do próprio C2X (não nasceu no Apolo), então ela já existe lá — não há o que subir.";
  }
  if (perfilDaFicha(meta, linha.entity_kind) !== "cliente") {
    return "O papel desta ficha não sobe pela fila de CLIENTE do C2X (corretor, fornecedor, parceiro ou papel não identificado).";
  }
  if (!meta.cadastro) {
    return "Ficha sem cadastro preenchido: abra a CAD e complete o cadastro antes de subir.";
  }
  if (jaEstaNoC2x(meta)) {
    // O caso perigoso: `c2xSynced` foi carimbado, mas o cadastro nunca apareceu no banco do C2X
    // (escrita no ambiente errado). Reenviar pelo botão CRIARIA UM DUPLICADO em produção, então o
    // botão para aqui e a correção é manual, com o Lucas junto.
    return meta.c2xConfirmado === false
      ? "Esta ficha já está carimbada como enviada, mas sem confirmação no C2X (provável envio para o ambiente errado). Reenviar por aqui criaria um cadastro DUPLICADO: o desbloqueio é manual."
      : "Esta ficha já consta como sincronizada com o C2X.";
  }
  return "Esta ficha não entra na fila de envio para o C2X.";
}

// ⚠️ TRAVA DE ENVIO EM VOO — O SEGUNDO CLIQUE NÃO PODE VIRAR UM SEGUNDO CADASTRO.
//
// O botão do card se desabilita enquanto carrega, mas esse guard vive no ESTADO DO COMPONENTE, e
// esse estado é frágil de propósitos legítimos: some quando o operador troca o Board de kanban
// para tabela, quando um filtro tira e devolve o card, quando ele recarrega a página — e nunca
// existiu para o colega que está olhando o MESMO card em outra máquina. Enquanto isso a requisição
// continua viajando: o envio real fala com Supabase, com o MySQL do C2X e com a API Rails.
//
// ⚠️ A REGRA MORA NO `enviarEntidadeParaC2x` (c2x-write-server.ts), NÃO AQUI. Esta rota não é o
// único disparador de envio REAL: `esteira.ts` (etapa vira "credenciado") e `prevenda-fluxo.ts`
// (PIX confirmado, best-effort que PARA DE ESPERAR em 8s e deixa o envio no ar) chamam o lote
// direto. Uma trava só de rota deixaria passar justamente a colisão mais provável — o clique no
// card enquanto o envio do PIX ainda viaja. Aqui a checagem é só o ATALHO: pega o caso comum antes
// de gastar MySQL do C2X, montagem de payload e leitura do contrato social no Storage, e devolve
// uma frase que o operador entende. A palavra final é a de lá.
async function envioEmVoo(entityId: string): Promise<boolean> {
  const client = createApoloAdminClient();
  if (!client) return false;
  return envioEmVooC2x(client, entityId);
}

function autorizadoPorSecret(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && token === secret);
}

export async function POST(request: NextRequest) {
  if (!autorizadoPorSecret(request)) {
    const auth = await authorizeApoloWrite(request);
    if (!auth.ok) return auth.response;
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    ensaio?: boolean;
    entityId?: string;
  };

  if (!corpo.entityId) {
    return NextResponse.json({ error: "Informe entityId." }, { status: 400 });
  }

  // Sem a liberação do servidor é SEMPRE ensaio. Com ela, o padrão passa a ser envio de verdade —
  // e quem quiser só simular pede `ensaio: true`.
  const ensaio = !envioLiberado() || corpo.ensaio === true;

  // Só o envio DE VERDADE precisa da trava: o ensaio não toca o C2X, então repeti-lo é inofensivo.
  if (!ensaio && (await envioEmVoo(corpo.entityId))) {
    const jaEmVoo: ResultadoSubidaC2x = {
      ensaio: false,
      entityId: corpo.entityId,
      // A MESMA frase do servidor (c2x-write-server.ts): o atalho da rota e a trava de verdade não
      // podem dizer coisas diferentes sobre o mesmo estado.
      erro: MSG_ENVIO_EM_VOO,
      faltantes: [],
      hostDestino: hostDeDestino(),
      status: "erro",
    };
    return NextResponse.json({ data: jaEmVoo });
  }

  const resultado = await processarLoteC2x({
    apenasEntityId: corpo.entityId,
    dryRun: ensaio,
    // Uma ficha por vez, nas duas pontas: `limit` corta a leitura, `maxEnvios` corta o envio real.
    limit: 1,
    maxEnvios: 1,
  });

  const item = resultado.itens[0];
  const data: ResultadoSubidaC2x = item
    ? {
        divergencias: item.divergencias,
        ensaio,
        entityId: item.entityId,
        erro: item.erro,
        faltantes: item.faltantes,
        hostDestino: resultado.hostDestino,
        status: item.status,
      }
    : {
        ensaio,
        entityId: corpo.entityId,
        erro: await motivoForaDaFila(corpo.entityId),
        faltantes: [],
        hostDestino: resultado.hostDestino,
        status: "ausente",
      };

  return NextResponse.json({ data });
}
