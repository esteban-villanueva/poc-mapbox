'use client';

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import area from '@turf/area';

import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

interface MapboxDrawEvent {
    features: GeoJSON.Feature<GeoJSON.Polygon>[];
}

// Estilos visuales del polígono idénticos a la imagen de ejemplo (amarillo punteado + vértices blancos)
const customDrawStyles = [
    // Relleno inactivo
    {
        id: 'gl-draw-polygon-fill-inactive',
        type: 'fill',
        filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
        paint: {
            'fill-color': '#facc15',
            'fill-outline-color': '#facc15',
            'fill-opacity': 0.15,
        },
    },
    // Relleno activo (seleccionado)
    {
        id: 'gl-draw-polygon-fill-active',
        type: 'fill',
        filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
        paint: {
            'fill-color': '#facc15',
            'fill-outline-color': '#facc15',
            'fill-opacity': 0.22,
        },
    },
    // Borde punteado amarillo inactivo
    {
        id: 'gl-draw-polygon-stroke-inactive',
        type: 'line',
        filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#fde047',
            'line-dasharray': [2, 2],
            'line-width': 2.5,
        },
    },
    // Borde punteado amarillo activo
    {
        id: 'gl-draw-polygon-stroke-active',
        type: 'line',
        filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
        layout: {
            'line-cap': 'round',
            'line-join': 'round',
        },
        paint: {
            'line-color': '#fde047',
            'line-dasharray': [2, 2],
            'line-width': 2.5,
        },
    },
    // Vértices (puntos circulares blancos con borde amarillo)
    {
        id: 'gl-draw-polygon-and-line-vertex-stroke-inactive',
        type: 'circle',
        filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
        paint: {
            'circle-radius': 7,
            'circle-color': '#eab308',
        },
    },
    {
        id: 'gl-draw-polygon-and-line-vertex-inactive',
        type: 'circle',
        filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
        paint: {
            'circle-radius': 4.5,
            'circle-color': '#ffffff',
        },
    },
    {
        id: 'gl-draw-polygon-and-line-vertex-active',
        type: 'circle',
        filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
        paint: {
            'circle-radius': 5,
            'circle-color': '#ffffff',
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#eab308',
        },
    },
];

export const MapDrawer: React.FC = () => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<mapboxgl.Map | null>(null);
    const drawRef = useRef<MapboxDraw | null>(null);

    const [rawGeoJSON, setRawGeoJSON] = useState<GeoJSON.Polygon | null>(null);
    const [hectares, setHectares] = useState<number | null>(null);

    useEffect(() => {
        if (!mapContainerRef.current) return;

        const map = new mapboxgl.Map({
            container: mapContainerRef.current,
            style: 'mapbox://styles/mapbox/satellite-streets-v12',
            transformRequest: (url) => {
                // Interceptar peticiones al tileset satelital de Mapbox (que está bloqueado por 429 en la cuenta)
                // y redirigirlas al CDN de satélite de alta resolución de ESRI
                if (url.includes('mapbox.satellite') && !url.includes('.json')) {
                    const match = url.match(/\/mapbox\.satellite\/(\d+)\/(\d+)\/(\d+)/);
                    if (match) {
                        const [, z, x, y] = match;
                        return {
                            url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
                        };
                    }
                }
                return { url };
            },
            center: [-64.0, -38.5], // Vista general de Argentina [longitud, latitud]
            zoom: 4, // Nivel de zoom para ver el país completo
            minZoom: 2, // Permite alejarse para navegar entre cualquier país del mundo
            maxZoom: 19, // Permite acercarse hasta el nivel de lote/parcela
            pitch: 0, // Vista inicial cenital para visualización nacional
            bearing: 0,
            maxPitch: 80,
        });

        const draw = new MapboxDraw({
            displayControlsDefault: false,
            controls: {
                polygon: true,
                trash: true,
            },
            defaultMode: 'simple_select',
            styles: customDrawStyles,
        });

        map.addControl(draw, 'top-left');
        map.addControl(new mapboxgl.FullscreenControl(), 'top-right');
        map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');

        mapRef.current = map;
        drawRef.current = draw;

        map.on('load', () => {
            // Realzar contraste y saturación del satélite
            if (map.getLayer('satellite')) {
                map.setPaintProperty('satellite', 'raster-saturation', 0.2);
                map.setPaintProperty('satellite', 'raster-contrast', 0.12);
            }

            // Fuente DEM abierta de elevación 3D (AWS Terrarium - sin límites ni errores 429)
            if (!map.getSource('terrain-dem')) {
                map.addSource('terrain-dem', {
                    type: 'raster-dem',
                    tiles: [
                        'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
                    ],
                    encoding: 'terrarium',
                    tileSize: 256,
                    maxzoom: 15
                });

                map.setTerrain({
                    source: 'terrain-dem',
                    exaggeration: 1.8
                });
            }

            // Atmósfera y horizonte
            map.setFog({
                range: [1.5, 10],
                color: '#d8e2dc',
                'horizon-blend': 0.2,
            });
        });

        const handleUpdate = (e: MapboxDrawEvent) => {
            const feature = e.features[0];
            if (!feature || feature.geometry.type !== 'Polygon') return;

            const geom = feature.geometry;
            const sqMeters = area(feature);
            const ha = Number((sqMeters / 10000).toFixed(2));

            setRawGeoJSON(geom);
            setHectares(ha);
        };

        map.on('draw.create', handleUpdate as unknown as (e: mapboxgl.MapboxEvent) => void);
        map.on('draw.update', handleUpdate as unknown as (e: mapboxgl.MapboxEvent) => void);
        map.on('draw.delete', () => {
            setRawGeoJSON(null);
            setHectares(null);
        });

        return () => {
            map.remove();
        };
    }, []);

    const flyToArgentina = () => {
        mapRef.current?.flyTo({
            center: [-64.0, -38.5],
            zoom: 4,
            pitch: 0,
            bearing: 0,
            duration: 2000,
            essential: true
        });
    };

    const flyToTandil = () => {
        mapRef.current?.flyTo({
            center: [-59.1365, -37.3217],
            zoom: 13.5,
            pitch: 45,
            bearing: -10,
            duration: 2500,
            essential: true
        });
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[750px] w-full">
            <div className="lg:col-span-2 relative h-full rounded-xl overflow-hidden border border-neutral-700 shadow-md">
                <div ref={mapContainerRef} className="w-full h-full" />

                {/* Accesos rápidos de navegación */}
                <div className="absolute top-3 left-14 z-10 flex gap-2">
                    <button
                        onClick={flyToArgentina}
                        className="bg-neutral-900/90 hover:bg-neutral-800 text-xs text-neutral-200 border border-neutral-700/80 px-3 py-1.5 rounded-lg shadow-sm backdrop-blur-md transition-all flex items-center gap-1.5 font-medium cursor-pointer"
                        title="Ver Argentina completa"
                    >
                        <span>🇦🇷</span> Vista Argentina
                    </button>
                    <button
                        onClick={flyToTandil}
                        className="bg-neutral-900/90 hover:bg-neutral-800 text-xs text-emerald-400 border border-neutral-700/80 px-3 py-1.5 rounded-lg shadow-sm backdrop-blur-md transition-all flex items-center gap-1.5 font-medium cursor-pointer"
                        title="Zoom a lote demo en Tandil"
                    >
                        <span>🌾</span> Lote Tandil (3D)
                    </button>
                </div>
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col h-full overflow-hidden text-neutral-200">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                    Inspección Geoespacial
                </h3>

                {hectares !== null && (
                    <div className="mb-3 bg-neutral-800 p-3 rounded border border-neutral-700">
                        <span className="text-xs text-neutral-400">Área calculada (Turf):</span>
                        <p className="text-2xl font-bold text-emerald-400">{hectares} ha</p>
                    </div>
                )}

                {rawGeoJSON ? (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <span className="text-xs text-neutral-400 mb-1">GeoJSON coordinates [lng, lat]:</span>
                        <pre className="flex-1 bg-black/60 p-3 rounded font-mono text-[11px] leading-relaxed text-emerald-300 overflow-auto border border-neutral-800">
                            {JSON.stringify(rawGeoJSON, null, 2)}
                        </pre>
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-center p-6 text-neutral-500 text-sm border border-dashed border-neutral-800 rounded">
                        Hacé clic en el ícono de polígono (arriba a la izquierda) y dibujá un lote para capturar sus coordenadas.
                    </div>
                )}
            </div>
        </div>
    );
};
