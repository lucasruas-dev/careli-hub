"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buscarCidades, textoDaCidade, type Cidade } from "@/lib/apolo/cidades";

// CAMPO DE CIDADE com sugestão, do jeito que o campo de profissão já funciona.
//
// Pedido do Lucas (21/08/2026): *"esse campo de cidades tem que ser padrão, igual profissão:
// começo a digitar, ele puxa a cidade correta; se quiser colocar um UF antes para mitigar a busca,
// pode colocar"*.
//
// ⚠️ NÃO É UM <select>, e essa é a diferença para profissão. São 5.601 municípios: uma lista
// suspensa com todos é inutilizável, e o C2X guarda a naturalidade como TEXTO LIVRE, não como id.
// Então o campo continua sendo um input — o que muda é que ele ensina o valor certo enquanto a
// pessoa digita, em vez de aceitar qualquer coisa calado (hoje há "NAO INFORMADO" gravado em 569
// cadastros).
//
// ⚠️ A LISTA ENTRA POR IMPORT DINÂMICO. O arquivo tem 119KB; carregá-lo no bundle de todo mundo
// para um campo que poucos abrem seria pagar caro por pouco. Ele chega na primeira tecla e fica.

// Módulo carregado uma vez por sessão, compartilhado entre todas as instâncias do campo.
let cache: null | readonly string[] = null;
let carregando: null | Promise<readonly string[]> = null;

async function carregarCidades(): Promise<readonly string[]> {
  if (cache) return cache;
  carregando ??= import("@/lib/apolo/c2x-cidades").then((m) => {
    cache = m.C2X_CIDADES;
    return cache;
  });
  return carregando;
}

export function CampoCidade({
  className,
  onChange,
  placeholder = "—",
  valor,
}: {
  className?: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  valor: string;
}) {
  const [linhas, setLinhas] = useState<null | readonly string[]>(cache);
  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState<null | string>(null);
  const caixa = useRef<HTMLDivElement | null>(null);

  // Fecha ao clicar fora. Sem isto a lista fica pendurada sobre o resto do formulário depois que
  // o operador desiste e vai mexer em outro campo.
  useEffect(() => {
    if (!aberto) return;

    const aoClicar = (evento: MouseEvent) => {
      if (!caixa.current?.contains(evento.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", aoClicar);
    return () => document.removeEventListener("mousedown", aoClicar);
  }, [aberto]);

  // ⚠️ O QUE FILTRA É O QUE FOI DIGITADO AGORA, não o valor do campo. Sem essa distinção, abrir
  // uma ficha que já tem "João Monlevade" mostraria a sugestão dela na hora, como se o operador
  // estivesse escolhendo de novo.
  const sugestoes = useMemo<Cidade[]>(
    () => (aberto && digitado && linhas ? buscarCidades(digitado, linhas) : []),
    [aberto, digitado, linhas],
  );

  const aoDigitar = useCallback(
    (bruto: string) => {
      setDigitado(bruto);
      setAberto(true);
      onChange(bruto);

      if (!cache) void carregarCidades().then(setLinhas);
    },
    [onChange],
  );

  const escolher = useCallback(
    (cidade: Cidade) => {
      onChange(textoDaCidade(cidade));
      setDigitado(null);
      setAberto(false);
    },
    [onChange],
  );

  return (
    <div className="relative" ref={caixa}>
      <input
        className={className}
        onChange={(evento) => aoDigitar(evento.target.value)}
        onFocus={() => {
          if (!cache) void carregarCidades().then(setLinhas);
        }}
        placeholder={placeholder}
        type="text"
        value={valor}
      />

      {sugestoes.length > 0 ? (
        <ul className="absolute left-0 right-0 top-full z-30 m-0 mt-1 max-h-56 list-none overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
          {sugestoes.map((cidade) => (
            <li key={`${cidade.nome}|${cidade.uf}`}>
              <button
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-ink hover:bg-subtle"
                // `onMouseDown` e não `onClick`: o clique tira o foco do input antes, e o blur
                // fecharia a lista fazendo o clique cair no vazio.
                onMouseDown={(evento) => {
                  evento.preventDefault();
                  escolher(cidade);
                }}
                type="button"
              >
                <span>{cidade.nome}</span>
                {/* A UF fica na sugestão, e não no campo: 247 nomes se repetem entre estados, e é
                    aqui que essa informação resolve — na hora de escolher a certa. */}
                <span className="shrink-0 text-[11px] font-semibold text-ink-muted">
                  {cidade.uf}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
