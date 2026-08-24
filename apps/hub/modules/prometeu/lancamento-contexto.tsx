"use client";

import { createContext, useContext } from "react";

import type { PrometeuEvento } from "@/lib/prometeu/types";

// O LANÇAMENTO SELECIONADO NA TELA INICIAL (Lucas, 24/08: "podemos ter uma tela inicial para
// selecionar os lançamentos"). O módulo abre na seleção; escolhido o lançamento, ele vive
// aqui e TODAS as telas o usam — com fallback no eventoDoDia para os caminhos antigos
// (posto do operador via /m, que não passa pela seleção).
const LancamentoContext = createContext<null | PrometeuEvento>(null);

export const LancamentoProvider = LancamentoContext.Provider;

export function useLancamentoSelecionado(): null | PrometeuEvento {
  return useContext(LancamentoContext);
}
