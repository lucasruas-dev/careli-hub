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
  // Leva TAMBEM imobiliaria e corretor: o wizard nao tem rota publica para resolver esses nomes
  // (a lista de imobiliarias so' existe no modo interno), entao sem isso a revisao mostrava o
  // vinculo em branco, como se a CAD nao tivesse imobiliaria nem corretor.
  onValidado: (
    sessao: string,
    empreendimentoNome: string,
    vinculo: { corretorNome: string; imobiliariaNome: string },
  ) => void;
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
      if (!resposta.ok) {
        throw new Error(
          dados?.error || "Não conseguimos concluir agora. Tente de novo em alguns instantes.",
        );
      }
      return dados;
    },
    [],
  );

  // Depois de identificar/cadastrar: decide entre escolher o empreendimento e ENTRAR NA CAD.
  const seguirComSessao = useCallback(
    (
      dados: {
        empreendimentos?: EmpreendimentoPublico[];
        imobiliaria?: string;
        // Vem preenchido quando o CPF já era conhecido; no corretor recém-cadastrado o nome está
        // no estado do formulário, por isso o fallback abaixo.
        nome?: string;
        sessao?: string;
      },
      novo: boolean,
    ) => {
      const lista = dados.empreendimentos ?? [];
      setImobiliaria(dados.imobiliaria ?? "");
      setEmpreendimentos(lista);
      // ⚠️ A ETAPA APARECE SEMPRE, INCLUSIVE COM UM ÚNICO EMPREENDIMENTO.
      //
      // Até 22/08 havia um atalho aqui ("se tiver somente uma, seguir para o formulário"), e ele
      // causou o estrago que motivou esta mudança: um corretor digitou o CPF, caiu direto na CAD
      // e mandou o cliente para o Vale do Ouro — único produto habilitado para a imobiliária
      // dele — quando queria a Aldeia da Cachoeira. Ele nunca viu para onde a CAD foi, porque a
      // tela que dizia isso era justamente a que o atalho pulava.
      //
      // O corretor não tem como saber, de cabeça, o que a imobiliária dele está habilitada a
      // vender. Um clique a mais é barato; CAD no empreendimento errado custa retrabalho de
      // validação, crédito consultado à toa e um cliente cadastrado no lugar errado.
      setSessao(dados.sessao ?? "");
      avancar(
        novo
          ? { empreendimentos: lista.length, tipo: "cadastrado" }
          : { empreendimentos: lista.length, tipo: "cpf-conhecido" },
      );
    },
    [avancar, corretor.nome, onValidado],
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
      onValidado(dados.sessao, emp.name, {
        corretorNome: corretor.nome,
        imobiliariaNome: imobiliaria,
      });
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

  // Duas partes, dois contadores: aqui é o cadastro DO CORRETOR; o formulário do cliente vem
  // depois, com a contagem própria dele. Sem esta legenda a barra reinicia e parece erro.
  const topo =
    estado === "central" ? null : (
      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ color: C.muted, fontSize: 12, fontWeight: 600 }}>
          Parte 1 de 2: seus dados de corretor
        </span>
        <Progresso passo={passos.passo} total={passos.total} />
      </div>
    );

  const conteudo = () => {
    switch (estado) {
      case "identificar":
        return (
          <>
            <Cabecalho
              subtitulo="Corretor, informe o seu CPF para começar a CAD. Os dados do cliente entram nas próximas telas. Se você ainda não tem cadastro por aqui, a gente faz agora."
              titulo="Vamos começar por você"
            />
            {/* Trocar o CPF invalida o que foi lido do CPF anterior. */}
            <CampoCpf
              ajuda="Este CPF é o seu, de corretor. O CPF do cliente é pedido mais à frente."
              aoMudar={(v) => {
                setCpf(v);
                setNomeLido(false);
                setCreciLido(false);
              }}
              rotulo="Seu CPF (não o do cliente)"
              valor={cpf}
            />
            <Erro>{erro}</Erro>
            <ChecklistInicio />
            <AjudaCaca />
          </>
        );

      case "cnpj":
        return (
          <>
            <Cabecalho
              subtitulo="Não encontramos o seu CPF por aqui, então vamos criar o seu cadastro agora. Comece pelo CNPJ da imobiliária em que você trabalha: é ele que libera os empreendimentos."
              titulo="Seu cadastro de corretor"
            />
            <CampoCnpj
              ajuda="A imobiliária precisa estar credenciada na Careli."
              aoMudar={setCnpj}
              rotulo="CNPJ da imobiliária"
              valor={cnpj}
            />
            <Erro>{erro}</Erro>
          </>
        );

      case "dados":
        return (
          <>
            <Cabecalho
              subtitulo={`Você está sendo cadastrado como corretor da ${imobiliaria || "sua imobiliária"}. Preencha o nome completo, um e-mail válido e o telefone com DDD.`}
              titulo="Seus dados de corretor"
            />
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
                  : "Último passo do seu cadastro: confirme o seu CRECI. Se não tiver em mãos, deixe em branco e siga, dá para informar depois."
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
            <Cabecalho
              subtitulo="Confira os seus dados de corretor. Ao concluir, você começa o cadastro do cliente."
              titulo="Tudo certo?"
            />
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
              subtitulo={
                imobiliaria
                  ? `Estes são os empreendimentos que a ${imobiliaria} está habilitada a vender.`
                  : "Estes são os empreendimentos que a sua imobiliária está habilitada a vender."
              }
              titulo="Para qual empreendimento é esta CAD?"
            />
            {/* ⚠️ O AVISO É A PARTE IMPORTANTE DESTA TELA, não a lista.
                O corretor não decora o que a imobiliária dele vende, e antes o sistema o mandava
                direto para a CAD quando havia um único produto — foi assim que uma CAD da Aldeia
                da Cachoeira foi parar no Vale do Ouro (22/08), sem ninguém perceber na hora.
                Dizer o que NÃO está na lista, e o que fazer a respeito, é o que evita o erro. */}
            <div
              style={{
                background: "#FFF8E6",
                border: "1px solid #F0DFB0",
                borderRadius: 12,
                color: "#5C4708",
                fontSize: 13,
                lineHeight: 1.5,
                marginBottom: 14,
                padding: "12px 14px",
              }}
            >
              Não encontrou o empreendimento que você queria? Então a{" "}
              {imobiliaria ? <b>{imobiliaria}</b> : "sua imobiliária"} ainda não está habilitada
              nele. Fale com a gestão da sua imobiliária para pedir a habilitação. Não envie a CAD
              por outro empreendimento, porque o cliente ficaria cadastrado no lugar errado.
            </div>
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
                  ? "Sua imobiliária ainda não está habilitada em nenhum empreendimento aberto. Fale com a nossa central para pedir a habilitação: assim que ela sair, você já consegue cadastrar clientes por aqui."
                  : "Não localizamos esse CNPJ entre as imobiliárias credenciadas. Isso costuma ser rápido de resolver: fale com a nossa central e a gente confere o credenciamento da sua imobiliária."
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
            Concluir meu cadastro
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

// O QUE TER EM MÃOS, dito ANTES de começar. O corretor preenche com o cliente sentado na frente:
// descobrir no meio do caminho que falta a certidão é o que faz a sessão morrer pela metade.
function ChecklistInicio() {
  // ⚠️ Esta lista tem que bater com o que o servidor EXIGE de verdade, em
  // lib/apolo/cadastro-obrigatorios.ts. Prometer menos do que é exigido é pior do que não avisar:
  // o corretor chega no fim, com o cliente do lado, e descobre que falta documento.
  // A certidão vale para casado, união estável, DIVORCIADO e SEPARADO (ESTADO_CIVIL_EXIGE_CERTIDAO);
  // o documento do cônjuge só para casado e união estável (ESTADO_CIVIL_TEM_CONJUGE).
  const itens = [
    "Documento de identificação do cliente: RG, CNH ou passaporte",
    "Comprovante de endereço do cliente, emitido nos últimos 3 meses",
    "Se o cliente for casado, divorciado, separado ou tiver união estável: a certidão de estado civil",
    "Se for casado ou tiver união estável: também o documento de identificação do cônjuge",
    "Se o cliente for empresa: cartão CNPJ, contrato social e, de cada sócio, documento e comprovante de endereço",
  ];
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        marginTop: 20,
        padding: "14px 16px",
      }}
    >
      <p style={{ color: C.text, fontSize: 14, fontWeight: 600, margin: 0 }}>
        Antes de começar, tenha em mãos
      </p>
      <ul style={{ margin: "8px 0 0", padding: "0 0 0 18px" }}>
        {itens.map((item) => (
          <li key={item} style={{ color: C.sub, fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// O botão da assistente é só um ícone flutuante: sem esta linha ninguém descobre que ali tem ajuda.
function AjudaCaca() {
  return (
    <p style={{ color: C.muted, fontSize: 12, lineHeight: 1.5, margin: "12px 0 0" }}>
      Ficou com dúvida em alguma etapa? Toque no botão redondo no canto da tela para falar com a
      nossa assistente.
    </p>
  );
}

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
