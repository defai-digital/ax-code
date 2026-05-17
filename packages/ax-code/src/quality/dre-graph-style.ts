export function style() {
  return `
    /* ── Shared structural variables ── */
    :root {
      --radius: 12px; --radius-sm: 8px; --radius-xs: 6px;
    }
    /* ── Dark theme (default) ── */
    :root, [data-theme="dark"] {
      color-scheme: dark;
      --bg: #09090b; --panel: #18181b; --surface: #27272a;
      --line: #3f3f46; --line-subtle: #27272a;
      --text: #fafafa; --text-secondary: #d4d4d8; --muted: #a1a1aa;
      --accent: #3b82f6; --accent-light: #60a5fa; --accent-subtle: rgba(59,130,246,0.1);
      --warn: #eab308; --high: #ef4444; --critical: #dc2626; --low: #22c55e;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.35);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.30);
      --shadow-lg: 0 8px 32px rgba(0,0,0,0.40);
      --nav-bg: rgba(9,9,11,0.85);
    }
    /* ── Light theme ── */
    [data-theme="light"] {
      color-scheme: light;
      --bg: #f8fafc; --panel: #ffffff; --surface: #f1f5f9;
      --line: #cbd5e1; --line-subtle: #e2e8f0;
      --text: #0f172a; --text-secondary: #475569; --muted: #94a3b8;
      --accent: #2563eb; --accent-light: #3b82f6; --accent-subtle: rgba(37,99,235,0.08);
      --warn: #d97706; --high: #dc2626; --critical: #b91c1c; --low: #16a34a;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
      --shadow-lg: 0 8px 32px rgba(0,0,0,0.12);
      --nav-bg: rgba(248,250,252,0.90);
    }
    * { box-sizing: border-box; margin: 0; }
    html { scroll-behavior: smooth; scroll-padding-top: 56px; }
    body {
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      font-feature-settings: "cv11", "ss01";
    }
    a { color: var(--accent-light); text-decoration: none; transition: color 0.15s; }
    a:hover { color: var(--text); text-decoration: none; }
    h2 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
    h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 12px; }
    p { color: var(--muted); line-height: 1.6; }

    /* Navigation */
    .nav {
      position: sticky; top: 0; z-index: 10;
      background: var(--nav-bg);
      backdrop-filter: blur(20px) saturate(180%);
      border-bottom: 1px solid var(--line-subtle);
      padding: 0 24px;
    }
    .theme-btn {
      margin-left: 8px; padding: 4px 10px; font-size: 12px; font-weight: 500;
      border: 1px solid var(--line); border-radius: var(--radius-xs);
      background: var(--surface); color: var(--text-secondary);
      cursor: pointer; white-space: nowrap; transition: all 0.15s;
      font-family: inherit;
    }
    .theme-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-subtle); }
    .nav-inner {
      max-width: 1200px; margin: 0 auto;
      display: flex; align-items: center; gap: 2px; height: 52px;
      overflow-x: auto;
    }
    .nav-brand {
      font-weight: 700; font-size: 14px; color: var(--text); white-space: nowrap;
      margin-right: 16px; letter-spacing: -0.02em;
    }
    .nav-link {
      font-size: 13px; color: var(--muted); white-space: nowrap;
      padding: 8px 12px; border-radius: var(--radius-xs);
      transition: all 0.15s;
    }
    .nav-link:hover { color: var(--text); text-decoration: none; background: var(--surface); }
    .nav-back { font-size: 13px; color: var(--muted); white-space: nowrap; margin-left: auto; padding: 6px 12px; border-radius: var(--radius-xs); transition: all 0.15s; }
    .nav-back:hover { color: var(--text); text-decoration: none; background: var(--surface); }
    .nav-sep { width: 1px; height: 16px; background: var(--line-subtle); flex-shrink: 0; margin: 0 8px; }
    .live { font-size: 11px; color: var(--muted); white-space: nowrap; padding: 3px 10px; border-radius: 20px; background: var(--surface); }
    .live.sync { color: var(--low); background: rgba(34,197,94,0.08); }
    .live.wait { color: var(--warn); background: rgba(234,179,8,0.08); }
    .live.off { color: var(--high); background: rgba(239,68,68,0.08); }

    /* Layout */
    .band { padding: 32px 24px; }
    .band + .band { border-top: 1px solid var(--line-subtle); }
    .wrap { max-width: 1200px; margin: 0 auto; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 16px; }
    .grid-thirds { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
    .section-head { margin-bottom: 8px; }
    .section-head h2 { margin-bottom: 2px; }
    .section-head p { margin: 0; font-size: 13px; }

    /* ── Summary banner ── */
    .summary {
      padding: 48px 24px 40px;
      background: linear-gradient(180deg, rgba(24,24,27,0.9) 0%, var(--bg) 100%);
      border-bottom: 1px solid var(--line-subtle);
    }
    .summary-grid { display: flex; gap: 40px; align-items: flex-start; }
    .summary-risk { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .summary-details { flex: 1; min-width: 0; }
    .summary-decision { font-size: 22px; font-weight: 600; line-height: 1.3; margin-bottom: 6px; letter-spacing: -0.02em; color: var(--text); }
    .summary-plan { color: var(--muted); font-size: 14px; margin-bottom: 24px; line-height: 1.6; }
    .summary-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .summary-stats .stat { min-width: 0; }
    .semantic-banner {
      margin-top: 28px; padding: 16px 20px;
      background: var(--panel); border: 1px solid var(--line-subtle); border-radius: var(--radius);
      display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
      box-shadow: var(--shadow-sm);
    }
    .semantic-icon { font-size: 18px; color: var(--accent); }
    .semantic-text { font-size: 14px; font-weight: 500; flex: 1; min-width: 200px; color: var(--text-secondary); }
    .semantic-chips { display: flex; flex-wrap: wrap; gap: 6px; }

    /* Panels */
    .panel {
      background: var(--panel); border: 1px solid var(--line-subtle);
      border-radius: var(--radius); padding: 24px;
      box-shadow: var(--shadow-sm);
      transition: border-color 0.2s;
    }
    .panel:hover { border-color: var(--line); }
    .panel-head { margin-bottom: 16px; }
    .panel-head h2 { margin-bottom: 4px; }
    .panel-head p { margin: 0; }

    /* Stats */
    .stat {
      flex: 1; min-width: 100px;
      border: 1px solid var(--line-subtle); border-radius: var(--radius-sm);
      padding: 12px 14px; background: var(--panel);
      display: flex; flex-direction: column; gap: 3px;
      transition: border-color 0.15s;
    }
    .stat:hover { border-color: var(--line); }
    .stat-icon { font-size: 14px; opacity: 0.45; margin-bottom: 2px; }
    .stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
    .stat-value { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
    .stat.low { border-left: 3px solid var(--low); }
    .stat.medium { border-left: 3px solid var(--warn); }
    .stat.high { border-left: 3px solid var(--high); }
    .stat.critical { border-left: 3px solid var(--critical); }

    /* Chips */
    .chip {
      display: inline-flex; align-items: center;
      padding: 3px 10px; border-radius: 20px;
      font-size: 11px; font-weight: 500;
      border: 1px solid var(--line-subtle); background: var(--panel);
      color: var(--text-secondary);
    }
    .chip.low { color: var(--low); border-color: rgba(34, 197, 94, 0.25); background: rgba(34,197,94,0.06); }
    .chip.medium { color: var(--warn); border-color: rgba(234, 179, 8, 0.25); background: rgba(234,179,8,0.06); }
    .chip.high { color: var(--high); border-color: rgba(239, 68, 68, 0.25); background: rgba(239,68,68,0.06); }
    .chip.critical { color: var(--critical); border-color: rgba(220, 38, 38, 0.25); background: rgba(220,38,38,0.06); }
    .tag-row { display: flex; flex-wrap: wrap; gap: 6px; }

    /* Flow — compressed with run-length grouping */
    .flow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .node {
      padding: 4px 10px; border-radius: var(--radius-xs);
      font-size: 12px; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      background: var(--accent-subtle); border: 1px solid rgba(59, 130, 246, 0.15); color: var(--accent-light);
      transition: background 0.15s;
    }
    .node:hover { background: rgba(59,130,246,0.15); }
    .node.group { padding-right: 6px; }
    .node-count {
      display: inline-block; margin-left: 4px; padding: 1px 5px;
      border-radius: 8px; font-size: 10px; font-weight: 700;
      background: rgba(59, 130, 246, 0.2); color: var(--accent-light);
    }
    .node.trunc { background: rgba(161,161,170,0.08); border-color: rgba(161,161,170,0.15); color: var(--muted); font-style: italic; }
    .join { width: 12px; height: 1px; background: rgba(59, 130, 246, 0.25); border-radius: 999px; }
    .flow-summary { font-size: 11px; color: var(--muted); margin-top: 8px; }

    /* Step summary — mini bar charts per step */
    .step-bars { display: grid; gap: 4px; }
    .step-bar-row { display: grid; grid-template-columns: 90px 1fr 28px; gap: 6px; align-items: center; font-size: 12px; }
    .step-bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-family: ui-monospace, SFMono-Regular, monospace; }
    .step-bar-track { height: 6px; background: rgba(48,54,61,0.5); border-radius: 3px; overflow: hidden; }
    .step-bar-fill { height: 100%; border-radius: 3px; min-width: 2px; }
    .step-bar-count { text-align: right; color: var(--muted); font-family: ui-monospace, SFMono-Regular, monospace; }
    .lane-count { float: right; font-weight: 400; color: var(--muted); font-size: 11px; }

    /* Agent routes */
    .route-flow { display: flex; flex-wrap: wrap; gap: 8px; }
    .route-item {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: var(--radius-sm);
      background: var(--panel); border: 1px solid var(--line-subtle); font-size: 13px;
      transition: border-color 0.15s;
    }
    .route-item:hover { border-color: var(--line); }
    .route-from, .route-to { font-weight: 600; color: var(--text); }
    .route-arrow { color: var(--accent); }
    .route-conf { color: var(--muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, monospace; }

    /* Risk drivers */
    .driver-list { display: grid; gap: 0; }
    .driver-item {
      display: flex; gap: 10px; align-items: baseline; font-size: 13px; line-height: 1.5;
      padding: 8px 0; border-bottom: 1px solid var(--line-subtle);
      color: var(--text-secondary);
    }
    .driver-item:last-child { border-bottom: none; }
    .driver-icon { color: var(--accent); flex-shrink: 0; }

    /* Risk status indicators */
    .risk-status-row {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
      margin: 16px 0 12px;
    }
    .risk-indicator {
      display: flex; gap: 10px; align-items: center;
      padding: 12px 14px; border-radius: var(--radius-sm);
      background: var(--panel); border: 1px solid var(--line-subtle);
      transition: border-color 0.15s;
    }
    .risk-indicator:hover { border-color: var(--line); }
    .ri-icon {
      width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; flex-shrink: 0;
    }
    .risk-indicator.low .ri-icon { background: rgba(34,197,94,0.12); color: var(--low); }
    .risk-indicator.medium .ri-icon { background: rgba(234,179,8,0.12); color: var(--warn); }
    .risk-indicator.high .ri-icon { background: rgba(239,68,68,0.12); color: var(--high); }
    .risk-indicator.critical .ri-icon { background: rgba(220,38,38,0.12); color: var(--critical); }
    .ri-content { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .ri-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }
    .ri-value { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Risk flags */
    .risk-flags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }

    /* Signal grid */
    .signal-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
    }
    .signal-item {
      display: flex; flex-direction: column; gap: 2px;
      padding: 10px 12px; border-radius: var(--radius-xs);
      background: var(--surface);
    }
    .signal-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
    .signal-value { font-size: 14px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, monospace; }
    .signal-value.low { color: var(--low); }
    .signal-value.medium { color: var(--warn); }
    .signal-value.high { color: var(--high); }
    .signal-value.neutral { color: var(--text-secondary); }

    /* Evidence / Unknowns / Actions lists */
    .evidence-list { display: grid; gap: 0; }
    .evidence-item {
      display: flex; gap: 10px; align-items: baseline; font-size: 13px; line-height: 1.5;
      padding: 8px 0; border-bottom: 1px solid var(--line-subtle);
      color: var(--text-secondary);
    }
    .evidence-item:last-child { border-bottom: none; }
    .ev-icon {
      width: 20px; height: 20px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700; flex-shrink: 0;
    }
    .ev-evidence { background: rgba(59,130,246,0.12); color: var(--accent-light); }
    .ev-unknown { background: rgba(234,179,8,0.12); color: var(--warn); }
    .ev-action { background: rgba(34,197,94,0.12); color: var(--low); }

    /* Tables */
    .table-wrap { overflow-x: auto; border-radius: var(--radius-sm); border: 1px solid var(--line-subtle); }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .data-table th {
      text-align: left; font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--muted);
      padding: 10px 16px; background: rgba(39,39,42,0.5); font-weight: 600;
    }
    .data-table td { padding: 10px 16px; border-top: 1px solid var(--line-subtle); vertical-align: top; color: var(--text-secondary); }
    .data-table tbody tr:first-child td { border-top: 1px solid var(--line-subtle); }
    .data-table tr:hover td { background: rgba(59, 130, 246, 0.03); }
    .data-table .num { font-family: ui-monospace, SFMono-Regular, monospace; text-align: right; white-space: nowrap; font-weight: 500; }
    .data-table .num.low { color: var(--low); }
    .data-table .num.medium { color: var(--warn); }
    .data-table .num.high { color: var(--high); }
    .block { display: block; }

    /* Gantt-style timeline */
    .gantt { display: grid; gap: 0; }
    .gantt-step {
      border-bottom: 1px solid var(--line-subtle);
      padding: 12px 0;
    }
    .gantt-step:last-child { border-bottom: none; }
    .gantt-header {
      display: grid; grid-template-columns: 60px 1fr 50px; gap: 10px;
      align-items: center; font-size: 13px;
    }
    .gantt-label { font-weight: 600; white-space: nowrap; color: var(--text); font-size: 13px; }
    .gantt-bar-wrap {
      height: 10px; background: var(--surface); border-radius: 5px;
      overflow: hidden;
    }
    .gantt-bar { height: 100%; border-radius: 5px; min-width: 3px; transition: width 0.4s ease; }
    .gantt-dur {
      font-size: 12px; color: var(--muted); text-align: right;
      font-family: ui-monospace, SFMono-Regular, monospace; white-space: nowrap;
    }
    .gantt-meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
    .gantt-tools-sig {
      font-size: 12px; color: var(--text-secondary);
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .gantt-route { font-size: 12px; color: var(--accent-light); }
    .gantt-details { margin-top: 8px; }
    .gantt-summary {
      font-size: 12px; color: var(--muted); cursor: pointer;
      padding: 6px 10px; border-radius: var(--radius-xs);
      list-style: none; user-select: none;
      transition: background 0.15s;
    }
    .gantt-summary::-webkit-details-marker { display: none; }
    .gantt-summary::before { content: "▸ "; color: var(--accent); }
    details[open] > .gantt-summary::before { content: "▾ "; }
    .gantt-summary:hover { background: var(--surface); }
    .gantt-err { color: var(--high); font-weight: 600; }
    .gantt-tools { padding: 10px 0 4px 18px; display: grid; gap: 5px; }
    .gantt-tool-row {
      display: grid; grid-template-columns: 130px 1fr 50px; gap: 8px;
      align-items: center; font-size: 12px;
    }
    .gantt-tool-name {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-family: ui-monospace, SFMono-Regular, monospace; color: var(--text-secondary);
    }
    .gantt-tool-count {
      font-size: 10px; font-weight: 600; padding: 1px 5px;
      border-radius: 6px; background: var(--accent-subtle); color: var(--accent-light);
    }
    .gantt-tool-bar-wrap { height: 4px; background: var(--surface); border-radius: 2px; overflow: hidden; }
    .gantt-tool-bar { height: 100%; border-radius: 2px; min-width: 2px; }
    .gantt-tool-ms {
      font-size: 11px; color: var(--muted); text-align: right;
      font-family: ui-monospace, SFMono-Regular, monospace; white-space: nowrap;
    }
    .gantt-error {
      padding: 6px 10px; margin-top: 6px; font-size: 12px;
      color: var(--high); background: rgba(239,68,68,0.06);
      border-left: 2px solid var(--high); border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
    }

    /* Rollback — horizontal bar list */
    .rb-count {
      font-size: 10px; font-weight: 600; padding: 2px 8px;
      border-radius: 20px; background: var(--surface); color: var(--muted);
      margin-left: 6px; vertical-align: middle;
    }
    .rb-bars-list { display: grid; gap: 0; }
    .rb-row {
      display: grid; grid-template-columns: 28px 1fr; gap: 10px;
      align-items: center; padding: 8px 0;
      border-bottom: 1px solid var(--line-subtle);
      transition: background 0.1s;
    }
    .rb-row:last-child { border-bottom: none; }
    .rb-row:hover { background: rgba(59,130,246,0.02); }
    .rb-idx {
      font-size: 11px; font-weight: 600; color: var(--muted); text-align: center;
      width: 24px; height: 24px; line-height: 24px;
      border-radius: 50%; background: var(--surface);
    }
    .rb-content { display: grid; gap: 3px; }
    .rb-bar-line { display: grid; grid-template-columns: 1fr 44px; gap: 8px; align-items: center; }
    .rb-bar-track { height: 6px; background: var(--surface); border-radius: 3px; overflow: hidden; }
    .rb-bar-fill { height: 100%; border-radius: 3px; min-width: 3px; }
    .rb-dur {
      font-size: 12px; color: var(--text-secondary); text-align: right;
      font-family: ui-monospace, SFMono-Regular, monospace; white-space: nowrap;
    }
    .rb-tools-text { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Steps */
    .step-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
    .lane {
      padding: 14px; border-radius: var(--radius-sm);
      background: var(--panel); border: 1px solid var(--line-subtle);
      transition: border-color 0.15s;
    }
    .lane:hover { border-color: var(--line); }
    .lane-head { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; font-weight: 600; }

    /* Critical path — pipeline view */
    .cpath { display: grid; gap: 0; }
    .cpath-summary { font-size: 12px; color: var(--muted); margin-bottom: 12px; }
    .cpath-connector { display: flex; justify-content: center; padding: 2px 0; }
    .cpath-arrow { color: var(--line); font-size: 14px; }
    .cpath-phase {
      border: 1px solid var(--line-subtle); border-radius: var(--radius-sm);
      padding: 12px 14px; background: var(--surface);
      transition: border-color 0.15s;
    }
    .cpath-phase:hover { border-color: var(--line); }
    .cpath-phase-head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 8px;
    }
    .cpath-phase-label { font-size: 13px; font-weight: 600; color: var(--text); }
    .cpath-phase-count { font-size: 11px; color: var(--muted); font-family: ui-monospace, SFMono-Regular, monospace; }
    .cpath-tools { display: grid; gap: 4px; }
    .cpath-tool { display: flex; align-items: center; gap: 8px; }
    .cpath-tool-name {
      font-size: 12px; color: var(--text-secondary);
      font-family: ui-monospace, SFMono-Regular, monospace;
      min-width: 100px; flex-shrink: 0;
    }
    .cpath-tool-n {
      font-size: 10px; font-weight: 600; padding: 0 4px;
      border-radius: 4px; background: var(--accent-subtle); color: var(--accent-light);
    }
    .cpath-tool-bar {
      height: 4px; border-radius: 2px;
      background: var(--accent); opacity: 0.5;
    }

    /* Pairs */
    .pair-list { display: grid; gap: 6px; }
    .pair {
      display: flex; gap: 8px; align-items: center;
      padding: 8px 12px; border-radius: var(--radius-xs);
      background: var(--panel); border: 1px solid var(--line-subtle);
      font-size: 12px; font-family: ui-monospace, SFMono-Regular, monospace;
      transition: border-color 0.15s;
    }
    .pair:hover { border-color: var(--line); }
    .pair-arrow { color: var(--accent); }

    /* Branches */
    .branch-list { display: grid; gap: 10px; }
    .branch-card {
      display: grid; gap: 10px; padding: 18px;
      border-radius: var(--radius); background: var(--panel); border: 1px solid var(--line-subtle);
      transition: border-color 0.2s, box-shadow 0.2s;
      box-shadow: var(--shadow-sm);
    }
    .branch-card.recommended { border-color: rgba(34, 197, 94, 0.3); }
    .branch-card:hover { border-color: var(--line); box-shadow: var(--shadow-md); }
    .branch-head {
      display: flex; flex-wrap: wrap; gap: 8px;
      justify-content: space-between; align-items: center;
    }

    /* Session index */
    .hero { padding: 36px 24px 28px; border-bottom: 1px solid var(--line-subtle); }
    .hero .wrap { display: grid; gap: 12px; }
    .hero-title { font-size: 28px; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; }
    .hero-subtitle { color: var(--muted); font-size: 15px; }
    .session-list { display: grid; gap: 10px; }
    .session-card {
      display: grid; gap: 10px;
      border: 1px solid var(--line-subtle); border-radius: var(--radius);
      padding: 16px; background: var(--panel);
      transition: border-color 0.2s, box-shadow 0.2s;
      box-shadow: var(--shadow-sm);
    }
    .session-card:hover { border-color: var(--accent); box-shadow: var(--shadow-md); }
    .session-head {
      display: flex; flex-wrap: wrap; justify-content: space-between;
      gap: 8px; align-items: center;
    }
    .links { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

    .muted { color: var(--muted); }
    .empty { color: var(--muted); font-style: italic; font-size: 13px; }
    .footer {
      padding: 28px 24px; border-top: 1px solid var(--line-subtle);
      text-align: center; font-size: 11px; color: var(--muted); letter-spacing: 0.02em;
    }

    /* ── Execution summary bar ── */
    .gviz-summary-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 14px; margin-top: 14px; margin-bottom: 6px;
      background: var(--surface); border: 1px solid var(--line-subtle);
      border-radius: var(--radius-xs); font-size: 13px; line-height: 1;
    }
    .gviz-summary-icon { color: var(--accent); font-size: 12px; flex-shrink: 0; }
    .gviz-summary-status { font-weight: 600; color: var(--text); white-space: nowrap; }
    .gviz-summary-sep { color: var(--line); flex-shrink: 0; }
    .gviz-summary-detail { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* ── Execution graph viz (Mermaid inline) ── */
    .gviz-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 14px; margin-bottom: 6px;
    }
    .gviz-label {
      font-size: 10px; font-weight: 600; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .gviz-status {
      font-size: 11px; color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .gviz-container {
      overflow: hidden;
      background: var(--panel); border: 1px solid var(--line-subtle);
      border-radius: var(--radius-sm); padding: 16px;
      transition: border-color 0.15s;
    }
    .gviz-container:hover { border-color: var(--line); }
    .gviz-container svg { display: block; width: 100%; height: auto; }

    /* SVG Gauge */
    .gauge { display: block; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.2)); }
    .summary-risk { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; }

    /* Summary row — stats + donut side by side */
    .summary-row { display: flex; gap: 24px; align-items: flex-start; }
    .summary-row .summary-stats { flex: 1; }

    /* Bar chart */
    .bar-chart { display: grid; gap: 8px; }
    .bar-row { display: grid; grid-template-columns: 130px 1fr 48px; gap: 10px; align-items: center; }
    .bar-label { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
    .bar-track { height: 6px; background: var(--surface); border-radius: 3px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; min-width: 2px; }
    .bar-value { font-size: 12px; font-weight: 600; text-align: right; font-family: ui-monospace, SFMono-Regular, monospace; }
    .bar-detail { grid-column: 1 / -1; font-size: 11px; color: var(--muted); margin-top: -4px; padding-left: 0; }

    /* Donut chart */
    .donut-wrap { display: flex; gap: 14px; align-items: center; flex-shrink: 0; }
    .donut-legend { display: grid; gap: 5px; }
    .donut-item { display: flex; gap: 6px; align-items: center; font-size: 12px; white-space: nowrap; color: var(--text-secondary); }
    .donut-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .donut-item strong { margin-left: auto; font-family: ui-monospace, SFMono-Regular, monospace; color: var(--text); }

    /* ── Verdict ── */
    .verdict { padding: 20px 24px; }
    .verdict-inner { max-width: 1200px; margin: 0 auto; background: var(--panel); border: 1px solid var(--line-subtle); border-radius: var(--radius); padding: 24px 28px; box-shadow: var(--shadow-md); }
    .verdict-inner.low { border-left: 4px solid var(--low); }
    .verdict-inner.medium { border-left: 4px solid var(--warn); }
    .verdict-inner.high { border-left: 4px solid var(--high); }
    .verdict-inner.critical { border-left: 4px solid var(--critical); }
    .verdict-headline { font-size: 20px; font-weight: 700; margin-bottom: 14px; letter-spacing: -0.02em; }
    .verdict-headline.low { color: var(--low); }
    .verdict-headline.medium { color: var(--warn); }
    .verdict-headline.high { color: var(--high); }
    .verdict-headline.critical { color: var(--critical); }
    .verdict-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
    .verdict-callout { display: flex; gap: 10px; align-items: baseline; padding: 10px 14px; border-radius: var(--radius-sm); background: var(--surface); font-size: 13px; margin-top: 6px; color: var(--text-secondary); }
    .verdict-callout-icon { flex-shrink: 0; font-size: 14px; }

    /* ── Changes table ── */
    .changes-row { display: grid; grid-template-columns: 12px 1fr auto auto auto; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line-subtle); font-size: 13px; }
    .changes-row:last-child { border-bottom: none; }
    .risk-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .risk-dot.low { background: var(--low); }
    .risk-dot.medium { background: var(--warn); }
    .risk-dot.high { background: var(--high); }
    .file-path { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .diff-stat { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; white-space: nowrap; }
    .diff-add { color: var(--low); }
    .diff-del { color: var(--high); }
    .change-signal { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }

    /* ── Validation ── */
    .validation-list { display: grid; gap: 6px; }
    .validation-item { display: flex; gap: 10px; align-items: center; padding: 8px 14px; background: var(--surface); border-radius: var(--radius-xs); font-size: 13px; }
    .validation-icon { flex-shrink: 0; font-size: 14px; }
    .validation-cmd { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; color: var(--text-secondary); flex: 1; }
    .validation-status { font-size: 12px; flex-shrink: 0; }

    /* ── Branch scorecard ── */
    .branch-scorecard { margin-top: 10px; display: grid; gap: 4px; }
    .branch-score-row { display: grid; grid-template-columns: 76px 1fr 36px; gap: 6px; align-items: center; font-size: 11px; }
    .branch-compare { grid-template-columns: repeat(2, 1fr); }
    .branch-title { font-size: 14px; }
    .branch-readiness { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; padding: 7px 10px; border-radius: var(--radius-xs); margin: 8px 0; }
    .branch-readiness.low { background: rgba(34,197,94,0.1); color: var(--low); }
    .branch-readiness.medium { background: rgba(234,179,8,0.1); color: var(--warn); }
    .branch-readiness.high { background: rgba(239,68,68,0.1); color: var(--high); }
    .branch-readiness.critical { background: rgba(220,38,38,0.15); color: var(--critical); }
    .branch-readiness-icon { font-size: 14px; flex-shrink: 0; }
    .branch-score-chip { margin-left: auto; font-size: 12px; font-family: ui-monospace, SFMono-Regular, monospace; font-weight: 700; }
    .branch-headline { font-size: 13px; color: var(--text-secondary); margin: 8px 0; line-height: 1.5; }
    .branch-score-label { color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; }
    .branch-score-track { height: 4px; background: var(--surface); border-radius: 2px; overflow: hidden; }
    .branch-score-fill { height: 100%; border-radius: 2px; min-width: 2px; }
    .branch-score-val { text-align: right; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; font-weight: 600; min-width: 32px; }
    .branch-score-detail { grid-column: 1 / -1; font-size: 11px; color: var(--muted); margin: -2px 0 4px; padding-left: 2px; font-style: italic; }
    .branch-evidence { margin-top: 10px; display: grid; gap: 3px; }
    .branch-ev-item { display: flex; gap: 6px; font-size: 12px; color: var(--text-secondary); }
    .ev-dot { color: var(--muted); flex-shrink: 0; }
    .branch-semantic { font-size: 12px; color: var(--muted); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line-subtle); }

    /* ── Activity section ── */
    .act-card { background: var(--surface); border-radius: var(--radius-sm); padding: 14px 16px; margin-bottom: 10px; border: 1px solid var(--line-subtle); }
    .act-card-err { border-color: rgba(239,68,68,0.3); }
    .act-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; flex-wrap: wrap; }
    .act-label { font-weight: 600; font-size: 13px; white-space: nowrap; min-width: 52px; }
    .act-agent { font-size: 11px; color: var(--accent-light); background: var(--accent-subtle); padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
    .act-bar-wrap { flex: 1; height: 5px; background: var(--panel); border-radius: 3px; overflow: hidden; min-width: 40px; }
    .act-bar { height: 100%; border-radius: 3px; min-width: 4px; }
    .act-dur { font-size: 12px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, monospace; color: var(--text-secondary); white-space: nowrap; }
    .act-err-badge { font-size: 11px; color: var(--high); white-space: nowrap; }
    .act-card-summary { list-style: none; cursor: pointer; }
    .act-card-summary::-webkit-details-marker { display: none; }
    .act-card[open] .act-card-summary { margin-bottom: 12px; }
    .act-card-summary:hover .act-label { color: var(--accent-light); }
    .act-summary { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; line-height: 1.5; }
    .act-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .act-expand { border-top: 1px solid var(--line-subtle); margin-top: 12px; padding-top: 12px; display: grid; gap: 12px; }
    .act-timing { display: grid; gap: 5px; }
    .act-timing-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 2px; }
    .act-timing-row { display: grid; grid-template-columns: 1fr 120px 44px; gap: 8px; align-items: center; }
    .act-timing-name { font-size: 12px; font-family: ui-monospace, SFMono-Regular, monospace; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .act-timing-arg { color: var(--muted); margin-left: 4px; }
    .act-timing-track { height: 5px; background: var(--panel); border-radius: 3px; overflow: hidden; }
    .act-timing-bar { height: 100%; border-radius: 3px; min-width: 3px; }
    .act-timing-ms { font-size: 11px; font-family: ui-monospace, SFMono-Regular, monospace; text-align: right; color: var(--text-secondary); }
    .act-files { display: grid; gap: 4px; }
    .act-files-row { display: flex; gap: 8px; font-size: 12px; align-items: baseline; }
    .act-files-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); white-space: nowrap; min-width: 36px; }
    .act-files-list { font-family: ui-monospace, SFMono-Regular, monospace; color: var(--text-secondary); }
    .act-files-edited { color: var(--accent-light); }
    .act-error-list { display: grid; gap: 4px; }
    /* ── Agent roster ── */
    .agent-roster { display: grid; gap: 5px; }
    .agent-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 7px 10px; background: var(--surface); border-radius: var(--radius-xs); }
    .agent-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
    .agent-name { flex: 1; font-weight: 500; }
    .agent-tag { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }

    @media (max-width: 900px) {
      .grid, .step-grid { grid-template-columns: 1fr; }
      .summary-grid { flex-direction: column; align-items: center; text-align: center; }
      .summary-stats { grid-template-columns: repeat(2, 1fr); }
      .risk-status-row { grid-template-columns: repeat(2, 1fr); }
      .signal-grid { grid-template-columns: repeat(2, 1fr); }
      .summary-row { flex-direction: column; }
      .bar-row { grid-template-columns: 100px 1fr 40px; }
      .hero-title { font-size: 22px; }
      .nav-inner { gap: 2px; }
      .verdict-grid { grid-template-columns: repeat(2, 1fr); }
      .changes-row { grid-template-columns: 12px 1fr auto auto; }
      .change-signal { display: none; }
    }
  `
}
