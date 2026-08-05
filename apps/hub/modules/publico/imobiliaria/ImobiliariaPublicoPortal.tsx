"use client";

import { useState } from "react";

import type { EmpreendimentoPublico } from "@/lib/publico/cad/regras";
import { CadastroFlow } from "@/modules/apolo/blocks/cadastro/cadastro-flow";
import { PortaoImobiliaria } from "@/modules/publico/imobiliaria/PortaoImobiliaria";
import { BotaoPrimario, Cabecalho } from "@/modules/publico/ui/campos";
import { LogoEmpreendimento } from "@/modules/publico/logo-empreendimento";
import { CascaPublica } from "@/modules/publico/ui/casca";
import { C, GOLD } from "@/modules/publico/ui/tokens";

// Orquestra o auto-cadastro PÚBLICO da imobiliária no MESMO fluxo do credenciamento interno
// (CredenciamentoFlow), como o Lucas pediu ("eu quero o mesmo fluxo"):
//
//   1) EMPREENDIMENTOS: "quais empreendimentos você quer trabalhar?" — escolhe os que estão na
//      ativa. É o PRIMEIRO passo (o Lucas: "começa escolhendo o empreendimento a qual ela quer
//      se habilitar").
//   2) CNPJ: a antessala confere o CNPJ e emite a pré-sessão (trava das torneiras pagas).
//   3) WIZARD: o CadastroFlow tipo="imobiliaria" completo, com os empreendimentos JÁ escolhidos
//      (empreendimentosIniciais) — o wizard não repete o seletor ("seleção herdada do portal").
export function ImobiliariaPublicoPortal({
  empreendimentos,
}: {
  // Vitrine de empreendimentos ATIVOS, mastigada no server component (com credencial de serviço).
  empreendimentos: EmpreendimentoPublico[];
}) {
  // `null` = ainda escolhendo. Preenchido = os empreendimentos que a imobiliária quer trabalhar.
  const [escolhidos, setEscolhidos] = useState<string[] | null>(null);
  const [preSessao, setPreSessao] = useState<string | null>(null);

  // 1) Escolha de empreendimento — o ponto de partida.
  if (escolhidos === null) {
    return (
      <EscolhaEmpreendimentos empreendimentos={empreendimentos} onConfirmar={setEscolhidos} />
    );
  }

  // 2) CNPJ.
  if (!preSessao) {
    return <PortaoImobiliaria onCnpjConferido={setPreSessao} />;
  }

  // 3) Wizard completo, com os empreendimentos herdados do passo 1.
  // ⚠️ `publico-shell` (exceção do min-width no globals.css) + `height: 100dvh` (altura definida
  // que o `h-full` interno do wizard precisa). O token vai no header `x-cad-pre-sessao-imob`.
  return (
    <div className="publico-shell" style={{ background: C.page, height: "100dvh" }}>
      <CadastroFlow
        empreendimentosIniciais={escolhidos}
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

// Vitrine MULTI-SELECT dos empreendimentos ativos. Espelha a etapa 1 do CredenciamentoFlow
// ("Quais empreendimentos você quer trabalhar? Selecione um ou mais"), com o visual público.
function EscolhaEmpreendimentos({
  empreendimentos,
  onConfirmar,
}: {
  empreendimentos: EmpreendimentoPublico[];
  onConfirmar: (ids: string[]) => void;
}) {
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const alternar = (id: string) =>
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );

  return (
    <CascaPublica
      rodape={
        <BotaoPrimario desabilitado={selecionados.length === 0} onClick={() => onConfirmar(selecionados)}>
          Continuar
        </BotaoPrimario>
      }
    >
      <Cabecalho
        subtitulo="Selecione um ou mais. Depois você informa o CNPJ e completa o cadastro."
        titulo="Quais empreendimentos você quer trabalhar?"
      />
      {empreendimentos.length === 0 ? (
        <p style={{ color: C.sub, fontSize: 14 }}>
          Nenhum empreendimento aberto para credenciamento no momento. Fale com a nossa central.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {empreendimentos.map((emp) => {
            const ativo = selecionados.includes(emp.id);
            return (
              <button
                key={emp.id}
                onClick={() => alternar(emp.id)}
                style={{
                  alignItems: "center",
                  background: C.card,
                  // Borda dourada e mais grossa quando escolhido: o estado tem que ser óbvio no sol.
                  border: ativo ? `2px solid ${GOLD}` : `1px solid ${C.border}`,
                  borderRadius: 14,
                  cursor: "pointer",
                  display: "flex",
                  gap: 12,
                  minHeight: 64,
                  padding: 12,
                  textAlign: "left",
                  width: "100%",
                }}
                type="button"
              >
                <LogoEmpreendimento
                  code={emp.code}
                  logoUrl={emp.logoUrl}
                  name={emp.name}
                />
                <span style={{ color: C.text, flex: 1, fontSize: 16, fontWeight: 600 }}>
                  {emp.name}
                </span>
                {/* Marca de seleção. */}
                <span
                  aria-hidden
                  style={{
                    alignItems: "center",
                    background: ativo ? GOLD : "transparent",
                    border: ativo ? `1px solid ${GOLD}` : `1px solid ${C.border}`,
                    borderRadius: 999,
                    color: "#fff",
                    display: "flex",
                    flexShrink: 0,
                    fontSize: 14,
                    height: 24,
                    justifyContent: "center",
                    width: 24,
                  }}
                >
                  {ativo ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </CascaPublica>
  );
}
