/** Neutrale productillustratie zolang er geen productfoto is (merk schrijft geen realistische foto's voor). */
export function ProductVisual({ type, size = 160, imageUrl, alt }: { type: string; size?: number; imageUrl?: string | null; alt: string }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt={alt} width={size} height={size} loading="lazy" />;
  }
  const isCase = type === "hoesje";
  const isPrivacy = type === "privacy";
  const isBundle = type === "bundel";
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={alt} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {isCase || isBundle ? <rect x={isBundle ? 26 : 36} y="14" width="48" height="92" rx="12" stroke="#374151" fill="#E5E7EB" /> : null}
      {!isCase ? (
        <>
          <rect x={isBundle ? 46 : 38} y="18" width="44" height="84" rx="9" stroke="#0F2937" fill="#FFFFFF" />
          <rect x={isBundle ? 50 : 42} y="24" width="36" height="72" rx="5" fill={isPrivacy ? "#0F2937" : "#E8F0FF"} stroke="#0066FF" />
          <path d={isBundle ? "M58 40 l20 20" : "M50 40 l20 20"} stroke={isPrivacy ? "#FFFFFF" : "#0066FF"} />
          <path d={isBundle ? "M58 52 l12 12" : "M50 52 l12 12"} stroke={isPrivacy ? "#FFFFFF" : "#0066FF"} />
        </>
      ) : (
        <circle cx="60" cy="56" r="13" stroke="#0066FF" />
      )}
    </svg>
  );
}
