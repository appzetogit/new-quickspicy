import { useParams, Link } from "react-router-dom"
import { useEffect, useState } from "react"
import { Download, ArrowLeft, Printer, Loader2 } from "lucide-react"
import { toast } from "sonner"
import AnimatedPage from "@food/components/user/AnimatedPage"
import { Card, CardContent } from "@food/components/ui/card"
import { Button } from "@food/components/ui/button"
import { orderAPI } from "@food/api"
import { invoiceHtmlToPdf, printInvoiceHtml, formatRupees } from "@food/utils/invoicePdf"

/**
 * The customer's bill. Rendered from the server's invoice
 * (GET /food/orders/:id/invoice), the same one the app shows, so the web and
 * the app print the same lines: GST, platform fee, the full address, ₹.
 * Print and PDF use the server's printable page (invoice.html).
 */
export default function OrderInvoice() {
  const { orderId } = useParams()
  const [invoice, setInvoice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    orderAPI.getOrderInvoice(orderId)
      .then((res) => {
        if (!alive) return
        const data = res?.data?.data
        if (data?.invoiceNumber) setInvoice(data)
        else setError("Bill not found")
      })
      .catch((err) => { if (alive) setError(err?.response?.data?.message || "Failed to load the bill") })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [orderId])

  const fetchHtml = async () => {
    const res = await orderAPI.getOrderInvoiceHtml(orderId)
    const html = typeof res?.data === "string" ? res.data : ""
    if (!html) throw new Error("Empty bill")
    return html
  }

  const handlePrint = async () => {
    setBusy("print")
    try {
      if (!printInvoiceHtml(await fetchHtml())) toast.error("Allow pop-ups to print the bill")
    } catch {
      toast.error("Could not open the bill")
    } finally {
      setBusy(null)
    }
  }

  const handleDownload = async () => {
    setBusy("pdf")
    try {
      await invoiceHtmlToPdf(await fetchHtml(), `Bill_${invoice?.orderId || orderId}.pdf`)
    } catch {
      toast.error("Could not save the bill")
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <AnimatedPage className="min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a] p-4">
        <div className="max-w-4xl mx-auto text-center py-20">
          <div className="w-8 h-8 border-2 border-[#E64100] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading bill...</p>
        </div>
      </AnimatedPage>
    )
  }

  if (error || !invoice) {
    return (
      <AnimatedPage className="min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a] p-4">
        <div className="max-w-4xl mx-auto text-center py-20">
          <h1 className="text-lg sm:text-xl font-bold mb-4">{error || "Bill not found"}</h1>
          <Link to="/user/orders"><Button>Back to Orders</Button></Link>
        </div>
      </AnimatedPage>
    )
  }

  const { restaurant, platform, customer, items = [], charges = [], payment = {}, paidSeparately = [] } = invoice
  const issued = new Date(invoice.issuedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })

  return (
    <AnimatedPage className="min-h-screen bg-[#f5f5f5] dark:bg-[#0a0a0a] p-3 sm:p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to={`/user/orders/${orderId}`}>
              <Button variant="ghost" size="icon" className="rounded-full h-9 w-9" aria-label="Back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-lg sm:text-xl font-bold">Bill</h1>
              <p className="text-muted-foreground text-sm">Order {invoice.orderId}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handlePrint} disabled={!!busy} className="h-9 gap-2 text-sm">
              {busy === "print" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              <span className="hidden sm:inline">Print</span>
            </Button>
            <Button onClick={handleDownload} disabled={!!busy} className="h-9 gap-2 text-sm bg-[#E64100] hover:bg-[#D94F0C] text-white">
              {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              PDF
            </Button>
          </div>
        </div>

        <Card className="dark:bg-[#1a1a1a] dark:border-gray-800">
          <CardContent className="p-4 sm:p-8 text-sm">
            <div className="flex flex-wrap justify-between gap-4 border-b-2 border-gray-900 dark:border-gray-200 pb-3 mb-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold">{platform?.name}</h2>
                {platform?.address ? <p className="text-xs text-muted-foreground">{platform.address}</p> : null}
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Bill</p>
                <p className="font-semibold">{invoice.invoiceNumber}</p>
                <p className="text-xs text-muted-foreground">{issued}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">From</p>
                <p className="font-semibold">{restaurant?.name}</p>
                {restaurant?.address ? <p className="text-xs text-muted-foreground">{restaurant.address}</p> : null}
                {restaurant?.gstin ? <p className="text-xs text-muted-foreground">GSTIN {restaurant.gstin}</p> : null}
                {restaurant?.fssaiNumber ? <p className="text-xs text-muted-foreground">FSSAI {restaurant.fssaiNumber}</p> : null}
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">To</p>
                <p className="font-semibold">{customer?.name}</p>
                {customer?.phone ? <p className="text-xs text-muted-foreground">{customer.phone}</p> : null}
                <p className="text-xs text-muted-foreground break-words">
                  {customer?.addressParts?.label ? `${customer.addressParts.label}: ` : ""}{customer?.address}
                </p>
                {customer?.deliveryInstructions ? (
                  <p className="text-xs text-muted-foreground">Instructions: {customer.deliveryInstructions}</p>
                ) : null}
                {customer?.orderedBy ? <p className="text-xs text-muted-foreground">Ordered by {customer.orderedBy}</p> : null}
              </div>
            </div>

            <table className="w-full mb-4">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b">
                  <th className="text-left py-2 font-medium">Item</th>
                  <th className="text-center py-2 font-medium w-12">Qty</th>
                  <th className="text-right py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100 dark:border-gray-800 align-top">
                    <td className="py-2 pr-2">
                      <span className="font-medium">{it.name}</span>
                      {it.variant ? <span className="block text-xs text-muted-foreground">{it.variant}</span> : null}
                      {it.addons?.length ? (
                        <span className="block text-xs text-muted-foreground">+ {it.addons.map((a) => a.name).join(", ")}</span>
                      ) : null}
                    </td>
                    <td className="py-2 text-center">{it.quantity}</td>
                    <td className="py-2 text-right whitespace-nowrap">{formatRupees(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="space-y-1.5 mb-3">
              {charges.map((c, i) => (
                <div key={i} className={`flex justify-between gap-3 ${c.amount < 0 ? "text-green-700 dark:text-green-400" : ""}`}>
                  <span>
                    {c.label}
                    {c.note ? <span className="block text-xs text-muted-foreground">{c.note}</span> : null}
                  </span>
                  <span className="whitespace-nowrap">{c.amount < 0 ? "-" : ""}{formatRupees(Math.abs(c.amount))}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-between text-base font-bold border-t-2 border-gray-900 dark:border-gray-200 pt-3">
              <span>Total</span>
              <span>{formatRupees(invoice.total)}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Paid by {payment.method}{payment.paid ? "" : " — payment pending"}
              {payment.refundAmount > 0 ? ` · ${formatRupees(payment.refundAmount)} refunded` : ""}
            </p>

            {paidSeparately.length ? (
              <div className="mt-3 pt-3 border-t border-dashed space-y-1">
                {paidSeparately.map((p, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <span>{p.label}<span className="block text-xs text-muted-foreground">{p.note}</span></span>
                    <span>{formatRupees(p.amount)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <p className="mt-6 text-center text-[11px] text-muted-foreground">
              This is a computer-generated bill and does not require a signature.
            </p>
          </CardContent>
        </Card>
      </div>
    </AnimatedPage>
  )
}
