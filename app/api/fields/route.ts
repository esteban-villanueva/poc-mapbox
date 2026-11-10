import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
    try {
        const query = `
            SELECT 
                id, 
                name, 
                description, 
                ST_AsGeoJSON(geom)::json as geom, 
                ROUND((ST_Area(geom::geography) / 10000)::numeric, 2) as hectares, 
                created_at 
            FROM fields 
            ORDER BY created_at DESC;
        `;
        const result = await pool.query(query);
        return NextResponse.json(result.rows);
    } catch (error: any) {
        console.error('Error fetching fields:', error);
        return NextResponse.json({ error: error.message || 'Database error' }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { name, description, geom } = body;

        if (!name || !geom) {
            return NextResponse.json({ error: 'Faltan campos obligatorios (nombre o geometría)' }, { status: 400 });
        }

        const geoJsonString = JSON.stringify(geom);

        const query = `
            INSERT INTO fields (name, description, geom)
            VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
            RETURNING 
                id, 
                name, 
                description, 
                ST_AsGeoJSON(geom)::json as geom, 
                ROUND((ST_Area(geom::geography) / 10000)::numeric, 2) as hectares, 
                created_at;
        `;

        const result = await pool.query(query, [name, description || null, geoJsonString]);
        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (error: any) {
        console.error('Error saving field:', error);
        return NextResponse.json({ error: error.message || 'Database error' }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
        }

        await pool.query('DELETE FROM fields WHERE id = $1', [id]);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error deleting field:', error);
        return NextResponse.json({ error: error.message || 'Database error' }, { status: 500 });
    }
}

