import { motion } from "framer-motion";

const EASE = [0.16, 1, 0.3, 1];

/** Fades and lifts its children into view once, as they scroll in. */
export function Reveal({ children, delay = 0, y = 24, className = "", as = "div" }) {
  const Tag = motion[as] || motion.div;
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, ease: EASE, delay }}
    >
      {children}
    </Tag>
  );
}

/**
 * The speed lines from the logo's scooter, as a decorative motif.
 * Purely visual: hidden from assistive tech.
 */
export function SpeedLines({ className = "", lines = 5, animate = true }) {
  const widths = [100, 72, 88, 56, 80, 64, 92];
  return (
    <div aria-hidden="true" className={`flex flex-col gap-[7px] ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <motion.span
          key={i}
          className="block h-[5px] rounded-full bg-current"
          style={{ width: `${widths[i % widths.length]}%`, transformOrigin: "right" }}
          initial={animate ? { scaleX: 0, opacity: 0 } : false}
          whileInView={animate ? { scaleX: 1, opacity: 1 } : undefined}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.15 + i * 0.07 }}
        />
      ))}
    </div>
  );
}

export function Eyebrow({ children, tone = "brand" }) {
  const tones = {
    brand: "bg-brand-50 text-brand-700 ring-brand-200/70",
    light: "bg-white/15 text-white ring-white/25",
  };
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide ring-1 ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function SectionHeading({ eyebrow, title, children, align = "left", tone = "dark" }) {
  const center = align === "center";
  return (
    <div className={`${center ? "mx-auto text-center" : ""} max-w-2xl`}>
      {eyebrow && (
        <Reveal className="mb-4">
          <Eyebrow tone={tone === "dark" ? "brand" : "light"}>{eyebrow}</Eyebrow>
        </Reveal>
      )}
      <Reveal delay={0.05}>
        <h2 className={`font-brand text-[2.1rem] leading-[1.05] font-bold tracking-tight sm:text-5xl ${tone === "dark" ? "text-ink" : "text-white"}`}>
          {title}
        </h2>
      </Reveal>
      {children && (
        <Reveal delay={0.1}>
          <p className={`mt-4 text-base leading-relaxed sm:text-lg ${tone === "dark" ? "text-ink-muted" : "text-white/80"}`}>
            {children}
          </p>
        </Reveal>
      )}
    </div>
  );
}

/** App store button. With no link yet, it shows as "Coming soon" and does nothing. */
export function StoreButton({ href, store, variant = "dark" }) {
  const label = store === "ios" ? "App Store" : "Google Play";
  const kicker = href ? (store === "ios" ? "Download on the" : "Get it on") : "Coming soon to";
  const styles = {
    dark: "bg-ink text-white hover:bg-black",
    light: "bg-white text-ink hover:bg-brand-50",
    outline: "bg-white/10 text-white ring-1 ring-white/30 hover:bg-white/20",
  };
  const body = (
    <>
      {store === "ios" ? <AppleGlyph /> : <PlayGlyph />}
      <span className="flex flex-col leading-tight text-left">
        <span className="text-[10px] font-medium opacity-75">{kicker}</span>
        <span className="text-[15px] font-semibold">{label}</span>
      </span>
    </>
  );
  const cls = `inline-flex items-center gap-3 rounded-xl px-4 py-2.5 transition-colors ${styles[variant]}`;
  if (!href) {
    return (
      <span className={`${cls} cursor-default opacity-80`} aria-disabled="true" title="Coming soon">
        {body}
      </span>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  );
}

const AppleGlyph = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden="true">
    <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.11 8.79.73 1.06 1.6 2.25 2.75 2.21 1.1-.04 1.52-.71 2.85-.71s1.71.71 2.88.69c1.19-.02 1.94-1.08 2.66-2.15.84-1.23 1.19-2.42 1.21-2.48-.03-.01-2.32-.89-2.32-3.55zM14.18 6.13c.61-.74 1.02-1.76.91-2.78-.88.04-1.94.59-2.57 1.32-.56.65-1.06 1.7-.93 2.7.98.08 1.98-.5 2.59-1.24z" />
  </svg>
);
const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
    <path fill="#34A853" d="M3.6 2.3 13.4 12 3.6 21.7c-.36-.2-.6-.6-.6-1.1V3.4c0-.5.24-.9.6-1.1z" />
    <path fill="#FBBC04" d="m16.6 15.2-3.2-3.2 3.2-3.2 3.8 2.2c.9.5.9 1.6 0 2.1l-3.8 2.1z" />
    <path fill="#EA4335" d="M13.4 12 3.6 21.7c.3.2.8.2 1.2 0l11.8-6.5L13.4 12z" />
    <path fill="#4285F4" d="M13.4 12 16.6 8.8 4.8 2.3c-.4-.2-.9-.2-1.2 0L13.4 12z" />
  </svg>
);
