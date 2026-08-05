"use client";

import { LayoutGrid, LineChart } from "lucide-react";
import { useState } from "react";

import { SeletorDePosto } from "../checkin/seletor-de-posto";
import { GestaoMobile } from "./gestao-mobile";

// PORTA DE ENTRADA no celular para quem é GESTOR (todo login do hub é gestor). Duas escolhas:
// OPERAÇÃO (o fluxo de hoje: escolher posto e bipar a fila) ou GESTÃO (indicadores, bip da
// jornada e reservas seguradas). Operador freela (login de operador, sem hub) NÃO passa por aqui
// — ele entra pelo /evento. Ver [[project_prometeu_perfil_gestao]].
//
// A escolha NÃO fica guardada de propósito: é um toque só, e o gestor alterna entre operar e
// gerir no dia. Dentro da Gestão há "Trocar" para voltar aqui.
type Modo = "escolha" | "operacao" | "gestao";

export function EntradaGestorMobile() {
  const [modo, setModo] = useState<Modo>("escolha");

  if (modo === "operacao") return <SeletorDePosto onVoltar={() => setModo("escolha")} />;
  if (modo === "gestao") return <GestaoMobile onTrocarModo={() => setModo("escolha")} />;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 bg-[#0b1017] px-6 text-white">
      <p className="m-0 text-sm font-extrabold uppercase tracking-[0.22em] text-[#c9a15f]">
        Prometeu
      </p>

      <div className="grid w-full max-w-xs gap-4">
        <button
          className="flex flex-col items-center gap-3 rounded-3xl border border-white/10 bg-white/5 px-6 py-9 active:scale-[0.99]"
          onClick={() => setModo("operacao")}
          type="button"
        >
          <LayoutGrid className="size-8 text-white/85" />
          <span className="text-lg font-black">Operação</span>
        </button>
        <button
          className="flex flex-col items-center gap-3 rounded-3xl border border-[#c9a15f]/45 bg-gradient-to-b from-[#c9a15f]/16 to-[#c9a15f]/[0.04] px-6 py-9 active:scale-[0.99]"
          onClick={() => setModo("gestao")}
          type="button"
        >
          <LineChart className="size-8 text-[#c9a15f]" />
          <span className="text-lg font-black">Gestão</span>
        </button>
      </div>
    </div>
  );
}
