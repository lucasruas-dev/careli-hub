import type { Metadata, Viewport } from "next";

import { createPrometeuClient, getEvento } from "@/lib/prometeu/data";
import { desenhoDoMasterplan } from "@/lib/prometeu/desenho-do-masterplan";
import { validarTokenDoTelao } from "@/lib/prometeu/link-do-telao";
import { masterplanDoEvento } from "@/lib/prometeu/masterplan-do-evento";
import { topicoDaFila } from "@/lib/prometeu/fila-topic";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";
import { TelaoMasterplan } from "@/modules/publico/prometeu/TelaoMasterplan";

// O TELÃO DO MASTERPLAN — página PÚBLICA, projetada no salão do lançamento.
//
// ⚠️ TEM QUE VIVER SOB /publico/: é esse prefixo que o auth-provider trata como rota sem login.
// O gate de /api/* fica no proxy.ts, onde /api/publico/prometeu/masterplan entrou na allowlist
// UMA A UMA. Molde: app/publico/fila/page.tsx.
//
// A primeira carga é feita NO SERVIDOR de propósito: o projetor liga e o mapa já tem que estar
// pintado. Tela cinza esperando fetch na frente do salão é o que não pode acontecer.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Masterplan do lançamento | C2X",
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#0b1017",
  viewportFit: "cover",
  width: "device-width",
};

function Aviso({ texto }: { texto: string }) {
  return (
    <main className="grid h-dvh w-dvw place-items-center bg-[#0b1017] px-8 text-center text-white/70">
      <p className="text-2xl">{texto}</p>
    </main>
  );
}

export default async function MasterplanPublicoPage({
  searchParams,
}: {
  searchParams: Promise<{ tv?: string }>;
}) {
  const { tv } = await searchParams;
  const eventoId = validarTokenDoTelao(tv);
  if (!eventoId) return <Aviso texto="Link inválido." />;

  const client = createPrometeuClient();
  if (!client) return <Aviso texto="Sistema indisponível no momento." />;

  const evento = await getEvento(client, eventoId);
  if (!evento) return <Aviso texto="Lançamento não encontrado." />;

  const desenho = desenhoDoMasterplan(evento.enterpriseCode);
  if (!desenho) {
    // Acontece quando o lançamento ainda não tem mapa desenhado. Dizer isso é melhor que
    // projetar uma tela preta e deixar alguém procurando defeito no projetor.
    return (
      <Aviso texto="Este lançamento ainda não tem masterplan cadastrado." />
    );
  }

  const { dados, error } = await masterplanDoEvento(client, evento);
  if (error || !dados)
    return <Aviso texto="Não foi possível montar o mapa agora." />;

  // A publishable key já vive no bundle do hub — é ela que a TV da fila usa desde 02/08.
  const cfg = getServerSupabaseConfig();

  return (
    <TelaoMasterplan
      desenho={desenho}
      estadoInicial={dados}
      evento={{ data: evento.dataEvento, nome: evento.nome }}
      realtime={{
        key: cfg.anonKey ?? "",
        topico: topicoDaFila(eventoId),
        url: cfg.url ?? "",
      }}
      token={tv ?? ""}
    />
  );
}
