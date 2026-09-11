"use client";

import { AlertTriangle, Check, ChevronRight, CircleDot, Clock } from "lucide-react";
import { useMemo, useState } from "react";

import type { ItemDoRoadmap, SituacaoDoItem } from "@/lib/roadmap/roadmap";

import {
  contarPorSituacao,
  FRENTE_ATUAL,
  modulosDoRoadmap,
  PANTEON_ROADMAP,
} from "@/lib/roadmap/roadmap";

// O ROADMAP DO PANTEON, NA TELA DO ZEUS.
//
// Lucas (11/09/2026): *"quero criar essa tela de backlog, roadmap... assim a gente sabe o que fez o
// que está para ser feito e o que estamos fazendo"*, *"quero ela técnica, nos padrões de empresas
// de TI moderna"* e *"conectada a ti, quando entregarmos algo, tem que ser atualizado"*.
//
// ⚠️ ELA LÊ UM ARQUIVO, E NÃO UM BANCO. A fonte é `lib/roadmap/roadmap.ts`, no molde do
// `changelog.ts` — decisão do próprio Lucas: *"podemos criar um arquivo de roadmap e backlog que
// durante a nossa interação eu vou apontar, para vc, coloca isso no back... e esse arquivo
// alimentar a tela"*. É o que faz a tela ser "conectada" de verdade: eu escrevo no arquivo no meio
// da conversa, o commit registra quando e por quê, e a tela mostra. Um board editável aqui exigiria
// banco, e no primeiro dia o banco e o arquivo diriam coisas diferentes.
//
// ⚠️ POR ISSO ELA É SÓ LEITURA, e isso é a escolha, não uma limitação a consertar depois.
//
// ⚠️ A ORDEM DOS GRUPOS É A ORDEM DA PERGUNTA QUE SE FAZ AO ABRIR. Primeiro o que trava (não anda
// sem alguém decidir), depois o que está em curso, depois o que dá para pegar agora. "Depois" e
// "entregue" ficam no fim: um é o que não depende de nós, o outro é o que já passou.

const ORDEM: SituacaoDoItem[] = ["bloqueado", "fazendo", "proximo", "depois", "entregue"];

const ROTULO: Record<SituacaoDoItem, string> = {
  bloqueado: "Travado",
  depois: "Depois",
  entregue: "Entregue",
  fazendo: "Fazendo",
  proximo: "Próximo",
};

/** A explicação de cada grupo. Sem isto, "depois" e "próximo" viram a mesma coisa na cabeça de quem lê. */
const EXPLICA: Record<SituacaoDoItem, string> = {
  bloqueado: "Espera decisão ou ação de alguém. Não é falta de tempo.",
  depois: "Depende de algo que ainda não existe.",
  entregue: "Está no ar ou commitado.",
  fazendo: "Começado e não terminado.",
  proximo: "Nada impede — é só fazer.",
};

const ICONE: Record<SituacaoDoItem, typeof Check> = {
  bloqueado: AlertTriangle,
  depois: Clock,
  entregue: Check,
  fazendo: CircleDot,
  proximo: ChevronRight,
};

/**
 * ⚠️ A COR SEGUE O QUE A SITUAÇÃO PEDE DE QUEM OLHA, e não uma escala bonita: vermelho para o que
 * precisa de decisão, âmbar para o que está aberto na mão de alguém, verde para o que acabou. O
 * resto é neutro de propósito — se tudo tiver cor, nada chama atenção.
 */
const COR: Record<SituacaoDoItem, string> = {
  bloqueado: "text-rose-600 dark:text-rose-300",
  depois: "text-ink-muted",
  entregue: "text-emerald-700 dark:text-emerald-300",
  fazendo: "text-amber-600 dark:text-amber-300",
  proximo: "text-ink-soft",
};

export function PainelDoRoadmap() {
  const [situacao, setSituacao] = useState<null | SituacaoDoItem>(null);
  const [modulo, setModulo] = useState<null | string>(null);
  const [aberto, setAberto] = useState<null | string>(null);

  const contagem = useMemo(() => contarPorSituacao(), []);
  const modulos = useMemo(() => modulosDoRoadmap(), []);

  const visiveis = useMemo(
    () =>
      PANTEON_ROADMAP.filter(
        (i) => (!situacao || i.situacao === situacao) && (!modulo || i.modulo === modulo),
      ),
    [modulo, situacao],
  );

  return (
    <div className="grid gap-4">
      <FrenteAtual />

      {/* ⚠️ OS NÚMEROS SÃO O FILTRO, e não um placar ao lado dele. Dois controles para a mesma
          coisa (ler quantos e ver quais) é uma chance de eles discordarem. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
        {ORDEM.map((s) => {
          const Icone = ICONE[s];
          const ativo = situacao === s;
          return (
            <button
              aria-pressed={ativo}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                ativo
                  ? "border-line-strong bg-subtle"
                  : "border-line bg-surface hover:border-line-strong"
              }`}
              key={s}
              onClick={() => setSituacao(ativo ? null : s)}
              title={EXPLICA[s]}
              type="button"
            >
              <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${COR[s]}`}>
                <Icone aria-hidden="true" className="size-3.5" />
                {ROTULO[s]}
              </div>
              <div className="mt-0.5 text-xl font-bold tabular-nums text-ink">{contagem[s]}</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip ativo={!modulo} onClick={() => setModulo(null)} rotulo="Todos" />
        {modulos.map((m) => (
          <Chip ativo={modulo === m} key={m} onClick={() => setModulo(m)} rotulo={m} />
        ))}
        <span className="ml-auto text-[11px] tabular-nums text-ink-muted">
          {visiveis.length} {visiveis.length === 1 ? "item" : "itens"}
        </span>
      </div>

      <div className="grid gap-4">
        {ORDEM.filter((s) => visiveis.some((i) => i.situacao === s)).map((s) => (
          <section key={s}>
            <h3 className={`m-0 mb-1.5 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wide ${COR[s]}`}>
              {ROTULO[s]}
              <span className="font-normal normal-case tracking-normal text-ink-muted">
                {EXPLICA[s]}
              </span>
            </h3>
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              {visiveis
                .filter((i) => i.situacao === s)
                .map((item, indice) => (
                  <Linha
                    aberto={aberto === item.id}
                    aoAlternar={() => setAberto(aberto === item.id ? null : item.id)}
                    item={item}
                    key={item.id}
                    primeira={indice === 0}
                  />
                ))}
            </div>
          </section>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <p className="m-0 py-10 text-center text-sm text-ink-muted">
          Nada com esses filtros.
        </p>
      ) : null}

      <p className="m-0 text-[11px] leading-relaxed text-ink-muted">
        A fonte é <code className="rounded bg-subtle px-1 py-0.5">apps/hub/lib/roadmap/roadmap.ts</code>,
        versionada no git — o histórico de cada item está lá, com o commit que o mudou. Esta tela é
        leitura: quem escreve é o Zeus, no fluxo do trabalho.
      </p>
    </div>
  );
}

/**
 * O QUE ESTAMOS ATACANDO AGORA.
 *
 * ⚠️ FICA NO TOPO E É O ÚNICO BLOCO COM DESTAQUE. Uma tela de 92 itens sem foco declarado é uma
 * lista; com o foco em cima, ela vira uma pergunta respondida ("o que estamos fazendo?") antes de
 * qualquer rolagem.
 */
function FrenteAtual() {
  const itens = PANTEON_ROADMAP.filter((i) => FRENTE_ATUAL.itens.includes(i.id));

  return (
    <section className="rounded-xl border-2 border-line-strong bg-raised p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="m-0 text-sm font-semibold text-ink">
          <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Frente atual
          </span>
          {FRENTE_ATUAL.titulo}
        </h2>
        <span className="text-[11px] tabular-nums text-ink-muted">desde {dataBR(FRENTE_ATUAL.desde)}</span>
      </div>

      <p className="m-0 mt-1.5 text-xs leading-relaxed text-ink-soft">{FRENTE_ATUAL.porque}</p>

      {itens.length > 0 ? (
        <ul className="m-0 mt-2.5 grid list-none gap-1 p-0">
          {itens.map((i) => (
            <li className="flex items-baseline gap-2 text-xs text-ink" key={i.id}>
              <code className="shrink-0 text-[10.5px] text-ink-muted">{i.id}</code>
              <span className="min-w-0">{i.titulo}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Linha({
  aberto,
  aoAlternar,
  item,
  primeira,
}: {
  aberto: boolean;
  aoAlternar: () => void;
  item: ItemDoRoadmap;
  primeira: boolean;
}) {
  return (
    <div className={primeira ? "" : "border-t border-line"}>
      <button
        aria-expanded={aberto}
        className="flex w-full items-baseline gap-2.5 px-3 py-2 text-left transition-colors hover:bg-subtle"
        onClick={aoAlternar}
        type="button"
      >
        <code className="shrink-0 text-[10.5px] tabular-nums text-ink-muted">{item.id}</code>
        <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{item.titulo}</span>
        <span className="shrink-0 rounded bg-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
          {item.modulo}
        </span>
        {item.entregueEm ? (
          <span className="hidden shrink-0 text-[10.5px] tabular-nums text-ink-muted sm:inline">
            {dataBR(item.entregueEm)}
          </span>
        ) : null}
      </button>

      {aberto ? (
        <div className="grid gap-2 border-t border-line bg-canvas px-3 py-2.5">
          <Campo rotulo="Por quê" texto={item.porque} />
          {item.bloqueio ? <Campo alerta rotulo="O que impede" texto={item.bloqueio} /> : null}
          {/* ⚠️ A EVIDÊNCIA APARECE, e não fica só no arquivo: é ela que separa backlog de lista de
              desejos. Quem duvidar de um item tem onde conferir sem abrir o repositório. */}
          <Campo mono rotulo="Evidência" texto={item.evidencia} />
        </div>
      ) : null}
    </div>
  );
}

function Campo({
  alerta,
  mono,
  rotulo,
  texto,
}: {
  alerta?: boolean;
  mono?: boolean;
  rotulo: string;
  texto: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{rotulo}</div>
      <p
        className={`m-0 break-words text-xs leading-relaxed ${
          alerta ? "text-rose-600 dark:text-rose-300" : "text-ink-soft"
        } ${mono ? "font-mono text-[11px]" : ""}`}
      >
        {texto}
      </p>
    </div>
  );
}

function Chip({
  ativo,
  onClick,
  rotulo,
}: {
  ativo: boolean;
  onClick: () => void;
  rotulo: string;
}) {
  return (
    <button
      aria-pressed={ativo}
      className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
        ativo
          ? "border-line-strong bg-inverse text-surface"
          : "border-line bg-surface text-ink-soft hover:border-line-strong"
      }`}
      onClick={onClick}
      type="button"
    >
      {rotulo}
    </button>
  );
}

/**
 * `2026-09-11` → `11/09`.
 *
 * ⚠️ FATIA A STRING, não constrói `Date`. A data vem sem hora, e `new Date("2026-09-11")` é lido
 * como meia-noite UTC — que no fuso de São Paulo (−03:00) é o dia 10 às 21h. A tela mostraria o dia
 * anterior em toda entrega.
 */
function dataBR(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return dia && mes ? `${dia}/${mes}` : (ano ?? iso);
}
