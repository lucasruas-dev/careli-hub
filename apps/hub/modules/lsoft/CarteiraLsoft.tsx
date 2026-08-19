"use client";

import { Check, Loader2, Pencil, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

import type {
  CadastroDoCliente,
  ClienteDaCarteira,
  EdicaoDoLsoft,
  ParcelaDaCarteira,
  ResumoDaCarteira,
  StatusDaValidacao,
} from "@/lib/lsoft/carteira";

// CARTEIRA DO LSOFT — Garden e Vale do Sol.
//
// Pedido do Lucas (19/08/2026): ver cadastro e parcelas, com um dash "igual temos na carteira" e os
// botões de edição, como POC da integração com Apolo e C2X.
//
// ⚠️ A CARGA DO LSOFT FOI ÚNICA (Lucas, 19/08/2026: *"não terá nova carga da LSoft"*). Daqui para
// a frente ESTE banco é a verdade, não o Access da Cecílio — por isso o cadastro inteiro é
// editável e nada aqui será sobrescrito. O carimbo no cabeçalho continua: ele diz de quando os
// dados vieram, que é diferente de dizer que estão sincronizados.
//
// ⚠️ O QUE NÃO SE EDITA: o código do cliente (é a chave que amarra as parcelas) e os valores das
// parcelas. Dinheiro é do LSoft; corrigir por aqui criaria uma segunda verdade financeira.

const brl = (valor: number) =>
  valor.toLocaleString("pt-BR", { currency: "BRL", maximumFractionDigits: 0, style: "currency" });

const brlExato = (valor: number) =>
  valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });

const inteiro = (valor: number) => valor.toLocaleString("pt-BR");
const pct = (valor: number) => `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const dataBR = (iso: null | string) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

type Carteira = { clientes: ClienteDaCarteira[]; resumo: ResumoDaCarteira };
type Ficha = { cadastro: CadastroDoCliente; parcelas: ParcelaDaCarteira[] };

const ROTULO_DO_STATUS: Record<StatusDaValidacao, string> = {
  dispensado: "Dispensado",
  em_analise: "Em análise",
  pendente: "Pendente",
  validado: "Validado",
};

export function CarteiraLsoft() {
  const [carteira, setCarteira] = useState<Carteira | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");
  const [empreendimento, setEmpreendimento] = useState("");
  const [somentePendentes, setSomentePendentes] = useState(false);

  const [aberto, setAberto] = useState<null | string>(null);

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

  const carimbo = carteira?.resumo.sincronizadoEm
    ? new Date(carteira.resumo.sincronizadoEm).toLocaleString("pt-BR", {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "2-digit",
      })
    : null;

  const lista = (carteira?.clientes ?? []).filter(
    (cliente) => !somentePendentes || cliente.statusValidacao !== "validado",
  );

  const carteiraTotal = (carteira?.resumo.saldoAberto ?? 0) + (carteira?.resumo.totalRecebido ?? 0);
  const inadimplentes = (carteira?.clientes ?? []).filter((c) => c.saldoVencido > 0).length;
  const validados = (carteira?.clientes ?? []).filter((c) => c.statusValidacao === "validado").length;

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

        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            checked={somentePendentes}
            className="h-4 w-4"
            onChange={(evento) => setSomentePendentes(evento.target.checked)}
            type="checkbox"
          />
          Só o que falta validar
        </label>

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
              className="h-9 w-[230px] rounded-lg border border-black/10 bg-canvas pl-8 pr-3 text-sm text-ink dark:border-white/10"
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Nome, CPF ou lote"
              value={busca}
            />
          </div>
          <button
            className="inline-flex h-9 items-center rounded-lg bg-ink px-3 text-sm font-semibold text-canvas"
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
            {/* O dash no formato da Carteira: os mesmos oito cartões, a mesma leitura. */}
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
              <Cartao
                dica={`${inteiro(carteira.resumo.clientes)} cliente(s)`}
                rotulo="Carteira total"
                valor={brl(carteiraTotal)}
              />
              <Cartao
                dica={
                  carteiraTotal > 0
                    ? `${pct((carteira.resumo.totalRecebido / carteiraTotal) * 100)} da carteira`
                    : "—"
                }
                rotulo="Recebido"
                valor={brl(carteira.resumo.totalRecebido)}
              />
              <Cartao
                dica={`${inteiro(carteira.resumo.parcelasAbertas)} parcela(s)`}
                rotulo="A receber"
                valor={brl(carteira.resumo.saldoAberto)}
              />
              <Cartao
                dica={`${inteiro(carteira.resumo.parcelasVencidas)} parcela(s)`}
                rotulo="Vencido"
                tom={carteira.resumo.saldoVencido > 0 ? "alerta" : undefined}
                valor={brl(carteira.resumo.saldoVencido)}
              />
              <Cartao
                dica="do saldo em aberto"
                rotulo="Inadimplência"
                tom={carteira.resumo.saldoVencido > 0 ? "alerta" : undefined}
                valor={
                  carteira.resumo.saldoAberto > 0
                    ? pct((carteira.resumo.saldoVencido / carteira.resumo.saldoAberto) * 100)
                    : "0%"
                }
              />
              <Cartao
                dica="com parcela vencida"
                rotulo="Inadimplentes"
                tom={inadimplentes > 0 ? "alerta" : undefined}
                valor={inteiro(inadimplentes)}
              />
              <Cartao
                dica={`de ${inteiro(carteira.resumo.clientes)} cliente(s)`}
                rotulo="Validados"
                tom={validados === carteira.resumo.clientes ? "ok" : undefined}
                valor={inteiro(validados)}
              />
              <Cartao
                dica="cadastro incompleto para o C2X"
                rotulo="A validar"
                tom={carteira.resumo.clientes - validados > 0 ? "alerta" : "ok"}
                valor={inteiro(carteira.resumo.clientes - validados)}
              />
            </div>

            <div className="overflow-x-auto rounded-xl border border-black/[0.08] dark:border-white/[0.08]">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-subtle text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
                    <th className="px-4 py-2.5 text-left font-semibold">Cliente</th>
                    <th className="px-4 py-2.5 text-left font-semibold">CPF</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Unidade</th>
                    <th className="px-4 py-2.5 text-left font-semibold">Cadastro p/ C2X</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Parcelas</th>
                    <th className="px-4 py-2.5 text-right font-semibold">A receber</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Vencido</th>
                    <th className="px-4 py-2.5 text-right font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((cliente) => (
                    <tr
                      className="cursor-pointer border-t border-black/[0.06] hover:bg-subtle dark:border-white/[0.06]"
                      key={cliente.codigo}
                      onClick={() => setAberto(cliente.codigo)}
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-ink">{cliente.nome}</span>
                        <span className="ml-2 text-xs text-ink-soft">
                          {cliente.empreendimentos.join(" · ")}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-ink-soft">
                        {cliente.cpfFormatado ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-ink-soft">
                        {cliente.unidades.slice(0, 2).join(" · ") || "—"}
                        {cliente.unidades.length > 2 ? ` +${cliente.unidades.length - 2}` : ""}
                      </td>
                      <td className="px-4 py-2.5">
                        <Progresso
                          preenchidos={cliente.camposC2xPreenchidos}
                          status={cliente.statusValidacao}
                          total={cliente.camposC2xTotal}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft">
                        {cliente.parcelasPagas}/{cliente.parcelas}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                        {brl(cliente.saldoAberto)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right tabular-nums ${
                          cliente.saldoVencido > 0
                            ? "font-semibold text-red-600 dark:text-red-400"
                            : "text-ink-soft"
                        }`}
                      >
                        {cliente.saldoVencido > 0 ? brl(cliente.saldoVencido) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-soft">
                          <Pencil size={13} /> Editar
                        </span>
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
        <PainelDoCliente
          codigo={aberto}
          onFechar={() => setAberto(null)}
          onSalvou={() => void carregar()}
        />
      ) : null}
    </div>
  );
}

function Cartao({
  dica,
  rotulo,
  tom,
  valor,
}: {
  dica?: string;
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
      <p className={`m-0 text-lg font-bold tabular-nums ${cor}`}>{valor}</p>
      {dica ? <p className="m-0 text-[11px] text-ink-soft">{dica}</p> : null}
    </div>
  );
}

/** A barra de "quanto falta para o C2X aceitar": são 9 campos obrigatórios. */
function Progresso({
  preenchidos,
  status,
  total,
}: {
  preenchidos: number;
  status: StatusDaValidacao;
  total: number;
}) {
  const parte = total > 0 ? Math.round((preenchidos / total) * 100) : 0;
  const completo = preenchidos >= total;

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className={`h-full rounded-full ${
            status === "validado" || completo ? "bg-emerald-500" : "bg-amber-500"
          }`}
          style={{ width: `${parte}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-ink-soft">
        {preenchidos}/{total}
      </span>
      {status === "validado" ? (
        <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
          <Check size={11} /> ok
        </span>
      ) : null}
    </div>
  );
}

function Esqueleto() {
  return (
    <div aria-busy="true" className="grid gap-3">
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
        {Array.from({ length: 8 }).map((_, indice) => (
          <div className="h-[76px] animate-pulse rounded-xl border border-line bg-subtle" key={indice} />
        ))}
      </div>
      <div className="h-96 animate-pulse rounded-xl border border-line bg-subtle" />
    </div>
  );
}

// ── O PAINEL DO CLIENTE ─────────────────────────────────────────────────────

const OPCOES = {
  escolaridade: [
    "Fundamental incompleto",
    "Fundamental completo",
    "Médio incompleto",
    "Médio completo",
    "Superior incompleto",
    "Superior completo",
    "Pós-graduação",
  ],
  estadoCivil: ["Solteiro(a)", "Casado(a)", "Divorciado(a)", "Viúvo(a)", "União estável"],
  faixaRenda: [
    "Até 1 salário",
    "1 a 3 salários",
    "3 a 5 salários",
    "5 a 10 salários",
    "Acima de 10 salários",
  ],
  regimeBens: [
    "Comunhão parcial de bens",
    "Comunhão universal de bens",
    "Separação total de bens",
    "Participação final nos aquestos",
  ],
  sexo: ["Masculino", "Feminino"],
};

/** Estado civil que obriga o regime de bens — a mesma régua do C2X (`EXIGE_REGIME`). */
const EXIGE_REGIME = new Set(["Casado(a)", "União estável"]);

function PainelDoCliente({
  codigo,
  onFechar,
  onSalvou,
}: {
  codigo: string;
  onFechar: () => void;
  onSalvou: () => void;
}) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [edicoes, setEdicoes] = useState<EdicaoDoLsoft[]>([]);
  const [aba, setAba] = useState<"cadastro" | "historico" | "parcelas">("cadastro");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<null | string>(null);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});

  const buscar = useCallback(async () => {
    setCarregando(true);
    const token = await getApoloAccessToken();
    const resposta = await fetch(`/api/lsoft/cliente/${codigo}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    const corpo = (await resposta.json().catch(() => null)) as { data?: Ficha } | null;
    if (corpo?.data) {
      setFicha(corpo.data);
      const c = corpo.data.cadastro;
      setRascunho({
        complemento: c.complemento ?? "",
        escolaridade: c.escolaridade ?? "",
        estado_civil: c.estadoCivil ?? "",
        faixa_renda: c.faixaRenda ?? "",
        nacionalidade: c.nacionalidade ?? "",
        naturalidade: c.naturalidade ?? "",
        nome_pai: c.nomePai ?? "",
        numero: c.numero ?? "",
        observacao_validacao: c.observacaoValidacao ?? "",
        profissao: c.profissao ?? "",
        regime_bens: c.regimeBens ?? "",
        sexo: c.sexo ?? "",
      });
    }
    setCarregando(false);
  }, [codigo]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  const carregarHistorico = useCallback(async () => {
    const token = await getApoloAccessToken();
    const resposta = await fetch(`/api/lsoft/cliente/${codigo}`, {
      body: "{}",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      method: "POST",
    });
    const corpo = (await resposta.json().catch(() => null)) as
      | { data?: { edicoes: EdicaoDoLsoft[] } }
      | null;
    setEdicoes(corpo?.data?.edicoes ?? []);
  }, [codigo]);

  useEffect(() => {
    if (aba === "historico") void carregarHistorico();
  }, [aba, carregarHistorico]);

  async function salvar(status?: StatusDaValidacao) {
    setSalvando(true);
    setAviso(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(`/api/lsoft/cliente/${codigo}`, {
        body: JSON.stringify({ campos: rascunho, status }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "PATCH",
      });
      const corpo = (await resposta.json().catch(() => null)) as
        | { data?: { alterados: number }; error?: string }
        | null;

      if (!resposta.ok) {
        setAviso(corpo?.error ?? "Não foi possível salvar.");
      } else {
        setAviso(
          corpo?.data?.alterados
            ? `${corpo.data.alterados} alteração(ões) salva(s).`
            : "Nada mudou.",
        );
        await buscar();
        onSalvou();
      }
    } finally {
      setSalvando(false);
    }
  }

  const precisaRegime = EXIGE_REGIME.has(rascunho.estado_civil ?? "");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onFechar} role="presentation">
      <div
        className="flex h-full w-full max-w-[780px] flex-col bg-canvas shadow-2xl"
        onClick={(evento) => evento.stopPropagation()}
        role="presentation"
      >
        <header className="border-b border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <h2 className="m-0 truncate text-base font-bold text-ink">
                {ficha?.cadastro.nome ?? "Carregando…"}
              </h2>
              <p className="m-0 text-xs text-ink-soft">
                {ficha
                  ? `${ficha.cadastro.cpfFormatado ?? "sem CPF"} · ${ROTULO_DO_STATUS[ficha.cadastro.statusValidacao]}`
                  : ""}
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
          </div>

          <div className="mt-3 flex gap-1">
            {(["cadastro", "parcelas", "historico"] as const).map((chave) => (
              <button
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  aba === chave ? "bg-ink text-canvas" : "text-ink-soft hover:bg-subtle"
                }`}
                key={chave}
                onClick={() => setAba(chave)}
                type="button"
              >
                {chave === "cadastro" ? "Cadastro" : chave === "parcelas" ? "Parcelas" : "Histórico"}
              </button>
            ))}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {carregando || !ficha ? (
            <div className="grid gap-3">
              <div className="h-40 animate-pulse rounded-xl border border-line bg-subtle" />
              <div className="h-72 animate-pulse rounded-xl border border-line bg-subtle" />
            </div>
          ) : aba === "cadastro" ? (
            <div className="grid gap-5">
              <section className="grid gap-2">
                <h3 className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                  Veio do LSoft
                </h3>
                {/* ⚠️ SÓ LEITURA: a próxima carga sobrescreve, então editar aqui perderia o trabalho. */}
                <div className="grid gap-x-6 gap-y-2 rounded-xl border border-line bg-subtle p-4 sm:grid-cols-2">
                  <Campo rotulo="Nascimento" valor={dataBR(ficha.cadastro.nascimento)} />
                  <Campo rotulo="RG" valor={ficha.cadastro.rg} />
                  <Campo rotulo="Telefone" valor={ficha.cadastro.telefone ?? ficha.cadastro.celular} />
                  <Campo rotulo="E-mail" valor={ficha.cadastro.email} />
                  <Campo rotulo="Mãe" valor={ficha.cadastro.mae} />
                  <Campo rotulo="Cônjuge" valor={ficha.cadastro.conjuge} />
                  <Campo rotulo="Endereço" valor={ficha.cadastro.endereco} />
                  <Campo
                    rotulo="Cidade"
                    valor={[ficha.cadastro.cidade, ficha.cadastro.estado].filter(Boolean).join("/")}
                  />
                </div>
              </section>

              <section className="grid gap-2">
                <h3 className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                  O que o C2X exige
                </h3>
                <div className="grid gap-x-6 gap-y-3 rounded-xl border border-line p-4 sm:grid-cols-2">
                  <Escolha
                    aoMudar={(v) => setRascunho((r) => ({ ...r, sexo: v }))}
                    opcoes={OPCOES.sexo}
                    rotulo="Sexo"
                    valor={rascunho.sexo ?? ""}
                  />
                  <Escolha
                    aoMudar={(v) => setRascunho((r) => ({ ...r, estado_civil: v }))}
                    opcoes={OPCOES.estadoCivil}
                    rotulo="Estado civil"
                    valor={rascunho.estado_civil ?? ""}
                  />
                  {/* O C2X recusa regime de bens em quem não é casado, e o exige em quem é. */}
                  {precisaRegime ? (
                    <Escolha
                      aoMudar={(v) => setRascunho((r) => ({ ...r, regime_bens: v }))}
                      opcoes={OPCOES.regimeBens}
                      rotulo="Regime de bens"
                      valor={rascunho.regime_bens ?? ""}
                    />
                  ) : null}
                  <Escolha
                    aoMudar={(v) => setRascunho((r) => ({ ...r, escolaridade: v }))}
                    opcoes={OPCOES.escolaridade}
                    rotulo="Escolaridade"
                    valor={rascunho.escolaridade ?? ""}
                  />
                  <Escolha
                    aoMudar={(v) => setRascunho((r) => ({ ...r, faixa_renda: v }))}
                    opcoes={OPCOES.faixaRenda}
                    rotulo="Faixa de renda"
                    valor={rascunho.faixa_renda ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, profissao: v }))}
                    rotulo="Profissão"
                    valor={rascunho.profissao ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, naturalidade: v }))}
                    rotulo="Naturalidade"
                    valor={rascunho.naturalidade ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, nacionalidade: v }))}
                    rotulo="Nacionalidade"
                    valor={rascunho.nacionalidade ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, nome_pai: v }))}
                    rotulo="Nome do pai"
                    valor={rascunho.nome_pai ?? ""}
                  />
                  {/* ⚠️ O ENDEREÇO DO LSOFT NÃO TEM NÚMERO, e o C2X exige. */}
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, numero: v }))}
                    rotulo="Número"
                    valor={rascunho.numero ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, complemento: v }))}
                    rotulo="Complemento"
                    valor={rascunho.complemento ?? ""}
                  />
                </div>
              </section>

              <section className="grid gap-2">
                <h3 className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                  Observação da validação
                </h3>
                <textarea
                  className="min-h-[70px] rounded-xl border border-black/10 bg-canvas p-3 text-sm text-ink dark:border-white/10"
                  onChange={(evento) =>
                    setRascunho((r) => ({ ...r, observacao_validacao: evento.target.value }))
                  }
                  placeholder="O que ficou pendente, o que foi conferido com o cliente…"
                  value={rascunho.observacao_validacao ?? ""}
                />
              </section>

              {aviso ? <p className="m-0 text-sm text-ink-soft">{aviso}</p> : null}
            </div>
          ) : aba === "parcelas" ? (
            <TabelaDeParcelas parcelas={ficha.parcelas} />
          ) : (
            <Historico edicoes={edicoes} />
          )}
        </div>

        {aba === "cadastro" && ficha ? (
          <footer className="flex items-center gap-2 border-t border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/10 px-3 text-sm font-semibold text-ink-soft dark:border-white/10"
              disabled={salvando}
              onClick={() => void salvar()}
              type="button"
            >
              {salvando ? <Loader2 className="animate-spin" size={15} /> : null}
              Salvar
            </button>
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white"
              disabled={salvando}
              onClick={() => void salvar("validado")}
              type="button"
            >
              <Check size={15} /> Salvar e validar
            </button>
            <button
              className="ml-auto inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-ink-soft hover:bg-subtle"
              disabled={salvando}
              onClick={() => void salvar("dispensado")}
              type="button"
            >
              Dispensar
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}

function TabelaDeParcelas({ parcelas }: { parcelas: ParcelaDaCarteira[] }) {
  const hoje = new Date().toISOString().slice(0, 10);

  // ⚠️ PARCELA REPETIDA NÃO É DUPLICAÇÃO — é PAGAMENTO PARCIAL, e vem assim do LSoft. A 006/084 de
  // um cliente do Garden, por exemplo, aparece três vezes: R$ 29,26 + R$ 864,53 + R$ 1.300,00. O
  // sistema lança uma linha por recebimento. Sem dizer isso na tela, quem olha jura que a base
  // está duplicada e para de confiar no número.
  const repetidas = new Set(
    parcelas
      .map((p) => `${p.parcela}|${p.vencimento}`)
      .filter((chave, indice, todas) => todas.indexOf(chave) !== indice),
  );

  return (
    <div className="grid gap-2">
      {repetidas.size > 0 ? (
        <p className="m-0 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
          Algumas parcelas aparecem em mais de uma linha: é pagamento em partes, como o LSoft
          registra. O valor de cada linha é o que entrou naquele recebimento.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-xl border border-black/[0.08] dark:border-white/[0.08]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-subtle text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
            <th className="px-3 py-2 text-left font-semibold">Empreendimento</th>
            <th className="px-3 py-2 text-left font-semibold">Parcela</th>
            <th className="px-3 py-2 text-left font-semibold">Vencimento</th>
            <th className="px-3 py-2 text-right font-semibold">Valor</th>
            <th className="px-3 py-2 text-right font-semibold">Recebido</th>
            <th className="px-3 py-2 text-left font-semibold">Situação</th>
            <th className="px-3 py-2 text-left font-semibold">Unidade</th>
          </tr>
        </thead>
        <tbody>
          {parcelas.map((parcela) => {
            const vencida = !parcela.paga && parcela.vencimento !== null && parcela.vencimento < hoje;
            const parcial = parcela.paga && parcela.valorRecebido > 0 && parcela.valorRecebido < parcela.valor;
            return (
              <tr className="border-t border-black/[0.06] dark:border-white/[0.06]" key={parcela.id}>
                <td className="px-3 py-2 text-xs text-ink-soft">{parcela.empreendimento}</td>
                <td className="px-3 py-2 tabular-nums text-ink-soft">
                  {parcela.parcela ?? "—"}
                  {repetidas.has(`${parcela.parcela}|${parcela.vencimento}`) ? (
                    <span className="ml-1 text-[10px] text-ink-soft">(em partes)</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 tabular-nums text-ink-soft">{dataBR(parcela.vencimento)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{brlExato(parcela.valor)}</td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    parcial ? "text-amber-600 dark:text-amber-400" : "text-ink-soft"
                  }`}
                >
                  {parcela.valorRecebido > 0 ? brlExato(parcela.valorRecebido) : "—"}
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
                {/* Sem parse, mostra a observação crua: é ela que permite conferir à mão. */}
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
    </div>
  );
}

function Historico({ edicoes }: { edicoes: EdicaoDoLsoft[] }) {
  if (edicoes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-black/[0.12] p-8 text-center text-sm text-ink-soft dark:border-white/[0.12]">
        Nenhuma alteração registrada nesta ficha.
      </p>
    );
  }

  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {edicoes.map((edicao, indice) => (
        <li className="rounded-xl border border-line bg-subtle px-4 py-2.5 text-sm" key={indice}>
          <p className="m-0 text-ink">
            <b>{edicao.campo.replace(/_/g, " ")}</b>{" "}
            <span className="text-ink-soft">
              {edicao.valorAnterior ? `${edicao.valorAnterior} → ` : ""}
              {edicao.valorNovo ?? "(vazio)"}
            </span>
          </p>
          <p className="m-0 text-[11px] text-ink-soft">
            {edicao.autor} · {new Date(edicao.criadoEm).toLocaleString("pt-BR")}
            {edicao.autorOrigem === "incorporador" ? " · pelo portal" : ""}
          </p>
        </li>
      ))}
    </ul>
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

function Texto({
  aoMudar,
  rotulo,
  valor,
}: {
  aoMudar: (valor: string) => void;
  rotulo: string;
  valor: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-soft">
        {rotulo}
      </span>
      <input
        className="h-9 rounded-lg border border-black/10 bg-canvas px-3 text-sm text-ink dark:border-white/10"
        onChange={(evento) => aoMudar(evento.target.value)}
        value={valor}
      />
    </label>
  );
}

function Escolha({
  aoMudar,
  opcoes,
  rotulo,
  valor,
}: {
  aoMudar: (valor: string) => void;
  opcoes: string[];
  rotulo: string;
  valor: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-soft">
        {rotulo}
      </span>
      <select
        className="h-9 rounded-lg border border-black/10 bg-canvas px-3 text-sm text-ink dark:border-white/10"
        onChange={(evento) => aoMudar(evento.target.value)}
        value={valor}
      >
        <option value="">—</option>
        {opcoes.map((opcao) => (
          <option key={opcao} value={opcao}>
            {opcao}
          </option>
        ))}
      </select>
    </label>
  );
}
