"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";
import {
  agruparUnidadesDeAssinatura,
  contarParadoPorPerfil,
} from "@/lib/apolo/unidades-assinatura";
import { UnidadesEmBarra } from "./unidades-em-barra";

// PAINEL DE ASSINATURA do Vale do Ouro, no lugar do Painel Assinatura do Power BI.
//
// As regras de leitura vivem no servidor (lib/apolo/painel-assinatura.ts); aqui é só a tela.
// O desenho segue o painel que o Lucas já usa: bloco Comprador, bloco Geral, o prazo, a fila e
// o quadro de quem assina todo contrato.

type Linha = {
  assinadoEm: null | string;
  assinou: boolean;
  contrato: number;
  degrau: number;
  diasDesdeEnvio: number;
  email: string;
  emp: string;
  envio: string;
  lote: string;
  perfil: string;
  prazo: null | string;
  quadra: string;
  /**
   * Onde a assinatura está na fila DAQUELE contrato: já assinou, é a vez dela, ou ainda espera
   * alguém antes. Calculado no servidor (`marcarSituacao`), porque depende do contrato inteiro.
   */
  situacao: "aguardando" | "assinado" | "vez";
  un: string;
  usuario: string;
  valor: number;
};

/** De quanto em quanto tempo a tela pede de novo. O cache do servidor é de 5 min; pedir de 60 em
 *  60s é barato porque quase sempre bate no cache, e mantém o carimbo honesto. */
const INTERVALO_MS = 60_000;

const NOME_DEGRAU: Record<number, string> = {
  1: "Corretor / imobiliária",
  2: "Comprador e cônjuge",
  3: "Testemunhas",
  4: "Vendedor",
  5: "Sócios e testemunha",
  6: "Anuentes",
  7: "Careli",
  8: "Careli",
};

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const num = (n: number) => n.toLocaleString("pt-BR");
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "—");
const dataCurta = (iso: null | string) =>
  iso ? iso.split("-").reverse().join("/") : "—";

/**
 * @param fonte De onde os dados vêm. O padrão é a rota interna (exige sessão do Apolo); a versão
 *   pública passa a rota liberada. O componente é o MESMO nos dois: painel que diverge entre
 *   interno e público vira duas verdades sobre o mesmo contrato.
 */
export function PainelAssinatura({ fonte = "/api/apolo/painel-assinatura" }: { fonte?: string } = {}) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [atualizadoEm, setAtualizadoEm] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);

  const [emp, setEmp] = useState("");
  const [perfil, setPerfil] = useState("");
  const [status, setStatus] = useState("");
  const [unidade, setUnidade] = useState("");
  const [usuario, setUsuario] = useState("");

  // Evita pedir de novo com a aba escondida: painel esquecido aberto a noite toda não consulta
  // nada. Foi polling em aba oculta que rendeu a fatura alta do Hermes.
  const visivel = useRef(true);

  const publico = !fonte.startsWith("/api/apolo/");

  const carregar = useCallback(async (comSpinner: boolean) => {
    if (comSpinner) setCarregando(true);
    try {
      // A rota pública não tem sessão do Apolo, e pedir o token nela daria erro antes do fetch.
      const token = publico ? "" : await getApoloAccessToken();
      const r = await fetch(fonte, {
        cache: "no-store",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const c = (await r.json()) as {
        data?: { atualizadoEm: string; linhas: Linha[] };
        error?: string;
      };
      if (!r.ok) setErro(c.error ?? `Falha (${r.status}).`);
      else {
        setErro(null);
        setLinhas(c.data?.linhas ?? []);
        setAtualizadoEm(c.data?.atualizadoEm ?? null);
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    setCarregando(false);
  }, [fonte, publico]);

  useEffect(() => {
    void carregar(true);
    const onVis = () => {
      visivel.current = !document.hidden;
      // Voltou para a aba: atualiza na hora, sem esperar o próximo ciclo.
      if (visivel.current) void carregar(false);
    };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => {
      if (visivel.current) void carregar(false);
    }, INTERVALO_MS);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [carregar]);

  const perfis = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of linhas) c.set(l.perfil, (c.get(l.perfil) ?? 0) + 1);
    return [...c.keys()].sort((a, b) => (c.get(b) ?? 0) - (c.get(a) ?? 0));
  }, [linhas]);

  const fu = semAcento(unidade.trim());
  const fn = semAcento(usuario.trim());

  const filtradas = useMemo(
    () =>
      linhas.filter((l) => {
        if (emp && l.emp !== emp) return false;
        if (perfil && l.perfil !== perfil) return false;
        if (status === "sim" && !l.assinou) return false;
        if (status === "nao" && l.assinou) return false;
        if (status === "atraso" && l.prazo !== "Pendente e em atraso") return false;
        // A fila é ordenada: "é a vez dele" e "ainda espera alguém" são coisas diferentes, e
        // misturá-las é o que fazia o painel cobrar quem não podia agir.
        if (status === "vez" && l.situacao !== "vez") return false;
        if (status === "aguardando" && l.situacao !== "aguardando") return false;
        if (fu && !semAcento(l.un).includes(fu)) return false;
        if (fn && !semAcento(l.usuario).includes(fn)) return false;
        return true;
      }),
    [linhas, emp, perfil, status, fu, fn],
  );

  // ⚠️ Os números de UNIDADE ignoram os filtros de perfil e status de propósito: filtrar por
  // perfil dentro deles esconderia justamente a assinatura que falta. É o REMOVEFILTERS(Perfil)
  // do modelo original.
  const resumo = useMemo(() => {
    const base = linhas.filter(
      (l) => (!emp || l.emp === emp) && (!fu || semAcento(l.un).includes(fu)),
    );
    const porUn = new Map<string, Linha[]>();
    for (const l of base) {
      const atual = porUn.get(l.un);
      if (atual) atual.push(l);
      else porUn.set(l.un, [l]);
    }
    const unidades = [...porUn.values()];
    const compradores = base.filter((l) => l.perfil === "Comprador");
    const assinados = compradores.filter((l) => l.assinou && l.assinadoEm);
    const envios = new Map<number, number>();
    for (const l of base) envios.set(l.contrato, l.diasDesdeEnvio);

    return {
      atrasados: compradores.filter((l) => l.prazo === "Pendente e em atraso").length,
      compradorOk: unidades.filter((ls) => {
        const c = ls.filter((x) => x.perfil === "Comprador");
        return c.length > 0 && c.every((x) => x.assinou);
      }).length,
      compradorPendente: unidades.filter((ls) =>
        ls.some((x) => x.perfil === "Comprador" && !x.assinou),
      ).length,
      diasAssinar: assinados.length
        ? assinados.reduce(
            (s, l) =>
              s +
              Math.max(
                0,
                Math.round(
                  (new Date(l.assinadoEm as string).getTime() - new Date(l.envio).getTime()) /
                    86_400_000,
                ),
              ),
            0,
          ) / assinados.length
        : 0,
      diasEnvio: envios.size
        ? [...envios.values()].reduce((a, b) => a + b, 0) / envios.size
        : 0,
      finalizadas: unidades.filter((ls) => ls.every((x) => x.assinou)).length,
      porUn,
      total: unidades.length,
    };
  }, [linhas, emp, fu]);

  const fila = useMemo(() => {
    const m = new Map<number, { ok: number; t: number }>();
    for (const l of filtradas) {
      if (!l.degrau) continue;
      const x = m.get(l.degrau) ?? { ok: 0, t: 0 };
      x.t += 1;
      if (l.assinou) x.ok += 1;
      m.set(l.degrau, x);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtradas]);

  // Quadro: só quem entra em todo contrato (incorporador e Careli). Ignora perfil e status,
  // porque mostra assinado e a assinar lado a lado.
  const quadro = useMemo(() => {
    const base = linhas.filter(
      (l) =>
        (l.perfil === "Incorporador" || l.perfil === "Backoffice") &&
        (!emp || l.emp === emp) &&
        (!fu || semAcento(l.un).includes(fu)),
    );
    const m = new Map<
      string,
      { aguardando: number; email: string; nome: string; ok: number; perfil: string; vez: number }
    >();
    for (const l of base) {
      // O e-mail entra na chave: a mesma razão social assina por três sócios, e juntá-los
      // esconderia que dois assinaram e um não.
      const k = `${l.usuario}|${l.email}`;
      const x = m.get(k) ?? {
        aguardando: 0,
        email: l.email,
        nome: l.usuario,
        ok: 0,
        perfil: l.perfil,
        vez: 0,
      };

      // ⚠️ "ASSINAR" AGORA SÓ CONTA O QUE ESTÁ COM ELE. A fila é ordenada, e somar tudo que a
      // pessoa não assinou dava um número que ela não tem como resolver: o Northon aparecia com
      // 181 pendências quando só 2 estavam de fato na vez dele, e a Nívea com 178 sem NENHUMA.
      // Cobrar por esse número é cobrar a pessoa errada.
      if (l.situacao === "assinado") x.ok += 1;
      else if (l.situacao === "vez") x.vez += 1;
      else x.aguardando += 1;

      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.vez - a.vez || b.aguardando - a.aguardando || b.ok - a.ok);
  }, [linhas, emp, fu]);

  /** Clicar num número do quadro leva o analítico para aquele recorte. */
  const filtrarPor = useCallback((nome: string, alvo: "" | "aguardando" | "sim" | "vez") => {
    setUsuario(nome);
    setStatus(alvo);
    // O analítico fica no fim da página; sem isto o clique parece não fazer nada.
    document.getElementById("analitico-assinaturas")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Quem também assina todo contrato mas com outro perfil no C2X. Sem isso, some sem rastro.
  const fixosDeFora = useMemo(() => {
    const base = linhas.filter((l) => !emp || l.emp === emp);
    const unidades = new Set(base.map((l) => l.un)).size;
    const m = new Map<string, { n: number; nome: string; perfil: string }>();
    for (const l of base) {
      if (l.perfil === "Incorporador" || l.perfil === "Backoffice") continue;
      const k = `${l.usuario}|${l.perfil}`;
      const x = m.get(k) ?? { n: 0, nome: l.usuario, perfil: l.perfil };
      x.n += 1;
      m.set(k, x);
    }
    return [...m.values()].filter((o) => o.n >= unidades * 0.9);
  }, [linhas, emp]);

  // ⚠️ O CÁLCULO VIVE EM lib/apolo/unidades-assinatura.ts, junto com o painel público do
  // coordenador: as duas telas mostram a MESMA lista para as MESMAS pessoas.
  const todasAsUnidades = useMemo(() => agruparUnidadesDeAssinatura(resumo.porUn), [resumo.porUn]);

  // ⚠️ O RECORTE É POR QUEM TRAVA, não por "o comprador já assinou": o filtro antigo escondia
  // justamente as unidades paradas no começo da fila, que são as mais urgentes.
  const [paradoCom, setParadoCom] = useState("");
  const paradoPorPerfil = useMemo(() => contarParadoPorPerfil(todasAsUnidades), [todasAsUnidades]);
  const unidadesVisiveis = useMemo(
    () =>
      paradoCom
        ? todasAsUnidades.filter((u) => !u.concluida && u.perfisNaVez.includes(paradoCom))
        : todasAsUnidades,
    [todasAsUnidades, paradoCom],
  );

  const ordenadas = useMemo(
    () =>
      [...filtradas].sort(
        (a, b) =>
          (a.assinou === b.assinou ? 0 : a.assinou ? 1 : -1) ||
          b.diasDesdeEnvio - a.diasDesdeEnvio ||
          a.un.localeCompare(b.un) ||
          a.degrau - b.degrau,
      ),
    [filtradas],
  );

  const carimbo = atualizadoEm
    ? new Date(atualizadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : "—";

  const INPUT =
    "h-9 rounded-lg border border-black/10 bg-canvas px-3 text-sm text-ink dark:border-white/10";
  const ROTULO = "text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-soft";

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-canvas">
      <header className="flex flex-wrap items-center gap-3 border-b border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
        <div>
          <h1 className="m-0 text-base font-bold text-ink">Painel de assinatura · Vale do Ouro</h1>
          <p className="m-0 text-xs text-ink-soft">
            VOC (Cecílio) e VOL (Lino) · atualizado às {carimbo}
          </p>
        </div>
        <button
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/10"
          disabled={carregando}
          onClick={() => void carregar(true)}
          type="button"
        >
          {carregando ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
          Atualizar
        </button>
      </header>

      <div className="p-5">
        {erro ? (
          <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {erro}
          </p>
        ) : null}

        <div className="mb-5 flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className={ROTULO}>Empreendimento</span>
            <select className={INPUT} onChange={(e) => setEmp(e.target.value)} value={emp}>
              <option value="">Todos</option>
              <option value="VOC">VOC</option>
              <option value="VOL">VOL</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className={ROTULO}>Perfil</span>
            <select className={INPUT} onChange={(e) => setPerfil(e.target.value)} value={perfil}>
              <option value="">Todos</option>
              {perfis.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className={ROTULO}>Status</span>
            <select className={INPUT} onChange={(e) => setStatus(e.target.value)} value={status}>
              <option value="">Todos</option>
              <option value="sim">Assinado</option>
              <option value="nao">Pendente</option>
              <option value="vez">Pendente · é a vez dele</option>
              <option value="aguardando">Pendente · aguardando alguém antes</option>
              <option value="atraso">Pendente e em atraso</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className={ROTULO}>Unidade</span>
            <input
              className={`${INPUT} w-40`}
              onChange={(e) => setUnidade(e.target.value)}
              placeholder="ex.: VOC0104"
              type="search"
              value={unidade}
            />
          </label>
          <label className="grid gap-1">
            <span className={ROTULO}>Usuário</span>
            <input
              className={`${INPUT} w-48`}
              onChange={(e) => setUsuario(e.target.value)}
              placeholder="quem assina"
              type="search"
              value={usuario}
            />
          </label>
          <button
            className="h-9 rounded-lg border border-black/10 px-3 text-sm text-ink-soft hover:bg-black/[0.03] dark:border-white/10"
            onClick={() => {
              setEmp("");
              setPerfil("");
              setStatus("");
              setUnidade("");
              setUsuario("");
            }}
            type="button"
          >
            Limpar
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Bloco titulo="Comprador">
            <Kpi cor="ok" k="Unidades assinadas" v={num(resumo.compradorOk)} />
            <Kpi k="Unidades pendentes" v={num(resumo.compradorPendente)} />
            <Kpi cor="ouro" k="Do total" v={pct(resumo.compradorOk, resumo.total)} />
          </Bloco>
          <Bloco titulo="Geral">
            <Kpi k="Total de unidades" v={num(resumo.total)} />
            <Kpi cor="ok" k="Unidades finalizadas" v={num(resumo.finalizadas)} />
            <Kpi cor="ouro" k="Do total" v={pct(resumo.finalizadas, resumo.total)} />
          </Bloco>
          <Bloco titulo="Prazo do comprador · 7 dias">
            <Kpi cor="ruim" k="Em atraso" v={num(resumo.atrasados)} />
            <Kpi k="Dias até assinar" v={resumo.diasAssinar.toFixed(1).replace(".", ",")} />
            <Kpi k="Dias desde o envio" v={resumo.diasEnvio.toFixed(1).replace(".", ",")} />
          </Bloco>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <Cartao titulo="A fila, degrau a degrau">
            <div className="grid gap-2">
              {fila.length === 0 ? (
                <p className="m-0 text-sm text-ink-soft">Nada neste recorte.</p>
              ) : (
                fila.map(([d, v]) => (
                  <div className="grid grid-cols-[112px_1fr_54px] items-center gap-3" key={d}>
                    <span className="text-xs text-ink">
                      {d}. {NOME_DEGRAU[d] ?? `Degrau ${d}`}
                      <span className="block text-[11px] text-ink-soft">
                        {v.ok} de {v.t}
                      </span>
                    </span>
                    <span className="h-4 overflow-hidden rounded bg-black/[0.06] dark:bg-white/[0.08]">
                      <i
                        className="block h-full bg-emerald-600 dark:bg-emerald-400"
                        style={{ width: `${Math.round((100 * v.ok) / v.t)}%` }}
                      />
                    </span>
                    <span className="text-right text-xs tabular-nums text-ink-soft">
                      {Math.round((100 * v.ok) / v.t)}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </Cartao>

          <Cartao titulo="Quadro de assinaturas · incorporador e Careli">
            <p className="m-0 mb-2 text-[11.5px] leading-snug text-ink-soft">
              Clique num número para ver quais contratos ele representa. <b>Assinar</b> é o que está
              com a pessoa agora; <b>aguardando</b> é o que ainda depende de quem assina antes dela.
            </p>
            <div className="max-h-72 overflow-auto">
              <Tabela
                cabecalho={["Usuário", "Perfil", "Assinado", "Assinar", "Aguardando"]}
                numericas={[2, 3, 4]}
              >
                {quadro.map((q) => (
                  <tr key={`${q.nome}-${q.email}`}>
                    <td className="px-2 py-1.5 text-ink">
                      {q.nome}
                      <span className="block text-[11px] text-ink-soft">{q.email}</span>
                    </td>
                    <td className="px-2 py-1.5 text-ink-soft">{q.perfil}</td>
                    <NumeroClicavel
                      aoClicar={() => filtrarPor(q.nome, "sim")}
                      titulo={`Contratos que ${q.nome} já assinou`}
                      valor={q.ok}
                    />
                    <NumeroClicavel
                      aoClicar={() => filtrarPor(q.nome, "vez")}
                      destaque={q.vez > 0}
                      titulo={`Contratos esperando a assinatura de ${q.nome} agora`}
                      valor={q.vez}
                    />
                    <NumeroClicavel
                      aoClicar={() => filtrarPor(q.nome, "aguardando")}
                      titulo={`Contratos em que ${q.nome} ainda depende de outra assinatura`}
                      valor={q.aguardando}
                    />
                  </tr>
                ))}
              </Tabela>
            </div>
            {fixosDeFora.length ? (
              <p className="m-0 mt-3 text-[11.5px] leading-snug text-ink-soft">
                Também assinam todos os contratos, com outro perfil no C2X:{" "}
                {fixosDeFora.map((o) => `${o.nome} (${o.perfil})`).join(", ")}.
              </p>
            ) : null}
          </Cartao>
        </div>

        <h2 className="mb-2 mt-6 text-[11.5px] font-bold uppercase tracking-[0.13em] text-ink-soft">
          Contratos por unidade
        </h2>
        {paradoPorPerfil.length > 0 ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11.5px] text-ink-soft">Parado com</span>
            <PilulaDeFiltro
              ativo={paradoCom === ""}
              aoClicar={() => setParadoCom("")}
              rotulo={`Todas (${todasAsUnidades.length})`}
            />
            {paradoPorPerfil.map((opcao) => (
              <PilulaDeFiltro
                ativo={paradoCom === opcao.perfil}
                aoClicar={() => setParadoCom(opcao.perfil)}
                key={opcao.perfil}
                rotulo={`${opcao.perfil} (${opcao.quantas})`}
              />
            ))}
          </div>
        ) : null}
        <div className="max-h-[560px] overflow-auto pr-1">
          <UnidadesEmBarra unidades={unidadesVisiveis} />
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          {unidadesVisiveis.length} unidade{unidadesVisiveis.length === 1 ? "" : "s"} ·{" "}
          {unidadesVisiveis.filter((u) => !u.concluida).length} aguardam assinatura.
        </p>

        {/* Âncora do clique vindo do Quadro de assinaturas. */}
        <h2
          className="mb-2 mt-6 text-[11.5px] font-bold uppercase tracking-[0.13em] text-ink-soft"
          id="analitico-assinaturas"
        >
          Assinaturas
          {usuario || status ? (
            <button
              className="ml-3 rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-ink-soft transition-colors hover:bg-subtle"
              onClick={() => {
                setUsuario("");
                setStatus("");
              }}
              type="button"
            >
              limpar filtro
            </button>
          ) : null}
        </h2>
        <div className="max-h-[520px] overflow-auto rounded-xl border border-black/[0.07] dark:border-white/[0.08]">
          <Tabela
            cabecalho={["Unidade", "Envio", "Usuário", "Perfil", "Degrau", "Status", "Assinatura"]}
            numericas={[4, 6]}
          >
            {ordenadas.slice(0, 400).map((l, i) => {
              const atrasado = l.prazo === "Pendente e em atraso";
              return (
                <tr key={`${l.contrato}-${l.usuario}-${l.degrau}-${i}`}>
                  <td className="px-2 py-1.5 font-semibold tabular-nums text-ink">{l.un}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{dataCurta(l.envio)}</td>
                  <td className="px-2 py-1.5 text-ink">{l.usuario}</td>
                  <td className="px-2 py-1.5 text-ink-soft">{l.perfil}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-soft">
                    {l.degrau || "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <span
                      className={
                        l.assinou
                          ? "font-semibold text-emerald-600 dark:text-emerald-400"
                          : atrasado
                            ? "font-semibold text-red-600 dark:text-red-400"
                            : "text-ink-soft"
                      }
                    >
                      {l.assinou ? "Assinado" : atrasado ? "Em atraso" : "Pendente"}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-ink-soft">
                    {dataCurta(l.assinadoEm)}
                  </td>
                </tr>
              );
            })}
          </Tabela>
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          {ordenadas.length > 400
            ? `Mostrando as 400 primeiras de ${num(ordenadas.length)} assinaturas. Use os filtros para estreitar.`
            : `${num(ordenadas.length)} assinatura${ordenadas.length === 1 ? "" : "s"} neste recorte.`}
        </p>
      </div>
    </div>
  );
}

function PilulaDeFiltro({
  ativo,
  aoClicar,
  rotulo,
}: {
  ativo: boolean;
  aoClicar: () => void;
  rotulo: string;
}) {
  return (
    <button
      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
        ativo
          ? "border-ink bg-ink font-semibold text-canvas"
          : "border-line text-ink-soft hover:bg-subtle"
      }`}
      onClick={aoClicar}
      type="button"
    >
      {rotulo}
    </button>
  );
}

function Bloco({ children, titulo }: { children: React.ReactNode; titulo: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.07] dark:border-white/[0.08]">
      <h2 className="m-0 border-b border-black/[0.07] bg-[#A07C3B]/[0.08] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.13em] text-[#A07C3B] dark:border-white/[0.08]">
        {titulo}
      </h2>
      <div className="flex gap-2 px-4 py-4">{children}</div>
    </div>
  );
}

function Kpi({ cor, k, v }: { cor?: "ok" | "ouro" | "ruim"; k: string; v: string }) {
  const tom =
    cor === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : cor === "ruim"
        ? "text-red-600 dark:text-red-400"
        : cor === "ouro"
          ? "text-[#A07C3B]"
          : "text-ink";
  return (
    <div className="flex-1 text-center">
      <span className={`block text-[28px] font-bold leading-none tabular-nums ${tom}`}>{v}</span>
      <span className="mt-1.5 block text-[11.5px] leading-tight text-ink-soft">{k}</span>
    </div>
  );
}

/**
 * Número do quadro que abre o analítico naquele recorte.
 *
 * Zero não vira botão: clicar num zero levaria a uma tabela vazia, e tabela vazia depois de um
 * clique parece tela quebrada.
 */
function NumeroClicavel({
  aoClicar,
  destaque = false,
  titulo,
  valor,
}: {
  aoClicar: () => void;
  destaque?: boolean;
  titulo: string;
  valor: number;
}) {
  if (valor === 0) {
    return <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">0</td>;
  }

  return (
    <td className="px-2 py-1.5 text-right tabular-nums">
      <button
        className={`rounded px-1.5 py-0.5 tabular-nums underline decoration-dotted underline-offset-2 transition-colors hover:bg-subtle ${
          destaque ? "font-semibold text-ink" : "text-ink-soft"
        }`}
        onClick={aoClicar}
        title={titulo}
        type="button"
      >
        {num(valor)}
      </button>
    </td>
  );
}

function Cartao({ children, titulo }: { children: React.ReactNode; titulo: string }) {
  return (
    <div className="rounded-xl border border-black/[0.07] p-4 dark:border-white/[0.08]">
      <h3 className="m-0 mb-3 text-sm font-bold text-ink">{titulo}</h3>
      {children}
    </div>
  );
}

function Tabela({
  cabecalho,
  children,
  numericas = [],
}: {
  cabecalho: string[];
  children: React.ReactNode;
  numericas?: number[];
}) {
  return (
    <table className="w-full text-[13px]">
      <thead className="sticky top-0 z-[1] bg-canvas">
        <tr>
          {cabecalho.map((c, i) => (
            <th
              className={`whitespace-nowrap border-b border-black/[0.07] px-2 py-2 text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-soft dark:border-white/[0.08] ${
                numericas.includes(i) ? "text-right" : "text-left"
              }`}
              key={c}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="[&_tr:nth-child(even)]:bg-black/[0.02] dark:[&_tr:nth-child(even)]:bg-white/[0.02]">
        {children}
      </tbody>
    </table>
  );
}
