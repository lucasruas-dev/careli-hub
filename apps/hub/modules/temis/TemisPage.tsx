"use client";

import { AlertTriangle, Building2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ApoloEnterpriseRow, ApoloEnterprisesData } from "@/lib/apolo/empreendimentos";
import { temisScreens, type TemisScreen } from "@/lib/temis/catalog";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import { MinutasTab } from "@/modules/apolo/blocks/empreendimentos/minutas-tab";
import { PlanosComerciaisTab } from "@/modules/apolo/blocks/empreendimentos/planos-comerciais-tab";
import { TemisSidebar } from "@/modules/temis/blocks/shell/temis-sidebar";
import { TemisBoard } from "@/modules/temis/blocks/board/temis-board";

// MÓDULO TÊMIS — contratos.
//
// Pedido do Lucas (01/09/2026): *"já leva isso para dentro da temis"*, *"de uma vez"*. Antes disso
// ele já tinha desenhado o módulo: *"Board, Inteligência de Dados, Setup"*, *"a ordem é Board
// primeiro"*.
//
// ⚠️ AS TELAS SÃO AS MESMAS DA FICHA DO EMPREENDIMENTO, e isso é de propósito. `MinutasTab` e
// `PlanosComerciaisTab` continuam funcionando dentro do Apolo — quem está olhando um empreendimento
// não deveria ter de trocar de módulo para ver a minuta dele. Aqui elas ganham o caminho direto,
// para quem passa o dia em contrato. Duas portas, uma implementação: se fossem duas cópias, uma
// delas envelheceria em silêncio.
//
// ⚠️ TUDO É POR EMPREENDIMENTO. Não existe "minuta da Careli": existe minuta do JDG, minuta do ACP.
// Por isso o seletor fica no topo e não é opcional — sem empreendimento escolhido, não há o que
// mostrar, e a tela diz isso em vez de abrir vazia.

const CHAVE_DO_EMPREENDIMENTO = "careli:temis-empreendimento";

export function TemisPage() {
  const [tela, setTela] = useState<TemisScreen>("board");
  const [recolhida, setRecolhida] = useState(false);

  const [empreendimentos, setEmpreendimentos] = useState<ApoloEnterpriseRow[] | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [escolhidoId, setEscolhidoId] = useState<null | string>(null);

  useEffect(() => {
    let cancelado = false;

    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const r = await fetch("/api/apolo/empreendimentos", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const corpo = (await r.json().catch(() => ({}))) as {
          data?: ApoloEnterprisesData;
          error?: string;
        };

        if (cancelado) return;

        if (!r.ok || !corpo.data) {
          setErro(corpo.error ?? "Não foi possível carregar os empreendimentos.");
          return;
        }

        // ⚠️ O ESPELHO FICA DE FORA. Linhas marcadas como `mirror` são o MESMO estoque de outras
        // (o Vale do Ouro histórico); deixá-las aqui faria o operador cadastrar a minuta na cópia.
        const linhas = corpo.data.rows.filter((row) => !row.mirror);
        setEmpreendimentos(linhas);

        // Retoma o último empreendimento, porque quem trabalha em contrato passa o dia no mesmo.
        const lembrado =
          typeof window === "undefined" ? null : window.localStorage.getItem(CHAVE_DO_EMPREENDIMENTO);
        const valido = linhas.find((row) => row.id === lembrado);
        setEscolhidoId(valido?.id ?? linhas[0]?.id ?? null);
      } catch {
        if (!cancelado) setErro("Falha ao carregar os empreendimentos.");
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  const escolhido = useMemo(
    () => empreendimentos?.find((row) => row.id === escolhidoId) ?? null,
    [empreendimentos, escolhidoId],
  );

  const escolher = (id: string) => {
    setEscolhidoId(id);
    try {
      window.localStorage.setItem(CHAVE_DO_EMPREENDIMENTO, id);
    } catch {
      // Navegador com armazenamento bloqueado: a tela funciona, só não lembra da próxima vez.
    }
  };

  return (
    <div
      className={`flex h-[calc(100dvh-3.25rem)] max-h-[calc(100dvh-3.25rem)] min-h-0 overflow-hidden bg-canvas text-ink transition-[padding-left] duration-300 ease-out ${
        recolhida ? "lg:pl-[72px]" : "lg:pl-60"
      }`}
    >
      <TemisSidebar
        aoAlternar={() => setRecolhida((v) => !v)}
        aoSelecionar={setTela}
        ativa={tela}
        recolhida={recolhida}
      />

      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4">
        <Cabecalho
          aoEscolher={escolher}
          empreendimentos={empreendimentos}
          escolhido={escolhido}
          tela={tela}
        />

        {erro ? (
          <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {erro}
          </p>
        ) : null}

        <section
          className={
            // Minutas não rola por fora: quem rola é o editor, que precisa da altura toda.
            tela === "minutas"
              ? "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface"
              : "min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface"
          }
        >
          {!empreendimentos && !erro ? (
            <p className="m-0 flex items-center gap-2 p-6 text-sm text-ink-muted">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Carregando os empreendimentos…
            </p>
          ) : tela === "board" ? (
            <TemisBoard aoAbrirEmpreendimento={escolher} empreendimentos={empreendimentos ?? []} />
          ) : !escolhido ? (
            <p className="m-0 p-6 text-sm text-ink-muted">
              Escolha um empreendimento no seletor acima.
            </p>
          ) : tela === "minutas" ? (
            <MinutasTab enterpriseId={escolhido.id} key={escolhido.id} name={escolhido.name} />
          ) : tela === "planos" ? (
            <PlanosComerciaisTab
              enterpriseId={escolhido.id}
              key={escolhido.id}
              name={escolhido.name}
            />
          ) : (
            <Setup />
          )}
        </section>
      </main>
    </div>
  );
}

function Cabecalho({
  aoEscolher,
  empreendimentos,
  escolhido,
  tela,
}: {
  aoEscolher: (id: string) => void;
  empreendimentos: ApoloEnterpriseRow[] | null;
  escolhido: ApoloEnterpriseRow | null;
  tela: TemisScreen;
}) {
  const descricao = temisScreens.find((t) => t.id === tela)?.description ?? "";

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="m-0 min-w-0 truncate text-xs text-ink-muted">{descricao}</p>

      {/* O Board mostra todos os empreendimentos de uma vez; nas demais telas o seletor manda. */}
      {tela === "board" ? null : (
        <label className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-ink-muted">
            <Building2 aria-hidden="true" className="size-4" />
          </span>
          <select
            className="h-9 min-w-56 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none focus:border-line-strong"
            disabled={!empreendimentos?.length}
            onChange={(e) => aoEscolher(e.target.value)}
            value={escolhido?.id ?? ""}
          >
            {(empreendimentos ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.code} · {row.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </header>
  );
}

function Setup() {
  return (
    <div className="grid gap-3 p-5">
      <h3 className="m-0 text-sm font-semibold text-ink">Setup da Têmis</h3>
      <p className="m-0 max-w-prose text-sm text-ink-muted">
        Ainda não há o que configurar aqui. A assinatura continua na D4Sign, e o vínculo entre plano
        e minuta é feito na tela de Planos — que é onde a decisão realmente acontece.
      </p>
      <p className="m-0 max-w-prose text-xs text-ink-soft">
        Esta tela existe para não quebrar o desenho do módulo. Quando houver configuração de verdade
        (numeração de contrato, cabeçalho e rodapé do PDF, prazo de assinatura), ela mora aqui.
      </p>
    </div>
  );
}
