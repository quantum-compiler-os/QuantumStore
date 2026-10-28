type BrandLogoProps = {
  className?: string;
  size?: number;
  withText?: boolean;
  textClassName?: string;
};

export default function BrandLogo({
  className = '',
  size = 28,
  withText = false,
  textClassName = '',
}: BrandLogoProps) {
  return (
    <span className={`brand-logo ${className}`.trim()}>
      <img
        src="/favicon.png"
        alt=""
        width={size}
        height={size}
        className="brand-logo-img"
        style={{ width: size, height: size }}
        decoding="async"
      />
      {withText && <span className={textClassName || 'brand-logo-text'}>Launcher</span>}
    </span>
  );
}
