import type { Metadata } from "next";

import { PainelAssinatura } from "@/modules/apolo/blocks/assinaturas/painel-assinatura";

// BI PÚBLICO DE ASSINATURA — o painel de /apolo/assinaturas, aberto, sem login.
//
// Decisão do Lucas (17/08/2026): "só deixa público, somente isso". Levantei antes que a tela mostra
// e-mail dos sócios do incorporador e nome de comprador; ele reafirmou, e vai assim.
//
// ⚠️ `noindex`: o link circula entre pessoas, e isso é diferente de estar no Google. Mesmo padrão
// de /publico/painel, pela mesma razão.
//
// É O MESMO COMPONENTE da tela interna, só com a fonte trocada. Duplicar o painel criaria duas
// verdades sobre o mesmo contrato, e a que ninguém abre é a que fica desatualizada.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Assinaturas · Vale do Ouro",
};

export default function AssinaturasPublicoPage() {
  return (
    <main className="min-h-screen bg-canvas">
      <PainelAssinatura fonte="/api/publico/bi/assinaturas" />
    </main>
  );
}
