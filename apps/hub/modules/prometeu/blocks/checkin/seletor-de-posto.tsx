"use client";

import { ChevronLeft, DoorOpen, LayoutGrid, ScanLine, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

import { CheckinView, type PostoDoOrganizador } from "./checkin-view";

// ONDE O ORGANIZADOR ESCOLHE O POSTO, no celular.
//
// O trilho físico do dia tem TRÊS pontos de QR e até agora só a recepção tinha tela: quem
// ficasse no salão ou na secretaria não tinha onde bipar. Esta tela é a porta de entrada.
//
// Por que a escolha FICA GUARDADA: o organizador passa o dia inteiro no mesmo posto. Perguntar
// de novo a cada vez que ele volta ao app (ou quando a tela do celular apaga e ele reabre) é
// atrito puro, e ainda arrisca ele escolher errado na pressa. Guardamos e deixamos "Trocar de
// posto" à mão, sempre visível no rodapé.
const CHAVE_DO_POSTO = "prometeu:posto-do-organizador";

const POSTOS: {
  descricao: string;
  icone: typeof DoorOpen;
  id: PostoDoOrganizador;
  titulo: string;
}[] = [
  {
    descricao: "Quem chega ao evento. Monta a fila de espera.",
    icone: DoorOpen,
    id: "recepcao",
    titulo: "Recepção",
  },
  {
    descricao: "Confirma quem foi chamado. Barra quem não foi.",
    icone: ScanLine,
    id: "salao",
    titulo: "Salão",
  },
  {
    descricao: "Registra quem chegou para fechar negócio.",
    icone: LayoutGrid,
    id: "secretaria",
    titulo: "Secretaria",
  },
];

export function SeletorDePosto({ onVoltar }: { onVoltar?: () => void } = {}) {
  const [posto, setPosto] = useState<PostoDoOrganizador | null>(null);
  // `null` enquanto lê o armazenamento: sem isso a tela de escolha PISCA para quem já escolheu,
  // porque o primeiro render acontece antes de o navegador responder.
  const [lendoEscolha, setLendoEscolha] = useState(true);

  useEffect(() => {
    const guardado = window.localStorage.getItem(CHAVE_DO_POSTO);

    if (POSTOS.some((p) => p.id === guardado)) {
      setPosto(guardado as PostoDoOrganizador);
    }

    setLendoEscolha(false);
  }, []);

  function escolher(escolhido: PostoDoOrganizador) {
    window.localStorage.setItem(CHAVE_DO_POSTO, escolhido);
    setPosto(escolhido);
  }

  function trocar() {
    window.localStorage.removeItem(CHAVE_DO_POSTO);
    setPosto(null);
  }

  if (lendoEscolha) {
    return <div className="h-full bg-[#0b1017]" />;
  }

  if (posto) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[#0b1017]">
        <div className="min-h-0 flex-1">
          <CheckinView key={posto} posto={posto} />
        </div>
        <button
          className="flex shrink-0 items-center justify-center gap-2 border-t border-white/10 bg-[#0b1017] py-3 text-xs font-semibold text-white/60"
          onClick={trocar}
          type="button"
        >
          <Undo2 aria-hidden="true" className="size-3.5" />
          Trocar de posto
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col justify-center bg-[#0b1017] px-5 text-white">
      {onVoltar ? (
        <button
          className="absolute left-4 top-4 flex items-center gap-1 text-xs font-semibold text-white/55"
          onClick={onVoltar}
          type="button"
        >
          <ChevronLeft aria-hidden="true" className="size-4" /> Voltar
        </button>
      ) : null}
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[#c9a15f]">
        Prometeu
      </p>
      <h1 className="m-0 mt-1 text-2xl font-black leading-tight">
        Onde você está?
      </h1>
      <p className="m-0 mt-2 text-sm text-white/60">
        Escolha o seu posto. Fica guardado até você trocar.
      </p>

      <div className="mt-6 grid gap-3">
        {POSTOS.map((opcao) => {
          const Icone = opcao.icone;

          return (
            <button
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition active:scale-[0.99]"
              key={opcao.id}
              onClick={() => escolher(opcao.id)}
              type="button"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#c9a15f]/15 text-[#c9a15f]">
                <Icone aria-hidden="true" className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-bold">{opcao.titulo}</span>
                <span className="block text-xs text-white/55">
                  {opcao.descricao}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
