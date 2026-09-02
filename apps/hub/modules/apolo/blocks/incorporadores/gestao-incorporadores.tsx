"use client";

import { Badge, Tooltip } from "@repo/uix";
import {
  Building2,
  ExternalLink,
  ImagePlus,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TipoDePortal } from "@/lib/apolo/incorporador/perfis-de-portal";

import { getApoloAccessToken } from "../../data/apolo-operations";
import { fileToBase64 } from "../../lib/document-capture";

// GESTÃO DOS ACESSOS DE INCORPORADOR — hoje uma ABA DO SETUP (pedido do Lucas, 18/08/2026:
// "essa tela poderia estar dentro do setup ... podia também colocar uma parte que eu adiciono
// os usuários"). Nasceu em /apolo/incorporadores, que agora só redireciona para cá.
//
// "eu preciso ter um local que eu crio o login e senha desses usuarios e vincula-los ao perfil
// correto" (Lucas, 12/08/2026). Antes disso era INSERT manual no Supabase, e com Recanto do
// Pará, Vista Alegre e Lavra do Ouro entrando, uma linha errada em empreendimentos é um cliente
// vendo a carteira do outro.
//
// A tela tem duas coisas e nada mais: o incorporador (nome, endereço de acesso, o que ele
// enxerga) e as contas que entram por ele. Marca só no login — o portal é Panteon para todos.
//
// ⚠️ Senha: entra pelo formulário, vira scrypt no servidor e NUNCA volta em resposta nem em log.
// E-mail: único POR PORTAL (migration 0094) — o mesmo e-mail pode ter conta em incorporadores
// diferentes, então esta tela não bloqueia repetição entre portais.
//
// A MESMA TELA SERVE A ABA "COMERCIAL" (migration 0122, `apolo_incorporadores.tipo`). Pedido do
// Lucas, 02/09/2026: "igual a tela do incorporador uma tela de Comercial, aí vou fazendo os
// perfis... irei vincular os coordenadores aos empreendimentos". É o HÉRCULES da Gurgel: um
// portal só (`/incorporador/gurgel`), e o que muda é o recorte de CADA conta. Por isso, com
// `tipo="comercial"`, o formulário de conta ganha a lista de empreendimentos do coordenador
// (`apolo_incorporador_usuario_empreendimentos`) e os textos falam em "coordenador".
//
// ⚠️ NO MODO INCORPORADOR O CAMPO `empreendimentos` DA CONTA NÃO VIAJA. O servidor trata lista
// (mesmo vazia) como "substituir" e ausência como "não mexer"; mandar `[]` de um portal de
// incorporador apagaria um vínculo que ninguém pediu para apagar.

type EmpreendimentoDisponivel = { code: string; enterpriseId: string; nome: string };
type Usuario = {
  ativo: boolean;
  criadoEm: null | string;
  email: string;
  /** O recorte PRÓPRIO da conta (0122). No comercial, vazio = não entra. Só o comercial mexe nele. */
  empreendimentos: string[];
  id: string;
  nome: string;
  ultimoLoginEm: null | string;
};
type Incorporador = {
  ativo: boolean;
  empreendimentos: { carteiraAdministrada: boolean; enterpriseId: string }[];
  id: string;
  logoEscuraPath: null | string;
  logoEscuraUrl: null | string;
  logoPath: null | string;
  logoUrl: null | string;
  nome: string;
  slug: string;
  usuarios: Usuario[];
};

type VarianteDaLogo = "clara" | "escura";

// ⚠️ Os MESMOS números do servidor (lib/apolo/incorporador/logo.ts). A conferência aqui existe
// para o arquivo grande nem sair do navegador: a Vercel corta a requisição por volta de 4,5MB e
// devolve 413 SEM mensagem — foi assim no upload de CAD, e a tela ficava muda.
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_LABEL = "2MB";

/** O mesmo `normalizarSlug` do servidor, para a tela mostrar o endereço antes de gravar. */
function slugDe(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const dataCurta = (iso: null | string): null | string => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR");
};

// Classes no padrão do Setup (grafite com preto; dourado só no anel de foco, nunca como estado).
const INPUT =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-[#A07C3B]";
const BOTAO_ICONE =
  "grid h-8 w-8 place-items-center rounded-md text-ink-muted outline-none transition hover:bg-subtle hover:text-ink focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-40";
const BOTAO_PRIMARIO =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md bg-inverse px-3 text-sm font-semibold text-brand-ink outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-40";
const BOTAO_SECUNDARIO =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink outline-none transition hover:bg-subtle focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-40";

// Só os textos mudam entre os dois modos. O resto da tela é idêntico DE PROPÓSITO: é o mesmo
// cadastro (`apolo_incorporadores`), a mesma porta (`/incorporador/<slug>`) e a mesma tabela de
// contas — o coordenador é uma conta de portal como qualquer outra, com um recorte a mais.
const ROTULOS: Record<
  TipoDePortal,
  {
    ajudaEmail: string;
    contaEditar: string;
    contaNova: string;
    contaNovaEm: (nome: string) => string;
    contaSalvar: string;
    enxerga: string;
    nenhumaConta: string;
    /** O portal sem empreendimento marcado: no incorporador é portal quebrado; no comercial, não. */
    semEmpreendimento: string;
    placeholderNome: string;
    placeholderSlug: string;
    portalEditar: string;
    portalNovo: string;
    subtitulo: string;
    titulo: string;
  }
> = {
  comercial: {
    ajudaEmail:
      "O mesmo e-mail pode ter conta em outro portal (a URL decide onde ele entra); só não repete dentro deste.",
    contaEditar: "Editar coordenador",
    contaNova: "Novo coordenador",
    contaNovaEm: (nome) => `Novo coordenador em ${nome}`,
    contaSalvar: "Salvar coordenador",
    enxerga:
      "Empreendimentos do portal (referência; no comercial o acesso é só o vínculo de cada coordenador)",
    nenhumaConta: "Nenhum coordenador ainda.",
    placeholderNome: "Gurgel",
    placeholderSlug: "gurgel",
    portalEditar: "Editar portal comercial",
    portalNovo: "Novo portal comercial",
    semEmpreendimento:
      "Sem recorte padrão: só entra quem tiver empreendimentos vinculados na própria conta.",
    subtitulo:
      "O time comercial da Careli entra por aqui. Cada coordenador tem a própria conta e enxerga só os empreendimentos vinculados a ele; sem vínculo, não entra.",
    titulo: "Portal comercial",
  },
  incorporador: {
    ajudaEmail:
      "O mesmo e-mail pode ter conta em outros portais de incorporador (a URL decide onde ele entra); só não repete dentro deste portal.",
    contaEditar: "Editar conta",
    contaNova: "Nova conta",
    contaNovaEm: (nome) => `Nova conta em ${nome}`,
    contaSalvar: "Salvar conta",
    enxerga: "O que este incorporador enxerga",
    nenhumaConta: "Nenhuma conta criada ainda.",
    placeholderNome: "Cecílio Rocha",
    placeholderSlug: "cecilio-rocha",
    portalEditar: "Editar incorporador",
    portalNovo: "Novo incorporador",
    semEmpreendimento: "Sem empreendimento: quem entrar por aqui não vê nada.",
    subtitulo:
      "Cada incorporador enxerga só os empreendimentos marcados aqui. Quem entra pelo portal usa as contas desta tela.",
    titulo: "Portais de incorporador",
  },
};

export function GestaoIncorporadores({ tipo = "incorporador" }: { tipo?: TipoDePortal } = {}) {
  // O modo comercial liga o recorte por conta e troca os textos; fora isso, é a mesma tela.
  const comercial = tipo === "comercial";
  const rotulos = ROTULOS[tipo];

  const [lista, setLista] = useState<Incorporador[]>([]);
  const [empreendimentos, setEmpreendimentos] = useState<EmpreendimentoDisponivel[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [salvando, setSalvando] = useState(false);

  // Qual formulário está aberto. `null` = nenhum; "novo" = incorporador novo; id = editando.
  const [editando, setEditando] = useState<null | string>(null);
  // Cada empreendimento marcado carrega a própria chave de carteira: antes a tela só PRESERVAVA
  // o valor anterior, então incorporador novo nascia sempre sem carteira e a aba Carteira do
  // portal não aparecia (caso real: Lagoa Bonita/LBF, 18/08).
  //
  // LOGO: o formulário guarda a REFERÊNCIA (o que vai para `logo_path`) e, separada, a PRÉVIA.
  // São coisas diferentes de propósito: a referência de storage só vira imagem depois de salvar
  // (a rota pública lê a coluna do banco), então logo após o upload a prévia é o dataURL local.
  const [form, setForm] = useState({
    empreendimentos: [] as { carteiraAdministrada: boolean; enterpriseId: string }[],
    logoEscuraPath: null as null | string,
    logoEscuraPrevia: null as null | string,
    logoPath: null as null | string,
    logoPrevia: null as null | string,
    nome: "",
    slug: "",
  });
  // Qual variante está subindo agora (`null` = nenhuma). Trava só o botão daquela metade.
  const [enviandoLogo, setEnviandoLogo] = useState<null | VarianteDaLogo>(null);
  // Formulário de conta: guarda o incorporador dono e, quando é edição, o id do usuário.
  // `ativo` viaja junto para a edição não reativar sem querer uma conta desativada.
  const [conta, setConta] = useState<
    null | {
      ativo: boolean;
      email: string;
      /** O recorte próprio (só o comercial edita e envia). */
      empreendimentos: string[];
      incorporadorId: string;
      nome: string;
      senha: string;
      usuarioId: null | string;
    }
  >(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      // Sem `?tipo=`, a rota devolve os incorporadores; a aba Comercial pede só os dela.
      const r = await fetch(`/api/apolo/incorporadores?tipo=${tipo}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const c = (await r.json()) as {
        data?: { empreendimentos: EmpreendimentoDisponivel[]; incorporadores: Incorporador[] };
        error?: string;
      };
      if (!r.ok) setErro(c.error ?? `Falha (${r.status}).`);
      else {
        setLista(c.data?.incorporadores ?? []);
        setEmpreendimentos(c.data?.empreendimentos ?? []);
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    setCarregando(false);
  }, [tipo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // O formulário abre junto do card clicado, mas pode nascer parcialmente fora da tela (card no
  // pé da viewport). `nearest` só rola o mínimo para ele aparecer inteiro — sem pular ao topo,
  // que era o "não acontece nada" original (Lucas, 23/08).
  const formularioRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (editando) {
      formularioRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [editando]);

  const nomeDoEmpreendimento = useMemo(() => {
    const mapa = new Map(empreendimentos.map((e) => [e.enterpriseId, `${e.code} · ${e.nome}`]));
    return (id: string) => mapa.get(id) ?? `Empreendimento ${id}`;
  }, [empreendimentos]);

  function abrirNovo() {
    setConta(null);
    setEditando("novo");
    setForm({
      empreendimentos: [],
      logoEscuraPath: null,
      logoEscuraPrevia: null,
      logoPath: null,
      logoPrevia: null,
      nome: "",
      slug: "",
    });
  }

  function abrirEdicao(inc: Incorporador) {
    setConta(null);
    setEditando(inc.id);
    setForm({
      empreendimentos: inc.empreendimentos.map((e) => ({
        carteiraAdministrada: e.carteiraAdministrada,
        enterpriseId: e.enterpriseId,
      })),
      logoEscuraPath: inc.logoEscuraPath,
      logoEscuraPrevia: inc.logoEscuraUrl,
      logoPath: inc.logoPath,
      logoPrevia: inc.logoUrl,
      nome: inc.nome,
      slug: inc.slug,
    });
  }

  async function salvarIncorporador() {
    setSalvando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/incorporadores", {
        body: JSON.stringify({
          // "Carteira (quando tiver)": agora a chave é marcada aqui na tela, empreendimento a
          // empreendimento; a aba de recebimento do portal depende disso e não deriva do C2X.
          empreendimentos: form.empreendimentos,
          id: editando === "novo" ? null : editando,
          // ⚠️ AS DUAS LOGOS VIAJAM SEMPRE. O servidor grava o que chega, e `undefined` vira
          // `null` lá: antes desta tela ter os campos, salvar o cadastro do Cecílio APAGAVA a
          // logo dele, porque o corpo simplesmente não trazia `logoPath`.
          logoEscuraPath: form.logoEscuraPath,
          logoPath: form.logoPath,
          nome: form.nome,
          slug: form.slug || form.nome,
          // Só na CRIAÇÃO: um portal não muda de tipo depois de nascer (o servidor ignora na
          // edição, mas a tela nem manda, para o corpo dizer a verdade).
          ...(editando === "novo" ? { tipo } : {}),
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const c = (await r.json()) as { error?: string };
      if (!r.ok) setErro(c.error ?? `Falha (${r.status}).`);
      else {
        setEditando(null);
        await carregar();
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    setSalvando(false);
  }

  /** Grava a conta do formulário. A senha NÃO entra em log e a resposta nunca a devolve. */
  async function salvarConta() {
    if (!conta) return;
    setSalvando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/incorporadores/usuarios", {
        body: JSON.stringify({
          ativo: conta.ativo,
          email: conta.email,
          id: conta.usuarioId,
          incorporadorId: conta.incorporadorId,
          nome: conta.nome,
          // Vazio na edição = mantém a senha atual. O servidor trata; a tela avisa no rótulo.
          senha: conta.senha || null,
          // ⚠️ SÓ NO COMERCIAL. Lista (mesmo vazia) = substitui o recorte da conta; ausente =
          // não mexe. Do portal de incorporador o campo nunca sai, para não apagar nada.
          ...(comercial ? { empreendimentos: conta.empreendimentos } : {}),
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const c = (await r.json()) as { error?: string };
      if (!r.ok) setErro(c.error ?? `Falha (${r.status}).`);
      else {
        setConta(null);
        await carregar();
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    setSalvando(false);
  }

  /** Liga/desliga o acesso sem abrir formulário. Senha nula = intocada. */
  async function alternarAtivo(inc: Incorporador, u: Usuario) {
    setSalvando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/incorporadores/usuarios", {
        body: JSON.stringify({
          ativo: !u.ativo,
          email: u.email,
          id: u.id,
          incorporadorId: inc.id,
          nome: u.nome,
          senha: null,
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const c = (await r.json()) as { error?: string };
      if (!r.ok) setErro(c.error ?? `Falha (${r.status}).`);
      else await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
    setSalvando(false);
  }

  /**
   * Sobe uma variante da logo. O arquivo vai em base64 para a mesma rota que grava no bucket, e
   * o que volta é a REFERÊNCIA — que só vira marca na porta quando o formulário for salvo.
   *
   * As duas conferências (formato e tamanho) acontecem aqui ANTES de enviar, e de novo no
   * servidor. A daqui é a que dá recado legível: passando de ~4,5MB quem responde é a Vercel, com
   * um 413 sem corpo, e a tela ficaria muda.
   */
  async function enviarLogo(variante: VarianteDaLogo, arquivo: File) {
    // ⚠️ O `id` viaja JUNTO e é ele que manda no servidor. Sem isso, o upload obedecia ao texto
    // deste campo: quem clicasse em "Novo incorporador" e digitasse um endereço já existente
    // (`vistaalegre`, por exemplo) SOBRESCREVIA a arte do portal que está no ar — e só descobria
    // pelo erro de endereço duplicado no save, que não parece ter relação nenhuma com a logo.
    const id = editando === "novo" ? null : editando;
    const slug = slugDe(form.slug || form.nome);
    if (!id && !slug) {
      setErro("Preencha o nome (ou o endereço de acesso) antes de enviar a logo.");
      return;
    }

    const tipo = arquivo.type.toLowerCase();
    const nome = arquivo.name.toLowerCase();
    const formatoOk =
      tipo === "image/svg+xml" ||
      tipo === "image/png" ||
      nome.endsWith(".svg") ||
      nome.endsWith(".png");
    if (!formatoOk) {
      setErro("A logo precisa ser SVG ou PNG.");
      return;
    }
    if (arquivo.size > LOGO_MAX_BYTES) {
      setErro(`A logo pode ter até ${LOGO_MAX_LABEL}. Envie um arquivo menor.`);
      return;
    }

    setEnviandoLogo(variante);
    setErro(null);
    try {
      const fileBase64 = await fileToBase64(arquivo);
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/incorporadores/logo", {
        body: JSON.stringify({
          contentType: arquivo.type || null,
          fileBase64,
          id,
          nomeArquivo: arquivo.name,
          slug,
          variante,
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const c = (await r.json()) as { data?: { referencia?: string }; error?: string };
      if (!r.ok || !c.data?.referencia) {
        setErro(c.error ?? `Falha ao enviar a logo (${r.status}).`);
        return;
      }

      const referencia = c.data.referencia;
      setForm((f) =>
        variante === "escura"
          ? { ...f, logoEscuraPath: referencia, logoEscuraPrevia: fileBase64 }
          : { ...f, logoPath: referencia, logoPrevia: fileBase64 },
      );
    } catch (e) {
      setErro((e as Error).message);
    }
    setEnviandoLogo(null);
  }

  /**
   * Zera o campo. Só o campo — a lixeira é uma edição do FORMULÁRIO, e como toda edição daqui só
   * vale quando o operador salvar.
   *
   * ⚠️ ANTES ELA APAGAVA NO BUCKET, no clique. Quem abrisse a edição de um portal com logo,
   * clicasse na lixeira, se arrependesse e fechasse sem salvar já tinha destruído a arte: a coluna
   * do banco continuava apontando para um arquivo que não existia mais, e a porta do cliente
   * passava a mostrar imagem quebrada — sem ninguém ter salvo nada, e sem volta pela tela a não
   * ser subir a arte de novo. O arquivo agora sai no servidor, durante a gravação, depois que a
   * coluna já deixou de apontar para ele.
   */
  function removerLogo(variante: VarianteDaLogo) {
    setErro(null);
    setForm((f) =>
      variante === "escura"
        ? { ...f, logoEscuraPath: null, logoEscuraPrevia: null }
        : { ...f, logoPath: null, logoPrevia: null },
    );
  }

  /**
   * Um campo de logo. A prévia da versão ESCURA vai sobre fundo escuro — é o único jeito de
   * enxergar uma arte em negativo, que sobre branco some.
   */
  function campoDeLogo(variante: VarianteDaLogo) {
    const escura = variante === "escura";
    const previa = escura ? form.logoEscuraPrevia : form.logoPrevia;
    const referencia = escura ? form.logoEscuraPath : form.logoPath;
    const ocupado = enviandoLogo === variante;

    return (
      <div className="grid gap-1.5">
        <span className="text-xs font-semibold text-ink-muted">
          {escura ? "Logo para fundo escuro (opcional)" : "Logo"}
        </span>

        <div
          className={`grid h-24 place-items-center overflow-hidden rounded-md border border-line p-3 ${
            escura ? "bg-[#12161d]" : "bg-surface"
          }`}
        >
          {ocupado ? (
            <Loader2 aria-hidden="true" className="animate-spin text-ink-muted" size={18} />
          ) : previa ? (
            // eslint-disable-next-line @next/next/no-img-element -- prévia local/rota própria
            <img
              alt={escura ? "Prévia da logo em negativo" : "Prévia da logo"}
              className="max-h-full max-w-full object-contain"
              src={previa}
            />
          ) : (
            <span className={`text-xs ${escura ? "text-white/45" : "text-ink-muted"}`}>
              {escura ? "Sem versão em negativo" : "Sem logo"}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className={`${BOTAO_SECUNDARIO} cursor-pointer`}>
            <ImagePlus aria-hidden="true" size={14} />
            {referencia ? "Trocar" : "Escolher arquivo"}
            <input
              accept=".svg,.png,image/svg+xml,image/png"
              className="hidden"
              disabled={ocupado || salvando}
              onChange={(ev) => {
                const arquivo = ev.target.files?.[0];
                // O input é limpo SEMPRE: sem isso, escolher o mesmo arquivo de novo (depois de
                // corrigir a arte) não dispara `change` e parece que a tela travou.
                ev.target.value = "";
                if (arquivo) void enviarLogo(variante, arquivo);
              }}
              type="file"
            />
          </label>
          {referencia ? (
            <Tooltip content="Remover a logo (vale quando salvar)">
              <button
                aria-label={escura ? "Remover logo em negativo" : "Remover logo"}
                className={BOTAO_ICONE}
                disabled={ocupado || salvando}
                onClick={() => removerLogo(variante)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} />
              </button>
            </Tooltip>
          ) : null}
        </div>

        {escura ? (
          <span className="text-[11px] font-normal text-ink-muted">
            Sem esta, o portal usa a logo normal também no tema escuro.
          </span>
        ) : (
          <span className="text-[11px] font-normal text-ink-muted">
            SVG ou PNG, até {LOGO_MAX_LABEL}. Aparece na tela de acesso do cliente.
          </span>
        )}
      </div>
    );
  }

  // Formulário único, renderizado em DOIS pontos: no topo quando é incorporador NOVO, e
  // ABAIXO do card clicado quando é edição — pedido do Lucas, 23/08: "acho melhor abrir
  // abaixo do perfil". Os inputs são controlados pelo estado , então o formulário
  // trocar de posição na árvore (remount) não perde o que foi digitado.
  const formularioIncorporador =
    editando ? (
        <section className="mt-3 scroll-mt-24 rounded-md border border-line bg-subtle p-4" ref={formularioRef}>
          <p className="m-0 text-sm font-semibold text-ink">
            {editando === "novo" ? rotulos.portalNovo : rotulos.portalEditar}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-semibold text-ink-muted">
              Nome
              <input
                className={INPUT}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder={rotulos.placeholderNome}
                value={form.nome}
              />
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-ink-muted">
              Endereço de acesso
              <input
                className={INPUT}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder={rotulos.placeholderSlug}
                value={form.slug}
              />
              {/* A porta é a MESMA nos dois tipos: o comercial também entra por /incorporador/. */}
              <span className="block font-normal text-ink-muted">
                c2x.app.br/incorporador/{slugDe(form.slug || form.nome) || "…"}
              </span>
            </label>
          </div>

          {/* A MARCA DA PORTA. Antes disto, publicar a logo de um portal era INSERT na mão no
              banco apontando arquivo commitado — por isso, dos 7 portais, só o Cecílio tinha
              marca no login. Agora a arte sobe pela tela e vale sem deploy. */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {campoDeLogo("clara")}
            {campoDeLogo("escura")}
          </div>

          <p className="mb-1 mt-4 text-xs font-semibold text-ink-muted">{rotulos.enxerga}</p>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {empreendimentos.length === 0 ? (
              <p className="m-0 text-xs text-ink-muted">
                A lista do C2X não carregou. Dá para salvar o cadastro e marcar os
                empreendimentos depois.
              </p>
            ) : (
              empreendimentos.map((e) => {
                const marcado = form.empreendimentos.find(
                  (m) => m.enterpriseId === e.enterpriseId,
                );

                return (
                  <div
                    className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-ink hover:bg-surface"
                    key={e.enterpriseId}
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        checked={Boolean(marcado)}
                        className="h-4 w-4 rounded border-line accent-[#A07C3B]"
                        onChange={(ev) =>
                          setForm((f) => ({
                            ...f,
                            empreendimentos: ev.target.checked
                              ? [
                                  ...f.empreendimentos,
                                  { carteiraAdministrada: false, enterpriseId: e.enterpriseId },
                                ]
                              : f.empreendimentos.filter(
                                  (m) => m.enterpriseId !== e.enterpriseId,
                                ),
                          }))
                        }
                        type="checkbox"
                      />
                      <span className="font-semibold">{e.code}</span>
                      <span className="truncate text-ink-muted">{e.nome}</span>
                    </label>
                    {/* ⚠️ A chave de carteira NÃO vale no comercial: lá o Financeiro é de todo
                        empreendimento do escopo (escopo-do-usuario.ts), porque o coordenador
                        vende e precisa do financeiro de tudo que vende. Mostrar a chave só
                        convidaria a marcar algo sem efeito. */}
                    {marcado && !comercial ? (
                      <Tooltip content="Carteira administrada pela Careli: liga a aba Carteira no portal deste incorporador">
                        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold text-ink-muted transition hover:text-ink">
                          <input
                            checked={marcado.carteiraAdministrada}
                            className="h-3.5 w-3.5 rounded border-line accent-[#A07C3B]"
                            onChange={(ev) =>
                              setForm((f) => ({
                                ...f,
                                empreendimentos: f.empreendimentos.map((m) =>
                                  m.enterpriseId === e.enterpriseId
                                    ? { ...m, carteiraAdministrada: ev.target.checked }
                                    : m,
                                ),
                              }))
                            }
                            type="checkbox"
                          />
                          carteira
                        </label>
                      </Tooltip>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              className={BOTAO_PRIMARIO}
              disabled={salvando || !form.nome.trim()}
              onClick={() => void salvarIncorporador()}
              type="button"
            >
              {salvando ? <Loader2 aria-hidden="true" className="animate-spin" size={15} /> : null}
              Salvar
            </button>
            <button className={BOTAO_SECUNDARIO} onClick={() => setEditando(null)} type="button">
              <X aria-hidden="true" size={15} />
              Cancelar
            </button>
          </div>
        </section>
    ) : null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-base font-semibold text-ink">{rotulos.titulo}</h2>
          <p className="m-0 mt-1 text-xs text-ink-muted">{rotulos.subtitulo}</p>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content={rotulos.portalNovo}>
            <button
              aria-label={rotulos.portalNovo}
              className="grid h-9 w-9 place-items-center rounded-md bg-inverse text-brand-ink outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={abrirNovo}
              type="button"
            >
              <Plus aria-hidden="true" size={15} />
            </button>
          </Tooltip>
          <Tooltip content="Atualizar">
            <button
              aria-label="Atualizar"
              className="grid h-9 w-9 place-items-center rounded-md border border-line bg-surface text-ink outline-none transition hover:bg-subtle focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-40"
              disabled={carregando}
              onClick={() => void carregar()}
              type="button"
            >
              {carregando ? (
                <Loader2 aria-hidden="true" className="animate-spin" size={15} />
              ) : (
                <RefreshCw aria-hidden="true" size={15} />
              )}
            </button>
          </Tooltip>
        </div>
      </div>

      {erro ? (
        <p className="m-0 rounded-md border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 p-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
          {erro}
        </p>
      ) : null}

      {editando === "novo" ? formularioIncorporador : null}

      {carregando && lista.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">Carregando…</p>
      ) : null}

      <div className="grid gap-3">
        {lista.map((inc) => (
          <article className="rounded-md border border-line bg-surface p-4" key={inc.id}>
            <div className="flex flex-wrap items-center gap-2">
              <Building2 aria-hidden="true" className="text-ink-muted" size={16} />
              <span className="text-sm font-semibold text-ink">{inc.nome}</span>
              {/* Link de verdade: o dono tentou abrir o caminho em texto e caiu num 404 relativo.
                  Href ABSOLUTO e aba nova — a tela do Setup fica aberta. */}
              <a
                className="inline-flex items-center gap-1 text-xs text-ink-muted underline-offset-2 outline-none transition hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                href={`/incorporador/${inc.slug}`}
                rel="noopener noreferrer"
                target="_blank"
                title="Abrir o portal em outra aba"
              >
                /incorporador/{inc.slug}
                <ExternalLink aria-hidden="true" size={12} />
              </a>
              {inc.ativo ? null : <Badge variant="warning">inativo</Badge>}
              <div className="ml-auto flex items-center gap-1">
                <Tooltip content={rotulos.portalEditar}>
                  <button
                    aria-label={`Editar ${inc.nome}`}
                    className={BOTAO_ICONE}
                    onClick={() => abrirEdicao(inc)}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={14} />
                  </button>
                </Tooltip>
                <Tooltip content={comercial ? rotulos.contaNova : "Nova conta de acesso"}>
                  <button
                    aria-label={rotulos.contaNovaEm(inc.nome)}
                    className={BOTAO_ICONE}
                    onClick={() => {
                      setEditando(null);
                      setConta({
                        ativo: true,
                        email: "",
                        empreendimentos: [],
                        incorporadorId: inc.id,
                        nome: "",
                        senha: "",
                        usuarioId: null,
                      });
                    }}
                    type="button"
                  >
                    <UserPlus aria-hidden="true" size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {inc.empreendimentos.length === 0 ? (
                /* No comercial o portal sem empreendimento NÃO está quebrado: o recorte é o de
                   cada coordenador (escopoDoUsuario). Vermelho aqui diria o contrário. */
                <span
                  className={
                    comercial
                      ? "text-xs text-ink-muted"
                      : "text-xs font-semibold text-red-700 dark:text-red-300"
                  }
                >
                  {rotulos.semEmpreendimento}
                </span>
              ) : (
                inc.empreendimentos.map((e) => (
                  <span
                    className="rounded-full bg-subtle px-2 py-0.5 text-[11px] text-ink-muted"
                    key={e.enterpriseId}
                  >
                    {nomeDoEmpreendimento(e.enterpriseId)}
                    {e.carteiraAdministrada && !comercial ? " · carteira" : ""}
                  </span>
                ))
              )}
            </div>

            {editando === inc.id ? formularioIncorporador : null}

            <div className="mt-3 grid gap-1">
              {inc.usuarios.length === 0 ? (
                <p className="m-0 text-xs text-ink-muted">{rotulos.nenhumaConta}</p>
              ) : (
                inc.usuarios.map((u) => (
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1 text-sm transition hover:bg-subtle"
                    key={u.id}
                  >
                    <span className="font-semibold text-ink">{u.nome}</span>
                    <span className="text-ink-muted">{u.email}</span>
                    <span className="text-xs text-ink-muted">
                      {dataCurta(u.criadoEm) ? `criado em ${dataCurta(u.criadoEm)}` : null}
                      {dataCurta(u.criadoEm) ? " · " : null}
                      {dataCurta(u.ultimoLoginEm)
                        ? `último acesso ${dataCurta(u.ultimoLoginEm)}`
                        : "nunca entrou"}
                    </span>
                    {u.ativo ? null : <Badge variant="warning">inativo</Badge>}
                    <div className="ml-auto flex items-center gap-1">
                      <Tooltip content="Editar conta / trocar senha">
                        <button
                          aria-label={`Editar conta de ${u.nome}`}
                          className={BOTAO_ICONE}
                          onClick={() => {
                            setEditando(null);
                            setConta({
                              ativo: u.ativo,
                              email: u.email,
                              // Pré-marca o recorte que a conta já tem (só o comercial mostra).
                              empreendimentos: u.empreendimentos,
                              incorporadorId: inc.id,
                              nome: u.nome,
                              senha: "",
                              usuarioId: u.id,
                            });
                          }}
                          type="button"
                        >
                          <KeyRound aria-hidden="true" size={14} />
                        </button>
                      </Tooltip>
                      <Tooltip content={u.ativo ? "Desativar acesso" : "Reativar acesso"}>
                        <button
                          aria-label={
                            u.ativo
                              ? `Desativar acesso de ${u.nome}`
                              : `Reativar acesso de ${u.nome}`
                          }
                          className={BOTAO_ICONE}
                          disabled={salvando}
                          onClick={() => void alternarAtivo(inc, u)}
                          type="button"
                        >
                          <Power aria-hidden="true" size={14} />
                        </button>
                      </Tooltip>
                    </div>
                    {/* O recorte do coordenador, em linha própria abaixo do nome. Sem vínculo
                        ele NÃO entra (o login recusa com "sem empreendimento liberado") — e a
                        tela DIZ isso em vermelho, porque é conta que alguém esqueceu de vincular. */}
                    {comercial ? (
                      <div className="flex basis-full flex-wrap gap-1">
                        {u.empreendimentos.length === 0 ? (
                          <span className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                            sem empreendimento: não entra
                          </span>
                        ) : (
                          u.empreendimentos.map((id) => (
                            <span
                              className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-muted"
                              key={id}
                            >
                              {nomeDoEmpreendimento(id)}
                            </span>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>

            {conta?.incorporadorId === inc.id ? (
              <div className="mt-3 rounded-md border border-line bg-subtle p-3">
                <p className="m-0 text-xs font-semibold text-ink">
                  {conta.usuarioId ? rotulos.contaEditar : rotulos.contaNova}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  <input
                    className={INPUT}
                    onChange={(e) => setConta({ ...conta, nome: e.target.value })}
                    placeholder="Nome da pessoa"
                    value={conta.nome}
                  />
                  <input
                    className={INPUT}
                    onChange={(e) => setConta({ ...conta, email: e.target.value })}
                    placeholder="email@empresa.com.br"
                    type="email"
                    value={conta.email}
                  />
                  <input
                    className={INPUT}
                    onChange={(e) => setConta({ ...conta, senha: e.target.value })}
                    placeholder={
                      conta.usuarioId ? "Nova senha (vazio mantém)" : "Senha do primeiro acesso"
                    }
                    type="text"
                    value={conta.senha}
                  />
                </div>
                <p className="m-0 mt-2 text-xs text-ink-muted">{rotulos.ajudaEmail}</p>

                {/* O VÍNCULO DO COORDENADOR ("irei vincular os coordenadores aos empreendimentos").
                    A lista é a do C2X inteira, e não só a do portal: o recorte próprio SUBSTITUI o
                    do portal quando existe (escopo-do-usuario.ts), então restringir aqui esconderia
                    empreendimento que o portal não marcou mas o coordenador atende. */}
                {comercial ? (
                  <div className="mt-3">
                    <p className="m-0 text-xs font-semibold text-ink-muted">
                      Empreendimentos deste coordenador
                    </p>
                    <p className="m-0 mt-0.5 text-[11px] text-ink-muted">
                      É tudo o que este coordenador enxerga (CRM, Vendas, Financeiro, Contratos e
                      Lançamento). Sem nenhum marcado, a conta não entra no portal.
                    </p>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                      {empreendimentos.length === 0 ? (
                        <p className="m-0 text-xs text-ink-muted">
                          A lista do C2X não carregou. Dá para salvar a conta e vincular os
                          empreendimentos depois.
                        </p>
                      ) : (
                        empreendimentos.map((e) => {
                          const marcado = conta.empreendimentos.includes(e.enterpriseId);

                          return (
                            <label
                              className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm text-ink hover:bg-surface"
                              key={e.enterpriseId}
                            >
                              <input
                                checked={marcado}
                                className="h-4 w-4 rounded border-line accent-[#A07C3B]"
                                onChange={(ev) =>
                                  setConta({
                                    ...conta,
                                    empreendimentos: ev.target.checked
                                      ? [...conta.empreendimentos, e.enterpriseId]
                                      : conta.empreendimentos.filter(
                                          (id) => id !== e.enterpriseId,
                                        ),
                                  })
                                }
                                type="checkbox"
                              />
                              <span className="font-semibold">{e.code}</span>
                              <span className="truncate text-ink-muted">{e.nome}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="mt-2 flex gap-2">
                  <button
                    className={BOTAO_PRIMARIO}
                    disabled={salvando}
                    onClick={() => void salvarConta()}
                    type="button"
                  >
                    {salvando ? (
                      <Loader2 aria-hidden="true" className="animate-spin" size={15} />
                    ) : null}
                    {rotulos.contaSalvar}
                  </button>
                  <button className={BOTAO_SECUNDARIO} onClick={() => setConta(null)} type="button">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
