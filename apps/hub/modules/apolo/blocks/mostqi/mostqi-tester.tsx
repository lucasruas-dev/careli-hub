"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  FileText,
  KeyRound,
  Loader2,
  ScanLine,
  ShieldCheck,
  UploadCloud,
  XCircle,
} from "lucide-react";

import { getHubSupabaseClient } from "@/lib/supabase/client";

// Sandbox de comunicacao com o MOSTQI: valida o handshake (token temporario) e
// a leitura documental (iOCR). Funciona em modo simulado ate a client key entrar
// na env; nao grava nada, so exercita a integracao ponta a ponta.

type MostqiStatus = {
  authPath: string;
  baseUrl: string;
  clientKeyPresent: boolean;
  environment: "producao" | "homologacao";
  extractionPath: string;
  mode: "live" | "mock";
};

type AuthResult = {
  configured: boolean;
  message: string;
  ok: boolean;
  tookMs?: number;
};

type CadastroField = {
  confidence: number | null;
  key: string;
  label: string;
  value: string;
};

type CadastroDraft = Record<string, string> & {
  bairro: string;
  cep: string;
  cidade: string;
  cpf: string;
  dataNascimento: string;
  logradouro: string;
  naturalidade: string;
  nome: string;
  nomeMae: string;
  nomePai: string;
  numero: string;
  orgaoEmissor: string;
  rg: string;
  uf: string;
};

type Extraction = {
  cadastro: CadastroDraft;
  documentType: string;
  fields: CadastroField[];
  overallConfidence: number | null;
  raw?: unknown;
  source: "mock" | "mostqi";
  stdType: string;
  warnings: string[];
};

const CADASTRO_LABELS: Array<{ key: keyof CadastroDraft; label: string }> = [
  { key: "nome", label: "Nome" },
  { key: "cpf", label: "CPF" },
  { key: "rg", label: "RG" },
  { key: "dataNascimento", label: "Nascimento" },
  { key: "nomeMae", label: "Nome da mae" },
  { key: "nomePai", label: "Nome do pai" },
  { key: "orgaoEmissor", label: "Orgao emissor" },
  { key: "naturalidade", label: "Naturalidade" },
  { key: "logradouro", label: "Logradouro" },
  { key: "numero", label: "Numero" },
  { key: "bairro", label: "Bairro" },
  { key: "cidade", label: "Cidade" },
  { key: "uf", label: "UF" },
  { key: "cep", label: "CEP" },
];

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const token = await accessToken();
  const response = await fetch("/api/apolo/mostqi", {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: string }
    | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? `Falha HTTP ${response.status}`);
  }
  return payload.data as T;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function confidenceTone(score: number | null): string {
  if (score === null) return "text-slate-400";
  if (score >= 0.9) return "text-emerald-600";
  if (score >= 0.75) return "text-amber-600";
  return "text-rose-600";
}

export function MostqiTester() {
  const [status, setStatus] = useState<MostqiStatus | null>(null);
  const [authResult, setAuthResult] = useState<AuthResult | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [extractLoading, setExtractLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Copia a estrutura da extracao (tipo + todos os campos + JSON cru) para o
  // operador colar num chat e definirmos o mapa de cadastro por tipo de doc.
  const copyExtraction = useCallback(async () => {
    if (!extraction) return;
    const lines = [
      `Tipo: ${extraction.documentType} (${extraction.stdType})`,
      `Campos (${extraction.fields.length}):`,
      ...extraction.fields.map(
        (field) =>
          `- ${field.key} = ${field.value}${
            field.confidence !== null
              ? ` (${Math.round(field.confidence * 100)}%)`
              : ""
          }`,
      ),
    ];
    if (extraction.raw) {
      lines.push("", "JSON cru:", JSON.stringify(extraction.raw, null, 2));
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Nao foi possivel copiar. Copie manualmente pelo JSON cru.");
    }
  }, [extraction]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await accessToken();
        const response = await fetch("/api/apolo/mostqi", {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const payload = (await response.json().catch(() => null)) as {
          data?: MostqiStatus;
        } | null;
        if (!cancelled && payload?.data) setStatus(payload.data);
      } catch {
        // status fica nulo; a tela mostra "carregando".
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onPickFile = useCallback((picked: File | null) => {
    setExtraction(null);
    setError(null);
    setFile(picked);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return picked && picked.type.startsWith("image/")
        ? URL.createObjectURL(picked)
        : null;
    });
  }, []);

  async function runAuth() {
    setAuthLoading(true);
    setError(null);
    try {
      setAuthResult(await api<AuthResult>({ action: "authenticate" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function runExtract() {
    setExtractLoading(true);
    setError(null);
    try {
      const fileBase64 = file ? await fileToBase64(file) : undefined;
      setExtraction(
        await api<Extraction>({
          action: "extract",
          fileBase64,
          fileName: file?.name,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setExtractLoading(false);
    }
  }

  const isMock = status?.mode === "mock";

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-4 overflow-y-auto pb-16">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#A07C3B]">
            Apolo · Integracao
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            MOSTQI · Teste de comunicacao
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Valide o handshake (token temporario) e a leitura de documentos
            (iOCR). Nada e gravado: e so um sandbox para conferir a integracao.
          </p>
        </div>
        {status ? (
          <span
            className={[
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
              isMock
                ? "bg-amber-50 text-amber-700"
                : "bg-emerald-50 text-emerald-700",
            ].join(" ")}
          >
            {isMock ? (
              <AlertTriangle className="size-3.5" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-3.5" aria-hidden="true" />
            )}
            {isMock ? "Modo simulado" : "MOSTQI conectado"}
          </span>
        ) : null}
      </header>

      {/* Conexao */}
      <div className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <KeyRound className="size-4 text-[#A07C3B]" aria-hidden="true" />
          Conexao
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusTile label="Modo" value={status ? (isMock ? "Simulado" : "Live") : "…"} />
          <StatusTile
            label="Ambiente"
            value={status ? (status.environment === "producao" ? "Producao" : "Homologacao") : "…"}
          />
          <StatusTile
            label="Client key"
            value={status ? (status.clientKeyPresent ? "Presente" : "Ausente") : "…"}
            tone={status ? (status.clientKeyPresent ? "good" : "warn") : "muted"}
          />
          <StatusTile label="Base URL" value={status?.baseUrl ?? "…"} mono />
        </div>
        {status ? (
          <p className="mt-3 font-mono text-[11px] text-slate-400">
            POST {status.authPath} · POST {status.extractionPath}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={runAuth}
            disabled={authLoading}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {authLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-4" aria-hidden="true" />
            )}
            Testar autenticacao
          </button>
          {authResult ? (
            <span
              className={[
                "inline-flex items-center gap-1.5 text-sm font-medium",
                authResult.ok ? "text-emerald-700" : "text-amber-700",
              ].join(" ")}
            >
              {authResult.ok ? (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              ) : (
                <AlertTriangle className="size-4" aria-hidden="true" />
              )}
              {authResult.message}
              {typeof authResult.tookMs === "number"
                ? ` (${authResult.tookMs}ms)`
                : ""}
            </span>
          ) : null}
        </div>
      </div>

      {/* Probe do enriquecimento: testa subset de datasets + tempo */}
      <EnrichmentProbe />

      {/* Upload + extracao */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ScanLine className="size-4 text-[#A07C3B]" aria-hidden="true" />
            Documento
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-4 flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-8 text-center transition-colors hover:border-[#A07C3B]/50 hover:bg-[#A07C3B]/[0.03]"
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Previa do documento"
                className="max-h-44 rounded-lg object-contain"
              />
            ) : (
              <>
                <UploadCloud className="size-7 text-slate-400" aria-hidden="true" />
                <span className="text-sm font-medium text-slate-600">
                  Clique para escolher RG, CNH ou comprovante
                </span>
                <span className="text-xs text-slate-400">
                  Imagem ou PDF, ate 20MB
                </span>
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(event) => onPickFile(event.target.files?.[0] ?? null)}
          />

          {file ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <FileText className="size-3.5" aria-hidden="true" />
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </p>
          ) : null}

          <button
            type="button"
            onClick={runExtract}
            disabled={extractLoading || (!file && !isMock)}
            className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {extractLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <ScanLine className="size-4" aria-hidden="true" />
            )}
            {isMock && !file ? "Extrair exemplo (simulado)" : "Extrair documento"}
          </button>
          {isMock ? (
            <p className="mt-2 text-center text-[11px] text-amber-600">
              Sem client key: a extracao devolve um exemplo para testar a tela.
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FileText className="size-4 text-[#A07C3B]" aria-hidden="true" />
              Resultado
            </div>
            {extraction ? (
              <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono">
                  {extraction.documentType}
                </span>
                {extraction.overallConfidence !== null ? (
                  <span className={confidenceTone(extraction.overallConfidence)}>
                    {Math.round(extraction.overallConfidence * 100)}% conf.
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={copyExtraction}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {copied ? (
                    <ClipboardCheck className="size-3.5 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </span>
            ) : null}
          </div>

          {!extraction ? (
            <p className="mt-8 text-center text-sm text-slate-400">
              O cadastro preenchido pela extracao aparece aqui.
            </p>
          ) : (
            <div className="mt-4 grid gap-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {CADASTRO_LABELS.map(({ key, label }) => (
                  <div key={key} className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {label}
                    </div>
                    <div className="mt-0.5 min-h-[1.25rem] text-sm text-slate-800">
                      {extraction.cadastro[key] || (
                        <span className="text-slate-300">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {extraction.warnings.length ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {extraction.warnings.map((warning) => (
                    <div key={warning} className="flex items-start gap-1.5">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {warning}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {extraction ? (
        <div className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <FileText className="size-4 text-[#A07C3B]" aria-hidden="true" />
              Todos os campos lidos ({extraction.fields.length})
            </div>
            <button
              type="button"
              onClick={copyExtraction}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              {copied ? (
                <ClipboardCheck className="size-3.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              {copied ? "Copiado" : "Copiar tudo"}
            </button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {extraction.fields.map((field, index) => (
              <div
                key={`${field.key}-${index}`}
                className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {field.label}
                  </span>
                  {field.confidence !== null ? (
                    <span
                      className={`shrink-0 font-mono text-[10px] ${confidenceTone(field.confidence)}`}
                    >
                      {Math.round(field.confidence * 100)}%
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 break-words text-sm text-slate-800">
                  {field.value || <span className="text-slate-300">—</span>}
                </div>
              </div>
            ))}
          </div>

          {extraction.raw ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowRaw((value) => !value)}
                className="text-xs font-semibold text-[#A07C3B] hover:underline"
              >
                {showRaw ? "Ocultar" : "Ver"} JSON cru do MOSTQI
              </button>
              {showRaw ? (
                <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                  {JSON.stringify(extraction.raw, null, 2)}
                </pre>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          <XCircle className="size-4" aria-hidden="true" />
          {error}
        </div>
      ) : null}
    </section>
  );
}

// Datasets rapidos (base ja pronta) — sem os on-demand (antecedentes/certidoes)
// que sao a parte lenta.
const FAST_DATASETS = [
  "basic_data",
  "phones_extended",
  "addresses_extended",
  "financial_data",
  "occupation_data",
];

type ProbeDataset = { name: string; status: string };
type ProbeResult = {
  clientMs: number;
  datasets: ProbeDataset[];
  mode: "completa" | "subset";
  mostMs: number;
  raw: unknown;
};

function EnrichmentProbe() {
  const [cpf, setCpf] = useState("");
  const [loading, setLoading] = useState<null | "completa" | "subset">(null);
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function run(mode: "completa" | "subset") {
    const digits = cpf.replace(/\D/g, "");
    if (digits.length !== 11) {
      setError("Digite um CPF válido (11 dígitos).");
      return;
    }
    setLoading(mode);
    setError(null);
    setResult(null);
    const started = performance.now();
    try {
      const token = await accessToken();
      const response = await fetch("/api/apolo/mostqi", {
        body: JSON.stringify({
          action: "enrich",
          cpf: digits,
          ...(mode === "subset" ? { datasets: FAST_DATASETS } : {}),
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        method: "POST",
      });
      const json = (await response.json().catch(() => null)) as {
        data?: { raw?: unknown; warnings?: string[] };
        error?: string;
      } | null;
      if (!response.ok || !json?.data) {
        throw new Error(json?.error ?? `HTTP ${response.status}`);
      }
      const clientMs = Math.round(performance.now() - started);
      const raw = json.data.raw;
      const rawObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
      const resultObj =
        rawObj && typeof rawObj.result === "object"
          ? (rawObj.result as Record<string, unknown>)
          : null;
      const dsArr = resultObj && Array.isArray(resultObj.datasets)
        ? (resultObj.datasets as unknown[])
        : [];
      const datasets: ProbeDataset[] = dsArr.map((entry) => {
        const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
        return { name: String(record.name ?? ""), status: String(record.status ?? "") };
      });
      setResult({
        clientMs,
        datasets,
        mode,
        mostMs: Number(rawObj?.elapsedMilliseconds ?? 0),
        raw,
      });
      if (!datasets.length && json.data.warnings?.length) {
        setError(json.data.warnings.join(" · "));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <ShieldCheck className="size-4 text-[#A07C3B]" aria-hidden="true" />
        Probe do enriquecimento (teste de subset + tempo)
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Testa se dá pra escolher os datasets pelo nosso lado. Rode nos dois modos
        e compare o tempo e quais datasets voltaram.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={cpf}
          onChange={(event) => setCpf(event.target.value)}
          placeholder="CPF (só números)"
          inputMode="numeric"
          className="h-9 w-48 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#A07C3B]/40"
        />
        <button
          type="button"
          onClick={() => run("completa")}
          disabled={loading !== null}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {loading === "completa" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Consulta completa
        </button>
        <button
          type="button"
          onClick={() => run("subset")}
          disabled={loading !== null}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#A07C3B] px-3 text-sm font-semibold text-white hover:bg-[#8E6F35] disabled:opacity-50"
        >
          {loading === "subset" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          Só cadastro (subset)
        </button>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-slate-400">
          Consultando… (a completa pode levar mais de 100s)
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 grid gap-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              Modo:{" "}
              <b>{result.mode === "subset" ? "Só cadastro (subset)" : "Completa"}</b>
            </span>
            <span>
              Tempo MOST:{" "}
              <b className="font-mono">{(result.mostMs / 1000).toFixed(1)}s</b>
            </span>
            <span>
              Nosso tempo:{" "}
              <b className="font-mono">{(result.clientMs / 1000).toFixed(1)}s</b>
            </span>
            <span>
              Datasets: <b>{result.datasets.length}</b>
            </span>
          </div>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {result.datasets.map((dataset) => (
              <span
                key={dataset.name}
                className="flex items-center justify-between gap-2 rounded border border-slate-100 bg-slate-50/70 px-2 py-1 text-[11px]"
              >
                <span className="truncate font-mono text-slate-600">{dataset.name}</span>
                <span
                  className={
                    dataset.status === "DONE"
                      ? "text-emerald-600"
                      : dataset.status === "ERROR"
                        ? "text-rose-600"
                        : "text-slate-400"
                  }
                >
                  {dataset.status}
                </span>
              </span>
            ))}
          </div>
          <div>
            <button
              type="button"
              onClick={() => setShowRaw((value) => !value)}
              className="text-xs font-semibold text-[#A07C3B] hover:underline"
            >
              {showRaw ? "Ocultar" : "Ver"} resposta crua
            </button>
            {showRaw ? (
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[10px] leading-relaxed text-slate-100">
                {JSON.stringify(result.raw, null, 2)}
              </pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusTile({
  label,
  mono = false,
  tone = "muted",
  value,
}: {
  label: string;
  mono?: boolean;
  tone?: "good" | "warn" | "muted";
  value: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-slate-800";
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div
        className={[
          "mt-0.5 truncate text-sm font-medium",
          mono ? "font-mono text-xs" : "",
          toneClass,
        ].join(" ")}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
