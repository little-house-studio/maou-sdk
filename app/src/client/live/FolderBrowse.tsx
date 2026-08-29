import React, { useCallback, useEffect, useState } from "react";
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

  const load = useCallback((path?: string) => {
    setErr("");
    void browseFolders(path)
      .then((r) => {
        setCwd(r.path);
        setParent(r.parent);
        setEntries(r.entries);
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openHere = async (path = cwd) => {
    try {
      const r = await openProjectRoot(path);
      onOpened?.(r.projectRoot);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="wire-folder-browse" data-folder-browse="">
      <div className="wire-folder-path" title={cwd}>
        {cwd || "…"}
      </div>
      <div className="wire-folder-acts">
        {parent ? (
          <button type="button" className="wire-settings-theme-pick" onClick={() => load(parent)}>
            ..
          </button>
        ) : null}
        <button type="button" className="wire-settings-theme-pick" onClick={() => void openHere()}>
          {t("folder.open")}
        </button>
      </div>
      {err ? <p className="wire-settings-desc is-error">{err}</p> : null}
      <ul className="wire-folder-list">
        {entries.map((e) => (
          <li key={e.path}>
            <button type="button" className="wire-folder-item" onClick={() => load(e.path)}>
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
          if (!n || !cwd) return;
          void mkdirInBrowse(cwd, n)
            .then((r) => {
              setName("");
              load(r.path);
            })
            .catch((e: unknown) => {
              setErr(e instanceof Error ? e.message : String(e));
            });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("folder.mkdir")}
          aria-label={t("folder.mkdir")}
        />
        <button type="submit">{t("folder.mkdir")}</button>
      </form>
    </div>
  );
}
