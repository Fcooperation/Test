// crawlerA.js
import fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { nanoid } from 'nanoid';
import { createClient } from '@supabase/supabase-js';

// ✅ Supabase credentials
const supabaseUrl = 'https://pwsxezhugsxosbwhkdvf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3c3hlemh1Z3N4b3Nid2hrZHZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5MjgzODcsImV4cCI6MjA2NzUwNDM4N30.T170FX8tC5iZEmdzyY_NjuFQDZ9_7GxxVSrVLzhvnQ0';
const supabase = createClient(supabaseUrl, supabaseKey);

// 🔗 Start URLs
const SITES = [
  'https://archive.org/',
  'https://en.wikipedia.org/',
  'https://openlibrary.org/'
];

const visited = new Set();
const queue = [...SITES];
const MAX_PAGES = 15;

// 💤 Delay
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 🤖 Get robots.txt
async function getRobotsData(url) {
  try {
    const robotsUrl = new URL('/robots.txt', url).href;
    const res = await axios.get(robotsUrl);
    const robots = robotsParser(robotsUrl, res.data);
    return { parser: robots, delay: robots.getCrawlDelay('fcrawler') || 2000 };
  } catch {
    return { parser: { isAllowed: () => true }, delay: 2000 };
  }
}

// 🔁 Check if already in Supabase
async function alreadyCrawled(url) {
  const { data } = await supabase
    .from('fai_training')
    .select('id')
    .eq('url', url)
    .limit(1);
  return data && data.length > 0;
}

// 📤 Upload training data
async function uploadToSupabase(data) {
  const { error } = await supabase.from('fai_training').insert([data]);
  if (error) {
    console.error('❌ Upload error:', error.message);
    return false;
  }
  console.log(`📤 Uploaded: ${data.url}`);
  return true;
}

// 🏗️ Create table if not exists
async function ensureTable() {
  const ddl = `
    create table if not exists public.fai_training (
      id text primary key,
      url text unique,
      title text,
      content text,
      tokens int,
      timestamp timestamptz
    );
  `;
  try {
    const { error } = await supabase.rpc('execute_sql', { sql: ddl });
    if (error) throw error;
    console.log('✅ Supabase table ensured');
  } catch {
    console.warn('⚠️ Could not ensure table. It may already exist.');
  }
}

// 🔍 Crawl a page
async function crawlPage(url, robots, crawlDelay, pageCount = { count: 0 }) {
  if (pageCount.count >= MAX_PAGES || visited.has(url)) return;
  if (!robots.parser.isAllowed(url, 'fcrawler')) return;

  visited.add(url);
  pageCount.count++;
  console.log(`🔍 Crawling: ${url}`);

  try {
    if (await alreadyCrawled(url)) {
      console.log(`⏩ Skipped (already in Supabase): ${url}`);
      return;
    }

    const res = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(res.data);
    const title = $('title').text().trim() || 'untitled';
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    if (text.length < 100) {
      console.log(`⚠️ Skipped (weak content): ${url}`);
      return;
    }

    const data = {
      id: nanoid(),
      url,
      title,
      content: text.slice(0, 10000),
      tokens: Math.ceil(text.length / 4),
      timestamp: new Date().toISOString()
    };

    await uploadToSupabase(data);

    // Discover internal links
    const links = $('a[href]')
      .map((_, el) => $(el).attr('href'))
      .get()
      .map(href => {
        try {
          return new URL(href, url).href;
        } catch {
          return null;
        }
      })
      .filter(href => href && href.startsWith('http') && href.includes(new URL(url).hostname));

    for (const link of links) {
      await sleep(crawlDelay);
      await crawlPage(link, robots, crawlDelay, pageCount);
    }
  } catch (err) {
    console.warn(`❌ Failed: ${url} – ${err.message}`);
  }
}

// 🚀 Start crawling automatically
(async function run() {
  console.log('🚀 crawlerA starting...');
  await ensureTable();
  while (queue.length > 0) {
    const next = queue.shift();
    const robots = await getRobotsData(next);
    await crawlPage(next, robots, robots.delay);
  }
  console.log('✅ Done. crawlerA exited.');
})();
