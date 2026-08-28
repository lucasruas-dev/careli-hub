import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  enderecoDeAcessoLivre,
  listarEmpreendimentosDisponiveis,
  listarIncorporadores,
  logosGravadasDoIncorporador,
  normalizarSlug,
  salvarIncorporador,
} from "@/lib/apolo/incorporador/gestao";
import {
  desfazerMovimentoDeLogo,
  migrarLogoDeSlug,
  type MovimentoDeLogo,
  objetoDaReferencia,
  referenciaAceitavelParaGravar,
  removerObjetoDaLogo,
} from "@/lib/apolo/incorporador/logo";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Gestão dos acessos de incorporador (ferramenta INTERNA do Setup do Apolo).
//   GET  = os incorporadores, seus usuários e o que cada um enxerga + a lista de empreendimentos.
//   POST = cria ou atualiza um incorporador com a lista de empreendimentos dele.
//
// ⚠️ `authorizeApoloWrite` nas DUAS pernas, inclusive no GET. A leitura aqui é o mapa de quem vê
// o quê, e a lista de e-mails que entram no portal: não é dado de consulta, é a permissão.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });

  try {
    // O C2X pode estar fora sem que isso impeça a tela: dá para editar usuário e senha mesmo
    // sem a lista de empreendimentos carregada.
    const [incorporadores, empreendimentos] = await Promise.all([
      listarIncorporadores(client),
      listarEmpreendimentosDisponiveis().catch(() => []),
    ]);

    return NextResponse.json(
      { data: { empreendimentos, incorporadores } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][incorporadores] falha ao listar", error);
    return NextResponse.json({ error: "Não foi possível carregar os incorporadores." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });

  const corpo = (await request.json().catch(() => null)) as null | {
    ativo?: boolean;
    empreendimentos?: { carteiraAdministrada?: boolean; enterpriseId?: string }[];
    id?: null | string;
    logoEscuraPath?: null | string;
    logoPath?: null | string;
    nome?: string;
    slug?: string;
  };

  if (!corpo?.nome?.trim()) {
    return NextResponse.json({ error: "Informe o nome do incorporador." }, { status: 400 });
  }

  // ── LOGO ───────────────────────────────────────────────────────────────────────────────────
  // O que chega em `logoPath` vai parar numa coluna que a rota PÚBLICA da logo lê depois, então
  // não entra cru: só passa caminho de asset do repo (o Cecílio, em produção) ou referência de
  // storage BEM-FORMADA E DESTE portal.
  //
  // ⚠️ E o endereço de acesso pode ter mudado nesta mesma gravação. Como a chave do arquivo no
  // bucket é o slug, a referência antiga deixaria de casar com o portal e a marca sumiria da porta
  // sem ninguém entender por quê — `migrarLogoDeSlug` move o objeto (metadado, os bytes não passam
  // por aqui) e devolve a referência já apontando para o endereço novo.
  //
  // ⚠️ E O MOVE PRECISA SER REVERSÍVEL. Ele acontece antes da gravação, e a gravação falha por
  // regra de negócio (endereço duplicado) ou por o banco estar fora. Sem desfazer, o objeto ficava
  // no prefixo NOVO com a coluna ainda apontando para o ANTIGO: 404 na rota pública, marca sumida,
  // e na tela só um "não foi possível gravar" que não tem nada a ver com logo.
  const slugFinal = normalizarSlug(corpo.slug || corpo.nome);
  const logos: { escura: null | string; clara: null | string } = { clara: null, escura: null };
  const movimentos: MovimentoDeLogo[] = [];

  const desfazerMovimentos = async () => {
    for (const movimento of movimentos) await desfazerMovimentoDeLogo(client, movimento);
  };

  // ⚠️ ANTES DE TOCAR NO BUCKET: o endereço pedido é de outro portal? O índice único do banco só
  // reclamaria depois do move, e aí a arte deste portal já teria ido parar no prefixo do outro.
  const enderecoLivre = await enderecoDeAcessoLivre(client, {
    id: corpo.id,
    slug: slugFinal,
  });
  if (!enderecoLivre.ok) {
    return NextResponse.json({ error: enderecoLivre.erro }, { status: 400 });
  }

  // O estado ANTERIOR serve para saber, depois da gravação, qual objeto ficou órfão — o caso do
  // operador que clicou na lixeira e salvou.
  const anterior = corpo.id?.trim()
    ? await logosGravadasDoIncorporador(client, corpo.id.trim())
    : null;

  for (const [chave, entrada] of [
    ["clara", corpo.logoPath],
    ["escura", corpo.logoEscuraPath],
  ] as const) {
    const migrada = await migrarLogoDeSlug({
      adminClient: client,
      referencia: entrada,
      slugDestino: slugFinal,
    });
    if (!migrada.ok) {
      await desfazerMovimentos();
      return NextResponse.json({ error: migrada.erro }, { status: 400 });
    }
    if (migrada.movido) movimentos.push(migrada.movido);

    const aceita = referenciaAceitavelParaGravar(migrada.referencia, slugFinal);
    if (!aceita.ok) {
      await desfazerMovimentos();
      return NextResponse.json({ error: aceita.erro }, { status: 400 });
    }

    logos[chave] = aceita.valor;
  }

  const resultado = await salvarIncorporador(client, {
    ativo: corpo.ativo,
    empreendimentos: (corpo.empreendimentos ?? [])
      .filter((e) => e?.enterpriseId)
      .map((e) => ({
        carteiraAdministrada: Boolean(e.carteiraAdministrada),
        enterpriseId: String(e.enterpriseId),
      })),
    id: corpo.id ?? null,
    logoEscuraPath: logos.escura,
    logoPath: logos.clara,
    nome: corpo.nome,
    slug: corpo.slug ?? corpo.nome,
  });

  if (!resultado.ok) {
    // ⚠️ A PERGUNTA NÃO É "FALHOU?", É "A COLUNA JÁ APONTA PARA O CAMINHO NOVO?".
    // `salvarIncorporador` também devolve erro DEPOIS de ter gravado o incorporador — a lista de
    // empreendimentos vem em seguida e é ela que pode cair. Desfazer o move nesse caso levaria o
    // objeto de volta para o prefixo antigo enquanto a coluna, já gravada, aponta para o novo:
    // exatamente o estado quebrado que este rollback existe para evitar.
    const gravadas = corpo.id?.trim()
      ? await logosGravadasDoIncorporador(client, corpo.id.trim())
      : null;
    const registroJaGravado =
      gravadas !== null &&
      objetoDaReferencia(gravadas.logoPath) === objetoDaReferencia(logos.clara) &&
      objetoDaReferencia(gravadas.logoEscuraPath) === objetoDaReferencia(logos.escura);

    if (!registroJaGravado) await desfazerMovimentos();
    return NextResponse.json({ error: resultado.erro }, { status: 400 });
  }

  // ── FAXINA, DEPOIS DA GRAVAÇÃO ─────────────────────────────────────────────────────────────
  // Só agora — com a coluna já apontando para outro lugar (ou para lugar nenhum) — o objeto que
  // ficou para trás pode sair. É o outro lado da lixeira da tela: ela zera o CAMPO, e é este
  // trecho que apaga o ARQUIVO, sem janela em que o banco aponte para algo que não existe mais.
  // Best-effort de propósito: a gravação já deu certo e não vai virar erro por causa de faxina.
  for (const [antes, agora] of [
    [anterior?.logoPath, logos.clara],
    [anterior?.logoEscuraPath, logos.escura],
  ] as const) {
    const objetoAntigo = objetoDaReferencia(antes);
    // Comparar por OBJETO, não pela referência: a string carrega o carimbo `?v=`, que muda a cada
    // upload mesmo quando o arquivo no bucket é exatamente o mesmo (nome fixo, upsert).
    if (objetoAntigo && objetoAntigo !== objetoDaReferencia(agora)) {
      await removerObjetoDaLogo(client, objetoAntigo);
    }
  }

  return NextResponse.json({ data: { id: resultado.id } });
}
