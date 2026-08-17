"use client";

import { AlertTriangle, Info, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// LOG ERROS — quem tentou enviar CAD ou se credenciar e NÃO conseguiu.
//
// Pedido do Lucas (17/08/2026): "uma imobiliária tentou subir a CAD e deu erro, teria como ter essa
// visão? Tinha que pegar desde o início, quando informa o CPF, imobiliária."
//
// ⚠️ SÓ QUEM NÃO PASSOU. O sucesso já está registrado: é a CAD que aparece na fila de Validação do
// Board (observação dele). O que falta é o outro lado — quem tentou e não conseguiu, que hoje some
// sem rastro.
//
// A leitura sai de `apolo_cad_log_erros`, alimentada no `responder()` das 14 rotas públicas.
//
// ⚠️ DUAS NATUREZAS NA MESMA LISTA, e a tela precisa separá-las:
//   • ERRO (status ≥400) — a pessoa viu a mensagem em vermelho e pode tentar de novo;
//   • BARREIRA (status 200) — a resposta foi cordial, mas o fluxo ACABOU ali. "Fale com a nossa
//     central", "CNPJ não credenciado". A pessoa não viu erro nenhum, e é o caso mais grave: é
//     lead perdido em silêncio. Aqui a mensagem é o motivo INTERNO, não o texto que apareceu na
//     tela dela (o portal não diz o motivo de propósito, para não virar oráculo de enumeração).

type Item = {
  corretor_cpf_mascarado: null | string;
  corretor_nome: null | string;
  created_at: string;
  duracao_ms: null | number;
  enterprise_nome: null | string;
  id: string;
  // No credenciamento a imobiliária ainda NÃO tem ficha, então o CNPJ mascarado é o único
  // identificador que a linha tem. Sem ele a coluna "Quem" ficaria vazia no fluxo inteiro.
  imobiliaria_cnpj_mascarado: null | string;
  imobiliaria_nome: null | string;
  mensagem: null | string;
  origem_hash: null | string;
  rota: string;
  status: number;
};

type LinhaDeResumo = { nome: string; total: number };

type Payload = {
  indisponivel?: string;
  itens: Item[];
  // ⚠️ OPCIONAIS DE PROPÓSITO: quando a migration ainda não rodou no ambiente, a rota devolve só
  // `itens` e `indisponivel`. Sem isso, `dados.porMotivo.length` estoura antes da tela conseguir
  // mostrar o aviso de indisponível.
  porImobiliaria?: LinhaDeResumo[];
  porMotivo?: LinhaDeResumo[];
  porRota?: LinhaDeResumo[];
  semSaidaNoPeriodo?: number;
  totalNoPeriodo?: number;
  truncado?: boolean;
};

const PERIODOS = [
  { dias: 1, label: "24 horas" },
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
] as const;

/** A rota diz em que PASSO a pessoa travou — é a informação mais útil da linha. */
function passoDaRota(rota: string): string {
  if (rota.includes("/checar-cpf")) return "Informou o CPF";
  if (rota.includes("/cad/corretor")) return "Cadastro do corretor";
  if (rota.includes("/cad/creci")) return "CRECI";
  if (rota.includes("/cad/sessao")) return "Abriu o link";
  if (rota.includes("/cad/imobiliaria")) return "Escolheu a imobiliária";
  if (rota.includes("/cad/empreendimentos")) return "Escolheu o empreendimento";
  if (rota.includes("/cad/ocr")) return "Leitura do documento";
  if (rota.includes("/cad/upload-url")) return "Anexou arquivo";
  if (rota.includes("/cad/salvar")) return "Enviou a CAD";
  if (rota.includes("/imobiliaria/iniciar")) return "Credenciamento: CNPJ";
  if (rota.includes("/imobiliaria/cadastro")) return "Credenciamento: cadastro";
  if (rota.includes("/imobiliaria/credenciar")) return "Credenciamento: habilitar";
  return rota;
}

/**
 * Agrupa as rotas pelo passo que elas representam.
 *
 * ⚠️ O agrupamento é DEPOIS da tradução, não antes: `/cad/imobiliaria` e `/cad/imobiliarias` viram
 * o mesmo passo, e somar só na hora de exibir deixaria duas linhas com o mesmo rótulo (e a mesma
 * chave de lista no React).
 */
function porPasso(rotas: LinhaDeResumo[]): LinhaDeResumo[] {
  const mapa = new Map<string, number>();
  for (const rota of rotas) {
    const passo = passoDaRota(rota.nome);
    mapa.set(passo, (mapa.get(passo) ?? 0) + rota.total);
  }
  return [...mapa.entries()]
    .map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total);
}

function quando(iso: string): string {
  const data = new Date(iso);
  const minutos = Math.floor((Date.now() - data.getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  if (minutos < 60 * 24) return `há ${Math.floor(minutos / 60)}h`;
  return data.toLocaleString("pt-BR", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "2-digit" });
}

export function LogErrosView() {
  const [dias, setDias] = useState<number>(7);
  const [dados, setDados] = useState<null | Payload>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(`/api/apolo/log-erros?dias=${dias}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await resposta.json()) as { data?: Payload; error?: string };

      if (!resposta.ok) {
        setErro(corpo.error ?? "Não foi possível carregar o log.");
        return;
      }
      setDados(corpo.data ?? null);
    } catch {
      setErro("Falha ao carregar o log.");
    } finally {
      setCarregando(false);
    }
  }, [dias]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Quantos pararam SEM ver erro: é o número que decide se alguém precisa ligar para a imobiliária.
  //
  // ⚠️ OS DOIS NÚMEROS VÊM DO SERVIDOR, sobre o mesmo período. Antes o "sem saída" era contado
  // sobre a página (500 no máximo) e aparecia na mesma frase que o total do período — dois
  // denominadores diferentes lado a lado, sugerindo uma proporção que não existia.
  const total = dados?.totalNoPeriodo ?? dados?.itens.length ?? 0;
  const semSaida = dados?.semSaidaNoPeriodo ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-base font-bold text-ink">Log Erros</h1>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            Quem tentou enviar CAD ou se credenciar e não conseguiu, desde a tela do CPF. Quem
            conseguiu aparece no Board, como CAD na fila de validação. As linhas marcadas como{" "}
            <span className="font-semibold text-ink-soft">sem saída</span> são as mais graves: a
            pessoa não viu erro nenhum e o fluxo dela terminou ali.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {PERIODOS.map((periodo) => (
            <button
              className={`h-8 rounded-lg px-3 text-xs font-semibold transition-colors ${
                dias === periodo.dias
                  ? "bg-inverse text-brand-ink"
                  : "border border-line text-ink-soft hover:bg-subtle"
              }`}
              key={periodo.dias}
              onClick={() => setDias(periodo.dias)}
              type="button"
            >
              {periodo.label}
            </button>
          ))}
          <button
            aria-label="Atualizar"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-line text-ink-soft hover:bg-subtle"
            onClick={() => void carregar()}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={carregando ? "size-4 animate-spin" : "size-4"} />
          </button>
        </div>
      </header>

      {erro ? (
        <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {erro}
        </p>
      ) : null}

      {dados?.indisponivel ? (
        <p className="m-0 flex items-start gap-2 rounded-xl bg-subtle px-4 py-3 text-sm text-ink-soft">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {dados.indisponivel}
        </p>
      ) : null}

      {dados && !dados.indisponivel ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Resumo
              itens={dados.porMotivo ?? []}
              titulo="O que mais barrou"
              vazio="Nenhuma recusa no período."
            />
            <Resumo
              itens={dados.porImobiliaria ?? []}
              titulo="Imobiliárias que mais travaram"
              vazio="Nenhuma identificada."
            />
            <Resumo
              itens={porPasso(dados.porRota ?? [])}
              titulo="Em que passo trava"
              vazio="Sem dados."
            />
          </div>

          <section className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-line bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <h2 className="m-0 text-sm font-semibold text-ink">
                {total} tentativa{total === 1 ? "" : "s"} sem sucesso
                {semSaida > 0 ? (
                  <span className="ml-2 font-normal text-ink-muted">
                    · {semSaida} sem saída (a pessoa não viu erro e parou ali)
                  </span>
                ) : null}
              </h2>
              {dados.truncado ? (
                <span className="shrink-0 text-[11px] text-ink-muted">
                  lista e resumos: as {dados.itens.length} mais recentes
                </span>
              ) : null}
            </div>

            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr>
                    <Th>Quando</Th>
                    <Th>Passo</Th>
                    <Th>Quem</Th>
                    <Th>Empreendimento</Th>
                    <Th>O que barrou</Th>
                  </tr>
                </thead>
                <tbody>
                  {dados.itens.map((item) => (
                    <tr className="border-t border-line hover:bg-subtle" key={item.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-muted">
                        {quando(item.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink">
                        {passoDaRota(item.rota)}
                      </td>
                      <td className="px-3 py-2">
                        {/* No credenciamento a imobiliária ainda não tem ficha: o CNPJ é o único
                            identificador que existe. Sem ele a coluna ficaria "—" no fluxo todo. */}
                        <span className="block truncate text-ink">
                          {item.imobiliaria_nome ??
                            item.corretor_nome ??
                            item.imobiliaria_cnpj_mascarado ??
                            "—"}
                        </span>
                        {item.corretor_cpf_mascarado ? (
                          <span className="block text-[11px] text-ink-muted">
                            {item.corretor_cpf_mascarado}
                          </span>
                        ) : item.imobiliaria_nome && item.imobiliaria_cnpj_mascarado ? (
                          <span className="block text-[11px] text-ink-muted">
                            {item.imobiliaria_cnpj_mascarado}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-ink-soft">{item.enterprise_nome ?? "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-2">
                          <Selo barreira={item.status < 400} />
                          <span className="text-ink-soft">
                            {item.mensagem ?? `Erro ${item.status}`}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {dados.itens.length === 0 ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-ink-muted" colSpan={5}>
                        Nenhuma tentativa recusada no período. Ou está tudo funcionando, ou ninguém
                        tentou.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {carregando && !dados ? (
        <p className="m-0 flex items-center gap-2 text-sm text-ink-muted">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          Carregando…
        </p>
      ) : null}
    </div>
  );
}

/**
 * Distingue a parede silenciosa do erro visível.
 *
 * "Sem saída" é o caso mais grave: a pessoa recebeu resposta cordial, não viu erro nenhum e o
 * fluxo dela acabou ali. Quem lê a tela precisa ver isso de relance, senão trata igual a um
 * campo mal preenchido e não vai atrás.
 */
function Selo({ barreira }: { barreira: boolean }) {
  return barreira ? (
    <span className="mt-0.5 shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
      Sem saída
    </span>
  ) : (
    <span className="mt-0.5 shrink-0 rounded-md bg-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
      Erro
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
      {children}
    </th>
  );
}

function Resumo({
  itens,
  titulo,
  vazio,
}: {
  itens: LinhaDeResumo[];
  titulo: string;
  vazio: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {titulo}
      </h3>
      {itens.length === 0 ? (
        <p className="m-0 text-xs text-ink-muted">{vazio}</p>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {itens.map((item) => (
            <li className="flex items-baseline justify-between gap-3 text-sm" key={item.nome}>
              <span className="min-w-0 truncate text-ink-soft" title={item.nome}>
                {item.nome}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-ink">{item.total}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
