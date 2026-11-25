import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { compact, shortDate, usd, useUsage } from '../api';
import { projectLabel } from '../ui';

const MAX_SERIES = 4;
const OTHER = 'otros';
/** Themes with one hue: series 3 and 4 also get a hatch so they do not rely on lightness alone. */
const MONO_THEMES = new Set(['gb', 'amber']);

/** Width of an element that may mount later (after data loads), via a callback ref. */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(800);
  useLayoutEffect(() => {
    if (!el) return;
    setW(el.getBoundingClientRect().width - 20);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w] as const;
}

/** A round axis step (1, 2 or 5 times a power of ten) so about four ticks cover max. */
function niceStep(max: number): number {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

export function UsagePage() {
  const usage = useUsage();
  const [chartRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'neon');
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(document.documentElement.dataset.theme ?? 'neon'));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  const u = usage.data;
  const series = useMemo(() => {
    if (!u) return [];
    const top = u.byProject.slice(0, MAX_SERIES).map((p) => p.project);
    return u.byProject.length > MAX_SERIES ? [...top, OTHER] : top;
  }, [u]);

  const days = useMemo(() => {
    if (!u) return [];
    return u.days.map((d) => {
      const values: Record<string, number> = {};
      for (const [p, v] of Object.entries(d.byProject)) {
        const key = series.includes(p) ? p : OTHER;
        values[key] = (values[key] ?? 0) + v;
      }
      return { date: d.date, total: d.total, values };
    });
  }, [u, series]);

  if (usage.isError) return <div className="usage err">No pude calcular el uso.</div>;
  if (!u) return <div className="usage mut">calculando uso…</div>;

  const H = 240;
  const padL = 46;
  const padB = 22;
  const padT = 8;
  const innerW = Math.max(200, width - padL - 8);
  const innerH = H - padB - padT;
  const max = Math.max(1, ...days.map((d) => d.total));
  const tickStep = niceStep(max);
  const niceMax = Math.ceil(max / tickStep) * tickStep;
  const step = innerW / days.length;
  const barW = Math.max(3, Math.min(28, step - 3));
  const y = (v: number) => padT + innerH - (v / niceMax) * innerH;
  const color = (i: number) => `var(--s${i + 1})`;
  const fill = (i: number) => (MONO_THEMES.has(theme) && (i === 2 || i === 3) ? `url(#hatch-${i})` : color(i));
  const ticks = Array.from({ length: Math.round(niceMax / tickStep) + 1 }, (_, i) => i * tickStep);
  const hd = hover != null ? days[hover] : null;

  return (
    <div className="usage">
      <div className="tiles">
        <Tile label="hoy" value={usd(u.totals.today)} />
        <Tile label="últimos 7 días" value={usd(u.totals.last7)} />
        <Tile label="últimos 30 días" value={usd(u.totals.last30)} />
        <Tile label="tokens 30 días" value={compact(u.totals.tokens30)} />
      </div>

      <div className="section-head">
        <span className="hl">## costo por día, por proyecto</span>
        <button className="link" onClick={() => setAsTable(!asTable)}>[{asTable ? 'ver gráfico' : 'ver tabla'}]</button>
      </div>
      <div className="legend" aria-hidden={asTable}>
        {series.map((s, i) => (
          <span key={s}>
            <svg width="12" height="12" style={{ marginRight: 6, verticalAlign: -1 }} aria-hidden="true">
              <rect width="12" height="12" fill={fill(i)} stroke="var(--fg)" strokeWidth="1" />
            </svg>
            {s === OTHER ? OTHER : projectLabel(s)}
          </span>
        ))}
      </div>

      {asTable ? (
        <table>
          <thead>
            <tr>
              <th>día</th>
              {series.map((s) => <th key={s} className="num">{s === OTHER ? OTHER : projectLabel(s)}</th>)}
              <th className="num">total</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.date}>
                <td>{shortDate(d.date + 'T12:00')}</td>
                {series.map((s) => <td key={s} className="num">{d.values[s] ? usd(d.values[s]) : '-'}</td>)}
                <td className="num">{usd(d.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-wrap" ref={chartRef} onMouseLeave={() => setHover(null)}>
          <svg width={width} height={H} role="img" aria-label="Costo por día de los últimos 30 días, apilado por proyecto">
            <defs>
              {[2, 3].map((i) => (
                <pattern key={i} id={`hatch-${i}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform={`rotate(${i === 2 ? 45 : 135})`}>
                  <rect width="5" height="5" fill="var(--bg)" />
                  <line x1="0" y1="0" x2="0" y2="5" stroke={color(i)} strokeWidth="3" />
                </pattern>
              ))}
            </defs>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={padL + innerW} y1={y(t)} y2={y(t)} stroke="var(--dim)" strokeOpacity="0.35" strokeDasharray="2 4" />
                <text x={padL - 6} y={y(t) + 4} textAnchor="end" fill="var(--dim)" fontSize="12">${Math.round(t)}</text>
              </g>
            ))}
            {days.map((d, di) => {
              let acc = 0;
              const x = padL + di * step + (step - barW) / 2;
              return (
                <g key={d.date}>
                  {series.map((s, i) => {
                    const v = d.values[s] ?? 0;
                    if (!v) return null;
                    const y0 = y(acc);
                    acc += v;
                    const y1 = y(acc);
                    const h = Math.max(1, y0 - y1 - 2);
                    return <rect key={s} x={x} y={y1} width={barW} height={h} fill={fill(i)} />;
                  })}
                  <rect
                    x={padL + di * step}
                    y={padT}
                    width={step}
                    height={innerH}
                    fill={hover === di ? 'var(--fg)' : 'transparent'}
                    fillOpacity={hover === di ? 0.06 : 0}
                    onMouseEnter={() => setHover(di)}
                  />
                  {(di % 5 === 0 || di === days.length - 1) && (
                    <text x={padL + di * step + step / 2} y={H - 6} textAnchor="middle" fill="var(--dim)" fontSize="12">
                      {shortDate(d.date + 'T12:00')}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {hd && hover != null && (
            <div className="tooltip" style={{ left: Math.min(padL + hover * step + step + 14, width - 190), top: 12 }}>
              <div>{shortDate(hd.date + 'T12:00')} · <span className="h2">{usd(hd.total)}</span></div>
              {series.filter((s) => hd.values[s]).map((s) => (
                <div key={s} className="mut">
                  {s === OTHER ? OTHER : projectLabel(s)}: <span style={{ color: 'var(--fg)' }}>{usd(hd.values[s])}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {u.estimatedShare > 0.005 && (
        <p className="mut" style={{ fontSize: '0.85em' }}>
          El {Math.round(u.estimatedShare * 100)}% del costo de 30 días es estimado: esas sesiones no guardaron su costo.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18, marginTop: 18 }}>
        <section>
          <div className="hl">## por proyecto (30 días)</div>
          <table>
            <thead><tr><th>proyecto</th><th className="num">sesiones</th><th className="num">tokens</th><th className="num">costo</th></tr></thead>
            <tbody>
              {u.byProject.map((p) => (
                <tr key={p.project}>
                  <td>{projectLabel(p.project)}</td>
                  <td className="num">{p.sessions || '-'}</td>
                  <td className="num">{p.tokens ? compact(p.tokens) : '-'}</td>
                  <td className="num">{usd(p.costUSD)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <div className="hl">## por modelo (30 días)</div>
          <table>
            <thead><tr><th>modelo</th><th className="num">tokens</th><th className="num">costo</th></tr></thead>
            <tbody>
              {u.byModel.map((m) => (
                <tr key={m.model}>
                  <td>{m.model === 'aux' ? 'resúmenes y novedades' : m.model.replace(/^claude-/, '')}</td>
                  <td className="num">{m.tokens ? compact(m.tokens) : '-'}</td>
                  <td className="num">{usd(m.costUSD)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <div className="mut">{label}</div>
      <div className="n h2">{value}</div>
    </div>
  );
}
