"use client";

import { useState } from "react";

import type { EmpreendimentoPublico } from "@/lib/publico/cad/regras";
import { CadastroFlow } from "@/modules/apolo/blocks/cadastro/cadastro-flow";
import { PortaoImobiliaria } from "@/modules/publico/imobiliaria/PortaoImobiliaria";
import { C } from "@/modules/publico/ui/tokens";

// Orquestra o auto-cadastro PÚBLICO da imobiliária em dois estados, reusando o MESMO CadastroFlow
// do interno (tipo="imobiliaria"), como o Lucas pediu ("é o mesmo formulário").
//
//   1) ANTESSALA: confirma o CNPJ e emite a pré-sessão (trava das torneiras pagas).
//   2) WIZARD: o CadastroFlow tipo="imobiliaria" completo (cartão CNPJ -> OCR -> enrich-company ->
//      empreendimentos -> corretores -> revisão), salvando em /api/publico/imobiliaria/cadastro.
export function ImobiliariaPublicoPortal({
  empreendimentos,
}: {
  // Vitrine de empreendimentos ATIVOS, já mastigada no server component (com credencial de
  // serviço). Alimenta o multi-select do wizard — não há rota pública que os liste.
  empreendimentos: EmpreendimentoPublico[];
}) {
  const [preSessao, setPreSessao] = useState<string | null>(null);

  if (!preSessao) {
    return <PortaoImobiliaria onCnpjConferido={setPreSessao} />;
  }

  // ⚠️ `publico-shell` (exceção do min-width no globals.css) + `height: 100dvh` (altura definida
  // que o `h-full` do wizard precisa). O token vai no header `x-cad-pre-sessao-imob` e o salvar
  // cai na rota gated da imobiliária; a vitrine de ativos vira as opções do multi-select.
  return (
    <div className="publico-shell" style={{ background: C.page, height: "100dvh" }}>
      <CadastroFlow
        publico={{
          empreendimentos: empreendimentos.map((emp) => ({ id: emp.id, label: emp.name })),
          header: "x-cad-pre-sessao-imob",
          salvarUrl: "/api/publico/imobiliaria/cadastro",
          sessao: preSessao,
        }}
        tipo="imobiliaria"
      />
    </div>
  );
}
