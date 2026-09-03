import { notFound } from "next/navigation";

import { carregarIncorporadorPorSlug } from "@/lib/apolo/incorporador/dados";
import { resolverLogoDoPortal } from "@/lib/apolo/incorporador/logo";
import { ehPortalComercial } from "@/lib/apolo/incorporador/perfis-de-portal";
import { PortalIncorporador } from "@/modules/incorporador/PortalIncorporador";

// O PORTAL COMERCIAL — a porta do Hércules dos coordenadores: c2x.app.br/comercial/<slug>.
//
// Lucas (02/09/2026), vendo o card do Setup apontar para /incorporador/gurgel: *"esse link está
// errado, tem que ser coordenação ou comercial"*. O time comercial não é incorporador; o endereço
// que ele digita e que circula no WhatsApp da equipe precisa dizer o que é.
//
// ⚠️ É A MESMA TELA E O MESMO COOKIE. O componente, a sessão (`apolo_inc`, path "/") e as rotas
// `/api/incorporador/*` continuam únicos: o que muda é só o caminho da página. Duplicar o portal
// por endereço seria a segunda cópia para manter viva.
//
// ⚠️ SÓ ABRE PORTAL DE TIPO `comercial`. Um slug de incorporador aqui cai em 404, e o contrário
// (portal comercial em /incorporador/<slug>) redireciona para cá — ver app/incorporador/[slug].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const incorporador = await carregarIncorporadorPorSlug(slug);

  return {
    title: {
      absolute:
        incorporador && ehPortalComercial(incorporador.tipo)
          ? `${incorporador.nome} · Comercial`
          : "Comercial",
    },
  };
}

export default async function PaginaComercial({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const incorporador = await carregarIncorporadorPorSlug(slug);

  // Desconhecido, inativo OU de outro tipo: 404 mudo, sem confirmar qual dos três.
  if (!incorporador || !ehPortalComercial(incorporador.tipo)) notFound();

  return (
    <PortalIncorporador
      logoEscuraUrl={resolverLogoDoPortal({
        referencia: incorporador.logoEscuraPath,
        slug: incorporador.slug,
        variante: "escura",
      })}
      logoUrl={resolverLogoDoPortal({
        referencia: incorporador.logoPath,
        slug: incorporador.slug,
        variante: "clara",
      })}
      nome={incorporador.nome}
      slug={incorporador.slug}
      tipo={incorporador.tipo}
    />
  );
}
