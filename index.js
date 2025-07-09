import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { nanoid } from 'nanoid';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Supabase credentials
const supabase = createClient(
  'https://pwsxezhugsxosbwhkdvf.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3c3hlemh1Z3N4b3Nid2hrZHZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5MjgzODcsImV4cCI6MjA2NzUwNDM4N30.T170FX8tC5iZEmdzyY_NjuFQDZ9_7GxxVSrVLzhvnQ0'
);

// Start sites
const SITES = [
  'https://archive.org/',
  'https://en.wikipedia.org/',
  'https://openlibrary.org/',
  'https://www.britannica.com/',
];

const visited = new Set();
const queue = [...SITES];
const MAX_PAGES = 10;

// Sleep utility
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Token estimator
function countTokens(text) {
  return Math.ceil(text.length / 4);
}

// Check if already uploaded
async function alreadyUploaded(url) {
  const { data } = await supabase
    .from('training_data')
    .select('id')
    .eq('url', url)
    .limit(1);
  return data && data.length > 0;
}

// Upload data to Supabase
async function uploadToSupabase(entry) {
  const { error } = await supabase.from('training_data').insert([entry]);
  if (error) {
    console.error(`❌ Upload error: ${error.message}`);
    return false;
  }
  console.log(`📤 Uploaded: ${entry.url}`);
  return true;
}

// Auto-create table if not found
async function ensureTable() {
  try {
    const ddl = `
      create table if not exists public.training_data (
        id text primary key,
        url text unique,
        title text,
        content text,
        tokens int,
        timestamp timestamptz
      );
    `;
    const { error } = await supabase.rpc('execute_sql', { sql: ddl });
    if (error) throw error;
    console.log('✅ Table ensured.');
  } catch (err) {
    console.warn("⚠️ Could not ensure table. It may already exist.");
  }
}

// Get robots.txt rules and delay
async function getRobotsData(url) {
  try {
    const robotsUrl = new URL('/robots.txt', url).href;
    const res = await axios.get(robotsUrl);
    const robots = robotsParser(robotsUrl, res.data);
    return {
      parser: robots,
      delay: robots.getCrawlDelay('fcrawler') || 2000
    };
  } catch {
    return {
      parser: { isAllowed: () => true },
      delay: 2000
    };
  }
}

// Crawl a single page
async function crawlPage(url, robots, delay, pageCount = { count: 0 }) {
  if (pageCount.count >= MAX_PAGES || visited.has(url)) return;
  if (!robots.parser.isAllowed(url, 'fcrawler')) return;

  visited.add(url);
  pageCount.count++;
  console.log(`🔍 Crawling: ${url}`);

  try {
    if (await alreadyUploaded(url)) {
      console.log(`⏩ Already uploaded: ${url}`);
      return;
    }

    const res = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(res.data, { decodeEntities: false });

    const title = $('title').text().trim() || 'Untitled';
    const text = $('body').text().trim().replace(/\s+/g, ' ');
    if (text.length < 100) {
      console.log(`⚠️ Skipped (weak content): ${url}`);
      return;
    }

    const entry = {
      id: nanoid(),
      url,
      title,
      content: text.slice(0, 3000),
      tokens: countTokens(text),
      timestamp: new Date().toISOString()
    };

    await uploadToSupabase(entry);

    const links = $('a[href]')
      .map((_, el) => $(el).attr('href'))
      .get()
      .map(link => {
        try {
          return new URL(link, url).href;
        } catch {
          return null;
        }
      })
      .filter(href => href && href.startsWith('http'));

    for (const link of links) {
      await sleep(delay);
      await crawlPage(link, robots, delay, pageCount);
    }

  } catch (err) {
    console.warn(`❌ Failed: ${url} – ${err.message}`);
  }
}

// Start crawl
export async function crawlSite(startUrl) {
  console.log('🚀 Crawler A starting...\n');
  await ensureTable();
  const robots = await getRobotsData(startUrl);
  await crawlPage(startUrl, robots, robots.delay);
  console.log('✅ Done.');
}
