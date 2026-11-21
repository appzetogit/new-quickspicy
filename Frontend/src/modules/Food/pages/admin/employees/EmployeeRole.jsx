import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { adminAPI } from "@food/api";
import { toast } from "sonner";
import { adminSectionLabel } from "@food/utils/adminRbac";

/**
 * Permission matrix. Each section row can be expanded to its submenus (the
 * sidebar pages under it). A submenu inherits its section until one of its
 * boxes is changed; from then on it has its own actions, which win over the
 * section. "Inherit" puts it back.
 *
 * Shape sent to the API:
 *   { [section]: [actions], submenus: { [section]: { [submenuKey]: [actions] } } }
 */

const sameSet = (a = [], b = []) => a.length === b.length && a.every((it) => b.includes(it));

/** Tri-state checkbox: checked, unchecked or indeterminate. */
function TriCheckbox({ state, onChange, title }) {
  return (
    <input
      type="checkbox"
      title={title}
      checked={state === "all"}
      ref={(el) => {
        if (el) el.indeterminate = state === "some";
      }}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

const triState = (selected, actions) => {
  const count = actions.filter((a) => selected.includes(a)).length;
  if (count === 0) return "none";
  return count === actions.length ? "all" : "some";
};

export default function EmployeeRole() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const subAdminId = searchParams.get("id");
  const [catalog, setCatalog] = useState({ sections: [], actions: [] });
  const [subAdmin, setSubAdmin] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!subAdminId) return;
    setLoading(true);
    try {
      const [catalogRes, subAdminRes] = await Promise.all([
        adminAPI.getSubAdminPermissionCatalog(),
        adminAPI.getSubAdminById(subAdminId),
      ]);
      const sections = catalogRes?.data?.data?.sections || [];
      const actions = catalogRes?.data?.data?.actions || [];
      const sa = subAdminRes?.data?.data?.subAdmin || null;
      setCatalog({ sections, actions });
      setSubAdmin(sa);
      setPermissions(sa?.permissions || {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [subAdminId]);

  const canSave = useMemo(() => Boolean(subAdminId && subAdmin), [subAdminId, subAdmin]);

  const sectionActions = (perms, sectionKey) =>
    Array.isArray(perms?.[sectionKey]) ? perms[sectionKey] : [];
  const explicitFor = (perms, sectionKey, submenuKey) => {
    const list = perms?.submenus?.[sectionKey]?.[submenuKey];
    return Array.isArray(list) ? list : null;
  };
  const effectiveFor = (perms, sectionKey, submenuKey) =>
    explicitFor(perms, sectionKey, submenuKey) ?? sectionActions(perms, sectionKey);

  /** Sets (or with null, removes) one submenu override, dropping empty containers. */
  const withSubmenu = (prev, sectionKey, submenuKey, list) => {
    const submenus = { ...(prev?.submenus || {}) };
    const forSection = { ...(submenus[sectionKey] || {}) };
    if (list === null) delete forSection[submenuKey];
    else forSection[submenuKey] = list;
    if (Object.keys(forSection).length) submenus[sectionKey] = forSection;
    else delete submenus[sectionKey];
    const next = { ...prev };
    if (Object.keys(submenus).length) next.submenus = submenus;
    else delete next.submenus;
    return next;
  };

  const toggleAction = (sectionKey, action) => {
    setPermissions((prev) => {
      const current = sectionActions(prev, sectionKey);
      const next = current.includes(action)
        ? current.filter((it) => it !== action)
        : [...current, action];
      return { ...prev, [sectionKey]: next };
    });
  };

  /** Section "All": every action on/off for the section and all its submenus. */
  const toggleAllSection = (sectionKey, checked) => {
    setPermissions((prev) => {
      const next = { ...prev, [sectionKey]: checked ? [...catalog.actions] : [] };
      if (next.submenus?.[sectionKey]) {
        const submenus = { ...next.submenus };
        delete submenus[sectionKey];
        if (Object.keys(submenus).length) next.submenus = submenus;
        else delete next.submenus;
      }
      return next;
    });
  };

  const toggleSubmenuAction = (sectionKey, submenuKey, action) => {
    setPermissions((prev) => {
      // The first change turns an inheriting submenu into its own entry,
      // starting from what it was inheriting.
      const current = effectiveFor(prev, sectionKey, submenuKey);
      const next = current.includes(action)
        ? current.filter((it) => it !== action)
        : [...current, action];
      return withSubmenu(prev, sectionKey, submenuKey, next);
    });
  };

  const toggleAllSubmenu = (sectionKey, submenuKey, checked) => {
    setPermissions((prev) => withSubmenu(prev, sectionKey, submenuKey, checked ? [...catalog.actions] : []));
  };

  const setInherit = (sectionKey, submenuKey, inherit) => {
    setPermissions((prev) =>
      withSubmenu(prev, sectionKey, submenuKey, inherit ? null : [...sectionActions(prev, sectionKey)]),
    );
  };

  /** Section "All" is indeterminate when a submenu is customised below or above it. */
  const sectionTriState = (section) => {
    const selected = sectionActions(permissions, section.key);
    const own = triState(selected, catalog.actions);
    const overrides = Object.values(permissions?.submenus?.[section.key] || {});
    if (!overrides.length) return own;
    const differs = overrides.some((list) => !sameSet(
      catalog.actions.filter((a) => list.includes(a)),
      catalog.actions.filter((a) => selected.includes(a)),
    ));
    return differs ? "some" : own;
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await adminAPI.updateSubAdminPermissions(subAdminId, permissions);
      // Saving said nothing and stayed put, so the only way to tell whether it
      // had worked was to reload the page and re-read the checkboxes.
      const granted = catalog.sections.filter((s) => sectionActions(permissions, s.key).length
        || Object.values(permissions?.submenus?.[s.key] || {}).some((list) => list.length)).length;
      const customised = Object.values(permissions?.submenus || {})
        .reduce((sum, forSection) => sum + Object.keys(forSection || {}).length, 0);
      toast.success(
        granted
          ? `Permissions saved — ${granted} section${granted === 1 ? "" : "s"} granted${customised ? `, ${customised} submenu${customised === 1 ? "" : "s"} customised` : ""}`
          : "Permissions saved — this sub-admin now has no access",
      );
      navigate("/admin/food/employees");
    } catch (error) {
      // The interceptor reports why; staying on the page keeps the unsaved
      // selection so it does not have to be ticked again.
    } finally {
      setSaving(false);
    }
  };

  if (!subAdminId) {
    return <div className="p-6 text-sm text-red-600">Missing sub-admin id in URL. Open from Sub Admin List.</div>;
  }

  return (
    <div className="p-4 lg:p-6 bg-slate-50 min-h-screen space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h1 className="text-2xl font-bold text-slate-900">Sub Admin Permission Matrix</h1>
        <p className="text-sm text-slate-600 mt-1">{subAdmin ? `${subAdmin.name || "Unnamed"} (${subAdmin.email})` : "Loading sub-admin..."}</p>
        <p className="text-xs text-slate-500 mt-2">
          Expand a section to set its submenus one by one. A submenu follows its section until you change one of its
          boxes; "Inherit" puts it back. A submenu given an action its section lacks turns that action on for the
          section, with the other submenus kept exactly as they were.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 overflow-x-auto">
        {loading ? (
          <p className="text-sm text-slate-500">Loading permissions...</p>
        ) : (
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left p-3 text-sm font-semibold">Section</th>
                <th className="text-left p-3 text-sm font-semibold">Inherit</th>
                <th className="text-left p-3 text-sm font-semibold">All</th>
                {catalog.actions.map((action) => (
                  <th key={action} className="text-left p-3 text-sm font-semibold capitalize">{action}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {catalog.sections.map((section) => {
                const selected = sectionActions(permissions, section.key);
                const submenus = Array.isArray(section.submenus) ? section.submenus : [];
                const isOpen = Boolean(expanded[section.key]);
                const customised = Object.keys(permissions?.submenus?.[section.key] || {}).length;
                return (
                  <Fragment key={section.key}>
                    <tr className="border-b border-slate-100 bg-white">
                      <td className="p-3 text-sm font-medium">
                        {submenus.length ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 text-left"
                            aria-expanded={isOpen}
                            onClick={() => setExpanded((prev) => ({ ...prev, [section.key]: !prev[section.key] }))}
                          >
                            <span className="inline-block w-4 text-slate-500">{isOpen ? "▾" : "▸"}</span>
                            <span>{adminSectionLabel(section.key)}</span>
                            <span className="text-xs font-normal text-slate-500">
                              {submenus.length} submenu{submenus.length === 1 ? "" : "s"}
                              {customised ? ` · ${customised} customised` : ""}
                            </span>
                          </button>
                        ) : (
                          <span className="pl-6">{adminSectionLabel(section.key)}</span>
                        )}
                      </td>
                      <td className="p-3" />
                      <td className="p-3">
                        <TriCheckbox
                          state={sectionTriState(section)}
                          title="All actions for this section and its submenus"
                          onChange={(checked) => toggleAllSection(section.key, checked)}
                        />
                      </td>
                      {catalog.actions.map((action) => (
                        <td key={action} className="p-3">
                          <input
                            type="checkbox"
                            checked={selected.includes(action)}
                            onChange={() => toggleAction(section.key, action)}
                          />
                        </td>
                      ))}
                    </tr>
                    {isOpen &&
                      submenus.map((submenu) => {
                        const explicit = explicitFor(permissions, section.key, submenu.key);
                        const effective = explicit ?? selected;
                        return (
                          <tr key={`${section.key}:${submenu.key}`} className="border-b border-slate-100 bg-slate-50">
                            <td className="p-2 pl-12 text-sm text-slate-700">{submenu.label || submenu.key}</td>
                            <td className="p-2">
                              <input
                                type="checkbox"
                                title="Follow the section's permissions"
                                checked={!explicit}
                                onChange={(e) => setInherit(section.key, submenu.key, e.target.checked)}
                              />
                            </td>
                            <td className="p-2">
                              <TriCheckbox
                                state={triState(effective, catalog.actions)}
                                onChange={(checked) => toggleAllSubmenu(section.key, submenu.key, checked)}
                              />
                            </td>
                            {catalog.actions.map((action) => (
                              <td key={action} className="p-2">
                                <input
                                  type="checkbox"
                                  className={explicit ? "" : "opacity-50"}
                                  checked={effective.includes(action)}
                                  onChange={() => toggleSubmenuAction(section.key, submenu.key, action)}
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <button disabled={!canSave || saving} onClick={save} className="px-4 py-2 bg-black text-white rounded-lg">
          {saving ? "Saving..." : "Save Permissions"}
        </button>
      </div>
    </div>
  );
}
