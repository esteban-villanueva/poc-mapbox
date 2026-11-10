'use client';

import dynamic from 'next/dynamic';

const MapDrawer = dynamic(
  () => import('@/components/MapDrawer').then((mod) => mod.MapDrawer),
  {
    ssr: false,
    loading: () => (
      <div className="h-[750px] w-full flex items-center justify-center bg-neutral-900 rounded-xl text-neutral-500 border border-neutral-800">
        Cargando lienzo de Mapbox...
      </div>
    ),
  }
);

export default function HomePage() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white p-6">
      <header className="max-w-7xl mx-auto mb-6">
        <h1 className="text-2xl font-bold">PoC Agro: Trazado de Lotes</h1>
        <p className="text-neutral-400 text-sm">
          Mapbox GL Draw + Turf.js + PostGIS
        </p>
      </header>

      <section className="max-w-7xl mx-auto">
        <MapDrawer />
      </section>
    </main>
  );
}