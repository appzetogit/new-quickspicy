/**
 * The order bill as a PDF, made from the server's printable bill
 * (GET /food/orders/:id/invoice.html, or the admin copy).
 *
 * The server's page is the one bill the apps and the web share: GST lines,
 * platform fee, the full delivery address and ₹ amounts. jsPDF's built-in
 * fonts cannot draw "₹", so instead of re-typing the bill with jsPDF text the
 * page is rendered in a hidden frame and placed into the PDF as an image.
 */

const FRAME_WIDTH = 720

export async function invoiceHtmlToPdf(html, filename = "bill.pdf") {
  if (!html || typeof document === "undefined") throw new Error("No bill to save")
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ])

  const frame = document.createElement("iframe")
  frame.setAttribute("aria-hidden", "true")
  frame.setAttribute("tabindex", "-1")
  frame.style.cssText = `position:fixed;left:-${FRAME_WIDTH * 3}px;top:0;width:${FRAME_WIDTH}px;height:1200px;border:0;`
  document.body.appendChild(frame)

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Bill took too long to load")), 15000)
      frame.onload = () => { clearTimeout(timer); resolve() }
      frame.srcdoc = html
    })
    const doc = frame.contentDocument
    if (!doc?.body) throw new Error("Bill could not be rendered")
    try { if (doc.fonts?.ready) await doc.fonts.ready } catch { /* fonts are optional */ }

    // The bill's own height. documentElement.scrollHeight is never less than
    // the frame (1200px), so a one-page bill was drawn 1200px tall and its
    // blank tail spilled onto an empty second page. In standards mode
    // body.scrollHeight is the content alone (padding included).
    const height = Math.ceil(doc.body.scrollHeight)
    frame.style.height = `${height}px`

    const canvas = await html2canvas(doc.body, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      windowWidth: FRAME_WIDTH,
      windowHeight: height,
    })

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const margin = 8
    const imgW = pageW - margin * 2
    const imgH = (canvas.height * imgW) / canvas.width
    const usable = pageH - margin * 2
    const image = canvas.toDataURL("image/jpeg", 0.92)

    // One tall image, shifted up a page at a time; the margin band hides the cut.
    let shown = 0
    let first = true
    while (shown < imgH - 0.5) {
      if (!first) pdf.addPage()
      pdf.addImage(image, "JPEG", margin, margin - shown, imgW, imgH)
      pdf.setFillColor(255, 255, 255)
      pdf.rect(0, 0, pageW, margin, "F")
      pdf.rect(0, pageH - margin, pageW, margin, "F")
      shown += usable
      first = false
    }

    pdf.save(filename)
  } finally {
    frame.remove()
  }
}

/** Opens the bill in a new tab, ready to print (or "Save as PDF"). */
export function printInvoiceHtml(html) {
  const win = window.open("", "_blank")
  if (!win) return false
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => { try { win.print() } catch { /* the user can print from the tab */ } }, 300)
  return true
}

export const formatRupees = (n) => {
  const v = Number(n)
  return `₹${(Number.isFinite(v) ? v : 0).toFixed(2)}`
}
