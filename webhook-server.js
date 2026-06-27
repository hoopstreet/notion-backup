import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
app.use(express.json());

app.post('/webhook/trigger', async (req, res) => {
  console.log('🔄 Instant backup triggered!');
  try {
    await execAsync('npm start');
    await execAsync('git add databases/ attachments/');
    await execAsync('git commit -m "Instant backup: $(date)" --allow-empty');
    await execAsync('git push');
    res.json({ status: '✅ Backup complete with all files!' });
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    res.status(500).json({ error: 'Backup failed' });
  }
});

app.get('/', (req, res) => {
  res.send('🚀 Webhook server running (full backup)');
});

app.listen(3000, () => {
  console.log('🚀 Webhook server running on port 3000');
  console.log('📡 POST to http://localhost:3000/webhook/trigger');
});
