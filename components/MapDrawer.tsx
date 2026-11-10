'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import area from '@turf/area';
import bbox from '@turf/bbox';

import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

interface MapboxDrawEvent {
    features: GeoJSON.Feature<GeoJSON.Polygon>[];
}

export interface SavedField {
    id: number;
    name: string;
    description: string | null;
    geom: GeoJSON.Polygon;
    hectares: string | number;
    created_at: string;
}

// Estilos visuales del polígono que se está dibujando (amarillo punteado + vértices blancos)
const customDrawStyles = [
    {
        id: 'gl-draw-polygon-fill-inactive',
        type: 'fill',
        filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
        paint: {
            'fill-color': '#facc15',
            'fill-outline-color': '#facc15',
            'fill-opacity': 0.18,
        },
    },
    {
        id: 'gl-draw-polygon-fill-active',
        type: 'fill',
        filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
        paint: {
            'fill-color': '#facc15',
            'fill-outline-color': '#facc15',
            'fill-opacity': 0.25,
        },
    },
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
            'circle-radius': 5.5,
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

    // Estados de dibujo activo
    const [rawGeoJSON, setRawGeoJSON] = useState<GeoJSON.Polygon | null>(null);
    const [hectares, setHectares] = useState<number | null>(null);
    const [isDrawing, setIsDrawing] = useState<boolean>(false);
    const [currentPoints, setCurrentPoints] = useState<[number, number][]>([]);

    // Estados de PostGIS
    const [savedFields, setSavedFields] = useState<SavedField[]>([]);
    const savedFieldsRef = useRef<SavedField[]>([]);
    const [isLoadingFields, setIsLoadingFields] = useState<boolean>(true);
    const [fieldName, setFieldName] = useState<string>('');
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null);
    const selectedFieldIdRef = useRef<number | null>(null);

    // Estado del modal de inspección GeoJSON
    const [infoField, setInfoField] = useState<SavedField | null>(null);
    const [copied, setCopied] = useState<boolean>(false);

    // Sincronizar refs
    useEffect(() => {
        savedFieldsRef.current = savedFields;
    }, [savedFields]);

    useEffect(() => {
        selectedFieldIdRef.current = selectedFieldId;
        // Actualizar colores si el mapa está listo
        const map = mapRef.current;
        if (map && map.isStyleLoaded() && map.getLayer('saved-fields-fill')) {
            map.setPaintProperty('saved-fields-fill', 'fill-color', [
                'case',
                ['==', ['get', 'id'], selectedFieldId || -1],
                '#f59e0b',
                '#10b981',
            ]);
            map.setPaintProperty('saved-fields-fill', 'fill-opacity', [
                'case',
                ['==', ['get', 'id'], selectedFieldId || -1],
                0.55,
                0.35,
            ]);
            map.setPaintProperty('saved-fields-line', 'line-color', [
                'case',
                ['==', ['get', 'id'], selectedFieldId || -1],
                '#fbbf24',
                '#34d399',
            ]);
            map.setPaintProperty('saved-fields-line', 'line-width', [
                'case',
                ['==', ['get', 'id'], selectedFieldId || -1],
                3.5,
                2.5,
            ]);
        }
    }, [selectedFieldId]);

    // Actualizar fuente GeoJSON con los lotes
    const updateSavedFieldsLayer = useCallback(() => {
        const map = mapRef.current;
        if (!map || !map.isStyleLoaded()) return;

        const source = map.getSource('saved-fields-source') as mapboxgl.GeoJSONSource;
        if (!source) return;

        const featureCollection: GeoJSON.FeatureCollection = {
            type: 'FeatureCollection',
            features: savedFieldsRef.current.map((field) => ({
                type: 'Feature',
                properties: {
                    id: field.id,
                    name: field.name,
                    hectares: field.hectares,
                },
                geometry: field.geom,
            })),
        };

        source.setData(featureCollection);
    }, []);

    // Cargar lotes guardados desde la API de PostGIS
    const fetchSavedFields = async () => {
        try {
            setIsLoadingFields(true);
            const res = await fetch('/api/fields');
            if (res.ok) {
                const data: SavedField[] = await res.json();
                savedFieldsRef.current = data;
                setSavedFields(data);
                updateSavedFieldsLayer();
            }
        } catch (error) {
            console.error('Error al cargar lotes:', error);
        } finally {
            setIsLoadingFields(false);
        }
    };

    useEffect(() => {
        fetchSavedFields();
    }, []);

    // Inicializar mapa
    useEffect(() => {
        if (!mapContainerRef.current) return;

        const map = new mapboxgl.Map({
            container: mapContainerRef.current,
            style: 'mapbox://styles/mapbox/satellite-streets-v12',
            transformRequest: (url) => {
                // Redirigir peticiones satelitales al CDN de alta disponibilidad de ESRI
                if (url.includes('mapbox.satellite') && !url.includes('.json')) {
                    const match = url.match(/\/mapbox\.satellite\/(\d+)\/(\d+)\/(\d+)/);
                    if (match) {
                        const [, z, x, y] = match;
                        return {
                            url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
                        };
                    }
                }
                return { url };
            },
            center: [-64.0, -38.5], // Vista inicial de Argentina completa
            zoom: 4,
            minZoom: 2,
            maxZoom: 19,
            pitch: 0,
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
            // 1. Realzar contraste y saturación del satélite
            if (map.getLayer('satellite')) {
                map.setPaintProperty('satellite', 'raster-saturation', 0.2);
                map.setPaintProperty('satellite', 'raster-contrast', 0.12);
            }

            // 2. Fuente DEM abierta de elevación 3D (AWS Terrarium)
            if (!map.getSource('terrain-dem')) {
                map.addSource('terrain-dem', {
                    type: 'raster-dem',
                    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                    encoding: 'terrarium',
                    tileSize: 256,
                    maxzoom: 15,
                });

                map.setTerrain({
                    source: 'terrain-dem',
                    exaggeration: 1.8,
                });
            }

            // 3. Atmósfera y horizonte
            map.setFog({
                range: [1.5, 10],
                color: '#d8e2dc',
                'horizon-blend': 0.2,
            });

            // 4. Fuente y capas para los lotes guardados en PostGIS
            if (!map.getSource('saved-fields-source')) {
                const initialFeatures: GeoJSON.FeatureCollection = {
                    type: 'FeatureCollection',
                    features: savedFieldsRef.current.map((field) => ({
                        type: 'Feature',
                        properties: {
                            id: field.id,
                            name: field.name,
                            hectares: field.hectares,
                        },
                        geometry: field.geom,
                    })),
                };

                map.addSource('saved-fields-source', {
                    type: 'geojson',
                    data: initialFeatures,
                });

                // Relleno visible para lotes guardados
                map.addLayer({
                    id: 'saved-fields-fill',
                    type: 'fill',
                    source: 'saved-fields-source',
                    paint: {
                        'fill-color': [
                            'case',
                            ['==', ['get', 'id'], selectedFieldIdRef.current || -1],
                            '#f59e0b',
                            '#10b981',
                        ],
                        'fill-opacity': [
                            'case',
                            ['==', ['get', 'id'], selectedFieldIdRef.current || -1],
                            0.55,
                            0.35,
                        ],
                    },
                });

                // Borde nítido continuo
                map.addLayer({
                    id: 'saved-fields-line',
                    type: 'line',
                    source: 'saved-fields-source',
                    paint: {
                        'line-color': [
                            'case',
                            ['==', ['get', 'id'], selectedFieldIdRef.current || -1],
                            '#fbbf24',
                            '#34d399',
                        ],
                        'line-width': [
                            'case',
                            ['==', ['get', 'id'], selectedFieldIdRef.current || -1],
                            3.5,
                            2.5,
                        ],
                    },
                });

                // Etiqueta con el nombre del lote y las hectáreas
                map.addLayer({
                    id: 'saved-fields-labels',
                    type: 'symbol',
                    source: 'saved-fields-source',
                    layout: {
                        'text-field': ['concat', ['get', 'name'], ' (', ['get', 'hectares'], ' ha)'],
                        'text-size': 12,
                        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
                        'text-anchor': 'center',
                    },
                    paint: {
                        'text-color': '#ffffff',
                        'text-halo-color': '#064e3b',
                        'text-halo-width': 2.5,
                    },
                });

                // Clic directo sobre el lote en el mapa para seleccionarlo y volar hacia él
                map.on('click', 'saved-fields-fill', (e) => {
                    if (e.features && e.features[0]) {
                        const id = Number(e.features[0].properties?.id);
                        if (id) {
                            const field = savedFieldsRef.current.find((f) => f.id === id);
                            if (field) flyToField(field);
                        }
                    }
                });

                map.on('mouseenter', 'saved-fields-fill', () => {
                    map.getCanvas().style.cursor = 'pointer';
                });
                map.on('mouseleave', 'saved-fields-fill', () => {
                    map.getCanvas().style.cursor = '';
                });
            }

            updateSavedFieldsLayer();
        });

        // Detectar cuando el usuario activa el modo de dibujar polígono
        map.on('draw.modechange', (e: any) => {
            if (e.mode === 'draw_polygon') {
                setIsDrawing(true);
                setCurrentPoints([]);
                setRawGeoJSON(null);
                setHectares(null);
            } else {
                setIsDrawing(false);
            }
        });

        // Registrar cada clic de vértice en tiempo real mientras dibuja
        map.on('click', (e) => {
            if (drawRef.current?.getMode() === 'draw_polygon') {
                const pt: [number, number] = [
                    Number(e.lngLat.lng.toFixed(6)),
                    Number(e.lngLat.lat.toFixed(6)),
                ];
                setCurrentPoints((prev) => [...prev, pt]);
            }
        });

        const handleUpdate = (e: MapboxDrawEvent) => {
            const feature = e.features[0];
            if (!feature || feature.geometry.type !== 'Polygon') return;

            const geom = feature.geometry;
            const sqMeters = area(feature);
            const ha = Number((sqMeters / 10000).toFixed(2));

            setIsDrawing(false);
            setCurrentPoints([]);
            setRawGeoJSON(geom);
            setHectares(ha);
        };

        map.on('draw.create', handleUpdate as unknown as (e: mapboxgl.MapboxEvent) => void);
        map.on('draw.update', handleUpdate as unknown as (e: mapboxgl.MapboxEvent) => void);
        map.on('draw.delete', () => {
            setRawGeoJSON(null);
            setHectares(null);
            setFieldName('');
            setIsDrawing(false);
            setCurrentPoints([]);
        });

        return () => {
            map.remove();
        };
    }, [updateSavedFieldsLayer]);

    const copyToClipboard = () => {
        if (!infoField) return;
        navigator.clipboard.writeText(JSON.stringify(infoField.geom, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Función de vuelo automático hacia un lote (fitBounds con 3D)
    const flyToField = (field: SavedField) => {
        if (!mapRef.current) return;
        setSelectedFieldId(field.id);

        const bounds = bbox(field.geom) as [number, number, number, number];

        mapRef.current.fitBounds(bounds, {
            padding: 90,
            duration: 2500, // 2.5s vuelo suave
            pitch: 45,      // Inclinación 3D para apreciar el relieve
            bearing: -10,
            maxZoom: 16,
            essential: true,
        });
    };

    // Accesos rápidos
    const flyToArgentina = () => {
        setSelectedFieldId(null);
        mapRef.current?.flyTo({
            center: [-64.0, -38.5],
            zoom: 4,
            pitch: 0,
            bearing: 0,
            duration: 2000,
            essential: true,
        });
    };

    const flyToTandil = () => {
        setSelectedFieldId(null);
        mapRef.current?.flyTo({
            center: [-59.1365, -37.3217],
            zoom: 13.5,
            pitch: 45,
            bearing: -10,
            duration: 2500,
            essential: true,
        });
    };

    // Guardar lote en PostGIS
    const handleSaveField = async () => {
        if (!rawGeoJSON || !fieldName.trim()) return;

        setIsSaving(true);
        try {
            const res = await fetch('/api/fields', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: fieldName.trim(),
                    geom: rawGeoJSON,
                }),
            });

            if (res.ok) {
                const newField: SavedField = await res.json();
                const updated = [newField, ...savedFieldsRef.current];
                savedFieldsRef.current = updated;
                setSavedFields(updated);
                updateSavedFieldsLayer();

                // Limpiar dibujo activo
                drawRef.current?.deleteAll();
                setRawGeoJSON(null);
                setHectares(null);
                setFieldName('');

                // Volar hacia el lote guardado
                flyToField(newField);
            } else {
                alert('Error al guardar el lote en la base de datos.');
            }
        } catch (error) {
            console.error('Error al guardar lote:', error);
            alert('Error de conexión con la base de datos.');
        } finally {
            setIsSaving(false);
        }
    };

    // Eliminar lote de PostGIS
    const handleDeleteField = async (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm('¿Seguro que querés eliminar este lote?')) return;

        try {
            const res = await fetch(`/api/fields?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                const updated = savedFieldsRef.current.filter((f) => f.id !== id);
                savedFieldsRef.current = updated;
                setSavedFields(updated);
                updateSavedFieldsLayer();
                if (selectedFieldId === id) setSelectedFieldId(null);
            }
        } catch (error) {
            console.error('Error al eliminar lote:', error);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[750px] w-full">
            {/* Contenedor del Mapa */}
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
                        title="Zoom a Tandil"
                    >
                        <span>🌾</span> Tandil (3D)
                    </button>
                </div>
            </div>

            {/* Panel Lateral: Inspección y Gestión de Lotes PostGIS */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 flex flex-col h-full overflow-hidden text-neutral-200">
                <div className="flex items-center justify-between mb-3 border-b border-neutral-800 pb-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
                        Gestor de Lotes
                    </h3>
                    <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full font-mono">
                        PostGIS
                    </span>
                </div>

                {/* Sección 1: Trazado en curso o lote dibujado */}
                {isDrawing && currentPoints.length > 0 ? (
                    <div className="mb-4 bg-neutral-950/90 border border-amber-500/70 p-3.5 rounded-xl shadow-lg">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold uppercase text-amber-400 flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                                Trazado en progreso ({currentPoints.length} {currentPoints.length === 1 ? 'punto' : 'puntos'})
                            </span>
                            <span className="text-[11px] text-amber-300/80 font-mono">GeoJSON Coordinates</span>
                        </div>

                        <p className="text-[11px] text-neutral-400 mb-1.5">
                            Coordenadas de cada vértice [Lng, Lat]:
                        </p>

                        <pre className="bg-black/90 p-2.5 rounded-lg font-mono text-[11px] leading-relaxed text-amber-300 overflow-auto max-h-[130px] border border-neutral-800">
                            {JSON.stringify(currentPoints, null, 2)}
                        </pre>

                        <p className="text-[11px] text-neutral-500 mt-2 flex items-center gap-1">
                            <span>💡</span> Hacé clic en el 1er punto para cerrar el polígono.
                        </p>
                    </div>
                ) : rawGeoJSON ? (
                    <div className="mb-4 bg-neutral-950/80 border border-amber-500/50 p-3.5 rounded-xl">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold uppercase text-amber-400 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-amber-400" /> Polígono Cerrado
                            </span>
                            <span className="text-base font-bold text-amber-300">{hectares} ha</span>
                        </div>

                        {/* Previsualización de coordenadas GeoJSON */}
                        <div className="mb-2">
                            <span className="text-[11px] text-neutral-400 mb-1 block">GeoJSON Coordinates:</span>
                            <pre className="bg-black/80 p-2 rounded-lg font-mono text-[10px] leading-relaxed text-emerald-300 overflow-auto max-h-[90px] border border-neutral-800">
                                {JSON.stringify(rawGeoJSON.coordinates[0], null, 2)}
                            </pre>
                        </div>

                        <div className="space-y-2 mt-2">
                            <input
                                type="text"
                                placeholder="Nombre del lote (ej: Lote Maíz Sur)..."
                                value={fieldName}
                                onChange={(e) => setFieldName(e.target.value)}
                                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-emerald-500"
                            />
                            <button
                                onClick={handleSaveField}
                                disabled={isSaving || !fieldName.trim()}
                                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-xs py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                            >
                                {isSaving ? 'Guardando en PostGIS...' : '💾 Guardar Lote en BD'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="mb-3 p-3 bg-neutral-950/40 border border-dashed border-neutral-800 rounded-lg text-xs text-neutral-400 text-center">
                        {isDrawing
                            ? '✏️ Modo polígono activo: hacé clic en el mapa para marcar los puntos del lote.'
                            : 'Para registrar un nuevo campo, hacé clic en el ícono de polígono (arriba a la izquierda) y dibujalo en el mapa.'}
                    </div>
                )}

                {/* Sección 2: Lista de lotes almacenados en PostGIS */}
                <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex items-center justify-between text-xs text-neutral-400 mb-2">
                        <span>Lotes Registrados ({savedFields.length})</span>
                        <span className="text-[11px] text-neutral-500">Clic en tarjeta para volar</span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                        {isLoadingFields ? (
                            <div className="text-center py-6 text-xs text-neutral-500">
                                Cargando lotes de PostGIS...
                            </div>
                        ) : savedFields.length === 0 ? (
                            <div className="text-center py-8 text-xs text-neutral-500">
                                No hay lotes guardados aún.
                            </div>
                        ) : (
                            savedFields.map((field) => {
                                const isSelected = selectedFieldId === field.id;
                                return (
                                    <div
                                        key={field.id}
                                        onClick={() => flyToField(field)}
                                        className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-1.5 ${isSelected
                                            ? 'bg-emerald-950/40 border-emerald-500 shadow-sm'
                                            : 'bg-neutral-950/60 border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="font-semibold text-sm text-neutral-100 flex items-center gap-1.5">
                                                📍 {field.name}
                                            </span>
                                            <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/80">
                                                {field.hectares} ha
                                            </span>
                                        </div>

                                        <div className="flex items-center justify-between text-[11px] text-neutral-500 pt-1 border-t border-neutral-800/60 mt-1">
                                            <span>ID: #{field.id}</span>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setInfoField(field);
                                                    }}
                                                    className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                                                    title="Ver coordenadas exactas en PostGIS"
                                                >
                                                    <span>ℹ️</span> Info
                                                </button>
                                                <span className="text-neutral-700">|</span>
                                                <button
                                                    onClick={(e) => handleDeleteField(field.id, e)}
                                                    className="text-red-400 hover:text-red-300 cursor-pointer"
                                                    title="Eliminar de PostGIS"
                                                >
                                                    🗑️
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Modal de Inspección GeoJSON del Lote */}
            {infoField && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-neutral-900 border border-neutral-700 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                        {/* Header */}
                        <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/60">
                            <div className="flex items-center gap-3">
                                <span className="text-2xl">📍</span>
                                <div>
                                    <h4 className="font-semibold text-base text-neutral-100 flex items-center gap-2">
                                        {infoField.name}
                                        <span className="text-xs bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded-full font-mono">
                                            ID #{infoField.id}
                                        </span>
                                    </h4>
                                    <p className="text-xs text-neutral-400 mt-0.5">
                                        Superficie calculada por PostGIS: <strong className="text-emerald-400">{infoField.hectares} ha</strong>
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setInfoField(null)}
                                className="text-neutral-400 hover:text-white p-1.5 rounded-lg hover:bg-neutral-800 transition-colors text-lg cursor-pointer"
                                title="Cerrar"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-4 overflow-y-auto flex-1 space-y-3">
                            <div className="flex items-center justify-between text-xs text-neutral-400">
                                <span>Geometría GeoJSON almacenada en PostGIS (SRID 4326):</span>
                                <button
                                    onClick={copyToClipboard}
                                    className="bg-neutral-800 hover:bg-neutral-700 text-emerald-400 border border-neutral-700 px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                                >
                                    {copied ? '✅ ¡Copiado!' : '📋 Copiar GeoJSON'}
                                </button>
                            </div>

                            <pre className="bg-black/90 p-4 rounded-xl font-mono text-xs text-emerald-300 overflow-auto max-h-[350px] border border-neutral-800 leading-relaxed">
                                {JSON.stringify(infoField.geom, null, 2)}
                            </pre>
                        </div>

                        {/* Footer */}
                        <div className="p-3.5 border-t border-neutral-800 bg-neutral-950/60 flex items-center justify-between">
                            <span className="text-[11px] text-neutral-500 font-mono">
                                PostGIS · ST_GeomFromGeoJSON
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        flyToField(infoField);
                                        setInfoField(null);
                                    }}
                                    className="bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                                >
                                    ✈️ Volar al Lote en 3D
                                </button>
                                <button
                                    onClick={() => setInfoField(null)}
                                    className="bg-neutral-800 hover:bg-neutral-700 text-neutral-300 px-3.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
                                >
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
