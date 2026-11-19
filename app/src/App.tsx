import { reset, useSession } from './engine/session';
import { Brand } from './ui/Brand';
import { Landing } from './ui/Landing';
import { Report } from './ui/Report';

export default function App() {
  const phase = useSession((s) => s.phase);
  const error = useSession((s) => s.error);
  const readProgress = useSession((s) => s.readProgress);
  const name = useSession((s) => s.inputName);
  if (phase === 'idle') return <Landing />;
  if (phase === 'error')
    return (
      <div className="landing">
        <header className="topbar">
          <Brand />
        </header>
        <div className="error-panel">
          <h2>That file could not be audited</h2>
          <p style={{ color: 'var(--ink-2)' }}>{error}</p>
          <button className="btn primary" onClick={reset}>
            Try another file
          </button>
        </div>
      </div>
    );
  if (phase === 'reading')
    return (
      <div className="landing">
        <header className="topbar">
          <Brand />
        </header>
        <div className="error-panel">
          <div className="eyebrow">Reading</div>
          <h2 style={{ marginTop: 6 }}>{name}</h2>
          <p style={{ color: 'var(--ink-2)' }}>Extracting text, the reference list and citation markers…</p>
          <div className="progress">
            <i style={{ width: `${Math.max(4, readProgress * 100)}%` }} />
          </div>
        </div>
      </div>
    );
  return <Report />;
}
