"use client";

import { useState } from "react";

import { PainelAssinatura } from "./painel-assinatura";
import { PainelContratos } from "./painel-contratos";

// A TELA DE `/apolo/assinaturas`, com as duas leituras convivendo.
//
// DECISÃO (18/08/2026): a tela nova ENTRA COMO PADRÃO, e a antiga NÃO SAI — fica a um clique.
// Por quê, e não a substituição seca:
//
//   • a tela nova responde POR CONTRATO ("de quem está esperando esta unidade"); o painel clássico
//     responde POR LINHA DE ASSINATURA ("me dá a tabela crua, 400 linhas, filtrada por perfil e
//     status"). A segunda pergunta é de conferência, e o time usa a tela hoje para exatamente isso;
//   • o BI PÚBLICO (`/publico/assinaturas`) e a aba de assinatura do painel do coordenador rodam o
//     componente clássico. Apagá-lo aqui não os quebraria, mas deixaria o time interno sem a tela
//     que o público continua vendo — duas verdades pela porta dos fundos;
//   • trocar de uma vez é irreversível no meio de uma auditoria de agrupamento do Vale do Ouro.
//     Com as duas lado a lado, qualquer divergência de número é conferível no mesmo minuto.
//
// ⚠️ O BI PÚBLICO NÃO MUDOU: `/publico/assinaturas` continua no `PainelAssinatura` com a rota
// `/api/publico/bi/assinaturas`, escopo fixo e sem login. Nada aqui toca nele.
//
// Quando o time confirmar que a tela nova cobre a conferência (a lista por unidade + o popup já
// mostram tudo que a tabela crua mostra, e mais), a aba clássica sai daqui e o componente fica só
// no público.

type Visao = "classico" | "contratos";

export function AssinaturasView() {
  const [visao, setVisao] = useState<Visao>("contratos");

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <nav className="flex shrink-0 items-center gap-1 border-b border-black/[0.07] px-5 py-2 dark:border-white/[0.08]">
        <Aba ativa={visao === "contratos"} onClick={() => setVisao("contratos")} rotulo="Contratos" />
        <Aba
          ativa={visao === "classico"}
          onClick={() => setVisao("classico")}
          rotulo="Painel clássico"
        />
        <span className="ml-auto text-[11px] text-ink-soft">
          {visao === "contratos"
            ? "Assinatura por contrato, com o PDF no fim da linha"
            : "A tabela de assinaturas linha a linha, do painel de sempre"}
        </span>
      </nav>

      <div className="min-h-0 flex-1">
        {visao === "contratos" ? <PainelContratos /> : <PainelAssinatura />}
      </div>
    </div>
  );
}

function Aba({
  ativa,
  onClick,
  rotulo,
}: {
  ativa: boolean;
  onClick: () => void;
  rotulo: string;
}) {
  return (
    <button
      className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
        ativa ? "bg-ink text-canvas" : "text-ink-soft hover:bg-subtle"
      }`}
      onClick={onClick}
      type="button"
    >
      {rotulo}
    </button>
  );
}
