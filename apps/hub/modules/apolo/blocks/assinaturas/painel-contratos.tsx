"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// Só TIPOS daqui: a lib é server-side (mysql2). Importar um valor arrastaria o driver do MySQL
// para o bundle do navegador.
import type {
  AssinanteInterno,
  ContratoDoPainel,
  GrupoDaUnidade,
} from "@/lib/apolo/assinaturas/nucleo";
import type { PainelDeContratos } from "@/lib/apolo/assinaturas/painel-contratos";

// TELA CONTRATOS — a tela de assinatura do portal do incorporador, trazida para dentro do Apolo.
//
// Pedido do Lucas (18/08/2026): *"que tela maravilhosa essa de assinatura, quero levá-la para
// dentro do Apolo"* e, logo depois, *"a tela de assinatura devia chamar CONTRATOS e tirar a tela de
// contratos que tem hoje... no final dessa linha vai ter o contrato para ser baixado"*.
//
// O DESENHO é o do portal (`modules/incorporador/TelaVendas.tsx`), a LINGUAGEM é a do Apolo: lá o
// estilo é inline com os tokens T (o portal tem tema próprio, claro e escuro, e roda fora do
// chrome do hub); aqui são as classes do hub (`bg-canvas`, `text-ink`, `border-line`), que já
// respondem ao dark mode. Grafite com preto; verde é "concluído", vermelho é "atrasado", e o
// dourado continua sendo só rótulo de bloco — nunca estado.
//
// O QUE ESTA TELA TEM E A DO PORTAL NÃO:
//   • o E-MAIL do assinante (no quadro e no popup). O painel interno sempre mostrou, e é ele que
//     separa três sócios da mesma razão social. O portal é vitrine de cliente externo e não recebe;
//   • o filtro por EMPREENDIMENTO — no portal o recorte vem do token, aqui o time escolhe;
//   • o carimbo de atualização e o botão Atualizar do painel interno;
//   • a linha de "aguardando emissão" (contrato gerado que ainda não saiu para assinar) e os dados
//     do contrato no popup — o que a aba Contratos mostrava e a fusão não podia perder;
//   • o PDF do contrato no fim da linha, pelo caminho INTERNO (`/api/apolo/empreendimentos/
//     contrato/[documentId]`, com Bearer da sessão do Hub), o mesmo da coluna Contrato da Carteira.

/** De quanto em quanto tempo a tela repede. O cache do servidor é de 5 min: quase sempre bate nele. */
const INTERVALO_MS = 60_000;

/** O que a lista está mostrando: um estado, ou "parado com o perfil X". */
type Recorte = "aguardando-emissao" | "concluidos" | "pendentes" | "todos" | `perfil:${string}`;

/** O que o clique num número do quadro por assinante manda a lista mostrar. */
type FiltroDeAssinante = { alvo: "aguardando" | "assinado" | "vez"; nome: string };

const ANCORA = "lista-de-contratos";

const inteiro = (valor: number): string => valor.toLocaleString("pt-BR");

const pct1 = (valor: number): string =>
  valor.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

const porcentagem = (parte: number, todo: number): string =>
  todo > 0 ? `${Math.round((100 * parte) / todo)}%` : "—";

const numeroOuTraco = (valor: null | number): string => (valor === null ? "—" : pct1(valor));

const brl = (valor: null | number): string =>
  valor === null
    ? "—"
    : valor.toLocaleString("pt-BR", { currency: "BRL", maximumFractionDigits: 0, style: "currency" });

/** 'YYYY-MM-DD' → '01/07/2026', por STRING: `new Date` de data pura mostraria a véspera. */
const dataCurta = (valor: null | string): string => {
  const texto = String(valor ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto.split("-").reverse().join("/") : "—";
};

/** Quantos dias inteiros desde 'YYYY-MM-DD', pela data LOCAL. */
function diasDesde(ymd: null | string): null | number {
  const texto = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const [ano, mes, dia] = texto.split("-").map(Number);
  const entao = new Date(ano ?? 0, (mes ?? 1) - 1, dia ?? 1).getTime();
  if (Number.isNaN(entao)) return null;

  return Math.max(0, Math.floor((Date.now() - entao) / 86_400_000));
}

/** "há 12 dias" / "há 1 dia" / "hoje" — a espera, do jeito que se fala. */
function rotuloDeEspera(ymd: null | string): string {
  const dias = diasDesde(ymd);
  if (dias === null) return "";
  if (dias === 0) return "hoje";

  return dias === 1 ? "há 1 dia" : `há ${inteiro(dias)} dias`;
}

const semAcento = (valor: string) =>
  valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function PainelContratos() {
  const [dados, setDados] = useState<null | PainelDeContratos>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);

  const [emp, setEmp] = useState("");
  const [busca, setBusca] = useState("");
  const [recorte, setRecorte] = useState<Recorte>("todos");
  const [porAssinante, setPorAssinante] = useState<FiltroDeAssinante | null>(null);
  const [aberto, setAberto] = useState<null | ContratoDoPainel>(null);

  // Não repede com a aba escondida: foi polling em aba oculta que rendeu a fatura alta do Hermes.
  const visivel = useRef(true);

  const carregar = useCallback(
    async (comSpinner: boolean) => {
      if (comSpinner) setCarregando(true);
      try {
        const token = await getApoloAccessToken();
        const endereco = emp
          ? `/api/apolo/painel-contratos?emp=${encodeURIComponent(emp)}`
          : "/api/apolo/painel-contratos";
        const resposta = await fetch(endereco, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: PainelDeContratos; error?: string }
          | null;

        if (!resposta.ok || !corpo?.data) {
          setErro(corpo?.error ?? `Falha ao ler os contratos (${resposta.status}).`);
        } else {
          setErro(null);
          setDados(corpo.data);
        }
      } catch (falha) {
        setErro(falha instanceof Error ? falha.message : "Falha ao ler os contratos.");
      }
      setCarregando(false);
    },
    [emp],
  );

  useEffect(() => {
    void carregar(true);
    const aoTrocarVisibilidade = () => {
      visivel.current = !document.hidden;
      if (visivel.current) void carregar(false);
    };
    document.addEventListener("visibilitychange", aoTrocarVisibilidade);
    const timer = setInterval(() => {
      if (visivel.current) void carregar(false);
    }, INTERVALO_MS);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", aoTrocarVisibilidade);
    };
  }, [carregar]);

  /** O clique num número do quadro joga a lista naquele recorte e desce até ela. */
  const filtrarPorAssinante = useCallback((filtro: FiltroDeAssinante) => {
    setPorAssinante(filtro);
    setRecorte("todos");
    document.getElementById(ANCORA)?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const carimbo = dados?.atualizadoEm
    ? new Date(dados.atualizadoEm).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  const recorteRotulo = useMemo(() => {
    if (!dados) return "";
    if (emp === "*") return `Todos os empreendimentos (${dados.codes.length})`;

    return dados.codes
      .map((code) => {
        const achado = dados.empreendimentos.find((item) => item.code === code);
        return achado ? `${achado.nome} · ${achado.code}` : code;
      })
      .join(" + ");
  }, [dados, emp]);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-canvas">
      <header className="flex flex-wrap items-center gap-3 border-b border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
        <div className="min-w-0">
          <h1 className="m-0 text-base font-bold text-ink">Contratos</h1>
          <p className="m-0 text-xs text-ink-soft">
            {recorteRotulo || "carregando o recorte…"} · atualizado às {carimbo}
          </p>
        </div>

        <label className="ml-auto grid gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-soft">
            Empreendimento
          </span>
          {/* ⚠️ O CÓDIGO ANDA JUNTO DO NOME, sempre. Quatro empreendimentos do C2X se chamam
              "VALE DO OURO" (VLO, VOL, VOC, VOR) e três, "LAGOA BONITA": um seletor por nome
              somaria carteiras de donos diferentes. */}
          <select
            className="h-9 min-w-[240px] rounded-lg border border-black/10 bg-canvas px-3 text-sm text-ink dark:border-white/10"
            onChange={(evento) => {
              setEmp(evento.target.value);
              setRecorte("todos");
              setPorAssinante(null);
            }}
            value={emp}
          >
            <option value="">Vale do Ouro · VOC + VOL (padrão)</option>
            <option value="*">Todos os empreendimentos</option>
            {(dados?.empreendimentos ?? []).map((item) => (
              <option key={item.code} value={item.code}>
                {item.nome} · {item.code} ({inteiro(item.contratos)})
              </option>
            ))}
          </select>
        </label>

        <button
          className="inline-flex h-9 items-center gap-2 self-end rounded-lg border border-black/10 px-3 text-sm font-semibold text-ink hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/10"
          disabled={carregando}
          onClick={() => void carregar(true)}
          type="button"
        >
          {carregando ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
          Atualizar
        </button>
      </header>

      <div className="grid gap-4 p-5">
        {erro ? (
          <p className="m-0 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {erro}
          </p>
        ) : null}

        {!dados ? (
          <p className="rounded-xl border border-dashed border-black/[0.12] p-10 text-center text-sm text-ink-soft dark:border-white/[0.12]">
            {carregando ? "Carregando os contratos…" : "Sem dados para este recorte."}
          </p>
        ) : (
          <>
            <FaixaDaFonte
              assinantes={dados.avisoDosAssinantes}
              fonte={dados.avisoDaFonte}
            />
            <FaixaDeTaxas kpis={dados.kpis} taxas={dados.taxas} />
            <BlocosDoPainel kpis={dados.kpis} />

            <ListaDeContratos
              aviso={dados.aviso}
              busca={busca}
              contratos={dados.contratos}
              onAbrir={setAberto}
              onBuscar={setBusca}
              onLimparAssinante={() => setPorAssinante(null)}
              onRecorte={setRecorte}
              porAssinante={porAssinante}
              recorte={recorte}
              total={dados.total}
            />

            <div className="grid gap-4 lg:grid-cols-2">
              {dados.fila.length > 0 ? <SecaoDaFila fila={dados.fila} /> : null}
              <QuadroDeAssinantes
                assinantes={dados.assinantes}
                onFiltrar={filtrarPorAssinante}
                selecionado={porAssinante}
              />
            </div>
          </>
        )}
      </div>

      {aberto ? <ModalDoContrato contrato={aberto} onFechar={() => setAberto(null)} /> : null}
    </div>
  );
}

// ── A FAIXA DE CIMA: a taxa de cada elo da cadeia ───────────────────────────
// O card responde uma pergunta só: em qual elo a assinatura emperra. O pior vem primeiro (a ordem
// sai do servidor) e é o único que ganha cor — vermelho de alerta, porque dourado não é estado.

/**
 * A PROCEDÊNCIA DO QUE ESTÁ NA TELA, no topo — e por que são DUAS faixas e não uma.
 *
 * Os dois avisos dizem coisas diferentes e nenhum substitui o outro (a régua está em
 * `AVISOS_DA_FONTE`, lib/apolo/d4sign-assinaturas):
 *
 *   • `fonte` é NOTÍCIA: a D4Sign não respondeu e o que está abaixo é o registro do C2X, que pode
 *     mostrar como pendente uma assinatura já colhida. Âmbar, porque muda a decisão de cobrar.
 *   • `assinantes` é PREÇO CONHECIDO: a situação foi confirmada, o que veio do sistema antigo é só
 *     a marcação de quem já assinou dentro de contrato ainda andando. No Vale do Ouro isto fica
 *     aceso quase todo dia (185 documentos em movimento contra um teto de 20 conferidos um a um
 *     por carga), então é neutro, informativo: pintar de âmbar o que vive aceso ensina a ignorar a
 *     cor, e aí o dia em que a API cair de verdade ninguém olha.
 *
 * Vem ANTES dos cards de propósito: as taxas e os KPIs saem das MESMAS linhas da lista, então o
 * aviso vale para eles também. Aviso embaixo da lista deixaria o número de cima parecendo exato.
 */
function FaixaDaFonte({
  assinantes,
  fonte,
}: {
  assinantes: null | string;
  fonte: null | string;
}) {
  if (!fonte && !assinantes) return null;

  return (
    <div className="grid gap-2">
      {fonte ? (
        <p className="m-0 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-xs leading-snug text-amber-700 dark:text-amber-400">
          <AlertTriangle aria-hidden="true" className="mt-px shrink-0" size={14} />
          {fonte}
        </p>
      ) : null}
      {assinantes ? (
        <p className="m-0 flex items-start gap-2 rounded-lg border border-black/[0.08] bg-subtle px-3 py-2 text-xs leading-snug text-ink-soft dark:border-white/[0.08]">
          <Info aria-hidden="true" className="mt-px shrink-0" size={14} />
          {assinantes}
        </p>
      ) : null}
    </div>
  );
}

function FaixaDeTaxas({
  kpis,
  taxas,
}: {
  kpis: PainelDeContratos["kpis"];
  taxas: PainelDeContratos["taxas"];
}) {
  if (taxas.length === 0) return null;

  const pior = taxas[0];
  // Só vira alerta se de fato estiver atrás: com tudo assinado, destacar o "menos assinado"
  // inventaria um problema que não existe.
  const destacar = pior !== undefined && pior.assinadas < pior.esperadas ? pior.perfil : null;

  return (
    <section className="rounded-xl border border-black/[0.07] p-4 dark:border-white/[0.08]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-sm font-bold text-ink">Taxa de assinatura por perfil</h2>
        <span className="text-xs text-ink-soft">
          {kpis.unidadesTotalmenteAssinadas === kpis.unidadesComEnvio
            ? "Todos os contratos enviados estão assinados."
            : "Quem está mais atrasado aparece primeiro."}
        </span>
      </div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(184px,1fr))]">
        {taxas.map((taxa) => (
          <CardDeTaxa
            alerta={taxa.perfil === destacar}
            assinadas={taxa.assinadas}
            esperadas={taxa.esperadas}
            key={taxa.perfil}
            perfil={taxa.perfil}
          />
        ))}
      </div>
    </section>
  );
}

function CardDeTaxa({
  alerta,
  assinadas,
  esperadas,
  perfil,
}: {
  alerta: boolean;
  assinadas: number;
  esperadas: number;
  perfil: string;
}) {
  const percentual = esperadas > 0 ? (assinadas / esperadas) * 100 : 0;
  const completo = assinadas >= esperadas;

  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 rounded-xl border p-3.5 ${
        alerta
          ? "border-red-500/40 bg-red-500/[0.06]"
          : "border-black/[0.07] bg-black/[0.02] dark:border-white/[0.08] dark:bg-white/[0.02]"
      }`}
    >
      <div
        className={`text-[10.5px] font-semibold uppercase leading-snug tracking-[0.05em] [overflow-wrap:anywhere] ${
          alerta ? "text-red-600 dark:text-red-400" : "text-ink-soft"
        }`}
      >
        {perfil}
      </div>
      <div className="flex flex-wrap items-baseline gap-1">
        <span
          className={`text-[27px] font-bold leading-none tabular-nums ${
            alerta ? "text-red-600 dark:text-red-400" : "text-ink"
          }`}
        >
          {pct1(percentual)}
        </span>
        <span
          className={`text-[13px] font-semibold ${
            alerta ? "text-red-600 dark:text-red-400" : "text-ink-soft"
          }`}
        >
          %
        </span>
      </div>
      <div className="mt-auto text-[11px] leading-snug text-ink-soft">
        {inteiro(assinadas)} de {inteiro(esperadas)} assinaturas
      </div>
      <div
        aria-hidden="true"
        className="h-1 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]"
      >
        <div
          className={`h-full ${
            completo
              ? "bg-emerald-600 dark:bg-emerald-400"
              : alerta
                ? "bg-red-600 dark:bg-red-400"
                : "bg-ink"
          }`}
          style={{ width: `${Math.min(100, Math.max(0, percentual))}%` }}
        />
      </div>
    </div>
  );
}

// ── OS BLOCOS DO PAINEL INTERNO ─────────────────────────────────────────────
// Comprador, Geral e Prazo do comprador · 7 dias são os três blocos que o painel já tinha; o
// quarto, Emissão, guarda o tempo médio e o aguardando emissão. O cabeçalho dourado ROTULA, não
// sinaliza estado — é o mesmo uso de ouro do painel aprovado.

function BlocosDoPainel({ kpis }: { kpis: PainelDeContratos["kpis"] }) {
  const unidades = kpis.unidadesComEnvio;

  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(252px,1fr))]">
      <BlocoDeKpi titulo="Comprador">
        <NumeroDoBloco cor="ok" rotulo="Unidades assinadas" valor={inteiro(kpis.compradorOk)} />
        <NumeroDoBloco rotulo="Unidades pendentes" valor={inteiro(kpis.compradorPendente)} />
        <NumeroDoBloco cor="ouro" rotulo="Do total" valor={porcentagem(kpis.compradorOk, unidades)} />
      </BlocoDeKpi>

      <BlocoDeKpi titulo="Geral">
        <NumeroDoBloco rotulo="Total de unidades" valor={inteiro(unidades)} />
        <NumeroDoBloco
          cor="ok"
          rotulo="Unidades finalizadas"
          valor={inteiro(kpis.unidadesTotalmenteAssinadas)}
        />
        <NumeroDoBloco
          cor="ouro"
          rotulo="Do total"
          valor={porcentagem(kpis.unidadesTotalmenteAssinadas, unidades)}
        />
      </BlocoDeKpi>

      <BlocoDeKpi titulo="Prazo do comprador · 7 dias">
        <NumeroDoBloco
          cor={kpis.compradorEmAtraso > 0 ? "ruim" : undefined}
          rotulo="Em atraso"
          valor={inteiro(kpis.compradorEmAtraso)}
        />
        <NumeroDoBloco rotulo="Dias até assinar" valor={numeroOuTraco(kpis.diasAteAssinar)} />
        <NumeroDoBloco rotulo="Dias desde o envio" valor={numeroOuTraco(kpis.diasDesdeEnvio)} />
      </BlocoDeKpi>

      <BlocoDeKpi titulo="Emissão">
        <NumeroDoBloco rotulo="Tempo médio em dias" valor={numeroOuTraco(kpis.tempoMedioDias)} />
        <NumeroDoBloco rotulo="Aguardando emissão" valor={inteiro(kpis.aguardandoEmissao)} />
      </BlocoDeKpi>
    </div>
  );
}

function BlocoDeKpi({ children, titulo }: { children: React.ReactNode; titulo: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.07] dark:border-white/[0.08]">
      <h2 className="m-0 border-b border-black/[0.07] bg-[#A07C3B]/[0.08] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.13em] text-[#A07C3B] dark:border-white/[0.08]">
        {titulo}
      </h2>
      <div className="flex gap-2 px-4 py-4">{children}</div>
    </div>
  );
}

function NumeroDoBloco({
  cor,
  rotulo,
  valor,
}: {
  cor?: "ok" | "ouro" | "ruim";
  rotulo: string;
  valor: string;
}) {
  const tom =
    cor === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : cor === "ruim"
        ? "text-red-600 dark:text-red-400"
        : cor === "ouro"
          ? "text-[#A07C3B]"
          : "text-ink";

  return (
    <div className="min-w-0 flex-1 text-center">
      <span className={`block text-[26px] font-bold leading-none tabular-nums ${tom}`}>{valor}</span>
      <span className="mt-1.5 block text-[11.5px] leading-tight text-ink-soft">{rotulo}</span>
    </div>
  );
}

// ── O PALCO: A LISTA DE CONTRATOS ───────────────────────────────────────────
//
// Uma linha por CONTRATO, rotulada pela unidade. A granularidade é o ENVIO (unidade revendida tem
// dois contratos com esquemas diferentes: fundi-los criaria um esquema que não existe), mais as
// linhas de contrato gerado que ainda não saiu para assinar.
//
// A ordem vem do servidor e é a do gargalo: aguardando emissão primeiro, depois a espera mais
// antiga, e as concluídas no fim — visíveis, mas sem disputar o palco.

function ListaDeContratos({
  aviso,
  busca,
  contratos,
  onAbrir,
  onBuscar,
  onLimparAssinante,
  onRecorte,
  porAssinante,
  recorte,
  total,
}: {
  aviso: null | string;
  busca: string;
  contratos: ContratoDoPainel[];
  onAbrir: (contrato: ContratoDoPainel) => void;
  onBuscar: (texto: string) => void;
  onLimparAssinante: () => void;
  onRecorte: (recorte: Recorte) => void;
  porAssinante: FiltroDeAssinante | null;
  recorte: Recorte;
  total: number;
}) {
  const alvo = semAcento(busca.trim());

  // A BUSCA VEM ANTES DAS PÍLULAS de propósito: a contagem da pílula tem que ser o que o clique
  // vai mostrar. Contar sobre tudo faria a pílula prometer 12 e entregar 2 com a busca ativa.
  const buscados = useMemo(
    () =>
      contratos.filter((contrato) => {
        if (porAssinante) {
          const { alvo: situacao, nome } = porAssinante;
          const casa =
            situacao === "vez"
              ? contrato.naVez.includes(nome)
              : contrato.esquema.some((item) => item.nome === nome && item.situacao === situacao);
          if (!casa) return false;
        }
        if (!alvo) return true;

        return semAcento(
          [
            contrato.unidade,
            contrato.comprador,
            contrato.contrato?.imobiliaria,
            contrato.empreendimento,
          ]
            .filter(Boolean)
            .join(" "),
        ).includes(alvo);
      }),
    [alvo, contratos, porAssinante],
  );

  const semEmissao = buscados.filter((contrato) => contrato.situacao === "aguardando-emissao")
    .length;
  const pendentes = buscados.filter(
    (contrato) => !contrato.concluida && contrato.situacao !== "aguardando-emissao",
  );
  const concluidos = buscados.filter((contrato) => contrato.concluida).length;

  // Os perfis que estão SEGURANDO algum contrato, do que mais segura para o que menos segura.
  // ⚠️ Contrato parado em dois perfis (degrau dividido) conta nos dois: a soma das pílulas pode
  // passar do total de pendentes, e é assim que tem que ser — ele espera as duas assinaturas.
  const porPerfil = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const contrato of pendentes) {
      for (const perfil of contrato.perfisNaVez) {
        contagem.set(perfil, (contagem.get(perfil) ?? 0) + 1);
      }
    }

    return [...contagem.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
  }, [pendentes]);

  const lista = buscados.filter((contrato) => {
    if (recorte === "aguardando-emissao") return contrato.situacao === "aguardando-emissao";
    if (recorte === "pendentes")
      return !contrato.concluida && contrato.situacao !== "aguardando-emissao";
    if (recorte === "concluidos") return contrato.concluida;
    if (recorte.startsWith("perfil:")) {
      return !contrato.concluida && contrato.perfisNaVez.includes(recorte.slice(7));
    }

    return true;
  });

  const variosEmpreendimentos =
    new Set(contratos.map((contrato) => contrato.empreendimento).filter(Boolean)).size > 1;

  return (
    <section
      className="rounded-xl border border-black/[0.07] p-4 dark:border-white/[0.08]"
      id={ANCORA}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-sm font-bold text-ink">Contratos por unidade</h2>
        <span className="text-xs tabular-nums text-ink-soft">
          {inteiro(lista.length)} de {inteiro(total)} {total === 1 ? "contrato" : "contratos"}
        </span>
      </div>
      <p className="m-0 mt-1.5 text-[12.5px] leading-normal text-ink-soft">
        Cada barra é um perfil que assina aquele contrato. Clique na unidade para ver os dados do
        contrato e a tabela de assinatura; o ícone no fim da linha abre o PDF assinado.
      </p>

      {porAssinante ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-black/[0.07] bg-black/[0.02] px-3 py-2 dark:border-white/[0.08] dark:bg-white/[0.02]">
          <span className="text-[12.5px] text-ink">
            {porAssinante.alvo === "vez"
              ? "Contratos parados com "
              : porAssinante.alvo === "assinado"
                ? "Contratos já assinados por "
                : "Contratos em que ainda não é a vez de "}
            <b>{porAssinante.nome}</b>
          </span>
          <button
            className="ml-auto rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-soft hover:bg-subtle"
            onClick={onLimparAssinante}
            type="button"
          >
            limpar
          </button>
        </div>
      ) : null}

      <div className="mt-3.5 flex flex-wrap gap-2">
        <Pilula
          ativo={recorte === "todos"}
          onClick={() => onRecorte("todos")}
          rotulo={`Todos (${inteiro(buscados.length)})`}
        />
        {semEmissao > 0 ? (
          <Pilula
            ativo={recorte === "aguardando-emissao"}
            onClick={() =>
              onRecorte(recorte === "aguardando-emissao" ? "todos" : "aguardando-emissao")
            }
            rotulo={`Aguardando emissão (${inteiro(semEmissao)})`}
          />
        ) : null}
        {pendentes.length > 0 ? (
          <Pilula
            ativo={recorte === "pendentes"}
            onClick={() => onRecorte(recorte === "pendentes" ? "todos" : "pendentes")}
            rotulo={`Em assinatura (${inteiro(pendentes.length)})`}
          />
        ) : null}
        {concluidos > 0 ? (
          <Pilula
            ativo={recorte === "concluidos"}
            onClick={() => onRecorte(recorte === "concluidos" ? "todos" : "concluidos")}
            rotulo={`Concluídos (${inteiro(concluidos)})`}
          />
        ) : null}
      </div>

      {porPerfil.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-ink-soft">
            Parado com
          </span>
          {porPerfil.map(([perfil, quantos]) => (
            <Pilula
              ativo={recorte === `perfil:${perfil}`}
              key={perfil}
              onClick={() =>
                onRecorte(recorte === `perfil:${perfil}` ? "todos" : `perfil:${perfil}`)
              }
              rotulo={`${perfil} (${inteiro(quantos)})`}
            />
          ))}
        </div>
      ) : null}

      <label className="mt-3 flex max-w-[360px] items-center gap-2 rounded-lg border border-black/[0.07] bg-black/[0.02] px-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <Search aria-hidden="true" className="shrink-0 text-ink-soft" size={15} />
        <input
          className="min-w-0 flex-1 border-none bg-transparent py-2 text-sm text-ink outline-none"
          onChange={(evento) => onBuscar(evento.target.value)}
          placeholder="Buscar por unidade, comprador ou imobiliária"
          type="search"
          value={busca}
        />
      </label>

      {lista.length === 0 ? (
        <p className="my-6 text-center text-sm text-ink-soft">Nenhum contrato neste recorte.</p>
      ) : (
        <div className="mt-3">
          {lista.map((contrato, indice) => (
            <div
              className={indice === 0 ? "" : "border-t border-black/[0.07] dark:border-white/[0.08]"}
              key={`${contrato.envioId}-${contrato.unidade}-${indice}`}
            >
              <LinhaDoContrato
                contrato={contrato}
                mostrarEmpreendimento={variosEmpreendimentos}
                onAbrir={() => onAbrir(contrato)}
              />
            </div>
          ))}
        </div>
      )}

      {aviso ? <p className="m-0 mt-3.5 text-xs leading-normal text-ink-soft">{aviso}</p> : null}
    </section>
  );
}

function Pilula({
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
      className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
        ativo
          ? "border-ink bg-ink text-canvas"
          : "border-line text-ink-soft hover:bg-subtle"
      }`}
      onClick={onClick}
      type="button"
    >
      {rotulo}
    </button>
  );
}

/**
 * A linha do contrato: identificação, uma barrinha por perfil daquele contrato, a situação e o PDF.
 *
 * ⚠️ SÓ OS PERFIS DAQUELE CONTRATO desenham barra. Perfil que não assina ali não vira barra vazia,
 * porque barra vazia diz "falta alguém" de quem nunca foi chamado.
 *
 * O corpo é um botão (abre o popup) e o PDF é um botão IRMÃO, fora dele: botão dentro de botão é
 * HTML inválido e o clique do PDF viraria clique da linha.
 */
function LinhaDoContrato({
  contrato,
  mostrarEmpreendimento,
  onAbrir,
}: {
  contrato: ContratoDoPainel;
  mostrarEmpreendimento: boolean;
  onAbrir: () => void;
}) {
  const percentual = contrato.total > 0 ? (contrato.assinadas / contrato.total) * 100 : 0;
  const semEnvio = contrato.situacao === "aguardando-emissao";

  return (
    <div className="flex items-center gap-2">
      <button
        className="min-w-0 flex-1 rounded-lg px-2.5 py-3 text-left transition-colors hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink dark:hover:bg-white/[0.04]"
        onClick={onAbrir}
        title={`Ver o contrato de ${contrato.unidade || "esta unidade"}`}
        type="button"
      >
        <div className="grid items-center gap-3.5 [grid-template-columns:minmax(0,1fr)] md:[grid-template-columns:minmax(140px,1.05fr)_minmax(0,2.3fr)_minmax(116px,0.85fr)]">
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold text-ink [overflow-wrap:anywhere]">
              {contrato.unidade || "unidade sem nome"}
              {mostrarEmpreendimento && contrato.empreendimento ? (
                <span className="font-medium text-ink-soft"> · {contrato.empreendimento}</span>
              ) : null}
            </div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-ink-soft [overflow-wrap:anywhere]">
              {contrato.comprador ?? "comprador não registrado"}
            </div>
            {/* VALOR E GERAÇÃO NA LINHA, imobiliária e faturamento no popup — a mesma divisão que
                o portal usa depois da fusão, para as duas telas lerem igual. */}
            {contrato.contrato ? (
              <div className="mt-0.5 text-[11px] leading-snug text-ink-muted">
                {brl(contrato.contrato.valorTabela)}
                {contrato.contrato.geradoEm
                  ? ` · gerado em ${dataCurta(contrato.contrato.geradoEm)}`
                  : ""}
              </div>
            ) : null}
            {/* ⚠️ SELO SÓ NO FALLBACK DE VERDADE (`c2x-legado`). O outro caso marcado,
                `d4sign-status`, é a maioria das linhas no Vale do Ouro: carimbar todas viraria
                ruído e mataria o sinal do que importa. Para elas, quem avisa é a faixa do topo,
                que diz o número de uma vez; o detalhe pessoa a pessoa aparece no popup, que é
                onde ele passa a ter consequência. */}
            {contrato.fonte === "c2x-legado" && contrato.aviso ? (
              <span
                className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-amber-700 dark:text-amber-400"
                title={contrato.aviso}
              >
                <AlertTriangle aria-hidden="true" size={11} />
                sistema antigo
              </span>
            ) : null}
          </div>

          {semEnvio ? (
            <div className="text-xs text-ink-soft">
              Contrato gerado
              {contrato.contrato?.geradoEm ? ` em ${dataCurta(contrato.contrato.geradoEm)}` : ""} e
              ainda não enviado para assinatura.
            </div>
          ) : contrato.grupos.length === 0 ? (
            <div className="text-xs text-ink-soft">
              Nenhum assinante ficou registrado neste envio. Não há de quem cobrar sem refazer o
              envio.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              {contrato.grupos.map((grupo) => (
                <BarraDoGrupo grupo={grupo} key={grupo.perfil} />
              ))}
            </div>
          )}

          <div className="min-w-0">
            {semEnvio ? (
              <span className="text-[11.5px] font-semibold text-ink-soft">Aguardando emissão</span>
            ) : (
              <>
                <div className="text-[13px] font-bold tabular-nums text-ink">
                  {inteiro(contrato.assinadas)} de {inteiro(contrato.total)}
                  <span className="font-medium text-ink-soft"> · {Math.round(percentual)}%</span>
                </div>
                <div className="mt-1">
                  {contrato.concluida ? (
                    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 aria-hidden="true" size={13} />
                      contrato completo
                    </span>
                  ) : (
                    <span className="text-[11.5px] leading-snug text-ink-soft">
                      {contrato.perfisNaVez.length > 0 ? (
                        <>
                          com{" "}
                          <b className="font-semibold text-ink">
                            {contrato.perfisNaVez.join(" e ")}
                          </b>
                          {" · "}
                        </>
                      ) : null}
                      {rotuloDeEspera(contrato.enviadoEm)}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </button>

      <BotaoDoPdf contrato={contrato} />
    </div>
  );
}

/**
 * O PDF do contrato, no fim da linha — *"no final dessa linha vai ter o contrato para ser
 * baixado"*.
 *
 * O caminho é o INTERNO, o mesmo da coluna Contrato da Carteira: pede à rota do Apolo um PDF fresco
 * pela API do D4Sign (o link do C2X expira) com o Bearer da sessão do Hub, e abre em aba nova. Sem
 * documento no envio, a célula vira um traço — igual à carteira.
 */
function BotaoDoPdf({ contrato }: { contrato: ContratoDoPainel }) {
  const [abrindo, setAbrindo] = useState(false);
  const [falhou, setFalhou] = useState(false);

  if (!contrato.documentoId) {
    return (
      <span
        className="w-8 shrink-0 text-center text-xs text-ink-muted"
        title={
          contrato.situacao === "aguardando-emissao"
            ? "O contrato ainda não saiu para assinatura."
            : "Sem documento assinado neste envio."
        }
      >
        -
      </span>
    );
  }

  async function abrir() {
    const documentoId = contrato.documentoId;
    if (!documentoId || abrindo) return;

    const aba = window.open("about:blank", "_blank");
    try {
      setAbrindo(true);
      setFalhou(false);
      const token = await getApoloAccessToken();
      const resposta = await fetch(
        `/api/apolo/empreendimentos/contrato/${encodeURIComponent(documentoId)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );

      if (!resposta.ok) throw new Error("Não foi possível abrir o contrato.");

      const url = window.URL.createObjectURL(await resposta.blob());
      if (aba) aba.location.href = url;
      else window.open(url, "_blank");
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch {
      aba?.close();
      setFalhou(true);
    } finally {
      setAbrindo(false);
    }
  }

  return (
    <button
      className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg border bg-subtle transition-colors disabled:opacity-60 ${
        falhou
          ? "border-red-500/40 text-red-600 dark:text-red-400"
          : "border-line text-ink-muted hover:border-[#A07C3B]/40 hover:text-[#7A5E2C] dark:hover:text-[#d9b877]"
      }`}
      disabled={abrindo}
      onClick={() => void abrir()}
      title={falhou ? "Falhou ao abrir o contrato. Tente de novo." : "Abrir o contrato assinado"}
      type="button"
    >
      {abrindo ? (
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
      ) : (
        <FileText aria-hidden="true" className="size-3.5" />
      )}
    </button>
  );
}

/**
 * A barrinha de um perfil dentro do contrato: rótulo, trilha e fração.
 *
 * Completo enche em verde; o grupo DA VEZ enche na tinta do texto e traz o rótulo em negrito,
 * porque é ele que a linha existe para denunciar; quem ainda espera fica esmaecido. Cor por perfil
 * viraria arco-íris com cinco barras lado a lado.
 */
function BarraDoGrupo({ grupo }: { grupo: GrupoDaUnidade }) {
  const completo = grupo.assinadas >= grupo.total;
  const percentual = grupo.total > 0 ? (grupo.assinadas / grupo.total) * 100 : 0;
  const destacado = grupo.naVez && !completo;

  return (
    <div className={`min-w-[78px] flex-[1_1_88px] ${completo || grupo.naVez ? "" : "opacity-60"}`}>
      <div
        className={`mb-1 truncate text-[10.5px] leading-snug ${
          destacado ? "font-bold text-ink" : "font-medium text-ink-soft"
        }`}
        title={grupo.perfil}
      >
        {grupo.perfil}
      </div>
      <div
        aria-hidden="true"
        className={`h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12] ${
          destacado ? "ring-[1.5px] ring-ink" : ""
        }`}
      >
        <div
          className={`h-full ${
            completo
              ? "bg-emerald-600 dark:bg-emerald-400"
              : grupo.naVez
                ? "bg-ink"
                : "bg-ink-muted"
          }`}
          style={{ width: `${percentual}%` }}
        />
      </div>
      <div className="mt-0.5 text-[10.5px] tabular-nums text-ink-soft">
        {inteiro(grupo.assinadas)} de {inteiro(grupo.total)}
      </div>
    </div>
  );
}

// ── O POPUP: OS DADOS DO CONTRATO E A TABELA DE ASSINATURA ──────────────────
//
// O popup do portal mostrava só a tabela de assinatura. Na fusão das duas abas ele ganhou o
// CABEÇALHO DE FATOS que a aba Contratos tinha — gerado em, valor, imobiliária e faturado em —,
// porque era o lugar natural deles: enfiar quatro colunas na linha devolveria a tabela larga que o
// desenho novo substituiu.
//
// TABELA e não linha do tempo: metade dos empreendimentos assina com a ordem DESLIGADA (todo mundo
// no degrau 0), e uma linha do tempo desenharia uma sequência que ali não existe. A coluna Ordem só
// aparece quando o contrato tem ordem de verdade.

function ModalDoContrato({
  contrato,
  onFechar,
}: {
  contrato: ContratoDoPainel;
  onFechar: () => void;
}) {
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") onFechar();
    }
    window.addEventListener("keydown", aoTeclar);

    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const percentual = contrato.total > 0 ? (contrato.assinadas / contrato.total) * 100 : 0;
  const temOrdem = new Set(contrato.esquema.map((item) => item.degrau)).size > 1;
  const semEnvio = contrato.situacao === "aguardando-emissao";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <button aria-label="Fechar" className="absolute inset-0 cursor-default" onClick={onFechar} type="button" />
      <div className="relative z-[1] flex max-h-[85vh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border border-black/[0.07] bg-canvas shadow-2xl dark:border-white/[0.08]">
        <header className="flex items-start justify-between gap-3 border-b border-black/[0.07] px-5 py-3.5 dark:border-white/[0.08]">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-sm font-bold text-ink">
              <FileText aria-hidden="true" className="text-ink-soft" size={16} />
              Contrato · {contrato.unidade || "unidade sem nome"}
            </p>
            <p className="m-0 mt-0.5 truncate text-xs text-ink-soft">
              {[contrato.comprador, contrato.empreendimento].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button
            aria-label="Fechar"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-soft hover:bg-subtle"
            onClick={onFechar}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ⚠️ AQUI O AVISO APARECE SEMPRE que a linha tiver um, inclusive no `d4sign-status` que
              a lista não carimba. É neste popup que se decide cobrar uma pessoa pelo nome, e a
              tabela abaixo mostra tique por tique — num documento ainda andando, esses tiques são
              do sistema antigo. Âmbar só no fallback, que é o caso em que a SITUAÇÃO pode estar
              errada; no resto, neutro. */}
          {contrato.aviso ? (
            <p
              className={`m-0 flex items-start gap-2 border-b px-5 py-2.5 text-xs leading-snug ${
                contrato.fonte === "c2x-legado"
                  ? "border-amber-500/30 bg-amber-500/[0.07] text-amber-700 dark:text-amber-400"
                  : "border-black/[0.07] bg-subtle text-ink-soft dark:border-white/[0.08]"
              }`}
            >
              {contrato.fonte === "c2x-legado" ? (
                <AlertTriangle aria-hidden="true" className="mt-px shrink-0" size={14} />
              ) : (
                <Info aria-hidden="true" className="mt-px shrink-0" size={14} />
              )}
              {contrato.aviso}
            </p>
          ) : null}

          {/* OS FATOS DO CONTRATO — o que a aba Contratos mostrava, sem se perder na fusão. */}
          <div className="grid grid-cols-2 gap-3 border-b border-black/[0.07] px-5 py-3.5 sm:grid-cols-4 dark:border-white/[0.08]">
            <Fato rotulo="Gerado em" valor={dataCurta(contrato.contrato?.geradoEm ?? null)} />
            <Fato rotulo="Valor de tabela" valor={brl(contrato.contrato?.valorTabela ?? null)} />
            <Fato rotulo="Imobiliária" valor={contrato.contrato?.imobiliaria ?? "—"} />
            <Fato rotulo="Faturado em" valor={dataCurta(contrato.contrato?.faturadoEm ?? null)} />
          </div>

          <div className="border-b border-black/[0.07] px-5 py-3.5 dark:border-white/[0.08]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-[13px] font-bold text-ink">
                {semEnvio
                  ? "Ainda não enviado para assinatura"
                  : `${inteiro(contrato.assinadas)} de ${inteiro(contrato.total)} assinaturas`}
              </span>
              {semEnvio ? null : (
                <span className="text-xs text-ink-soft">
                  enviado em {dataCurta(contrato.enviadoEm)} · {rotuloDeEspera(contrato.enviadoEm)}
                </span>
              )}
            </div>
            {semEnvio ? null : (
              <div
                aria-hidden="true"
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]"
              >
                <div
                  className={`h-full ${
                    contrato.concluida ? "bg-emerald-600 dark:bg-emerald-400" : "bg-ink"
                  }`}
                  style={{ width: `${percentual}%` }}
                />
              </div>
            )}
          </div>

          {contrato.esquema.length === 0 ? (
            <p className="m-0 p-6 text-center text-sm text-ink-soft">
              {semEnvio
                ? "O contrato foi gerado e ainda não saiu para assinatura. Não há esquema de assinatura para mostrar."
                : "O contrato saiu para assinatura, mas nenhum assinante ficou registrado no envio. Não há de quem cobrar sem refazer o envio."}
            </p>
          ) : (
            <div className="px-2.5 py-3">
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    {[
                      ...(temOrdem ? ["Ordem"] : []),
                      "Assinante",
                      "Perfil",
                      "Situação",
                      "Assinou em",
                    ].map((coluna) => (
                      <th
                        className={`whitespace-nowrap border-b border-black/[0.07] px-2.5 py-2 text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-soft dark:border-white/[0.08] ${
                          coluna === "Assinou em" ? "text-right" : "text-left"
                        }`}
                        key={coluna}
                      >
                        {coluna}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="[&_tr:nth-child(even)]:bg-black/[0.02] dark:[&_tr:nth-child(even)]:bg-white/[0.02]">
                  {contrato.esquema.map((item, indice) => (
                    <tr key={`${item.nome}-${item.perfil}-${indice}`}>
                      {temOrdem ? (
                        <td className="px-2.5 py-2 tabular-nums text-ink-soft">
                          {item.degrau || "—"}
                        </td>
                      ) : null}
                      <td className="px-2.5 py-2 font-semibold text-ink">
                        {item.nome}
                        {/* ⚠️ O E-MAIL APARECE AQUI e não no portal: esta tela é do time. */}
                        {item.email ? (
                          <span className="block text-[11px] font-normal text-ink-soft">
                            {item.email}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2.5 py-2 text-ink-soft">{item.perfil}</td>
                      <td className="px-2.5 py-2">
                        <SeloDaSituacao situacao={item.situacao} />
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-2 text-right tabular-nums text-ink-soft">
                        {dataCurta(item.assinadoEm)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {contrato.concluida ? null : (
                <p className="m-0 mt-3 px-2.5 text-[11.5px] leading-normal text-ink-soft">
                  Quem está em <b>é a vez</b> pode assinar agora. Quem está em <b>aguardando</b> só é
                  chamado depois que os anteriores assinarem.
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
          <span className="text-[11.5px] text-ink-soft">
            {contrato.documentoId
              ? "O PDF vem da D4Sign na hora do clique."
              : "Sem PDF disponível para este contrato."}
          </span>
          <BotaoDoPdf contrato={contrato} />
        </footer>
      </div>
    </div>
  );
}

function Fato({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-ink-soft">
        {rotulo}
      </span>
      <span className="mt-0.5 block truncate text-[13px] font-semibold text-ink" title={valor}>
        {valor}
      </span>
    </div>
  );
}

function SeloDaSituacao({ situacao }: { situacao: "aguardando" | "assinado" | "vez" }) {
  const tom =
    situacao === "assinado"
      ? "bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-400"
      : situacao === "vez"
        ? "bg-black/[0.06] font-semibold text-ink dark:bg-white/[0.10]"
        : "text-ink-soft";

  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] ${tom}`}>
      {situacao === "assinado" ? "Assinou" : situacao === "vez" ? "É a vez" : "Aguardando"}
    </span>
  );
}

// ── A FILA, DEGRAU A DEGRAU ─────────────────────────────────────────────────
//
// ⚠️ ELA SÓ APARECE QUANDO O RECORTE TEM ORDEM DE VERDADE (o servidor devolve vazia quando todo
// mundo está no degrau 0), e o NOME DO DEGRAU É DERIVADO dos perfis que assinam nele. A tabela fixa
// do painel antigo (1 Corretor, 2 Comprador, 3 Testemunhas…) descreve o Vale do Ouro e mente fora
// dele: no LBR a ordem 3 é da Imobiliária e a 4 do Comprador.

function SecaoDaFila({ fila }: { fila: PainelDeContratos["fila"] }) {
  return (
    <section className="rounded-xl border border-black/[0.07] p-4 dark:border-white/[0.08]">
      <h2 className="m-0 text-sm font-bold text-ink">A fila, degrau a degrau</h2>
      <p className="m-0 mb-3.5 mt-1.5 text-[12.5px] leading-normal text-ink-soft">
        Quem está num degrau só é chamado depois que todos os anteriores assinarem.
      </p>
      <div className="grid gap-2.5">
        {fila.map((degrau) => {
          const percentual = degrau.total > 0 ? (100 * degrau.assinadas) / degrau.total : 0;

          return (
            <div
              className="grid grid-cols-[minmax(96px,132px)_1fr_42px] items-center gap-2.5"
              key={degrau.degrau}
            >
              <span className="min-w-0 text-xs text-ink">
                {degrau.degrau}. {degrau.perfis.join(", ") || "sem perfil"}
                <span className="block text-[11px] text-ink-soft">
                  {inteiro(degrau.assinadas)} de {inteiro(degrau.total)}
                </span>
              </span>
              <span className="block h-3.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/[0.12]">
                <i
                  className={`block h-full ${
                    percentual >= 100 ? "bg-emerald-600 dark:bg-emerald-400" : "bg-ink"
                  }`}
                  style={{ width: `${percentual}%` }}
                />
              </span>
              <span className="text-right text-xs tabular-nums text-ink-soft">
                {Math.round(percentual)}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── O QUADRO POR ASSINANTE ──────────────────────────────────────────────────
//
// ⚠️ "ASSINAR" SÓ CONTA O QUE ESTÁ COM A PESSOA. A fila é ordenada, e somar tudo que ela não
// assinou dava um número que ela não tem como resolver: o Northon aparecia com 181 pendências
// quando só 2 estavam de fato na vez dele, e a Nívea com 178 sem NENHUMA.

function QuadroDeAssinantes({
  assinantes,
  onFiltrar,
  selecionado,
}: {
  assinantes: AssinanteInterno[];
  onFiltrar: (filtro: FiltroDeAssinante) => void;
  selecionado: FiltroDeAssinante | null;
}) {
  const [busca, setBusca] = useState("");

  const alvo = semAcento(busca.trim());
  const lista = assinantes.filter((assinante) =>
    alvo ? semAcento(assinante.nome).includes(alvo) : true,
  );

  return (
    <section className="rounded-xl border border-black/[0.07] p-4 dark:border-white/[0.08]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-sm font-bold text-ink">Quadro por assinante</h2>
        <span className="text-xs tabular-nums text-ink-soft">
          {inteiro(assinantes.length)} {assinantes.length === 1 ? "pessoa" : "pessoas"}
        </span>
      </div>
      <p className="m-0 mb-3 mt-1.5 text-[12.5px] leading-normal text-ink-soft">
        Clique num número para ver quais contratos ele representa. <b>Assinar</b> é o que está com a
        pessoa agora; <b>aguardando</b> é o que ainda depende de quem assina antes dela.
      </p>

      <label className="mb-3 flex max-w-[280px] items-center gap-2 rounded-lg border border-black/[0.07] bg-black/[0.02] px-3 dark:border-white/[0.08] dark:bg-white/[0.02]">
        <Search aria-hidden="true" className="shrink-0 text-ink-soft" size={15} />
        <input
          className="min-w-0 flex-1 border-none bg-transparent py-2 text-[13.5px] text-ink outline-none"
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Buscar assinante pelo nome"
          type="search"
          value={busca}
        />
      </label>

      {lista.length === 0 ? (
        <p className="my-4 text-center text-sm text-ink-soft">
          {assinantes.length === 0
            ? "Nenhum assinante registrado nos contratos deste recorte."
            : "Nenhum assinante com esse nome neste recorte."}
        </p>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 z-[1] bg-canvas">
              <tr>
                {["Assinante", "Assinado", "Assinar", "Aguardando"].map((coluna) => (
                  <th
                    className={`whitespace-nowrap border-b border-black/[0.07] px-2 py-2 text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-soft dark:border-white/[0.08] ${
                      coluna === "Assinante" ? "text-left" : "text-right"
                    }`}
                    key={coluna}
                  >
                    {coluna}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="[&_tr:nth-child(even)]:bg-black/[0.02] dark:[&_tr:nth-child(even)]:bg-white/[0.02]">
              {lista.map((assinante) => (
                <tr key={`${assinante.nome}-${assinante.email ?? ""}`}>
                  <td className="px-2 py-1.5 font-semibold text-ink">
                    {assinante.nome}
                    {assinante.papel ? (
                      <span className="font-medium text-ink-soft"> · {assinante.papel}</span>
                    ) : null}
                    {/* O e-mail sob o nome: é ele que separa três sócios da mesma razão social. */}
                    {assinante.email ? (
                      <span className="block text-[11px] font-normal text-ink-soft">
                        {assinante.email}
                        {assinante.emailsExtras > 0 ? ` +${assinante.emailsExtras}` : ""}
                      </span>
                    ) : null}
                  </td>
                  <NumeroClicavel
                    aoClicar={() => onFiltrar({ alvo: "assinado", nome: assinante.nome })}
                    ativo={selecionado?.alvo === "assinado" && selecionado.nome === assinante.nome}
                    titulo={`Contratos que ${assinante.nome} já assinou`}
                    valor={assinante.assinou}
                  />
                  <NumeroClicavel
                    aoClicar={() => onFiltrar({ alvo: "vez", nome: assinante.nome })}
                    ativo={selecionado?.alvo === "vez" && selecionado.nome === assinante.nome}
                    destaque
                    titulo={`Contratos esperando a assinatura de ${assinante.nome} agora`}
                    valor={assinante.naVez}
                  />
                  <NumeroClicavel
                    aoClicar={() => onFiltrar({ alvo: "aguardando", nome: assinante.nome })}
                    ativo={
                      selecionado?.alvo === "aguardando" && selecionado.nome === assinante.nome
                    }
                    titulo={`Contratos em que ${assinante.nome} ainda depende de outra assinatura`}
                    valor={assinante.aguardandoAnteriores}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Um número do quadro que joga a lista naquele recorte.
 *
 * ⚠️ ZERO NÃO VIRA BOTÃO (regra do painel): clicar num zero levaria a uma lista vazia, e lista
 * vazia depois de um clique parece tela quebrada.
 */
function NumeroClicavel({
  aoClicar,
  ativo,
  destaque,
  titulo,
  valor,
}: {
  aoClicar: () => void;
  ativo: boolean;
  destaque?: boolean;
  titulo: string;
  valor: number;
}) {
  if (valor === 0) {
    return <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted opacity-60">0</td>;
  }

  return (
    <td className="px-2 py-1.5 text-right tabular-nums">
      <button
        className={`rounded px-1.5 py-0.5 tabular-nums transition-colors ${
          ativo
            ? "bg-ink font-semibold text-canvas"
            : `underline decoration-dotted underline-offset-2 hover:bg-subtle ${
                destaque ? "font-semibold text-ink" : "text-ink-soft"
              }`
        }`}
        onClick={aoClicar}
        title={titulo}
        type="button"
      >
        {inteiro(valor)}
      </button>
    </td>
  );
}
