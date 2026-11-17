import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, Search, ShoppingBag, MapPinned, Zap, Navigation,
  Wallet, Store, Bike, UtensilsCrossed, Clock, BadgeIndianRupee, LayoutDashboard,
} from "lucide-react";
import { BRAND, DISHES, MARQUEE, ROUTES, STORE_LINKS } from "./content";
import { Reveal, SectionHeading, SpeedLines, StoreButton } from "./ui";

/* ── Scrolling strip of dish names ───────────────────────────────────────── */
export function DishMarquee() {
  const items = [...MARQUEE, ...MARQUEE];
  return (
    <div className="relative -rotate-1 overflow-hidden bg-brand-500 py-4 text-white shadow-[0_12px_30px_-18px_rgba(235,89,14,0.9)]" aria-hidden="true">
      <div className="flex w-max animate-scroll gap-8 whitespace-nowrap [animation-duration:38s] motion-reduce:animate-none">
        {items.map((d, i) => (
          <span key={i} className="flex items-center gap-8 font-brand text-xl font-semibold tracking-wide sm:text-2xl">
            {d}
            <span className="text-brand-200">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── What's cooking: dish photo grid ─────────────────────────────────────── */
export function Dishes() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <SectionHeading eyebrow="What's cooking" title={<>Cravings, <span className="text-brand-500">sorted.</span></>}>
            Biryanis, starters, curries and more from kitchens near you.
          </SectionHeading>
          <Reveal>
            <Link to={ROUTES.order} className="group inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:text-brand-700">
              Explore restaurants
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </Reveal>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {DISHES.map((dish, i) => (
            <Reveal key={dish.name} delay={(i % 4) * 0.06}>
              <Link
                to={ROUTES.order}
                className="group relative block aspect-[4/5] overflow-hidden rounded-3xl bg-brand-50"
              >
                <img
                  src={dish.img}
                  alt={dish.name}
                  loading="lazy"
                  width="640" height="640"
                  className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-brand-700 backdrop-blur sm:left-4 sm:top-4">
                  {dish.tag}
                </span>
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 sm:p-4">
                  <h3 className="font-brand text-base font-semibold leading-tight text-white sm:text-xl">{dish.name}</h3>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500 text-white opacity-0 transition-all duration-300 group-hover:opacity-100 max-sm:hidden">
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── How it works ────────────────────────────────────────────────────────── */
const STEPS = [
  { icon: Search, title: "Pick a restaurant", body: "Browse menus from local kitchens, filter veg or non-veg, and find what you're craving." },
  { icon: ShoppingBag, title: "Place your order", body: "Add to cart, apply an offer if there is one, and pay online or choose cash on delivery." },
  { icon: MapPinned, title: "Track it live", body: "Watch your rider on the map from the restaurant to your door, and share your OTP at handover." },
];

export function HowItWorks() {
  return (
    <section className="relative overflow-hidden bg-cream py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading align="center" eyebrow="How it works" title="Three taps to dinner">
          No fuss. From craving to doorstep in a few steps.
        </SectionHeading>

        <ol className="relative mt-14 grid gap-5 md:grid-cols-3">
          {/* dashed route connecting the steps */}
          <div aria-hidden="true" className="absolute left-[16%] right-[16%] top-12 hidden border-t-2 border-dashed border-brand-300 md:block" />
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <Reveal as="li" key={title} delay={i * 0.1} className="relative rounded-3xl bg-white p-7 shadow-[0_20px_40px_-28px_rgba(31,26,23,0.35)] ring-1 ring-ink/5">
              <div className="flex items-center justify-between">
                <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 text-white shadow-[0_10px_24px_-10px_rgba(235,89,14,0.8)]">
                  <Icon className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="font-brand text-5xl font-bold text-brand-100">0{i + 1}</span>
              </div>
              <h3 className="mt-6 font-brand text-2xl font-semibold text-ink">{title}</h3>
              <p className="mt-2 leading-relaxed text-ink-muted">{body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Why Quick Spicy ─────────────────────────────────────────────────────── */
const REASONS = [
  { icon: Zap, title: "Quick by name", body: "Orders go straight to the kitchen and to the nearest available rider." },
  { icon: Navigation, title: "Live tracking", body: "See where your food is, every step of the way, on a real map." },
  { icon: Wallet, title: "Pay your way", body: "UPI, cards and wallets online, or cash when your order arrives." },
  { icon: UtensilsCrossed, title: "Local kitchens", body: "The neighbourhood restaurants you already love, all in one app." },
];

export function WhyUs() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-brand-500 px-6 py-14 text-white sm:px-12 sm:py-20">
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-400/60 blur-2xl" />
          <img src={BRAND.markWhite} alt="" aria-hidden="true" className="pointer-events-none absolute -bottom-6 right-6 w-56 opacity-[0.12] sm:w-80" />

          <div className="relative grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <SectionHeading tone="light" eyebrow={`Why ${BRAND.name}`} title={<>Spicy food.<br />Quicker days.</>}>
                Built for the way your city eats: late cravings, office lunches and family dinners.
              </SectionHeading>
              <SpeedLines lines={4} className="mt-8 w-32 text-white/40" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {REASONS.map(({ icon: Icon, title, body }, i) => (
                <Reveal key={title} delay={i * 0.08} className="rounded-3xl bg-white/10 p-6 ring-1 ring-white/20 backdrop-blur-sm transition-colors hover:bg-white/15">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-brand-600">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 font-brand text-xl font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/80">{body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Partner cards ───────────────────────────────────────────────────────── */
export function PartnerCards({ onRestaurant, onDelivery }) {
  return (
    <section id="partner" className="bg-cream py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading align="center" eyebrow="Grow with us" title="Let's cook something together">
          Bring your kitchen online, or earn on your own schedule delivering for us.
        </SectionHeading>

        <div className="mt-14 grid gap-5 lg:grid-cols-2">
          <Reveal>
            <PartnerCard
              tone="light"
              icon={Store}
              kicker="For restaurants"
              title="Get more orders from your neighbourhood"
              points={[
                { icon: BadgeIndianRupee, text: "Choose per-order commission or a fixed monthly plan" },
                { icon: LayoutDashboard, text: "Run your menu, prices and offers from your phone" },
                { icon: Clock, text: "Switch online or offline whenever you like" },
              ]}
              cta="Become a restaurant partner"
              onClick={onRestaurant}
            />
          </Reveal>
          <Reveal delay={0.08}>
            <PartnerCard
              tone="dark"
              icon={Bike}
              kicker="For delivery partners"
              title="Ride when you want. Earn per delivery."
              points={[
                { icon: Clock, text: "Go online when it suits you. No fixed shifts" },
                { icon: Navigation, text: "Turn-by-turn routes to the restaurant and the customer" },
                { icon: Wallet, text: "Track every delivery and tip in the rider app" },
              ]}
              cta="Become a delivery partner"
              onClick={onDelivery}
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function PartnerCard({ tone, icon: Icon, kicker, title, points, cta, onClick }) {
  const dark = tone === "dark";
  return (
    <div className={`group relative flex h-full flex-col overflow-hidden rounded-[2rem] p-8 sm:p-10 ${dark ? "bg-ink text-white" : "bg-white text-ink ring-1 ring-ink/5 shadow-[0_24px_50px_-34px_rgba(31,26,23,0.4)]"}`}>
      <SpeedLines lines={4} animate={false} className={`absolute right-8 top-10 w-24 ${dark ? "text-white/10" : "text-brand-100"}`} />
      <span className={`grid h-14 w-14 place-items-center rounded-2xl ${dark ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-600"}`}>
        <Icon className="h-7 w-7" aria-hidden="true" />
      </span>
      <p className={`mt-7 text-sm font-semibold uppercase tracking-wider ${dark ? "text-brand-300" : "text-brand-600"}`}>{kicker}</p>
      <h3 className="mt-2 max-w-sm font-brand text-3xl font-semibold leading-tight">{title}</h3>
      <ul className="mt-6 space-y-3">
        {points.map(({ icon: P, text }) => (
          <li key={text} className={`flex items-start gap-3 ${dark ? "text-white/80" : "text-ink-muted"}`}>
            <P className={`mt-0.5 h-5 w-5 shrink-0 ${dark ? "text-brand-400" : "text-brand-500"}`} aria-hidden="true" />
            {text}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onClick}
        className={`mt-8 inline-flex w-fit items-center gap-2 rounded-2xl px-6 py-3.5 font-semibold transition-all active:scale-[0.98] ${
          dark ? "bg-white text-ink hover:bg-brand-50" : "bg-brand-500 text-white hover:bg-brand-600"
        }`}
      >
        {cta}
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
      </button>
    </div>
  );
}

/* ── App download ────────────────────────────────────────────────────────── */
export function AppSection() {
  return (
    <section className="overflow-hidden bg-white py-20 sm:py-28">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        <div>
          <SectionHeading eyebrow="The app" title={<>Your next meal, <span className="text-brand-500">in your pocket.</span></>}>
            Save addresses, reorder favourites in a tap and get notified the moment your rider is close.
          </SectionHeading>
          <Reveal delay={0.15} className="mt-8 flex flex-wrap gap-3">
            <StoreButton store="ios" href={STORE_LINKS.customer.ios} />
            <StoreButton store="android" href={STORE_LINKS.customer.android} />
          </Reveal>
          <Reveal delay={0.2}>
            <Link to={ROUTES.order} className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700">
              Or order on the web right now <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Reveal>
        </div>

        <Reveal className="relative mx-auto">
          <div aria-hidden="true" className="absolute inset-0 -z-10 scale-110 rounded-full bg-brand-100 blur-3xl" />
          <PhoneMock />
        </Reveal>
      </div>
    </section>
  );
}

function PhoneMock() {
  return (
    <motion.div
      initial={{ rotate: 4 }}
      whileInView={{ rotate: -3 }}
      viewport={{ once: true }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
      className="w-[17rem] rounded-[2.75rem] bg-ink p-2.5 shadow-[0_50px_80px_-40px_rgba(31,26,23,0.6)] sm:w-[19rem]"
      aria-hidden="true"
    >
      <div className="overflow-hidden rounded-[2.2rem] bg-cream">
        <div className="flex items-center justify-between bg-white px-4 pb-3 pt-6">
          <img src={BRAND.logo} alt="" className="h-6 w-auto" />
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-50 text-brand-600"><ShoppingBag className="h-3.5 w-3.5" /></span>
        </div>
        <div className="px-4 pb-4">
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2.5 text-xs text-ink-muted ring-1 ring-ink/5">
            <Search className="h-3.5 w-3.5 text-brand-500" /> Search for biryani…
          </div>
          <div className="mt-4 flex gap-2">
            {["Biryani", "Chinese", "Starters"].map((c, i) => (
              <span key={c} className={`rounded-full px-3 py-1 text-[11px] font-semibold ${i === 0 ? "bg-brand-500 text-white" : "bg-white text-ink/70 ring-1 ring-ink/5"}`}>{c}</span>
            ))}
          </div>
          {DISHES.slice(0, 3).map((d) => (
            <div key={d.name} className="mt-3 flex items-center gap-3 rounded-2xl bg-white p-2 ring-1 ring-ink/5">
              <img src={d.img} alt="" className="h-14 w-14 rounded-xl object-cover" loading="lazy" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-ink">{d.name}</p>
                <p className="text-[11px] text-ink-muted">{d.tag}</p>
              </div>
              <span className="rounded-lg bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-600">ADD</span>
            </div>
          ))}
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-brand-500 px-4 py-3 text-white">
            <span className="text-xs font-semibold">2 items added</span>
            <span className="text-xs font-bold">View cart →</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
