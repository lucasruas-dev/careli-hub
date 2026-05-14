"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  BriefcaseBusiness,
  CircleDollarSign,
  GraduationCap,
  Map,
  Radar,
  Send,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  PolarGrid,
  Radar as RadarShape,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { DetailSection } from "@/modules/attendance/components/DetailSection";

type Tone = "danger" | "gold" | "neutral" | "success";
type TrendView = "behavior" | "recovery";
type KpiId = "portfolioScore" | "criticalContracts" | "highRisk" | "predictedRecovery" | "churnProbability";

type ChatMessage = {
  id: string;
  role: "ai" | "user";
  content: string;
};

const kpis: Array<{
  id: KpiId;
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  tone: Tone;
}> = [
  { id: "portfolioScore", label: "Score médio da carteira", value: "74,8", helper: "+3,2 pts em 30 dias", icon: Activity, tone: "success" },
  { id: "criticalContracts", label: "Contratos críticos", value: "38", helper: "12 exigem ação hoje", icon: AlertTriangle, tone: "danger" },
  { id: "highRisk", label: "Risco elevado", value: "22,4%", helper: "-1,8% vs mês anterior", icon: Radar, tone: "gold" },
  { id: "predictedRecovery", label: "Recuperação prevista", value: "R$ 418 mil", helper: "próximos 30 dias", icon: CircleDollarSign, tone: "success" },
  { id: "churnProbability", label: "Probabilidade de evasão", value: "8,7%", helper: "maior em atraso 60+", icon: TrendingDown, tone: "danger" },
];

const kpiDrawerData: Record<KpiId, Array<{
  atraso: string;
  cliente: string;
  contrato: string;
  empreendimento: string;
  responsavel: string;
  saldo: string;
  scoreRisco: string;
  status: string;
  unidadeLote: string;
}>> = {
  portfolioScore: [
    { cliente: "Roberto Nogueira", empreendimento: "Reserva Alameda", unidadeLote: "Q02 L27", contrato: "CTR-2048", atraso: "0 dias", saldo: "R$ 0,00", scoreRisco: "Score 42", responsavel: "Cinthia Cruz", status: "Regularizado" },
    { cliente: "Fernanda Ruiz", empreendimento: "Jardins do Vale", unidadeLote: "Q18 L21", contrato: "CTR-1184", atraso: "0 dias", saldo: "R$ 0,00", scoreRisco: "Score 28", responsavel: "Gustavo Freitas", status: "Saudável" },
    { cliente: "Mariana Costa Lima", empreendimento: "Jardins do Vale", unidadeLote: "Q03 L04", contrato: "CTR-1307", atraso: "24 dias", saldo: "R$ 9.210,00", scoreRisco: "Score 64", responsavel: "Gustavo Freitas", status: "Aguardando retorno" },
  ],
  criticalContracts: [
    { cliente: "Carlos Henrique Matos", empreendimento: "Vista Alegre", unidadeLote: "Q07 L18", contrato: "CTR-0921", atraso: "51 dias", saldo: "R$ 32.980,00", scoreRisco: "Score 91", responsavel: "Cinthia Cruz", status: "Escalado" },
    { cliente: "Renato Pires", empreendimento: "Vista Alegre", unidadeLote: "Q10 L02", contrato: "CTR-1074", atraso: "92 dias", saldo: "R$ 18.700,00", scoreRisco: "Score 88", responsavel: "Cinthia Cruz", status: "Jurídico preventivo" },
    { cliente: "Patrícia Amaral", empreendimento: "Lavra do Ouro", unidadeLote: "Q09 L33", contrato: "CTR-1416", atraso: "44 dias", saldo: "R$ 22.640,00", scoreRisco: "Score 79", responsavel: "Gustavo Freitas", status: "Proposta enviada" },
  ],
  highRisk: [
    { cliente: "Eduardo Martins", empreendimento: "Reserva Alameda", unidadeLote: "Q15 L09", contrato: "CTR-2210", atraso: "63 dias", saldo: "R$ 28.150,00", scoreRisco: "Score 84", responsavel: "Cinthia Cruz", status: "Contato programado" },
    { cliente: "Cíntia Rocha", empreendimento: "Lavra do Ouro", unidadeLote: "Q11 L08", contrato: "CTR-1851", atraso: "29 dias", saldo: "R$ 19.400,00", scoreRisco: "Score 73", responsavel: "Gustavo Freitas", status: "Em negociação" },
    { cliente: "Marcelo Duarte", empreendimento: "Vista Alegre", unidadeLote: "Q06 L15", contrato: "CTR-1766", atraso: "14 dias", saldo: "R$ 11.800,00", scoreRisco: "Score 58", responsavel: "Cinthia Cruz", status: "Primeiro contato" },
  ],
  predictedRecovery: [
    { cliente: "Ana Paula Ribeiro", empreendimento: "Jardins do Vale", unidadeLote: "Q12 L18", contrato: "CTR-1501", atraso: "38 dias", saldo: "R$ 18.450,00", scoreRisco: "Chance 72%", responsavel: "Gustavo Freitas", status: "Em negociação" },
    { cliente: "Patrícia Amaral", empreendimento: "Lavra do Ouro", unidadeLote: "Q09 L33", contrato: "CTR-1416", atraso: "44 dias", saldo: "R$ 22.640,00", scoreRisco: "Chance 68%", responsavel: "Gustavo Freitas", status: "Proposta enviada" },
    { cliente: "Eduardo Martins", empreendimento: "Reserva Alameda", unidadeLote: "Q15 L09", contrato: "CTR-2210", atraso: "63 dias", saldo: "R$ 28.150,00", scoreRisco: "Chance 61%", responsavel: "Cinthia Cruz", status: "Contato programado" },
  ],
  churnProbability: [
    { cliente: "Renato Pires", empreendimento: "Vista Alegre", unidadeLote: "Q10 L02", contrato: "CTR-1074", atraso: "92 dias", saldo: "R$ 18.700,00", scoreRisco: "Evasão 34%", responsavel: "Cinthia Cruz", status: "Jurídico preventivo" },
    { cliente: "Carlos Henrique Matos", empreendimento: "Vista Alegre", unidadeLote: "Q07 L18", contrato: "CTR-0921", atraso: "51 dias", saldo: "R$ 32.980,00", scoreRisco: "Evasão 29%", responsavel: "Cinthia Cruz", status: "Escalado" },
    { cliente: "Cíntia Rocha", empreendimento: "Lavra do Ouro", unidadeLote: "Q11 L08", contrato: "CTR-1851", atraso: "29 dias", saldo: "R$ 19.400,00", scoreRisco: "Evasão 21%", responsavel: "Gustavo Freitas", status: "Em negociação" },
  ],
};

const profileGroups = [
  {
    title: "Sexo",
    icon: Users,
    data: [
      ["Feminino", 48, "72"],
      ["Masculino", 52, "77"],
    ],
  },
  {
    title: "Faixa etária",
    icon: Activity,
    data: [
      ["Até 30", 16, "61"],
      ["31 a 45", 42, "79"],
      ["46 a 60", 31, "82"],
      ["60+", 11, "68"],
    ],
  },
  {
    title: "Profissão",
    icon: BriefcaseBusiness,
    data: [
      ["Autônomo", 36, "84"],
      ["CLT", 27, "69"],
      ["Empresário", 21, "76"],
      ["Servidor", 16, "58"],
    ],
  },
  {
    title: "Faixa de renda",
    icon: WalletCards,
    data: [
      ["Até R$ 5 mil", 22, "86"],
      ["R$ 5 a 10 mil", 38, "78"],
      ["R$ 10 a 20 mil", 29, "66"],
      ["Acima R$ 20 mil", 11, "54"],
    ],
  },
  {
    title: "Escolaridade",
    icon: GraduationCap,
    data: [
      ["Médio", 35, "81"],
      ["Sup. incompleto", 20, "74"],
      ["Superior", 34, "66"],
      ["Pós-graduação", 11, "57"],
    ],
  },
  {
    title: "Estado civil",
    icon: Users,
    data: [
      ["Solteiro", 24, "73"],
      ["Casado", 43, "69"],
      ["Divorciado", 18, "85"],
      ["União estável", 15, "71"],
    ],
  },
].map((group) => ({
  ...group,
  data: group.data.map(([label, share, risk]) => ({ label: String(label), share: Number(share), risk: Number(risk) })),
}));

const trendViews: Record<
  TrendView,
  {
    title: string;
    description: string;
    data: Array<Record<string, number | string>>;
    lines: Array<{ key: string; name: string; color: string; fill: string }>;
    indicators: Array<{ label: string; value: string; helper: string; tone: Tone }>;
    insights: Array<{ title: string; description: string; tone: string }>;
  }
> = {
  behavior: {
    title: "Comportamento da inadimplência",
    description: "Evolução mensal da exposição ao atraso e pressão operacional da carteira.",
    data: [
      { month: "Jan", delinquency: 13.8, overdueAmount: 280, overdueClients: 94 },
      { month: "Fev", delinquency: 14.6, overdueAmount: 304, overdueClients: 101 },
      { month: "Mar", delinquency: 16.2, overdueAmount: 338, overdueClients: 116 },
      { month: "Abr", delinquency: 17.4, overdueAmount: 371, overdueClients: 128 },
      { month: "Mai", delinquency: 18.9, overdueAmount: 408, overdueClients: 137 },
      { month: "Jun", delinquency: 18.1, overdueAmount: 392, overdueClients: 131 },
    ],
    lines: [
      { key: "delinquency", name: "% inadimplência", color: "#A07C3B", fill: "url(#trendPrimaryGradient)" },
      { key: "overdueAmount", name: "Valor em atraso", color: "#0f172a", fill: "transparent" },
      { key: "overdueClients", name: "Clientes em atraso", color: "#64748b", fill: "url(#trendMutedGradient)" },
    ],
    indicators: [
      { label: "% inadimplência", value: "18,1%", helper: "-0,8 p.p. vs Maio", tone: "gold" },
      { label: "Valor em atraso", value: "R$ 392 mil", helper: "-R$ 16 mil no mês", tone: "neutral" },
      { label: "Clientes em atraso", value: "131", helper: "7 saíram da faixa crítica", tone: "success" },
    ],
    insights: [
      { title: "Vista Alegre concentra aceleração", description: "Inadimplência segue 12% acima da média da carteira nos últimos 30 dias.", tone: "danger" },
      { title: "Pressão começou a ceder", description: "Junho mostra queda em valor vencido e volume de clientes em atraso.", tone: "success" },
    ],
  },
  recovery: {
    title: "Recuperação da carteira",
    description: "Evolução mensal de recuperação financeira, eficiência e promessas cumpridas.",
    data: [
      { month: "Jan", recoveryRate: 28.4, recoveredAmount: 212, fulfilledPromises: 54 },
      { month: "Fev", recoveryRate: 31.1, recoveredAmount: 238, fulfilledPromises: 61 },
      { month: "Mar", recoveryRate: 33.8, recoveredAmount: 266, fulfilledPromises: 68 },
      { month: "Abr", recoveryRate: 36.5, recoveredAmount: 294, fulfilledPromises: 76 },
      { month: "Mai", recoveryRate: 39.2, recoveredAmount: 332, fulfilledPromises: 89 },
      { month: "Jun", recoveryRate: 42.7, recoveredAmount: 361, fulfilledPromises: 96 },
    ],
    lines: [
      { key: "recoveryRate", name: "% recuperação", color: "#059669", fill: "url(#trendPrimaryGradient)" },
      { key: "recoveredAmount", name: "Valor recuperado", color: "#A07C3B", fill: "transparent" },
      { key: "fulfilledPromises", name: "Promessas cumpridas", color: "#0f172a", fill: "url(#trendMutedGradient)" },
    ],
    indicators: [
      { label: "% recuperação", value: "42,7%", helper: "+3,5 p.p. vs Maio", tone: "success" },
      { label: "Valor recuperado", value: "R$ 361 mil", helper: "+R$ 29 mil no mês", tone: "gold" },
      { label: "Promessas cumpridas", value: "96", helper: "melhor mês do ciclo", tone: "success" },
    ],
    insights: [
      { title: "Promessas ganharam qualidade", description: "Taxa de cumprimento subiu com abordagem consultiva e confirmação no mesmo dia.", tone: "success" },
      { title: "WhatsApp puxa a recuperação", description: "Canal concentra maior volume recuperado e menor custo operacional por contato.", tone: "gold" },
    ],
  },
};

const recoveryByChannel = [
  { channel: "WhatsApp", value: 54 },
  { channel: "Ligação", value: 28 },
  { channel: "E-mail", value: 12 },
  { channel: "Portal", value: 6 },
];

const riskRadar = [
  { subject: "Atraso", value: 86 },
  { subject: "Score", value: 72 },
  { subject: "Renda", value: 58 },
  { subject: "Canal", value: 76 },
  { subject: "Histórico", value: 64 },
  { subject: "Evasão", value: 44 },
];

const enterpriseRisk = [
  ["Vista Alegre", "68", "24,8%", "Crítico", "R$ 142 mil"],
  ["Lavra do Ouro", "73", "18,6%", "Alto", "R$ 96 mil"],
  ["Jardins do Vale", "81", "12,4%", "Moderado", "R$ 118 mil"],
  ["Reserva Alameda", "86", "8,1%", "Baixo", "R$ 62 mil"],
  ["Lagoa Bonita", "71", "19,7%", "Alto", "R$ 103 mil"],
  ["Morada da Serra", "76", "16,8%", "Moderado", "R$ 92 mil"],
  ["Recanto do Pará", "69", "22,1%", "Crítico", "R$ 87 mil"],
].map(([enterprise, score, delinquency, risk, recovery]) => ({ enterprise, score, delinquency, risk, recovery }));

const strategicInsights = [
  {
    label: "Perfil com maior risco",
    value: "Autônomos, 46 a 60 anos, renda até R$ 10 mil",
    detail: "Esse grupo combina maior atraso médio e menor resposta no primeiro contato.",
  },
  {
    label: "Canal com maior recuperação",
    value: "WhatsApp consultivo",
    detail: "Conversas iniciadas entre 9h e 11h geram maior taxa de promessa cumprida.",
  },
  {
    label: "Melhor horário de contato",
    value: "10:00 às 11:30",
    detail: "Janela concentra 31% das respostas qualificadas da carteira em atraso.",
  },
  {
    label: "Comportamento da carteira",
    value: "Risco migra para 31-60 dias",
    detail: "A carteira ainda é reversível, mas exige priorização operacional nas próximas 72h.",
  },
];

const heatmapRows = [
  {
    label: "0-15 dias",
    cells: [
      {
        enterprise: "Jardins do Vale",
        city: "Goiânia",
        clients: 18,
        amount: "R$ 64 mil",
        trend: "-4%",
        severity: "Saudável",
        clientNames: ["Mariana Costa Lima", "Fernanda Ruiz", "João Batista"],
      },
      {
        enterprise: "Vista Alegre",
        city: "Anápolis",
        clients: 27,
        amount: "R$ 91 mil",
        trend: "+6%",
        severity: "Atenção",
        clientNames: ["Marcelo Duarte", "Paulo Henrique", "Rogério Campos"],
      },
      {
        enterprise: "Lavra do Ouro",
        city: "Rio Verde",
        clients: 21,
        amount: "R$ 78 mil",
        trend: "+3%",
        severity: "Atenção",
        clientNames: ["Juliana Castro", "Cíntia Rocha", "Helena Moura"],
      },
      {
        enterprise: "Reserva Alameda",
        city: "Aparecida",
        clients: 12,
        amount: "R$ 42 mil",
        trend: "-7%",
        severity: "Saudável",
        clientNames: ["Roberto Nogueira", "Eduardo Martins", "Lívia Prado"],
      },
    ],
  },
  {
    label: "16-30 dias",
    cells: [
      {
        enterprise: "Jardins do Vale",
        city: "Goiânia",
        clients: 31,
        amount: "R$ 128 mil",
        trend: "+8%",
        severity: "Atenção",
        clientNames: ["Ana Paula Ribeiro", "Mariana Costa Lima", "Fernanda Ruiz"],
      },
      {
        enterprise: "Vista Alegre",
        city: "Anápolis",
        clients: 42,
        amount: "R$ 182 mil",
        trend: "+12%",
        severity: "Risco",
        clientNames: ["Carlos Henrique Matos", "Renato Pires", "Marcelo Duarte"],
      },
      {
        enterprise: "Lavra do Ouro",
        city: "Rio Verde",
        clients: 36,
        amount: "R$ 151 mil",
        trend: "+9%",
        severity: "Risco",
        clientNames: ["Patrícia Amaral", "Cíntia Rocha", "Juliana Castro"],
      },
      {
        enterprise: "Reserva Alameda",
        city: "Aparecida",
        clients: 23,
        amount: "R$ 86 mil",
        trend: "+2%",
        severity: "Atenção",
        clientNames: ["Eduardo Martins", "Paulo Henrique", "Roberto Nogueira"],
      },
    ],
  },
  {
    label: "31-60 dias",
    cells: [
      {
        enterprise: "Jardins do Vale",
        city: "Goiânia",
        clients: 39,
        amount: "R$ 214 mil",
        trend: "+11%",
        severity: "Risco",
        clientNames: ["Ana Paula Ribeiro", "Mariana Costa Lima", "Diego Ramos"],
      },
      {
        enterprise: "Vista Alegre",
        city: "Anápolis",
        clients: 58,
        amount: "R$ 326 mil",
        trend: "+18%",
        severity: "Crítico",
        clientNames: ["Carlos Henrique Matos", "Renato Pires", "Marcelo Duarte"],
      },
      {
        enterprise: "Lavra do Ouro",
        city: "Rio Verde",
        clients: 47,
        amount: "R$ 248 mil",
        trend: "+14%",
        severity: "Risco",
        clientNames: ["Patrícia Amaral", "Cíntia Rocha", "Marta Azevedo"],
      },
      {
        enterprise: "Reserva Alameda",
        city: "Aparecida",
        clients: 29,
        amount: "R$ 119 mil",
        trend: "+5%",
        severity: "Atenção",
        clientNames: ["Eduardo Martins", "Paulo Henrique", "Sérgio Lima"],
      },
    ],
  },
  {
    label: "60+ dias",
    cells: [
      {
        enterprise: "Jardins do Vale",
        city: "Goiânia",
        clients: 26,
        amount: "R$ 188 mil",
        trend: "-3%",
        severity: "Risco",
        clientNames: ["Ana Paula Ribeiro", "Bruna Almeida", "Diego Ramos"],
      },
      {
        enterprise: "Vista Alegre",
        city: "Anápolis",
        clients: 51,
        amount: "R$ 412 mil",
        trend: "+21%",
        severity: "Crítico",
        clientNames: ["Carlos Henrique Matos", "Renato Pires", "Marcos Faria"],
      },
      {
        enterprise: "Lavra do Ouro",
        city: "Rio Verde",
        clients: 44,
        amount: "R$ 337 mil",
        trend: "+16%",
        severity: "Crítico",
        clientNames: ["Patrícia Amaral", "Cíntia Rocha", "Marta Azevedo"],
      },
      {
        enterprise: "Reserva Alameda",
        city: "Aparecida",
        clients: 32,
        amount: "R$ 174 mil",
        trend: "+7%",
        severity: "Risco",
        clientNames: ["Eduardo Martins", "Sérgio Lima", "Lívia Prado"],
      },
    ],
  },
];

export function IntelligencePage() {
  const [trendView, setTrendView] = useState<TrendView>("behavior");
  const [selectedKpi, setSelectedKpi] = useState<KpiId | null>(null);
  const currentTrend = trendViews[trendView];
  const selectedKpiData = selectedKpi ? kpis.find((item) => item.id === selectedKpi) : null;

  return (
    <div className="flex min-h-[calc(100vh-7rem)] w-full flex-col gap-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {kpis.map((item) => (
          <IntelligenceKpi key={item.label} {...item} onClick={() => setSelectedKpi(item.id)} />
        ))}
      </section>

      <section className="grid gap-4 2xl:grid-cols-[1.35fr_0.65fr]">
        <DetailSection title="Tendências" icon={TrendingUp} accent className="min-h-[420px]">
          <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">{currentTrend.title}</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{currentTrend.description}</p>
            </div>
            <div className="inline-flex w-full rounded-xl bg-slate-50 p-1 ring-1 ring-slate-200/70 sm:w-auto">
              {[
                ["behavior", "Comportamento"],
                ["recovery", "Recuperação"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTrendView(value as TrendView)}
                  className={`h-9 flex-1 rounded-lg px-3 text-sm font-medium transition-colors sm:flex-none ${
                    trendView === value
                      ? "bg-white text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                      : "text-slate-500 hover:text-slate-950"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
            <div className="h-[305px]">
              <ChartReady>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={currentTrend.data} margin={{ left: -20, right: 12, top: 12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="trendPrimaryGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor={currentTrend.lines[0].color} stopOpacity={0.28} />
                        <stop offset="95%" stopColor={currentTrend.lines[0].color} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="trendMutedGradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#64748b" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#64748b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis axisLine={false} dataKey="month" tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                    <Tooltip content={<ChartTooltip />} />
                    {currentTrend.lines.map((line) => (
                      <Area
                        key={line.key}
                        dataKey={line.key}
                        fill={line.fill}
                        name={line.name}
                        stroke={line.color}
                        strokeWidth={2.4}
                        type="monotone"
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </ChartReady>
            </div>

            <div className="space-y-3">
              {currentTrend.indicators.map((indicator) => (
                <TrendMetricCard key={indicator.label} {...indicator} />
              ))}
              {currentTrend.insights.map((insight) => (
                <InsightCard key={insight.title} {...insight} />
              ))}
            </div>
          </div>
        </DetailSection>
        <DetailSection title="IA estratégica" icon={Brain} accent className="min-h-[360px]">
          <div className="space-y-3">
            {strategicInsights.map((insight) => (
              <article key={insight.label} className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
                    <Sparkles className="size-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{insight.label}</p>
                    <h3 className="mt-1 text-sm font-semibold text-slate-950">{insight.value}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{insight.detail}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </DetailSection>
      </section>

      <DetailSection title="Perfil da inadimplência" icon={Users} accent>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {profileGroups.map((group) => (
            <ProfileCard key={group.title} {...group} />
          ))}
        </div>
      </DetailSection>

      <section className="grid gap-4 2xl:grid-cols-[1.05fr_0.95fr]">
        <RiskByEnterpriseBlock />
        <AnalyticChartsBlock />
      </section>

      <OperationalMapBlock />
      <GuardianIntelligenceAssistant />
      <KpiContractsDrawer
        items={selectedKpi ? kpiDrawerData[selectedKpi] : []}
        onClose={() => setSelectedKpi(null)}
        title={selectedKpiData?.label ?? ""}
      />
    </div>
  );
}

function IntelligenceKpi({
  helper,
  icon: Icon,
  label,
  onClick,
  tone,
  value,
}: {
  helper: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone: Tone;
  value: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-xl border border-slate-200/70 bg-white p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#A07C3B]/20 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className={`mt-3 text-2xl font-semibold tracking-normal ${getToneTextClass(tone)}`}>{value}</p>
          <p className="mt-1 text-sm text-slate-500">{helper}</p>
        </div>
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ${getToneSoftClass(tone)}`}>
          <Icon className="size-4" aria-hidden="true" />
        </div>
      </div>
    </button>
  );
}

function ProfileCard({
  data,
  icon: Icon,
  title,
}: {
  data: Array<{ label: string; risk: number; share: number }>;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <article className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-xl bg-white text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
            <Icon className="size-4" aria-hidden="true" />
          </div>
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        </div>
        <span className="text-xs font-medium text-slate-400">risco</span>
      </div>
      <div className="space-y-3">
        {data.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm text-slate-600">{item.label}</span>
              <span className="text-sm font-semibold text-slate-950">{item.risk}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white ring-1 ring-slate-200/70">
                <div className="h-full rounded-full bg-[#A07C3B]/70" style={{ width: `${item.risk}%` }} />
              </div>
              <span className="w-10 text-right text-xs font-medium text-slate-400">{item.share}%</span>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function KpiContractsDrawer({
  items,
  onClose,
  title,
}: {
  items: Array<{
    atraso: string;
    cliente: string;
    contrato: string;
    empreendimento: string;
    responsavel: string;
    saldo: string;
    scoreRisco: string;
    status: string;
    unidadeLote: string;
  }>;
  onClose: () => void;
  title: string;
}) {
  const isOpen = Boolean(title);

  return (
    <div
      className={`fixed inset-0 z-50 transition ${isOpen ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!isOpen}
    >
      <button
        type="button"
        aria-label="Fechar detalhes do KPI"
        onClick={onClose}
        className={`absolute inset-0 bg-slate-950/20 backdrop-blur-[2px] transition-opacity ${isOpen ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        className={`absolute right-0 top-0 flex h-full w-full max-w-[720px] flex-col border-l border-slate-200/70 bg-white shadow-[-24px_0_70px_rgba(15,23,42,0.18)] transition-transform duration-300 ease-out ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        <header className="border-b border-slate-100 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#A07C3B]">Detalhamento do KPI</p>
              <h2 className="mt-2 text-lg font-semibold text-slate-950">{title}</h2>
              <p className="mt-1 text-sm text-slate-500">Clientes e contratos relacionados ao indicador selecionado.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar painel"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-3">
            {items.map((item) => (
              <article key={`${title}-${item.contrato}`} className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-950">{item.cliente}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {item.empreendimento} · {item.unidadeLote} · {item.contrato}
                    </p>
                  </div>
                  <span className="w-fit rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200/70">
                    {item.status}
                  </span>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <InfoTile label="Atraso" value={item.atraso} />
                  <InfoTile label="Saldo" value={item.saldo} />
                  <InfoTile label="Score risco" value={item.scoreRisco} tone={item.scoreRisco.includes("91") || item.scoreRisco.includes("88") ? "danger" : "gold"} />
                  <InfoTile label="Responsável" value={item.responsavel} />
                  <InfoTile label="Status" value={item.status} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

function RiskByEnterpriseBlock() {
  return (
    <DetailSection title="Risco por empreendimento" icon={BarChart3} accent className="h-full">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase tracking-normal text-slate-500">
            <tr className="border-b border-slate-100">
              <th className="pb-3 font-medium">Empreendimento</th>
              <th className="pb-3 font-medium">Score médio</th>
              <th className="pb-3 font-medium">Inadimplência</th>
              <th className="pb-3 font-medium">Risco</th>
              <th className="pb-3 font-medium">Recuperação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {enterpriseRisk.map((item) => (
              <tr key={item.enterprise}>
                <td className="py-4 font-semibold text-slate-950">{item.enterprise}</td>
                <td className="py-4 text-slate-600">{item.score}</td>
                <td className="py-4 font-medium text-slate-950">{item.delinquency}</td>
                <td className="py-4"><RiskBadge risk={item.risk} /></td>
                <td className="py-4 font-semibold text-slate-950">{item.recovery}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DetailSection>
  );
}

function AnalyticChartsBlock() {
  return (
    <DetailSection title="Sinais preditivos" icon={Target} className="h-full">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-[260px] rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
          <p className="mb-3 text-sm font-semibold text-slate-950">Recuperação por canal</p>
          <ChartReady>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={recoveryByChannel} margin={{ left: -20, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                <XAxis axisLine={false} dataKey="channel" tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" name="Recuperação" radius={[8, 8, 0, 0]}>
                  {recoveryByChannel.map((entry, index) => (
                    <Cell key={entry.channel} fill={index === 0 ? "#A07C3B" : "#CBD5E1"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartReady>
        </div>

        <div className="h-[260px] rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
          <p className="mb-3 text-sm font-semibold text-slate-950">Radar de risco</p>
          <ChartReady>
            <ResponsiveContainer width="100%" height="85%">
              <RadarChart data={riskRadar}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "#64748b", fontSize: 11 }} />
                <RadarShape dataKey="value" fill="#A07C3B" fillOpacity={0.18} name="Risco" stroke="#A07C3B" strokeWidth={2} />
                <Tooltip content={<ChartTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
          </ChartReady>
        </div>
      </div>
    </DetailSection>
  );
}

function OperationalMapBlock() {
  const [selectedCell, setSelectedCell] = useState<{
    amount: string;
    city: string;
    clients: number;
    clientNames: string[];
    enterprise: string;
    range: string;
    severity: string;
    trend: string;
  } | null>(null);

  return (
    <>
      <DetailSection title="Mapa operacional" icon={Map} accent>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {["Saudável", "Atenção", "Risco", "Crítico"].map((severity) => (
            <span
              key={severity}
              className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${getSeverityBadgeClass(severity)}`}
            >
              <span className={`size-2 rounded-full ${getSeverityDotClass(severity)}`} />
              {severity}
            </span>
          ))}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[920px]">
            <div className="grid grid-cols-[120px_repeat(4,minmax(170px,1fr))] gap-3">
              <div />
              {heatmapRows[0].cells.map((cell) => (
                <div key={cell.enterprise} className="px-3 pb-1">
                  <p className="text-xs font-semibold uppercase tracking-normal text-slate-500">{cell.enterprise}</p>
                </div>
              ))}

              {heatmapRows.map((row) => (
                <div key={row.label} className="contents">
                  <div className="flex items-center rounded-xl bg-slate-50 px-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-200/70">
                    {row.label}
                  </div>
                  {row.cells.map((cell) => {
                    const isUp = cell.trend.startsWith("+");

                    return (
                      <button
                        key={`${row.label}-${cell.enterprise}`}
                        type="button"
                        onClick={() => setSelectedCell({ ...cell, range: row.label })}
                        className={`min-h-[142px] rounded-xl p-4 text-left ring-1 transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(15,23,42,0.10)] ${getOperationalHeatClass(cell.severity)}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${getSeverityBadgeClass(cell.severity)}`}>
                            {cell.severity}
                          </span>
                          <span className={`text-xs font-semibold ${isUp ? "text-rose-700" : "text-emerald-700"}`}>
                            {isUp ? "↑" : "↓"} {cell.trend}
                          </span>
                        </div>

                        <div className="mt-5 space-y-1">
                          <p className="text-xl font-semibold tracking-normal text-slate-950">{cell.clients} clientes</p>
                          <p className="text-sm font-semibold text-slate-700">{cell.amount}</p>
                          <p className="text-xs text-slate-500">em atraso na faixa</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </DetailSection>

      {selectedCell ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Fechar detalhes do mapa operacional"
            onClick={() => setSelectedCell(null)}
            className="absolute inset-0 bg-slate-950/20 backdrop-blur-[2px]"
          />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-[420px] flex-col border-l border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            <header className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#A07C3B]">Mapa operacional</p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-950">{selectedCell.enterprise}</h2>
                  <p className="mt-1 text-sm text-slate-500">{selectedCell.city} · {selectedCell.range}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCell(null)}
                  aria-label="Fechar painel"
                  className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div className="grid grid-cols-3 gap-2">
                <InfoTile label="Clientes" value={String(selectedCell.clients)} />
                <InfoTile label="Atraso" value={selectedCell.amount} />
                <InfoTile label="Tendência" value={selectedCell.trend} tone={selectedCell.trend.startsWith("+") ? "danger" : "success"} />
              </div>

              <article className={`rounded-xl p-4 ring-1 ${getOperationalHeatClass(selectedCell.severity)}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-950">Prioridade operacional</span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${getSeverityBadgeClass(selectedCell.severity)}`}>
                    {selectedCell.severity}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Ação recomendada: priorizar os maiores saldos, confirmar canal preferencial e acionar promessas com vencimento nas próximas 48h.
                </p>
              </article>

              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Clientes mockados</p>
                <div className="space-y-2">
                  {selectedCell.clientNames.map((client, index) => (
                    <div key={client} className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">{client}</p>
                        <p className="mt-1 text-xs text-slate-500">Score operacional {82 - index * 7}/100</p>
                      </div>
                      <span className="text-xs font-medium text-slate-500">#{index + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function TrendMetricCard({
  helper,
  label,
  tone,
  value,
}: {
  helper: string;
  label: string;
  tone: Tone;
  value: string;
}) {
  return (
    <article className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-2 text-xl font-semibold tracking-normal ${getToneTextClass(tone)}`}>{value}</p>
      <p className="mt-1 text-sm text-slate-500">{helper}</p>
    </article>
  );
}

const assistantSuggestions = [
  {
    label: "Resumir carteira",
    response: "A carteira tem score médio de 74,8, recuperação prevista de R$ 418 mil e concentração de risco nas faixas de 31-60 dias e 60+ dias.",
  },
  {
    label: "Mostrar maior risco",
    response: "O maior risco está em Vista Alegre acima de 60 dias: 51 clientes, R$ 412 mil em atraso e tendência de alta de 21%.",
  },
  {
    label: "Explicar tendência",
    response: "A inadimplência aumentou 14% no empreendimento Vista Alegre nos últimos 45 dias, puxada por contratos entre 31 e 60 dias.",
  },
  {
    label: "Melhor operador",
    response: "Gustavo Freitas possui melhor recuperação da carteira nos últimos 30 dias, com maior taxa de promessas cumpridas e menor reincidência.",
  },
  {
    label: "Perfil mais inadimplente",
    response: "Clientes autônomos entre 31 e 45 anos apresentam maior risco acima de 60 dias e menor resposta no primeiro contato.",
  },
  {
    label: "Empreendimento crítico",
    response: "Vista Alegre é o empreendimento crítico do momento, com inadimplência acima da média, maior volume em atraso e tendência de alta.",
  },
];

function GuardianIntelligenceAssistant() {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "initial-intelligence",
      role: "ai",
      content: "Olá. Sou o Guardian Intelligence, seu analista estratégico da carteira. Posso explicar tendências, apontar riscos e sugerir ações operacionais com base nos dados mockados desta tela.",
    },
  ]);

  function addAssistantMessage(content: string) {
    setMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        role: "ai",
        content,
      },
    ]);
  }

  function sendMockQuestion() {
    const question = inputValue.trim();

    if (!question) {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: `${Date.now()}-user`,
        role: "user",
        content: question,
      },
      {
        id: `${Date.now()}-ai`,
        role: "ai",
        content: "Analisando a carteira mockada, eu priorizaria Vista Alegre acima de 60 dias, clientes autônomos com atraso recorrente e promessas vencidas sem confirmação nas últimas 48h.",
      },
    ]);
    setInputValue("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir Guardian Intelligence"
        className="fixed bottom-6 right-6 z-40 flex h-12 items-center gap-3 rounded-2xl border border-[#A07C3B]/20 bg-white px-4 text-[#7A5E2C] shadow-[0_18px_50px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-0.5 hover:bg-[#A07C3B]/5"
      >
        <Brain className="size-5" aria-hidden="true" />
        <span className="hidden text-sm font-semibold sm:block">IA</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Fechar Guardian Intelligence"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-slate-950/20 backdrop-blur-[2px]"
          />

          <aside className="absolute right-0 top-0 flex h-full w-full max-w-[460px] flex-col border-l border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            <header className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
                    <Brain className="size-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">Guardian Intelligence</h2>
                    <p className="mt-1 text-sm text-slate-500">Analista estratégico da carteira</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Fechar painel"
                  className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              <div className="grid grid-cols-3 gap-2">
                <InfoTile label="Score" value="74,8" />
                <InfoTile label="Risco" value="22,4%" tone="gold" />
                <InfoTile label="Previsão" value="R$ 418 mil" tone="success" />
              </div>

              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex items-start gap-3 ${message.role === "user" ? "justify-end" : ""}`}
                  >
                    {message.role === "ai" ? (
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
                        <Sparkles className="size-4" aria-hidden="true" />
                      </div>
                    ) : null}

                    <div
                      className={`max-w-[330px] rounded-2xl px-4 py-3 ${
                        message.role === "user"
                          ? "rounded-tr-sm bg-[#A07C3B] text-white"
                          : "rounded-tl-sm border border-slate-200/70 bg-slate-50/80 text-slate-700"
                      }`}
                    >
                      <p className="text-sm leading-6">{message.content}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-normal text-slate-400">Sugestões rápidas</p>
                <div className="flex flex-wrap gap-2">
                  {assistantSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.label}
                      type="button"
                      onClick={() => addAssistantMessage(suggestion.response)}
                      className="rounded-full border border-slate-200/70 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
                    >
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 p-4">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-3 py-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      sendMockQuestion();
                    }
                  }}
                  placeholder="Pergunte sobre a carteira"
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                />
                <button
                  type="button"
                  aria-label="Enviar pergunta"
                  onClick={sendMockQuestion}
                  className="flex size-9 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8f6e33]"
                >
                  <Send className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function InfoTile({ label, tone = "neutral", value }: { label: string; tone?: Tone; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 truncate text-sm font-semibold ${getToneTextClass(tone)}`}>{value}</p>
    </div>
  );
}

function InsightCard({ description, title, tone }: { description: string; title: string; tone: string }) {
  return (
    <article className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4">
      <div className="flex items-start gap-3">
        <div className={`mt-1 size-2.5 shrink-0 rounded-full ${tone === "danger" ? "bg-rose-500" : tone === "success" ? "bg-emerald-500" : "bg-[#A07C3B]"}`} />
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
        </div>
      </div>
    </article>
  );
}

function ChartReady({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setReady(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  if (!ready) {
    return <div className="h-full w-full rounded-xl bg-slate-100/50" />;
  }

  return children;
}

function RiskBadge({ risk }: { risk: string }) {
  const className = {
    "Alto": "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
    "Baixo": "bg-emerald-50 text-emerald-700 ring-emerald-100",
    "Crítico": "bg-rose-50 text-rose-700 ring-rose-100",
    "Moderado": "bg-slate-50 text-slate-700 ring-slate-200",
  }[risk];

  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${className}`}>{risk}</span>;
}

function ChartTooltip({ active, label, payload }: { active?: boolean; label?: string; payload?: Array<{ name?: string; value?: number | string; color?: string }> }) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-3 py-2 shadow-[0_14px_40px_rgba(15,23,42,0.12)]">
      {label ? <p className="mb-1 text-xs font-semibold text-slate-500">{label}</p> : null}
      <div className="space-y-1">
        {payload.map((item) => (
          <div key={`${item.name}-${item.value}`} className="flex items-center justify-between gap-5 text-xs">
            <span className="text-slate-500">{item.name}</span>
            <span className="font-semibold text-slate-950">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function getOperationalHeatClass(severity: string) {
  return {
    "Atenção": "border-yellow-200/80 bg-yellow-50/80 ring-yellow-200/80",
    "Crítico": "border-red-200/80 bg-red-50/85 ring-red-200/80",
    "Risco": "border-orange-200/80 bg-orange-50/85 ring-orange-200/80",
    "Saudável": "border-slate-200/80 bg-slate-50/85 ring-slate-200/80",
  }[severity] ?? "border-slate-200/80 bg-slate-50/85 ring-slate-200/80";
}

function getSeverityBadgeClass(severity: string) {
  return {
    "Atenção": "bg-yellow-100/80 text-yellow-800 ring-yellow-200",
    "Crítico": "bg-red-100/80 text-red-800 ring-red-200",
    "Risco": "bg-orange-100/80 text-orange-800 ring-orange-200",
    "Saudável": "bg-slate-100 text-slate-700 ring-slate-200",
  }[severity] ?? "bg-slate-100 text-slate-700 ring-slate-200";
}

function getSeverityDotClass(severity: string) {
  return {
    "Atenção": "bg-yellow-400",
    "Crítico": "bg-red-500",
    "Risco": "bg-orange-500",
    "Saudável": "bg-slate-400",
  }[severity] ?? "bg-slate-400";
}

function getToneSoftClass(tone: Tone) {
  return {
    danger: "bg-rose-50 text-rose-700 ring-rose-100",
    gold: "bg-[#A07C3B]/5 text-[#A07C3B] ring-[#A07C3B]/15",
    neutral: "bg-slate-50 text-slate-600 ring-slate-200/70",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  }[tone];
}

function getToneTextClass(tone: Tone) {
  return {
    danger: "text-rose-700",
    gold: "text-[#7A5E2C]",
    neutral: "text-slate-950",
    success: "text-emerald-700",
  }[tone];
}
