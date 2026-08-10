import { notFound } from "next/navigation";

import { carregarIncorporadorPorSlug } from "@/lib/apolo/incorporador/dados";
import { PortalIncorporador } from "@/modules/incorporador/PortalIncorporador";

// PORTAL DO INCORPORADOR — o dono do loteamento entra aqui.
//
// O SLUG DA URL DECIDE A MARCA. É de propósito que a identidade venha do endereço e não da
// sessão: a tela de acesso precisa estar vestida ANTES de alguém logar, que é o pedido do Lucas
// ("a tela inicial para eles fazerem acesso com a logo deles"). Depois de logar, quem manda é o
// cookie assinado — o slug da URL nunca amplia o que a pessoa vê.
//
// Resolvido no SERVIDOR para o cliente não ver um piscar de tela genérica antes da marca dele.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A logo aceita duas formas em `logo_path`, e a diferença importa:
//   • caminho começando com "/" — arquivo servido pelo próprio app (public/). É o que dá para
//     usar hoje: a logo do Cecílio já está em /garden/, commitada com o masterplan.
//   • qualquer outra coisa — chave no bucket privado, que exige URL assinada.
// A segunda ainda não está ligada de propósito: signed URL do Storage vence em 1h e esta tela
// fica aberta a manhã toda (a logo viraria um quadrado quebrado, defeito já visto no repo). Vai
// precisar de rota proxy que assina na hora, e isso entra quando o Lucas mandar a arte boa.
function resolverLogo(logoPath: string | null): string | null {
  if (!logoPath) return null;

  return logoPath.startsWith("/") ? logoPath : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const incorporador = await carregarIncorporadorPorSlug(slug);

  // A aba do navegador do cliente não diz "Panteon": diz o nome dele. `absolute` é o que corta o
  // template do layout raiz ("%s | Panteon"), senão a aba sai "Cecílio Rocha · Portal | Panteon".
  return {
    title: { absolute: incorporador ? `${incorporador.nome} · Portal` : "Portal" },
  };
}

export default async function PaginaIncorporador({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const incorporador = await carregarIncorporadorPorSlug(slug);

  // Slug desconhecido ou inativo cai em 404, sem dizer qual dos dois: a porta não confirma
  // quem é cliente da Careli para quem só chutou um endereço.
  if (!incorporador) notFound();

  return (
    <PortalIncorporador
      logoEscuraUrl={resolverLogo(incorporador.logoEscuraPath)}
      logoUrl={resolverLogo(incorporador.logoPath)}
      nome={incorporador.nome}
      slug={incorporador.slug}
    />
  );
}
