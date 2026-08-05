"use client";

import { useEffect, useState } from "react";
import { Timer } from "lucide-react";

import { calcularEspera, classesDaEspera } from "../../lib/espera";

// CRONÔMETRO DE ESPERA — quanto tempo o cliente está sem retorno, contando AO VIVO.
//
// Pedido do Lucas em 26/07: "quero um cronômetro quando o cliente manda mensagem para a gente,
// visualmente a gente ver quanto tempo o cliente está sem interação".
//
// Ele fica no cabeçalho da conversa, onde a operadora olha o tempo todo enquanto responde. Usa a
// mesma regra do resto da tela (modules/caredesk/lib/espera): só conta quando a bola é NOSSA e
// só em horário comercial, então nunca vai mostrar "3 dias" por causa de um fim de semana nem
// acusar quem já respondeu e está esperando o cliente voltar.
//
// Atualiza a cada 30s: o rótulo tem resolução de minuto, então atualizar mais que isso só gastaria
// render sem mudar nada na tela.
const INTERVALO_MS = 30_000;

export function IrisCronometroEspera({
  bolaConosco,
  desde,
}: {
  bolaConosco: boolean;
  desde: string | null | undefined;
}) {
  const [tique, setTique] = useState(0);

  useEffect(() => {
    // Bola com o cliente: não há o que cronometrar, e sem timer o componente não custa nada.
    if (!bolaConosco || !desde) {
      return;
    }

    const timer = setInterval(() => {
      setTique((atual) => atual + 1);
    }, INTERVALO_MS);

    return () => clearInterval(timer);
  }, [bolaConosco, desde]);

  // `tique` não entra na conta: ele existe só para forçar o recálculo do "agora".
  void tique;

  const espera = calcularEspera({ bolaConosco, desde });

  if (espera.faixa === "sem_espera") {
    return null;
  }

  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
        classesDaEspera(espera.faixa),
      ].join(" ")}
      title={
        espera.faixa === "atrasado"
          ? "O cliente está esperando há muito tempo (conta só o horário comercial)"
          : "Tempo que o cliente está esperando resposta (conta só o horário comercial)"
      }
    >
      <Timer className="size-3" aria-hidden="true" />
      {espera.rotulo}
    </span>
  );
}
