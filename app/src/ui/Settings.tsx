import { useState } from 'react';

function load(): { openalex?: string; s2?: string } {
  try {
    return JSON.parse(localStorage.getItem('veracite-keys') ?? '{}');
  } catch {
    return {};
  }
}

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  const [keys, setKeys] = useState(load);
  const save = () => {
    try {
      localStorage.setItem('veracite-keys', JSON.stringify(keys));
    } catch {
      /* storage blocked */
    }
    setOpen(false);
  };
  return (
    <>
      <button className="btn ghost" onClick={() => setOpen(true)} aria-label="Settings">
        Settings
      </button>
      {open && (
        <div className="dialog-back" onClick={() => setOpen(false)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="settings-h" onClick={(e) => e.stopPropagation()}>
            <h2 id="settings-h">Faster lookups</h2>
            <p>Veracite works without keys. OpenAlex and Semantic Scholar throttle anonymous traffic, so free personal keys make large reference lists much faster. Keys are stored only in this browser.</p>
            <label htmlFor="k-oa">OpenAlex API key</label>
            <input id="k-oa" value={keys.openalex ?? ''} onChange={(e) => setKeys({ ...keys, openalex: e.target.value.trim() })} placeholder="free at openalex.org" />
            <label htmlFor="k-s2">Semantic Scholar API key</label>
            <input id="k-s2" value={keys.s2 ?? ''} onChange={(e) => setKeys({ ...keys, s2: e.target.value.trim() })} placeholder="free at semanticscholar.org/product/api" />
            <div className="actions">
              <button className="btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={save}>
                Save keys
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
