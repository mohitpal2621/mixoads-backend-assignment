import { Pool } from 'pg';
import { Campaign } from './types';

// Singleton pool
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'mixoads',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres'
    });
  }
  return pool;
}

export async function saveCampaignToDB(campaign: Campaign): Promise<void> {
  if (process.env.USE_MOCK_DB === 'true') {
    console.log(`      [MOCK DB] Saved campaign: ${campaign.id}`);
    return;
  }

  const db = getPool();

  try {
    const query = `
      INSERT INTO campaigns (id, name, status, budget, impressions, clicks, conversions, synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        budget = EXCLUDED.budget,
        impressions = EXCLUDED.impressions,
        clicks = EXCLUDED.clicks,
        conversions = EXCLUDED.conversions,
        synced_at = NOW()
    `;

    await db.query(query, [
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.budget,
      campaign.impressions,
      campaign.clicks,
      campaign.conversions
    ]);

  } catch (error: any) {
    throw new Error(`Database error: ${error.message}`);
  }
}

// Add cleanup function for graceful shutdown
export async function closeDB(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}