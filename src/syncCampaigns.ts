import fetch, { Response } from 'node-fetch';
import { saveCampaignToDB } from './database';
import { CONFIG } from './config';
import { TimeoutError, ConfigurationError } from './errors';
import {
  Campaign,
  AuthResponse,
  PaginatedResponse,
  FetchOptions,
} from './types';

/**
 * Delay execution for specified milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout using AbortController.
 * Prevents requests from hanging indefinitely.
 */
async function fetchWithTimeout(
  url: string,
  options: FetchOptions,
  timeout: number = CONFIG.api.timeout
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: unknown) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError(`Request to ${url} timed out after ${timeout}ms`);
    }
    throw error;
  }
}

/**
 * Fetch with retry logic, exponential backoff, and rate limit handling.
 * - 429: Waits for retry-after, doesn't count as retry attempt
 * - 503: Retries with exponential backoff
 * - Timeout: Retries with exponential backoff
 */
async function fetchWithRetry(
  url: string,
  options: FetchOptions,
  timeout: number = CONFIG.api.timeout,
  maxRetries: number = CONFIG.retry.maxRetries,
): Promise<Response> {
  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await fetchWithTimeout(url, options, timeout);

      // Rate limited - wait and retry (doesn't count as attempt)
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
        console.log(`   ⚠️ Rate limited. Waiting ${retryAfter} seconds...`);
        await delay(retryAfter * 1000);
        continue;
      }

      // Service unavailable - retry with backoff
      if (response.status === 503) {
        const backoffTime = CONFIG.retry.initialBackoffMs * Math.pow(2, attempt);
        console.log(`   ⚠️ Server unavailable (503). Retrying in ${backoffTime}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await delay(backoffTime);
        attempt++;
        continue;
      }

      return response;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const backoffTime = CONFIG.retry.initialBackoffMs * Math.pow(2, attempt);
      console.log(`   ⚠️ Request failed: ${lastError.message}. Retrying in ${backoffTime}ms... (attempt ${attempt + 1}/${maxRetries})`);
      await delay(backoffTime);
      attempt++;
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

/**
 * Sync a single campaign to the database.
 * Returns true on success, false on failure.
 */
async function syncSingleCampaign(campaign: Campaign, accessToken: string): Promise<boolean> {
  try {
    const syncResponse = await fetchWithRetry(
      `${CONFIG.api.baseUrl}/api/campaigns/${campaign.id}/sync`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ campaign_id: campaign.id })
      },
      CONFIG.api.syncTimeout
    );

    if (!syncResponse.ok) {
      throw new Error(`Sync API returned ${syncResponse.status}`);
    }

    await syncResponse.json();
    await saveCampaignToDB(campaign);

    console.log(`   ✓ Synced: ${campaign.name}`);
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`   ✗ Failed: ${campaign.name} - ${message}`);
    return false;
  }
}

/**
 * Process campaigns in batches with controlled concurrency.
 * Adds delay between batches to avoid overwhelming the API.
 */
async function processCampaignsInBatches(
  campaigns: Campaign[],
  accessToken: string,
  batchSize: number = CONFIG.concurrency.batchSize
): Promise<number> {
  let successCount = 0;

  for (let i = 0; i < campaigns.length; i += batchSize) {
    const batch = campaigns.slice(i, i + batchSize);
    const batchNumber = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(campaigns.length / batchSize);

    console.log(`\n   Processing batch ${batchNumber}/${totalBatches} (${batch.length} campaigns)...`);

    const results = await Promise.all(
      batch.map(campaign => syncSingleCampaign(campaign, accessToken))
    );

    successCount += results.filter(Boolean).length;

    // Delay between batches to be respectful to the API
    if (i + batchSize < campaigns.length) {
      await delay(CONFIG.concurrency.delayBetweenBatchesMs);
    }
  }

  return successCount;
}

/**
 * Main sync orchestration function.
 * Authenticates, fetches all campaigns (paginated), and syncs them to the database.
 */
export async function syncAllCampaigns(): Promise<void> {
  console.log('Syncing campaigns from Ad Platform...\n');

  // Validate required environment variables
  const email = process.env.AD_PLATFORM_EMAIL;
  const password = process.env.AD_PLATFORM_PASSWORD;

  if (!email || !password) {
    throw new ConfigurationError('Missing AD_PLATFORM_EMAIL or AD_PLATFORM_PASSWORD environment variables');
  }

  const authString = Buffer.from(`${email}:${password}`).toString('base64');

  console.log('Step 1: Getting access token...');

  const authResponse = await fetchWithRetry(
    `${CONFIG.api.baseUrl}/auth/token`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authString}`
      }
    },
    CONFIG.api.syncTimeout
  );

  if (!authResponse.ok) {
    throw new Error(`Authentication failed: ${authResponse.status}`);
  }

  const authData = await authResponse.json() as AuthResponse;
  const accessToken = authData.access_token;

  console.log('✓ Access token obtained successfully');

  console.log('\nStep 2: Fetching all campaigns...');

  let allCampaigns: Campaign[] = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    console.log(`   Fetching page ${currentPage}...`);

    const campaignsResponse = await fetchWithRetry(
      `${CONFIG.api.baseUrl}/api/campaigns?page=${currentPage}&limit=${CONFIG.api.pageSize}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      },
      CONFIG.api.timeout
    );

    if (!campaignsResponse.ok) {
      throw new Error(`API returned ${campaignsResponse.status}: ${campaignsResponse.statusText}`);
    }

    const campaignsData = await campaignsResponse.json() as PaginatedResponse<Campaign>;

    allCampaigns = allCampaigns.concat(campaignsData.data);
    hasMore = campaignsData.pagination.has_more;
    currentPage++;

    console.log(`   ✓ Got ${campaignsData.data.length} campaigns (total so far: ${allCampaigns.length})`);
  }

  console.log(`\n✓ Found ${allCampaigns.length} total campaigns across ${currentPage - 1} pages`);

  console.log('\nStep 3: Syncing campaigns to database (concurrent)...');

  const successCount = await processCampaignsInBatches(allCampaigns, accessToken);

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Sync complete: ${successCount}/${allCampaigns.length} campaigns synced`);
  console.log('='.repeat(60));
}
