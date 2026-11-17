import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, MotionConfig } from "framer-motion";
import apiClient from "../services/api";
import Header from "./landing/Header";
import Hero from "./landing/Hero";
import { DishMarquee, Dishes, HowItWorks, WhyUs, PartnerCards, AppSection } from "./landing/Sections";
import Footer from "./landing/Footer";
import { RestaurantSheet, DeliverySheet } from "./landing/PartnerSheets";
import { DEFAULT_SUPPORT } from "./landing/content";

/**
 * Quick Spicy's public home page (served at "/" unless the admin turns the
 * landing page off, in which case "/" goes straight to the customer app).
 */
export default function LandingPage() {
  const [sheet, setSheet] = useState(null); // null | "restaurant" | "delivery"
  const [support, setSupport] = useState(DEFAULT_SUPPORT);

  // Footer contact comes from the admin "Support" page when it is filled in.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get("/food/pages/support", { params: { module: "USER" } })
      .then((res) => {
        const data = res?.data?.data || res?.data;
        if (!cancelled && data && (data.email || data.mobile)) {
          setSupport({ email: data.email || DEFAULT_SUPPORT.email, mobile: data.mobile || DEFAULT_SUPPORT.mobile });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Lock page scroll behind an open panel.
  useEffect(() => {
    document.body.style.overflow = sheet ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [sheet]);

  // The phone's back button closes an open panel instead of leaving the site.
  useEffect(() => {
    const onPop = () => setSheet(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = useCallback((name) => {
    if (!window.history.state?.landingSheet) window.history.pushState({ landingSheet: true }, "");
    setSheet(name);
  }, []);
  const close = useCallback(() => {
    if (window.history.state?.landingSheet) window.history.back();
    else setSheet(null);
  }, []);

  const openRestaurant = () => open("restaurant");
  const openDelivery = () => open("delivery");

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen w-full overflow-x-hidden bg-white font-sans text-ink antialiased selection:bg-brand-500 selection:text-white">
        <Header onRestaurant={openRestaurant} onDelivery={openDelivery} />
        <main>
          <Hero onPartner={() => document.getElementById("partner")?.scrollIntoView({ behavior: "smooth" })} />
          <DishMarquee />
          <Dishes />
          <HowItWorks />
          <WhyUs />
          <PartnerCards onRestaurant={openRestaurant} onDelivery={openDelivery} />
          <AppSection />
        </main>
        <Footer support={support} onRestaurant={openRestaurant} onDelivery={openDelivery} />

        <AnimatePresence>
          {sheet === "restaurant" && <RestaurantSheet key="restaurant" onClose={close} />}
          {sheet === "delivery" && <DeliverySheet key="delivery" onClose={close} />}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
