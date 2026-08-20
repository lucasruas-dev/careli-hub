"use client";

import { AlertTriangle, Check, Download, Loader2, Upload, X } from "lucide-react";
import { useState } from "react";

import {
  chaveDaColuna,
  COLUNAS_DA_PLANILHA,
  type LinhaDaPlanilha,
  lerCsv,
  type ProblemaDaLinha,
  STATUS_DO_C2X,
  TIPOS_DO_C2X,
  type UnidadeParaImportar,
} from "@/lib/apolo/cadastrar-unidades";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// ADICIONAR UNIDADE NO EMPREENDIMENTO — uma a uma ou por planilha.
//
// Pedido do Lucas (20/08/2026): *"botão de adicionar (pode ser uma ou importação), aí você já vai
// ter a referência do empreendimento"*, e *"quando finalizar o cadastro ou a importação, tem que
// ir para o C2X"*.
//
// ⚠️ O EMPREENDIMENTO VEM DO CONTEXTO, e essa foi a razão de a tela nascer aqui e não no Setup: a
// escolha mais perigosa do processo (subir 300 lotes no empreendimento errado) deixa de existir,
// porque quem está nesta ficha já está dentro dele.
//
// ⚠️ CONFERIR ANTES DE IMPORTAR NÃO É ETAPA DECORATIVA. Criar unidade não tem desfazer pela API do
// C2X — a unidade errada só sai à mão, pela tela dele, e até lá aparece no estoque, no masterplan e
// no VGV. Por isso o botão de importar só acende depois da conferência, e o destino aparece antes.

type Props = {
  aoFechar: () => void;
  aoTerminar: () => void;
  empreendimento: { code: string; id: string; nome: string };
};

type Conferencia = {
  destino: string;
  empreendimento: { code: string; id: number; nome: string; unidadesHoje: number };
  jaExistem: { lote: string; quadra: string }[];
  problemas: ProblemaDaLinha[];
  prontas: UnidadeParaImportar[];
};

type Envio = {
  criadas: number;
  destino: string;
  falhas: { erro: string; lote: string; quadra: string }[];
  unidadesAntes: number;
  unidadesDepois: number;
};

const CAMPO = "h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none";
const ROTULO = "text-[11px] font-semibold uppercase tracking-wide text-ink-muted";

async function chamar(corpo: Record<string, unknown>) {
  const token = await getApoloAccessToken();
  const resposta = await fetch("/api/apolo/empreendimentos/unidades/cadastrar", {
    body: JSON.stringify(corpo),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = (await resposta.json().catch(() => null)) as {
    data?: unknown;
    error?: string;
  } | null;
  return { ok: resposta.ok, payload };
}

/**
 * Lê a planilha no NAVEGADOR e devolve as linhas.
 *
 * ⚠️ O ARQUIVO NÃO SOBE. Só as linhas viram JSON e vão para o servidor: uma planilha de loteamento
 * tem 300 linhas (~30KB), enquanto o arquivo carrega formatação e passa fácil de 1MB. E o
 * `exceljs` entra por import dinâmico para não pesar no bundle de quem nunca abre este modal.
 */
async function lerPlanilha(arquivo: File): Promise<LinhaDaPlanilha[]> {
  const nome = arquivo.name.toLowerCase();

  if (nome.endsWith(".csv")) {
    const texto = await arquivo.text();
    return lerCsv(texto);
  }

  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await arquivo.arrayBuffer());

  const aba = wb.worksheets[0];
  if (!aba) return [];

  const cabecalho: string[] = [];
  aba.getRow(1).eachCell((celula, coluna) => {
    cabecalho[coluna] = chaveDaColuna(String(celula.value ?? ""));
  });

  const linhas: LinhaDaPlanilha[] = [];
  aba.eachRow((linha, numero) => {
    if (numero === 1) return;
    const registro: LinhaDaPlanilha = {};
    let temAlgo = false;

    linha.eachCell((celula, coluna) => {
      const chave = cabecalho[coluna];
      if (!chave) return;
      // `.text` resolve célula com fórmula e com formatação; o valor cru viria como objeto.
      const valor = celula.type === ExcelJS.ValueType.Formula ? celula.text : celula.value;
      if (valor !== null && valor !== undefined && String(valor).trim() !== "") temAlgo = true;
      registro[chave] = valor;
    });

    // Linha totalmente vazia no meio da planilha é comum e não é erro: some.
    if (temAlgo) linhas.push(registro);
  });

  return linhas;
}

/**
 * Baixa a planilha padrão em XLSX, com uma aba de instruções.
 *
 * Pedido do Lucas (20/08/2026): *"deixa um botão para operador baixar a planilha padrão"*.
 *
 * ⚠️ XLSX E NÃO CSV, e as instruções vão DENTRO do arquivo. O operador abre a planilha dias depois,
 * longe desta tela, e é ali que ele precisa lembrar quais status existem e quais colunas são
 * obrigatórias — orientação que só vive na tela não chega até lá. A aba "Como preencher" carrega
 * os mesmos valores que a validação aceita, tirados da mesma constante.
 */
async function baixarModelo(empreendimento: Props["empreendimento"]) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();

  const aba = wb.addWorksheet("Unidades");
  aba.columns = COLUNAS_DA_PLANILHA.map((c) => ({
    header: c.rotulo + (c.obrigatoria ? " *" : ""),
    key: c.chave,
    width: Math.max(14, c.rotulo.length + 6),
  }));

  aba.getRow(1).font = { bold: true };
  aba.getRow(1).fill = { fgColor: { argb: "FFEFEFEF" }, pattern: "solid", type: "pattern" };

  // Uma linha de exemplo, para o formato dos números ficar à vista (vírgula decimal).
  aba.addRow(Object.fromEntries(COLUNAS_DA_PLANILHA.map((c) => [c.chave, c.exemplo])));

  const ajuda = wb.addWorksheet("Como preencher");
  ajuda.columns = [{ width: 26 }, { width: 64 }];
  ajuda.addRow(["Empreendimento", `${empreendimento.nome} (${empreendimento.code})`]);
  ajuda.addRow(["", ""]);
  ajuda.addRow(["Coluna", "O que preencher"]);
  ajuda.getRow(3).font = { bold: true };

  for (const c of COLUNAS_DA_PLANILHA) {
    ajuda.addRow([
      c.rotulo + (c.obrigatoria ? " *" : ""),
      c.obrigatoria ? "Obrigatório." : "Opcional.",
    ]);
  }

  ajuda.addRow(["", ""]);
  ajuda.addRow(["Status aceitos", STATUS_DO_C2X.map((x) => x.nome).join(" · ")]);
  ajuda.addRow(["", "Em branco vira Disponível."]);
  ajuda.addRow(["Tipos aceitos", TIPOS_DO_C2X.map((x) => x.nome).join(" · ")]);
  ajuda.addRow(["", "Em branco vira Unidade interna."]);
  ajuda.addRow(["", ""]);
  ajuda.addRow(["Números", "Use vírgula decimal: 1.000,00 e 140.401,00."]);
  ajuda.addRow(["Quadra e lote", "Podem vir como 1 ou 01 — o sistema iguala os dois."]);
  ajuda.addRow(["Atenção", "Cada linha vira uma unidade no C2X, e criar unidade não tem desfazer."]);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `modelo-unidades-${empreendimento.code.toLowerCase()}.xlsx`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function AdicionarUnidades({ aoFechar, aoTerminar, empreendimento }: Props) {
  const [aba, setAba] = useState<"planilha" | "uma">("uma");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-line bg-canvas shadow-2xl">
        <header className="flex items-start gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="m-0 text-base font-semibold text-ink">Adicionar unidade</h2>
            <p className="m-0 truncate text-xs text-ink-muted">
              {empreendimento.nome} · {empreendimento.code}
            </p>
          </div>
          {/* ⚠️ NO CABEÇALHO, e não dentro da aba de importação: o operador que abre o modal para
              cadastrar uma unidade e percebe que são trezentas precisa achar o modelo sem caçar. */}
          <button
            className="ml-auto inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink"
            onClick={() => void baixarModelo(empreendimento)}
            type="button"
          >
            <Download className="size-4" />
            Planilha padrão
          </button>
          <button
            aria-label="Fechar"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-subtle"
            onClick={aoFechar}
            type="button"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex gap-1 border-b border-line px-5 py-2">
          {(["uma", "planilha"] as const).map((chave) => (
            <button
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                aba === chave ? "bg-ink text-canvas" : "text-ink-muted hover:bg-subtle"
              }`}
              key={chave}
              onClick={() => setAba(chave)}
              type="button"
            >
              {chave === "uma" ? "Uma unidade" : "Importar planilha"}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {aba === "uma" ? (
            <UmaUnidade aoTerminar={aoTerminar} empreendimento={empreendimento} />
          ) : (
            <ImportarPlanilha aoTerminar={aoTerminar} empreendimento={empreendimento} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── UMA UNIDADE ─────────────────────────────────────────────────────────────

function UmaUnidade({
  aoTerminar,
  empreendimento,
}: {
  aoTerminar: () => void;
  empreendimento: Props["empreendimento"];
}) {
  const [campos, setCampos] = useState<Record<string, string>>({
    area: "",
    lote: "",
    matricula: "",
    quadra: "",
    status: "Disponível",
    tipo: "Unidade interna",
    valor: "",
  });
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<null | string>(null);
  const [pronto, setPronto] = useState<null | string>(null);

  const mudar = (chave: string, valor: string) =>
    setCampos((atual) => ({ ...atual, [chave]: valor }));

  async function salvar() {
    setSalvando(true);
    setAviso(null);
    setPronto(null);
    try {
      const { ok, payload } = await chamar({
        acao: "criar",
        enterpriseId: empreendimento.id,
        unidade: campos,
      });

      if (!ok) {
        setAviso(payload?.error ?? "Não foi possível criar a unidade.");
        return;
      }

      const dados = payload?.data as Envio;
      setPronto(`Unidade criada no C2X (${dados.destino}).`);
      setCampos((atual) => ({ ...atual, area: "", lote: "", matricula: "", valor: "" }));
      aoTerminar();
    } finally {
      setSalvando(false);
    }
  }

  // Valor NÃO entra aqui: dá para cadastrar a unidade antes de saber o preço, e a tela avisa.
  const faltaAlgo = !campos.quadra || !campos.lote || !campos.area;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className={ROTULO}>Quadra *</span>
          <input className={CAMPO} onChange={(e) => mudar("quadra", e.target.value)} placeholder="01" value={campos.quadra} />
        </label>
        <label className="grid gap-1">
          <span className={ROTULO}>Lote *</span>
          <input className={CAMPO} onChange={(e) => mudar("lote", e.target.value)} placeholder="07" value={campos.lote} />
        </label>
        <label className="grid gap-1">
          <span className={ROTULO}>Metragem (m²) *</span>
          <input className={CAMPO} onChange={(e) => mudar("area", e.target.value)} placeholder="1.000,00" value={campos.area} />
        </label>
        <label className="grid gap-1">
          <span className={ROTULO}>Valor de tabela (R$)</span>
          <input className={CAMPO} onChange={(e) => mudar("valor", e.target.value)} placeholder="140.401,00" value={campos.valor} />
          {!campos.valor ? (
            <span className="text-[11px] text-ink-muted">
              Em branco: sobe com R$ 0 e fica fora do VGV até o preço ser preenchido.
            </span>
          ) : null}
        </label>
        <label className="grid gap-1">
          <span className={ROTULO}>Matrícula</span>
          <input className={CAMPO} onChange={(e) => mudar("matricula", e.target.value)} placeholder="25.862" value={campos.matricula} />
        </label>
        <label className="grid gap-1">
          <span className={ROTULO}>Status</span>
          <select className={CAMPO} onChange={(e) => mudar("status", e.target.value)} value={campos.status}>
            {STATUS_DO_C2X.map((s) => (
              <option key={s.id} value={s.nome}>
                {s.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className={ROTULO}>Tipo</span>
          <select className={CAMPO} onChange={(e) => mudar("tipo", e.target.value)} value={campos.tipo}>
            {TIPOS_DO_C2X.map((t) => (
              <option key={t.id} value={t.nome}>
                {t.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      {aviso ? (
        <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          {aviso}
        </p>
      ) : null}
      {pronto ? (
        <p className="m-0 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          {pronto}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-semibold text-canvas disabled:opacity-50"
          disabled={faltaAlgo || salvando}
          onClick={() => void salvar()}
          type="button"
        >
          {salvando ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {salvando ? "Criando no C2X…" : "Criar no C2X"}
        </button>
        <span className="text-[11px] text-ink-muted">A unidade é criada direto no C2X.</span>
      </div>
    </div>
  );
}

// ── IMPORTAR PLANILHA ───────────────────────────────────────────────────────

function ImportarPlanilha({
  aoTerminar,
  empreendimento,
}: {
  aoTerminar: () => void;
  empreendimento: Props["empreendimento"];
}) {
  const [linhas, setLinhas] = useState<LinhaDaPlanilha[]>([]);
  const [arquivo, setArquivo] = useState<null | string>(null);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [envio, setEnvio] = useState<Envio | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<null | string>(null);

  async function escolher(file: File) {
    setAviso(null);
    setConferencia(null);
    setEnvio(null);
    setArquivo(file.name);
    setOcupado(true);
    try {
      const lidas = await lerPlanilha(file);
      if (lidas.length === 0) {
        setAviso("Não achei nenhuma linha com dados nesta planilha.");
        setLinhas([]);
        return;
      }
      setLinhas(lidas);

      const { ok, payload } = await chamar({
        acao: "conferir",
        enterpriseId: empreendimento.id,
        linhas: lidas,
      });
      if (!ok) {
        setAviso(payload?.error ?? "Não foi possível conferir a planilha.");
        return;
      }
      setConferencia(payload?.data as Conferencia);
    } catch {
      setAviso("Não consegui ler o arquivo. Use o modelo em CSV ou um .xlsx simples.");
    } finally {
      setOcupado(false);
    }
  }

  async function importar() {
    setOcupado(true);
    setAviso(null);
    try {
      const { ok, payload } = await chamar({
        acao: "importar",
        enterpriseId: empreendimento.id,
        linhas,
      });
      if (!ok) {
        setAviso(payload?.error ?? "A importação falhou.");
        return;
      }
      setEnvio(payload?.data as Envio);
      aoTerminar();
    } finally {
      setOcupado(false);
    }
  }

  const erros = (conferencia?.problemas ?? []).filter((p) => !p.soAviso);
  const avisos = (conferencia?.problemas ?? []).filter((p) => p.soAviso);

  return (
    <div className="grid gap-4">
      {/* O modelo, com as colunas que a validação espera. */}
      <section className="grid gap-2 rounded-xl border border-line bg-subtle p-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-semibold text-canvas">
            <Upload className="size-4" />
            Escolher planilha
            <input
              accept=".csv,.xlsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void escolher(f);
              }}
              type="file"
            />
          </label>
          {arquivo ? <span className="text-xs text-ink-muted">{arquivo}</span> : null}
        </div>

        <p className="m-0 text-xs text-ink-muted">
          Colunas: {COLUNAS_DA_PLANILHA.map((c) => c.rotulo + (c.obrigatoria ? " *" : "")).join(" · ")}.
          As com * são obrigatórias. Status em branco vira Disponível; valor em branco sobe como
          R$ 0 e fica fora do VGV até alguém preencher.
        </p>
      </section>

      {ocupado && !conferencia ? (
        <div className="h-20 animate-pulse rounded-xl border border-line bg-subtle" />
      ) : null}

      {aviso ? (
        <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          {aviso}
        </p>
      ) : null}

      {/* ── A CONFERÊNCIA, antes de qualquer escrita ─────────────────────── */}
      {conferencia && !envio ? (
        <section className="grid gap-3">
          <div className="flex flex-wrap gap-4 rounded-xl border border-line p-4">
            <Numero rotulo="Vão subir" tom="ok" valor={conferencia.prontas.length} />
            <Numero rotulo="Já existem" valor={conferencia.jaExistem.length} />
            <Numero rotulo="Com erro" tom={erros.length ? "erro" : undefined} valor={erros.length} />
            <Numero rotulo="No C2X hoje" valor={conferencia.empreendimento.unidadesHoje} />
          </div>

          {/* ⚠️ O DESTINO, ANTES DO CLIQUE. Em dev a env aponta para o C2X de teste, e foi assim
              que 8 cadastros foram para o ambiente errado respondendo sucesso. */}
          <p className="m-0 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-ink-muted">
            <AlertTriangle className="size-3.5 shrink-0" />
            As unidades vão para <b className="text-ink">{conferencia.destino}</b>. Criar unidade no
            C2X não tem desfazer.
          </p>

          {erros.length > 0 ? (
            <Lista
              itens={erros}
              titulo={`${erros.length} linha(s) não vão subir`}
              tom="erro"
            />
          ) : null}
          {avisos.length > 0 ? (
            <Lista itens={avisos} titulo={`${avisos.length} aviso(s)`} tom="aviso" />
          ) : null}

          {conferencia.jaExistem.length > 0 ? (
            <p className="m-0 text-xs text-ink-muted">
              Já no C2X (não sobem de novo):{" "}
              {conferencia.jaExistem.slice(0, 12).map((j) => `Q${j.quadra} L${j.lote}`).join(", ")}
              {conferencia.jaExistem.length > 12 ? ` e mais ${conferencia.jaExistem.length - 12}` : ""}.
            </p>
          ) : null}

          <div>
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-sm font-semibold text-canvas disabled:opacity-50"
              disabled={ocupado || conferencia.prontas.length === 0}
              onClick={() => void importar()}
              type="button"
            >
              {ocupado ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {ocupado
                ? "Importando…"
                : `Importar ${conferencia.prontas.length} unidade(s) para o C2X`}
            </button>
          </div>
        </section>
      ) : null}

      {/* ── O RESULTADO, conferido no banco ──────────────────────────────── */}
      {envio ? (
        <section className="grid gap-3 rounded-xl border border-line p-4">
          <div className="flex flex-wrap gap-4">
            <Numero rotulo="Criadas" tom="ok" valor={envio.criadas} />
            <Numero rotulo="Falharam" tom={envio.falhas.length ? "erro" : undefined} valor={envio.falhas.length} />
            <Numero rotulo="Antes" valor={envio.unidadesAntes} />
            <Numero rotulo="Agora" valor={envio.unidadesDepois} />
          </div>

          {/* ⚠️ O BANCO É A PROVA, não a resposta da API: em 01/08 a API confirmou criações que
              tinham ido para outro ambiente. Se os dois números discordarem, a tela avisa. */}
          {envio.unidadesDepois - envio.unidadesAntes !== envio.criadas ? (
            <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              A API confirmou {envio.criadas}, mas o C2X ganhou{" "}
              {envio.unidadesDepois - envio.unidadesAntes}. Conferir antes de subir mais.
            </p>
          ) : (
            <p className="m-0 text-sm text-ink">
              Conferido no C2X: {envio.unidadesAntes} → {envio.unidadesDepois} unidades.
            </p>
          )}

          {envio.falhas.length > 0 ? (
            <ul className="m-0 grid list-none gap-1 p-0 text-xs text-ink-muted">
              {envio.falhas.slice(0, 20).map((f, i) => (
                <li key={i}>
                  Q{f.quadra} L{f.lote}: {f.erro}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Numero({ rotulo, tom, valor }: { rotulo: string; tom?: "erro" | "ok"; valor: number }) {
  const cor = tom === "ok" ? "text-emerald-600" : tom === "erro" ? "text-rose-600" : "text-ink";
  return (
    <div className="min-w-[92px]">
      <div className={ROTULO}>{rotulo}</div>
      <div className={`text-xl font-semibold ${cor}`}>{valor}</div>
    </div>
  );
}

function Lista({
  itens,
  titulo,
  tom,
}: {
  itens: ProblemaDaLinha[];
  titulo: string;
  tom: "aviso" | "erro";
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        tom === "erro"
          ? "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"
          : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
      }`}
    >
      <p className={`m-0 mb-1.5 text-sm font-semibold ${tom === "erro" ? "text-rose-700 dark:text-rose-300" : "text-amber-800 dark:text-amber-300"}`}>
        {titulo}
      </p>
      <ul className="m-0 grid max-h-40 list-none gap-1 overflow-y-auto p-0 text-xs">
        {itens.slice(0, 40).map((p, i) => (
          <li className={tom === "erro" ? "text-rose-700 dark:text-rose-300" : "text-amber-800 dark:text-amber-300"} key={i}>
            Linha {p.linha} · {p.campo}: {p.motivo}
          </li>
        ))}
        {itens.length > 40 ? <li className="text-ink-muted">e mais {itens.length - 40}…</li> : null}
      </ul>
    </div>
  );
}
