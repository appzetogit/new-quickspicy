import { useEffect } from "react"
import { getPublicPlatformSetting } from "@food/utils/publicPlatformSettings"

/**
 * The marketing tags switched on under admin → 3rd Party → Marketing Tools
 * (platform setting "analytics": { googleAnalytics: { enabled, id }, ... }),
 * loaded on the public website only: never in the admin, restaurant or rider
 * panels, which have no business reporting to ad networks.
 *
 * IDs are checked against a strict pattern before going into a script URL or
 * snippet, so a stored value cannot inject anything.
 */
const PANELS = /^\/(admin|restaurant|delivery|food\/(restaurant|delivery))(\/|$)/
const SAFE_ID = /^[A-Za-z0-9_-]{2,40}$/

const addScript = (id, attrs = {}, inline = "") => {
  if (document.getElementById(id)) return
  const s = document.createElement("script")
  s.id = id
  Object.entries(attrs).forEach(([k, v]) => { s[k] = v })
  if (inline) s.text = inline
  document.head.appendChild(s)
}

const TAGS = {
  googleAnalytics: (id) => {
    addScript("qs-ga4-lib", { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` })
    addScript("qs-ga4", {}, `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');`)
  },
  googleTagManager: (id) =>
    addScript("qs-gtm", {}, `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${id}');`),
  metaPixel: (id) =>
    addScript("qs-meta", {}, `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');`),
  linkedinInsightTag: (id) =>
    addScript("qs-linkedin", {}, `window._linkedin_partner_id='${id}';window._linkedin_data_partner_ids=window._linkedin_data_partner_ids||[];window._linkedin_data_partner_ids.push('${id}');(function(l){if(!l){window.lintrk=function(a,b){window.lintrk.q.push([a,b])};window.lintrk.q=[]}var s=document.getElementsByTagName('script')[0];var b=document.createElement('script');b.type='text/javascript';b.async=true;b.src='https://snap.licdn.com/li.lms-analytics/insight.min.js';s.parentNode.insertBefore(b,s);})(window.lintrk);`),
  tiktokPixel: (id) =>
    addScript("qs-tiktok", {}, `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e){var i='https://analytics.tiktok.com/i18n/pixel/events.js';ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;var o=d.createElement('script');o.type='text/javascript';o.async=!0;o.src=i+'?sdkid='+e+'&lib='+t;var a=d.getElementsByTagName('script')[0];a.parentNode.insertBefore(o,a)};ttq.load('${id}');ttq.page();}(window,document,'ttq');`),
  pinterestPixel: (id) =>
    addScript("qs-pinterest", {}, `!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version='3.0';var t=document.createElement('script');t.async=!0,t.src=e;var r=document.getElementsByTagName('script')[0];r.parentNode.insertBefore(t,r)}}('https://s.pinimg.com/ct/core.js');pintrk('load','${id}');pintrk('page');`),
  snapchatPixel: (id) =>
    addScript("qs-snap", {}, `(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s='script';var r=t.createElement(s);r.async=!0;r.src=n;var u=t.getElementsByTagName(s)[0];u.parentNode.insertBefore(r,u);})(window,document,'https://sc-static.net/scevent.min.js');snaptr('init','${id}');snaptr('track','PAGE_VIEW');`),
  xPixel: (id) =>
    addScript("qs-x", {}, `!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments)},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');twq('config','${id}');`),
}

export default function MarketingScripts() {
  useEffect(() => {
    if (PANELS.test(window.location.pathname)) return
    let cancelled = false
    getPublicPlatformSetting("analytics").then((settings) => {
      if (cancelled) return
      for (const [name, load] of Object.entries(TAGS)) {
        const tag = settings?.[name]
        const id = String(tag?.id || "").trim()
        if (tag?.enabled && SAFE_ID.test(id)) {
          try { load(id) } catch { /* a broken tag must not break the site */ }
        }
      }
    })
    return () => { cancelled = true }
  }, [])
  return null
}
