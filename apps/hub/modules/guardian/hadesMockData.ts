import type { AttendancePriority } from "@/modules/guardian/attendance/types";

export type HadesMockClient = {
  id: string;
  nome: string;
  cpf: string;
  telefone: string;
  idade: string;
  sexo: string;
  estadoCivil: string;
  profissao: string;
  renda: string;
  cidade: string;
  escolaridade: string;
  empreendimento: string;
  unidadeLote: string;
  quadra: string;
  lote: string;
  area: string;
  valorUnidade: number;
  parcelasTotal: number;
  parcelasLiquidadas: number;
  parcelasVencidas: number;
  parcelasAVencer: number;
  saldoAtraso: number;
  atrasoDias: number;
  scoreRisco: number;
  prioridade: AttendancePriority;
  responsavel: string;
  status: string;
  perfilParcela: string;
  vencimento: string;
  recuperado: number;
  segundaUnidade?: {
    empreendimento: string;
    unidadeLote: string;
    quadra: string;
    lote: string;
    area: string;
    valorUnidade: number;
  };
};

export const hadesMockClients: HadesMockClient[] = [];
