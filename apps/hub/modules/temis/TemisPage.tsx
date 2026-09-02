"use client";

import { AlertTriangle, Building2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ApoloEnterpriseRow, ApoloEnterprisesData } from "@/lib/apolo/empreendimentos";
import { temisScreens, type TemisScreen } from "@/lib/temis/catalog";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import { MinutasTab } from "@/modules/apolo/blocks/empreendimentos/minutas-tab";
import { TemisSidebar } from "@/modules/temis/blocks/shell/temis-sidebar";
import { TemisBoard } from "@/modules/temis/blocks/board/temis-board";
import { TemisKanban } from "@/modules/temis/blocks/board/temis-kanban";

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
            // O Setup com uma minuta aberta não rola por fora: quem rola é o editor, que precisa
            // da altura toda.
            tela === "setup"
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
            // ⚠️ O BOARD VIROU O KANBAN DO TRABALHO. Antes ele mostrava quantos planos e minutas
            // cada empreendimento tinha — informação de Setup, olhada uma vez por empreendimento.
            // Quem passa o dia em contrato precisa ver o que está na mão dele hoje. O que o board
            // antigo mostrava não se perdeu: virou a tela Setup, onde é o lugar dele.
            <div className="p-3">
              <TemisKanban enterpriseId={escolhido?.id ?? null} />
            </div>
          ) : (
            <Setup
              aoAbrirEmpreendimento={escolher}
              empreendimentos={empreendimentos ?? []}
              escolhido={escolhido}
            />
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

// ⚠️ O QUE ERA O BOARD VIROU O SETUP, e não foi jogado fora. A pergunta que ele responde — "este
// empreendimento consegue contratar hoje?" — é boa e continua valendo; ela só não é a pergunta de
// quem passa o dia em contrato, que precisa saber o que está na mão dele agora. Aqui ela está no
// lugar certo: é conferência de configuração, feita uma vez por empreendimento.
// ⚠️ OS QUATRO DOCUMENTOS DO EMPREENDIMENTO, cada um na sua aba. Pedido do Lucas (02/09/2026):
// *"tem a aba de minuta - termos de cessão - termo de distrato - termo de cancelamento"*.
//
// ⚠️ SÃO ABAS, E NÃO UMA LISTA SÓ FILTRADA. Uma lista com os quatro tipos misturados faria alguém
// publicar como contrato o texto que encerra contrato — e o erro só apareceria no primeiro distrato
// gerado, com o documento já na mão do cliente.
const ABAS_DE_DOCUMENTO: { rotulo: string; tipo: string }[] = [
  { rotulo: "Minuta do contrato", tipo: "contrato" },
  { rotulo: "Termo de cessão", tipo: "cessao" },
  { rotulo: "Termo de distrato", tipo: "distrato" },
  { rotulo: "Termo de cancelamento", tipo: "cancelamento" },
];

// ⚠️ O QUE ERA O BOARD VIROU O SETUP, e não foi jogado fora: a pergunta "este empreendimento
// consegue contratar hoje?" continua valendo, ela só não é a de quem passa o dia em contrato.
// Aqui ela está no lugar certo — conferência de configuração, feita uma vez por empreendimento.
//
// ⚠️ E AS MINUTAS VIVEM AQUI DENTRO: *"acho que minutas tem que está dentro de setup"*. Eram duas
// telas pedindo a mesma escolha de empreendimento para mostrar metade da resposta cada uma.
function Setup({
  aoAbrirEmpreendimento,
  empreendimentos,
  escolhido,
}: {
  aoAbrirEmpreendimento: (id: string) => void;
  empreendimentos: ApoloEnterpriseRow[];
  escolhido: ApoloEnterpriseRow | null;
}) {
  const [aba, setAba] = useState<string>("contrato");

  if (!escolhido) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <p className="m-0 max-w-prose px-1 text-xs text-ink-soft">
          Escolha um empreendimento no seletor acima para ver e editar os documentos dele. A lista
          abaixo mostra o que cada um já tem cadastrado.
        </p>
        <TemisBoard
          aoAbrirEmpreendimento={aoAbrirEmpreendimento}
          empreendimentos={empreendimentos}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap gap-1 border-b border-line px-3 pt-3">
        {ABAS_DE_DOCUMENTO.map((x) => (
          <button
            className={`rounded-t-lg px-3 py-1.5 text-sm font-semibold ${
              aba === x.tipo
                ? "bg-surface text-ink shadow-[inset_0_-2px_0_0_currentColor]"
                : "text-ink-muted hover:text-ink"
            }`}
            key={x.tipo}
            onClick={() => setAba(x.tipo)}
            type="button"
          >
            {x.rotulo}
          </button>
        ))}
      </div>

      {/* ⚠️ A `key` LEVA O TIPO JUNTO. Sem ela, trocar de aba reaproveitaria o componente com a
          minuta anterior ainda aberta no editor — e o texto do distrato apareceria sob o título
          de contrato. */}
      <MinutasTab
        enterpriseId={escolhido.id}
        key={`${escolhido.id}:${aba}`}
        name={escolhido.name}
        tipo={aba}
      />
    </div>
  );
}
