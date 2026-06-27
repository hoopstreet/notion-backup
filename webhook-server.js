import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const app = express();
app.use(express.json());

// Webhook endpoint
app.post('/webhook/trigger', async (req, res) => {
  console.log('🔄 Instant backup triggered!');
  try {
    await execAsync('npm start');
    await execAsync('git add databases/');
    await execAsync('git commit -m "Instant backup: $(date)" --allow-empty');
    await execAsync('git push');
    res.json({ status: '✅ Backup complete!' });
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    res.status(500).json({ error: 'Backup failed' });
  }
});

app.get('/', (req, res) => {
  res.send('🚀 Webhook server running');
});

app.listen(3000, () => {
  console.log('🚀 Webhook server running on port 3000');
  console.log('📡 POST to http://localhost:3000/webhook/trigger to trigger backup');
});
