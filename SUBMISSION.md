# Backend Engineer Assignment - Submission

**Name:** Mohit Pal  
**Date:** 4th January, 2026  
**Time Spent:** 55 minutes  
**GitHub:** mohitpal2621

---

## Part 1: What Was Broken

### Issue 1: Hardcoded Credentials
**What was wrong:**  
The email and password were hardcoded directly in `syncCampaigns.ts`. Anyone with access to the codebase could see them, and they'd end up in version control history forever.

**Why it mattered:**  
This is a security nightmare. If this repo ever got leaked or a developer's machine was compromised, attackers would have valid API credentials. Also makes it impossible to use different credentials for dev/staging/prod environments.

**Where in the code:**  
`src/syncCampaigns.ts` - 
```  
    const email = "admin@mixoads.com";
    const password = "SuperSecret123!";
```

---

### Issue 2: Credentials and Tokens Logged to Console
**What was wrong:**  
The code was logging the base64-encoded credentials and the full access token to the console. Base64 is trivially reversible - it's encoding, not encryption.

**Why it mattered:**  
Logs often get shipped to centralized logging systems, saved to files, or displayed in CI/CD pipelines. Anyone with log access could grab working credentials. This has caused real breaches at companies.

**Where in the code:**  
`src/syncCampaigns.ts` - 
```  
  console.log(`Using auth: Basic ${authString}`);
  ...
  console.log(`Got access token: ${accessToken}`);
```

---

### Issue 3: No Pagination Handling
**What was wrong:**  
The code only fetched page 1 with limit=10. The API has 100 campaigns across 10 pages, but the original code completely ignored `pagination.has_more` and only synced the first 10.

**Why it mattered:**  
90% of campaign data was never synced. The database would be missing most campaigns, and any reporting or analytics built on top would be wrong.

**Where in the code:**  
`src/syncCampaigns.ts` - 
```
  const campaignsResponse = await fetch(`${API_BASE_URL}/api/campaigns?page=1&limit=${PAGE_SIZE}`, {
```

---

### Issue 4: No Timeout or Retry Logic
**What was wrong:**  
All fetch calls had no timeout. If the API hung (which it does 10% of the time), the script would wait forever. There was also no retry logic for the 503 errors the API throws 20% of the time.

**Why it mattered:**  
The sync job would randomly hang indefinitely or fail on transient errors that would succeed on retry. In production, this means unreliable data and someone getting paged at 3am.

**Where in the code:**  
Every `fetch()` call in `syncCampaigns.ts` - no timeout or retry wrapper anywhere.

---

### Issue 5: No Rate Limit Handling
**What was wrong:**  
The API has a 10 request/minute limit and returns 429 with a `retry-after` header. The original code didn't check for 429 at all - it would just fail or behave unpredictably.

**Why it mattered:**  
With 100 campaigns to sync plus pagination requests, you'd hit the rate limit almost immediately. The sync would fail partway through, leaving the database in an inconsistent state.

**Where in the code:**  
No handling anywhere in the original code. Response status codes weren't even checked properly.

---

### Issue 6: Sequential Processing (Slow)
**What was wrong:**  
Each campaign sync was done one at a time, waiting for the previous one to complete. The sync endpoint takes 2 seconds each, so 100 campaigns = 200+ seconds minimum.

**Why it mattered:**  
Way too slow for production. If running this as a scheduled job, it would take forever. Also wastes resources - could be doing multiple syncs in parallel.

**Where in the code:**  
`src/syncCampaigns.ts` - the `for...of` loop at line 274.

---

### Issue 7: Database Connection Leak + SQL Injection
**What was wrong:**  
The `getDB()` function created a new connection pool on every single call instead of reusing one. And the SQL query used string concatenation instead of parameterized queries.

**Why it mattered:**  
Connection leaks would exhaust database connections quickly, crashing the app. The SQL injection vulnerability meant a malicious campaign name like `'); DROP TABLE campaigns;--` could destroy the database.

**Where in the code:**  
`src/database.ts` - `getDB()` created new Pool every time, and the INSERT query built SQL by concatenating `campaign.name` directly.

---

## Part 2: How I Fixed It

### Fix 1: Environment Variables for Credentials

**My approach:**  
Moved credentials to environment variables (`AD_PLATFORM_EMAIL`, `AD_PLATFORM_PASSWORD`). Added validation at the start of `syncAllCampaigns()` to fail fast if they're missing.

**Why this approach:**  
Standard practice. Environment variables are easy to configure in different environments and don't get committed to git. The `.env.example` file documents what's needed without exposing actual values.

**Trade-offs:**  
Could have used a secrets manager like AWS Secrets Manager or HashiCorp Vault, but that's overkill for this scope. Env vars are fine for now.

---

### Fix 2: Removed Sensitive Logging

**My approach:**  
Removed all logging of credentials, auth strings, and tokens. Replaced with generic success messages like "Access token obtained successfully".

**Why this approach:**  
Simple - just don't log sensitive stuff. The logs still tell you what's happening without exposing secrets.

---

### Fix 3: Pagination Loop

**My approach:**  
Added a `while (hasMore)` loop that fetches pages until `pagination.has_more` is false. Accumulates all campaigns into an `allCampaigns` array before processing.

**Why this approach:**  
Straightforward and matches how the API is designed to be used. Fetching all data before processing means we know the total count upfront.

**Trade-offs:**  
Memory usage scales with campaign count. For millions of campaigns, would need streaming/chunked processing. But for hundreds or thousands, this is fine.

---

### Fix 4: Timeout + Retry with Exponential Backoff

**My approach:**  
Created `fetchWithTimeout()` using AbortController to add configurable timeouts. Built `fetchWithRetry()` on top that handles retries with exponential backoff (1s, 2s, 4s...).

**Why this approach:**  
Exponential backoff is the standard pattern - gives the server time to recover without hammering it. AbortController is the modern way to handle fetch timeouts.

**Trade-offs:**  
Max 3 retries is a balance between reliability and not waiting forever. Could be configurable but kept it simple.

---

### Fix 5: Rate Limit Handling

**My approach:**  
In `fetchWithRetry()`, detect 429 status, parse the `retry-after` header, and delay that many seconds before retrying. Importantly, this doesn't count against the retry limit since it's expected behavior.

**Why this approach:**  
The API tells us exactly how long to wait. Following that instruction is the correct thing to do. Not counting it as a "failure" means we don't give up when we're just being rate limited.

---

### Fix 6: Concurrent Batch Processing

**My approach:**  
Created `processCampaignsInBatches()` that processes campaigns in batches of 5 using `Promise.all()`. Added a 500ms delay between batches to be respectful to the API.

**Why this approach:**  
Parallel processing but with controlled concurrency. 5 at a time is a reasonable balance - faster than sequential, but won't overwhelm the API.

**Trade-offs:**  
Could use a proper concurrency limiter library like p-limit, but manual batching works fine here.

---

### Fix 7: Database Fixes

**My approach:**  
- Singleton pattern for the connection pool
- `ON CONFLICT ... DO UPDATE` for upsert behavior
- Parameterized queries (`$1, $2, ...`) instead of string concatenation
- Added `closeDB()` for graceful shutdown

**Why this approach:**  
All standard PostgreSQL best practices. One pool shared across calls, proper upsert to handle re-runs, and parameterized queries eliminate SQL injection.

---

## Part 3: Code Structure Improvements

**What I changed:**  
- Split the god function into smaller focused functions: `fetchWithTimeout`, `fetchWithRetry`, `syncSingleCampaign`, `processCampaignsInBatches`
- Added a proper `Campaign` interface in `types.ts`
- Made database module properly encapsulated with singleton pool
- Added graceful shutdown via `closeDB()` in the main entry point

**Why it's better:**  
Each function does one thing. Much easier to test, debug, and modify. If I need to change retry logic, I only touch `fetchWithRetry()`. If I need to change how a single campaign syncs, just `syncSingleCampaign()`.

**Architecture decisions:**  
Kept it functional rather than class-based. For this scope, classes would add ceremony without benefit. The module pattern with exported functions is simpler and works well.

---

## Part 4: Testing & Verification

**Test scenarios I ran:**
1. Started mock API and ran the sync - verified all 100 campaigns sync
2. Watched logs to confirm pagination fetches all 10 pages
3. Observed retry behavior when hitting 503 errors
4. Verified rate limiting waits and recovers
5. Ran sync twice to confirm upsert works (no duplicate errors)

**Expected behavior:**  
Should fetch 100 campaigns across 10 pages, sync them in batches with proper retry/backoff for failures, and complete with all 100 synced.

**Actual results:**  
Works as expected. Some batches take longer due to retries, but completes successfully. Final output shows 100/100 campaigns synced.

**Edge cases tested:**  
- Timeout recovery (mock API simulates these)
- 503 retry behavior  
- Running sync multiple times (upsert handles it)

---

## Part 5: Production Considerations

### Monitoring & Observability
- Add structured logging (JSON format) with request IDs for tracing
- Metrics: sync duration, campaigns synced, failure rate, retry count
- Alerts: sync job taking too long, high failure rate, credentials about to expire

### Error Handling & Recovery
- Dead letter queue for campaigns that fail after all retries
- Partial success tracking - record which campaigns failed for manual review
- Better error categorization (retryable vs permanent failures)

### Scaling Considerations
- Token caching and refresh logic (currently doesn't handle token expiry mid-run)
- Worker pool for running syncs for multiple clients concurrently
- Database connection pooling tuned for load
- Queue-based architecture (SQS/RabbitMQ) for processing campaigns

### Security Improvements
- Use a secrets manager instead of env vars
- Rotate credentials regularly
- Audit logging for sync operations
- Network isolation - API calls through private VPC endpoints if possible

### Performance Optimizations
- Batch database inserts instead of one at a time
- Adjust concurrency limit based on API performance
- Caching for campaigns that haven't changed
- Delta sync instead of full sync every time

---

## Part 6: Limitations & Next Steps

**Current limitations:**  
- No token refresh logic - long syncs might hit token expiry
- No persistent tracking of sync state - if it crashes, starts over
- Concurrency limit is hardcoded, not adaptive
- No unit tests yet

**What I'd do with more time:**  
- Add token expiry tracking and automatic refresh
- Write unit tests for the retry logic and database functions
- Add checkpointing so partial progress isn't lost
- Build a proper API client class with circuit breaker pattern
- Structured logging with correlation IDs

**Questions I have:**  
- How often does this sync run in production? Might affect batching strategy
- Is there a max campaign count we should expect?
- Are there other endpoints that need similar sync logic?

---

## Part 7: How to Run My Solution

### Setup
```bash
# Clone and install
git clone https://github.com/mohitpal2621/mixoads-backend-assignment.git
cd mixoads-backend-assignment
npm install

# Install mock API
cd mock-api
npm install
cd ..

# Set up environment
cp .env.example .env
```

### Running
```bash
# Terminal 1: Start the mock API
cd mock-api
npm start

# Terminal 2: Run the sync
npm start
```

### Expected Output
```
Starting campaign sync...
============================================================
Syncing campaigns from Ad Platform...

Step 1: Getting access token...
✓ Access token obtained successfully

Step 2: Fetching all campaigns...
   Fetching page 1...
   ✓ Got 10 campaigns (total so far: 10)
   ...
   Fetching page 10...
   ✓ Got 10 campaigns (total so far: 100)

✓ Found 100 total campaigns across 10 pages

Step 3: Syncing campaigns to database (concurrent)...
   Processing batch 1/20 (5 campaigns)...
   ...

============================================================
✅ Sync complete: 100/100 campaigns synced
============================================================

Sync completed successfully!
```

### Testing
```bash
# Run the sync and verify output shows 100/100
npm start

# Run again - should complete without errors (upsert handles duplicates)
npm start
```

---

## Part 8: Additional Notes

This was a fun debugging exercise. The main bugs were pretty obvious once you looked at the code, but the real challenge was fixing them in a way that's maintainable. Tried to keep the changes focused - didn't want to over-engineer it with fancy abstractions when simple functions do the job.

The rate limiting design choice (not counting 429 as a retry attempt) is intentional. The API is telling us to wait, and we do. That's different from a failure that might or might not work on retry.

If this were production code, I'd push for adding proper tests and structured logging before deploying. The core logic is solid now, but observability would be the next priority.

### Bonus: Bug in Mock API

While testing, I noticed the original `mock-api/server.js` had a subtle bug. The 503 check came before the timeout check:

```javascript
// Original order
if (requestCounter % 5 === 0) {  // 503 on 5, 10, 15, 20...
  return res.status(503)...
}
if (requestCounter % 10 === 0) { // timeout on 10, 20, 30...
  // Never reached! Already returned 503 above
}
```

Since every multiple of 10 is also a multiple of 5, the timeout simulation would never trigger. I swapped the order so the `% 10` check runs first:

```javascript
// Fixed order
if (requestCounter % 10 === 0) { // timeout on 10, 20...
  return;
}
if (requestCounter % 5 === 0) {  // 503 on 5, 15, 25...
  return res.status(503)...
}
```

Now both failure modes work correctly - timeouts on request 10, 20, etc. and 503s on 5, 15, 25, etc.

---

## Commits Summary

I worked on all the fixes together as one cohesive refactor rather than incremental commits. The single commit covers:

- Credentials moved to environment variables
- Timeout, retry, and rate limit handling added
- Pagination implemented to fetch all campaigns
- Concurrent batch processing for performance
- Database connection pooling and SQL injection fixes
- Code split into focused helper functions
- Types and graceful shutdown added

In hindsight, incremental commits would have made the review easier. For future work, I'd commit more granularly as I go.

---

**Thank you for reviewing my submission!**
