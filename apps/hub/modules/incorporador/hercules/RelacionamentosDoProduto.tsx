"use client";

import type { ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";
import { RelacionamentosTab } from "@/modules/apolo/blocks/empreendimentos/empreendimentos-view";

import { MOLDURA_TAILWIND } from "../TelaContratos";
import { useTemaDoPortal } from "../tema";
import { useBuscarCadastroDoProduto } from "./CadastroDoProduto";

// A ABA RELACIONAMENTOS DA FICHA DO PRODUTO, NO PORTAL QUE OPERA A PRÓPRIA VENDA.
//
// A MESMA `RelacionamentosTab` do Apolo (Trabalho: incorporador, coordenador de vendas, captador;
// Contato: o ponto focal), lendo a MESMA porta da aba Cadastro (/api/incorporador/produto/cadastro).
//
// ⚠️ DUAS DIFERENÇAS PARA O APOLO, as duas deliberadas:
//   • o card NÃO abre o CRM do hub (sem `onOpenEntity`): o time do cliente não tem sessão no hub, e
//     a rota nem entrega o id interno da ficha;
//   • sem as linhas de telefone e e-mail (`mostrarContatos={false}`): contato de terceiro não sai
//     para o portal (regra de lib/apolo/incorporador/ficha-cadastro.ts), e o "-" no lugar diria que
//     o dado não existe, quando ele só não é de quem está olhando.
export function RelacionamentosDoProduto({
  emp,
  row,
}: {
  /** O produto da ficha ("pai:<uuid>" do cadastro ou id do C2X), o mesmo das abas irmãs. */
  emp: string;
  /** A linha no formato do Apolo (`linhaParaRow`). A aba só a usa como gatilho do efeito. */
  row: ApoloEnterpriseRow;
}) {
  const buscar = useBuscarCadastroDoProduto(emp);
  const { efetivo } = useTemaDoPortal();

  return (
    <div data-uix-theme={efetivo === "escuro" ? "dark" : "light"} style={MOLDURA_TAILWIND}>
      <RelacionamentosTab buscar={buscar} mostrarContatos={false} row={row} />
    </div>
  );
}
