import { useEffect, useState } from "react"
import { ChevronRight, Copy, ExternalLink, FileText, Folder, FolderOpen, Loader2, Upload } from "lucide-react"
import { toast } from "sonner"
import { adminAPI, uploadAPI } from "@food/api"

/**
 * The upload store: browse folders, see and copy the link of any file, and
 * upload images into the admin folder to use elsewhere (email templates,
 * landing pages ...). Files cannot be deleted here: a record may still use one.
 */
const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const isImage = (name) => /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(name)
const isVideo = (name) => /\.(mp4|webm)$/i.test(name)
const ADMIN_FOLDER = "quickspicy/admin/gallery"

export default function Gallery() {
  const [folder, setFolder] = useState("")
  const [data, setData] = useState({ folders: [], files: [] })
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    adminAPI
      .listFiles(folder)
      .then((res) => { if (!cancelled) setData(res?.data?.data || { folders: [], files: [] }) })
      .catch((e) => { if (!cancelled) { setData({ folders: [], files: [] }); toast.error(e?.response?.data?.message || "Could not open this folder") } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [folder, reload])

  const crumbs = folder ? folder.split("/") : []
  const copy = async (url) => {
    try { await navigator.clipboard.writeText(url); toast.success("Link copied") } catch { toast.error("Could not copy; open the file and copy its address") }
  }

  const upload = async (e) => {
    const files = [...(e.target.files || [])]
    e.target.value = ""
    if (!files.length) return
    setUploading(true)
    let ok = 0
    for (const file of files) {
      try { await uploadAPI.uploadMedia(file, { folder: ADMIN_FOLDER }); ok++ } catch (err) { toast.error(`${file.name}: ${err?.response?.data?.message || err?.message || "upload failed"}`) }
    }
    setUploading(false)
    if (ok) {
      toast.success(`Uploaded ${ok} file${ok > 1 ? "s" : ""} to ${ADMIN_FOLDER}`)
      setFolder(ADMIN_FOLDER)
      setReload((n) => n + 1)
    }
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2"><FolderOpen className="w-6 h-6 text-orange-600" /> File Manager</h1>
            <p className="text-sm text-slate-500 mt-1">Every uploaded image and video. Copy a link to use it elsewhere. Files are not deleted here, because a restaurant, dish or banner may still use them.</p>
          </div>
          <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white whitespace-nowrap ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}{uploading ? "Uploading…" : "Upload images"}
            <input type="file" accept="image/*" multiple className="hidden" onChange={upload} />
          </label>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-center gap-1 text-sm">
          <button type="button" onClick={() => setFolder("")} className="rounded px-2 py-1 font-semibold text-orange-700 hover:bg-orange-50">uploads</button>
          {crumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <ChevronRight className="w-4 h-4 text-slate-400" />
              <button type="button" onClick={() => setFolder(crumbs.slice(0, i + 1).join("/"))} className="rounded px-2 py-1 hover:bg-slate-100">{c}</button>
            </span>
          ))}
        </div>

        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-orange-600" /></div>
        ) : (
          <>
            {data.folders.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {data.folders.map((f) => (
                  <button type="button" key={f} onClick={() => setFolder(f)} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-left text-sm hover:border-orange-300">
                    <Folder className="w-5 h-5 text-orange-500 shrink-0" /><span className="truncate">{f.split("/").pop()}</span>
                  </button>
                ))}
              </div>
            )}
            {data.files.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {data.files.map((f) => (
                  <div key={f.path} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="aspect-square bg-slate-100 flex items-center justify-center">
                      {isImage(f.name) ? <img src={f.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                        : isVideo(f.name) ? <video src={f.url} muted className="h-full w-full object-cover" />
                        : <FileText className="w-8 h-8 text-slate-400" />}
                    </div>
                    <div className="p-2">
                      <p className="truncate text-xs font-medium text-slate-700" title={f.name}>{f.name}</p>
                      <p className="text-[11px] text-slate-400">{size(f.size)} · {new Date(f.modifiedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
                      <div className="mt-2 flex gap-1">
                        <button type="button" onClick={() => copy(f.url)} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold"><Copy className="w-3 h-3" />Copy link</button>
                        <a href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-1" aria-label="Open"><ExternalLink className="w-3 h-3" /></a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : !data.folders.length && (
              <p className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-500">This folder is empty.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
