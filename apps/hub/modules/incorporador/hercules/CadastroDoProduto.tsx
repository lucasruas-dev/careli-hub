"use client";

import { useCallback } from "react";

import type {
  ApoloEnterpriseCadastro,
  ApoloEnterpriseRow,
} from "@/lib/apolo/empreendimentos";
import { CadastroTab } from "@/modules/apolo/blocks/empreendimentos/empreendimentos-view";

import { MOLDURA_TAILWIND } from "../TelaContratos";
import { useTemaDoPortal } from "../tema";

// A ABA CADASTRO DA FICHA DO PRODUTO, NO PORTAL QUE OPERA A PRÓPRIA VENDA.
//
// Lucas (16/09/2026), sobre o portal da Cecílio Rocha: *"literalmente ter dois sistemas, mas ele
// seria uma replica que temos hoje"*. A ficha do produto no modo incorporador replica a tela
// Empreendimento do Apolo, e esta aba é a MESMA `CadastroTab` de lá (os campos de "Dados gerais"
// do empreendimento), montada pela porta do portal: /api/incorporador/produto/cadastro, pelo
// cookie da sessão, com o escopo conferido do outro lado e sem os contatos de terceiros.
//
// ⚠️ NO MODO COMERCIAL "CADASTRO" É OUTRA COISA: lá a aba com esse nome é o board de CADs
// (`BoardDoProduto`), e a Gurgel já a conhece assim. No modo incorporador o board virou a aba
// "Board", e "Cadastro" voltou a ser o que é no Apolo. Quem mexer nos rótulos da ficha tropeça
// nisso em FichaDoProduto.tsx.

/**
 * A leitura das fichas do produto pela porta do portal. Compartilhada com a aba Relacionamentos,
 * que desenha a MESMA ficha por outro ângulo (como no Apolo, onde as duas usam `loadCadastros`).
 *
 * ⚠️ ESTÁVEL POR `emp`: a aba do Apolo tem a busca como dependência do efeito, e uma função nova a
 * cada render refaria o fetch em laço.
 */
export function useBuscarCadastroDoProduto(emp: string) {
  return useCallback(async (): Promise<ApoloEnterpriseCadastro[]> => {
    const resposta = await fetch(
      `/api/incorporador/produto/cadastro?emp=${encodeURIComponent(emp)}`,
      { cache: "no-store" },
    );
    const corpo = (await resposta.json().catch(() => ({}))) as {
      data?: { cadastros: ApoloEnterpriseCadastro[] };
      error?: string;
    };
    if (!resposta.ok || !corpo.data) {
      throw new Error(corpo.error ?? "Não foi possível carregar o cadastro agora.");
    }
    return corpo.data.cadastros;
  }, [emp]);
}

export function CadastroDoProduto({
  emp,
  row,
}: {
  /** O produto da ficha ("pai:<uuid>" do cadastro ou id do C2X), o mesmo das abas irmãs. */
  emp: string;
  /** A linha no formato do Apolo (`linhaParaRow`). A aba só a usa como gatilho do efeito. */
  row: ApoloEnterpriseRow;
}) {
  const buscar = useBuscarCadastroDoProduto(emp);
  // Tailwind dentro do portal: a moldura ÚNICA e o tema EFETIVO (o porquê está na TelaContratos).
  // A ficha já os aplica por fora; ficam aqui também para a aba funcionar montada em qualquer lugar.
  const { efetivo } = useTemaDoPortal();

  return (
    <div data-uix-theme={efetivo === "escuro" ? "dark" : "light"} style={MOLDURA_TAILWIND}>
      <CadastroTab buscar={buscar} row={row} />
    </div>
  );
}
