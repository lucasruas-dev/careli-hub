"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronRight, Info, RefreshCw, UserRound } from "lucide-react";

import { diaNaTela } from "@/lib/apolo/incorporador/dia-na-tela";
import type {
  ClienteDoCorretor,
  ImobiliariaDoProduto,
  ImobiliariasDoProduto as PayloadDeImobiliarias,
  SituacaoDaCad,
  SituacaoDaImobiliaria,
} from "@/lib/apolo/incorporador/imobiliarias-do-produto";
import { fonte } from "@/modules/publico/ui/tokens";

import { useTemaDoPortal } from "../tema";

// IMOBILIÁRIAS DO PRODUTO — a aba processual da ficha do Hércules.
//
// Lucas (02/09/2026): *"deixa imobiliárias separado para a gente visualizar as imobiliárias
// habilitadas, com os corretores com os clientes (cads credenciadas, enviadas, erradas, ou seja
// uma visão processual das cads)"*. Uma linha por imobiliária com as contagens; a linha abre e
// mostra os corretores e, sob cada um, os clientes com a etapa e quando o cadastro chegou.
//
// TAILWIND DENTRO DO PORTAL. As classes do hub (bg-surface, text-ink, border-line…) resolvem para
// `--color-*`, que o @theme aponta para os tokens `--uix-*` do HUB — o tema do hub, não o do
// portal. A moldura `.inc-imob-produto` redefine cada `--color-*` para o `--inc-*` correspondente
// (mesmo truque da TelaLancamento), e carrega `data-uix-theme` com o tema EFETIVO do portal para
// as variantes `dark:` (chips coloridos) escurecerem junto. Ver a nota longa em TelaContratos.tsx.
//
// ⚠️ O RECORTE NÃO VEM DA TELA. O `emp` que sobe é o id que o painel de produtos devolveu, e a
// rota cruza com o escopo da sessão de novo do outro lado (fora do escopo = 404).

type Filtro = null | SituacaoDaImobiliaria;

const CSS_IMOBILIARIAS = `
  .inc-imob-produto {
    --color-canvas: var(--inc-page);
    --color-surface: var(--inc-card);
    --color-raised: var(--inc-card);
    --color-subtle: var(--inc-soft);
    --color-inverse: var(--inc-btn-bg);
    --color-ink: var(--inc-text);
    --color-ink-soft: var(--inc-sub);
    --color-ink-muted: var(--inc-muted);
    --color-line: var(--inc-border);
    --color-line-strong: var(--inc-border);
    --color-brand: var(--inc-gold);
    --color-brand-ink: var(--inc-btn-fg);
    color: var(--inc-text);
  }
`;

const ROTULO_DA_IMOBILIARIA: Record<SituacaoDaImobiliaria, string> = {
  aguardando: "Aguardando habilitação",
  habilitada: "Habilitada",
};

// As cores por situação, no par claro/escuro do hub. `em_andamento` é o neutro: é o estado normal
// de uma CAD, e pintar o normal de amarelo faria a tabela inteira parecer alerta.
const CHIP_DA_CAD: Record<SituacaoDaCad, string> = {
  com_erro: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  credenciada: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  em_andamento: "bg-subtle text-ink-soft",
  nao_seguiu: "bg-subtle text-ink-muted line-through decoration-ink-muted/60",
};

const CHIP_DA_IMOBILIARIA: Record<SituacaoDaImobiliaria, string> = {
  aguardando: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  habilitada: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

const inteiro = (valor: number): string => valor.toLocaleString("pt-BR");

/** 12345678000199 → 12.345.678/0001-99 (só para ler; o dado trafega sem máscara). */
function cnpjNaTela(documento: null | string): null | string {
  const digitos = String(documento ?? "").replace(/\D/g, "");
  if (digitos.length !== 14) return documento;
  return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function ImobiliariasDoProduto({ emp }: { emp: string }) {
  const { efetivo } = useTemaDoPortal();

  const [dados, setDados] = useState<null | PayloadDeImobiliarias>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);
  // Contador de tentativas: o "Tentar de novo" só precisa mudar isto para o efeito rodar outra vez.
  const [tentativa, setTentativa] = useState(0);
  const [filtro, setFiltro] = useState<Filtro>(null);
  const [abertas, setAbertas] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);

    (async () => {
      try {
        const resposta = await fetch(
          `/api/incorporador/produto/imobiliarias?emp=${encodeURIComponent(emp)}`,
          { cache: "no-store" },
        );
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: PayloadDeImobiliarias; error?: string }
          | null;

        if (!vivo) return;

        if (!resposta.ok || !corpo?.data) {
          setErro(corpo?.error ?? "Não foi possível carregar as imobiliárias.");
          return;
        }

        setDados(corpo.data);
      } catch {
        if (vivo) setErro("Não foi possível carregar as imobiliárias.");
      } finally {
        if (vivo) setCarregando(false);
      }
    })();

    return () => {
      vivo = false;
    };
  }, [emp, tentativa]);

  const visiveis = useMemo(() => {
    const lista = dados?.imobiliarias ?? [];
    return filtro ? lista.filter((imobiliaria) => imobiliaria.situacao === filtro) : lista;
  }, [dados, filtro]);

  const alternarAberta = (id: string) =>
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });

  return (
    <div
      className="inc-imob-produto grid gap-4"
      data-uix-theme={efetivo === "escuro" ? "dark" : "light"}
      style={{ fontFamily: fonte }}
    >
      <style>{CSS_IMOBILIARIAS}</style>

      {/* ── CHIPS-FILTRO: Habilitadas · N / Aguardando habilitação · N ─────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <ChipFiltro
          ativo={filtro === "habilitada"}
          onClick={() => setFiltro((atual) => (atual === "habilitada" ? null : "habilitada"))}
          quantidade={dados?.habilitadas ?? 0}
          rotulo="Habilitadas"
          tom="habilitada"
        />
        <ChipFiltro
          ativo={filtro === "aguardando"}
          onClick={() => setFiltro((atual) => (atual === "aguardando" ? null : "aguardando"))}
          quantidade={dados?.aguardando ?? 0}
          rotulo="Aguardando habilitação"
          tom="aguardando"
        />
        {filtro ? (
          <button
            className="text-xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            onClick={() => setFiltro(null)}
            type="button"
          >
            Limpar filtro
          </button>
        ) : null}
      </div>

      {/* ── ESTADOS: carregando / erro / vazio ─────────────────────────────────── */}
      {carregando ? (
        <p className="m-0 flex items-center gap-2 text-sm text-ink-muted">
          <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
          Carregando imobiliárias…
        </p>
      ) : null}

      {!carregando && erro ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <span>{erro}</span>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink-soft hover:border-[#A07C3B]/40 hover:text-ink"
            onClick={() => setTentativa((n) => n + 1)}
            type="button"
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
            Tentar de novo
          </button>
        </div>
      ) : null}

      {!carregando && !erro && dados && dados.imobiliarias.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center">
          <Building2 aria-hidden="true" className="mx-auto mb-2 size-6 text-ink-muted" />
          <p className="m-0 text-sm font-medium text-ink">
            Nenhuma imobiliária vinculada a este produto ainda.
          </p>
          <p className="m-0 mt-1 text-xs text-ink-muted">
            As imobiliárias aparecem aqui assim que pedem habilitação para vender neste produto.
          </p>
        </div>
      ) : null}

      {!carregando && !erro && dados && dados.imobiliarias.length > 0 && visiveis.length === 0 ? (
        <p className="m-0 rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-ink-muted">
          Nenhuma imobiliária nesta situação.
        </p>
      ) : null}

      {/* ── A TABELA ────────────────────────────────────────────────────────────── */}
      {!carregando && !erro && visiveis.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[920px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-subtle/60 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2.5 text-left">Imobiliária</th>
                <th className="px-3 py-2.5 text-left">Situação</th>
                <th className="px-3 py-2.5 text-right">Corretores</th>
                <th className="px-3 py-2.5 text-right">CADs enviadas</th>
                <th className="px-3 py-2.5 text-right">Credenciadas</th>
                <th className="px-3 py-2.5 text-right">Em andamento</th>
                <th className="px-3 py-2.5 text-right">Com erro</th>
                <th className="px-4 py-2.5 text-right">Vendas</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((imobiliaria) => (
                <LinhaDaImobiliaria
                  aberta={abertas.has(imobiliaria.id)}
                  imobiliaria={imobiliaria}
                  key={imobiliaria.id}
                  onAlternar={() => alternarAberta(imobiliaria.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* CADs que chegaram sem imobiliária com vínculo vigente: não somem, mas não são linha
          desta tabela. O aviso existe para a soma das linhas não "bater errado" com o board. */}
      {!carregando && !erro && dados && dados.cadsForaDaLista > 0 ? (
        <p className="m-0 flex items-start gap-2 text-xs text-ink-muted">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {inteiro(dados.cadsForaDaLista)}{" "}
            {dados.cadsForaDaLista === 1 ? "cadastro chegou" : "cadastros chegaram"} sem
            imobiliária com vínculo vigente neste produto. {dados.cadsForaDaLista === 1 ? "Ele aparece" : "Eles aparecem"} na
            aba Cadastro.
          </span>
        </p>
      ) : null}
    </div>
  );
}

function ChipFiltro({
  ativo,
  onClick,
  quantidade,
  rotulo,
  tom,
}: {
  ativo: boolean;
  onClick: () => void;
  quantidade: number;
  rotulo: string;
  tom: SituacaoDaImobiliaria;
}) {
  return (
    <button
      aria-pressed={ativo}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        ativo
          ? "border-[#A07C3B] bg-[#A07C3B]/12 text-ink shadow-[inset_0_0_0_1px_#A07C3B]"
          : "border-line bg-surface text-ink-soft hover:border-[#A07C3B]/40 hover:text-ink"
      }`}
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${tom === "habilitada" ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      {rotulo}
      <span className="text-ink-muted">·</span>
      <span className="tabular-nums">{inteiro(quantidade)}</span>
    </button>
  );
}

function LinhaDaImobiliaria({
  aberta,
  imobiliaria,
  onAlternar,
}: {
  aberta: boolean;
  imobiliaria: ImobiliariaDoProduto;
  onAlternar: () => void;
}) {
  const { contagens } = imobiliaria;
  const temCad = contagens.enviadas > 0;
  const documento = cnpjNaTela(imobiliaria.documento);

  return (
    <>
      <tr
        aria-expanded={aberta}
        className={`border-b border-line/70 transition-colors last:border-b-0 ${
          temCad ? "cursor-pointer hover:bg-[#A07C3B]/8" : ""
        } ${aberta ? "bg-[#A07C3B]/10 shadow-[inset_3px_0_0_#A07C3B]" : ""}`}
        onClick={temCad ? onAlternar : undefined}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            {temCad ? (
              <button
                aria-label={aberta ? "Recolher corretores" : "Ver corretores e clientes"}
                className="flex size-5 shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-ink-muted transition-colors hover:border-[#A07C3B]/40 hover:text-[#7A5E2C] dark:hover:text-[#d9b877]"
                onClick={(event) => {
                  event.stopPropagation();
                  onAlternar();
                }}
                type="button"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={`size-3.5 transition-transform ${aberta ? "rotate-90" : ""}`}
                />
              </button>
            ) : (
              <span className="size-5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="m-0 truncate text-sm font-semibold text-ink">{imobiliaria.nome}</p>
              <p className="m-0 truncate text-xs text-ink-muted">
                {documento ?? "Sem CNPJ no cadastro"}
              </p>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5">
          <Chip className={CHIP_DA_IMOBILIARIA[imobiliaria.situacao]}>
            {ROTULO_DA_IMOBILIARIA[imobiliaria.situacao]}
          </Chip>
        </td>
        <Numero valor={imobiliaria.corretores.length} />
        <Numero forte valor={contagens.enviadas} />
        <Numero tom="bom" valor={contagens.credenciadas} />
        <Numero valor={contagens.emAndamento} />
        <Numero tom="alerta" valor={contagens.comErro} />
        <Numero classe="px-4" forte valor={contagens.vendas} />
      </tr>

      {aberta ? (
        <tr className="border-b border-line/70 bg-subtle/40 last:border-b-0">
          <td className="px-4 py-3 pl-11" colSpan={8}>
            <div className="grid gap-3">
              {imobiliaria.corretores.map((corretor) => (
                <BlocoDoCorretor
                  clientes={corretor.clientes}
                  key={corretor.nome}
                  nome={corretor.nome}
                />
              ))}
              {contagens.naoSeguiu > 0 ? (
                <p className="m-0 text-[11px] text-ink-muted">
                  {inteiro(contagens.naoSeguiu)}{" "}
                  {contagens.naoSeguiu === 1 ? "cadastro não seguiu" : "cadastros não seguiram"}{" "}
                  — {contagens.naoSeguiu === 1 ? "ele conta" : "eles contam"} em CADs enviadas, mas
                  não em credenciadas, em andamento ou com erro.
                </p>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BlocoDoCorretor({ clientes, nome }: { clientes: ClienteDoCorretor[]; nome: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line/70 px-3 py-2">
        <UserRound aria-hidden="true" className="size-4 text-ink-muted" />
        <p className="m-0 text-sm font-semibold text-ink">{nome}</p>
        <span className="text-xs text-ink-muted">
          · {inteiro(clientes.length)} {clientes.length === 1 ? "cliente" : "clientes"}
        </span>
      </div>
      <ul className="m-0 list-none p-0">
        {clientes.map((cliente) => (
          <li
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line/50 px-3 py-1.5 last:border-b-0"
            key={cliente.entityId}
          >
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{cliente.nome}</span>
            <Chip className={CHIP_DA_CAD[cliente.situacao]}>{cliente.rotulo}</Chip>
            <span className="text-xs tabular-nums text-ink-muted">
              chegou em {diaNaTela(cliente.chegouEm, "data não informada")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Numero({
  classe = "px-3",
  forte = false,
  tom,
  valor,
}: {
  classe?: string;
  forte?: boolean;
  tom?: "alerta" | "bom";
  valor: number;
}) {
  // Zero fica apagado: a tabela é para achar o que está acontecendo, e zero não é acontecimento.
  // Cor só quando há o que apontar (credenciada em verde, erro em vermelho).
  const cor =
    valor === 0
      ? "text-ink-muted/60"
      : tom === "alerta"
        ? "text-red-700 dark:text-red-300"
        : tom === "bom"
          ? "text-emerald-700 dark:text-emerald-300"
          : forte
            ? "text-ink"
            : "text-ink-soft";

  return (
    <td className={`${classe} py-2.5 text-right tabular-nums ${forte ? "font-semibold" : ""} ${cor}`}>
      {inteiro(valor)}
    </td>
  );
}

function Chip({ children, className }: { children: string; className: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${className}`}
    >
      {children}
    </span>
  );
}
