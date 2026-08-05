"use client";

import { AlertTriangle, CheckCircle2, Loader2, QrCode, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// BANCADA de teste do Asaas (conta Gurgel): testar comunicação, gerar um PIX real, ver o QR/expiração
// e acompanhar o que o webhook recebe ao pagar. Valida ao vivo os dois bloqueadores da pré-venda.

type Cobranca = {
  billingType: string;
  dateCreated?: string;
  dueDate: string;
  id: string;
  invoiceUrl?: string;
  status: string;
  value: number;
};
type QrCodeData = { encodedImage: string; expirationDate: string; payload: string };
type Evento = {
  asaas_payment_id: string | null;
  billing_type: string | null;
  date_created_raiz: string | null;
  evento: string | null;
  headers: Record<string, unknown> | null;
  payment_date: string | null;
  recebido_em: string;
  status: string | null;
  value: number | null;
};

async function post(body: unknown) {
  const token = await getApoloAccessToken();
  const r = await fetch("/api/apolo/asaas/bancada", {
    body: JSON.stringify(body),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    method: "POST",
  });
  return (await r.json()) as { data?: Record<string, unknown>; error?: string };
}

// "expira hoje" = data de expiração no mesmo dia = conta SEM chave PIX própria (bloqueador).
function expiraHoje(expirationDate: string): boolean {
  return (expirationDate ?? "").slice(0, 10) === new Date().toISOString().slice(0, 10);
}

function horaSemTempo(valor: string | null): boolean {
  return Boolean(valor) && !/\d{2}:\d{2}/.test(valor ?? "");
}

// O que o backend devolve ao mandar a cobrança (um status por canal, mais o movimento da esteira).
type EnvioCobranca = {
  anexouCad?: boolean;
  aviso?: string;
  email?: string;
  fluxo?: { etapa: string; fila: string };
  messageId?: string | null;
  whatsapp?: string;
};

// Uma linha dizendo o que aconteceu em cada canal — é o que vai permitir auditar o disparo em massa.
function resumoEnvio(envio: EnvioCobranca): string {
  if (envio.aviso) return envio.aviso;
  return [
    `WhatsApp: ${envio.whatsapp ?? "—"}`,
    envio.anexouCad === undefined ? null : envio.anexouCad ? "com ficha" : "SEM ficha",
    `e-mail: ${envio.email ?? "—"}`,
    envio.fluxo ? `etapa: ${envio.fluxo.etapa} · fila: ${envio.fluxo.fila}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Status do template da Meta -> rótulo amigável + cor.
function rotuloStatus(status: string): { cls: string; label: string } {
  const s = status.toUpperCase();
  if (s === "APPROVED") return { cls: "bg-emerald-50 text-emerald-700", label: "Aprovado" };
  if (["IN_APPEAL", "PENDING", "PENDING_DELETION"].includes(s)) {
    return { cls: "bg-amber-50 text-amber-800", label: "Em análise" };
  }
  if (["DISABLED", "PAUSED", "REJECTED"].includes(s)) {
    return { cls: "bg-red-50 text-red-700", label: status };
  }
  if (s === "NAO_ENCONTRADO") return { cls: "bg-subtle text-ink-muted", label: "Não criado" };
  return { cls: "bg-subtle text-ink-muted", label: status };
}

export function PreviewAsaas() {
  const [conta, setConta] = useState<string | null>(null);
  const [testando, setTestando] = useState(false);

  const [nome, setNome] = useState("Teste Bancada Pre-venda");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [valor, setValor] = useState("5");
  const [empreendimento, setEmpreendimento] = useState("Vale do Ouro");
  const [vencimento, setVencimento] = useState("2026-07-30");
  const [cadCodigo, setCadCodigo] = useState("");
  const [gerando, setGerando] = useState(false);
  const [cobranca, setCobranca] = useState<Cobranca | null>(null);
  const [qr, setQr] = useState<QrCodeData | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [eventos, setEventos] = useState<Evento[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const [criandoTpl, setCriandoTpl] = useState(false);
  const [resultadoTpl, setResultadoTpl] = useState<string | null>(null);
  const [statusTpl, setStatusTpl] = useState<{ name: string; status: string }[] | null>(null);
  const [verificandoTpl, setVerificandoTpl] = useState(false);
  const [telefone, setTelefone] = useState("");
  const [emailTeste, setEmailTeste] = useState("");
  // Fluxo real: emitiu o PIX, a cobrança já sai nos dois canais (sem precisar do segundo clique).
  const [enviarAoGerar, setEnviarAoGerar] = useState(true);
  const [disparando, setDisparando] = useState<"cobranca" | "recibo" | null>(null);
  const [resultadoDisparo, setResultadoDisparo] = useState<string | null>(null);

  const criarTemplates = async () => {
    setCriandoTpl(true);
    setResultadoTpl(null);
    try {
      const r = await post({ acao: "criar-templates" });
      if (r.error) {
        setResultadoTpl(`Erro: ${r.error}`);
      } else {
        const d = r.data as {
          cobranca?: { error?: string | null; jaExistia?: boolean; ok?: boolean; status?: string };
          recibo?: { error?: string | null; jaExistia?: boolean; ok?: boolean; status?: string };
        };
        const desc = (t?: { error?: string | null; jaExistia?: boolean; ok?: boolean; status?: string }) =>
          !t ? "?" : t.jaExistia ? "já existia" : t.ok ? `enviado (${t.status ?? "PENDING"})` : `erro: ${t.error}`;
        setResultadoTpl(`Cobrança: ${desc(d.cobranca)} · Recibo: ${desc(d.recibo)}`);
      }
    } finally {
      setCriandoTpl(false);
    }
  };

  const verificarStatus = async () => {
    setVerificandoTpl(true);
    try {
      const r = await post({ acao: "status-templates" });
      if (r.error) setStatusTpl([{ name: "erro", status: r.error }]);
      else setStatusTpl((r.data as { templates?: { name: string; status: string }[] })?.templates ?? []);
    } finally {
      setVerificandoTpl(false);
    }
  };

  const disparar = async (acao: "disparar-cobranca" | "disparar-recibo") => {
    setDisparando(acao === "disparar-cobranca" ? "cobranca" : "recibo");
    setResultadoDisparo(null);
    try {
      const r = await post({
        acao,
        cpfCnpj,
        email: emailTeste,
        empreendimento,
        link: cobranca?.invoiceUrl,
        nome,
        telefone,
        valor: Number(valor),
      });
      if (r.error) {
        setResultadoDisparo(`Erro: ${r.error}`);
      } else {
        const d = (r.data ?? {}) as EnvioCobranca;
        setResultadoDisparo(
          acao === "disparar-cobranca"
            ? resumoEnvio(d)
            : `WhatsApp enviado · e-mail: ${d.email ?? "—"}`,
        );
      }
    } finally {
      setDisparando(null);
    }
  };

  const carregarEventos = useCallback(async () => {
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/asaas/bancada", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const c = (await r.json()) as { data?: { eventos?: Evento[] } };
      setEventos(c.data?.eventos ?? []);
    } catch {
      /* silencio */
    }
  }, []);

  // Enquanto há uma cobrança aberta, puxa os eventos a cada 5s pra ver o pagamento chegar.
  useEffect(() => {
    void carregarEventos();
    if (!cobranca) return;
    const t = setInterval(() => void carregarEventos(), 5000);
    return () => clearInterval(t);
  }, [carregarEventos, cobranca]);

  const testar = async () => {
    setTestando(true);
    setConta(null);
    try {
      const r = await post({ acao: "testar" });
      setConta(r.error ? `Erro: ${r.error}` : String((r.data as { conta?: string })?.conta ?? "?"));
    } finally {
      setTestando(false);
    }
  };

  const gerarPix = async () => {
    setGerando(true);
    setErro(null);
    setQr(null);
    setCobranca(null);
    setStatus(null);
    try {
      const r = await post({
        acao: "gerar-pix",
        cadCodigo,
        cpfCnpj,
        email: emailTeste,
        empreendimento,
        enviarCobranca: enviarAoGerar,
        nome,
        telefone,
        valor: Number(valor),
        vencimento,
      });
      if (r.error) {
        setErro(r.error);
      } else {
        const d = r.data as {
          cobranca?: Cobranca;
          envio?: EnvioCobranca | null;
          qrCode?: QrCodeData | null;
          qrErro?: string | null;
        };
        setCobranca(d.cobranca ?? null);
        setQr(d.qrCode ?? null);
        if (d.qrErro) setErro(`QR: ${d.qrErro}`);
        setResultadoDisparo(d.envio ? resumoEnvio(d.envio) : null);
      }
    } finally {
      setGerando(false);
    }
  };

  const consultarStatus = async () => {
    if (!cobranca) return;
    const r = await post({ acao: "status", paymentId: cobranca.id });
    setStatus(r.error ? `Erro: ${r.error}` : String((r.data as { cobranca?: Cobranca })?.cobranca?.status ?? "?"));
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="m-0 text-xl font-bold text-ink">Bancada Asaas — pré-venda (conta Gurgel)</h1>
      <p className="m-0 mt-1 text-sm text-ink-soft">
        Teste a comunicação, gere um PIX real (valor baixo) e veja o comportamento: o QR, a expiração
        e o que o webhook recebe ao pagar.
      </p>

      {/* 0. Templates Meta */}
      <section className="mt-6 rounded-xl border border-line bg-surface p-5">
        <p className="m-0 text-sm font-bold text-ink">Templates do WhatsApp (Meta)</p>
        <p className="m-0 mt-1 text-xs text-ink-soft">
          Os 2 templates da pré-venda (cobrança + recibo). Veja se a Meta já aprovou e dispare um
          teste pro seu WhatsApp.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-subtle disabled:opacity-60"
            disabled={criandoTpl}
            onClick={() => void criarTemplates()}
            type="button"
          >
            {criandoTpl ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Criar templates
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-subtle disabled:opacity-60"
            disabled={verificandoTpl}
            onClick={() => void verificarStatus()}
            type="button"
          >
            {verificandoTpl ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Verificar status
          </button>
          {resultadoTpl ? <span className="text-xs text-ink-muted">{resultadoTpl}</span> : null}
        </div>

        {statusTpl ? (
          <div className="mt-3 grid gap-1.5">
            {statusTpl.map((t) => {
              const b = rotuloStatus(t.status);
              return (
                <div className="flex items-center gap-2 text-xs" key={t.name}>
                  <span className="font-mono text-ink-soft">{t.name}</span>
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${b.cls}`}>{b.label}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Disparo de teste das mensagens */}
        <div className="mt-4 border-t border-line pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-ink-muted">
              Telefone de teste (WhatsApp)
              <input
                className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink"
                onChange={(e) => setTelefone(e.target.value)}
                placeholder="ex.: 31 99999-9999"
                value={telefone}
              />
            </label>
            <label className="grid gap-1 text-xs text-ink-muted">
              E-mail de teste
              <input
                className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink"
                onChange={(e) => setEmailTeste(e.target.value)}
                placeholder="ex.: voce@careli.adm.br"
                type="email"
                value={emailTeste}
              />
            </label>
          </div>
          <p className="m-0 mt-1 text-[11px] text-ink-muted">
            O telefone e o e-mail são GRAVADOS na ficha do CPF informado, e o envio lê de lá — o
            mesmo caminho do botão da pré-venda. A cobrança precisa de um PIX gerado e leva a ficha
            anexada.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-inverse px-4 py-2 text-sm font-bold text-brand-ink disabled:opacity-50"
              disabled={!telefone || !cobranca?.invoiceUrl || disparando !== null}
              onClick={() => void disparar("disparar-cobranca")}
              title={cobranca?.invoiceUrl ? undefined : "Gere um PIX primeiro"}
              type="button"
            >
              {disparando === "cobranca" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Disparar cobrança
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-subtle disabled:opacity-50"
              disabled={!telefone || disparando !== null}
              onClick={() => void disparar("disparar-recibo")}
              type="button"
            >
              {disparando === "recibo" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Disparar recibo
            </button>
            {resultadoDisparo ? <span className="text-xs text-ink-muted">{resultadoDisparo}</span> : null}
          </div>
        </div>
      </section>

      {/* 1. Comunicação */}
      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <p className="m-0 text-sm font-bold text-ink">1. Testar comunicação</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-inverse px-4 py-2 text-sm font-bold text-brand-ink disabled:opacity-60"
            disabled={testando}
            onClick={() => void testar()}
            type="button"
          >
            {testando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Testar conexão
          </button>
          {conta ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
              <CheckCircle2 className="size-4" /> {conta}
            </span>
          ) : null}
        </div>
      </section>

      {/* 2. Gerar PIX */}
      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <p className="m-0 text-sm font-bold text-ink">2. Gerar PIX de teste</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-ink-muted">
            Nome do cliente
            <input className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink" onChange={(e) => setNome(e.target.value)} value={nome} />
          </label>
          <label className="grid gap-1 text-xs text-ink-muted">
            CPF/CNPJ
            <input className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink" onChange={(e) => setCpfCnpj(e.target.value)} placeholder="só números" value={cpfCnpj} />
          </label>
          <label className="grid gap-1 text-xs text-ink-muted">
            Empreendimento
            <input className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink" onChange={(e) => setEmpreendimento(e.target.value)} value={empreendimento} />
          </label>
          <label className="grid gap-1 text-xs text-ink-muted">
            Código da CAD
            <input className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink" onChange={(e) => setCadCodigo(e.target.value)} placeholder="ex.: CAD-2026-ABCD1234" value={cadCodigo} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-xs text-ink-muted">
              Valor (R$)
              <input className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink" inputMode="decimal" onChange={(e) => setValor(e.target.value)} value={valor} />
            </label>
            <label className="grid gap-1 text-xs text-ink-muted">
              Vencimento
              <input className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink" onChange={(e) => setVencimento(e.target.value)} type="date" value={vencimento} />
            </label>
          </div>
        </div>
        <p className="m-0 mt-1 text-[11px] text-ink-muted">
          Descrição: “Pré-venda - CAD {cadCodigo || "…"}, Empreendimento {empreendimento || "…"}. Este
          pagamento não garante reserva de unidades no empreendimento.”
        </p>
        {/* Fluxo real do lançamento: emitir o PIX já dispara a cobrança nos dois canais. */}
        <label className="mt-3 flex items-center gap-2 text-xs text-ink-soft">
          <input
            checked={enviarAoGerar}
            className="size-4 accent-ink"
            onChange={(event) => setEnviarAoGerar(event.target.checked)}
            type="checkbox"
          />
          Ao gerar, já enviar a cobrança no WhatsApp e no e-mail (usa o telefone e o e-mail de teste
          lá em cima)
        </label>
        <button
          className="mt-2 inline-flex items-center gap-2 rounded-lg bg-inverse px-4 py-2 text-sm font-bold text-brand-ink disabled:opacity-60"
          disabled={gerando}
          onClick={() => void gerarPix()}
          type="button"
        >
          {gerando ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
          {enviarAoGerar ? "Gerar PIX e enviar cobrança" : "Gerar PIX"}
        </button>
        {erro ? (
          <p className="m-0 mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="size-3.5 shrink-0" /> {erro}
          </p>
        ) : null}

        {cobranca ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="QR do PIX" className="size-44 rounded-lg border border-line bg-white p-2" src={`data:image/png;base64,${qr.encodedImage}`} />
            ) : (
              <div className="flex size-44 items-center justify-center rounded-lg border border-dashed border-line text-xs text-ink-muted">sem QR</div>
            )}
            <div className="min-w-0 text-sm">
              <p className="m-0"><b>Cobrança:</b> {cobranca.id}</p>
              <p className="m-0"><b>Status:</b> {status ?? cobranca.status}</p>
              <p className="m-0"><b>Valor:</b> R$ {cobranca.value?.toFixed(2)}</p>
              <p className="m-0"><b>Vencimento:</b> {cobranca.dueDate}</p>
              {qr ? (
                <>
                  <p className="m-0 mt-2">
                    <b>Expira em:</b> {new Date(qr.expirationDate).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  </p>
                  {expiraHoje(qr.expirationDate) ? (
                    <p className="m-0 mt-1 flex items-center gap-1.5 rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
                      <AlertTriangle className="size-3.5" /> Expira HOJE — conta sem chave PIX própria (bloqueador).
                    </p>
                  ) : (
                    <p className="m-0 mt-1 flex items-center gap-1.5 rounded bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="size-3.5" /> Validade longa — chave PIX própria OK.
                    </p>
                  )}
                  <p className="m-0 mt-2 break-all text-[11px] text-ink-muted"><b>Copia e cola:</b> {qr.payload}</p>
                </>
              ) : null}
              <button className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-subtle" onClick={() => void consultarStatus()} type="button">
                <RefreshCw className="size-3.5" /> Consultar status
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* 3. Eventos do webhook */}
      <section className="mt-4 rounded-xl border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <p className="m-0 text-sm font-bold text-ink">3. Eventos do webhook</p>
          <button className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-subtle" onClick={() => void carregarEventos()} type="button">
            <RefreshCw className="size-3.5" /> Atualizar
          </button>
        </div>
        <p className="m-0 mt-1 text-xs text-ink-muted">
          Ao pagar o PIX, o Asaas notifica aqui. Compare o <b>payment_date</b> dele (sem hora) com o
          nosso <b>recebido_em</b> (com hora) — é o desempate da fila.
        </p>
        {eventos.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-ink-muted">
                <tr>
                  <th className="py-1 pr-3">Evento</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">payment_date (Asaas)</th>
                  <th className="py-1 pr-3">recebido_em (nosso)</th>
                </tr>
              </thead>
              <tbody>
                {eventos.map((e, i) => (
                  <tr className="border-t border-line" key={`${e.asaas_payment_id}-${e.recebido_em}-${i}`}>
                    <td className="py-1.5 pr-3 font-semibold text-ink">{e.evento}</td>
                    <td className="py-1.5 pr-3">{e.status}</td>
                    <td className="py-1.5 pr-3">
                      {e.payment_date ?? "—"}
                      {horaSemTempo(e.payment_date) ? <span className="ml-1 text-red-600" title="sem hora">⚠</span> : null}
                    </td>
                    <td className="py-1.5 pr-3">{new Date(e.recebido_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m-0 mt-3 text-xs text-ink-muted">Nenhum evento ainda. Pague o PIX e aguarde.</p>
        )}
      </section>
    </div>
  );
}
