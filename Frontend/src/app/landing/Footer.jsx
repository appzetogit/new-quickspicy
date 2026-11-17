import { Link } from "react-router-dom";
import { Mail, Phone } from "lucide-react";
import { BRAND, ROUTES } from "./content";

export default function Footer({ support, onRestaurant, onDelivery }) {
  const year = new Date().getFullYear();
  const tel = String(support.mobile || "").replace(/[^\d+]/g, "");
  return (
    <footer className="relative overflow-hidden bg-ink text-white/70">
      <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-16 sm:px-6 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <img src={BRAND.logoWhite} alt={BRAND.name} className="h-10 w-auto" width="200" height="40" loading="lazy" />
            <p className="mt-4 max-w-xs leading-relaxed">
              Hot food from the restaurants around you, delivered quick.
            </p>
            <Link
              to={ROUTES.order}
              className="mt-6 inline-flex rounded-xl bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
            >
              Order now
            </Link>
          </div>

          <FooterCol title="Partners">
            <li><button type="button" onClick={onRestaurant} className="hover:text-white">Add your restaurant</button></li>
            <li><button type="button" onClick={onDelivery} className="hover:text-white">Become a delivery partner</button></li>
            <li><Link to={ROUTES.restaurantLogin} className="hover:text-white">Restaurant login</Link></li>
            <li><Link to={ROUTES.riderLogin} className="hover:text-white">Rider login</Link></li>
          </FooterCol>

          <FooterCol title="Company">
            <li><Link to={ROUTES.about} className="hover:text-white">About us</Link></li>
            <li><Link to={ROUTES.help} className="hover:text-white">Help &amp; support</Link></li>
            <li><Link to={ROUTES.privacy} className="hover:text-white">Privacy policy</Link></li>
            <li><Link to={ROUTES.terms} className="hover:text-white">Terms of service</Link></li>
          </FooterCol>

          <FooterCol title="Contact">
            {support.email && (
              <li>
                <a href={`mailto:${support.email}`} className="inline-flex items-center gap-2 break-all hover:text-white">
                  <Mail className="h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" /> {support.email}
                </a>
              </li>
            )}
            {tel && (
              <li>
                <a href={`tel:${tel}`} className="inline-flex items-center gap-2 hover:text-white">
                  <Phone className="h-4 w-4 shrink-0 text-brand-400" aria-hidden="true" /> {support.mobile}
                </a>
              </li>
            )}
          </FooterCol>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-6 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} {BRAND.name}. All rights reserved.</p>
          <p className="font-brand text-white/50">{BRAND.tagline} 🌶️</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, children }) {
  return (
    <div>
      <h3 className="font-brand text-lg font-semibold text-white">{title}</h3>
      <ul className="mt-4 space-y-3 text-sm">{children}</ul>
    </div>
  );
}
