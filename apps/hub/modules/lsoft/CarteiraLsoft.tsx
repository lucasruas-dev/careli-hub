"use client";

import { Check, Loader2, Pencil, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { type ApiDoLsoft, apiInterna } from "./api";
import { DocumentosDoCliente } from "./DocumentosDoCliente";

import type {
  CadastroDoCliente,
  ClienteDaCarteira,
  EdicaoDoLsoft,
  ParcelaDaCarteira,
  ResumoDaCarteira,
  StatusDaValidacao,
} from "@/lib/lsoft/carteira";

// LSOFT INTEGRAÇÃO — a carteira do Garden e do Vale do Sol, a caminho do C2X e do Apolo.
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

/**
 * A idade, calculada do nascimento — não é campo guardado.
 *
 * ⚠️ NÃO GUARDAR IDADE, NUNCA. Idade guardada envelhece errado: fica congelada no dia em que foi
 * escrita e, um ano depois, o cadastro afirma com segurança um número falso. O nascimento é o
 * dado; a idade é uma conta.
 */
function idadeDe(nascimento: null | string): null | number {
  if (!nascimento) return null;
  const data = new Date(`${nascimento.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(data.getTime())) return null;

  const hoje = new Date();
  let anos = hoje.getFullYear() - data.getFullYear();
  const mes = hoje.getMonth() - data.getMonth();
  // Ainda não fez aniversário este ano.
  if (mes < 0 || (mes === 0 && hoje.getDate() < data.getDate())) anos -= 1;

  return anos >= 0 && anos < 130 ? anos : null;
}

type Carteira = { clientes: ClienteDaCarteira[]; resumo: ResumoDaCarteira };
type Ficha = { cadastro: CadastroDoCliente; parcelas: ParcelaDaCarteira[] };

const ROTULO_DO_STATUS: Record<StatusDaValidacao, string> = {
  dispensado: "Dispensado",
  em_analise: "Em análise",
  pendente: "Pendente",
  validado: "Validado",
};

export function CarteiraLsoft({ api = apiInterna }: { api?: ApiDoLsoft }) {
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
      const dados = await api.lerCarteira({ busca: buscaAtiva, empreendimento });
      if (!dados) setErro("Falha ao ler a carteira.");
      else {
        setErro(null);
        setCarteira(dados);
      }
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Falha ao ler a carteira.");
    }
    setCarregando(false);
  }, [api, buscaAtiva, empreendimento]);

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
          <h1 className="m-0 text-base font-bold text-ink">LSoft Integração</h1>
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

        {api.enriquecer ? (
          <BotaoDeEnriquecimento aoTerminar={() => void carregar()} enriquecer={api.enriquecer} />
        ) : null}

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
          api={api}
          codigo={aberto}
          onFechar={() => setAberto(null)}
          onSalvou={() => void carregar()}
        />
      ) : null}
    </div>
  );
}

/**
 * O botão que roda o enriquecimento da MOST, em lotes, com a conta à vista.
 *
 * ⚠️ ISTO GASTA DINHEIRO DE VERDADE: cada CPF são 4 datasets cobrados por consulta. Por isso o
 * botão mostra quantos faltam e quanto vai custar ANTES, e pede confirmação — nenhuma operação que
 * debita a conta da empresa deveria acontecer num clique só, sem o número na frente.
 *
 * ⚠️ E POR ISSO EXISTE AQUI, e não no console. A rota exige o token do Apolo no cabeçalho (é o que
 * `getApoloAccessToken` resolve); um `fetch` solto do DevTools leva só o cookie e volta 401 — foi
 * exatamente o que aconteceu na primeira tentativa.
 */
function BotaoDeEnriquecimento({
  aoTerminar,
  enriquecer,
}: {
  aoTerminar: () => void;
  enriquecer: NonNullable<ApiDoLsoft["enriquecer"]>;
}) {
  const [situacao, setSituacao] = useState<null | { custoEstimado: number; pendentes: number }>(null);
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState<null | string>(null);

  const consultar = useCallback(async () => {
    const dados = await enriquecer.situacao();
    if (dados) setSituacao(dados);
  }, [enriquecer]);

  useEffect(() => {
    void consultar();
  }, [consultar]);

  async function rodar() {
    if (!situacao || situacao.pendentes === 0) return;

    const confirmado = window.confirm(
      `Enriquecer ${situacao.pendentes} cliente(s) na MOST?

` +
        `Custo estimado: R$ ${situacao.custoEstimado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}

` +
        "A cobrança é por consulta e não tem desfazer.",
    );
    if (!confirmado) return;

    setRodando(true);
    let feitos = 0;

    try {
      // Lote a lote até acabar. O teto de voltas evita laço infinito se a rota parar de progredir.
      for (let volta = 0; volta < 40; volta += 1) {
        const passo = await enriquecer.rodarLote();

        if (!passo) {
          setProgresso("Falhou. Tente de novo em instantes.");
          break;
        }

        feitos += passo.enriquecidos;
        setProgresso(`${feitos} enriquecido(s) · faltam ${passo.restam}`);
        aoTerminar();

        if (passo.terminou) break;
        // Nada de novo nesta volta: sem isso o laço giraria à toa até o teto.
        if (passo.enriquecidos === 0 && passo.falhas === 0) break;
      }
    } finally {
      setRodando(false);
      await consultar();
    }
  }

  if (!situacao) return null;

  if (situacao.pendentes === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        <Check size={14} /> MOST completa
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {progresso ? <span className="text-xs text-ink-soft">{progresso}</span> : null}
      <button
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/10 px-3 text-sm font-semibold text-ink dark:border-white/10"
        disabled={rodando}
        onClick={() => void rodar()}
        title={`${situacao.pendentes} pendente(s) · R$ ${situacao.custoEstimado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
        type="button"
      >
        {rodando ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
        Enriquecer {situacao.pendentes} na MOST
      </button>
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
  api,
  codigo,
  onFechar,
  onSalvou,
}: {
  api: ApiDoLsoft;
  codigo: string;
  onFechar: () => void;
  onSalvou: () => void;
}) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [edicoes, setEdicoes] = useState<EdicaoDoLsoft[]>([]);
  const [aba, setAba] = useState<"cadastro" | "documentos" | "historico" | "parcelas">("cadastro");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<null | string>(null);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});

  const buscar = useCallback(async () => {
    setCarregando(true);
    const dados = await api.lerFicha(codigo);
    if (dados) {
      setFicha(dados);
      const c = dados.cadastro;
      setRascunho({
        bairro: c.bairro ?? "",
        celular: c.celular ?? "",
        cep: c.cep ?? "",
        cidade: c.cidade ?? "",
        complemento: c.complemento ?? "",
        conjuge: c.conjuge ?? "",
        cpf_formatado: c.cpfFormatado ?? "",
        email: c.email ?? "",
        endereco: c.endereco ?? "",
        estado: c.estado ?? "",
        mae: c.mae ?? "",
        nascimento: c.nascimento?.slice(0, 10) ?? "",
        nome: c.nome ?? "",
        rg: c.rg ?? "",
        telefone: c.telefone ?? "",
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
  }, [api, codigo]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  const carregarHistorico = useCallback(async () => {
    setEdicoes(await api.historico(codigo));
  }, [api, codigo]);

  useEffect(() => {
    if (aba === "historico") void carregarHistorico();
  }, [aba, carregarHistorico]);

  async function salvar(status?: StatusDaValidacao) {
    setSalvando(true);
    setAviso(null);
    try {
      const resultado = await api.salvarCliente(codigo, rascunho, status);

      if (!resultado.ok) {
        setAviso(resultado.erro ?? "Não foi possível salvar.");
      } else {
        setAviso(
          resultado.alterados ? `${resultado.alterados} alteração(ões) salva(s).` : "Nada mudou.",
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
        className="flex h-full w-full max-w-[980px] flex-col bg-canvas shadow-2xl"
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
            {(["cadastro", "parcelas", "documentos", "historico"] as const).map((chave) => (
              <button
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  aba === chave ? "bg-ink text-canvas" : "text-ink-soft hover:bg-subtle"
                }`}
                key={chave}
                onClick={() => setAba(chave)}
                type="button"
              >
                {chave === "cadastro"
                  ? "Cadastro"
                  : chave === "parcelas"
                    ? "Parcelas"
                    : chave === "documentos"
                      ? "Documentos"
                      : "Histórico"}
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
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                    Dados do cliente
                  </h3>
                  {/* ⚠️ NÃO DIZER MAIS "VEIO DO LSOFT". Depois do enriquecimento, boa parte destes
                      campos veio da MOST (nascimento, mãe, telefone, sexo, renda), e manter o
                      rótulo antigo faria a tela afirmar uma origem errada — o Lucas pegou isso
                      olhando uma ficha com nascimento que o LSoft nunca teve. */}
                  {ficha.cadastro.enriquecidoEm ? (
                    <span className="rounded bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
                      complementado pela MOST em {dataBR(ficha.cadastro.enriquecidoEm)}
                    </span>
                  ) : null}
                </div>
                {/* ⚠️ TUDO EDITÁVEL AQUI TAMBÉM. Estes campos ficaram só leitura por engano meu: o
                    backend passou a aceitá-los quando a carga virou única, mas a tela seguia
                    mostrando texto — foi o "não consigo editar as informações" do Lucas. */}
                <div className="grid gap-x-6 gap-y-3 rounded-xl border border-line bg-subtle p-4 sm:grid-cols-2">
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, nome: v }))}
                    rotulo="Nome"
                    valor={rascunho.nome ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, cpf_formatado: v }))}
                    rotulo="CPF"
                    valor={rascunho.cpf_formatado ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, nascimento: v }))}
                    rotulo={
                      idadeDe(rascunho.nascimento ?? null) !== null
                        ? `Nascimento · ${idadeDe(rascunho.nascimento ?? null)} anos`
                        : "Nascimento"
                    }
                    tipo="date"
                    valor={rascunho.nascimento ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, rg: v }))}
                    rotulo="RG"
                    valor={rascunho.rg ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, telefone: v }))}
                    rotulo="Telefone"
                    valor={rascunho.telefone ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, celular: v }))}
                    rotulo="Celular"
                    valor={rascunho.celular ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, email: v }))}
                    rotulo="E-mail"
                    valor={rascunho.email ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, mae: v }))}
                    rotulo="Mãe"
                    valor={rascunho.mae ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, conjuge: v }))}
                    rotulo="Cônjuge"
                    valor={rascunho.conjuge ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, endereco: v }))}
                    rotulo="Endereço"
                    valor={rascunho.endereco ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, bairro: v }))}
                    rotulo="Bairro"
                    valor={rascunho.bairro ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, cep: v }))}
                    rotulo="CEP"
                    valor={rascunho.cep ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, cidade: v }))}
                    rotulo="Cidade"
                    valor={rascunho.cidade ?? ""}
                  />
                  <Texto
                    aoMudar={(v) => setRascunho((r) => ({ ...r, estado: v }))}
                    rotulo="UF"
                    valor={rascunho.estado ?? ""}
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
            <TabelaDeParcelas
              api={api}
              aoSalvar={async () => {
                await buscar();
                onSalvou();
              }}
              parcelas={ficha.parcelas}
            />
          ) : aba === "documentos" ? (
            <DocumentosDoCliente api={api} codigo={codigo} />
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

function TabelaDeParcelas({
  api,
  aoSalvar,
  parcelas,
}: {
  api: ApiDoLsoft;
  aoSalvar: () => Promise<void>;
  parcelas: ParcelaDaCarteira[];
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [editando, setEditando] = useState<null | string>(null);

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
            {/* ⚠️ GRUDADA NA DIREITA. Com oito colunas dentro do painel, esta era a primeira a sair
                da área visível: a tela "comia" o botão de editar e a parcela parecia não editável
                (o Lucas passou por isso). `sticky` mantém a ação sempre ao alcance, role ou não. */}
            <th className="sticky right-0 bg-subtle px-3 py-2 text-right font-semibold" />
          </tr>
        </thead>
        <tbody>
          {parcelas.map((parcela) => {
            const vencida = !parcela.paga && parcela.vencimento !== null && parcela.vencimento < hoje;
            const parcial = parcela.paga && parcela.valorRecebido > 0 && parcela.valorRecebido < parcela.valor;

            if (editando === parcela.id) {
              return (
                <LinhaEmEdicao
                  antes={api}
                  aoCancelar={() => setEditando(null)}
                  aoSalvar={async () => {
                    setEditando(null);
                    await aoSalvar();
                  }}
                  key={parcela.id}
                  parcela={parcela}
                />
              );
            }

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
                <td className="sticky right-0 bg-canvas px-3 py-2 text-right">
                  <button
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 px-2 text-xs font-semibold text-ink-soft hover:bg-subtle dark:border-white/10"
                    onClick={() => setEditando(parcela.id)}
                    type="button"
                  >
                    <Pencil size={12} /> Editar
                  </button>
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

function Texto({
  aoMudar,
  rotulo,
  tipo,
  valor,
}: {
  aoMudar: (valor: string) => void;
  rotulo: string;
  tipo?: string;
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
        type={tipo ?? "text"}
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

/**
 * A linha da parcela em modo de edição: vencimento, valor e pago/em aberto.
 *
 * ⚠️ EDITA DINHEIRO, e por isso mostra o que vai acontecer antes de acontecer: marcar como paga
 * preenche a data de hoje e o valor da parcela quando esses campos estão vazios, e desmarcar
 * limpa o recebimento. Sem dizer isso, o usuário marca "paga" e descobre depois que ficou uma
 * parcela quitada sem data — que é justamente o defeito que a gente encontrou no C2X hoje cedo.
 */
function LinhaEmEdicao({
  antes,
  aoCancelar,
  aoSalvar,
  parcela,
}: {
  antes: ApiDoLsoft;
  aoCancelar: () => void;
  aoSalvar: () => Promise<void>;
  parcela: ParcelaDaCarteira;
}) {
  const [campos, setCampos] = useState({
    data_recebido: parcela.dataRecebido?.slice(0, 10) ?? "",
    empreendimento: parcela.empreendimento,
    lote: parcela.lote ?? "",
    observacoes: parcela.observacoes ?? "",
    parcela: parcela.parcela ?? "",
    quadra: parcela.quadra ?? "",
    valor: String(parcela.valor).replace(".", ","),
    valor_recebido: String(parcela.valorRecebido).replace(".", ","),
    vencimento: parcela.vencimento?.slice(0, 10) ?? "",
  });
  const [paga, setPaga] = useState(parcela.paga);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);

  const mudar = (campo: keyof typeof campos) => (valor: string) =>
    setCampos((atual) => ({ ...atual, [campo]: valor }));

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const resultado = await antes.salvarParcela(parcela.id, { ...campos, paga: String(paga) });
      if (!resultado.ok) {
        setErro(resultado.erro ?? "Não foi possível salvar.");
        return;
      }
      await aoSalvar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <tr className="border-t border-black/[0.06] bg-subtle dark:border-white/[0.06]">
      {/* ⚠️ FORMULÁRIO EXPANDIDO, não inputs na própria linha. São dez campos: espremê-los nas
          colunas da tabela deixaria cada um com 60px, e editar valor em caixa dessa largura é
          convite a erro de digitação — ainda mais em campo de dinheiro. */}
      <td colSpan={8} className="px-3 py-4">
        <div className="grid gap-3">
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            <CampoDeTexto aoMudar={mudar("empreendimento")} rotulo="Empreendimento" valor={campos.empreendimento} />
            <CampoDeTexto aoMudar={mudar("parcela")} rotulo="Parcela" valor={campos.parcela} />
            <CampoDeTexto aoMudar={mudar("vencimento")} rotulo="Vencimento" tipo="date" valor={campos.vencimento} />
            <CampoDeTexto aoMudar={mudar("valor")} rotulo="Valor" valor={campos.valor} />
            <CampoDeTexto aoMudar={mudar("quadra")} rotulo="Quadra" valor={campos.quadra} />
            <CampoDeTexto aoMudar={mudar("lote")} rotulo="Lote" valor={campos.lote} />
            <CampoDeTexto
              aoMudar={mudar("data_recebido")}
              desabilitado={!paga}
              rotulo="Data do pagamento"
              tipo="date"
              valor={campos.data_recebido}
            />
            <CampoDeTexto
              aoMudar={mudar("valor_recebido")}
              desabilitado={!paga}
              rotulo="Valor recebido"
              valor={campos.valor_recebido}
            />
          </div>

          <CampoDeTexto aoMudar={mudar("observacoes")} rotulo="Observação do LSoft" valor={campos.observacoes} />

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-ink">
              <input
                checked={paga}
                className="h-4 w-4"
                onChange={(evento) => setPaga(evento.target.checked)}
                type="checkbox"
              />
              Parcela paga
            </label>

            {erro ? (
              <span className="text-sm text-red-600 dark:text-red-400">{erro}</span>
            ) : (
              <span className="text-xs text-ink-soft">
                Marcar como paga preenche data e valor quando estiverem vazios; desmarcar limpa o
                recebimento.
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white"
                disabled={salvando}
                onClick={() => void salvar()}
                type="button"
              >
                {salvando ? <Loader2 className="animate-spin" size={13} /> : <Check size={13} />}
                Salvar parcela
              </button>
              <button
                className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-semibold text-ink-soft hover:bg-canvas"
                disabled={salvando}
                onClick={aoCancelar}
                type="button"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function CampoDeTexto({
  aoMudar,
  desabilitado,
  rotulo,
  tipo,
  valor,
}: {
  aoMudar: (valor: string) => void;
  desabilitado?: boolean;
  rotulo: string;
  tipo?: string;
  valor: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-soft">
        {rotulo}
      </span>
      <input
        className="h-8 rounded-lg border border-black/10 bg-canvas px-2 text-sm text-ink disabled:opacity-50 dark:border-white/10"
        disabled={desabilitado}
        onChange={(evento) => aoMudar(evento.target.value)}
        type={tipo ?? "text"}
        value={valor}
      />
    </label>
  );
}
