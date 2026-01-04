/**
 * Centralized configuration for the campaign sync service.
 */

import dotenv from 'dotenv';

dotenv.config();

export const CONFIG = {
    api: {
        baseUrl: process.env.AD_PLATFORM_API_URL || 'http://localhost:3001',
        pageSize: 10,
        timeout: 5000,
        syncTimeout: 10000,
    },
    retry: {
        maxRetries: 3,
        initialBackoffMs: 1000,
    },
    concurrency: {
        batchSize: 5,
        delayBetweenBatchesMs: 500,
    },
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        name: process.env.DB_NAME || 'mixoads',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        useMock: process.env.USE_MOCK_DB === 'true',
    },
} as const;
