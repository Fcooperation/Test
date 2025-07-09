import fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import robotsParser from 'robots-parser';

// ✅ Supabase config
const supabaseUrl = 'https://pwsxezhugsxosbwhkdvf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3c3hlemh1Z3N4b3Nid2hrZHZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5MjgzODcsImV4cCI6MjA2NzUwNDM4N30.T170FX8tC5iZEmdzyY_NjuFQDZ9_7GxxVSrVLzhvnQ0';
const supabase = createClient(supabaseUrl, supabaseKey);

// ✅ Sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ✅ Setup table if missing
async function ensureTable() {
  const { error } = await supabase
    .from('fai_training')
    .insert([{ id: 'test', url: 'https://example.com', title: 'test', content: 'test', tokens: 1, timestamp: new Date() }]);

  if (error && !error.message.includes('duplicate')) {
    console.warn('⚠️ Could not ensure table. It may already exist or be misconfigured.');
  } else {
    await supabase.from('fai_training').delete().eq('id', 'test');
  }
}

// ✅ Upload to Supabase
async function uploadToSupabase(entry) {
  const { data, error } = await supabase
    .from('fai_training')
    .insert([entry]);

  if (error) throw error;
  console.log(`📤 Uploaded: ${entry.url}`);
}

// ✅ Robots.txt handler
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

// ✅ Crawl page
const visited = new Set();
const MAX_PAGES = 10;

async function crawlPage(url, robots, delay, count = { num: 0 }) {
  if (visited.has(url) || count.num >= MAX_PAGES) return;
  if (!robots.parser.isAllowed(url, 'fcrawler')) return;

  visited.add(url);
  count.num++;
  console.log(`🔍 Crawling: ${url}`);

  try {
    const res = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(res.data, { decodeEntities: false });
    const text = $('body').text().trim().replace(/\s+/g, ' ');
    if (text.length < 100) {
      console.warn(`⚠️ Skipped (weak content): ${url}`);
      return;
    }

    const title = $('title').text().trim() || 'Untitled';
    const entry = {
      id: nanoid(),
      url,
      title,
      content: text,
      tokens: Math.ceil(text.length / 4),
      timestamp: new Date().toISOString()
    };

    await uploadToSupabase(entry);

    const links = $('a[href]')
      .map((_, el) => $(el).attr('href'))
      .get()
      .map(link => new URL(link, url).href)
      .filter(link => link.startsWith('http'));

    for (const link of links) {
      await sleep(delay);
      await crawlPage(link, robots, delay, count);
    }

  } catch (err) {
    console.error(`❌ Upload error: ${err.message}`);
  }
}

// ✅ Run on startup
(async () => {
  console.log('🚀 crawlerA starting...');
  await ensureTable();
  const startUrl = 'https://archive.org/';
  const robots = await getRobotsData(startUrl);
  await crawlPage(startUrl, robots, robots.delay);
})();
