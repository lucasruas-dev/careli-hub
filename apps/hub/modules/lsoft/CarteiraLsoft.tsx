"use client";

import { Loader2, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

import type {
  CadastroDoCliente,
  ClienteDaCarteira,
  ParcelaDaCarteira,
  ResumoDaCarteira,
} from "@/lib/lsoft/carteira";

// CARTEIRA DO LSOFT — Garden e Vale do Sol.
//
// Pedido do Lucas (19/08/2026): "preciso ver esses dados cadastrais, preciso ver as parcelas, se
// foi pago se não... um POC para trabalhar nessa integração com Apolo e C2X".
//
// ⚠️ A TELA DIZ DE QUANDO É O DADO, no cabeçalho. O LSoft é um Access na rede local da Cecílio: o
// que está aqui é o último sincronismo, não o sistema ao vivo. Sem esse carimbo, alguém decide
// cobrança olhando uma foto de ontem achando que é de agora.

const dinheiro = (valor: number) =>
  valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });

const dataBR = (iso: null | string) =>
  iso ? iso.split("-").reverse().join("/") : "—";

type Carteira = { clientes: ClienteDaCarteira[]; resumo: ResumoDaCarteira };
type Ficha = { cadastro: CadastroDoCliente; parcelas: ParcelaDaCarteira[] };

export function CarteiraLsoft() {
  const [carteira, setCarteira] = useState<Carteira | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [empreendimento, setEmpreendimento] = useState("");

  const [aberto, setAberto] = useState<null | string>(null);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [carregandoFicha, setCarregandoFicha] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const token = await getApoloAccessToken();
      const parametros = new URLSearchParams();
      if (buscaAtiva) parametros.set("q", buscaAtiva);
      if (empreendimento) parametros.set("emp", empreendimento);

      const resposta = await fetch(`/api/lsoft/carteira?${parametros}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await resposta.json().catch(() => null)) as
        | { data?: Carteira; error?: string }
        | null;

      if (!resposta.ok || !corpo?.data) {
        setErro(corpo?.error ?? `Falha ao ler a carteira (${resposta.status}).`);
      } else {
        setErro(null);
        setCarteira(corpo.data);
      }
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Falha ao ler a carteira.");
    }
    setCarregando(false);
  }, [buscaAtiva, empreendimento]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // A ficha só é buscada quando alguém abre: são ~20 mil parcelas na carteira inteira, e ninguém
  // abre todas de uma vez.
  useEffect(() => {
    if (!aberto) {
      setFicha(null);
      return;
    }

    let ativo = true;
    setCarregandoFicha(true);

    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const resposta = await fetch(`/api/lsoft/cliente/${aberto}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: Ficha; error?: string }
          | null;
        if (ativo && corpo?.data) setFicha(corpo.data);
      } finally {
        if (ativo) setCarregandoFicha(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [aberto]);

  const carimbo = carteira?.resumo.sincronizadoEm
    ? new Date(carteira.resumo.sincronizadoEm).toLocaleString("pt-BR", {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "2-digit",
      })
    : null;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-canvas">
      <header className="flex flex-wrap items-center gap-3 border-b border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
        <div className="min-w-0">
          <h1 className="m-0 text-base font-bold text-ink">Carteira LSoft</h1>
          <p className="m-0 text-xs text-ink-soft">
            Garden e Vale do Sol ·{" "}
            {carimbo ? `dados de ${carimbo}` : "aguardando o primeiro sincronismo"}
          </p>
        </div>

        <select
          className="ml-auto h-9 rounded-lg border border-black/10 bg-canvas px-3 text-sm text-ink dark:border-white/10"
          onChange={(evento) => setEmpreendimento(evento.target.value)}
          value={empreendimento}
        >
          <option value="">Todos os empreendimentos</option>
          <option value="Garden">Garden</option>
          <option value="Vale do Sol">Vale do Sol</option>
        </select>

        <form
          className="flex items-center gap-2"
          onSubmit={(evento) => {
            evento.preventDefault();
            setBuscaAtiva(busca.trim());
          }}
        >
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft"
              size={15}
            />
            <input
              className="h-9 w-[260px] rounded-lg border border-black/10 bg-canvas pl-8 pr-3 text-sm text-ink dark:border-white/10"
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Nome, CPF ou lote"
              value={busca}
            />
          </div>
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-semibold text-canvas"
            type="submit"
          >
            Buscar
          </button>
        </form>

        <button
          aria-label="Recarregar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-black/10 text-ink-soft dark:border-white/10"
          disabled={carregando}
          onClick={() => void carregar()}
          type="button"
        >
          {carregando ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
        </button>
      </header>

      <div className="grid gap-4 p-5">
        {erro ? (
          <p className="m-0 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {erro}
          </p>
        ) : null}

        {!carteira ? (
          carregando ? (
            <Esqueleto />
          ) : (
            <p className="rounded-xl border border-dashed border-black/[0.12] p-10 text-center text-sm text-ink-soft dark:border-white/[0.12]">
              Nada encontrado. Rode a carga do LSoft ou limpe a busca.
            </p>
          )
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <Indicador rotulo="Clientes" valor={String(carteira.resumo.clientes)} />
              <Indicador
                apoio={`${carteira.resumo.parcelasAbertas.toLocaleString("pt-BR")} parcelas`}
                rotulo="A receber"
                valor={dinheiro(carteira.resumo.saldoAberto)}
              />
              <Indicador
                apoio={`${carteira.resumo.parcelasVencidas.toLocaleString("pt-BR")} parcelas`}
                rotulo="Vencido"
                tom={carteira.resumo.saldoVencido > 0 ? "alerta" : undefined}
                valor={dinheiro(carteira.resumo.saldoVencido)}
              />
              <Indicador
                rotulo="Já recebido"
                tom="ok"
                valor={dinheiro(carteira.resumo.totalRecebido)}
              />
            </div>

            <div className="overflow-x-auto rounded-xl border border-black/[0.08] dark:border-white/[0.08]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-subtle text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
                    <th className="px-4 py-2.5 text-left font-semibold">Cliente</th>
                    <th className="px-4 py-2.5 text-left font-semibold">CPF</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Empreendimento</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Unidade</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Parcelas</th>
                    <th className="px-4 py-2.5 text-right font-semibold">A receber</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Vencido</th>
                  </tr>
                </thead>
                <tbody>
                  {carteira.clientes.map((cliente) => (
                    <tr
                      className="cursor-pointer border-t border-black/[0.06] hover:bg-subtle dark:border-white/[0.06]"
                      key={cliente.codigo}
                      onClick={() => setAberto(cliente.codigo)}
                    >
                      <td className="px-4 py-2.5 font-medium text-ink">{cliente.nome}</td>
                      <td className="px-4 py-2.5 tabular-nums text-ink-soft">
                        {cliente.cpfFormatado ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft">
                        {cliente.empreendimentos.join(" · ") || "—"}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-ink-soft">
                        {cliente.unidades.slice(0, 2).join(" · ") || "—"}
                        {cliente.unidades.length > 2 ? ` +${cliente.unidades.length - 2}` : ""}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                        {cliente.parcelasPagas}/{cliente.parcelas}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                        {dinheiro(cliente.saldoAberto)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums ${
                          cliente.saldoVencido > 0 ? "font-semibold text-red-600 dark:text-red-400" : "text-ink-soft"
                        }`}
                      >
                        {cliente.saldoVencido > 0 ? dinheiro(cliente.saldoVencido) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {aberto ? (
        <FichaDoCliente
          carregando={carregandoFicha}
          ficha={ficha}
          onFechar={() => setAberto(null)}
        />
      ) : null}
    </div>
  );
}

function Indicador({
  apoio,
  rotulo,
  tom,
  valor,
}: {
  apoio?: string;
  rotulo: string;
  tom?: "alerta" | "ok";
  valor: string;
}) {
  const cor =
    tom === "alerta"
      ? "text-red-600 dark:text-red-400"
      : tom === "ok"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-ink";

  return (
    <div className="rounded-xl border border-line bg-subtle px-4 py-3">
      <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
        {rotulo}
      </p>
      <p className={`m-0 text-xl font-bold tabular-nums ${cor}`}>{valor}</p>
      {apoio ? <p className="m-0 text-xs text-ink-soft">{apoio}</p> : null}
    </div>
  );
}

function Esqueleto() {
  return (
    <div aria-busy="true" className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, indice) => (
          <div className="h-[76px] animate-pulse rounded-xl border border-line bg-subtle" key={indice} />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-xl border border-line bg-subtle" />
    </div>
  );
}

function FichaDoCliente({
  carregando,
  ficha,
  onFechar,
}: {
  carregando: boolean;
  ficha: Ficha | null;
  onFechar: () => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onFechar}
      role="presentation"
    >
      <div
        className="flex h-full w-full max-w-[720px] flex-col bg-canvas shadow-2xl"
        onClick={(evento) => evento.stopPropagation()}
        role="presentation"
      >
        <header className="flex items-start gap-3 border-b border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
          <div className="min-w-0">
            <h2 className="m-0 truncate text-base font-bold text-ink">
              {ficha?.cadastro.nome ?? "Carregando…"}
            </h2>
            <p className="m-0 text-xs text-ink-soft">
              {ficha ? `${ficha.cadastro.cpfFormatado ?? "sem CPF"} · código ${ficha.cadastro.codigo}` : ""}
            </p>
          </div>
          <button
            aria-label="Fechar"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-subtle"
            onClick={onFechar}
            type="button"
          >
            <X size={17} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {carregando || !ficha ? (
            <div className="grid gap-3">
              <div className="h-40 animate-pulse rounded-xl border border-line bg-subtle" />
              <div className="h-72 animate-pulse rounded-xl border border-line bg-subtle" />
            </div>
          ) : (
            <div className="grid gap-5">
              <section className="grid gap-2">
                <h3 className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                  Cadastro
                </h3>
                <div className="grid gap-x-6 gap-y-2 rounded-xl border border-line bg-subtle p-4 sm:grid-cols-2">
                  <Campo rotulo="Nascimento" valor={dataBR(ficha.cadastro.nascimento)} />
                  <Campo rotulo="RG" valor={ficha.cadastro.rg} />
                  <Campo rotulo="Telefone" valor={ficha.cadastro.telefone} />
                  <Campo rotulo="Celular" valor={ficha.cadastro.celular} />
                  <Campo rotulo="E-mail" valor={ficha.cadastro.email} />
                  <Campo rotulo="Cônjuge" valor={ficha.cadastro.conjuge} />
                  <Campo
                    rotulo="Endereço"
                    valor={[ficha.cadastro.endereco, ficha.cadastro.bairro].filter(Boolean).join(", ")}
                  />
                  <Campo
                    rotulo="Cidade"
                    valor={[ficha.cadastro.cidade, ficha.cadastro.estado].filter(Boolean).join("/")}
                  />
                  <Campo rotulo="Cadastrado em" valor={dataBR(ficha.cadastro.dataCadastro)} />
                  <Campo rotulo="Empreendimento" valor={ficha.cadastro.empreendimentos.join(" · ")} />
                </div>
              </section>

              <section className="grid gap-2">
                <h3 className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                  Parcelas ({ficha.parcelas.length})
                </h3>
                <div className="overflow-x-auto rounded-xl border border-black/[0.08] dark:border-white/[0.08]">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-subtle text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
                        <th className="px-3 py-2 text-left font-semibold">Parcela</th>
                        <th className="px-3 py-2 text-left font-semibold">Vencimento</th>
                        <th className="px-3 py-2 text-right font-semibold">Valor</th>
                        <th className="px-3 py-2 text-left font-semibold">Situação</th>
                        <th className="px-3 py-2 text-left font-semibold">Unidade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ficha.parcelas.map((parcela) => {
                        const vencida =
                          !parcela.paga && parcela.vencimento !== null && parcela.vencimento < hoje;
                        return (
                          <tr
                            className="border-t border-black/[0.06] dark:border-white/[0.06]"
                            key={parcela.id}
                          >
                            <td className="px-3 py-2 tabular-nums text-ink-soft">
                              {parcela.parcela ?? "—"}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-ink-soft">
                              {dataBR(parcela.vencimento)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-ink">
                              {dinheiro(parcela.valor)}
                            </td>
                            <td className="px-3 py-2">
                              {parcela.paga ? (
                                <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                                  Paga {parcela.dataRecebido ? `· ${dataBR(parcela.dataRecebido)}` : ""}
                                </span>
                              ) : vencida ? (
                                <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
                                  Vencida
                                </span>
                              ) : (
                                <span className="text-xs text-ink-soft">A vencer</span>
                              )}
                            </td>
                            {/* ⚠️ A unidade sai do parse do texto livre e falha em ~1/3 dos casos.
                                Quando falha, mostramos a observação ORIGINAL em vez de "—": é ela
                                que permite conferir manualmente. */}
                            <td className="px-3 py-2 text-xs text-ink-soft">
                              {parcela.quadra || parcela.lote
                                ? [parcela.quadra ? `Q${parcela.quadra}` : null, parcela.lote ? `L${parcela.lote}` : null]
                                    .filter(Boolean)
                                    .join(" ")
                                : (parcela.observacoes ?? "—")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: null | string }) {
  return (
    <div className="min-w-0">
      <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-soft">
        {rotulo}
      </p>
      <p className="m-0 truncate text-sm text-ink">{valor || "—"}</p>
    </div>
  );
}
