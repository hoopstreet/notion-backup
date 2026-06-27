import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const execAsync = promisify(exec);
const token = process.env.NOTION_TOKEN;
const pageId = process.env.NOTION_PAGE_ID;
const DOWNLOAD_DIR = './attachments';

if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Helper to download a file from a URL
async function downloadFile(url, outputPath) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const writer = fs.createWriteStream(outputPath);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (error) {
    console.error(`  ❌ Failed to download ${url}:`, error.message);
  }
}

async function notionRequest(endpoint, method = 'GET', data = null) {
  const cmd = `curl -s -X ${method} https://api.notion.com/v1${endpoint} \
    -H "Authorization: Bearer ${token}" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    ${data ? `-d '${JSON.stringify(data)}'` : ''}`;

  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr && !stderr.includes('Warning')) console.warn('Curl stderr:', stderr);
    return JSON.parse(stdout);
  } catch (error) {
    console.error('Curl error:', error.message);
    throw error;
  }
}

// Recursively get all blocks from a page
async function getBlocks(blockId) {
  let allBlocks = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notionRequest(`/blocks/${blockId}/children`, 'GET');
    const blocks = response.results || [];
    allBlocks = allBlocks.concat(blocks);

    for (const block of blocks) {
      if (block.has_children) {
        const childBlocks = await getBlocks(block.id);
        allBlocks = allBlocks.concat(childBlocks);
      }
    }

    hasMore = response.has_more || false;
    startCursor = response.next_cursor;
  }
  return allBlocks;
}

// Extract file URLs and metadata from properties
function extractFilesAndMetadata(pageOrBlock) {
  const extracted = { files: [], richText: [], url: null };

  // Check properties for files/URLs
  if (pageOrBlock.properties) {
    for (const [key, prop] of Object.entries(pageOrBlock.properties)) {
      if (prop.type === 'files' && prop.files) {
        for (const file of prop.files) {
          extracted.files.push({ name: file.name, url: file.file?.url || file.external?.url });
        }
      }
      if (prop.type === 'url' && prop.url) {
        extracted.url = prop.url;
      }
      if (prop.type === 'rich_text' && prop.rich_text) {
        for (const text of prop.rich_text) {
          if (text.plain_text) extracted.richText.push(text.plain_text);
        }
      }
    }
  }

  // Check block content for files/embeds
  if (pageOrBlock.type === 'file' && pageOrBlock.file) {
    extracted.files.push({ name: pageOrBlock.file.name, url: pageOrBlock.file.file?.url || pageOrBlock.file.external?.url });
  }
  if (pageOrBlock.type === 'embed' && pageOrBlock.embed?.url) {
    extracted.url = pageOrBlock.embed.url;
  }
  if (pageOrBlock.type === 'pdf' && pageOrBlock.pdf?.external?.url) {
    extracted.files.push({ name: 'document.pdf', url: pageOrBlock.pdf.external.url });
  }
  if (pageOrBlock.type === 'image' && pageOrBlock.image) {
    extracted.files.push({ name: 'image.jpg', url: pageOrBlock.image.file?.url || pageOrBlock.image.external?.url });
  }
  if (pageOrBlock.type === 'video' && pageOrBlock.video) {
    extracted.files.push({ name: 'video.mp4', url: pageOrBlock.video.file?.url || pageOrBlock.video.external?.url });
  }

  return extracted;
}

async function crawlWorkspace() {
  console.log('📂 Crawling Notion workspace...');

  // Get all pages
  const result = await notionRequest('/search', 'POST', {
    query: '',
    filter: { property: 'object', value: 'page' }
  });
  const pages = result.results || [];
  console.log(`✅ Found ${pages.length} pages`);

  // Get all databases
  const dbResult = await notionRequest('/search', 'POST', {
    query: '',
    filter: { property: 'object', value: 'database' }
  });
  const databases = dbResult.results || [];
  console.log(`✅ Found ${databases.length} databases`);

  // Extract ALL content and files
  console.log('📎 Extracting files and metadata...');
  const allFiles = [];
  const allRichText = [];
  const allUrls = [];

  // Process pages and databases
  for (const item of [...pages, ...databases]) {
    const extracted = extractFilesAndMetadata(item);
    allFiles.push(...extracted.files);
    allRichText.push(...extracted.richText);
    if (extracted.url) allUrls.push(extracted.url);

    // Get blocks inside this page/database
    if (item.id) {
      try {
        const blocks = await getBlocks(item.id);
        for (const block of blocks) {
          const blockExtracted = extractFilesAndMetadata(block);
          allFiles.push(...blockExtracted.files);
          allRichText.push(...blockExtracted.richText);
          if (blockExtracted.url) allUrls.push(blockExtracted.url);
        }
      } catch (blockError) {
        console.warn(`  ⚠️ Could not get blocks for ${item.id}`);
      }
    }
  }

  console.log(`✅ Found ${allFiles.length} files, ${allRichText.length} text blocks, ${allUrls.length} URLs`);

  // Download files
  console.log('📥 Downloading files...');
  let downloaded = 0;
  for (const file of allFiles) {
    if (file.url) {
      const fileName = path.basename(file.url) || file.name || `file_${Date.now()}`;
      const outputPath = path.join(DOWNLOAD_DIR, fileName);
      console.log(`  💾 Downloading: ${fileName}`);
      await downloadFile(file.url, outputPath);
      downloaded++;
    }
  }
  console.log(`✅ Downloaded ${downloaded} files`);

  return { pages, databases, allFiles: allFiles.map(f => f.url), allRichText, allUrls };
}

async function main() {
  try {
    console.log(`=== 🚀 Starting Notion Backup for ${pageId} ===`);
    const data = await crawlWorkspace();

    const outputDir = './databases';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const fileName = `full_backup_${timestamp}.json`;

    fs.writeFileSync(
      path.join(outputDir, fileName),
      JSON.stringify(data, null, 2)
    );

    console.log(`✅ Full backup saved to databases/${fileName}`);
    console.log(`   📄 ${data.pages.length} pages`);
    console.log(`   📊 ${data.databases.length} databases`);
    console.log(`   📎 ${data.allFiles.length} files (downloaded to attachments/)`);
    console.log(`   📝 ${data.allRichText.length} text blocks captured`);
    console.log(`   🔗 ${data.allUrls.length} URLs captured`);
    console.log('=== ✅ Backup Complete ===');
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    process.exit(1);
  }
}

main();
