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

async function notionRequest(endpoint, method = 'GET', data = null) {
  const cmd = `curl -s -X ${method} https://api.notion.com/v1${endpoint} \
    -H "Authorization: Bearer ${token}" \
    -H "Notion-Version: 2022-06-28" \
    -H "Content-Type: application/json" \
    ${data ? `-d '${JSON.stringify(data)}'` : ''}`;
  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr && !stderr.includes('Warning')) console.warn('stderr:', stderr);
    return JSON.parse(stdout);
  } catch (error) {
    console.error('API Error:', error.message);
    throw error;
  }
}

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
    console.warn(`  ⚠️ Failed to download: ${url}`);
  }
}

async function extractFilesAndText(blocks) {
  const files = [];
  const texts = [];
  const urls = [];
  
  for (const block of blocks) {
    // Check for file blocks
    if (block.type === 'file' && block.file) {
      const url = block.file.file?.url || block.file.external?.url;
      if (url) files.push({ name: block.file.name || 'file', url });
    }
    if (block.type === 'image' && block.image) {
      const url = block.image.file?.url || block.image.external?.url;
      if (url) files.push({ name: 'image.jpg', url });
    }
    if (block.type === 'pdf' && block.pdf) {
      const url = block.pdf.external?.url;
      if (url) files.push({ name: 'document.pdf', url });
    }
    if (block.type === 'video' && block.video) {
      const url = block.video.file?.url || block.video.external?.url;
      if (url) files.push({ name: 'video.mp4', url });
    }
    if (block.type === 'embed' && block.embed?.url) {
      urls.push(block.embed.url);
    }
    
    // Extract text from rich_text
    if (block[block.type]?.rich_text) {
      for (const text of block[block.type].rich_text) {
        if (text.plain_text) texts.push(text.plain_text);
      }
    }
    
    // Check properties for files/URLs
    if (block.properties) {
      for (const [key, prop] of Object.entries(block.properties)) {
        if (prop.type === 'files' && prop.files) {
          for (const file of prop.files) {
            const url = file.file?.url || file.external?.url;
            if (url) files.push({ name: file.name, url });
          }
        }
        if (prop.type === 'url' && prop.url) urls.push(prop.url);
        if (prop.type === 'rich_text' && prop.rich_text) {
          for (const text of prop.rich_text) {
            if (text.plain_text) texts.push(text.plain_text);
          }
        }
      }
    }
  }
  return { files, texts, urls };
}

async function getChildren(blockId) {
  const response = await notionRequest(`/blocks/${blockId}/children`, 'GET');
  return response.results || [];
}

async function crawlAllBlocks(blockId) {
  let all = [];
  const children = await getChildren(blockId);
  for (const child of children) {
    all.push(child);
    if (child.has_children) {
      const deeper = await crawlAllBlocks(child.id);
      all = all.concat(deeper);
    }
  }
  return all;
}

async function main() {
  console.log(`🚀 Starting FULL backup for ${pageId}`);
  
  // Get all pages
  const searchResult = await notionRequest('/search', 'POST', {
    query: '',
    filter: { property: 'object', value: 'page' }
  });
  const pages = searchResult.results || [];
  console.log(`📄 Found ${pages.length} pages`);
  
  // Get all databases
  const dbResult = await notionRequest('/search', 'POST', {
    query: '',
    filter: { property: 'object', value: 'database' }
  });
  const databases = dbResult.results || [];
  console.log(`📊 Found ${databases.length} databases`);
  
  // Extract all content
  console.log('📎 Extracting files and metadata...');
  let allFiles = [];
  let allTexts = [];
  let allUrls = [];
  
  // Process each page and database
  for (const item of [...pages, ...databases]) {
    // Extract from item properties
    const extracted = await extractFilesAndText([item]);
    allFiles = allFiles.concat(extracted.files);
    allTexts = allTexts.concat(extracted.texts);
    allUrls = allUrls.concat(extracted.urls);
    
    // Crawl blocks inside
    if (item.id) {
      try {
        const blocks = await crawlAllBlocks(item.id);
        const blockData = await extractFilesAndText(blocks);
        allFiles = allFiles.concat(blockData.files);
        allTexts = allTexts.concat(blockData.texts);
        allUrls = allUrls.concat(blockData.urls);
        console.log(`  ✅ Processed ${blocks.length} blocks from ${item.id.substring(0,8)}`);
      } catch (e) {
        console.warn(`  ⚠️ Could not process blocks for ${item.id}`);
      }
    }
  }
  
  console.log(`✅ Found ${allFiles.length} files, ${allTexts.length} text blocks, ${allUrls.length} URLs`);
  
  // Download files
  console.log('📥 Downloading files...');
  let downloaded = 0;
  const uniqueFiles = allFiles.filter((f, i) => allFiles.findIndex(x => x.url === f.url) === i);
  for (const file of uniqueFiles) {
    if (file.url) {
      const fileName = path.basename(file.url.split('?')[0]) || file.name || `file_${Date.now()}`;
      const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const outputPath = path.join(DOWNLOAD_DIR, safeName);
      console.log(`  💾 ${safeName}`);
      await downloadFile(file.url, outputPath);
      downloaded++;
    }
  }
  console.log(`✅ Downloaded ${downloaded} unique files`);
  
  // Save backup
  const outputDir = './databases';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const fullData = {
    timestamp,
    pageId,
    pages: pages.map(p => ({ id: p.id, title: p.properties?.title?.title?.[0]?.plain_text || 'Untitled' })),
    databases: databases.map(d => ({ id: d.id, title: d.properties?.title?.title?.[0]?.plain_text || 'Untitled' })),
    fileCount: allFiles.length,
    textCount: allTexts.length,
    urlCount: allUrls.length,
    files: allFiles,
    texts: allTexts,
    urls: allUrls
  };
  
  fs.writeFileSync(
    path.join(outputDir, `full_backup_${timestamp}.json`),
    JSON.stringify(fullData, null, 2)
  );
  
  console.log(`✅ Saved to databases/full_backup_${timestamp}.json`);
  console.log(`📄 ${pages.length} pages | 📊 ${databases.length} databases`);
  console.log(`📎 ${allFiles.length} files | 📝 ${allTexts.length} texts | 🔗 ${allUrls.length} URLs`);
  console.log('=== ✅ COMPLETE ===');
}

main().catch(console.error);
