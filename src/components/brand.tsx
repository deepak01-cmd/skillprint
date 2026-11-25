/* Brand: the Skillprint mark (public/brand/mark.svg; replace that file to change it everywhere) and the wordmark,
   in the two-tone style of the Pixeltre logo. */
export function Logo({ size = 30 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/mark.svg" width={size} height={size} alt="" aria-hidden className="shrink-0" style={{ width: size, height: size }} />;
}
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={className}><span className="font-semibold tracking-[-.02em] text-[#1F5FBF] dark:text-[#7DB0FF]">skillprint</span></span>;
}
