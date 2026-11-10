import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://gisuser:gispassword@localhost:5432/gisdb',
});

export default pool;

