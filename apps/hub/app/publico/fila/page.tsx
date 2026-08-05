import type { Metadata, Viewport } from "next";

import { createPrometeuClient } from "@/lib/prometeu/data";
import { acompanhamentoDoCliente } from "@/lib/prometeu/fila-do-cliente-server";
import { verificarTokenDaFila } from "@/lib/prometeu/link-da-fila";
import { AcompanharFila } from "@/modules/publico/prometeu/AcompanharFila";

// Pagina PUBLICA da fila do cliente (o link que ele recebe no check-in abre aqui).
//
// ⚠️ TEM QUE VIVER SOB /publico/: e' esse prefixo que o auth-provider trata como rota sem login
// (`isPublicPageRoute`). O gate de /api/* fica no proxy.ts, onde /api/publico/prometeu/fila
// entrou na allowlist. Molde: app/publico/verificar/page.tsx.
//
// A primeira carga e' feita NO SERVIDOR de proposito: o cliente abre o link no meio do salao,
// com sinal ruim, e a posicao tem que estar na tela no primeiro pixel — nao depois de um fetch.
// O componente cliente so' cuida da atualizacao de 15s dali em diante.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // Nao indexar: sao paginas de pessoa, uma por link.
  robots: { follow: false, index: false },
  title: "Sua posição na fila | C2X",
};

export const viewport: Viewport = {
  initialScale: 1,
  // A tela e' escura de ponta a ponta; sem isto a barra do navegador fica clara no iOS e corta o
  // efeito de tela cheia.
  themeColor: "#0b1017",
  viewportFit: "cover",
  width: "device-width",
};

export default async function FilaPublicaRoute({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const token = (t ?? "").trim();

  const tk = verificarTokenDaFila(token);
  if (!tk.ok) {
    return (
      <AcompanharFila
        erroInicial="Link inválido. Peça um novo link na recepção."
        inicial={null}
        token=""
      />
    );
  }

  const client = createPrometeuClient();
  const resultado = client
    ? await acompanhamentoDoCliente(client, {
        credenciadoId: tk.payload.c,
        eventoId: tk.payload.e,
      })
    : { error: "Acompanhamento indisponível no momento." };

  return (
    <AcompanharFila
      erroInicial={resultado.acompanhamento ? null : (resultado.error ?? null)}
      inicial={resultado.acompanhamento ?? null}
      // O token segue para a tela porque e' com ele que o poll de 15s se identifica. Nao ha PII
      // nele (dois uuids), entao ficar na URL/estado do browser nao expoe nada.
      token={token}
    />
  );
}
