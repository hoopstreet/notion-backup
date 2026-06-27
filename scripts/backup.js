import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);
const token = process.env.NOTION_TOKEN;
const pageId = process.env.NOTION_PAGE_ID;

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

async function crawlWorkspace() {
  console.log('📂 Crawling private Notion workspace...');
  
  const result = await notionRequest('/search', 'POST', {
    query: '',
    filter: {
      property: 'object',
      value: 'page'
    }
  });
  
  const pages = result.results || [];
  console.log(`✅ Found ${pages.length} pages`);
  
  const dbResult = await notionRequest('/search', 'POST', {
    query: '',
    filter: {
      property: 'object',
      value: 'database'
    }
  });
  
  const databases = dbResult.results || [];
  console.log(`✅ Found ${databases.length} databases`);
  
  return { pages, databases };
}

async function main() {
  try {
    console.log('=== 🚀 Starting Private Notion Backup ===');
    const data = await crawlWorkspace();
    
    const outputDir = './databases';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const fileName = `private_backup_${timestamp}.json`;
    
    fs.writeFileSync(
      path.join(outputDir, fileName),
      JSON.stringify(data, null, 2)
    );
    
    console.log(`✅ Backup saved to databases/${fileName}`);
    console.log(`   📄 ${data.pages.length} pages`);
    console.log(`   📊 ${data.databases.length} databases`);
    console.log('=== ✅ Backup Complete ===');
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    process.exit(1);
  }
}

main();
