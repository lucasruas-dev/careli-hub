import Image from "next/image";

type PanteonLoadingSize = "xs" | "sm" | "md" | "lg";

const markSizeClass: Record<PanteonLoadingSize, string> = {
  lg: "size-11",
  md: "size-9",
  sm: "size-7",
  xs: "size-5",
};

const imageSizeClass: Record<PanteonLoadingSize, string> = {
  lg: "size-7",
  md: "size-5",
  sm: "size-4",
  xs: "size-3",
};

const imagePixelSize: Record<PanteonLoadingSize, number> = {
  lg: 28,
  md: 20,
  sm: 16,
  xs: 12,
};

type PanteonLoadingMarkProps = {
  className?: string;
  inverse?: boolean;
  size?: PanteonLoadingSize;
};

export function PanteonLoadingMark({
  className,
  inverse = false,
  size = "md",
}: PanteonLoadingMarkProps) {
  const imageSize = imagePixelSize[size];

  return (
    <span
      aria-hidden="true"
      className={[
        "inline-grid shrink-0 place-items-center rounded-full border shadow-sm",
        "animate-spin motion-reduce:animate-none",
        inverse
          ? "border-white/25 bg-white/10"
          : "border-[#A07C3B]/20 bg-white",
        markSizeClass[size],
        className ?? "",
      ].join(" ")}
    >
      <Image
        alt=""
        className={imageSizeClass[size]}
        height={imageSize}
        priority={false}
        src={inverse ? "/panteon-mark-light.png" : "/panteon-mark.png"}
        width={imageSize}
      />
    </span>
  );
}

type PanteonLoadingStateProps = {
  className?: string;
  description?: string;
  markSize?: PanteonLoadingSize;
  minHeightClassName?: string;
  title?: string;
  variant?: "panel" | "overlay";
};

export function PanteonLoadingState({
  className,
  description,
  markSize = "lg",
  minHeightClassName = "min-h-40",
  title = "Carregando",
  variant = "panel",
}: PanteonLoadingStateProps) {
  if (variant === "overlay") {
    return (
      <div
        aria-busy="true"
        className={[
          "absolute inset-0 z-20 grid place-items-center rounded-[inherit] border border-white/45 bg-white/80 p-6 text-center shadow-[inset_0_0_0_1px_rgba(217,224,231,0.45)] backdrop-blur-[2px]",
          className ?? "",
        ].join(" ")}
        role="status"
      >
        <div>
          <PanteonLoadingMark size={markSize} />
          <p className="m-0 mt-3 text-sm font-semibold text-[#101820]">
            {title}
          </p>
          {description ? (
            <p className="m-0 mt-2 max-w-md text-xs leading-5 text-[#667085]">
              {description}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-busy="true"
      className={[
        "grid place-items-center rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-6 text-center",
        minHeightClassName,
        className ?? "",
      ].join(" ")}
      role="status"
    >
      <div>
        <PanteonLoadingMark size={markSize} />
        <p className="m-0 mt-3 text-sm font-semibold text-[#101820]">
          {title}
        </p>
        {description ? (
          <p className="m-0 mt-2 max-w-md text-xs leading-5 text-[#667085]">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
