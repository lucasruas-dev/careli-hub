import { carregarMarcaDoPortal } from "@/lib/apolo/incorporador/dados";
import {
  baixarLogoDoIncorporador,
  ehVarianteDaLogo,
  objetoDaLogoDoPortal,
} from "@/lib/apolo/incorporador/logo";
import { createApoloAdminClient } from "@/lib/apolo/server";

// A LOGO DA PORTA. Rota PÚBLICA (a tela de login não tem sessão — é o pedido do Lucas de 10/08:
// *"a tela inicial para eles fazerem acesso com a logo deles"*), servindo bytes de um bucket
// PRIVADO.
//
// ── POR QUE UMA ROTA, E NÃO SIGNED URL ───────────────────────────────────────────────────────
// O padrão do repo para logo (`lib/apolo/enterprise-logos.ts`) assina URL com TTL de 1h. Numa
// tela pública que fica aberta a manhã inteira, o link vence e a marca do cliente vira quadrado
// quebrado. Aqui o endereço é ESTÁVEL: `/api/incorporador/<slug>/logo?variante=clara`.
//
// ── ⚠️ O QUE ESTA ROTA NÃO PODE VIRAR ────────────────────────────────────────────────────────
// Um proxy para o bucket. Os documentos de CAD (RG, CPF, comprovante de renda) moram no MESMO
// `apolo-documents`. Por isso:
//
//   • NADA da URL vira caminho. O único dado que a rota aceita do cliente é o slug e a palavra
//     "clara"/"escura"; o caminho sai do que está GRAVADO na linha daquele portal;
//   • `objetoDaLogoDoPortal` confere que o caminho gravado casa com o padrão fechado
//     `incorporador-logos/<chave>/<variante>.<svg|png>` E que a chave é a daquele slug — logo do
//     portal A não sai pela porta do portal B nem se alguém escrever a referência errada no banco;
//   • variante desconhecida é 400 antes de qualquer leitura;
//   • portal inexistente, inativo ou sem logo dão o MESMO 404, sem dizer qual dos três (a porta
//     não confirma quem é cliente da Careli para quem chutou um endereço).
//
// ── ⚠️ SVG É EXECUTÁVEL ──────────────────────────────────────────────────────────────────────
// Dentro de `<img src>` script não roda, mas quem abrir esta URL direto na barra de endereços tem
// o SVG como documento de topo, NA NOSSA ORIGEM (`c2x.app.br`) — a mesma que guarda os cookies de
// sessão do hub. Os cabeçalhos abaixo fecham isso, e o upload já sanitiza o arquivo antes de
// gravar (`sanitizarSvg`): duas camadas, porque uma regex de faxina não é um parser de XML.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CABECALHOS_SEGUROS = {
  // Sem script, sem rede, sem plugin. `sandbox` tira até a origem do documento.
  "Content-Security-Policy":
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  // O navegador NÃO adivinha o tipo: serve como o Content-Type diz, ponto.
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

function naoEncontrado(): Response {
  // Corpo vazio de propósito: a resposta não conta se o portal existe, se está inativo ou se só
  // não subiram a arte ainda.
  return new Response(null, {
    headers: { "Cache-Control": "public, max-age=60" },
    status: 404,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const variante = new URL(request.url).searchParams.get("variante") ?? "clara";
  if (!ehVarianteDaLogo(variante)) {
    return new Response(null, { status: 400 });
  }

  const marca = await carregarMarcaDoPortal(slug);
  if (!marca) return naoEncontrado();

  const referencia = variante === "escura" ? marca.logoEscuraPath : marca.logoPath;

  // ⚠️ A validação usa o slug REAL do banco, não o texto da URL: `ilike` casa sem diferenciar
  // maiúsculas, então `/CECILIO-Rocha/logo` chega aqui e precisa ser conferido contra `cecilio-rocha`.
  const alvo = objetoDaLogoDoPortal({ referencia, slug: marca.slug, variante });
  if (!alvo) return naoEncontrado();

  const client = createApoloAdminClient();
  if (!client) return new Response(null, { status: 503 });

  const bytes = await baixarLogoDoIncorporador(client, alvo.objeto);
  if (!bytes) return naoEncontrado();

  // Cache longo é seguro porque a URL carrega o carimbo `?v=` da última troca (montado por
  // `resolverLogoDoPortal`): arte nova = endereço novo. Sem o carimbo, o `must-revalidate` do
  // teto de 1h evita marca velha presa no navegador de quem já tinha aberto a porta.
  const temCarimbo = new URL(request.url).searchParams.has("v");

  // SEM `Content-Length` na mão: se a plataforma comprimir a resposta, um tamanho declarado aqui
  // passa a mentir e o navegador corta a imagem.
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      ...CABECALHOS_SEGUROS,
      "Cache-Control": temCarimbo
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600, must-revalidate",
      "Content-Disposition": `inline; filename="${variante}.${alvo.contentType === "image/png" ? "png" : "svg"}"`,
      "Content-Type": alvo.contentType,
    },
    status: 200,
  });
}
