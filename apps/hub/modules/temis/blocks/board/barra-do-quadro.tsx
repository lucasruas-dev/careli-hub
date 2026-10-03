"use client";

import {
  ArrowDownAZ,
  ArrowDownUp,
  Building2,
  CalendarArrowDown,
  Check,
  Clock,
  ClockAlert,
  Hourglass,
  ListFilter,
  type LucideIcon,
  MailX,
  PenLine,
  Search,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  type DonoDoCard,
  FILTROS_VAZIOS,
  type FiltrosDoQuadro,
  ORDEM_PADRAO,
  type OrdemDoQuadro,
  ORDENS_DO_QUADRO,
  quantosFiltrosLigados,
} from "@/lib/temis/filtro-do-quadro";

// A BARRA DO QUADRO DA TÊMIS: pesquisa, filtros e ordem (03/10/2026). Porte do mockup aprovado pelo
// Lucas (`docs/mockups/temis-quadro-busca-filtro-ordem.html`): mesmas classes, mesmos rótulos. A
// lógica mora em `lib/temis/filtro-do-quadro.ts`, com teste; aqui é só o desenho.
//
// ⚠️ GRAFITE E PRETO NO ATIVO (`bg-inverse text-brand-ink`), e nada de dourado para estado. Ícone com
// `title`, pouco texto na tela.
//
// ⚠️ OS PAINÉIS SÃO `absolute` DENTRO DO QUADRO, e isso só é seguro porque eles abrem com a tela de
// trabalho FECHADA: com ela aberta, o quadro liga `overflow-hidden` e cortaria o painel. A barra fica
// por baixo do overlay, sem clique possível, então os dois nunca convivem.

const ICONE_DA_ORDEM: Record<OrdemDoQuadro, LucideIcon> = {
  etapa: Hourglass,
  nome: ArrowDownAZ,
  recentes: CalendarArrowDown,
  vencidos: ClockAlert,
};

const LIGADO = "border-transparent bg-inverse text-brand-ink";
const DESLIGADO = "border-line text-ink-muted hover:bg-subtle";

type Painel = "filtro" | "ordem" | null;

export function BarraDoQuadro({
  aoMudarFiltros,
  aoMudarOrdem,
  aoPesquisar,
  comDono,
  empreendimentos,
  filtros,
  ordem,
  pesquisa,
}: {
  aoMudarFiltros: (filtros: FiltrosDoQuadro) => void;
  aoMudarOrdem: (ordem: OrdemDoQuadro) => void;
  aoPesquisar: (texto: string) => void;
  /** O bloco "Quem confecciona" só existe na supervisão ("Ver também os do incorporador"). */
  comDono: boolean;
  empreendimentos: readonly { chave: string; nome: string }[];
  /** Os filtros que VALEM agora (`filtrosQueValem`), e não os guardados. */
  filtros: FiltrosDoQuadro;
  ordem: OrdemDoQuadro;
  pesquisa: string;
}) {
  const [painel, setPainel] = useState<Painel>(null);
  const barra = useRef<HTMLDivElement>(null);

  // Clique fora ou Esc fecha o painel aberto.
  useEffect(() => {
    if (!painel) return;
    const aoClicar = (e: MouseEvent) => {
      if (barra.current && !barra.current.contains(e.target as Node)) setPainel(null);
    };
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPainel(null);
    };
    document.addEventListener("mousedown", aoClicar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [painel]);

  const ligados = quantosFiltrosLigados(filtros);
  const nomeDaOrdem = ORDENS_DO_QUADRO.find((o) => o.id === ordem)?.nome ?? "";
  const alternar = (qual: Exclude<Painel, null>) => setPainel((atual) => (atual === qual ? null : qual));
  const trocarEmpreendimento = (chave: string) =>
    aoMudarFiltros({
      ...filtros,
      empreendimentos: filtros.empreendimentos.includes(chave)
        ? filtros.empreendimentos.filter((e) => e !== chave)
        : [...filtros.empreendimentos, chave],
    });

  return (
    <div className="ml-auto flex w-full items-center gap-1.5 sm:w-auto" ref={barra}>
      <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 focus-within:border-ink/40 sm:w-64 sm:flex-none">
        <Search aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
        <input
          aria-label="Pesquisar no quadro"
          className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted [&::-webkit-search-cancel-button]:hidden"
          onChange={(e) => aoPesquisar(e.target.value)}
          placeholder="Nome, CPF, empreendimento, unidade"
          type="search"
          value={pesquisa}
        />
        {pesquisa ? (
          <button
            aria-label="Limpar a pesquisa"
            className="shrink-0 rounded-full p-0.5 text-ink-muted hover:bg-subtle"
            onClick={() => aoPesquisar("")}
            title="Limpar a pesquisa"
            type="button"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </label>

      <div className="relative">
        <button
          aria-expanded={painel === "filtro"}
          aria-label={ligados ? `Filtros (${ligados} ligados)` : "Filtros"}
          className={`relative flex size-8 items-center justify-center rounded-full border ${ligados ? LIGADO : DESLIGADO}`}
          onClick={() => alternar("filtro")}
          title="Filtros"
          type="button"
        >
          <ListFilter aria-hidden="true" className="size-4" />
          {ligados ? (
            <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-inverse px-1 text-center text-[0.6rem] font-bold leading-4 text-brand-ink ring-2 ring-surface">
              {ligados}
            </span>
          ) : null}
        </button>
        {painel === "filtro" ? (
          <div
            className="absolute right-0 top-10 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-3 shadow-lg"
            role="dialog"
            aria-label="Filtros do quadro"
          >
            <p className="mb-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-ink-muted">Empreendimento</p>
            <div className="flex flex-wrap gap-1.5">
              {empreendimentos.map((e) => (
                <button
                  aria-pressed={filtros.empreendimentos.includes(e.chave)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                    filtros.empreendimentos.includes(e.chave) ? LIGADO : DESLIGADO
                  }`}
                  key={e.chave}
                  onClick={() => trocarEmpreendimento(e.chave)}
                  type="button"
                >
                  {e.nome}
                </button>
              ))}
            </div>

            <p className="mb-1.5 mt-3 text-[0.65rem] font-bold uppercase tracking-wide text-ink-muted">Situação</p>
            <div className="flex flex-wrap gap-1.5">
              <Alternavel
                icone={Clock}
                ligado={filtros.prazoVencido}
                nome="Prazo vencido"
                onClick={() => aoMudarFiltros({ ...filtros, prazoVencido: !filtros.prazoVencido })}
                titulo="O relógio vermelho: a etapa passou do prazo nosso."
              />
              <Alternavel
                icone={MailX}
                ligado={filtros.conviteDevolvido}
                nome="Convite devolvido"
                onClick={() => aoMudarFiltros({ ...filtros, conviteDevolvido: !filtros.conviteDevolvido })}
                titulo="O e-mail de um signatário voltou."
              />
              <Alternavel
                icone={PenLine}
                ligado={filtros.compradorPendente}
                nome="Comprador pendente"
                onClick={() => aoMudarFiltros({ ...filtros, compradorPendente: !filtros.compradorPendente })}
                titulo="Em assinatura, com comprador que ainda não assinou."
              />
            </div>

            {comDono ? (
              <>
                <p className="mb-1.5 mt-3 text-[0.65rem] font-bold uppercase tracking-wide text-ink-muted">
                  Quem confecciona
                </p>
                <div className="inline-flex rounded-full border border-line p-0.5">
                  {(
                    [
                      [null, "Todos"],
                      ["careli", "Careli"],
                      ["incorporador", "Incorporador"],
                    ] as const satisfies readonly (readonly [DonoDoCard | null, string])[]
                  ).map(([valor, nome]) => (
                    <button
                      aria-pressed={filtros.dono === valor}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        filtros.dono === valor ? "bg-inverse text-brand-ink" : "text-ink-muted"
                      }`}
                      key={nome}
                      onClick={() => aoMudarFiltros({ ...filtros, dono: valor })}
                      type="button"
                    >
                      {nome}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="relative">
        <button
          aria-expanded={painel === "ordem"}
          aria-label={`Ordem: ${nomeDaOrdem}`}
          className={`flex size-8 items-center justify-center rounded-full border ${
            ordem !== ORDEM_PADRAO ? LIGADO : DESLIGADO
          }`}
          onClick={() => alternar("ordem")}
          title={`Ordem: ${nomeDaOrdem}`}
          type="button"
        >
          <ArrowDownUp aria-hidden="true" className="size-4" />
        </button>
        {painel === "ordem" ? (
          <div
            className="absolute right-0 top-10 z-30 w-60 rounded-xl border border-line bg-surface p-1 shadow-lg"
            role="menu"
          >
            {ORDENS_DO_QUADRO.map((o) => {
              const Icone = ICONE_DA_ORDEM[o.id];
              const escolhida = o.id === ordem;
              return (
                <button
                  aria-checked={escolhida}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold ${
                    escolhida ? "bg-black/[0.045] text-ink dark:bg-white/[0.07]" : "text-ink-muted hover:bg-subtle"
                  }`}
                  key={o.id}
                  onClick={() => {
                    aoMudarOrdem(o.id);
                    setPainel(null);
                  }}
                  role="menuitemradio"
                  type="button"
                >
                  <Icone aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="flex-1">{o.nome}</span>
                  {escolhida ? <Check aria-hidden="true" className="size-3.5" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Alternavel({
  icone: Icone,
  ligado,
  nome,
  onClick,
  titulo,
}: {
  icone: LucideIcon;
  ligado: boolean;
  nome: string;
  onClick: () => void;
  titulo: string;
}) {
  return (
    <button
      aria-pressed={ligado}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${ligado ? LIGADO : DESLIGADO}`}
      onClick={onClick}
      title={titulo}
      type="button"
    >
      <Icone aria-hidden="true" className="size-3.5" />
      {nome}
    </button>
  );
}

/**
 * Os filtros ligados, cada um com o seu x, e o "Limpar" no fim. Sem filtro ligado, nada.
 *
 * ⚠️ É O QUE EXPLICA UMA COLUNA VAZIA. O filtro é guardado e volta na próxima abertura: sem a
 * etiqueta à vista, quem abre o quadro amanhã veria "Nada aqui" sem saber por quê.
 */
export function FiltrosLigados({
  aoMudarFiltros,
  empreendimentos,
  filtros,
}: {
  aoMudarFiltros: (filtros: FiltrosDoQuadro) => void;
  empreendimentos: readonly { chave: string; nome: string }[];
  filtros: FiltrosDoQuadro;
}) {
  const etiquetas: { icone: LucideIcon; nome: string; tirar: () => void }[] = [
    ...filtros.empreendimentos.map((chave) => ({
      icone: Building2,
      nome: empreendimentos.find((e) => e.chave === chave)?.nome ?? chave,
      tirar: () => aoMudarFiltros({ ...filtros, empreendimentos: filtros.empreendimentos.filter((e) => e !== chave) }),
    })),
    ...(filtros.prazoVencido
      ? [{ icone: Clock, nome: "Prazo vencido", tirar: () => aoMudarFiltros({ ...filtros, prazoVencido: false }) }]
      : []),
    ...(filtros.conviteDevolvido
      ? [{ icone: MailX, nome: "Convite devolvido", tirar: () => aoMudarFiltros({ ...filtros, conviteDevolvido: false }) }]
      : []),
    ...(filtros.compradorPendente
      ? [{ icone: PenLine, nome: "Comprador pendente", tirar: () => aoMudarFiltros({ ...filtros, compradorPendente: false }) }]
      : []),
    ...(filtros.dono
      ? [
          {
            icone: Users,
            nome: filtros.dono === "incorporador" ? "Incorporador" : "Careli",
            tirar: () => aoMudarFiltros({ ...filtros, dono: null }),
          },
        ]
      : []),
  ];

  if (etiquetas.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {etiquetas.map(({ icone: Icone, nome, tirar }) => (
        <span
          className="flex items-center gap-1 rounded-full bg-inverse py-0.5 pl-2 pr-1 text-[0.7rem] font-semibold text-brand-ink"
          key={nome}
        >
          <Icone aria-hidden="true" className="size-3" />
          {nome}
          <button
            aria-label={`Tirar o filtro ${nome}`}
            className="rounded-full p-0.5 hover:bg-white/20 dark:hover:bg-black/15"
            onClick={tirar}
            title={`Tirar o filtro ${nome}`}
            type="button"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      <button
        className="rounded-full px-2 py-0.5 text-[0.7rem] font-semibold text-ink-muted underline-offset-2 hover:underline"
        onClick={() => aoMudarFiltros(FILTROS_VAZIOS)}
        type="button"
      >
        Limpar
      </button>
    </div>
  );
}
