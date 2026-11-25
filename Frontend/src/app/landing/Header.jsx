import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bike, Store, ArrowRight } from "lucide-react";
import { BRAND, ROUTES } from "./content";

export default function Header({ onRestaurant, onDelivery }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-white/90 shadow-[0_1px_0_rgba(31,26,23,0.06),0_8px_24px_-12px_rgba(31,26,23,0.12)] backdrop-blur-md" : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:h-20 sm:px-6 lg:px-8">
        <a href="/" className="shrink-0" aria-label={`${BRAND.name} home`}>
          <img src={BRAND.logo} alt={BRAND.name} className="h-7 w-auto sm:h-10" width="200" height="40" />
        </a>

        <nav className="flex items-center gap-0.5 sm:gap-2" aria-label="Main">
          <button
            type="button"
            onClick={onRestaurant}
            className="inline-flex items-center gap-2 rounded-full p-2 text-sm font-medium text-ink/80 sm:px-3 transition-colors hover:bg-brand-50 hover:text-brand-700"
          >
            <Store className="h-4 w-4" aria-hidden="true" />
            <span className="hidden md:inline">Restaurant partner</span>
            <span className="sr-only md:hidden">Restaurant partner</span>
          </button>
          <button
            type="button"
            onClick={onDelivery}
            className="inline-flex items-center gap-2 rounded-full p-2 text-sm font-medium text-ink/80 sm:px-3 transition-colors hover:bg-brand-50 hover:text-brand-700"
          >
            <Bike className="h-4 w-4" aria-hidden="true" />
            <span className="hidden md:inline">Deliver with us</span>
            <span className="sr-only md:hidden">Deliver with us</span>
          </button>
          <Link
            to={ROUTES.order}
            className="group ml-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(230,65,0,0.7)] transition-all hover:bg-brand-600 active:scale-[0.98] sm:px-5"
          >
            Order<span className="hidden sm:inline"> now</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </nav>
      </div>
    </header>
  );
}
