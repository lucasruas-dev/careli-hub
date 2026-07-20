"use client";

import { useId, type ReactNode } from "react";

import { formatarTelefoneBR } from "@/lib/format/phone-br";
import { C, estilos, fonte } from "@/modules/publico/ui/tokens";

// Peças de formulário das telas públicas.
//
// O QUE MUDA MUITO A VIDA DE QUEM DIGITA NO CELULAR e por isso está tudo aqui, num lugar só:
//  - `inputMode` certo por campo (numérico abre o teclado de números, não o alfabético);
//  - `autoComplete` certo (o navegador oferece o dado salvo e o corretor não digita nada);
//  - máscara ENQUANTO digita (ninguém formata CPF na mão em pé, na rua).

export function Rotulo({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} style={estilos.rotulo}>
      {children}
    </label>
  );
}

// Erro sempre diz O QUE FAZER, não só o que deu errado (regra do Lucas).
export function Erro({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      style={{ color: C.danger, fontSize: 14, lineHeight: 1.45, margin: "10px 0 0" }}
    >
      {children}
    </p>
  );
}

export function Ajuda({ children }: { children: ReactNode }) {
  return (
    <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.45, margin: "8px 0 0" }}>
      {children}
    </p>
  );
}

type CampoBase = {
  ajuda?: ReactNode;
  aoMudar: (valor: string) => void;
  desabilitado?: boolean;
  rotulo: string;
  valor: string;
};

function mascaraCpf(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function mascaraCnpj(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function mascaraCep(valor: string): string {
  const d = valor.replace(/\D/g, "").slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function CampoCpf(props: CampoBase) {
  const id = useId();
  return (
    <div>
      <Rotulo htmlFor={id}>{props.rotulo}</Rotulo>
      <input
        autoComplete="off"
        disabled={props.desabilitado}
        id={id}
        // Teclado numérico. `type="text"` de propósito: `type="number"` traz setas, aceita
        // notação científica e quebra a máscara.
        inputMode="numeric"
        maxLength={14}
        onChange={(event) => props.aoMudar(mascaraCpf(event.target.value))}
        placeholder="000.000.000-00"
        style={estilos.campo}
        value={props.valor}
      />
      {props.ajuda ? <Ajuda>{props.ajuda}</Ajuda> : null}
    </div>
  );
}

export function CampoCnpj(props: CampoBase) {
  const id = useId();
  return (
    <div>
      <Rotulo htmlFor={id}>{props.rotulo}</Rotulo>
      <input
        autoComplete="off"
        disabled={props.desabilitado}
        id={id}
        inputMode="numeric"
        maxLength={18}
        onChange={(event) => props.aoMudar(mascaraCnpj(event.target.value))}
        placeholder="00.000.000/0000-00"
        style={estilos.campo}
        value={props.valor}
      />
      {props.ajuda ? <Ajuda>{props.ajuda}</Ajuda> : null}
    </div>
  );
}

export function CampoTelefone(props: CampoBase) {
  const id = useId();
  return (
    <div>
      <Rotulo htmlFor={id}>{props.rotulo}</Rotulo>
      <input
        autoComplete="tel"
        disabled={props.desabilitado}
        id={id}
        inputMode="tel"
        maxLength={16}
        onChange={(event) => props.aoMudar(formatarTelefoneBR(event.target.value))}
        placeholder="(00) 00000-0000"
        style={estilos.campo}
        type="tel"
        value={props.valor}
      />
      {props.ajuda ? <Ajuda>{props.ajuda}</Ajuda> : null}
    </div>
  );
}

export function CampoEmail(props: CampoBase) {
  const id = useId();
  return (
    <div>
      <Rotulo htmlFor={id}>{props.rotulo}</Rotulo>
      <input
        autoComplete="email"
        // Sem isto o iOS capitaliza a primeira letra do e-mail e o corretor não percebe.
        autoCapitalize="none"
        autoCorrect="off"
        disabled={props.desabilitado}
        id={id}
        inputMode="email"
        onChange={(event) => props.aoMudar(event.target.value)}
        placeholder="voce@imobiliaria.com.br"
        style={estilos.campo}
        type="email"
        value={props.valor}
      />
      {props.ajuda ? <Ajuda>{props.ajuda}</Ajuda> : null}
    </div>
  );
}

export function CampoCep(props: CampoBase) {
  const id = useId();
  return (
    <div>
      <Rotulo htmlFor={id}>{props.rotulo}</Rotulo>
      <input
        autoComplete="postal-code"
        disabled={props.desabilitado}
        id={id}
        inputMode="numeric"
        maxLength={9}
        onChange={(event) => props.aoMudar(mascaraCep(event.target.value))}
        placeholder="00000-000"
        style={estilos.campo}
        value={props.valor}
      />
      {props.ajuda ? <Ajuda>{props.ajuda}</Ajuda> : null}
    </div>
  );
}

export function CampoTexto(
  props: CampoBase & {
    autoComplete?: string;
    inputMode?: "numeric" | "text";
    maiusculaInicial?: boolean;
    placeholder?: string;
    somenteLeitura?: boolean;
  },
) {
  const id = useId();
  return (
    <div>
      <Rotulo htmlFor={id}>{props.rotulo}</Rotulo>
      <input
        autoCapitalize={props.maiusculaInicial ? "words" : "none"}
        autoComplete={props.autoComplete ?? "off"}
        disabled={props.desabilitado}
        id={id}
        inputMode={props.inputMode ?? "text"}
        onChange={(event) => props.aoMudar(event.target.value)}
        placeholder={props.placeholder}
        readOnly={props.somenteLeitura}
        style={{
          ...estilos.campo,
          background: props.somenteLeitura ? C.soft : C.card,
          color: props.somenteLeitura ? C.sub : C.text,
        }}
        value={props.valor}
      />
      {props.ajuda ? <Ajuda>{props.ajuda}</Ajuda> : null}
    </div>
  );
}

// Botão primário do rodapé.
//
// ⚠️ `position: sticky` DENTRO do container, e não `fixed` na viewport: com `fixed` o iOS
// joga o botão por baixo do teclado aberto e o corretor não consegue avançar.
export function BotaoPrimario({
  carregando,
  children,
  desabilitado,
  onClick,
  rotuloCarregando,
}: {
  carregando?: boolean;
  children: ReactNode;
  desabilitado?: boolean;
  onClick: () => void;
  rotuloCarregando?: string;
}) {
  const travado = Boolean(desabilitado || carregando);
  return (
    <button
      disabled={travado}
      onClick={onClick}
      style={{
        ...estilos.botaoPrimario,
        background: travado ? C.muted : C.text,
        cursor: travado ? "default" : "pointer",
      }}
      type="button"
    >
      {carregando ? rotuloCarregando ?? "Aguarde..." : children}
    </button>
  );
}

export function BotaoSecundario({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={estilos.botaoSecundario} type="button">
      {children}
    </button>
  );
}

// Título e subtítulo de cada passo. Um passo por tela, sempre.
export function Cabecalho({ subtitulo, titulo }: { subtitulo?: ReactNode; titulo: string }) {
  return (
    <header style={{ marginBottom: 22 }}>
      <h1
        style={{
          color: C.text,
          fontFamily: fonte,
          fontSize: 22,
          fontWeight: 700,
          lineHeight: 1.25,
          margin: 0,
        }}
      >
        {titulo}
      </h1>
      {subtitulo ? (
        <p style={{ color: C.sub, fontSize: 15, lineHeight: 1.5, margin: "10px 0 0" }}>
          {subtitulo}
        </p>
      ) : null}
    </header>
  );
}

// Barra de progresso: "o corretor precisa saber quanto falta".
export function Progresso({ passo, total }: { passo: number; total: number }) {
  const pct = total > 0 ? Math.round((passo / total) * 100) : 0;
  return (
    <div
      aria-label={`Passo ${passo} de ${total}`}
      role="progressbar"
      aria-valuemax={total}
      aria-valuemin={0}
      aria-valuenow={passo}
      style={{ background: C.soft, borderRadius: 999, height: 4, overflow: "hidden", width: "100%" }}
    >
      <div style={{ background: GOLD_BARRA, height: "100%", transition: "width .25s ease", width: `${pct}%` }} />
    </div>
  );
}

// A barra de progresso é PRETA, não dourada: "o preto em destaque" (Lucas, 20/jul).
// Vem de C.text (--uix-text-primary) para acompanhar a paleta em vez de repetir hex solto,
// que foi exatamente como o marrom entrou aqui.
const GOLD_BARRA = C.text;
