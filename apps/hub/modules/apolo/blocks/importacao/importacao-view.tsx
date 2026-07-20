"use client";

import {
  AlertTriangle,
  Database,
  FileText,
  Loader2,
  Paperclip,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

import { ImportarCads } from "./importar-cads";
import { LerCads } from "./ler-cads";

// Importar CADs do Asana — PASSO 1: enxergar o que existe lá.
//
// Esta tela é read-only e não custa nada: não baixa arquivo, não lê documento e não chama a
// MOST. Ela existe porque o token do Asana só está em produção — sem ela, montar a importação
// seria adivinhar nomes de seção e de campo.
//
// As três perguntas que ela responde, e que definem se a importação é viável:
//   1. quais são as seções reais e quantas CADs em cada
//   2. as CADs têm CPF? (createApoloEntity EXIGE documento válido — sem CPF elas não entram)
//   3. tem corretor e imobiliária? qual o valor real do empreendimento?

type CampoResumo = { nome: string; preenchidos: number; valores: string[] };
type TarefaAmostra = {
  campos: Record<string, string>;
  criadoEm: string | null;
  gid: string;
  nome: string;
  qtdAnexos: number;
};
type SecaoResumo = {
  amostra: TarefaAmostra[];
  anexosNaAmostra: number;
  gid: string;
  nome: string;
  tarefasAbertas: number;
  tiposDeAnexo: Record<string, number>;
};
type Sondagem = {
  campos: CampoResumo[];
  projeto: string;
  secoes: SecaoResumo[];
  totalTarefasAbertas: number;
};

// Um campo que "parece" CPF é o que decide se a importação consegue criar entidade.
function pareceDocumento(nome: string): boolean {
  const limpo = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return limpo.includes("cpf") || limpo.includes("cnpj") || limpo.includes("documento");
}

export function ImportacaoView() {
  const [aba, setAba] = useState<"importar" | "ler" | "sondagem">("importar");
  // Filtro que a aba Importar repassa quando manda o operador para a leitura.
  const [filtroDaLeitura, setFiltroDaLeitura] = useState({
    empreendimento: "Vale do Ouro",
    secoes: "Em Cadastro",
  });
  const [sondagem, setSondagem] = useState<Sondagem | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const sondar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/asana/cads", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await resposta.json()) as { data?: Sondagem; error?: string };
      if (!resposta.ok) {
        setErro(corpo.error ?? `Falha (${resposta.status}).`);
        setSondagem(null);
      } else {
        setSondagem(corpo.data ?? null);
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    setCarregando(false);
  }, []);

  // A sondagem só roda quando a aba dela é aberta: é uma varredura no Asana, não precisa
  // acontecer toda vez que alguém entra na tela para importar.
  useEffect(() => {
    if (aba === "sondagem" && !sondagem && !erro) void sondar();
  }, [aba, erro, sondagem, sondar]);

  const campoDocumento = sondagem?.campos.find((c) => pareceDocumento(c.nome));

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-canvas">
      <header className="flex flex-wrap items-center gap-3 border-b border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
        <div>
          <h1 className="text-base font-bold text-ink">Importar CADs do Asana</h1>
          <p className="text-xs text-ink-soft">
            Leitura apenas. Nada é criado no Apolo e nenhum documento é lido nesta etapa.
          </p>
        </div>
        <nav className="ml-auto flex items-center gap-1 rounded-lg bg-black/[0.05] p-1 dark:bg-white/[0.07]">
          {(
            [
              ["importar", "Importar"],
              ["ler", "Ler documentos"],
              ["sondagem", "O que existe no Asana"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`rounded-md px-3 py-1.5 text-[0.8rem] font-bold transition-colors ${
                aba === id
                  ? "bg-surface text-[#A07C3B] shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => setAba(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>

        {aba === "sondagem" ? (
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
            disabled={carregando}
            onClick={() => void sondar()}
            type="button"
          >
            {carregando ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
            Sondar de novo
          </button>
        ) : null}
      </header>

      {aba === "importar" ? (
        <div className="p-5">
          <ImportarCads
            onIrParaLeitura={(empreendimento, secoes) => {
              setFiltroDaLeitura({ empreendimento, secoes });
              setAba("ler");
            }}
          />
        </div>
      ) : null}

      {aba === "ler" ? (
        <div className="p-5">
          <LerCads
            // `key` remonta a aba quando o filtro muda: sem isso o estado inicial ficaria
            // preso no primeiro valor e o operador veria a busca antiga.
            key={`${filtroDaLeitura.empreendimento}|${filtroDaLeitura.secoes}`}
            empreendimentoInicial={filtroDaLeitura.empreendimento}
            secoesIniciais={filtroDaLeitura.secoes}
          />
        </div>
      ) : null}

      {aba === "sondagem" && carregando && !sondagem ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="animate-spin text-ink-muted" size={22} />
        </div>
      ) : null}

      {aba === "sondagem" && erro ? (
        <div className="m-5 rounded-xl border border-red-300/50 bg-red-50 p-4 dark:bg-red-950/30">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">
            Não foi possível ler o Asana
          </p>
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{erro}</p>
          <p className="mt-2 text-xs text-red-700/80 dark:text-red-400/80">
            O token do Asana só existe em produção: no ambiente local esta tela sempre falha.
          </p>
        </div>
      ) : null}

      {aba === "sondagem" && sondagem ? (
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-3">
            <Indicador
              icone={<Database size={15} />}
              label="Projeto"
              valor={sondagem.projeto}
            />
            <Indicador
              icone={<FileText size={15} />}
              label="CADs abertas"
              valor={String(sondagem.totalTarefasAbertas)}
            />
            <Indicador
              icone={<Paperclip size={15} />}
              label="Seções"
              valor={String(sondagem.secoes.length)}
            />
          </div>

          {/* A pergunta que decide a viabilidade da importação. */}
          <section
            className={`rounded-xl border p-4 ${
              campoDocumento
                ? "border-emerald-400/40 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-amber-400/50 bg-amber-50/60 dark:bg-amber-950/25"
            }`}
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle
                className={
                  campoDocumento
                    ? "mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                    : "mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
                }
                size={17}
              />
              <div>
                <p className="text-sm font-semibold text-ink">
                  {campoDocumento
                    ? `As CADs têm documento: campo “${campoDocumento.nome}”`
                    : "Nenhum campo de CPF/CNPJ encontrado nas CADs"}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  {campoDocumento
                    ? `Preenchido em ${campoDocumento.preenchidos} CADs. É o que permite criar a entidade no Apolo.`
                    : "O Apolo exige CPF ou CNPJ válido para criar uma entidade. Sem esse dado, a importação precisa de outro caminho: ou o documento vem dos anexos (lido por iOCR, que é consulta cobrada na MOST), ou as CADs entram como rascunho a ser completado pelo analista."}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
            <h2 className="mb-3 text-[0.8rem] font-bold uppercase tracking-wide text-ink-soft">
              Seções do projeto
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[0.68rem] uppercase tracking-wide text-ink-muted">
                    <th className="px-2 py-1.5 font-semibold">Seção</th>
                    <th className="px-2 py-1.5 font-semibold">CADs abertas</th>
                    <th className="px-2 py-1.5 font-semibold">Anexos na amostra</th>
                    <th className="px-2 py-1.5 font-semibold">Tipos de arquivo</th>
                  </tr>
                </thead>
                <tbody>
                  {sondagem.secoes.map((secao) => (
                    <tr
                      key={secao.gid}
                      className="border-t border-black/[0.06] dark:border-white/[0.07]"
                    >
                      <td className="px-2 py-2 font-medium text-ink">{secao.nome}</td>
                      <td className="px-2 py-2 font-semibold tabular-nums text-ink">
                        {secao.tarefasAbertas}
                      </td>
                      <td className="px-2 py-2 tabular-nums text-ink-soft">
                        {secao.anexosNaAmostra}
                      </td>
                      <td className="px-2 py-2 text-ink-soft">
                        {Object.entries(secao.tiposDeAnexo)
                          .map(([ext, n]) => `${ext} (${n})`)
                          .join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
            <h2 className="mb-1 text-[0.8rem] font-bold uppercase tracking-wide text-ink-soft">
              Campos disponíveis nas CADs
            </h2>
            <p className="mb-3 text-xs text-ink-muted">
              É daqui que sai o mapeamento da importação: empreendimento, imobiliária,
              corretor e documento.
            </p>
            <div className="space-y-1.5">
              {sondagem.campos.map((campo) => (
                <div
                  key={campo.nome}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-black/[0.06] px-3 py-2 dark:border-white/[0.07]"
                >
                  <span className="text-sm font-medium text-ink">{campo.nome}</span>
                  <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[0.68rem] font-semibold text-ink-soft dark:bg-white/[0.08]">
                    {campo.preenchidos} preenchidos
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                    {campo.valores.join(" · ") || "sem valor"}
                  </span>
                </div>
              ))}
              {sondagem.campos.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-muted">
                  Nenhum campo personalizado encontrado.
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
            <h2 className="mb-3 text-[0.8rem] font-bold uppercase tracking-wide text-ink-soft">
              Amostra das CADs
            </h2>
            <div className="space-y-3">
              {sondagem.secoes.map((secao) => (
                <div key={secao.gid}>
                  <p className="mb-1.5 text-xs font-semibold text-ink-soft">
                    {secao.nome}
                  </p>
                  <div className="space-y-1.5">
                    {secao.amostra.map((tarefa) => (
                      <div
                        key={tarefa.gid}
                        className="rounded-lg border border-black/[0.06] px-3 py-2 dark:border-white/[0.07]"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-ink">
                            {tarefa.nome}
                          </span>
                          <span className="text-[0.66rem] text-ink-muted">
                            {tarefa.qtdAnexos} anexo(s)
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {Object.entries(tarefa.campos).map(([nome, valor]) => (
                            <span
                              key={nome}
                              className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[0.66rem] text-ink-soft dark:bg-white/[0.07]"
                            >
                              <b className="font-semibold">{nome}:</b> {valor}
                            </span>
                          ))}
                          {Object.keys(tarefa.campos).length === 0 ? (
                            <span className="text-[0.66rem] text-ink-muted">
                              sem campos preenchidos
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    {secao.amostra.length === 0 ? (
                      <p className="text-xs text-ink-muted">Seção vazia.</p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Indicador(props: { icone: React.ReactNode; label: string; valor: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-black/[0.07] bg-surface px-3.5 py-2 dark:border-white/[0.08]">
      <span className="text-ink-muted">{props.icone}</span>
      <div>
        <div className="text-sm font-bold text-ink">{props.valor}</div>
        <div className="text-[0.68rem] uppercase tracking-wide text-ink-muted">
          {props.label}
        </div>
      </div>
    </div>
  );
}
