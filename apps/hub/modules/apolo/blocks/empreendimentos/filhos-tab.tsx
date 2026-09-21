"use client";

import { Layers, Loader2, Plus } from "lucide-react";
import { useState } from "react";

import type { ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import {
  NovoProduto,
  type OperadorPossivel,
  type PaiPossivel,
} from "@/modules/incorporador/hercules/NovoProduto";

import { lerUniverso } from "./vinculo-de-unidades";

// OS FILHOS DO PRODUTO — e quantas unidades cada um tem.
//
// Lucas (07/09/2026), na ficha do Lagoa Bonita: *"acho que pode até vir aqui uma aba filhos"*,
// *"trazer os filhos com suas respectivas unidades"*. Em 21/09/2026 a aba desceu para dentro do
// Setup (*"categoria - filhos tem que está dentro do setup"*) e o nome voltou a ser FILHO
// (*"em vez etapas, pode deixar Filho"*, *"essa é a nossa nomenclatura"*).
//
// ⚠️ A FICHA CONSOLIDADA ESCONDE DE ONDE VEM O NÚMERO. O topo do Lagoa Bonita diz 412 unidades, e
// esse 412 é a soma de LBF, LBP e LBR — três empreendimentos no C2X que a tela junta numa linha só.
// Quem olha a ficha não tem como saber que são três, nem quanto cada um pesa; e é justamente por
// filho que o estoque acaba e a venda muda de comportamento.
//
// ⚠️ ELE NÃO É A CATEGORIA. O filho é como o LEGADO dividia um empreendimento — criar três produtos
// para separar o que é um só. A categoria (Condomínio, Loteamento) é o recorte nosso, e atravessa os
// filhos: *"o Condomínio e o Loteamento não interfere nos filhos, é tudo junto"*.

const inteiro = (n: number) => n.toLocaleString("pt-BR");

const dinheiro = (n: number) =>
  n.toLocaleString("pt-BR", { currency: "BRL", maximumFractionDigits: 0, style: "currency" });

export function FilhosTab({ row }: { row: ApoloEnterpriseRow }) {
  const filhos = row.stages;
  const total = filhos.reduce((soma, e) => soma + e.scenario.total.units, 0);

  return (
    <div className="grid gap-4">
      <NovoFilho row={row} />

      {filhos.length === 0 ? (
        <p className="m-0 rounded-2xl border border-dashed border-line px-4 py-3 text-sm text-ink-muted">
          {row.name} não tem filhos: é um empreendimento único, e todas as unidades penduram nele.
        </p>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
              <Layers aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <h4 className="m-0 text-sm font-semibold text-ink">
                Os {filhos.length} filhos de {row.name}
              </h4>
              <p className="m-0 mt-0.5 text-xs text-ink-muted">
                {inteiro(total)} unidades no total. Cada filho é um empreendimento no C2X — é assim
                que o legado dividia um produto. As categorias, quando existem, atravessam todos.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-subtle/30 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2.5">Filho</th>
                  <th className="px-3 py-2.5 text-right">Unidades</th>
                  <th className="px-3 py-2.5 text-right">Disponível</th>
                  <th className="px-3 py-2.5 text-right">Vendido</th>
                  <th className="px-3 py-2.5 text-right">Bloqueado</th>
                  <th className="px-4 py-2.5 text-right">VGV</th>
                </tr>
              </thead>
              <tbody>
                {filhos.map((filho) => (
                  <tr className="border-b border-line/70 last:border-b-0" key={filho.id}>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-ink-muted">{filho.code}</span>
                      <span className="ml-2 text-sm font-semibold text-ink">{filho.name}</span>
                      {filho.city ? (
                        <span className="ml-2 text-xs text-ink-muted">{filho.city}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {inteiro(filho.scenario.total.units)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                      {inteiro(filho.scenario.disponivel.units)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-sky-700 dark:text-sky-400">
                      {inteiro(filho.scenario.vendido.units)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-rose-700 dark:text-rose-400">
                      {inteiro(filho.scenario.bloqueado.units)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {dinheiro(filho.scenario.total.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-subtle/30 text-sm font-semibold">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{inteiro(total)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {inteiro(row.scenario.disponivel.units)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {inteiro(row.scenario.vendido.units)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {inteiro(row.scenario.bloqueado.units)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {dinheiro(row.scenario.total.value)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * O FILHO NOVO NASCE AQUI, DENTRO DO PAI.
 *
 * Lucas (21/09/2026), perguntando onde se cadastra: *"Claude, onde eu cadastro o filho, as
 * categorias?"* e, em seguida, *"categoria - filhos tem que está dentro do setup"*. Até aqui o filho
 * só nascia pelo "Novo produto" da lista, com o código do pai digitado de cabeça — quem estava
 * dentro da ficha do pai tinha de sair dela e lembrar o código.
 *
 * ⚠️ O PAI VEM DO SERVIDOR, E NÃO DA LINHA DA TELA. Na ficha consolidada o `code` é rótulo ("LBF +
 * LBR + LBP"), não chave; quem sabe qual é a raiz é o cadastro, e a mesma resposta do vínculo já
 * carrega a família inteira com o `pai: true` marcado.
 *
 * ⚠️ E QUEM OPERA VIAJA JUNTO: o cadastro recusa pendurar um filho da Careli num pai do portal do
 * cliente (e vice-versa). Sem a lista, a janela não teria como escolher, e a recusa só apareceria
 * depois de preencher o formulário inteiro.
 */
function NovoFilho({ row }: { row: ApoloEnterpriseRow }) {
  const [preparando, setPreparando] = useState(false);
  const [janela, setJanela] = useState<null | {
    codigosExistentes: string[];
    operadores: OperadorPossivel[];
    pai: PaiPossivel;
  }>(null);
  const [recado, setRecado] = useState<null | { texto: string; tom: "erro" | "ok" }>(null);

  async function abrir() {
    setRecado(null);
    setPreparando(true);
    try {
      const token = await getApoloAccessToken();
      const [universo, incorporadores] = await Promise.all([
        lerUniverso({ codigo: row.codes?.[0] ?? row.code, enterpriseId: row.id }),
        fetch("/api/apolo/incorporadores", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(async (r) => (r.ok ? ((await r.json()) as unknown) : null))
          .catch(() => null),
      ]);

      if ("erro" in universo) {
        setRecado({ texto: universo.erro, tom: "erro" });
        return;
      }

      const pai = universo.data.divisoes.find((d) => d.pai);
      if (!pai) {
        setRecado({
          texto: "Não consegui descobrir qual é o empreendimento principal desta família.",
          tom: "erro",
        });
        return;
      }

      const lista = (incorporadores as null | { data?: { incorporadores?: unknown[] } })?.data
        ?.incorporadores;
      const operadores = (Array.isArray(lista) ? lista : [])
        .map((i) => i as { ativo?: boolean; nome?: string; slug?: string })
        .filter((i) => i.ativo !== false && i.nome?.trim() && i.slug?.trim())
        .map((i) => ({ nome: String(i.nome).trim(), slug: String(i.slug).trim() }));

      setJanela({
        codigosExistentes: universo.data.divisoes.map((d) => d.codigo),
        operadores,
        pai: { codigo: pai.codigo, nome: pai.nome },
      });
    } catch {
      setRecado({ texto: "Não foi possível abrir o cadastro agora. Tente de novo.", tom: "erro" });
    } finally {
      setPreparando(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-semibold text-canvas disabled:opacity-60"
        disabled={preparando}
        onClick={() => void abrir()}
        type="button"
      >
        {preparando ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Plus aria-hidden="true" className="size-4" />
        )}
        Novo filho
      </button>
      <p className="m-0 text-xs text-ink-muted">
        O filho nasce pendurado neste empreendimento e recebe as unidades dele. Produto que já vende
        com estoque próprio não pode virar pai: o cadastro recusa e diz o motivo.
      </p>

      {recado ? (
        <p
          className={`m-0 basis-full rounded-lg border px-3 py-2 text-xs ${
            recado.tom === "erro"
              ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
              : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
          }`}
        >
          {recado.texto}
        </p>
      ) : null}

      {janela ? (
        <NovoProduto
          aberto
          aoCriar={(criado) => {
            setJanela(null);
            setRecado({
              texto: `Filho ${criado.codigo} criado. Atualize a lista de empreendimentos para vê-lo aqui.`,
              tom: "ok",
            });
          }}
          aoFechar={() => setJanela(null)}
          codigosExistentes={janela.codigosExistentes}
          endpoint="/api/apolo/empreendimentos/novo"
          operadores={janela.operadores}
          paiInicial={janela.pai.codigo}
          pais={[janela.pai]}
          semToken={false}
        />
      ) : null}
    </div>
  );
}
