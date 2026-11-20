import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, MapPin, Wallet, Navigation } from "lucide-react";
import { BRAND, ROUTES } from "./content";
import { SpeedLines } from "./ui";

const EASE = [0.16, 1, 0.3, 1];
const rise = (delay) => ({
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, ease: EASE, delay },
});

const PERKS = [
  { icon: Navigation, label: "Live rider tracking" },
  { icon: Wallet, label: "Pay online or cash" },
  { icon: MapPin, label: "Local favourites" },
];

export default function Hero({ onPartner }) {
  return (
    <section className="relative overflow-hidden bg-cream pt-28 pb-16 sm:pt-36 sm:pb-24">
      {/* warm glow + grain of orange dots */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-[42rem] w-[42rem] rounded-full bg-brand-200/40 blur-3xl" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(rgba(235,89,14,0.18)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
      />

      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:px-8">
        {/* Copy */}
        <div className="max-w-xl">
          <motion.p {...rise(0)} className="mb-5 inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-brand-100">
            <span aria-hidden="true">🌶️</span> {BRAND.tagline}
          </motion.p>

          <motion.h1 {...rise(0.08)} className="font-brand text-[3.1rem] font-bold leading-[0.95] tracking-tight text-ink sm:text-7xl lg:text-[5.4rem]">
            Hot food.
            <span className="relative mt-1 block text-brand-500">
              Delivered quick.
              <SpeedLines lines={3} className="absolute -left-[4.5rem] top-1/2 hidden w-14 -translate-y-1/2 text-brand-300 sm:flex" />
            </span>
          </motion.h1>

          <motion.p {...rise(0.16)} className="mt-6 max-w-md text-lg leading-relaxed text-ink-muted">
            Order from the restaurants you love nearby. Follow your rider live on the map, and pay online or in cash when it arrives.
          </motion.p>

          <motion.div {...rise(0.24)} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to={ROUTES.order}
              className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-500 px-7 py-4 text-base font-semibold text-white shadow-[0_14px_30px_-12px_rgba(235,89,14,0.8)] transition-all hover:bg-brand-600 active:scale-[0.98]"
            >
              Order food now
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={onPartner}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-7 py-4 text-base font-semibold text-ink ring-1 ring-ink/10 transition-all hover:ring-brand-300 hover:text-brand-700"
            >
              Partner with us
            </button>
          </motion.div>

          <motion.ul {...rise(0.32)} className="mt-10 flex flex-wrap gap-x-6 gap-y-3">
            {PERKS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-sm font-medium text-ink/75">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-brand-600">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {label}
              </li>
            ))}
          </motion.ul>
        </div>

        {/* Visual */}
        <div className="relative mx-auto aspect-square w-full max-w-[34rem]">
          <motion.div
            initial={{ opacity: 0, scale: 0.92, rotate: -6 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1.1, ease: EASE, delay: 0.1 }}
            className="absolute inset-[8%] rounded-full bg-brand-500 p-3 shadow-[0_40px_80px_-30px_rgba(235,89,14,0.65)] sm:p-4"
          >
            <div className="h-full w-full overflow-hidden rounded-full ring-8 ring-white/25">
              <img src="/landing/biryani.webp" alt="Chicken biryani in a clay pot" className="h-full w-full object-cover" width="640" height="640" fetchPriority="high" />
            </div>
          </motion.div>

          <SpeedLines lines={5} className="absolute left-[-2%] top-[38%] w-[22%] text-brand-400" />

          {/* orbiting side dishes */}
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 0.45 }}
            className="absolute right-[-2%] top-[4%] h-[26%] w-[26%] overflow-hidden rounded-full bg-white p-1.5 shadow-xl"
          >
            <img src="/landing/chicken-65.webp" alt="Chicken 65" className="h-full w-full rounded-full object-cover" loading="lazy" />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 0.55 }}
            className="absolute bottom-[2%] right-[6%] h-[22%] w-[22%] overflow-hidden rounded-full bg-white p-1.5 shadow-xl"
          >
            <img src="/landing/paneer-tikka.webp" alt="Paneer tikka masala" className="h-full w-full rounded-full object-cover" loading="lazy" />
          </motion.div>

          {/* order status card (illustrative) */}
          <motion.div
            initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, ease: EASE, delay: 0.7 }}
            className="absolute bottom-[8%] left-0 w-[64%] max-w-[17rem] rounded-2xl bg-white p-4 shadow-[0_20px_50px_-20px_rgba(31,26,23,0.35)] ring-1 ring-ink/5"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50">
                <img src={BRAND.mark} alt="" className="h-7 w-auto" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Your order is on the way</p>
                <p className="text-xs text-ink-muted">Rider is heading to you</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-100">
              <motion.div
                className="h-full rounded-full bg-brand-500"
                initial={{ width: "18%" }}
                animate={{ width: ["18%", "78%", "18%"] }}
                transition={{ duration: 6, ease: "easeInOut", repeat: Infinity, delay: 1.2 }}
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
