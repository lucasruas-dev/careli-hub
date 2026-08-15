"use client";

// AS DUAS CENTRAIS, como subtelas do Board.
//
// Decisão do Lucas (15/08/2026): "board poderia ser a tela principal, ae teria duas subtelas,
// atendimento e relacionamento". A primeira versão punha isto na sidebar, acima do menu, e ficava
// confuso: a palavra "Atendimento" aparecia como central E como aba de dentro do board, e na
// sidebar recolhida os dois blocos de ícone viravam uma coluna só.
//
// Aqui a hierarquia fica explícita e na ordem em que a pessoa pensa:
//   Board  ->  [ Atendimento | Relacionamento ]  ->  [ Conversas · E-mail · Grupos · Ações ]

import {
  Building2,
  Handshake,
  Headphones,
  Layers,
  type LucideIcon,
} from "lucide-react";

import {
  IRIS_CENTRAL_DESCRICAO,
  IRIS_CENTRAL_LABEL_CURTO,
  type IrisCentralSelecionada,
} from "../../lib/centrais";

// Headset x aperto de mão: quem ATENDE o cliente final x quem se RELACIONA com o parceiro.
// O prédio foi para a Gurgel, onde ele diz o que precisa dizer: a central é de UMA empresa.
const ICONE: Record<IrisCentralSelecionada, LucideIcon> = {
  atendimento: Headphones,
  gurgel: Building2,
  relacionamento: Handshake,
  todas: Layers,
};

export function IrisCentralTabs({
  central,
  disponiveis,
  naoLidasPorCentral,
  onSelect,
}: {
  central: IrisCentralSelecionada;
  disponiveis: IrisCentralSelecionada[];
  // Não lidas de cada central, para ver movimento na outra sem precisar entrar.
  naoLidasPorCentral: Partial<Record<IrisCentralSelecionada, number>>;
  onSelect: (central: IrisCentralSelecionada) => void;
}) {
  // Uma central só (ou nenhuma) não vira controle: não há o que escolher.
  if (disponiveis.length < 2) {
    return null;
  }

  return (
    <div
      role="tablist"
      aria-label="Central"
      className="flex shrink-0 flex-wrap items-stretch gap-1.5"
    >
      {disponiveis.map((item) => {
        const Icon = ICONE[item];
        const ativa = item === central;
        const naoLidas = naoLidasPorCentral[item] ?? 0;

        return (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={ativa}
            onClick={() => onSelect(item)}
            className={[
              "group inline-flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-[#d0ad69]",
              ativa
                ? "border-[#A07C3B]/55 bg-[#A07C3B]/[0.09] text-ink shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
                : "border-line/70 bg-surface text-ink-soft hover:border-line-strong hover:text-ink",
            ].join(" ")}
          >
            <span
              className={[
                "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                ativa
                  ? "bg-[#A07C3B]/15 text-[#A07C3B]"
                  : "bg-black/[0.04] text-ink-muted dark:bg-white/[0.06]",
              ].join(" ")}
            >
              <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
            </span>

            <span className="grid min-w-0 gap-0.5">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold leading-tight">
                  {IRIS_CENTRAL_LABEL_CURTO[item]}
                </span>
                {naoLidas > 0 ? (
                  <span
                    title={`${naoLidas} sem ler`}
                    className={[
                      "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                      ativa
                        ? "bg-[#A07C3B] text-white"
                        : "bg-[#A07C3B]/15 text-[#7A5E2C]",
                    ].join(" ")}
                  >
                    {naoLidas}
                  </span>
                ) : null}
              </span>
              <span className="truncate text-[10px] leading-tight text-ink-muted">
                {IRIS_CENTRAL_DESCRICAO[item]}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
