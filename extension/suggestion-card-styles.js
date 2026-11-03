globalThis.jobSearchSuggestionStyles = `
      :host{--surface:#fff;--ink:#172535;--muted:#52677e;--border:#dce3eb;--shadow:#1026382b;--soft:#f3f6fa;--danger-surface:#fff1f2;--danger-border:#fecdd3;--danger:#b42318;--button-ink:#233c56;--hover:#edf3f9;--focus:#87b7f0;--primary:#205da8;--primary-ink:#fff}
      @media (prefers-color-scheme:dark){:host{--surface:#18212d;--ink:#e8edf5;--muted:#aab8cb;--border:#354458;--shadow:#0008;--soft:#222e3e;--danger-surface:#3b2028;--danger-border:#884452;--danger:#fda4af;--button-ink:#d6e5f7;--hover:#2b3a4e;--focus:#a1c9ff;--primary:#8bbcff;--primary-ink:#10243f}}
      *{box-sizing:border-box}
      article{font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 8px 30px var(--shadow);padding:15px;max-height:70vh;overflow:auto}
      small{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700}
      h2{font-size:16px;line-height:1.3;margin:8px 0 5px;overflow-wrap:anywhere}
      p{margin:7px 0;color:var(--muted)} .pay{font-weight:600;color:var(--ink)}
      details,.check-error{margin:10px 0;padding:8px 10px;border-radius:8px;background:var(--soft)}
      details.has-blockers{background:var(--danger-surface);border:1px solid var(--danger-border)}
      details.has-blockers summary,details.has-blockers blockquote,details.has-blockers li p{color:var(--danger)}
      summary{cursor:pointer;font-weight:600} li{margin:12px 0} blockquote{margin:0 0 6px;font-weight:600} ul{padding-left:17px;margin:0}
      .navigation{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;font-weight:600}.navigation button{padding:3px 12px;font-size:18px}
      .actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}
      button{font:inherit;font-size:12px;font-weight:600;padding:8px 6px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--button-ink);cursor:pointer}button:hover{background:var(--hover)}button:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
      button.primary{background:var(--primary);color:var(--primary-ink);border-color:var(--primary)}button:disabled{opacity:.55;cursor:wait}.feedback{font-size:12px;color:var(--danger)}
    `;
