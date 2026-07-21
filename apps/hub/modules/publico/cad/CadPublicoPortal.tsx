"use client";

import { useState } from "react";

import { CadastroFlow, type PublicoConfig } from "@/modules/apolo/blocks/cadastro/cadastro-flow";
import { PortaoCorretor } from "@/modules/publico/cad/PortaoCorretor";
import { C } from "@/modules/publico/ui/tokens";

// Orquestra o formulário PÚBLICO de CAD em dois estados, exatamente como o Lucas descreveu:
// "para a CAD vamos incluir somente essa parte que valida o corretor, depois disso, segue o
// formulário da CAD, com fluxos, tudo que já fizemos".
//
//   1) PORTÃO: valida o corretor (CPF -> CNPJ -> dados -> CRECI -> empreendimento).
//   2) WIZARD: o MESMO CadastroFlow do interno (tipo="prospect"), agora em modo público, já
//      vinculado a corretor + imobiliária + empreendimento pelo token que o portão emitiu.
export function CadPublicoPortal({ whatsappCentral }: { whatsappCentral: string }) {
  // `null` = ainda no portão. Preenchido = validado; o token vira a identidade do wizard.
  const [entrada, setEntrada] = useState<PublicoConfig | null>(null);

  if (!entrada) {
    return (
      <PortaoCorretor
        onValidado={(sessao, empreendimentoNome) => setEntrada({ empreendimentoNome, sessao })}
        whatsappCentral={whatsappCentral}
      />
    );
  }

  // ⚠️ `publico-shell`: dispara a exceção `html:has(.publico-shell)` do globals.css (que zera o
  // `min-width: 1024px` do hub e liga overflow-x hidden), senão o wizard estoura para a direita no
  // celular. `height: 100dvh` dá a altura definida que o `h-full` interno do wizard precisa para
  // rolar por dentro (não usamos CascaPublica aqui: ela limita a 480px e o wizard é largo).
  return (
    <div className="publico-shell" style={{ background: C.page, height: "100dvh" }}>
      <CadastroFlow publico={entrada} tipo="prospect" />
    </div>
  );
}
