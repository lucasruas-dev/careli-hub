import { NextResponse } from "next/server";

import {
  carregarIncorporadorPorSlug,
  escopoDaConta,
  usuarioIncorporadorSegueAtivo,
} from "@/lib/apolo/incorporador/dados";
import { autorizar, foraDoEscopo, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { portalConfeccionaContrato } from "@/lib/apolo/incorporador/perfis-de-portal";
import type { SessaoIncorporador } from "@/lib/apolo/incorporador/sessao";

import type { AtorDoPortal } from "./ator";

// A PORTA DA TÊMIS PARA QUEM VEM DO PORTAL — toda rota `/api/incorporador/temis/**` passa aqui.
//
// Decisões do Lucas (16/09/2026): a equipe da Cecílio gera o contrato, manda assinar (Clicksign da
// conta da Careli, com registro de quem enviou) e *"também edita os modelos"* dos produtos dela.
// As rotas `/api/temis/*` exigem o Bearer do hub e NENHUMA confere escopo de empreendimento: o
// jurídico da Careli enxerga tudo por desenho. Abrir aquelas rotas para o cookie do portal
// entregaria a Têmis inteira a quem é de fora. Por isso a porta é OUTRA, e o que ela devolve é um
// ATOR (`ator.ts`) que a mesma função de `lib/` usa para recortar.
//
// ⚠️ A ORDEM É A DO CUSTO, DO MAIS BARATO AO MAIS CARO, E NENHUM PASSO PULA O ANTERIOR:
//   1. sessão válida (cookie assinado, sem banco)             → 401 sem ela;
//   2. `portalConfeccionaContrato(slug, tipo)` (lista no código) → 404 fora dela;
//   3. o incorporador no cadastro, pelo slug, e a CONTA do usuário → 404 inativo ou divergente;
//   4. o escopo FRESCO da conta, cruzado com o do cookie        → 404 se não sobrar nada;
//   5. a expansão dos empreendimentos (catálogo do C2X).
// O portal comercial e o `cer` morrem no passo 2 sem tocar em banco nenhum.
//
// ⚠️ 404 E NÃO 403, e sempre a mesma frase de `foraDoEscopo`: para quem não confecciona, a Têmis do
// portal não existe. Um 403 confirmaria que existe uma porta ali para tentar outra chave.

export type AutorizacaoDaTemisDoPortal =
  | { ator: AtorDoPortal; ok: true; sessao: SessaoIncorporador }
  | { ok: false; response: NextResponse };

export async function autorizarTemisDoPortal(
  request: Request,
): Promise<AutorizacaoDaTemisDoPortal> {
  const auth = autorizar(request);
  if (!auth.ok) return auth;
  const { sessao } = auth;

  // ⚠️ O COMERCIAL OPERA A VENDA MAS NÃO CONFECCIONA (a Gurgel entrega à Têmis da Careli). Por isso
  // o predicado é `portalConfeccionaContrato`, e não `portalOperaVenda`.
  if (!portalConfeccionaContrato(sessao.slug, sessao.tipo)) {
    return { ok: false, response: foraDoEscopo() };
  }

  // ⚠️ O COOKIE VALE 12 HORAS, E O CADASTRO PODE TER MUDADO NESSE MEIO. A sessão diz o slug e o
  // incorporador do momento do login; aqui se confere que ele continua ATIVO, que o id é o mesmo
  // (um slug renomeado e reaproveitado não herda os contratos do anterior) e que o tipo gravado
  // continua sendo de quem confecciona. É uma consulta a mais por chamada, e é nesta porta que ela
  // vale: daqui sai escrita de contrato e envio para assinatura com a conta da Careli.
  //
  // ⚠️ E A CONTA TAMBÉM (revisão da onda 3, 16/09/2026). Conferir só o incorporador deixava o
  // funcionário desligado às 9h, ou a conta que perdeu o VOC no Setup, operando até o cookie vencer:
  // trocar o e-mail de um signatário num envelope vivo, publicar minuta, cadastrar cliente, pagar
  // consulta da MOST. `/api/incorporador/sessao` já revalida a conta a cada carga de tela; aqui,
  // onde sai escrita com a conta da Careli, a revalidação é a cada chamada. As duas leituras correm
  // juntas.
  let incorporador: Awaited<ReturnType<typeof carregarIncorporadorPorSlug>>;
  let contaAtiva: Awaited<ReturnType<typeof usuarioIncorporadorSegueAtivo>>;
  try {
    [incorporador, contaAtiva] = await Promise.all([
      carregarIncorporadorPorSlug(sessao.slug),
      usuarioIncorporadorSegueAtivo(sessao.usuarioId),
    ]);
  } catch (erro) {
    // Falha de leitura não autoriza, e também não é "não encontrado": um 404 aqui mandaria o time da
    // Cecílio procurar um contrato que existe. 503 diz "tente de novo".
    console.error("[temis][portal] falha ao conferir o incorporador da sessão", erro);
    return { ok: false, response: indisponivel() };
  }

  if (
    !incorporador ||
    !incorporador.ativo ||
    incorporador.id !== sessao.incorporadorId ||
    !portalConfeccionaContrato(incorporador.slug, incorporador.tipo)
  ) {
    return { ok: false, response: foraDoEscopo() };
  }

  // `null` = não deu para ler a conta (banco fora). Não autoriza, e não é "não encontrado".
  if (contaAtiva === null) return { ok: false, response: indisponivel() };
  if (!contaAtiva) return { ok: false, response: foraDoEscopo() };

  // ⚠️ O ESCOPO É O DO COOKIE CRUZADO COM O DA CONTA AGORA. `escopoDaConta` é a MESMA régua do login
  // e da revalidação da sessão (vínculos do portal + recorte da conta, 0122). O cruzamento só tira:
  // empreendimento revogado no Setup some na hora, e o que foi acrescentado entra quando a tela
  // recarrega a sessão (que reemite o cookie). Leitura que falhou é 503, nunca o cookie inteiro.
  let doCookie: string[];
  try {
    const fresco = await escopoDaConta(incorporador, sessao.usuarioId);
    const vigentes = new Set(fresco.enterpriseIds.map((id) => String(id).trim()));
    doCookie = sessao.enterpriseIds.filter((id) => vigentes.has(String(id).trim()));
  } catch (erro) {
    console.error("[temis][portal] falha ao conferir o escopo da conta", erro);
    return { ok: false, response: indisponivel() };
  }

  if (doCookie.length === 0) {
    return { ok: false, response: foraDoEscopo() };
  }
  const sessaoVigente: SessaoIncorporador = { ...sessao, enterpriseIds: doCookie };

  // ⚠️ OS IDS SAEM EXPANDIDOS, e é isso que `enterpriseNoAlcance` espera: `idsDaSessao` traz o grupo
  // e as divisões de quem tem o grupo, e só a divisão de quem tem a divisão. Sem catálogo (C2X fora
  // do ar), ela devolve os ids crus da sessão: menos que o correto, nunca mais.
  let enterpriseIds: string[];
  try {
    enterpriseIds = await idsDaSessao(sessaoVigente);
  } catch (erro) {
    console.error("[temis][portal] falha ao expandir os empreendimentos da sessão", erro);
    enterpriseIds = [...sessaoVigente.enterpriseIds];
  }

  if (enterpriseIds.length === 0) {
    return { ok: false, response: foraDoEscopo() };
  }

  return {
    ator: {
      enterpriseIds,
      incorporadorId: incorporador.id,
      nome: sessao.usuarioNome,
      slug: sessao.slug,
      tipo: "portal",
      usuarioId: sessao.usuarioId,
    },
    ok: true,
    sessao: sessaoVigente,
  };
}

function indisponivel(): NextResponse {
  return NextResponse.json({ error: "Não foi possível conferir o acesso agora." }, { status: 503 });
}
