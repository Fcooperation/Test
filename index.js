import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import robotsParser from 'robots-parser';

// Supabase credentials
const supabaseUrl = 'https://pwsxezhugsxosbwhkdvf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3c3hlemh1Z3N4b3Nid2hrZHZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5MjgzODcsImV4cCI6MjA2NzUwNDM4N30.T170FX8tC5iZEmdzyY_NjuFQDZ9_7GxxVSrVLzhvnQ0';
const supabase = createClient(supabaseUrl, supabaseKey);

const MAX_PAGES = 10;
const visited = new Set();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Ensure table exists (soft check with insert/delete)
async function ensureTable() {
  const { error } = await supabase
    .from('fai_training')
    .insert([{
      id: 'test-id',
      url: 'https://example.com',
      title: 'test',
      content: 'test content',
      tokens: 1,
      timestamp: new Date().toISOString()
    }]);

  if (error) {
    if (
      error.message.includes('duplicate key') ||
      error.message.includes('violates unique constraint')
    ) {
      console.log('✅ Table already exists.');
    } else {
      console.warn('⚠️ Could not ensure table:', error.message);
    }
  } else {
    await supabase.from('fai_training').delete().eq('id', 'test-id');
    console.log('✅ Table check passed.');
  }
}

// Upload to Supabase
async function uploadToSupabase(entry) {
  const { error } = await supabase.from('fai_training').insert([entry]);
  if (error) {
    console.error('❌ Upload error:', error.message);
  } else {
    console.log(`📤 Uploaded: ${entry.url}`);
  }
}

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

async function crawlPage(url, robots, crawlDelay, pageCount = { count: 0 }) {
  if (pageCount.count >= MAX_PAGES || visited.has(url)) return;
  if (!robots.parser.isAllowed(url, 'fcrawler')) return;

  visited.add(url);
  pageCount.count++;
  console.log(`🔍 Crawling: ${url}`);

  try {
    const res = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(res.data, { decodeEntities: false });
    const title = $('title').text().trim() || 'Untitled';
    const text = $('body').text().trim().replace(/\s+/g, ' ');
    const content = text.slice(0, 5000); // Limit to reduce size

    if (content.length < 100) {
      console.warn(`⚠️ Skipped (weak content): ${url}`);
      return;
    }

    const tokens = content.split(/\s+/).length;
    const entry = {
      id: nanoid(),
      url,
      title,
      content,
      tokens,
      timestamp: new Date().toISOString()
    };

    await uploadToSupabase(entry);

    const links = $('a[href]')
      .map((_, el) => $(el).attr('href'))
      .get()
      .map(link => new URL(link, url).href)
      .filter(href => href.startsWith('http'));

    for (const link of links) {
      await sleep(crawlDelay);
      await crawlPage(link, robots, crawlDelay, pageCount);
    }
  } catch (err) {
    console.warn(`❌ Failed: ${url} – ${err.message}`);
  }
}

// Auto-run on boot
(async () => {
  console.log('🚀 crawlerA starting...');
  await ensureTable();
  const startUrl = 'https://archive.org/';
  const robots = await getRobotsData(startUrl);
  await crawlPage(startUrl, robots, robots.delay);
})();
