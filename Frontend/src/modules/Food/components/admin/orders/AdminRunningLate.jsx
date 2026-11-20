import { useState } from "react"
import { toast } from "sonner"
import { Clock } from "lucide-react"
import { adminAPI } from "@food/api"

const LIVE = ["created", "confirmed", "preparing", "ready_for_pickup", "reached_pickup", "picked_up", "reached_drop"]
const REASONS = [
  ["traffic", "Traffic"],
  ["rain", "Rain"],
  ["restaurant_delay", "Restaurant delay"],
  ["other", "Other"],
]

/**
 * Admin: tell the customer the order is running late (reason + extra minutes).
 * Moves the order's ETA and pushes to the customer, like the rider's button.
 */
export default function AdminRunningLate({ order, onChanged }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("restaurant_delay")
  const [minutes, setMinutes] = useState(10)
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)

  const status = String(order?.orderStatus || order?.status || "")
  const orderId = order?._id || order?.id
  if (!orderId || !LIVE.includes(status)) return null

  const delay = order?.delay
  const send = async () => {
    if (reason === "other" && !note.trim()) {
      toast.error("Say what the delay is")
      return
    }
    setSending(true)
    try {
      const res = await adminAPI.reportOrderRunningLate(orderId, { reason, extraMinutes: Number(minutes), note: note.trim() || undefined })
      toast.success(res?.data?.data?.message || "Customer notified")
      setOpen(false)
      setNote("")
      onChanged?.()
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not send the update")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border-t border-slate-200 pt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-slate-600 flex items-center gap-2">
          <Clock className="w-4 h-4" />
          {delay
            ? `Reported late${delay.extraMinutes ? ` (+${delay.extraMinutes} min)` : ""}${delay.reasonLabel ? ` · ${delay.reasonLabel}` : ""}${delay.newEta ? ` · new ETA ${new Date(delay.newEta).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : ""}`
            : "Tell the customer this order is running late."}
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="px-3 py-1.5 rounded-md border border-amber-300 bg-amber-50 text-amber-800 text-sm font-medium">
            Running late
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            Reason
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="block mt-1 border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              {REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Extra minutes
            <input type="number" min="1" max="120" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="block mt-1 w-24 border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-slate-600 flex-1 min-w-[160px]">
            Note
            <input type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "other" ? "Required" : "Optional"} className="block mt-1 w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" />
          </label>
          <button type="button" disabled={sending} onClick={send} className="px-3 py-2 rounded-md bg-slate-900 text-white text-sm font-medium disabled:opacity-60">
            {sending ? "Sending..." : "Notify customer"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 rounded-md border border-slate-300 text-sm">Cancel</button>
        </div>
      )}
    </div>
  )
}
