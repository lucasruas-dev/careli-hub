"use client";

import {
  Building2,
  Check,
  Link2,
  Loader2,
  MapPin,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// VÍNCULO das imobiliárias das CADs -> entidade do Apolo.
//
// Cada nome-texto que aparece nas CADs (esteira) é uma linha; o operador escolhe a entidade
// imobiliária correspondente (papel 'imobiliaria' no Apolo, ~413 opções). O casamento fica salvo
// e alimenta o vínculo por entidade — a base da Central de CADs das imobiliárias.

type ImobDaCad = {
  cads: number;
  entidade: { documento: string | null; id: string; nome: string } | null;
  nomeNormalizado: string;
  nomeTexto: string;
};
type Resumo = { cadsVinculadas: number; pendentes: number; total: number; vinculadas: number };
type Opcao = { id: string; label: string };
type BackfillData = {
  ambiguos: { motivo: string; nome: string }[];
  atualizados: { empreendimento: string; nome: string }[];
  dryRun: boolean;
  semCadNoAsana: { nome: string }[];
  totalSemEmpreendimento: number;
};

export function VincularImobiliarias() {
  const [lista, setLista] = useState<ImobDaCad[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  // Qual linha está com o seletor aberto, e o texto de busca dela.
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  // Teste do relatório: envia o relatório de UMA imobiliária para um e-mail, só para conferir.
  const [testeEmail, setTesteEmail] = useState("lucas.ruas@careli.adm.br");
  const [testeImob, setTesteImob] = useState("Caio Silva");
  const [enviandoTeste, setEnviandoTeste] = useState(false);
  const [msgTeste, setMsgTeste] = useState<string | null>(null);
  // Templates do WhatsApp na Meta: criar os 4 avisos e conferir o status de aprovação.
  const [tplBusy, setTplBusy] = useState(false);
  const [tpls, setTpls] = useState<
    Array<{ detalhe?: string | null; name: string; status: string }> | null
  >(null);
  const [msgTpl, setMsgTpl] = useState<string | null>(null);
  // Backfill do empreendimento pelo Asana: preenche as fichas que entraram sem empreendimento.
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfill, setBackfill] = useState<BackfillData | null>(null);
  const [msgBackfill, setMsgBackfill] = useState<string | null>(null);

  const enviarTeste = useCallback(async () => {
    setEnviandoTeste(true);
    setMsgTeste(null);
    try {
      const token = await getApoloAccessToken();
      const url = `/api/apolo/imobiliarias/relatorio-diario?teste=${encodeURIComponent(testeEmail)}&imobiliaria=${encodeURIComponent(testeImob)}`;
      const r = await fetch(url, { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
      const c = (await r.json()) as { data?: { cads: number; imobiliaria: string }; error?: string };
      if (!r.ok) setMsgTeste(c.error ?? `Falha (${r.status}).`);
      else setMsgTeste(`Enviado: ${c.data?.imobiliaria} (${c.data?.cads} CADs) para ${testeEmail}.`);
    } catch (e) {
      setMsgTeste((e as Error).message);
    }
    setEnviandoTeste(false);
  }, [testeEmail, testeImob]);

  // Reenvio de RETIFICAÇÃO: manda de novo, só para as imobiliárias cujo relatório saiu com cliente
  // errado, com o banner "desconsidere o e-mail anterior". Só e-mail. Os termos casam o NOME do
  // relatório (legal_name||display_name) — atenção: a LM Imóveis aparece como "Odair Rodrigues
  // Teixeira" (o titular), por isso o termo dela é o nome do titular, não "LM".
  const [reenviando, setReenviando] = useState(false);
  const [msgReenvio, setMsgReenvio] = useState<string | null>(null);
  const [reenvioTermos, setReenvioTermos] = useState("ODAIR RODRIGUES TEIXEIRA");

  const reenviarRetificacao = useCallback(async () => {
    setReenviando(true);
    setMsgReenvio(null);
    try {
      const token = await getApoloAccessToken();
      const url = `/api/apolo/imobiliarias/relatorio-diario?reenvio=1&imobiliarias=${encodeURIComponent(reenvioTermos)}`;
      const r = await fetch(url, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const c = (await r.json()) as {
        data?: {
          naoEncontradas: string[];
          reenviados: number;
          resultados: Array<{ imobiliaria: string; status: string }>;
        };
        error?: string;
      };
      if (!r.ok) {
        setMsgReenvio(c.error ?? `Falha (${r.status}).`);
      } else {
        const falhas = (c.data?.resultados ?? []).filter(
          (res) => res.status !== "reenviado",
        );
        setMsgReenvio(
          `Reenviado para ${c.data?.reenviados ?? 0} imobiliárias.` +
            (falhas.length
              ? ` Atenção: ${falhas.map((f) => `${f.imobiliaria} (${f.status})`).join(", ")}.`
              : ""),
        );
      }
    } catch (e) {
      setMsgReenvio((e as Error).message);
    }
    setReenviando(false);
  }, [reenvioTermos]);

  // DISPARO GERAL REAL: e-mail + WhatsApp para TODAS as imobiliárias, agora (fora do cron das 18h).
  // Confirmação obrigatória — é outward, irreversível e o WhatsApp tem custo. Chama a rota sem
  // params (o mesmo caminho do cron).
  const [disparandoGeral, setDisparandoGeral] = useState(false);
  const [msgGeral, setMsgGeral] = useState<string | null>(null);

  const dispararGeral = useCallback(async () => {
    const ok = window.confirm(
      "DISPARO REAL: envia o relatório por e-mail + WhatsApp para TODAS as imobiliárias do " +
        "empreendimento, AGORA. Tem custo de WhatsApp e é irreversível. Se o cron das 18h também " +
        "rodar hoje, elas recebem duas vezes. Confirmar o disparo?",
    );
    if (!ok) return;
    setDisparandoGeral(true);
    setMsgGeral(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/imobiliarias/relatorio-diario", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const c = (await r.json()) as {
        data?: {
          enviados: number;
          resultados: Array<{ email: string; imobiliaria: string; whatsapp: string }>;
        };
        error?: string;
      };
      if (!r.ok) {
        setMsgGeral(c.error ?? `Falha (${r.status}).`);
      } else {
        const res = c.data?.resultados ?? [];
        const okEmail = res.filter((x) => x.email === "enviado").length;
        const okZap = res.filter((x) => x.whatsapp === "enviado").length;
        setMsgGeral(
          `Disparado para ${c.data?.enviados ?? 0} imobiliárias — e-mail: ${okEmail} OK, WhatsApp: ${okZap} OK.`,
        );
      }
    } catch (e) {
      setMsgGeral((e as Error).message);
    }
    setDisparandoGeral(false);
  }, []);

  // CANCELAR PIX NÃO PAGOS (fim do prazo). Passo 1 CONFERE (dryRun, não apaga nada); passo 2 CANCELA
  // de verdade, com confirmação. Nunca toca em pago. Endpoint /api/apolo/asaas/cancelar-pendentes.
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelResumo, setCancelResumo] = useState<{
    empreendimento?: string;
    naoPagosNaContaGurgel?: number;
    porStatus: Record<string, number>;
    total: number;
    valorTotal: number;
  } | null>(null);
  const [msgCancel, setMsgCancel] = useState<string | null>(null);

  const conferirCancelamento = useCallback(async () => {
    setCancelBusy(true);
    setMsgCancel(null);
    setCancelResumo(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/asaas/cancelar-pendentes", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const c = (await r.json()) as {
        data?: { porStatus: Record<string, number>; total: number; valorTotal: number };
        error?: string;
      };
      if (!r.ok || !c.data) setMsgCancel(c.error ?? `Falha (${r.status}).`);
      else setCancelResumo(c.data);
    } catch (e) {
      setMsgCancel((e as Error).message);
    }
    setCancelBusy(false);
  }, []);

  const executarCancelamento = useCallback(async () => {
    if (!cancelResumo) return;
    const ok = window.confirm(
      `CANCELAR ${cancelResumo.total} PIX não pagos (total R$ ${cancelResumo.valorTotal.toLocaleString("pt-BR")})? ` +
        "É irreversível. NÃO mexe em nenhum PIX já pago. Confirmar o cancelamento?",
    );
    if (!ok) return;
    setCancelBusy(true);
    setMsgCancel(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/asaas/cancelar-pendentes?confirmar=1", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const c = (await r.json()) as {
        data?: { cancelados: number; falhas: number; totalTentado: number };
        error?: string;
      };
      if (!r.ok || !c.data) setMsgCancel(c.error ?? `Falha (${r.status}).`);
      else {
        setMsgCancel(
          `Cancelados: ${c.data.cancelados} de ${c.data.totalTentado}. Falhas: ${c.data.falhas}.`,
        );
        setCancelResumo(null);
      }
    } catch (e) {
      setMsgCancel((e as Error).message);
    }
    setCancelBusy(false);
  }, [cancelResumo]);

  const criarTemplates = useCallback(async () => {
    setTplBusy(true);
    setMsgTpl(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/imobiliarias/templates", {
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
      });
      const c = (await r.json()) as {
        data?: {
          templates: Array<{
            detalhe?: string | null;
            error?: string | null;
            jaExistia?: boolean;
            name: string;
            ok?: boolean;
            status?: string;
          }>;
        };
        error?: string;
      };
      if (!r.ok) setMsgTpl(c.error ?? `Falha (${r.status}).`);
      else {
        setTpls(
          (c.data?.templates ?? []).map((t) => ({
            detalhe: t.detalhe ?? null,
            name: t.name,
            status: t.jaExistia
              ? "já existia"
              : t.error
                ? `erro: ${t.error}`
                : (t.status ?? (t.ok ? "enviado" : "falhou")),
          })),
        );
        setMsgTpl("Enviados para a Meta. A aprovação leva de minutos a algumas horas.");
      }
    } catch (e) {
      setMsgTpl((e as Error).message);
    }
    setTplBusy(false);
  }, []);

  const verificarTemplates = useCallback(async () => {
    setTplBusy(true);
    setMsgTpl(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/imobiliarias/templates", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const c = (await r.json()) as {
        data?: { templates: Array<{ name: string; status: string }> };
        error?: string;
      };
      if (!r.ok) setMsgTpl(c.error ?? `Falha (${r.status}).`);
      else setTpls(c.data?.templates ?? []);
    } catch (e) {
      setMsgTpl((e as Error).message);
    }
    setTplBusy(false);
  }, []);

  const rodarBackfill = useCallback(async (aplicar: boolean) => {
    setBackfillBusy(true);
    setMsgBackfill(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/esteira/backfill-empreendimento", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
        method: aplicar ? "POST" : "GET",
      });
      const c = (await r.json()) as { data?: BackfillData; error?: string };
      if (!r.ok) setMsgBackfill(c.error ?? `Falha (${r.status}).`);
      else {
        setBackfill(c.data ?? null);
        if (c.data) {
          setMsgBackfill(
            aplicar
              ? `${c.data.atualizados.length} preenchidas de ${c.data.totalSemEmpreendimento} sem empreendimento.`
              : `Simulação: ${c.data.atualizados.length} de ${c.data.totalSemEmpreendimento} seriam preenchidas.`,
          );
        }
      }
    } catch (e) {
      setMsgBackfill((e as Error).message);
    }
    setBackfillBusy(false);
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const cab = { Authorization: `Bearer ${token}` };
      const [rVinc, rEnt] = await Promise.all([
        fetch("/api/apolo/imobiliarias/vinculo", { cache: "no-store", headers: cab }),
        fetch("/api/apolo/imobiliarias", { cache: "no-store", headers: cab }),
      ]);
      const cVinc = (await rVinc.json()) as {
        data?: { imobiliarias: ImobDaCad[]; resumo: Resumo };
        error?: string;
      };
      const cEnt = (await rEnt.json()) as { data?: { imobiliarias: Opcao[] } };
      if (!rVinc.ok) setErro(cVinc.error ?? `Falha (${rVinc.status}).`);
      else {
        setLista(cVinc.data?.imobiliarias ?? []);
        setResumo(cVinc.data?.resumo ?? null);
      }
      setOpcoes(cEnt.data?.imobiliarias ?? []);
    } catch (e) {
      setErro((e as Error).message);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const salvar = useCallback(
    async (nomeTexto: string, entityId: string | null) => {
      setSalvando(nomeTexto);
      setErro(null);
      try {
        const token = await getApoloAccessToken();
        const r = await fetch("/api/apolo/imobiliarias/vinculo", {
          body: JSON.stringify({ entityId, nomeTexto }),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          method: "POST",
        });
        const c = (await r.json()) as { error?: string };
        if (!r.ok) setErro(c.error ?? `Falha (${r.status}).`);
        else {
          setAbrindo(null);
          setBusca("");
          await carregar();
        }
      } catch (e) {
        setErro((e as Error).message);
      }
      setSalvando(null);
    },
    [carregar],
  );

  const opcoesFiltradas = useMemo(() => {
    const t = busca
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .trim();
    const base = t
      ? opcoes.filter((o) =>
          o.label
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .toLowerCase()
            .includes(t),
        )
      : opcoes;
    return base.slice(0, 30);
  }, [opcoes, busca]);

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-canvas">
      <header className="flex flex-wrap items-center gap-3 border-b border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
        <div>
          <h1 className="m-0 text-base font-bold text-ink">Vincular imobiliárias das CADs</h1>
          <p className="m-0 text-xs text-ink-soft">
            Case cada imobiliária que aparece nas CADs com o cadastro dela no Apolo. É a base do
            acompanhamento das imobiliárias.
          </p>
        </div>
        <button
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/10"
          disabled={carregando}
          onClick={() => void carregar()}
          type="button"
        >
          {carregando ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}
          Atualizar
        </button>
      </header>

      <div className="p-5">
        {/* Testar o relatório: envia o de uma imobiliária para um e-mail (só conferência). */}
        <div className="mb-4 rounded-xl border border-[#A07C3B]/30 bg-[#A07C3B]/[0.05] p-4">
          <p className="m-0 text-sm font-bold text-ink">Testar o relatório</p>
          <p className="m-0 mt-0.5 text-xs text-ink-soft">
            Manda o relatório de uma imobiliária (com dados reais, incluindo Duplicadas/Incorretas do
            Asana) para o e-mail informado. Não dispara para a imobiliária.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              className="h-9 w-64 rounded-lg border border-black/10 bg-canvas px-3 text-sm text-ink dark:border-white/10"
              onChange={(e) => setTesteEmail(e.target.value)}
              placeholder="seu e-mail"
              value={testeEmail}
            />
            <input
              className="h-9 w-52 rounded-lg border border-black/10 bg-canvas px-3 text-sm text-ink dark:border-white/10"
              onChange={(e) => setTesteImob(e.target.value)}
              placeholder="imobiliária (ex.: Caio Silva)"
              value={testeImob}
            />
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-[#cba25a] hover:bg-[#1c2733] disabled:opacity-40"
              disabled={enviandoTeste || !testeEmail.trim()}
              onClick={() => void enviarTeste()}
              type="button"
            >
              {enviandoTeste ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
              Enviar teste
            </button>
            {msgTeste ? <span className="text-xs text-ink-soft">{msgTeste}</span> : null}
          </div>

          {/* Reenvio de retificação: reenvia o relatório corrigido só para as imobiliárias cujos
              nomes (do relatório) casem com os termos, com aviso para desconsiderar o anterior. */}
          <div className="mt-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]">
            <span className="text-xs font-semibold text-ink-soft">
              Reenviar relatório corrigido (retificação)
            </span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                className="h-9 min-w-[280px] flex-1 rounded-lg border border-black/10 bg-surface px-3 text-sm text-ink dark:border-white/10"
                onChange={(e) => setReenvioTermos(e.target.value)}
                placeholder="Nomes separados por | (ex.: J&F|RR SOLUCOES|ODAIR)"
                value={reenvioTermos}
              />
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:opacity-40 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                disabled={reenviando || !reenvioTermos.trim()}
                onClick={() => void reenviarRetificacao()}
                type="button"
              >
                {reenviando ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                Reenviar
              </button>
            </div>
            <p className="m-0 mt-1.5 text-xs text-ink-muted">
              Só e-mail, só as que casam os termos, com aviso para desconsiderar o e-mail anterior.
              Atenção: a LM Imóveis aparece como &quot;Odair Rodrigues Teixeira&quot; no cadastro.
            </p>
            {msgReenvio ? (
              <p className="m-0 mt-1.5 text-xs text-ink-soft">{msgReenvio}</p>
            ) : null}
          </div>

          {/* DISPARO GERAL REAL: e-mail + WhatsApp para TODAS as imobiliárias, agora (fora do cron
              das 18h). Confirmação obrigatória — outward + custo de WhatsApp. */}
          <div className="mt-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]">
            <span className="text-xs font-semibold text-ink-soft">
              Disparar agora para TODAS (real)
            </span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-500 bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                disabled={disparandoGeral}
                onClick={() => void dispararGeral()}
                type="button"
              >
                {disparandoGeral ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                Disparar agora (e-mail + WhatsApp)
              </button>
              {msgGeral ? <span className="text-xs text-ink-soft">{msgGeral}</span> : null}
            </div>
            <p className="m-0 mt-1.5 text-xs text-ink-muted">
              Envia o relatório real para TODAS as imobiliárias, na hora — é o mesmo do cron das 18h.
              Usar fora do horário faz a imobiliária receber duas vezes no dia. Pede confirmação.
            </p>
          </div>

          {/* CANCELAR PIX NÃO PAGOS (fim do prazo). Conferir (dryRun) → cancelar (confirma). Nunca
              toca em PIX pago. */}
          <div className="mt-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]">
            <span className="text-xs font-semibold text-ink-soft">
              Cancelar PIX não pagos (fim do prazo)
            </span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-black/10 bg-canvas px-4 text-sm font-semibold text-ink hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/[0.04]"
                disabled={cancelBusy}
                onClick={() => void conferirCancelamento()}
                type="button"
              >
                {cancelBusy ? <Loader2 className="animate-spin" size={15} /> : null}
                Conferir o que seria cancelado
              </button>
              {cancelResumo ? (
                <button
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-500 bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
                  disabled={cancelBusy}
                  onClick={() => void executarCancelamento()}
                  type="button"
                >
                  {cancelBusy ? <Loader2 className="animate-spin" size={15} /> : null}
                  Cancelar {cancelResumo.total} PIX (R$ {cancelResumo.valorTotal.toLocaleString("pt-BR")})
                </button>
              ) : null}
            </div>
            {cancelResumo ? (
              <p className="m-0 mt-1.5 text-xs text-ink-soft">
                A cancelar: <b>{cancelResumo.total}</b> não pagos de{" "}
                <b>{cancelResumo.empreendimento ?? "—"}</b> ·{" "}
                {Object.entries(cancelResumo.porStatus)
                  .map(([s, n]) => `${s}: ${n}`)
                  .join(" · ")}
                {typeof cancelResumo.naoPagosNaContaGurgel === "number"
                  ? ` · (${cancelResumo.naoPagosNaContaGurgel} não pagos na conta toda)`
                  : ""}
                . Confira antes de cancelar.
              </p>
            ) : null}
            <p className="m-0 mt-1.5 text-xs text-ink-muted">
              Só cancela PENDENTE e VENCIDO (não pago). Os pagos ficam intactos. Primeiro clique
              CONFERE (não apaga); o segundo botão só aparece depois e pede confirmação.
            </p>
            {msgCancel ? <p className="m-0 mt-1.5 text-xs text-ink-soft">{msgCancel}</p> : null}
          </div>
        </div>

        {/* Templates do WhatsApp: cria na Meta os 4 avisos e mostra o status de aprovação. */}
        <div className="mb-4 rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
          <p className="m-0 text-sm font-bold text-ink">Mensagens do WhatsApp (Meta)</p>
          <p className="m-0 mt-0.5 text-xs text-ink-soft">
            Cria na Meta os 4 templates de aviso à imobiliária (crédito reprovado, PIX enviado, PIX
            pago e relatório). Enquanto a Meta não aprovar, os avisos saem só por e-mail.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-[#cba25a] hover:bg-[#1c2733] disabled:opacity-40"
              disabled={tplBusy}
              onClick={() => void criarTemplates()}
              type="button"
            >
              {tplBusy ? <Loader2 className="animate-spin" size={15} /> : <MessageSquare size={15} />}
              Criar templates
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-black/10 px-4 text-sm font-semibold text-ink hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/10"
              disabled={tplBusy}
              onClick={() => void verificarTemplates()}
              type="button"
            >
              <RefreshCw size={15} /> Ver status
            </button>
            {msgTpl ? <span className="text-xs text-ink-soft">{msgTpl}</span> : null}
          </div>
          {tpls && tpls.length > 0 ? (
            <div className="mt-3 flex flex-col gap-1">
              {tpls.map((t) => (
                <div className="flex flex-col gap-0.5 text-xs" key={t.name}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-ink-soft">{t.name}</span>
                    <span className={statusClasse(t.status)}>{t.status}</span>
                  </div>
                  {/* O que a Meta REALMENTE reclamou (error_user_msg): "Invalid parameter" sozinho
                      não diz nada, e sem isto a correção do template vira adivinhação. */}
                  {t.detalhe ? (
                    <span className="pl-1 text-[0.68rem] leading-snug text-ink-muted">
                      {t.detalhe}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Backfill: preenche o empreendimento das fichas que entraram sem ele, buscando no Asana. */}
        <div className="mb-4 rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
          <p className="m-0 text-sm font-bold text-ink">Empreendimento faltando</p>
          <p className="m-0 mt-0.5 text-xs text-ink-soft">
            Fichas que entraram na esteira sem empreendimento (ex.: cadastro manual) não avisam o
            coordenador e somem dos relatórios. Isto procura cada uma no Asana pelo nome e preenche.
            Simule antes de aplicar.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-black/10 px-4 text-sm font-semibold text-ink hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/10"
              disabled={backfillBusy}
              onClick={() => void rodarBackfill(false)}
              type="button"
            >
              {backfillBusy ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}
              Simular
            </button>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-[#cba25a] hover:bg-[#1c2733] disabled:opacity-40"
              disabled={backfillBusy}
              onClick={() => void rodarBackfill(true)}
              type="button"
            >
              {backfillBusy ? <Loader2 className="animate-spin" size={15} /> : <MapPin size={15} />}
              Preencher
            </button>
            {msgBackfill ? <span className="text-xs text-ink-soft">{msgBackfill}</span> : null}
          </div>
          {backfill ? (
            <div className="mt-3 flex flex-col gap-2 text-xs">
              {backfill.atualizados.length > 0 ? (
                <div>
                  <p className="m-0 font-semibold text-emerald-700 dark:text-emerald-300">
                    {backfill.dryRun ? "Seriam preenchidas" : "Preenchidas"} ({backfill.atualizados.length})
                  </p>
                  {backfill.atualizados.map((a) => (
                    <div className="text-ink-soft" key={a.nome}>
                      {a.nome} → {a.empreendimento}
                    </div>
                  ))}
                </div>
              ) : null}
              {backfill.ambiguos.length > 0 ? (
                <div>
                  <p className="m-0 font-semibold text-amber-700 dark:text-amber-300">
                    Conferir ({backfill.ambiguos.length})
                  </p>
                  {backfill.ambiguos.map((a) => (
                    <div className="text-ink-soft" key={a.nome}>
                      {a.nome}: {a.motivo}
                    </div>
                  ))}
                </div>
              ) : null}
              {backfill.semCadNoAsana.length > 0 ? (
                <div>
                  <p className="m-0 font-semibold text-ink-muted">
                    Sem CAD no Asana ({backfill.semCadNoAsana.length})
                  </p>
                  {backfill.semCadNoAsana.map((a) => (
                    <div className="text-ink-muted" key={a.nome}>
                      {a.nome}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {resumo ? (
          <div className="mb-4 grid gap-2 sm:grid-cols-3">
            <Placar destaque rotulo="Imobiliárias nas CADs" valor={resumo.total} />
            <Placar
              rotulo="Vinculadas"
              valor={resumo.vinculadas}
              detalhe={`${resumo.cadsVinculadas} CADs cobertas`}
            />
            <Placar
              rotulo="Pendentes"
              valor={resumo.pendentes}
              tom={resumo.pendentes > 0 ? "alerta" : "ok"}
            />
          </div>
        ) : null}

        {erro ? (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {erro}
          </p>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-black/[0.07] bg-surface dark:border-white/[0.08]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[0.07] text-left text-[0.68rem] uppercase tracking-wide text-ink-muted dark:border-white/[0.08]">
                <th className="px-4 py-2.5 font-semibold">Imobiliária na CAD</th>
                <th className="px-3 py-2.5 text-right font-semibold">CADs</th>
                <th className="px-4 py-2.5 font-semibold">Cadastro no Apolo</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((imob) => (
                <tr
                  className="border-b border-black/[0.05] align-top last:border-0 dark:border-white/[0.06]"
                  key={imob.nomeNormalizado}
                >
                  <td className="px-4 py-3 font-medium text-ink">{imob.nomeTexto}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{imob.cads}</td>
                  <td className="px-4 py-3">
                    {imob.entidade ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                          <Check size={13} /> {imob.entidade.nome}
                        </span>
                        <button
                          className="text-xs text-ink-muted hover:text-rose-600"
                          disabled={salvando === imob.nomeTexto}
                          onClick={() => void salvar(imob.nomeTexto, null)}
                          type="button"
                        >
                          desvincular
                        </button>
                      </div>
                    ) : abrindo === imob.nomeNormalizado ? (
                      <div className="max-w-md">
                        <div className="flex items-center gap-2 rounded-lg border border-[#A07C3B]/40 bg-canvas px-2.5 py-1.5">
                          <Search className="text-ink-muted" size={14} />
                          <input
                            autoFocus
                            className="flex-1 bg-transparent text-sm text-ink outline-none"
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder="Buscar cadastro da imobiliária..."
                            value={busca}
                          />
                          <button
                            className="text-ink-muted hover:text-ink"
                            onClick={() => {
                              setAbrindo(null);
                              setBusca("");
                            }}
                            type="button"
                          >
                            <X size={14} />
                          </button>
                        </div>
                        <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-black/10 bg-surface dark:border-white/10">
                          {opcoesFiltradas.length === 0 ? (
                            <p className="m-0 px-3 py-2 text-xs text-ink-muted">
                              Nenhum cadastro encontrado.
                            </p>
                          ) : (
                            opcoesFiltradas.map((o) => (
                              <button
                                className="flex w-full items-center gap-2 border-b border-black/[0.04] px-3 py-2 text-left text-xs text-ink last:border-0 hover:bg-[#A07C3B]/10 disabled:opacity-50 dark:border-white/[0.06]"
                                disabled={salvando === imob.nomeTexto}
                                key={o.id}
                                onClick={() => void salvar(imob.nomeTexto, o.id)}
                                type="button"
                              >
                                <Building2 className="shrink-0 text-ink-muted" size={13} />
                                {o.label}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      <button
                        className="inline-flex items-center gap-1.5 rounded-md border border-[#A07C3B]/40 px-2.5 py-1.5 text-xs font-semibold text-[#7A5E2C] hover:bg-[#A07C3B]/10 dark:text-[#d9b877]"
                        onClick={() => {
                          setAbrindo(imob.nomeNormalizado);
                          setBusca("");
                        }}
                        type="button"
                      >
                        {salvando === imob.nomeTexto ? (
                          <Loader2 className="animate-spin" size={13} />
                        ) : (
                          <Link2 size={13} />
                        )}
                        Vincular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {lista.length === 0 && !carregando ? (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-ink-muted" colSpan={3}>
                    Nenhuma imobiliária encontrada nas CADs.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function statusClasse(status: string): string {
  const s = status.toUpperCase();
  const base = "rounded-md px-2 py-0.5 font-semibold ";
  if (s.includes("APPROVED") || s.includes("EXISTIA"))
    return `${base}bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300`;
  if (s.includes("ERRO") || s.includes("REJECT") || s.includes("FALHOU") || s.includes("PAUSED"))
    return `${base}bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300`;
  return `${base}bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300`;
}

function Placar(props: {
  destaque?: boolean;
  detalhe?: string;
  rotulo: string;
  tom?: "ok" | "alerta";
  valor: number;
}) {
  const cor =
    props.tom === "alerta"
      ? "text-amber-700 dark:text-amber-300"
      : props.tom === "ok"
        ? "text-emerald-700 dark:text-emerald-300"
        : "text-ink";
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        props.destaque
          ? "border-[#A07C3B]/30 bg-[#A07C3B]/[0.06]"
          : "border-black/[0.07] bg-surface dark:border-white/[0.08]"
      }`}
    >
      <div className={`text-2xl font-bold tabular-nums ${cor}`}>{props.valor}</div>
      <div className="text-[0.72rem] font-semibold text-ink-soft">{props.rotulo}</div>
      {props.detalhe ? <div className="text-[0.66rem] text-ink-muted">{props.detalhe}</div> : null}
    </div>
  );
}
