import axios from 'axios';
import cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import robotsParser from 'robots-parser';

// =============== CONFIG ================
const SUPABASE_URL = 'https://pwsxezhugsxosbwhkdvf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3c3hlemh1Z3N4b3Nid2hrZHZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5MjgzODcsImV4cCI6MjA2NzUwNDM4N30.T170FX8tC5iZEmdzyY_NjuFQDZ9_7GxxVSrVLzhvnQ0';
const client = createClient(SUPABASE_URL, SUPABASE_KEY);

const START_URL = 'https://archive.org/';
const MAX_PAGES = 10;
const CRAWLER_NAME = 'fcrawler';
const visited = new Set();

// =============== UTILS ================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getRobotsData(url) {
  try {
    const robotsUrl = new URL('/robots.txt', url).href;
    const res = await axios.get(robotsUrl);
    const robots = robotsParser(robotsUrl, res.data);
    return { parser: robots, delay: robots.getCrawlDelay(CRAWLER_NAME) || 2000 };
  } catch {
    return { parser: { isAllowed: () => true }, delay: 2000 };
  }
}

async function ensureTable() {
  try {
    await client.from('fai_training').select('id').limit(1);
    console.log('✅ Table found or already exists');
  } catch (err) {
    console.warn('⚠️ Could not ensure table. It may already exist or need manual creation.');
  }
}

// =============== MAIN CRAWL ================
async function crawlPage(url, robots, delay, count = { total: 0 }) {
  if (visited.has(url) || count.total >= MAX_PAGES) return;
  if (!robots.parser.isAllowed(url, CRAWLER_NAME)) return;

  visited.add(url);
  count.total++;
  console.log(`🔍 Crawling: ${url}`);

  try {
    const res = await axios.get(url, { timeout: 10000 });
    const $ = cheerio.load(res.data, { decodeEntities: false });

    const title = $('title').text().trim().slice(0, 200) || 'Untitled';
    const bodyText = $('body').text().trim().replace(/\s+/g, ' ');
    if (bodyText.length < 100) {
      console.log(`⚠️ Skipped (weak content): ${url}`);
      return;
    }

    const content = bodyText.slice(0, 100000); // Limit long text
    const tokens = content.split(/\s+/).length;

    const { error } = await client.from('fai_training').insert([
      {
        id: nanoid(),
        url,
        title,
        content,
        tokens,
        timestamp: new Date().toISOString()
      }
    ]);

    if (error) {
      console.error(`❌ Upload error: ${error.message}`);
    } else {
      console.log(`📤 Uploaded: ${title}`);
    }

    const links = $('a[href]')
      .map((_, el) => $(el).attr('href'))
      .get()
      .map(link => new URL(link, url).href)
      .filter(href => href.startsWith('http'));

    for (const link of links) {
      await sleep(delay);
      await crawlPage(link, robots, delay, count);
    }
  } catch (err) {
    console.warn(`❌ Failed: ${url} – ${err.message}`);
  }
}

// =============== AUTO RUN ================
(async () => {
  console.log('🚀 crawlerA starting...');
  await ensureTable();
  const robots = await getRobotsData(START_URL);
  await crawlPage(START_URL, robots, robots.delay);
})();
