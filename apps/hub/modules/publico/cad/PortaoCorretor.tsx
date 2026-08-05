"use client";

import { Sparkles, X } from "lucide-react";

import { LogoEmpreendimento } from "@/modules/publico/logo-empreendimento";
import dynamicImport from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  cnpjValido,
  cpfValido,
  emailValido,
  nomeCompletoValido,
  progresso,
  proximoEstado,
  telefoneCompleto,
  type EmpreendimentoPublico,
  type EstadoCad,
} from "@/lib/publico/cad/regras";
import {
  BotaoPrimario,
  BotaoSecundario,
  Cabecalho,
  CampoCnpj,
  CampoCpf,
  CampoEmail,
  CampoTelefone,
  CampoTexto,
  Erro,
  Progresso,
} from "@/modules/publico/ui/campos";
import { CascaPublica } from "@/modules/publico/ui/casca";
import { C, GOLD } from "@/modules/publico/ui/tokens";

// PORTÃO do corretor: a antessala que VALIDA o corretor ANTES do formulário completo da CAD.
//
// É exatamente a "parte que valida o corretor" que o Lucas pediu para pôr na frente da CAD:
// CPF -> (se novo) CNPJ da imobiliária -> dados -> CRECI -> confirmar -> escolha do
// empreendimento. Passando, ele emite `onValidado(sessao, empreendimentoNome)` e o CadastroFlow
// COMPLETO (o mesmo do interno) assume — documento, foto pelo celular, OCR, ficha, revisão,
// envio —, já vinculado a corretor + imobiliária + empreendimento pelo TOKEN.
//
// ⚠️ NADA AQUI AUTORIZA NADA. A tela só desenha o que o servidor respondeu; o vínculo nasce do
// token assinado, no servidor, e o corpo que este componente manda é descartado.
//
// Este módulo foi extraído do antigo CadPublicoFlow (a máquina de estados da validação é
// preservada); a CAD simplificada que vinha depois foi descartada em favor do CadastroFlow.
const AssistenteCaca = dynamicImport(
  () => import("@/modules/publico/caca/AssistenteCaca").then((m) => m.AssistenteCaca),
  { ssr: false },
);

const CHAVE_SESSAO = "cad-publico-sessao";

export function PortaoCorretor({
  onValidado,
  whatsappCentral,
}: {
  // Disparado quando a validação termina e a sessão está COMPLETA (corretor + imobiliária +
  // empreendimento carimbado no token). `sessao` é o token; `empreendimentoNome` é só rótulo.
  onValidado: (sessao: string, empreendimentoNome: string) => void;
  whatsappCentral: string;
}) {
  const [estado, setEstado] = useState<EstadoCad>("identificar");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [chatAberto, setChatAberto] = useState(false);

  // Sessão em sessionStorage (não cookie): morre ao fechar a aba, o que importa num celular
  // emprestado, e não viaja sozinha (sem CSRF).
  const [sessao, setSessao] = useState("");
  const [preSessao, setPreSessao] = useState("");

  const [cpf, setCpf] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [corretor, setCorretor] = useState({ creci: "", email: "", nome: "", telefone: "" });
  const [buscandoCreci, setBuscandoCreci] = useState(false);
  const [creciLido, setCreciLido] = useState(false);
  // true = o nome veio da MOST e o campo fica travado; false = a busca não achou e ele digita.
  const [nomeLido, setNomeLido] = useState(false);
  const cpfCreciBuscado = useRef("");

  const [imobiliaria, setImobiliaria] = useState("");
  const [empreendimentos, setEmpreendimentos] = useState<EmpreendimentoPublico[]>([]);
  const [motivoCentral, setMotivoCentral] = useState("");

  useEffect(() => {
    const salva = window.sessionStorage.getItem(CHAVE_SESSAO);
    if (salva) setSessao(salva);
  }, []);

  useEffect(() => {
    if (sessao) window.sessionStorage.setItem(CHAVE_SESSAO, sessao);
  }, [sessao]);

  const avancar = useCallback((evento: Parameters<typeof proximoEstado>[1]) => {
    setErro("");
    setEstado((atual) => proximoEstado(atual, evento));
  }, []);

  // Cliente HTTP das rotas públicas. Toda chamada leva a sessão no HEADER, nunca em query
  // string: o token identifica uma pessoa e query string entra em log e Referer.
  const chamar = useCallback(
    async <T,>(
      caminho: string,
      opcoes: { corpo?: unknown; metodo?: "GET" | "POST"; pre?: string; token?: string } = {},
    ): Promise<T> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (opcoes.token) headers["x-cad-sessao"] = opcoes.token;
      if (opcoes.pre) headers["x-cad-pre-sessao"] = opcoes.pre;

      const resposta = await fetch(`/api/publico/cad/${caminho}`, {
        body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
        headers,
        method: opcoes.metodo ?? "POST",
      });
      const dados = (await resposta.json().catch(() => ({}))) as T & { error?: string };
      if (!resposta.ok) throw new Error(dados?.error || "Não conseguimos concluir agora.");
      return dados;
    },
    [],
  );

  // Depois de identificar/cadastrar: decide entre escolher o empreendimento e ENTRAR NA CAD.
  const seguirComSessao = useCallback(
    (
      dados: { empreendimentos?: EmpreendimentoPublico[]; imobiliaria?: string; sessao?: string },
      novo: boolean,
    ) => {
      const lista = dados.empreendimentos ?? [];
      setImobiliaria(dados.imobiliaria ?? "");
      setEmpreendimentos(lista);
      // Regra do Lucas: "se tiver somente uma seguir para o formulário". A sessão já vem com o
      // enterpriseId carimbado (sessao/corretor route), então entramos direto no CadastroFlow.
      if (lista.length === 1) {
        onValidado(dados.sessao ?? "", lista[0]?.name ?? "");
        return;
      }
      setSessao(dados.sessao ?? "");
      avancar(
        novo
          ? { empreendimentos: lista.length, tipo: "cadastrado" }
          : { empreendimentos: lista.length, tipo: "cpf-conhecido" },
      );
    },
    [avancar, onValidado],
  );

  // ---------------- S0 identificar ----------------
  const identificar = async () => {
    setCarregando(true);
    setErro("");
    try {
      const dados = await chamar<{
        empreendimentos?: EmpreendimentoPublico[];
        imobiliaria?: string;
        nome?: string;
        sessao?: string;
        status: string;
      }>("sessao", { corpo: { cpf } });

      if (dados.status === "novo") {
        avancar({ tipo: "cpf-novo" });
      } else if (dados.status === "conhecido") {
        seguirComSessao(dados, false);
      } else if (dados.status === "sem-empreendimento") {
        setMotivoCentral("sem-empreendimento");
        avancar({ tipo: "sem-empreendimento" });
      } else {
        setMotivoCentral("credenciamento");
        avancar({ tipo: "sem-empreendimento" });
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  // ---------------- S1 CNPJ ----------------
  const conferirCnpj = async () => {
    setCarregando(true);
    setErro("");
    try {
      const dados = await chamar<{ credenciada: boolean; nome?: string; preSessao?: string }>(
        "imobiliaria",
        { corpo: { cnpj } },
      );
      if (!dados.credenciada || !dados.preSessao) {
        setMotivoCentral("credenciamento");
        avancar({ tipo: "cnpj-recusado" });
        return;
      }
      setPreSessao(dados.preSessao);
      setImobiliaria(dados.nome ?? "");
      avancar({ tipo: "cnpj-ok" });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  // ---------------- S3 CRECI ----------------
  // Uma consulta por CPF, e SÓ depois do CNPJ ter passado: o CNPJ credenciado é a autorização
  // que paga a consulta (~R$ 1,60). O useRef é a mesma trava do wizard interno.
  useEffect(() => {
    // Dispara em "dados", NÃO em "creci": o nome precisa chegar a tempo de aparecer preenchido
    // na tela "Seus dados", que vem ANTES do passo do CRECI.
    if (estado !== "dados" || !preSessao) return;
    if (cpfCreciBuscado.current === cpf) return;
    cpfCreciBuscado.current = cpf;

    let vivo = true;
    setBuscandoCreci(true);
    chamar<{ creci: string; nome: string }>("creci", { corpo: { cpf }, pre: preSessao })
      .then((dados) => {
        if (!vivo) return;
        if (dados.nome) {
          setCorretor((atual) => ({ ...atual, nome: dados.nome }));
          setNomeLido(true);
        }
        if (dados.creci) {
          setCorretor((atual) => ({ ...atual, creci: dados.creci }));
          setCreciLido(true);
        }
      })
      // "Não encontrado" não é erro: o campo só fica editável e o corretor digita o dele.
      .catch(() => undefined)
      .finally(() => {
        if (vivo) setBuscandoCreci(false);
      });

    return () => {
      vivo = false;
    };
  }, [chamar, cpf, estado, preSessao]);

  // ---------------- S4 confirmar ----------------
  const cadastrar = async () => {
    setCarregando(true);
    setErro("");
    try {
      const dados = await chamar<{
        empreendimentos?: EmpreendimentoPublico[];
        imobiliaria?: string;
        sessao?: string;
        status: string;
      }>("corretor", {
        corpo: {
          cpf,
          creci: corretor.creci,
          email: corretor.email,
          nome: corretor.nome,
          telefone: corretor.telefone,
        },
        pre: preSessao,
      });

      if (dados.status === "sem-empreendimento") {
        setMotivoCentral("sem-empreendimento");
        avancar({ tipo: "sem-empreendimento" });
        return;
      }
      seguirComSessao(dados, true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  // ---------------- S5 empreendimento ----------------
  const escolherEmpreendimento = async (emp: EmpreendimentoPublico) => {
    setCarregando(true);
    setErro("");
    try {
      const dados = await chamar<{ sessao: string }>("empreendimentos", {
        corpo: { enterpriseId: emp.id },
        token: sessao,
      });
      // Sessão reemitida com o empreendimento carimbado: entra no CadastroFlow completo.
      onValidado(dados.sessao, emp.name);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  const passos = progresso(estado);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const topo = estado === "central" ? null : <Progresso passo={passos.passo} total={passos.total} />;

  const conteudo = () => {
    switch (estado) {
      case "identificar":
        return (
          <>
            <Cabecalho
              subtitulo="Informe o seu CPF para enviar uma CAD. Se ainda não tiver cadastro, a gente faz agora."
              titulo="Vamos começar"
            />
            {/* Trocar o CPF invalida o que foi lido do CPF anterior. */}
            <CampoCpf
              aoMudar={(v) => {
                setCpf(v);
                setNomeLido(false);
                setCreciLido(false);
              }}
              rotulo="Seu CPF"
              valor={cpf}
            />
            <Erro>{erro}</Erro>
          </>
        );

      case "cnpj":
        return (
          <>
            <Cabecalho
              subtitulo="Ainda não temos o seu cadastro por aqui. Vamos fazer agora, leva menos de um minuto: comece informando o CNPJ da sua imobiliária."
              titulo="Cadastro do corretor"
            />
            <CampoCnpj aoMudar={setCnpj} rotulo="CNPJ da imobiliária" valor={cnpj} />
            <Erro>{erro}</Erro>
          </>
        );

      case "dados":
        return (
          <>
            <Cabecalho subtitulo={`Continuar como parceiro da ${imobiliaria}.`} titulo="Seus dados" />
            <div style={{ display: "grid", gap: 16 }}>
              {/* Nome que veio da MOST é DADO DA BASE, não campo de digitação: fica travado. */}
              <CampoTexto
                aoMudar={(v) => setCorretor((a) => ({ ...a, nome: v }))}
                autoComplete="name"
                ajuda={nomeLido ? "Nome encontrado pelo seu CPF." : undefined}
                maiusculaInicial
                placeholder="Nome e sobrenome"
                rotulo="Nome completo"
                somenteLeitura={nomeLido}
                valor={corretor.nome}
              />
              <CampoEmail
                aoMudar={(v) => setCorretor((a) => ({ ...a, email: v }))}
                rotulo="E-mail"
                valor={corretor.email}
              />
              <CampoTelefone
                aoMudar={(v) => setCorretor((a) => ({ ...a, telefone: v }))}
                rotulo="Telefone"
                valor={corretor.telefone}
              />
            </div>
            <Erro>{erro}</Erro>
          </>
        );

      case "creci":
        return (
          <>
            <Cabecalho
              subtitulo={
                buscandoCreci
                  ? "Estamos buscando o seu CRECI pelo CPF."
                  : "Confirme o seu CRECI. Se preferir, pode deixar em branco e informar depois."
              }
              titulo="CRECI"
            />
            <CampoTexto
              ajuda={
                creciLido ? "Buscamos pelo seu CPF. Toque em Corrigir se estiver diferente." : undefined
              }
              aoMudar={(v) => setCorretor((a) => ({ ...a, creci: v }))}
              desabilitado={buscandoCreci}
              rotulo="CRECI"
              somenteLeitura={creciLido}
              placeholder={buscandoCreci ? "Buscando..." : "Ex.: MG 12345"}
              valor={corretor.creci}
            />
            {creciLido ? (
              <div style={{ marginTop: 12 }}>
                <BotaoSecundario onClick={() => setCreciLido(false)}>Corrigir</BotaoSecundario>
              </div>
            ) : null}
            <Erro>{erro}</Erro>
          </>
        );

      case "confirmar":
        return (
          <>
            <Cabecalho subtitulo="Confira antes de concluir." titulo="Tudo certo?" />
            <Revisao
              linhas={[
                { rotulo: "CPF", valor: cpf },
                { rotulo: "Nome", valor: corretor.nome },
                { rotulo: "E-mail", valor: corretor.email },
                { rotulo: "Telefone", valor: corretor.telefone },
                { rotulo: "CRECI", valor: corretor.creci || "Não informado" },
                { rotulo: "Imobiliária", valor: imobiliaria },
              ]}
            />
            <Erro>{erro}</Erro>
          </>
        );

      case "empreendimento":
        return (
          <>
            <Cabecalho
              subtitulo="Aparecem aqui os empreendimentos em que a sua imobiliária está habilitada a trabalhar."
              titulo="Em qual empreendimento você quer enviar esta CAD?"
            />
            <div style={{ display: "grid", gap: 12 }}>
              {empreendimentos.map((emp) => (
                <CardEmpreendimento
                  key={emp.id}
                  desabilitado={carregando}
                  empreendimento={emp}
                  onClick={() => escolherEmpreendimento(emp)}
                />
              ))}
            </div>
            <Erro>{erro}</Erro>
          </>
        );

      case "central":
        return (
          <div style={{ paddingTop: 16 }}>
            <Cabecalho
              subtitulo={
                motivoCentral === "sem-empreendimento"
                  ? "Sua imobiliária ainda não está habilitada em nenhum empreendimento aberto para envio. Fale com a nossa central para solicitar a habilitação: assim que sair, você já consegue enviar."
                  : "Não localizamos esse CNPJ entre as imobiliárias credenciadas. Isso costuma ser rápido de resolver: fale com a nossa central e a gente verifica o credenciamento da sua imobiliária para você seguir com o envio."
              }
              titulo="Vamos resolver por aqui"
            />
          </div>
        );

      default:
        return null;
    }
  };

  const rodape = () => {
    switch (estado) {
      case "identificar":
        return (
          <BotaoPrimario
            carregando={carregando}
            desabilitado={!cpfValido(cpf)}
            onClick={identificar}
            rotuloCarregando="Consultando..."
          >
            Continuar
          </BotaoPrimario>
        );

      case "cnpj":
        return (
          <BotaoPrimario
            carregando={carregando}
            desabilitado={!cnpjValido(cnpj)}
            onClick={conferirCnpj}
            rotuloCarregando="Conferindo..."
          >
            Continuar
          </BotaoPrimario>
        );

      case "dados":
        return (
          <BotaoPrimario
            desabilitado={
              !nomeCompletoValido(corretor.nome) ||
              !emailValido(corretor.email) ||
              !telefoneCompleto(corretor.telefone)
            }
            onClick={() => avancar({ tipo: "dados-ok" })}
          >
            Continuar
          </BotaoPrimario>
        );

      case "creci":
        // O botão fica ativo mesmo durante a busca: o corretor impaciente segue.
        return <BotaoPrimario onClick={() => avancar({ tipo: "creci-ok" })}>Continuar</BotaoPrimario>;

      case "confirmar":
        return (
          <BotaoPrimario carregando={carregando} onClick={cadastrar} rotuloCarregando="Cadastrando...">
            Concluir cadastro
          </BotaoPrimario>
        );

      case "central":
        return (
          <a
            href={whatsappCentral}
            rel="noreferrer"
            style={{
              alignItems: "center",
              background: C.text,
              borderRadius: 12,
              color: "#FFFFFF",
              display: "flex",
              fontSize: 16,
              fontWeight: 600,
              justifyContent: "center",
              minHeight: 52,
              textDecoration: "none",
              width: "100%",
            }}
            target="_blank"
          >
            Falar com a central
          </a>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <CascaPublica rodape={rodape()} topo={topo}>
        {conteudo()}
      </CascaPublica>

      {/* Botão flutuante da CACÁ. O chat só é baixado quando o corretor toca. */}
      <button
        aria-label="Falar com a assistente"
        onClick={() => setChatAberto((a) => !a)}
        style={{
          alignItems: "center",
          // Preto, não dourado: o destaque do Panteon é o preto (Lucas, 20/jul).
          background: C.text,
          border: "none",
          borderRadius: "50%",
          bottom: "calc(84px + env(safe-area-inset-bottom))",
          boxShadow: "0 6px 20px rgba(0,0,0,.18)",
          color: "#FFFFFF",
          cursor: "pointer",
          display: "flex",
          height: 56,
          justifyContent: "center",
          position: "fixed",
          right: 16,
          width: 56,
          zIndex: 20,
        }}
        type="button"
      >
        {chatAberto ? <X size={24} aria-hidden /> : <Sparkles size={24} aria-hidden />}
      </button>

      {chatAberto ? <AssistenteCaca onFechar={() => setChatAberto(false)} sessao={sessao} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function Revisao({ linhas }: { linhas: { rotulo: string; valor: string }[] }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 }}>
      {linhas.map((linha, i) => (
        <div
          key={linha.rotulo}
          style={{
            borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            minHeight: 48,
            padding: "12px 16px",
          }}
        >
          <span style={{ color: C.sub, fontSize: 14 }}>{linha.rotulo}</span>
          <span style={{ color: C.text, fontSize: 14, fontWeight: 600, textAlign: "right" }}>
            {linha.valor || "-"}
          </span>
        </div>
      ))}
    </div>
  );
}

// Um card POR LINHA. Grade de 2 colunas em 375px deixa a foto ilegível e o alvo pequeno.
function CardEmpreendimento({
  desabilitado,
  empreendimento,
  onClick,
}: {
  desabilitado: boolean;
  empreendimento: EmpreendimentoPublico;
  onClick: () => void;
}) {
  return (
    <button
      disabled={desabilitado}
      onClick={onClick}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        cursor: desabilitado ? "default" : "pointer",
        display: "block",
        overflow: "hidden",
        padding: 0,
        textAlign: "left",
        width: "100%",
      }}
      type="button"
    >
      <div
        style={{
          alignItems: "center",
          background: C.soft,
          display: "flex",
          height: 108,
          justifyContent: "center",
          overflow: "hidden",
          padding: 10,
        }}
      >
        <LogoEmpreendimento
          altura={88}
          code={empreendimento.code}
          largura={200}
          logoUrl={empreendimento.logoUrl}
          name={empreendimento.name}
        />
      </div>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ color: C.text, fontSize: 16, fontWeight: 600 }}>{empreendimento.name}</div>
      </div>
    </button>
  );
}
