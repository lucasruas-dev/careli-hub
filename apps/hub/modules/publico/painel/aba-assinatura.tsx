"use client";

import { useMemo, useState } from "react";

import type { PainelAssinatura } from "@/lib/apolo/painel-assinatura";
import { agruparUnidadesComCompradorAssinado } from "@/lib/apolo/unidades-assinatura";

import {
  C,
  GOLD,
  Selo,
  Tabela,
  TituloSecao,
  celula,
  dataCurta,
  inputEstilo,
  numeroBR,
  useOrdenacao,
} from "./ui";
import { UnidadesComBarra } from "./unidades-com-barra";

// ABA ASSINATURA — a MESMA tela do painel interno (`/apolo/assinaturas`), aberta ao coordenador.
//
// Pedido do Lucas (14/08): "nas assinaturas podemos trazer o cenário que criamos ontem, a mesma
// tela para ele também". Portei a estrutura inteira: os cinco filtros, os três blocos (Comprador,
// Geral, Prazo), a fila degrau a degrau, o quadro do incorporador e da Careli, a lista de
// unidades com o comprador assinado e a tabela de assinaturas.
//
// O que MUDOU e por quê:
//   • o desenho usa a paleta desta tela pública (fundo claro, dourado da marca) em vez das classes
//     do chrome do HUB (`bg-canvas`, `text-ink`), que seguem o tema do hub e viriam escuras aqui;
//   • os dados chegam por PROP, do servidor. O painel interno busca sozinho a cada 60s com o token
//     do Apolo — aqui não há login, e o servidor já cacheia 5 minutos;
//   • o filtro de empreendimento não é mais VOC/VOL fixo: sai dos próprios dados, porque este
//     painel roda em qualquer empreendimento (no Vale do Ouro ele lista as duas glebas).
//
// As REGRAS de negócio (perfil, prazo de 7 dias do comprador, "unidades ignoram o filtro de
// perfil") são as mesmas e vivem no servidor, em lib/apolo/painel-assinatura.ts.

type Linha = PainelAssinatura["linhas"][number];

// ORDEM DE ASSINATURA. Na tela é "ordem" (palavra do Lucas, 14/08); no código o campo continua
// `degrau` porque é o nome do tipo compartilhado com o painel interno. Vem de
// `contract_signature_signers.after_position` (D4Sign): quem está na ordem 2 só é chamado depois
// que TODOS da ordem 1 assinarem, então um parado trava a fila inteira atrás dele.
//
// Os nomes abaixo são os MESMOS do painel interno — decisão do Lucas: "é para manter igual,
// somente alterar de degrau para ordem". Ficam como estão de propósito, e não derivados dos
// dados. (Levantamento de 14/08, para quando isso for revisto: no Vale do Ouro a ordem 3 é do
// Incorporador e não das testemunhas, a 7 é da Coordenadora de venda e a 8 do Corretor.)
const NOME_ORDEM: Record<number, string> = {
  1: "Corretor / imobiliária",
  2: "Comprador e cônjuge",
  3: "Testemunhas",
  4: "Vendedor",
  5: "Sócios e testemunha",
  6: "Anuentes",
  7: "Careli",
  8: "Careli",
};

const semAcento = (valor: string) =>
  valor.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

const pct = (parte: number, todo: number) => (todo ? `${Math.round((100 * parte) / todo)}%` : "—");

export function AbaAssinatura({ dados }: { dados: PainelAssinatura }) {
  const linhas = dados.linhas;

  const [emp, setEmp] = useState("");
  const [perfil, setPerfil] = useState("");
  const [status, setStatus] = useState("");
  const [unidade, setUnidade] = useState("");
  const [usuario, setUsuario] = useState("");

  const empreendimentos = useMemo(
    () => [...new Set(linhas.map((l) => l.emp).filter(Boolean))].sort(),
    [linhas],
  );

  const perfis = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const l of linhas) contagem.set(l.perfil, (contagem.get(l.perfil) ?? 0) + 1);
    return [...contagem.keys()].sort((a, b) => (contagem.get(b) ?? 0) - (contagem.get(a) ?? 0));
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
        if (fu && !semAcento(l.un).includes(fu)) return false;
        if (fn && !semAcento(l.usuario).includes(fn)) return false;
        return true;
      }),
    [linhas, emp, perfil, status, fu, fn],
  );

  // ⚠️ Os números de UNIDADE ignoram os filtros de perfil e status de propósito: filtrar por
  // perfil dentro deles esconderia justamente a assinatura que falta. É o REMOVEFILTERS(Perfil)
  // do modelo original do Power BI, e foi mantido no porte.
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
            (soma, l) =>
              soma +
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
      diasEnvio: envios.size ? [...envios.values()].reduce((a, b) => a + b, 0) / envios.size : 0,
      finalizadas: unidades.filter((ls) => ls.every((x) => x.assinou)).length,
      porUn,
      total: unidades.length,
    };
  }, [linhas, emp, fu]);

  const fila = useMemo(() => {
    const mapa = new Map<number, { ok: number; t: number }>();
    for (const l of filtradas) {
      if (!l.degrau) continue;
      const atual = mapa.get(l.degrau) ?? { ok: 0, t: 0 };
      atual.t += 1;
      if (l.assinou) atual.ok += 1;
      mapa.set(l.degrau, atual);
    }
    return [...mapa.entries()].sort((a, b) => a[0] - b[0]);
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
    const mapa = new Map<
      string,
      { email: string; falta: number; nome: string; ok: number; perfil: string }
    >();
    for (const l of base) {
      // O e-mail entra na chave: a mesma razão social assina por três sócios, e juntá-los
      // esconderia que dois assinaram e um não.
      const chave = `${l.usuario}|${l.email}`;
      const atual = mapa.get(chave) ?? {
        email: l.email,
        falta: 0,
        nome: l.usuario,
        ok: 0,
        perfil: l.perfil,
      };
      if (l.assinou) atual.ok += 1;
      else atual.falta += 1;
      mapa.set(chave, atual);
    }
    return [...mapa.values()].sort((a, b) => b.falta - a.falta || b.ok - a.ok);
  }, [linhas, emp, fu]);

  // Quem também assina todo contrato mas com outro perfil no C2X. Sem isso, some sem rastro.
  const fixosDeFora = useMemo(() => {
    const base = linhas.filter((l) => !emp || l.emp === emp);
    const unidades = new Set(base.map((l) => l.un)).size;
    const mapa = new Map<string, { n: number; nome: string; perfil: string }>();
    for (const l of base) {
      if (l.perfil === "Incorporador" || l.perfil === "Backoffice") continue;
      const chave = `${l.usuario}|${l.perfil}`;
      const atual = mapa.get(chave) ?? { n: 0, nome: l.usuario, perfil: l.perfil };
      atual.n += 1;
      mapa.set(chave, atual);
    }
    return [...mapa.values()].filter((o) => o.n >= unidades * 0.9);
  }, [linhas, emp]);

  // ⚠️ O CÁLCULO VIVE EM lib/apolo/unidades-assinatura.ts, junto com o painel interno: as duas
  // telas mostram a MESMA lista para as MESMAS pessoas, e divergirem seria um bug invisível.
  const comCompradorOk = useMemo(
    () => agruparUnidadesComCompradorAssinado(resumo.porUn),
    [resumo.porUn],
  );

  const unidadesOrdenadas = useOrdenacao(
    comCompradorOk,
    {
      assinou: (p) => p.ultima ?? "",
      comprador: (p) => p.nomes,
      dias: (p) => p.dias ?? 0,
      // Quanto do contrato ja saiu: e a pergunta que a barra responde, entao da para ordenar por ela.
      progresso: (p) => (p.total > 0 ? p.assinadas / p.total : 0),
      unidade: (p) => p.un,
    },
    { campo: "assinou", desc: true },
  );

  const assinaturas = useOrdenacao(
    filtradas,
    {
      degrau: (l) => l.degrau,
      envio: (l) => l.envio,
      perfil: (l) => l.perfil,
      // Pendente primeiro (é o que exige ação), depois o mais antigo.
      status: (l) => (l.assinou ? 1 : l.prazo === "Pendente e em atraso" ? -1 : 0),
      unidade: (l) => l.un,
      usuario: (l) => l.usuario,
    },
    { campo: "status", desc: false },
  );

  const carimbo = new Date(dados.atualizadoEm).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const filtrando = Boolean(emp || perfil || status || unidade || usuario);
  const rotulo: React.CSSProperties = {
    color: C.muted,
    display: "block",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.1em",
    marginBottom: 4,
    textTransform: "uppercase",
  };

  return (
    <>
      <div
        style={{
          alignItems: "flex-end",
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 20,
        }}
      >
        {empreendimentos.length > 1 ? (
          <label>
            <span style={rotulo}>Gleba</span>
            <select
              onChange={(evento) => setEmp(evento.target.value)}
              style={{ ...inputEstilo, minWidth: 110 }}
              value={emp}
            >
              <option value="">Todas</option>
              {empreendimentos.map((codigo) => (
                <option key={codigo} value={codigo}>
                  {codigo}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          <span style={rotulo}>Perfil</span>
          <select
            onChange={(evento) => setPerfil(evento.target.value)}
            style={{ ...inputEstilo, minWidth: 150 }}
            value={perfil}
          >
            <option value="">Todos</option>
            {perfis.map((nome) => (
              <option key={nome} value={nome}>
                {nome}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={rotulo}>Status</span>
          <select
            onChange={(evento) => setStatus(evento.target.value)}
            style={{ ...inputEstilo, minWidth: 170 }}
            value={status}
          >
            <option value="">Todos</option>
            <option value="sim">Assinado</option>
            <option value="nao">Pendente</option>
            <option value="atraso">Pendente e em atraso</option>
          </select>
        </label>
        <label>
          <span style={rotulo}>Unidade</span>
          <input
            onChange={(evento) => setUnidade(evento.target.value)}
            placeholder="ex.: VOC0104"
            style={{ ...inputEstilo, width: 150 }}
            type="search"
            value={unidade}
          />
        </label>
        <label>
          <span style={rotulo}>Usuário</span>
          <input
            onChange={(evento) => setUsuario(evento.target.value)}
            placeholder="quem assina"
            style={{ ...inputEstilo, width: 180 }}
            type="search"
            value={usuario}
          />
        </label>
        {filtrando ? (
          <button
            onClick={() => {
              setEmp("");
              setPerfil("");
              setStatus("");
              setUnidade("");
              setUsuario("");
            }}
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              color: C.sub,
              cursor: "pointer",
              fontSize: 13,
              height: 38,
              padding: "0 14px",
            }}
            type="button"
          >
            Limpar
          </button>
        ) : null}
        <span style={{ color: C.muted, fontSize: 12, marginLeft: "auto" }}>
          atualizado às {carimbo}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          marginBottom: 20,
        }}
      >
        <Bloco titulo="Comprador">
          <Numero cor="#0F9D58" k="Unidades assinadas" v={numeroBR(resumo.compradorOk)} />
          <Numero k="Unidades pendentes" v={numeroBR(resumo.compradorPendente)} />
          <Numero cor={GOLD} k="Do total" v={pct(resumo.compradorOk, resumo.total)} />
        </Bloco>
        <Bloco titulo="Geral">
          <Numero k="Total de unidades" v={numeroBR(resumo.total)} />
          <Numero cor="#0F9D58" k="Unidades finalizadas" v={numeroBR(resumo.finalizadas)} />
          <Numero cor={GOLD} k="Do total" v={pct(resumo.finalizadas, resumo.total)} />
        </Bloco>
        <Bloco titulo="Prazo do comprador · 7 dias">
          <Numero cor="#A32D2D" k="Em atraso" v={numeroBR(resumo.atrasados)} />
          <Numero k="Dias até assinar" v={resumo.diasAssinar.toFixed(1).replace(".", ",")} />
          <Numero k="Dias desde o envio" v={resumo.diasEnvio.toFixed(1).replace(".", ",")} />
        </Bloco>
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          marginBottom: 24,
        }}
      >
        <Cartao titulo="A fila, por ordem de assinatura">
          {fila.length === 0 ? (
            <p style={{ color: C.muted, fontSize: 13.5, margin: 0 }}>Nada neste recorte.</p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {fila.map(([degrau, valores]) => (
                <div
                  key={degrau}
                  style={{
                    alignItems: "center",
                    display: "grid",
                    gap: 10,
                    gridTemplateColumns: "118px 1fr 44px",
                  }}
                >
                  <span style={{ color: C.text, fontSize: 12 }}>
                    {degrau}. {NOME_ORDEM[degrau] ?? `Ordem ${degrau}`}
                    <span style={{ color: C.muted, display: "block", fontSize: 11 }}>
                      {valores.ok} de {valores.t}
                    </span>
                  </span>
                  <span
                    style={{
                      background: C.soft,
                      borderRadius: 4,
                      display: "block",
                      height: 16,
                      overflow: "hidden",
                    }}
                  >
                    <i
                      style={{
                        background: "#0F9D58",
                        display: "block",
                        height: "100%",
                        width: `${Math.round((100 * valores.ok) / valores.t)}%`,
                      }}
                    />
                  </span>
                  <span
                    style={{
                      color: C.sub,
                      fontSize: 12,
                      fontVariantNumeric: "tabular-nums",
                      textAlign: "right",
                    }}
                  >
                    {Math.round((100 * valores.ok) / valores.t)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Cartao>

        <Cartao titulo="Quadro de assinaturas · incorporador e Careli">
          <div style={{ maxHeight: 280, overflow: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
              <thead>
                <tr>
                  {["Usuário", "Perfil", "Assinado", "Assinar"].map((titulo, indice) => (
                    <th
                      key={titulo}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        color: C.muted,
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: "0.07em",
                        padding: "6px 8px",
                        textAlign: indice >= 2 ? "right" : "left",
                        textTransform: "uppercase",
                      }}
                    >
                      {titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {quadro.map((item) => (
                  <tr key={`${item.nome}-${item.email}`}>
                    <td style={{ color: C.text, padding: "6px 8px" }}>
                      {item.nome}
                      <span style={{ color: C.muted, display: "block", fontSize: 11 }}>
                        {item.email}
                      </span>
                    </td>
                    <td style={{ color: C.sub, padding: "6px 8px" }}>{item.perfil}</td>
                    <td
                      style={{
                        color: C.text,
                        fontVariantNumeric: "tabular-nums",
                        padding: "6px 8px",
                        textAlign: "right",
                      }}
                    >
                      {numeroBR(item.ok)}
                    </td>
                    <td
                      style={{
                        color: item.falta > 0 ? "#A32D2D" : C.text,
                        fontVariantNumeric: "tabular-nums",
                        padding: "6px 8px",
                        textAlign: "right",
                      }}
                    >
                      {numeroBR(item.falta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fixosDeFora.length ? (
            <p style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.4, margin: "12px 0 0" }}>
              Também assinam todos os contratos, com outro perfil no C2X:{" "}
              {fixosDeFora.map((o) => `${o.nome} (${o.perfil})`).join(", ")}.
            </p>
          ) : null}
        </Cartao>
      </div>

      <TituloSecao
        contagem={`${unidadesOrdenadas.itens.length} unidades · ${
          comCompradorOk.filter((p) => p.esperando.length).length
        } aguardam outra assinatura`}
        titulo="Unidades com o comprador assinado"
      />
      <OrdenarPor
        atual={unidadesOrdenadas.ordem}
        aoTrocar={unidadesOrdenadas.alternar}
        opcoes={[
          { campo: "assinou", rotulo: "Assinou em" },
          { campo: "progresso", rotulo: "Progresso" },
          { campo: "dias", rotulo: "Dias" },
          { campo: "unidade", rotulo: "Unidade" },
        ]}
      />
      <div style={{ marginBottom: 24 }}>
        <UnidadesComBarra unidades={unidadesOrdenadas.itens} />
      </div>

      <TituloSecao
        contagem={`${numeroBR(assinaturas.itens.length)} no recorte${
          assinaturas.itens.length > 400 ? " · mostrando as 400 primeiras" : ""
        }`}
        titulo="Assinaturas"
      />
      <Tabela
        colunas={[
          { campo: "unidade", chave: "Unidade", largura: 110 },
          { campo: "envio", chave: "Envio", largura: 92 },
          { campo: "usuario", chave: "Usuário", largura: "26%" },
          { campo: "perfil", chave: "Perfil", largura: 140 },
          { campo: "degrau", chave: "Ordem", largura: 86 },
          { campo: "status", chave: "Status", largura: 130 },
          { chave: "Assinatura", largura: 110 },
        ]}
        onOrdenar={assinaturas.alternar}
        ordem={assinaturas.ordem}
        vazio="Nenhuma assinatura com esses filtros."
      >
        {assinaturas.itens.slice(0, 400).map((l, indice) => {
          const atrasado = l.prazo === "Pendente e em atraso";
          return (
            <tr key={`${l.contrato}-${l.usuario}-${l.degrau}-${indice}`}>
              <td style={celula(C.text, { fontVariantNumeric: "tabular-nums", fontWeight: 600 })}>
                {l.un}
              </td>
              <td style={celula(C.sub)}>{dataCurta(l.envio)}</td>
              <td style={celula(C.text)}>{l.usuario}</td>
              <td style={celula(C.sub)}>{l.perfil}</td>
              <td style={celula(C.sub, { fontVariantNumeric: "tabular-nums" })}>
                {l.degrau || "—"}
              </td>
              <td style={celula(C.text, { overflow: "visible" })}>
                <Selo tom={l.assinou ? "verde" : atrasado ? "vermelho" : "cinza"}>
                  {l.assinou ? "Assinado" : atrasado ? "Em atraso" : "Pendente"}
                </Selo>
              </td>
              <td style={celula(C.sub)}>{dataCurta(l.assinadoEm)}</td>
            </tr>
          );
        })}
      </Tabela>
    </>
  );
}

/**
 * OS CONTROLES DE ORDENACAO que a tabela tinha nos cabecalhos.
 *
 * ⚠️ TROCAR O DESENHO NAO PODE TIRAR FUNCAO. As setas nas colunas sumiram junto com a tabela; sem
 * repor isso, quem ordenava por "Dias" para achar o contrato mais parado perderia o caminho.
 */
function OrdenarPor({
  aoTrocar,
  atual,
  opcoes,
}: {
  aoTrocar: (campo: string) => void;
  atual: { campo: string; desc: boolean };
  opcoes: { campo: string; rotulo: string }[];
}) {
  return (
    <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
      <span style={{ color: C.muted, fontSize: 11.5 }}>Ordenar por</span>
      {opcoes.map((opcao) => {
        const ativo = atual.campo === opcao.campo;
        return (
          <button
            key={opcao.campo}
            onClick={() => aoTrocar(opcao.campo)}
            style={{
              background: ativo ? GOLD : "transparent",
              border: `1px solid ${ativo ? GOLD : C.border}`,
              borderRadius: 999,
              color: ativo ? "#FFFFFF" : C.sub,
              cursor: "pointer",
              fontSize: 11.5,
              fontWeight: ativo ? 600 : 400,
              padding: "3px 10px",
            }}
            type="button"
          >
            {opcao.rotulo}
            {ativo ? <span aria-hidden="true"> {atual.desc ? "↓" : "↑"}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Bloco({ children, titulo }: { children: React.ReactNode; titulo: string }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <h2
        style={{
          background: `${GOLD}14`,
          borderBottom: `1px solid ${C.border}`,
          color: GOLD,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.13em",
          margin: 0,
          padding: "8px 16px",
          textTransform: "uppercase",
        }}
      >
        {titulo}
      </h2>
      <div style={{ display: "flex", gap: 8, padding: "16px" }}>{children}</div>
    </div>
  );
}

function Numero({ cor, k, v }: { cor?: string; k: string; v: string }) {
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <span
        style={{
          color: cor ?? C.text,
          display: "block",
          fontSize: 28,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {v}
      </span>
      <span
        style={{
          color: C.sub,
          display: "block",
          fontSize: 11.5,
          lineHeight: 1.3,
          marginTop: 6,
        }}
      >
        {k}
      </span>
    </div>
  );
}

function Cartao({ children, titulo }: { children: React.ReactNode; titulo: string }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 16,
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px" }}>{titulo}</h3>
      {children}
    </div>
  );
}
