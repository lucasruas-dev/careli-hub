import { HubShell } from "@/layouts/hub-shell";
import { EmissaoDeBoletos } from "@/modules/boletos/EmissaoDeBoletos";

// `/boletos` — a emissão mensal das carteiras administradas FORA do C2X.
//
// Pedido do Lucas (31/08/2026): *"vamos ter que emitir todos esses pelo panteon (...) quero
// organizar a tela que faremos esses envio"*.
//
// ⚠️ ROTA PRÓPRIA, E NÃO UMA ABA DO LSOFT nem do portal do incorporador. São nove
// empreendimentos e só dois deles (Garden e Vale do Sol) têm carteira no LSoft — os outros sete
// vivem só na planilha. E nenhum deles existe no C2X, então também não é tela do Hades.
//
// ⚠️ E NÃO NO PORTAL DO INCORPORADOR: lá quem entra é gente de fora da Careli. Disparar cobrança
// é ato do administrativo, e o portal é o único lugar do Panteon com escrita externa — dar o
// botão de emitir a ele seria abrir a cobrança para quem só deveria conferir a base.
export const dynamic = "force-dynamic";

export default function BoletosPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <EmissaoDeBoletos />
    </HubShell>
  );
}
