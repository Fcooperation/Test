import fs from 'fs';
import axios from 'axios';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { nanoid } from 'nanoid';
import { createClient } from '@supabase/supabase-js';
import { URL } from 'url';

// 📌 Supabase credentials
const supabaseUrl = 'https://pwsxezhugsxosbwhkdvf.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3c3hlemh1Z3N4b3Nid2hrZHZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE5MjgzODcsImV4cCI6MjA2NzUwNDM4N30.T170FX8tC5iZEmdzyY_NjuFQDZ9_7GxxVSrVLzhvnQ0';
const supabase = createClient(supabaseUrl, supabaseKey);

// 🌍 Start URLs
const SITES = [
  'https://archive.org/',
  'https://en.wikipedia.org/',
  'https://openlibrary.org/',
  'https://www.nature.com/',
  'https://www.britannica.com/',
  'https://gutenberg.org/',
  'https://pubmed.ncbi.nlm.nih.gov/',
  'https://www.researchgate.net/',
  'https://www.sciencedirect.com/',
  'https://www.hindawi.com/'
];

// 🧠 Token estimate
function countTokens(text) {
  return Math.ceil(text.length / 4);
}

// 🕑 Sleep helper
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 📋 Extract training content
function extractTrainingData(html) {
  const $ = cheerio.load(html);
  const title = $('title').text().trim();
  let bodyText = '';
  $('p').each((_, el) => {
    const txt = $(el).text().trim();
    if (txt.length > 50) bodyText += txt + '\n';
  });
  return { title, content: bodyText.trim().slice(0, 5000) };
}

// 📤 Upload to Supabase with conflict handling
async function uploadToSupabase(data) {
  try {
    await supabase
      .from('fai_training')
      .insert([data], { onConflict: 'url' })  // ✅ skip duplicate URLs silently
      .throwOnError();

    console.log(`📤 Uploaded: ${data.url}`);
    return true;
  } catch (err) {
    console.error('❌ Upload error:', err.message || err);
    return false;
  }
}

// ⚙️ Ensure table exists
async function ensureTable() {
  console.log('⚙️ Ensuring Supabase table...');
  const { error } = await supabase.from('fai_training').select('id').limit(1);
  if (!error) {
    console.log('✅ Table exists');
  } else {
    console.warn('⚠️ Table not found. Please create it manually in Supabase SQL editor:');
    console.warn(`
CREATE TABLE public.fai_training (
  id TEXT PRIMARY KEY,
  url TEXT UNIQUE,
  title TEXT,
  content TEXT,
  tokens INT8,
  timestamp TIMESTAMPTZ
);`);
  }
}

// 🔍 Robots.txt + crawl delay
async function getRobots(url) {
  try {
    const robotsUrl = new URL('/robots.txt', url).href;
    const res = await axios.get(robotsUrl);
    const parser = robotsParser(robotsUrl, res.data);
    const delay = parser.getCrawlDelay('fcrawler') || 2000;
    return { parser, delay };
  } catch {
    return { parser: { isAllowed: () => true }, delay: 2000 };
  }
}

// 🤖 Crawl logic
const visited = new Set();
async function crawl(url, robots, delay, pageCount = { count: 0 }, maxPages = 10) {
  if (visited.has(url) || pageCount.count >= maxPages) return;
  if (!robots.parser.isAllowed(url, 'fcrawler')) return;

  visited.add(url);
  pageCount.count++;
  console.log(`🔍 Crawling: ${url}`);

  try {
    const res = await axios.get(url, { timeout: 10000 });
    const { title, content } = extractTrainingData(res.data);
    const tokens = countTokens(content);

    if (tokens < 100) {
      console.log(`⚠️ Skipped (weak content): ${url}`);
      return;
    }

    const entry = {
      id: nanoid(),
      url,
      title,
      content,
      tokens,
      timestamp: new Date().toISOString()
    };

    await uploadToSupabase(entry);

    // 📎 Follow more links
    const $ = cheerio.load(res.data);
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
      .filter(href => href && href.startsWith('http'));

    for (const link of links) {
      await sleep(delay);
      await crawl(link, robots, delay, pageCount, maxPages);
    }

  } catch (err) {
    console.warn(`❌ Failed: ${url} – ${err.message}`);
  }
}

// 🚀 Auto-run
async function run() {
  console.log('🚀 crawlerA starting...');
  await ensureTable();
  for (const site of SITES) {
    const robots = await getRobots(site);
    await crawl(site, robots, robots.delay);
  }
}

run(); // ✅ Runs immediately
