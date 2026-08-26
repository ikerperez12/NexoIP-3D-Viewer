import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export function AppRecoveryScreen({ onReload }) {
  return <main className="flex min-h-screen items-center justify-center bg-[#05070a] p-6 text-gray-100" aria-labelledby="app-recovery-title">
    <section className="w-full max-w-md rounded-2xl border border-amber-400/40 bg-black/50 p-6 text-center shadow-2xl" role="alert">
      <AlertTriangle size={32} aria-hidden="true" className="mx-auto mb-3 text-amber-300" />
      <h1 id="app-recovery-title" className="text-lg font-semibold">La vista necesita reiniciarse</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-300">No se ha modificado ningún archivo local. Reinicia la vista para volver a abrir tu biblioteca.</p>
      <button type="button" onClick={onReload} className="mx-auto mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200">
        <RefreshCw size={16} aria-hidden="true" /> Reiniciar vista
      </button>
    </section>
  </main>;
}

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  reload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) return <AppRecoveryScreen onReload={this.reload} />;
    return this.props.children;
  }
}
