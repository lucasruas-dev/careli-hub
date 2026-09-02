import { NextResponse } from "next/server";

import {
  autenticarUsuarioIncorporador,
  carregarIncorporadorPorSlug,
  escopoDaConta,
  registrarLoginIncorporador,
  usuarioIncorporadorSegueAtivo,
} from "@/lib/apolo/incorporador/dados";
import {
  criarSessaoIncorporador,
  INCORPORADOR_COOKIE,
  INCORPORADOR_TTL_MS,
  sessaoDoRequest,
} from "@/lib/apolo/incorporador/sessao";

// PORTA DE ENTRADA do incorporador (o dono do loteamento).
//
// Rota anônima por natureza: quem chega aqui ainda não tem sessão. Ela se protege por dentro,
// e é a ÚNICA do portal que responde sem cookie — o gate do proxy libera este caminho exato.
//
// O QUE SAI DAQUI: um cookie httpOnly assinado com o escopo dentro (quais empreendimentos este
// incorporador enxerga). Todas as telas leem dali; nenhuma aceita empreendimento por parâmetro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Resposta única para e-mail inexistente e senha errada: distinguir os dois transforma a tela
// num confirmador de quem é cliente da Careli.
const CREDENCIAL_INVALIDA = "E-mail ou senha não confere.";

export async function POST(request: Request) {
  let corpo: { email?: unknown; senha?: unknown; slug?: unknown };

  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: CREDENCIAL_INVALIDA }, { status: 400 });
  }

  const email = typeof corpo.email === "string" ? corpo.email : "";
  const senha = typeof corpo.senha === "string" ? corpo.senha : "";
  // Em QUAL portal ela está entrando. O mesmo e-mail pode ter acesso a mais de um.
  const slug = typeof corpo.slug === "string" ? corpo.slug : "";

  const resultado = await autenticarUsuarioIncorporador(email, senha, slug);

  if (!resultado.ok) {
    if (resultado.motivo === "indisponivel") {
      return NextResponse.json(
        { error: "Acesso indisponível agora. Tente de novo em instantes." },
        { status: 503 },
      );
    }

    return NextResponse.json({ error: CREDENCIAL_INVALIDA }, { status: 401 });
  }

  const { incorporador, usuario } = resultado;

  // O recorte é da CONTA, não só do portal (0122): no comercial cada coordenador vê os
  // empreendimentos dele. Falha fechada: erro ao ler o vínculo não vira "vê tudo".
  let escopo: Awaited<ReturnType<typeof escopoDaConta>>;
  try {
    escopo = await escopoDaConta(incorporador, usuario.id);
  } catch {
    return NextResponse.json(
      { error: "Acesso indisponível agora. Tente de novo em instantes." },
      { status: 503 },
    );
  }

  if (escopo.enterpriseIds.length === 0) {
    // Conta válida, mas sem nenhum empreendimento liberado: entrar para ver telas vazias só
    // gera chamado. Melhor dizer que o acesso ainda não está pronto.
    return NextResponse.json(
      { error: "Seu acesso ainda não tem empreendimento liberado. Fale com a Careli." },
      { status: 403 },
    );
  }

  let token: string;

  try {
    token = criarSessaoIncorporador(
      {
        enterpriseIds: escopo.enterpriseIds,
        enterpriseIdsComCarteira: escopo.enterpriseIdsComCarteira,
        incorporadorId: incorporador.id,
        incorporadorNome: incorporador.nome,
        slug: incorporador.slug,
        tipo: incorporador.tipo,
        usuarioId: usuario.id,
        usuarioNome: usuario.nome,
      },
      Date.now(),
    );
  } catch {
    // Segredo de assinatura ausente. Falha FECHADA: sem ele não há sessão verificável.
    return NextResponse.json(
      { error: "Acesso indisponível agora. Tente de novo em instantes." },
      { status: 503 },
    );
  }

  await registrarLoginIncorporador(usuario.id);

  const resposta = NextResponse.json({
    data: {
      incorporador: { nome: incorporador.nome, slug: incorporador.slug, tipo: incorporador.tipo },
      usuario: { nome: usuario.nome },
    },
  });

  resposta.cookies.set({
    httpOnly: true,
    maxAge: Math.floor(INCORPORADOR_TTL_MS / 1000),
    name: INCORPORADOR_COOKIE,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    value: token,
  });

  return resposta;
}

/**
 * Quem está logado agora. A tela usa para decidir entre mostrar a porta ou o portal.
 *
 * ⚠️ REVALIDA NO BANCO A CADA CARGA (18/08/2026). O cookie congela o escopo do momento do login,
 * e o Lucas ligou a carteira do LBF no Setup e nada mudou no portal: a chave nova, empreendimento
 * adicionado ou conta desativada só valiam re-logando (ou, no caso da conta, no VENCIMENTO do
 * cookie, que é pior). A regra agora:
 *   • banco respondeu -> listas frescas + cookie REEMITIDO (mudança do Setup vale no F5);
 *   • conta ou incorporador desativados -> sessão derrubada na hora;
 *   • banco fora do ar -> cai no cookie assinado como está (soluço de rede não desloga ninguém).
 * As DEMAIS rotas seguem lendo só o cookie: com o refresh acontecendo em toda carga de tela, o
 * cookie fica no máximo uma navegação atrás do banco.
 */
export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);

  if (!sessao) {
    return NextResponse.json({ data: null }, { headers: { "Cache-Control": "no-store" } });
  }

  const [incorporador, contaAtiva] = await Promise.all([
    carregarIncorporadorPorSlug(sessao.slug),
    usuarioIncorporadorSegueAtivo(sessao.usuarioId),
  ]);

  // O recorte fresco é o da CONTA (0122). Erro ao ler cai no cookie, como banco fora.
  let escopoFresco: Awaited<ReturnType<typeof escopoDaConta>> | null = null;
  if (contaAtiva === true && incorporador) {
    try {
      escopoFresco = await escopoDaConta(incorporador, sessao.usuarioId);
    } catch {
      escopoFresco = null;
    }
  }

  // Desativação explícita derruba a sessão. `carregarIncorporadorPorSlug` devolve null tanto
  // para inativo quanto para banco fora; por isso a conta é o gatilho de revogação (ela
  // distingue: false = desativada, null = não deu para conferir).
  if (contaAtiva === false || (escopoFresco !== null && escopoFresco.enterpriseIds.length === 0)) {
    const resposta = NextResponse.json({ data: null }, { headers: { "Cache-Control": "no-store" } });
    resposta.cookies.set({ httpOnly: true, maxAge: 0, name: INCORPORADOR_COOKIE, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", value: "" });
    return resposta;
  }

  const fresca =
    escopoFresco !== null && incorporador
      ? {
          enterpriseIds: escopoFresco.enterpriseIds,
          enterpriseIdsComCarteira: escopoFresco.enterpriseIdsComCarteira,
          incorporadorNome: incorporador.nome,
          tipo: incorporador.tipo,
        }
      : null;

  const resposta = NextResponse.json(
    {
      data: {
        empreendimentos: fresca?.enterpriseIds ?? sessao.enterpriseIds,
        empreendimentosComCarteira:
          fresca?.enterpriseIdsComCarteira ?? sessao.enterpriseIdsComCarteira,
        incorporador: {
          nome: fresca?.incorporadorNome ?? sessao.incorporadorNome,
          slug: sessao.slug,
          tipo: fresca?.tipo ?? sessao.tipo,
        },
        usuario: { nome: sessao.usuarioNome },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );

  if (fresca) {
    try {
      const token = criarSessaoIncorporador(
        {
          enterpriseIds: fresca.enterpriseIds,
          enterpriseIdsComCarteira: fresca.enterpriseIdsComCarteira,
          incorporadorId: sessao.incorporadorId,
          incorporadorNome: fresca.incorporadorNome,
          slug: sessao.slug,
          tipo: fresca.tipo,
          usuarioId: sessao.usuarioId,
          usuarioNome: sessao.usuarioNome,
        },
        Date.now(),
      );
      resposta.cookies.set({
        httpOnly: true,
        maxAge: Math.floor(INCORPORADOR_TTL_MS / 1000),
        name: INCORPORADOR_COOKIE,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        value: token,
      });
    } catch {
      // Sem segredo de assinatura não há cookie novo; o antigo segue valendo até o TTL.
    }
  }

  return resposta;
}

/** Sair. Apaga o cookie pelo mesmo caminho em que foi posto. */
export async function DELETE() {
  const resposta = NextResponse.json({ data: { ok: true } });

  resposta.cookies.set({
    httpOnly: true,
    maxAge: 0,
    name: INCORPORADOR_COOKIE,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    value: "",
  });

  return resposta;
}
