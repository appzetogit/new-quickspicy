// Everything the landing page says, in one place. Keep claims true: no ratings,
// cities, delivery-time averages or payout promises that the product does not
// actually make.

export const BRAND = {
  name: "Quick Spicy",
  tagline: "When No One Is Around",
  logo: "/brand/logo-horizontal.svg",
  logoWhite: "/brand/logo-horizontal-white.svg",
  logoFull: "/brand/logo-full.svg",
  mark: "/brand/logo-mark.svg",
  markWhite: "/brand/logo-mark-white.svg",
};

// Fallbacks until the admin "Support" page returns its own contact details.
export const DEFAULT_SUPPORT = {
  email: "quickspicyenterprises@gmail.com",
  mobile: "+91 81256 33886",
};

export const ROUTES = {
  order: "/food/user",
  restaurantLogin: "/food/restaurant/login",
  riderLogin: "/food/delivery/login",
  privacy: "/food/user/profile/privacy",
  terms: "/food/user/profile/terms",
  about: "/food/user/profile/about",
  help: "/food/user/profile/help-content",
};

// Store listings and social pages. Empty until published: an empty link renders
// as "Coming soon" rather than pointing somewhere else.
export const STORE_LINKS = {
  customer: { ios: "", android: "" },
  restaurant: { ios: "", android: "" },
  delivery: { ios: "", android: "" },
};

export const DISHES = [
  { name: "Chicken Biryani", tag: "Biryani", img: "/landing/biryani.webp" },
  { name: "Chicken 65", tag: "Starters", img: "/landing/chicken-65.webp" },
  { name: "Paneer Tikka Masala", tag: "North Indian", img: "/landing/paneer-tikka.webp" },
  { name: "Mushroom Manchurian", tag: "Chinese", img: "/landing/manchurian.webp" },
  { name: "Kerala Fish Curry", tag: "South Indian", img: "/landing/fish-curry.webp" },
  { name: "Chicken Fried Rice", tag: "Chinese", img: "/landing/fried-rice.webp" },
  { name: "Masala Kulcha", tag: "Breads", img: "/landing/kulcha.webp" },
  { name: "Prawns Biryani", tag: "Biryani", img: "/landing/prawns-biryani.webp" },
];

export const MARQUEE = [
  "Biryani", "Chicken 65", "Paneer Tikka", "Fried Rice", "Manchurian",
  "Fish Curry", "Kulcha", "Mutton Biryani", "Veg Biryani", "Prawns",
];
