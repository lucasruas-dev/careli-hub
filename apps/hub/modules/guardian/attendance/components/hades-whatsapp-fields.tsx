"use client";

type HadesWhatsAppFieldProps = {
  label: string;
  value: string;
};

type HadesWhatsAppEditableFieldProps = HadesWhatsAppFieldProps & {
  onChange: (value: string) => void;
};

export function HadesWhatsAppContextItem({ label, value }: HadesWhatsAppFieldProps) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export function HadesWhatsAppReadonlyField({ label, value }: HadesWhatsAppFieldProps) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

export function HadesWhatsAppEditableField({
  label,
  onChange,
  value,
}: HadesWhatsAppEditableFieldProps) {
  return (
    <label className="min-w-0 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-7 w-full min-w-0 rounded-md border border-transparent bg-slate-50/80 px-2 text-sm font-semibold text-slate-950 outline-none transition-colors focus:border-[#A07C3B]/35 focus:bg-white focus:ring-2 focus:ring-[#A07C3B]/10"
      />
    </label>
  );
}

export function HadesWhatsAppDateSeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center">
      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200/70">
        {label}
      </span>
    </div>
  );
}
