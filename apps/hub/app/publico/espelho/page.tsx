import type { Metadata, Viewport } from "next";

import { abrirEspelho } from "@/lib/hercules/espelho/abrir-espelho";
import { estadoDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";
import { planosPublicos } from "@/lib/hercules/espelho/planos-publicos";
import { EspelhoPublico } from "@/modules/publico/espelho/EspelhoPublico";

// O ESPELHO PÚBLICO — o mapa de lotes que o corretor manda para o cliente.
//
// ⚠️ TEM QUE VIVER SOB /publico/. O gate de página não é o proxy.ts (ele só protege /api/*): é o
// providers/auth-provider.tsx, que libera por PREFIXO de pathname. Fora daqui o visitante seria
// mandado para /login.
//
// ⚠️ A PRIMEIRA CARGA É NO SERVIDOR, de propósito. O link é aberto no celular, muitas vezes no
// 4G: o mapa já chega pintado, e o componente cliente só cuida do refresh e da interação. Sem
// isso o cliente veria a tela cinza enquanto três requisições viajam.
//
// ⚠️ E NÃO VAI DADO DE CLIENTE NENHUM. Por lote: código, quadra, lote, situação em duas cores,
// preço de tabela e área. É a mesma disciplina do telão do Prometeu, pela mesma razão — a lição
// do Garden, onde uma página interna sem senha expôs nome e preço juntos.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // noindex: é um link operacional que o corretor manda, não conteúdo de busca. É a única
  // proteção contra indexação que o repo tem (não há robots.txt), então não pode faltar.
  robots: { follow: false, index: false },
  title: "Espelho do empreendimento | C2X",
};

export const viewport: Viewport = {
  initialScale: 1,
  // O mapa usa a tela inteira; `viewport-fit=cover` é o que faz env(safe-area-inset-*) valer no
  // iPhone, para a barra de baixo não comer a legenda.
  viewportFit: "cover",
  width: "device-width",
};

export default async function EspelhoPublicoRoute({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  const aberto = await abrirEspelho(e ?? null);

  if (!aberto.ok) {
    return <EspelhoPublico erroInicial="Link inválido ou indisponível." token="" />;
  }

  const { client, codigo, filhosC2xIds, masterplan, nome, paiC2xId } = aberto.espelho;

  try {
    const [estado, planos] = await Promise.all([
      estadoDoEspelho(client, {
        enterpriseIdDoPai: paiC2xId,
        enterpriseIdsDosFilhos: filhosC2xIds,
      }),
      planosPublicos(client, [paiC2xId, ...filhosC2xIds].filter(Boolean) as string[]),
    ]);

    return (
      <EspelhoPublico
        inicial={{
          ...estado,
          planos,
          empreendimento: { codigo, nome },
          temMapa: masterplan !== null,
        }}
        token={e ?? ""}
      />
    );
  } catch (error) {
    console.error("[publico][espelho] falha na primeira carga", error);

    // Erro é erro: a tela avisa e oferece recarregar. Mapa vazio seria lido como "não tem nada
    // à venda aqui".
    return (
      <EspelhoPublico
        erroInicial="Não foi possível carregar o mapa agora."
        token={e ?? ""}
      />
    );
  }
}
