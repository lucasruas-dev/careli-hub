"use client";

import type {
  PanteonAddressRecord,
  PanteonAddressRegistry,
  PanteonAddressRegistrySummary,
} from "@/lib/squadops/address-registry-source";
import { EmptyState, PanelTitle } from "@/modules/squadops/blocks/shared/operations-ui";
import { Surface, Tooltip } from "@repo/uix";
import {
  ChevronRight,
  Clipboard,
  Copy,
  FileJson2,
  Loader2,
  Map as MapIcon,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type AddressCatalogProps = {
  accessToken: string | null;
  isActive: boolean;
  onSummaryChange?: (summary: PanteonAddressRegistrySummary | null) => void;
};

type AddressCatalogFilters = {
  level: string;
  module: string;
  query: string;
  status: string;
};

const addressLevelLabels = {
  city: "Cidade",
  district: "Bairro",
  house: "Casa",
  street: "Rua",
} as const satisfies Record<PanteonAddressRecord["level"], string>;

const addressStatusLabels: Record<string, string> = {
  active: "Ativo",
  protected: "Protegido",
};

export function PanteonAddressCatalog({
  accessToken,
  isActive,
  onSummaryChange,
}: AddressCatalogProps) {
  const [registry, setRegistry] = useState<PanteonAddressRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedAddressCode, setSelectedAddressCode] = useState<string | null>(
    null,
  );
  const [copiedAction, setCopiedAction] = useState<string | null>(null);
  const [filters, setFilters] = useState<AddressCatalogFilters>({
    level: "todos",
    module: "todos",
    query: "",
    status: "todos",
  });

  const loadRegistry = useCallback(async () => {
    if (!accessToken) {
      setError("Sessao administrativa ausente para carregar o Address.");
      setRegistry(null);
      onSummaryChange?.(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/zeus/address-catalog", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as
        | PanteonAddressRegistry
        | { error?: string }
        | null;

      if (!response.ok || !payload || !("addresses" in payload)) {
        throw new Error(
          payload && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "Nao foi possivel carregar o catalogo Address.",
        );
      }

      setRegistry(payload);
      onSummaryChange?.(payload.summary);
      setSelectedAddressCode((currentCode) =>
        currentCode &&
        payload.addresses.some((address) => address.addressCode === currentCode)
          ? currentCode
          : payload.cityBaseline.addressCode,
      );
    } catch (loadError) {
      setRegistry(null);
      onSummaryChange?.(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar o catalogo Address.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, onSummaryChange]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    void loadRegistry();
  }, [isActive, loadRegistry]);

  const filteredAddresses = useMemo(() => {
    if (!registry) {
      return [];
    }

    const normalizedQuery = normalizeSearchText(filters.query);

    return registry.addresses.filter((address) => {
      if (filters.level !== "todos" && address.level !== filters.level) {
        return false;
      }

      if (filters.module !== "todos" && address.module !== filters.module) {
        return false;
      }

      if (filters.status !== "todos" && address.status !== filters.status) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return getAddressSearchText(address).includes(normalizedQuery);
    });
  }, [filters, registry]);

  const addressByCode = useMemo(() => {
    const mapByCode = new Map<string, PanteonAddressRecord>();

    for (const address of registry?.addresses ?? []) {
      mapByCode.set(address.addressCode, address);
    }

    return mapByCode;
  }, [registry]);

  const childrenByParent = useMemo(() => {
    const mapByParent = new Map<string, PanteonAddressRecord[]>();

    for (const address of registry?.addresses ?? []) {
      if (!address.parentAddressCode) {
        continue;
      }

      const siblings = mapByParent.get(address.parentAddressCode) ?? [];
      siblings.push(address);
      mapByParent.set(address.parentAddressCode, siblings);
    }

    for (const [parentCode, siblings] of mapByParent.entries()) {
      mapByParent.set(parentCode, siblings.sort(compareAddressRecords));
    }

    return mapByParent;
  }, [registry]);

  const visibleAddressCodes = useMemo(() => {
    const directMatches = new Set(
      filteredAddresses.map((address) => address.addressCode),
    );
    const visibleCodes = new Set<string>();

    const includeWithAncestors = (address: PanteonAddressRecord) => {
      visibleCodes.add(address.addressCode);

      if (address.parentAddressCode) {
        const parent = addressByCode.get(address.parentAddressCode);

        if (parent) {
          includeWithAncestors(parent);
        }
      }
    };

    for (const address of filteredAddresses) {
      includeWithAncestors(address);
    }

    if (directMatches.size === 0 && registry?.addresses.length) {
      visibleCodes.add(registry.cityBaseline.addressCode);
    }

    return visibleCodes;
  }, [addressByCode, filteredAddresses, registry]);

  const selectedAddress =
    (selectedAddressCode ? addressByCode.get(selectedAddressCode) : null) ??
    filteredAddresses[0] ??
    registry?.addresses[0] ??
    null;

  const moduleOptions = useMemo(
    () =>
      [...new Set((registry?.addresses ?? []).map((address) => address.module))]
        .filter(Boolean)
        .sort((firstModule, secondModule) =>
          firstModule.localeCompare(secondModule, "pt-BR", {
            sensitivity: "base",
          }),
        ),
    [registry],
  );

  const statusOptions = useMemo(
    () =>
      [...new Set((registry?.addresses ?? []).map((address) => address.status))]
        .filter(Boolean)
        .sort((firstStatus, secondStatus) =>
          firstStatus.localeCompare(secondStatus, "pt-BR", {
            sensitivity: "base",
          }),
        ),
    [registry],
  );

  const handleCopy = useCallback(async (value: string, actionId: string) => {
    if (!value.trim()) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopiedAction(actionId);
    window.setTimeout(() => setCopiedAction(null), 1600);
  }, []);

  const cityAddress = registry?.addresses.find(
    (address) => address.level === "city",
  );

  return (
    <section className="grid gap-5">
      <Surface className="overflow-hidden border border-slate-200/70 bg-white p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
          <PanelTitle
            eyebrow="Zeus Address"
            icon={<MapIcon size={18} />}
            title="Catalogo CEP operacional"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
              {registry?.summary.cityBaselineCode ?? "PNT-01-00-00-000"}
            </span>
            <Tooltip content="Atualizar catalogo" placement="bottom">
              <button
                aria-label="Atualizar catalogo Address"
                className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-[#A07C3B]/30 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={() => void loadRegistry()}
                type="button"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Clipboard className="size-4" />
                )}
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="grid gap-3 p-4 lg:grid-cols-4">
          <AddressMetric
            label="Enderecos"
            value={registry?.summary.totalAddresses ?? 0}
          />
          <AddressMetric
            label="Casas"
            tone="gold"
            value={registry?.summary.houses ?? 0}
          />
          <AddressMetric
            label="Protegidos"
            tone="danger"
            value={registry?.summary.protectedAddresses ?? 0}
          />
          <AddressMetric
            label="Modulos"
            tone="success"
            value={registry?.summary.modules.length ?? 0}
          />
        </div>

        <div className="grid gap-3 border-t border-slate-100 bg-slate-50/60 p-4 lg:grid-cols-[minmax(14rem,1fr)_11rem_11rem_11rem]">
          <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus-within:border-[#A07C3B]/45 focus-within:ring-2 focus-within:ring-[#A07C3B]/10">
            <Search className="size-4 shrink-0 text-slate-400" />
            <input
              aria-label="Buscar CEP, modulo, rota, arquivo ou owner"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,
                  query: event.target.value,
                }))
              }
              placeholder="CEP, modulo, rota, arquivo ou owner"
              type="search"
              value={filters.query}
            />
            {filters.query.trim() ? (
              <button
                aria-label="Limpar busca"
                className="grid size-6 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                onClick={() =>
                  setFilters((currentFilters) => ({
                    ...currentFilters,
                    query: "",
                  }))
                }
                type="button"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </label>
          <AddressSelect
            label="Modulo"
            onChange={(value) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                module: value,
              }))
            }
            value={filters.module}
          >
            <option value="todos">Todos</option>
            {moduleOptions.map((moduleName) => (
              <option key={moduleName} value={moduleName}>
                {formatModuleName(moduleName)}
              </option>
            ))}
          </AddressSelect>
          <AddressSelect
            label="Nivel"
            onChange={(value) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                level: value,
              }))
            }
            value={filters.level}
          >
            <option value="todos">Todos</option>
            {Object.entries(addressLevelLabels).map(([level, label]) => (
              <option key={level} value={level}>
                {label}
              </option>
            ))}
          </AddressSelect>
          <AddressSelect
            label="Status"
            onChange={(value) =>
              setFilters((currentFilters) => ({
                ...currentFilters,
                status: value,
              }))
            }
            value={filters.status}
          >
            <option value="todos">Todos</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {addressStatusLabels[status] ?? status}
              </option>
            ))}
          </AddressSelect>
        </div>
      </Surface>

      {error ? <EmptyState message={error} /> : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(22rem,0.42fr)_minmax(0,1fr)]">
        <Surface className="overflow-hidden border border-slate-200/70 bg-white p-0">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
            <div>
              <p className="m-0 text-xs font-semibold uppercase text-[#7A5E2C]">
                Mapa
              </p>
              <h3 className="m-0 mt-1 text-base font-semibold text-slate-950">
                Cidade, bairros, ruas e casas
              </h3>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
              {filteredAddresses.length}
            </span>
          </div>
          <div className="max-h-[34rem] overflow-auto p-2">
            {isLoading && !registry ? (
              <div className="grid min-h-48 place-items-center text-sm font-semibold text-slate-500">
                <Loader2 className="mb-2 size-5 animate-spin text-[#A07C3B]" />
                Carregando catalogo
              </div>
            ) : cityAddress ? (
              <AddressTreeNode
                address={cityAddress}
                childrenByParent={childrenByParent}
                depth={0}
                onSelect={setSelectedAddressCode}
                selectedAddressCode={selectedAddress?.addressCode ?? null}
                visibleAddressCodes={visibleAddressCodes}
              />
            ) : (
              <EmptyState message="Catalogo Address ainda nao carregado." />
            )}
          </div>
        </Surface>

        <Surface className="overflow-hidden border border-slate-200/70 bg-white p-0">
          {selectedAddress ? (
            <AddressDetailPanel
              address={selectedAddress}
              addressByCode={addressByCode}
              copiedAction={copiedAction}
              onCopy={handleCopy}
            />
          ) : (
            <EmptyState message="Selecione um endereco para ver os detalhes." />
          )}
        </Surface>
      </section>
    </section>
  );
}

function AddressMetric({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "danger" | "gold" | "neutral" | "success";
  value: number;
}) {
  const toneClassName =
    tone === "gold"
      ? "bg-[#A07C3B]/10 text-[#7A5E2C] ring-[#A07C3B]/20"
      : tone === "danger"
        ? "bg-red-50 text-red-700 ring-red-100"
        : tone === "success"
          ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
          : "bg-slate-50 text-slate-700 ring-slate-200";

  return (
    <div className={`rounded-lg p-3 ring-1 ${toneClassName}`}>
      <p className="m-0 text-[0.68rem] font-semibold uppercase opacity-70">
        {label}
      </p>
      <p className="m-0 mt-2 font-mono text-2xl font-semibold">{value}</p>
    </div>
  );
}

function AddressSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-[0.66rem] font-semibold uppercase text-slate-500">
        {label}
      </span>
      <select
        className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#A07C3B]/45 focus:ring-2 focus:ring-[#A07C3B]/10"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

function AddressTreeNode({
  address,
  childrenByParent,
  depth,
  onSelect,
  selectedAddressCode,
  visibleAddressCodes,
}: {
  address: PanteonAddressRecord;
  childrenByParent: Map<string, PanteonAddressRecord[]>;
  depth: number;
  onSelect: (addressCode: string) => void;
  selectedAddressCode: string | null;
  visibleAddressCodes: Set<string>;
}) {
  if (!visibleAddressCodes.has(address.addressCode)) {
    return null;
  }

  const children = childrenByParent.get(address.addressCode) ?? [];
  const isSelected = selectedAddressCode === address.addressCode;

  return (
    <div>
      <button
        className={`grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-[#A07C3B]/5 ${
          isSelected ? "bg-[#101820] text-white" : "text-slate-700"
        }`}
        onClick={() => onSelect(address.addressCode)}
        style={{ paddingLeft: `${0.5 + depth * 0.85}rem` }}
        type="button"
      >
        <ChevronRight
          className={`size-3.5 ${
            children.length > 0 ? "text-[#A07C3B]" : "text-slate-300"
          }`}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">
            {address.name}
          </span>
          <span
            className={`block truncate font-mono text-[0.68rem] ${
              isSelected ? "text-white/70" : "text-slate-400"
            }`}
          >
            {address.addressCode}
          </span>
        </span>
        <AddressStatusPill
          isSelected={isSelected}
          level={address.level}
          status={address.status}
        />
      </button>
      {children.length > 0 ? (
        <div className="mt-1 grid gap-1">
          {children.map((childAddress) => (
            <AddressTreeNode
              address={childAddress}
              childrenByParent={childrenByParent}
              depth={depth + 1}
              key={childAddress.addressCode}
              onSelect={onSelect}
              selectedAddressCode={selectedAddressCode}
              visibleAddressCodes={visibleAddressCodes}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AddressStatusPill({
  isSelected,
  level,
  status,
}: {
  isSelected: boolean;
  level: PanteonAddressRecord["level"];
  status: string;
}) {
  const className = isSelected
    ? "bg-white/15 text-white"
    : status === "protected"
      ? "bg-red-50 text-red-700 ring-red-100"
      : "bg-slate-100 text-slate-600 ring-slate-200";

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase ring-1 ${className}`}
    >
      {addressLevelLabels[level]}
    </span>
  );
}

function AddressDetailPanel({
  address,
  addressByCode,
  copiedAction,
  onCopy,
}: {
  address: PanteonAddressRecord;
  addressByCode: Map<string, PanteonAddressRecord>;
  copiedAction: string | null;
  onCopy: (value: string, actionId: string) => Promise<void>;
}) {
  const hierarchy = buildAddressHierarchy(address, addressByCode);
  const manifestSeed = buildManifestSeed(address, hierarchy);

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold uppercase text-[#7A5E2C]">
            {addressLevelLabels[address.level]} / {formatModuleName(address.module)}
          </p>
          <h3 className="m-0 mt-1 text-lg font-semibold text-slate-950">
            {address.name}
          </h3>
          <p className="m-0 mt-1 font-mono text-sm font-semibold text-slate-500">
            {address.addressCode}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AddressActionButton
            icon={<Copy className="size-3.5" />}
            isCopied={copiedAction === "code"}
            label="Copiar CEP"
            onClick={() => onCopy(address.addressCode, "code")}
          />
          <AddressActionButton
            icon={<FileJson2 className="size-3.5" />}
            isCopied={copiedAction === "manifest"}
            label="Manifesto"
            onClick={() => onCopy(manifestSeed, "manifest")}
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <AddressDetailStat label="Status" value={formatStatus(address.status)} />
        <AddressDetailStat label="Owner" value={address.owner} />
        <AddressDetailStat label="Release" value={address.releaseDomain || "-"} />
        <AddressDetailStat
          label="Rollback"
          value={address.rollbackReference || "-"}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)]">
        <AddressListBlock
          emptyLabel="Sem rotas registradas"
          label="Rotas"
          values={address.routes}
        />
        <AddressListBlock
          emptyLabel="Sem comandos registrados"
          label="Validacoes"
          mono
          values={address.validationCommands}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <AddressListBlock
          emptyLabel="Sem paths autorizados"
          label="Arquivos e paths"
          mono
          values={address.paths}
        />
        <AddressListBlock
          emptyLabel="Sem paths protegidos"
          label="Protecoes"
          mono
          tone={address.protectedPaths.length > 0 ? "danger" : "neutral"}
          values={address.protectedPaths}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <AddressListBlock
          emptyLabel="Sem allowedChangedPaths especificos"
          label="Allowed changed paths"
          mono
          values={address.allowedChangedPaths}
        />
        <AddressMarkersBlock address={address} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-500">
          Hierarquia
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {hierarchy.map((item, index) => (
            <span className="contents" key={item.addressCode}>
              {index > 0 ? (
                <ChevronRight className="size-3.5 text-slate-300" />
              ) : null}
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                {item.addressCode}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddressActionButton({
  icon,
  isCopied,
  label,
  onClick,
}: {
  icon: ReactNode;
  isCopied: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[#A07C3B]/30 hover:text-slate-950 focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
      onClick={onClick}
      type="button"
    >
      {icon}
      {isCopied ? "Copiado" : label}
    </button>
  );
}

function AddressDetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="m-0 text-[0.66rem] font-semibold uppercase text-slate-500">
        {label}
      </p>
      <p className="m-0 mt-1 truncate text-sm font-semibold text-slate-950">
        {value}
      </p>
    </div>
  );
}

function AddressListBlock({
  emptyLabel,
  label,
  mono = false,
  tone = "neutral",
  values,
}: {
  emptyLabel: string;
  label: string;
  mono?: boolean;
  tone?: "danger" | "neutral";
  values: string[];
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === "danger"
          ? "border-red-100 bg-red-50/60"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-500">
        {label}
      </p>
      {values.length > 0 ? (
        <div className="mt-2 grid gap-1.5">
          {values.slice(0, 8).map((value) => (
            <span
              className={`min-w-0 rounded-md bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 ${
                mono ? "font-mono" : ""
              }`}
              key={value}
            >
              {value}
            </span>
          ))}
          {values.length > 8 ? (
            <span className="text-xs font-semibold text-slate-400">
              +{values.length - 8} item(s)
            </span>
          ) : null}
        </div>
      ) : (
        <p className="m-0 mt-2 text-sm font-medium text-slate-400">
          {emptyLabel}
        </p>
      )}
    </div>
  );
}

function AddressMarkersBlock({ address }: { address: PanteonAddressRecord }) {
  const requiredMarkers = address.requiredMarkers.flatMap((marker) =>
    (marker.includes ?? []).map((item) => `${marker.path}: ${item}`),
  );
  const forbiddenMarkers = address.forbiddenMarkers.flatMap((marker) =>
    (marker.includes ?? []).map((item) => `${marker.path}: ${item}`),
  );

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-[#A07C3B]" />
        <p className="m-0 text-[0.68rem] font-semibold uppercase text-slate-500">
          Marcadores
        </p>
      </div>
      <div className="mt-3 grid gap-3">
        <AddressMarkerList
          emptyLabel="Sem requiredMarkers"
          label="Obrigatorios"
          values={requiredMarkers}
        />
        <AddressMarkerList
          emptyLabel="Sem forbiddenMarkers"
          label="Proibidos"
          tone={forbiddenMarkers.length > 0 ? "danger" : "neutral"}
          values={forbiddenMarkers}
        />
      </div>
    </div>
  );
}

function AddressMarkerList({
  emptyLabel,
  label,
  tone = "neutral",
  values,
}: {
  emptyLabel: string;
  label: string;
  tone?: "danger" | "neutral";
  values: string[];
}) {
  const toneClassName =
    tone === "danger"
      ? "bg-red-50 text-red-700 ring-red-100"
      : "bg-slate-50 text-slate-600 ring-slate-200";

  return (
    <div>
      <p className="m-0 text-[0.66rem] font-semibold uppercase text-slate-500">
        {label}
      </p>
      {values.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.slice(0, 8).map((value) => (
            <span
              className={`min-w-0 rounded-md px-2 py-1 font-mono text-xs font-semibold ring-1 ${toneClassName}`}
              key={value}
            >
              {value}
            </span>
          ))}
          {values.length > 8 ? (
            <span className="text-xs font-semibold text-slate-400">
              +{values.length - 8} item(s)
            </span>
          ) : null}
        </div>
      ) : (
        <p className="m-0 mt-2 text-sm font-medium text-slate-400">
          {emptyLabel}
        </p>
      )}
    </div>
  );
}

function compareAddressRecords(
  firstAddress: PanteonAddressRecord,
  secondAddress: PanteonAddressRecord,
) {
  return firstAddress.addressCode.localeCompare(secondAddress.addressCode);
}

function getAddressSearchText(address: PanteonAddressRecord) {
  return normalizeSearchText(
    [
      address.addressCode,
      address.addressId,
      address.name,
      address.module,
      address.owner,
      address.status,
      address.houseType,
      ...address.routes,
      ...address.paths,
      ...address.allowedChangedPaths,
      ...address.protectedPaths,
      ...address.notes,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatModuleName(value: string) {
  const moduleLabels: Record<string, string> = {
    "panteon-core": "Panteon Core",
    apolo: "Apolo",
    ares: "Ares",
    atlas: "Atlas",
    chronos: "Chronos",
    hades: "Hades",
    hermes: "Hermes",
    iris: "Iris",
    panteon: "Panteon",
    setup: "Setup",
    zeus: "Zeus",
  };

  return moduleLabels[value] ?? value;
}

function formatStatus(value: string) {
  return addressStatusLabels[value] ?? value;
}

function buildAddressHierarchy(
  address: PanteonAddressRecord,
  addressByCode: Map<string, PanteonAddressRecord>,
) {
  const hierarchy: PanteonAddressRecord[] = [address];
  let currentAddress = address;

  while (currentAddress.parentAddressCode) {
    const parentAddress = addressByCode.get(currentAddress.parentAddressCode);

    if (!parentAddress) {
      break;
    }

    hierarchy.unshift(parentAddress);
    currentAddress = parentAddress;
  }

  return hierarchy;
}

function buildManifestSeed(
  address: PanteonAddressRecord,
  hierarchy: PanteonAddressRecord[],
) {
  const city = hierarchy.find((item) => item.level === "city") ?? null;
  const district = hierarchy.find((item) => item.level === "district") ?? null;
  const street = hierarchy.find((item) => item.level === "street") ?? null;
  const houses =
    address.level === "house"
      ? [address]
      : hierarchy.filter((item) => item.level === "house");

  return JSON.stringify(
    {
      addressing: {
        cityAddressCode: city?.addressCode ?? null,
        cityAddressId: city?.addressId ?? null,
        districtAddressCode: district?.addressCode ?? null,
        districtAddressId: district?.addressId ?? null,
        houseAddressCodes: houses.map((house) => house.addressCode),
        houseAddressIds: houses.map((house) => house.addressId),
        registryFile: "docs/operations/panteon-address-registry.json",
        scopeSummary: `Recorte em ${address.name}.`,
        streetAddressCode: street?.addressCode ?? null,
        streetAddressId: street?.addressId ?? null,
      },
      scope: {
        allowedChangedPaths: address.allowedChangedPaths,
        protectedPaths: address.protectedPaths,
        requiredMarkers: address.requiredMarkers,
      },
    },
    null,
    2,
  );
}
