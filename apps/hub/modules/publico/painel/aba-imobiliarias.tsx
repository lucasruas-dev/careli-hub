"use client";

import { useMemo, useState } from "react";

import type { ImobiliariaDoPainel } from "@/lib/apolo/painel-coordenador";

import {
  C,
  GradeKpis,
  Kpi,
  Selo,
  Tabela,
  TituloSecao,
  celula,
  dataCurta,
  inputEstilo,
  useOrdenacao,
} from "./ui";

// ABA IMOBILIÁRIAS — quem está trabalhando o empreendimento.
//
// A pergunta que ela responde é a do coordenador, não a do cadastro: das imobiliárias que se
// credenciaram aqui, quantas ESTÃO PRODUZINDO? Por isso a coluna que ordena é CADs, e as que
// estão com zero aparecem juntas no fim — credenciamento sem CAD é contato para fazer, não
// número para comemorar.

function normaliza(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function AbaImobiliarias({
  imobiliarias,
}: {
  imobiliarias: ImobiliariaDoPainel[];
}) {
  const [busca, setBusca] = useState<string>("");
  const [filtro, setFiltro] = useState<string>("todas");

  const base = useMemo(
    () =>
      imobiliarias.filter(
        (imobiliaria) =>
          busca === "" || normaliza(imobiliaria.nome).includes(normaliza(busca)),
      ),
    [imobiliarias, busca],
  );

  const emValidacao = base.filter((i) => i.status === "validacao");
  const produzindo = base.filter((i) => i.cads > 0);
  const paradas = base.filter((i) => i.cads === 0 && i.status !== "validacao");
  const corretores = base.reduce((total, i) => total + i.corretores, 0);

  const mostradas = useMemo(() => {
    if (filtro === "validacao") return emValidacao;
    if (filtro === "produzindo") return produzindo;
    if (filtro === "paradas") return paradas;
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, filtro]);

  // Ordenação padrão: quem mais produziu primeiro. É a leitura que o coordenador faz sozinho ao
  // abrir a aba; as outras colunas ficam a um clique.
  const { alternar, itens, ordem } = useOrdenacao<ImobiliariaDoPainel>(
    mostradas,
    {
      cads: (i) => i.cads,
      corretores: (i) => i.corretores,
      entrada: (i) => i.cadastradaEm ?? "",
      nome: (i) => i.nome,
      situacao: (i) => i.status,
    },
    { campo: "cads", desc: true },
  );

  return (
    <>
      <GradeKpis>
        <Kpi
          ativo={filtro === "todas"}
          label="Credenciadas"
          onClick={() => setFiltro("todas")}
          sub="no empreendimento"
          tom="ciano"
          valor={base.length}
        />
        <Kpi
          ativo={filtro === "produzindo"}
          label="Com CAD"
          onClick={() => setFiltro(filtro === "produzindo" ? "todas" : "produzindo")}
          sub={`${base.length ? Math.round((produzindo.length / base.length) * 100) : 0}% das credenciadas`}
          tom="verde"
          valor={produzindo.length}
        />
        <Kpi
          ativo={filtro === "paradas"}
          label="Sem CAD ainda"
          onClick={() => setFiltro(filtro === "paradas" ? "todas" : "paradas")}
          sub="credenciou e não enviou"
          tom="laranja"
          valor={paradas.length}
        />
        <Kpi
          ativo={filtro === "validacao"}
          label="Em validação"
          onClick={() => setFiltro(filtro === "validacao" ? "todas" : "validacao")}
          sub="aguardando análise"
          tom="ambar"
          valor={emValidacao.length}
        />
        <Kpi label="Corretores" sub="cadastrados nas imobiliárias" tom="roxo" valor={corretores} />
      </GradeKpis>

      <div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
        <input
          aria-label="Buscar imobiliária"
          onChange={(evento) => setBusca(evento.target.value)}
          placeholder="Buscar imobiliária pelo nome"
          style={{ ...inputEstilo, flex: 1, minWidth: 180 }}
          value={busca}
        />
      </div>

      <TituloSecao
        contagem={`${itens.length} de ${imobiliarias.length}`}
        titulo="Imobiliárias"
      />

      <Tabela
        colunas={[
          { campo: "nome", chave: "Imobiliária", largura: "32%" },
          { chave: "CNPJ", largura: 150 },
          { campo: "corretores", chave: "Corretores", largura: 110 },
          { campo: "cads", chave: "CADs", largura: 86 },
          { campo: "entrada", chave: "Entrada", largura: 100 },
          { campo: "situacao", chave: "Situação", largura: 126 },
        ]}
        onOrdenar={alternar}
        ordem={ordem}
        vazio="Nenhuma imobiliária credenciada neste empreendimento ainda."
      >
        {itens.map((imobiliaria, indice) => (
          <tr key={`${imobiliaria.nome}-${indice}`}>
            <td style={celula(C.text)}>{imobiliaria.nome}</td>
            <td style={celula(C.sub)}>{imobiliaria.documento ?? "—"}</td>
            <td style={celula(C.sub)}>{imobiliaria.corretores || "—"}</td>
            <td
              style={celula(imobiliaria.cads > 0 ? C.text : C.muted, {
                fontVariantNumeric: "tabular-nums",
                fontWeight: imobiliaria.cads > 0 ? 600 : 400,
              })}
            >
              {imobiliaria.cads || "—"}
            </td>
            <td style={celula(C.sub)}>{dataCurta(imobiliaria.cadastradaEm)}</td>
            <td style={celula(C.text, { overflow: "visible" })}>
              {imobiliaria.status === "validacao" ? (
                <Selo tom="ambar">Em validação</Selo>
              ) : (
                <Selo tom="ciano">Credenciada</Selo>
              )}
            </td>
          </tr>
        ))}
      </Tabela>
    </>
  );
}
