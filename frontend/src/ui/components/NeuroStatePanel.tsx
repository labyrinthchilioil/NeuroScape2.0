import { useStore } from 'zustand';
import { runtimeStore } from '../../runtime/RuntimeStore.js';

export function NeuroStatePanel() {
  const neuro = useStore(runtimeStore, (state) => state.neuroState);
  const metrics = neuro?.attention
    ? [
        {
          name: 'Focus-direction display',
          value: neuro.attention.focusPosition ?? undefined,
          trend: neuro.attention.label,
        },
        {
          name: 'MW-direction display',
          value: neuro.attention.mindWanderingPosition ?? undefined,
          trend: neuro.attention.phase,
        },
      ]
    : [
        {
          name: 'Arousal',
          value: neuro?.arousal.value,
          trend: neuro?.arousal.trend,
        },
      ];
  return (
    <section className="glass-panel data-panel neuro-panel">
      <h2>Neuro State</h2>
      <div className="metric-grid">
        {metrics.map((metric) => (
          <article key={metric.name}>
            <span>{metric.name}</span>
            <strong>
              {metric.value === undefined ? '—' : metric.value.toFixed(2)}
            </strong>
            <small>{metric.trend ?? 'Backend value'}</small>
            <i style={{ width: `${(metric.value ?? 0) * 100}%` }} />
          </article>
        ))}
      </div>
    </section>
  );
}
