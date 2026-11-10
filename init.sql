-- 1. Habilitar la extensión PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Crear tabla 'fields' para almacenar lotes / campos agrícolas con geometría de polígono
CREATE TABLE IF NOT EXISTS fields (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    -- Columna espacial: tipo Polygon con SRID 4326 (WGS 84 - Lat/Lng estándar para GeoJSON y Mapbox)
    geom GEOMETRY(Polygon, 4326) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Crear índice espacial GiST para acelerar consultas espaciales (bounding box, intersecciones, etc.)
CREATE INDEX IF NOT EXISTS idx_fields_geom ON fields USING GIST (geom);

-- 4. Inserción de ejemplo (Polígono cerrado en coordenadas Longitud, Latitud)
INSERT INTO fields (name, description, geom)
VALUES (
    'Lote Norte',
    'Campo de cultivo de prueba',
    ST_GeomFromText('POLYGON((-64.19 -31.42, -64.18 -31.42, -64.18 -31.43, -64.19 -31.43, -64.19 -31.42))', 4326)
);

