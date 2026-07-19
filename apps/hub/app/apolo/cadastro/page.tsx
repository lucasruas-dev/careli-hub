import { HubShell } from "@/layouts/hub-shell";
import { findCadastroTipo } from "@/lib/apolo/cadastro-tipos";
import { CadastroFlow } from "@/modules/apolo/blocks/cadastro/cadastro-flow";

export const dynamic = "force-dynamic";

export default async function ApoloCadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>;
}) {
  // O tipo do cadastro (papel de nascimento) vem do menu "+" do Apolo: /apolo/cadastro?tipo=…
  const { tipo } = await searchParams;
  const cadastroTipo = findCadastroTipo(tipo);

  return (
    <HubShell chrome="operational" layoutMode="module">
      <CadastroFlow tipo={cadastroTipo.slug} />
    </HubShell>
  );
}
