"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCw, Zap } from "lucide-react";

import { T } from "./tema";

// A EMISSÃO DE BOLETOS NO PORTAL — a carteira do mês já aberta, e um botão que emite.
//
// Pedido do Lucas (01/09/2026): *"vamos ter uma aba trazendo o consolidado de tudo, vamos ter cada
// produto sua aba. vai ter uma tabela igual temos na carteira hoje... nome, cpf, valor da fatura,
// emissão vencimento, data de pagamento, vencido e tal. além do link do boleto"*. E, vendo a
// primeira versão: *"não quero importar planilha, já traz isso pronto, vc já tem os dados pode
// montar a tela e ter o botão de gerar boleto e pronto"*.
//
// ⚠️ A PLANILHA SAIU DO CAMINHO. Ela virou a origem de uma CARGA (`boletos_parcelas`), não a fonte
// que a tela consulta. Antes, quem abrisse a tela precisava ter o arquivo na mão, e duas pessoas com
// versões diferentes dele viam números diferentes do mesmo mês.
//
// ⚠️ A TELA NÃO MANDA VALOR NENHUM. O corpo do POST leva competência, empreendimento e, quando o
// operador escolhe, as unidades. Valor, CPF e vencimento a rota busca no banco: o preço do boleto
// não passa pelo lado que o operador consegue editar.

type Carteira = {
  conta: null | string;
  contaConfigurada: boolean;
  nome: string;
  slug: string;
};

type ParcelaAEmitir = {
  bloqueio: null | string;
  documento: null | string;
  empreendimento: string;
  jaEmitido: boolean;
  nome: string;
  nomeNaPlanilha: string;
  unidade: string;
  valor: null | number;
  vencimentoDia: null | number;
};

type BoletoEmitido = {
  cobranca: string;
  documento: null | string;
  emissao: null | string;
  empreendimento: string;
  link: null | string;
  nome: string;
  pagamento: null | string;
  situacao: string;
  unidade: string;
  valor: number;
  vencido: boolean;
  vencimento: string;
};

type Emissao = {
  conta: string;
  emitidos: number;
  empreendimento: string;
  falhas: number;
  repetidos: number;
  resultados: {
    cobranca: null | string;
    erro: null | string;
    ja_existia: boolean;
    link: null | string;
    nome: string;
    unidade: string;
    valor: number;
  }[];
};

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function moeda(v: number): string {
  return v.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

/**
 * `2026-09-15` → `15/09/2026`.
 *
 * ⚠️ FATIANDO A STRING, sem `new Date`. A data vem do Asaas como `AAAA-MM-DD`; passada por `new Date`
 * ela vira meia-noite UTC e, exibida no Brasil (UTC−3), mostra o DIA ANTERIOR: um vencimento dia 1º
 * apareceria como do mês passado.
 */
function dia(iso: null | string): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function rotuloDaCompetencia(c: string): string {
  const [ano, mes] = c.split("-");
  return `${MESES[Number(mes) - 1] ?? mes} de ${ano}`;
}

/** Do mês corrente para trás e para a frente: o administrativo emite o corrente, confere os passados. */
function competenciasSugeridas(): string[] {
  const hoje = new Date();
  const lista: string[] = [];
  for (let i = 3; i >= -3; i -= 1) {
    const d = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - i, 1));
    lista.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return lista.reverse();
}

export function TelaBoletos() {
  const [competencia, setCompetencia] = useState(() => {
    const hoje = new Date();
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  });
  const [carteiras, setCarteiras] = useState<Carteira[]>([]);
  const [aEmitir, setAEmitir] = useState<ParcelaAEmitir[]>([]);
  const [emitidos, setEmitidos] = useState<BoletoEmitido[]>([]);
  const [falhas, setFalhas] = useState<{ conta: string; erro: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [aba, setAba] = useState<string>("consolidado");

  const [emitindo, setEmitindo] = useState<null | string>(null);
  const [emissao, setEmissao] = useState<null | Emissao>(null);
  // A unidade que o operador escolheu emitir sozinha. Vazio = o lote inteiro daquela carteira.
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/incorporador/boletos?competencia=${competencia}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`Não consegui carregar (${r.status}).`);
      const j = (await r.json()) as {
        data?: {
          aEmitir: ParcelaAEmitir[];
          boletos: BoletoEmitido[];
          carteiras: Carteira[];
          falhas: { conta: string; erro: string }[];
        };
      };
      setAEmitir(j.data?.aEmitir ?? []);
      setEmitidos(j.data?.boletos ?? []);
      setCarteiras(j.data?.carteiras ?? []);
      setFalhas(j.data?.falhas ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar.");
    } finally {
      setCarregando(false);
    }
  }, [competencia]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    setEmissao(null);
    setSelecionadas(new Set());
  }, [competencia]);

  const emitir = useCallback(
    async (slug: string, unidades?: string[]) => {
      setEmitindo(slug);
      setErro(null);
      setEmissao(null);
      try {
        const r = await fetch("/api/incorporador/boletos", {
          body: JSON.stringify({
            competencia,
            confirmar: true,
            empreendimento: slug,
            ...(unidades && unidades.length > 0 ? { unidades } : {}),
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const j = (await r.json()) as { data?: Emissao; error?: string };
        if (!r.ok) throw new Error(j.error ?? `Falhou (${r.status}).`);
        setEmissao(j.data ?? null);
        setSelecionadas(new Set());
        await carregar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui falar com o servidor.");
      } finally {
        setEmitindo(null);
      }
    },
    [carregar, competencia],
  );

  // ── O que cada aba mostra ──────────────────────────────────────────────────

  const pendentes = useMemo(
    () => aEmitir.filter((p) => !p.bloqueio && !p.jaEmitido && (p.valor ?? 0) > 0),
    [aEmitir],
  );

  const visiveisPendentes =
    aba === "consolidado" ? pendentes : pendentes.filter((p) => p.empreendimento === aba);
  const visiveisEmitidos =
    aba === "consolidado" ? emitidos : emitidos.filter((b) => b.empreendimento === aba);
  const visiveisFora =
    aba === "consolidado"
      ? aEmitir.filter((p) => p.bloqueio)
      : aEmitir.filter((p) => p.bloqueio && p.empreendimento === aba);

  const totais = useMemo(() => {
    const pagos = visiveisEmitidos.filter((b) => b.pagamento);
    const vencidos = visiveisEmitidos.filter((b) => b.vencido);
    return {
      aEmitir: visiveisPendentes.reduce((a, p) => a + (p.valor ?? 0), 0),
      emitido: visiveisEmitidos.reduce((a, b) => a + b.valor, 0),
      pago: pagos.reduce((a, b) => a + b.valor, 0),
      pagos: pagos.length,
      vencido: vencidos.reduce((a, b) => a + b.valor, 0),
      vencidos: vencidos.length,
    };
  }, [visiveisEmitidos, visiveisPendentes]);

  const contagemPorCarteira = useMemo(() => {
    const m = new Map<string, { emitidos: number; pendentes: number }>();
    for (const c of carteiras) m.set(c.slug, { emitidos: 0, pendentes: 0 });
    for (const p of pendentes) {
      const e = m.get(p.empreendimento);
      if (e) e.pendentes += 1;
    }
    for (const b of emitidos) {
      const e = m.get(b.empreendimento);
      if (e) e.emitidos += 1;
    }
    return m;
  }, [carteiras, emitidos, pendentes]);

  const semChave = carteiras.filter((c) => !c.contaConfigurada);
  const podeEmitir = aba !== "consolidado" && carteiras.find((c) => c.slug === aba)?.contaConfigurada;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Cabecalho
        aoAtualizar={() => void carregar()}
        carregando={carregando}
        competencia={competencia}
        onCompetencia={setCompetencia}
      />

      {semChave.length > 0 ? (
        <Aviso tom="alerta">
          Sem chave do Asaas configurada: {semChave.map((c) => c.nome).join(", ")}. Enquanto ela não
          entrar no ambiente, estes empreendimentos não emitem.
        </Aviso>
      ) : null}
      {falhas.map((f) => (
        <Aviso key={f.conta} tom="erro">
          Não consegui ler a conta {f.conta} no Asaas: {f.erro}
        </Aviso>
      ))}
      {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
      {emissao ? <ResultadoDaEmissao emissao={emissao} /> : null}

      <Abas
        aba={aba}
        carteiras={carteiras}
        contagem={contagemPorCarteira}
        onAba={(a) => {
          setAba(a);
          setSelecionadas(new Set());
        }}
        totalEmitidos={emitidos.length}
        totalPendentes={pendentes.length}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Cartao
          nota={`${visiveisPendentes.length} boleto(s)`}
          rotulo="A emitir"
          tom={visiveisPendentes.length > 0 ? "destaque" : undefined}
          valor={moeda(totais.aEmitir)}
        />
        <Cartao
          nota={`${visiveisEmitidos.length} boleto(s)`}
          rotulo="Emitido"
          valor={moeda(totais.emitido)}
        />
        <Cartao nota={`${totais.pagos} boleto(s)`} rotulo="Pago" valor={moeda(totais.pago)} />
        <Cartao
          nota={`${totais.vencidos} boleto(s)`}
          rotulo="Vencido"
          tom={totais.vencidos > 0 ? "alerta" : undefined}
          valor={moeda(totais.vencido)}
        />
      </div>

      {carregando ? (
        <p style={{ color: T.sub, fontSize: 14, padding: 24, textAlign: "center" }}>
          <Loader2 className="inc-girando" size={16} style={{ verticalAlign: "middle" }} /> Lendo a
          carteira e o Asaas…
        </p>
      ) : (
        <>
          {visiveisPendentes.length > 0 ? (
            <AEmitir
              aoEmitir={(unidades) => void emitir(aba, unidades)}
              emitindo={emitindo === aba}
              mostrarPredio={aba === "consolidado"}
              parcelas={visiveisPendentes}
              podeEmitir={Boolean(podeEmitir)}
              selecionadas={selecionadas}
              onSelecionadas={setSelecionadas}
            />
          ) : null}

          <Emitidos boletos={visiveisEmitidos} mostrarPredio={aba === "consolidado"} />

          {visiveisFora.length > 0 ? <ForaDaEmissao parcelas={visiveisFora} /> : null}
        </>
      )}
    </div>
  );
}

// ── CABEÇALHO ───────────────────────────────────────────────────────────────

function Cabecalho({
  aoAtualizar,
  carregando,
  competencia,
  onCompetencia,
}: {
  aoAtualizar: () => void;
  carregando: boolean;
  competencia: string;
  onCompetencia: (c: string) => void;
}) {
  return (
    <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12 }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <h1 style={{ color: T.text, fontSize: 20, fontWeight: 700, margin: 0 }}>
          Emissão de boletos
        </h1>
        <p style={{ color: T.sub, fontSize: 13, margin: "4px 0 0" }}>
          Competência de {rotuloDaCompetencia(competencia)}
        </p>
      </div>

      <select
        onChange={(e) => onCompetencia(e.target.value)}
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          color: T.text,
          fontSize: 14,
          padding: "8px 12px",
        }}
        value={competencia}
      >
        {competenciasSugeridas().map((c) => (
          <option key={c} value={c}>
            {rotuloDaCompetencia(c)}
          </option>
        ))}
      </select>

      <button
        disabled={carregando}
        onClick={aoAtualizar}
        style={{
          alignItems: "center",
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          color: T.text,
          cursor: carregando ? "default" : "pointer",
          display: "inline-flex",
          fontSize: 14,
          gap: 6,
          padding: "8px 12px",
        }}
        type="button"
      >
        {carregando ? <Loader2 className="inc-girando" size={15} /> : <RefreshCw size={15} />}
        Atualizar
      </button>
    </div>
  );
}

// ── A EMITIR ────────────────────────────────────────────────────────────────

function AEmitir({
  aoEmitir,
  emitindo,
  mostrarPredio,
  onSelecionadas,
  parcelas,
  podeEmitir,
  selecionadas,
}: {
  aoEmitir: (unidades: string[]) => void;
  emitindo: boolean;
  mostrarPredio: boolean;
  onSelecionadas: (s: Set<string>) => void;
  parcelas: ParcelaAEmitir[];
  podeEmitir: boolean;
  selecionadas: Set<string>;
}) {
  const total = parcelas.reduce((a, p) => a + (p.valor ?? 0), 0);
  const escolhidas = parcelas.filter((p) => selecionadas.has(p.unidade));
  const totalEscolhido = escolhidas.reduce((a, p) => a + (p.valor ?? 0), 0);
  const alvo = escolhidas.length > 0 ? escolhidas : parcelas;

  return (
    <section
      style={{
        background: T.card,
        border: `1px solid ${T.gold}`,
        borderRadius: 12,
        display: "grid",
        gap: 12,
        padding: 16,
      }}
    >
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10 }}>
        <strong style={{ color: T.text, fontSize: 15 }}>
          {parcelas.length} boleto(s) a emitir · {moeda(total)}
        </strong>

        {podeEmitir ? (
          <button
            disabled={emitindo}
            onClick={() => aoEmitir(escolhidas.map((p) => p.unidade))}
            style={{
              alignItems: "center",
              background: T.btnBg,
              border: "none",
              borderRadius: 8,
              color: T.btnFg,
              cursor: emitindo ? "default" : "pointer",
              display: "inline-flex",
              fontSize: 14,
              fontWeight: 600,
              gap: 6,
              marginLeft: "auto",
              padding: "9px 16px",
            }}
            type="button"
          >
            {emitindo ? <Loader2 className="inc-girando" size={15} /> : <Zap size={15} />}
            {emitindo
              ? "Emitindo…"
              : escolhidas.length > 0
                ? `Gerar ${escolhidas.length} boleto(s) · ${moeda(totalEscolhido)}`
                : `Gerar os ${parcelas.length} boletos`}
          </button>
        ) : (
          // ⚠️ NO CONSOLIDADO NÃO HÁ BOTÃO, e é de propósito: cada carteira tem a sua conta, e um
          // "emitir tudo" esconderia em qual CNPJ cada boleto está saindo. Abrir a aba do prédio é
          // o passo que faz o operador ver de quem é a conta antes de clicar.
          <span style={{ color: T.sub, fontSize: 13, marginLeft: "auto" }}>
            Abra a aba do empreendimento para emitir
          </span>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: 640, width: "100%" }}>
          <thead>
            <tr style={{ color: T.sub, textAlign: "left" }}>
              {podeEmitir ? <th style={{ padding: "6px 8px", width: 32 }} /> : null}
              <th style={cabecalho}>Cliente</th>
              {mostrarPredio ? <th style={cabecalho}>Prédio</th> : null}
              <th style={cabecalho}>Unidade</th>
              <th style={cabecalho}>CPF/CNPJ</th>
              <th style={{ ...cabecalho, textAlign: "right" }}>Valor</th>
              <th style={cabecalho}>Vencimento</th>
            </tr>
          </thead>
          <tbody>
            {parcelas.map((p) => (
              <tr key={`${p.empreendimento}|${p.unidade}`} style={{ borderTop: `1px solid ${T.border}` }}>
                {podeEmitir ? (
                  <td style={{ padding: "7px 8px" }}>
                    <input
                      aria-label={`Selecionar ${p.nome}`}
                      checked={selecionadas.has(p.unidade)}
                      onChange={(e) => {
                        const nova = new Set(selecionadas);
                        if (e.target.checked) nova.add(p.unidade);
                        else nova.delete(p.unidade);
                        onSelecionadas(nova);
                      }}
                      type="checkbox"
                    />
                  </td>
                ) : null}
                <td style={{ color: T.text, padding: "7px 8px" }}>
                  {p.nome}
                  {/* ⚠️ O nome da planilha aparece quando difere do cadastro: o boleto sai no CPF do
                      cadastro, e se o imóvel trocou de dono é aqui que se vê. */}
                  {p.nomeNaPlanilha !== p.nome ? (
                    <span style={{ color: T.sub, display: "block", fontSize: 12 }}>
                      na planilha: {p.nomeNaPlanilha}
                    </span>
                  ) : null}
                </td>
                {mostrarPredio ? (
                  <td style={{ color: T.sub, padding: "7px 8px", whiteSpace: "nowrap" }}>
                    {p.empreendimento}
                  </td>
                ) : null}
                <td style={{ color: T.sub, padding: "7px 8px" }}>{p.unidade}</td>
                <td style={{ color: T.sub, padding: "7px 8px", whiteSpace: "nowrap" }}>
                  {p.documento ?? "—"}
                </td>
                <td style={numero}>{p.valor === null ? "—" : moeda(p.valor)}</td>
                <td style={{ color: T.sub, padding: "7px 8px", whiteSpace: "nowrap" }}>
                  {p.vencimentoDia ? `dia ${p.vencimentoDia}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── EMITIDOS ────────────────────────────────────────────────────────────────

function Emitidos({
  boletos,
  mostrarPredio,
}: {
  boletos: BoletoEmitido[];
  mostrarPredio: boolean;
}) {
  if (boletos.length === 0) {
    return (
      <p
        style={{
          background: T.card,
          border: `1px dashed ${T.border}`,
          borderRadius: 12,
          color: T.sub,
          fontSize: 14,
          padding: 24,
          textAlign: "center",
        }}
      >
        Nenhum boleto emitido nesta competência.
      </p>
    );
  }

  return (
    // ⚠️ A ROLAGEM É DA TABELA, e não da página: com dez colunas no celular, deixar o corpo rolar de
    // lado empurra o menu do portal para fora da tela.
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: 900, width: "100%" }}>
        <thead>
          <tr style={{ color: T.sub, textAlign: "left" }}>
            <th style={cabecalho}>Cliente</th>
            {mostrarPredio ? <th style={cabecalho}>Prédio</th> : null}
            <th style={cabecalho}>Unidade</th>
            <th style={cabecalho}>CPF/CNPJ</th>
            <th style={{ ...cabecalho, textAlign: "right" }}>Valor</th>
            <th style={cabecalho}>Emissão</th>
            <th style={cabecalho}>Vencimento</th>
            <th style={cabecalho}>Pagamento</th>
            <th style={cabecalho}>Situação</th>
            <th style={cabecalho}>Boleto</th>
          </tr>
        </thead>
        <tbody>
          {boletos.map((b) => (
            <tr key={b.cobranca} style={{ borderTop: `1px solid ${T.border}` }}>
              <td style={{ color: T.text, padding: "8px 10px" }}>{b.nome}</td>
              {mostrarPredio ? (
                <td style={{ color: T.sub, padding: "8px 10px", whiteSpace: "nowrap" }}>
                  {b.empreendimento}
                </td>
              ) : null}
              <td style={{ color: T.sub, padding: "8px 10px" }}>{b.unidade}</td>
              <td style={{ color: T.sub, padding: "8px 10px", whiteSpace: "nowrap" }}>
                {b.documento ?? "—"}
              </td>
              <td style={numero}>{moeda(b.valor)}</td>
              <td style={celulaFraca}>{dia(b.emissao)}</td>
              <td style={celulaFraca}>{dia(b.vencimento)}</td>
              <td style={celulaFraca}>{dia(b.pagamento)}</td>
              <td style={{ padding: "8px 10px" }}>
                <Selo boleto={b} />
              </td>
              <td style={{ padding: "8px 10px" }}>
                {b.link ? (
                  <a
                    href={b.link}
                    rel="noreferrer"
                    style={{
                      alignItems: "center",
                      color: T.gold,
                      display: "inline-flex",
                      gap: 4,
                      textDecoration: "none",
                    }}
                    target="_blank"
                  >
                    Abrir <ExternalLink size={12} />
                  </a>
                ) : (
                  <span style={{ color: T.sub }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── QUEM NÃO RECEBE, E POR QUÊ ──────────────────────────────────────────────

function ForaDaEmissao({ parcelas }: { parcelas: ParcelaAEmitir[] }) {
  return (
    // ⚠️ UMA LISTA QUE SÓ MOSTRA QUEM EMITE ESCONDE O CLIENTE ESQUECIDO, e o esquecido só reclama no
    // mês seguinte. Fica recolhido para não competir com o que precisa de ação, mas fica.
    <details
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: "12px 16px",
      }}
    >
      <summary style={{ color: T.sub, cursor: "pointer", fontSize: 13.5 }}>
        {parcelas.length} unidade(s) não recebem boleto neste mês — ver o motivo de cada uma
      </summary>
      <ul style={{ display: "grid", gap: 4, listStyle: "none", margin: "10px 0 0", padding: 0 }}>
        {parcelas.map((p) => (
          <li
            key={`${p.empreendimento}|${p.unidade}`}
            style={{ color: T.sub, fontSize: 13, lineHeight: 1.5 }}
          >
            <span style={{ color: T.text }}>
              {p.nome} ({p.empreendimento} · {p.unidade})
            </span>{" "}
            — {p.bloqueio}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ── RESULTADO ───────────────────────────────────────────────────────────────

function ResultadoDaEmissao({ emissao }: { emissao: Emissao }) {
  const comLink = emissao.resultados.filter((r) => r.link);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Aviso tom={emissao.falhas > 0 ? "alerta" : "ok"}>
        {emissao.emitidos} boleto(s) emitido(s) em {emissao.empreendimento}, na conta {emissao.conta}
        {emissao.repetidos > 0 ? ` · ${emissao.repetidos} já existia(m)` : ""}
        {emissao.falhas > 0 ? ` · ${emissao.falhas} falhou(ram)` : ""}
      </Aviso>

      {emissao.resultados
        .filter((r) => r.erro)
        .map((r) => (
          <Aviso key={r.unidade} tom="erro">
            {r.nome} ({r.unidade}): {r.erro}
          </Aviso>
        ))}

      {comLink.length > 0 ? (
        <div
          style={{
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            display: "grid",
            gap: 5,
            padding: "10px 12px",
          }}
        >
          {comLink.map((r) => (
            <a
              href={r.link!}
              key={r.unidade}
              rel="noreferrer"
              style={{
                alignItems: "center",
                color: T.gold,
                display: "inline-flex",
                fontSize: 13.5,
                gap: 5,
                textDecoration: "none",
              }}
              target="_blank"
            >
              {r.nome} ({r.unidade}) · {moeda(r.valor)} <ExternalLink size={12} />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── ABAS ────────────────────────────────────────────────────────────────────

function Abas({
  aba,
  carteiras,
  contagem,
  onAba,
  totalEmitidos,
  totalPendentes,
}: {
  aba: string;
  carteiras: Carteira[];
  contagem: Map<string, { emitidos: number; pendentes: number }>;
  onAba: (a: string) => void;
  totalEmitidos: number;
  totalPendentes: number;
}) {
  const itens = [
    { chave: "consolidado", emitidos: totalEmitidos, pendentes: totalPendentes, rotulo: "Consolidado" },
    ...carteiras.map((c) => ({
      chave: c.slug,
      emitidos: contagem.get(c.slug)?.emitidos ?? 0,
      pendentes: contagem.get(c.slug)?.pendentes ?? 0,
      rotulo: c.nome,
    })),
  ];

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {itens.map((i) => {
        const ativa = aba === i.chave;
        return (
          <button
            key={i.chave}
            onClick={() => onAba(i.chave)}
            style={{
              alignItems: "center",
              background: ativa ? T.soft : "transparent",
              border: `1px solid ${ativa ? T.gold : T.border}`,
              borderRadius: 999,
              color: ativa ? T.text : T.sub,
              cursor: "pointer",
              display: "inline-flex",
              fontSize: 13,
              fontWeight: ativa ? 600 : 500,
              gap: 6,
              padding: "6px 14px",
            }}
            type="button"
          >
            {i.rotulo}
            {/* O número que pede ação vem primeiro e em destaque; o já resolvido fica discreto. */}
            {i.pendentes > 0 ? (
              <span
                style={{
                  background: T.gold,
                  borderRadius: 999,
                  color: T.btnFg,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 7px",
                }}
              >
                {i.pendentes}
              </span>
            ) : null}
            {i.emitidos > 0 ? (
              <span style={{ color: T.sub, fontSize: 12, fontWeight: 500 }}>
                {i.emitidos} emitido{i.emitidos > 1 ? "s" : ""}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ── PEÇAS ───────────────────────────────────────────────────────────────────

const cabecalho: React.CSSProperties = {
  borderBottom: `1px solid ${T.border}`,
  fontWeight: 600,
  padding: "8px 10px",
  whiteSpace: "nowrap",
};

const numero: React.CSSProperties = {
  color: T.text,
  fontVariantNumeric: "tabular-nums",
  padding: "8px 10px",
  textAlign: "right",
  whiteSpace: "nowrap",
};

const celulaFraca: React.CSSProperties = {
  color: T.sub,
  padding: "8px 10px",
  whiteSpace: "nowrap",
};

/**
 * O estado do boleto em uma palavra.
 *
 * ⚠️ PAGO VENCE VENCIDO. Quem pagou com atraso tem data de pagamento E venceu; mostrar "vencido"
 * para quem já quitou é o tipo de erro que gera ligação de cliente.
 */
function Selo({ boleto }: { boleto: BoletoEmitido }) {
  const [fundo, cor, texto] = boleto.pagamento
    ? [T.okBg, T.ok, "Pago"]
    : boleto.vencido
      ? [T.dangerBg, T.danger, "Vencido"]
      : [T.soft, T.sub, "Em aberto"];

  return (
    <span
      style={{
        background: fundo,
        borderRadius: 999,
        color: cor,
        display: "inline-block",
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {texto}
    </span>
  );
}

function Cartao({
  nota,
  rotulo,
  tom,
  valor,
}: {
  nota?: string;
  rotulo: string;
  tom?: "alerta" | "destaque";
  valor: string;
}) {
  const cor = tom === "alerta" ? T.danger : tom === "destaque" ? T.gold : T.border;

  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${cor}`,
        borderRadius: 10,
        flex: "1 1 150px",
        padding: "10px 14px",
      }}
    >
      <div
        style={{
          color: T.sub,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </div>
      <div
        style={{
          color: tom === "alerta" ? T.danger : T.text,
          fontSize: 18,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          marginTop: 2,
        }}
      >
        {valor}
      </div>
      {nota ? <div style={{ color: T.sub, fontSize: 12, marginTop: 1 }}>{nota}</div> : null}
    </div>
  );
}

function Aviso({ children, tom }: { children: React.ReactNode; tom: "alerta" | "erro" | "ok" }) {
  const cor = tom === "ok" ? T.ok : T.danger;
  const fundo = tom === "ok" ? T.okBg : T.dangerBg;

  return (
    <div
      style={{
        alignItems: "flex-start",
        background: fundo,
        border: `1px solid ${cor}`,
        borderRadius: 10,
        color: T.text,
        display: "flex",
        fontSize: 13.5,
        gap: 8,
        padding: "10px 12px",
      }}
    >
      {tom === "ok" ? (
        <Check size={16} style={{ color: cor, flexShrink: 0, marginTop: 1 }} />
      ) : (
        <AlertTriangle size={16} style={{ color: cor, flexShrink: 0, marginTop: 1 }} />
      )}
      <span>{children}</span>
    </div>
  );
}
