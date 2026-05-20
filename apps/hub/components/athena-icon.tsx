import Image, { type ImageProps } from "next/image";

type AthenaIconProps = Omit<
  ImageProps,
  "alt" | "height" | "src" | "width"
> & {
  alt?: string;
  variant?: "avatar" | "panel";
};

export function AthenaIcon({
  alt = "",
  className,
  sizes = "64px",
  variant = "avatar",
  ...props
}: AthenaIconProps) {
  return (
    <Image
      alt={alt}
      className={["block object-contain", className].filter(Boolean).join(" ")}
      draggable={false}
      height={768}
      sizes={sizes}
      src={variant === "panel" ? "/athena-panel-icon.png" : "/athena-avatar.png"}
      width={768}
      {...props}
    />
  );
}
