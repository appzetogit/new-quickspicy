import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, BadgeIndianRupee, LayoutDashboard, Clock, Bell,
  Navigation, Wallet, ShieldCheck, Loader2, CheckCircle2, Store, Bike,
} from "lucide-react";
import { restaurantAPI } from "../../services/api";
import { BRAND, ROUTES, STORE_LINKS } from "./content";
import { SpeedLines, StoreButton } from "./ui";

/** Full-screen panel that slides in from the right, with its own scroll. */
function Sheet({ title, onClose, children, labelledBy }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 240 }}
      className="fixed inset-0 z-[100] flex flex-col overflow-y-auto bg-cream"
    >
      <header className="sticky top-0 z-10 border-b border-ink/5 bg-cream/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <img src={BRAND.logo} alt={BRAND.name} className="h-8 w-auto" />
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink ring-1 ring-ink/10 transition-colors hover:text-brand-700 hover:ring-brand-300"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
            <span className="sr-only">to {title}</span>
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16">{children}</main>
      <footer className="border-t border-ink/5 py-6 text-center text-xs text-ink-muted">
        © {new Date().getFullYear()} {BRAND.name}
      </footer>
    </motion.div>
  );
}

function Benefit({ icon: Icon, title, body, dark }) {
  return (
    <div className={`rounded-3xl p-6 ${dark ? "bg-white/5 ring-1 ring-white/10" : "bg-white ring-1 ring-ink/5"}`}>
      <span className={`grid h-11 w-11 place-items-center rounded-xl ${dark ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-600"}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className={`mt-4 font-brand text-xl font-semibold ${dark ? "text-white" : "text-ink"}`}>{title}</h3>
      <p className={`mt-1.5 text-sm leading-relaxed ${dark ? "text-white/70" : "text-ink-muted"}`}>{body}</p>
    </div>
  );
}

/* ── Restaurants ─────────────────────────────────────────────────────────── */
const EMPTY_LEAD = { ownerName: "", restaurantName: "", mobileNumber: "", emailId: "", location: "" };

export function RestaurantSheet({ onClose }) {
  const [lead, setLead] = useState(EMPTY_LEAD);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setLead((l) => ({ ...l, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (Object.values(lead).some((v) => !String(v).trim())) {
      setError("Please fill in every field so our team can reach you.");
      return;
    }
    try {
      setSubmitting(true);
      await restaurantAPI.createUnregisteredRestaurant(lead);
      setDone(true);
      setLead(EMPTY_LEAD);
    } catch (err) {
      setError(err?.response?.data?.message || "We couldn't send that just now. Please try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet title="the home page" onClose={onClose} labelledBy="restaurant-sheet-title">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3.5 py-1.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-200/70">
            <Store className="h-3.5 w-3.5" aria-hidden="true" /> For restaurants
          </span>
          <h1 id="restaurant-sheet-title" className="mt-5 font-brand text-4xl font-bold leading-[1.05] text-ink sm:text-6xl">
            Grow your kitchen with <span className="text-brand-500">{BRAND.name}</span>
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-ink-muted">
            Reach hungry customers nearby. Leave your details and our team will call you to set up your menu.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            <Benefit icon={BadgeIndianRupee} title="Billing that fits" body="Pay a commission per order, or a fixed monthly plan. Every charge shows in your dashboard." />
            <Benefit icon={LayoutDashboard} title="You're in control" body="Change prices, switch dishes on or off and run offers from the restaurant app." />
            <Benefit icon={Bell} title="Never miss an order" body="New orders ring on your phone or tablet the moment they're placed." />
            <Benefit icon={Clock} title="Open on your hours" body="Go online or offline with one switch, whenever your kitchen is ready." />
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <StoreButton store="android" href={STORE_LINKS.restaurant.android} />
            <StoreButton store="ios" href={STORE_LINKS.restaurant.ios} />
            <Link to={ROUTES.restaurantLogin} className="ml-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
              Already a partner? Log in →
            </Link>
          </div>
        </div>

        <div className="lg:pt-6">
          <div className="relative overflow-hidden rounded-[2rem] bg-white p-6 shadow-[0_30px_60px_-40px_rgba(31,26,23,0.45)] ring-1 ring-ink/5 sm:p-9">
            <SpeedLines lines={3} animate={false} className="absolute right-6 top-8 hidden w-16 text-brand-100 sm:flex" />
            {done ? (
              <div className="py-10 text-center" role="status">
                <CheckCircle2 className="mx-auto h-14 w-14 text-brand-500" aria-hidden="true" />
                <h2 className="mt-4 font-brand text-2xl font-semibold text-ink">Thanks, we've got it!</h2>
                <p className="mx-auto mt-2 max-w-sm text-ink-muted">Our onboarding team will call you shortly to get your restaurant live.</p>
                <button type="button" onClick={() => setDone(false)} className="mt-6 rounded-xl bg-brand-50 px-5 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-100">
                  Send another
                </button>
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                <h2 className="font-brand text-2xl font-semibold text-ink">Register your interest</h2>
                <p className="mt-1 text-sm text-ink-muted">Takes under a minute.</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <Field id="ownerName" label="Your name" value={lead.ownerName} onChange={set("ownerName")} autoComplete="name" />
                  <Field id="restaurantName" label="Restaurant name" value={lead.restaurantName} onChange={set("restaurantName")} autoComplete="organization" />
                  <Field id="mobileNumber" label="Mobile number" type="tel" inputMode="tel" value={lead.mobileNumber} onChange={set("mobileNumber")} autoComplete="tel" placeholder="+91" />
                  <Field id="emailId" label="Email" type="email" value={lead.emailId} onChange={set("emailId")} autoComplete="email" />
                  <Field id="location" label="Restaurant address" value={lead.location} onChange={set("location")} autoComplete="street-address" className="sm:col-span-2" />
                </div>
                {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}
                <button
                  type="submit"
                  disabled={submitting}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-500 px-6 py-4 font-semibold text-white transition-all hover:bg-brand-600 active:scale-[0.99] disabled:opacity-60"
                >
                  {submitting ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Sending…</> : <>Request a call back <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function Field({ id, label, className = "", ...props }) {
  return (
    <label htmlFor={`lead-${id}`} className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      <input
        id={`lead-${id}`}
        name={id}
        required
        className="w-full rounded-xl border border-ink/10 bg-cream px-4 py-3 text-ink outline-none transition-all placeholder:text-ink/30 focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-100"
        {...props}
      />
    </label>
  );
}

/* ── Delivery partners ───────────────────────────────────────────────────── */
export function DeliverySheet({ onClose }) {
  return (
    <Sheet title="the home page" onClose={onClose} labelledBy="delivery-sheet-title">
      <div className="relative overflow-hidden rounded-[2.5rem] bg-ink px-6 py-12 text-white sm:px-12 sm:py-16">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-brand-500/30 blur-3xl" />
        <img src={BRAND.markWhite} alt="" aria-hidden="true" className="pointer-events-none absolute -bottom-4 right-4 w-64 opacity-[0.08] sm:w-96" />
        <div className="relative max-w-2xl">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-brand-200 ring-1 ring-white/15">
            <Bike className="h-3.5 w-3.5" aria-hidden="true" /> For delivery partners
          </span>
          <h1 id="delivery-sheet-title" className="mt-5 font-brand text-4xl font-bold leading-[1.05] sm:text-6xl">
            Ride with <span className="text-brand-400">{BRAND.name}</span>.<br />Earn on your time.
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-relaxed text-white/70">
            Sign up with your phone number, upload your documents, and start taking deliveries once you're verified.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to={ROUTES.riderLogin}
              className="inline-flex items-center gap-2 rounded-2xl bg-brand-500 px-6 py-4 font-semibold text-white transition-colors hover:bg-brand-600"
            >
              Sign up as a rider <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <StoreButton store="android" href={STORE_LINKS.delivery.android} variant="outline" />
            <StoreButton store="ios" href={STORE_LINKS.delivery.ios} variant="outline" />
          </div>
        </div>

        <div className="relative mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Benefit dark icon={Clock} title="Your hours" body="Go online when you want to work and offline when you're done. No fixed shifts." />
          <Benefit dark icon={Navigation} title="Clear routes" body="Pickup and drop locations open straight in maps, with live order details." />
          <Benefit dark icon={Wallet} title="See every rupee" body="Each delivery, tip and payout is listed in the rider app." />
          <Benefit dark icon={ShieldCheck} title="Safe handovers" body="Customers share a delivery OTP, so every order reaches the right person." />
        </div>
      </div>
    </Sheet>
  );
}
