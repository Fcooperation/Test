import fs from 'fs';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { nanoid } from 'nanoid';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const visited = new Set();
const queue = [];
const logFile = path.join(__dirname, 'crawled_backup.jsonl');

// 🧠 Supabase credentials
const supabaseUrl = 'https://rjvjzvixkexxyqfncsfk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqdmp6dml4a2V4eHlxZm5jc2ZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTUwMDcwODIsImV4cCI6MjAyMDU4MzA4Mn0.R4sCqM2BtGAg7PKAVWauy28lW32zDgDqjlX7nZXDbBI';
const supabase = createClient(supabaseUrl, supabaseKey);

// 🌍 Start from rich sources
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

// 🧠 Token estimator (1 token ≈ 4 chars)
function countTokens(text) {
  return Math.ceil(text.length / 4);
}

// 🔎 Extract main text content
function extractTrainingData(html) {
  const $ = cheerio.load(html);
  const title = $('title').text().trim();
  let text = '';
  $('p').each((_, el) => {
    const paragraph = $(el).text().trim();
    if (paragraph.length > 50) text += paragraph + '\n';
  });
  return { title, text: text.trim().slice(0, 3000) };
}

// 💾 Save local backup
function backupLocally(entry) {
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
}

// 🧼 Already uploaded check
async function alreadyCrawled(url) {
  const { data } = await supabase
    .from('fai_index')
    .select('id')
    .eq('url', url)
    .limit(1);
  return data && data.length > 0;
}

// ⬆️ Upload to Supabase
async function upload(entry) {
  const { error } = await supabase.from('fai_index').insert([entry]);
  if (error) {
    console.error(`❌ Upload error: ${error.message}`);
    return false;
  }
  console.log(`✅ Uploaded: ${entry.url}`);
  return true;
}

// 🏗️ Ensure table exists
async function ensureTable() {
  const ddl = `
    create table if not exists public.fai_index (
      id text primary key,
      url text unique,
      title text,
      text text,
      tokens int,
      timestamp timestamptz
    );
  `;
  const { error } = await supabase.rpc('execute_sql', { sql: ddl });
  if (error) {
    console.warn('⚠️ Could not ensure table. It may already exist.');
  } else {
    console.log('✅ Table ensured.');
  }
}

// 🧠 robots.txt support
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

// 🔁 Crawl a single page
async function crawl(url, robots, delay) {
  if (visited.has(url) || !url.startsWith('http')) return;
  if (!robots.parser.isAllowed(url, 'fcrawler')) return;

  visited.add(url);
  console.log(`🔍 Crawling: ${url}`);

  try {
    if (await alreadyCrawled(url)) {
      console.log(`⏩ Skipped (already crawled): ${url}`);
      return;
    }

    const res = await axios.get(url, { timeout: 10000 });
    const { title, text } = extractTrainingData(res.data);

    if (!text || text.length < 100) {
      console.log(`⚠️ Skipped (weak content): ${url}`);
      return;
    }

    const tokens = countTokens(text);
    const entry = {
      id: nanoid(),
      url,
      title,
      text,
      tokens,
      timestamp: new Date().toISOString()
    };

    backupLocally(entry);
    await upload(entry);

    const $ = cheerio.load(res.data);
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      try {
        const absolute = new URL(href, url).toString();
        if (absolute.includes(new URL(url).hostname)) queue.push(absolute);
      } catch {}
    });

    await sleep(delay);
  } catch (err) {
    console.warn(`❌ Failed: ${url} – ${err.message}`);
  }
}

// 🚀 Start
async function run() {
  console.log('🚀 Crawler A started\n');
  await ensureTable();

  for (const site of SITES) {
    const { parser, delay } = await getRobotsData(site);
    queue.push(site);

    while (queue.length) {
      const next = queue.shift();
      await crawl(next, { parser }, delay);
    }
  }

  console.log('\n✅ Done crawling.');
}

run();
