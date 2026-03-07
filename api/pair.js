export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'Numéro requis' });
  const cleanPhone = String(phone).replace(/\D/g, '');
  if (cleanPhone.length < 7) return res.status(400).json({ error: 'Numéro invalide' });

  const BOT_URL    = process.env.BOT_URL;
  const BOT_SECRET = process.env.BOT_SECRET || 'cybertoji-secret-2026';
  if (!BOT_URL) return res.status(500).json({ error: 'BOT_URL non configuré' });

  try {
    const response = await fetch(`${BOT_URL}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Secret': BOT_SECRET },
      body: JSON.stringify({ phone: cleanPhone }),
      signal: AbortSignal.timeout(25000)
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.error || 'Erreur bot' });
    return res.status(200).json(data);
  } catch(err) {
    if (err.name === 'TimeoutError') return res.status(504).json({ error: 'Bot ne répond pas' });
    return res.status(500).json({ error: err.message });
  }
    }
