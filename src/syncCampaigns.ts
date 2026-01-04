import fetch from 'node-fetch';
import { saveCampaignToDB } from './database';
import { Campaign } from './types';

// Configuration constants
const API_BASE_URL = process.env.AD_PLATFORM_API_URL || 'http://localhost:3001';
const PAGE_SIZE = 10;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const CONCURRENCY_LIMIT = 5;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to add timeout to fetch requests
async function fetchWithTimeout(url: string, options: any, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

async function fetchWithRetry(
  url: string,
  options: any,
  timeout = 5000,
  maxRetries = MAX_RETRIES,
): Promise<any> {
  let lastError: Error | null = null;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await fetchWithTimeout(url, options, timeout);

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
        console.log(`   ⚠️ Rate limited. Waiting ${retryAfter} seconds...`);
        await delay(retryAfter * 1000);
        continue;
      }

      if (response.status === 503) {
        const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.log(`   ⚠️ Server unavailable (503). Retrying in ${backoffTime}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await delay(backoffTime);
        attempt++;
        continue;
      }

      return response;
    } catch (error: any) {
      lastError = error;
      const backoffTime = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      console.log(`   ⚠️ Request failed: ${error.message}. Retrying in ${backoffTime}ms... (attempt ${attempt + 1}/${maxRetries})`);
      await delay(backoffTime);
      attempt++;
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

async function syncSingleCampaign(campaign: Campaign, accessToken: string): Promise<boolean> {
  try {
    const syncResponse = await fetchWithRetry(
      `${API_BASE_URL}/api/campaigns/${campaign.id}/sync`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ campaign_id: campaign.id })
      },
      10000
    );

    if (!syncResponse.ok) {
      throw new Error(`Sync API returned ${syncResponse.status}`);
    }

    await syncResponse.json();
    await saveCampaignToDB(campaign);

    console.log(`   ✓ Synced: ${campaign.name}`);
    return true;
  } catch (error: any) {
    console.error(`   ✗ Failed: ${campaign.name} - ${error.message}`);
    return false;
  }
}

async function processCampaignsInBatches(
  campaigns: Campaign[],
  accessToken: string,
  batchSize: number = CONCURRENCY_LIMIT
): Promise<number> {
  let successCount = 0;

  for (let i = 0; i < campaigns.length; i += batchSize) {
    const batch = campaigns.slice(i, i + batchSize);
    console.log(`\n   Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(campaigns.length / batchSize)} (${batch.length} campaigns)...`);

    const results = await Promise.all(
      batch.map(campaign => syncSingleCampaign(campaign, accessToken))
    );

    successCount += results.filter(Boolean).length;

    // Small delay between batches to be nice to the API
    if (i + batchSize < campaigns.length) {
      await delay(500);
    }
  }

  return successCount;
}

export async function syncAllCampaigns() {
  console.log('Syncing campaigns from Ad Platform...\n');

  const email = process.env.AD_PLATFORM_EMAIL;
  const password = process.env.AD_PLATFORM_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing AD_PLATFORM_EMAIL or AD_PLATFORM_PASSWORD environment variables');
  }

  const authString = Buffer.from(`${email}:${password}`).toString('base64');

  console.log('Step 1: Getting access token...');

  const authResponse = await fetchWithRetry(`${API_BASE_URL}/auth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authString}`
    }
  }, 10000);

  if (!authResponse.ok) {
    throw new Error(`Authentication failed: ${authResponse.status}`);
  }

  const authData: any = await authResponse.json();
  const accessToken = authData.access_token;

  console.log('✓ Access token obtained successfully');

  console.log('\nStep 2: Fetching all campaigns...');

  let allCampaigns: Campaign[] = [];
  let currentPage = 1;
  let hasMore = true;

  while (hasMore) {
    console.log(`   Fetching page ${currentPage}...`);

    const campaignsResponse = await fetchWithRetry(
      `${API_BASE_URL}/api/campaigns?page=${currentPage}&limit=${PAGE_SIZE}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      },
      5000
    );

    if (!campaignsResponse.ok) {
      throw new Error(`API returned ${campaignsResponse.status}: ${campaignsResponse.statusText}`);
    }

    const campaignsData: any = await campaignsResponse.json();

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
