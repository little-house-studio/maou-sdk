import React, { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { openProjectRoot, browseFolders, mkdirInBrowse } from "../api";
import { pickFolderNative } from "../open-local";

export type FolderBrowseProps = {
  onOpened?: (root: string) => void;
};

export async function pickAndOpenProject(): Promise<string | null> {
  const native = await pickFolderNative();
  if (!native) return null;
  const r = await openProjectRoot(native);
  return r.projectRoot;
}

export function FolderBrowse({ onOpened }: FolderBrowseProps) {
  const [cwd, setCwd] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<Array<{ name: string; path: string }>>([]);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestRef = useRef(0);
  const mutationRef = useRef(false);

  const load = useCallback((path?: string) => {
    const request = ++requestRef.current;
    setLoading(true);
    setErr("");
    void browseFolders(path)
      .then((r) => {
        if (request !== requestRef.current) return;
        setCwd(r.path);
        setParent(r.parent);
        setEntries(r.entries);
      })
      .catch((e: unknown) => {
        if (request === requestRef.current) setErr(e instanceof Error ? e.message : String(e));
      }).finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
    return () => { requestRef.current += 1; };
  }, [load]);

  const openHere = async (path = cwd) => {
    if (!path || loading || mutationRef.current) return;
    mutationRef.current = true;
    setBusy(true);
    setErr("");
    try {
      const r = await openProjectRoot(path);
      onOpened?.(r.projectRoot);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      mutationRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="wire-folder-browse" data-folder-browse="">
      <div className="wire-folder-path" title={cwd}>
        {cwd || "…"}
      </div>
      <div className="wire-folder-acts">
        {parent ? (
          <button type="button" className="wire-settings-theme-pick" disabled={loading || busy || !cwd} onClick={() => load(parent)}>
            ..
          </button>
        ) : null}
        <button type="button" className="wire-settings-theme-pick" disabled={loading || busy || !cwd} onClick={() => void openHere()}>
          {t("folder.open")}
        </button>
      </div>
      {loading ? <p role="status">加载文件夹…</p> : null}
      {err ? <p className="wire-settings-desc is-error" role="alert">{err}</p> : null}
      <ul className="wire-folder-list">
        {entries.map((e) => (
          <li key={e.path}>
            <button type="button" className="wire-folder-item" disabled={busy} onClick={() => load(e.path)}>
              {e.name}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="wire-folder-mkdir"
        onSubmit={(ev) => {
          ev.preventDefault();
          const n = name.trim();
          if (!n || !cwd || loading || mutationRef.current) return;
          mutationRef.current = true;
          setBusy(true);
          setErr("");
          void mkdirInBrowse(cwd, n)
            .then((r) => {
              setName("");
              load(r.path);
            })
            .catch((e: unknown) => {
              setErr(e instanceof Error ? e.message : String(e));
            }).finally(() => {
              mutationRef.current = false;
              setBusy(false);
            });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("folder.mkdir")}
          aria-label={t("folder.mkdir")}
        />
        <button type="submit" disabled={loading || busy || !cwd || !name.trim()}>{t("folder.mkdir")}</button>
      </form>
    </div>
  );
}
