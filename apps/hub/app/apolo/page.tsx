import { HubShell } from "@/layouts/hub-shell";
import { ApoloPage } from "@/modules/apolo/ApoloPage";

export const dynamic = "force-dynamic";

// `/apolo?entidade=<id>&q=<documento>` abre direto a ficha pedida.
//
// Quem usa hoje é o cockpit da Iris: o operador está falando com alguém, clica em "Abrir no
// Apolo" e cai na ficha DAQUELA pessoa. Sem os parâmetros, a tela abre como sempre.
//
// O `q` vem junto de propósito: a lista do CRM é o resultado de uma busca, não a base inteira, e
// sem o termo a ficha pode nem estar entre os resultados para o id casar.
export default async function ApoloModulePage({
  searchParams,
}: {
  searchParams: Promise<{ entidade?: string; q?: string }>;
}) {
  const { entidade, q } = await searchParams;

  return (
    <HubShell chrome="operational" layoutMode="module">
      <ApoloPage buscaInicial={q ?? null} entidadeInicial={entidade ?? null} />
    </HubShell>
  );
}
