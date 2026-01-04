import { Pool } from 'pg';
import { Campaign } from './types';
import { CONFIG } from './config';

// Singleton pool instance
let pool: Pool | null = null;

/**
 * Get or create the database connection pool (singleton pattern).
 */
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: CONFIG.database.host,
      port: CONFIG.database.port,
      database: CONFIG.database.name,
      user: CONFIG.database.user,
      password: CONFIG.database.password,
    });
  }
  return pool;
}

/**
 * Save a campaign to the database using upsert (INSERT ... ON CONFLICT).
 * Uses parameterized queries to prevent SQL injection.
 */
export async function saveCampaignToDB(campaign: Campaign): Promise<void> {
  // Use mock database for assignment
  if (CONFIG.database.useMock) {
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

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Database error: ${message}`);
  }
}

/**
 * Close the database connection pool gracefully.
 */
export async function closeDB(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}