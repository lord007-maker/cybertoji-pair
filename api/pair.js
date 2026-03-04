// api/pair.js — Vercel Serverless Function
// Système multi-users : génère session + envoie par WhatsApp

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  delay
} from 'bail-lite';
import pino from 'pino';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

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

  try {
    const code = await generatePairingCode(cleanPhone);
    return res.status(200).json({ code, phone: cleanPhone });
  } catch (err) {
    console.error('[PAIR ERROR]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function generatePairingCode(phone) {
  const sessionDir = path.join(os.tmpdir(), 'cxmd_' + phone + '_' + Date.now());
  await fs.mkdir(sessionDir, { recursive: true });

  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timeout — réessaie dans quelques secondes'));
    }, 60000);

    function cleanup() {
      fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});
    }

    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['CYBERTOJI XMD', 'Chrome', '120.0'],
        markOnlineOnConnect: false
      });

      sock.ev.on('creds.update', saveCreds);
      let codeSent = false;
      let sessionSent = false;

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        // ── ÉTAPE 1 : Générer le code dès que le socket est prêt ──
        if (!codeSent && !sock.authState.creds.registered) {
          codeSent = true;
          try {
            await delay(1500);
            const code = await sock.requestPairingCode(phone);
            const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
            clearTimeout(timer);
            console.log('[PAIR] Code généré pour ' + phone + ': ' + formatted);
            resolve(formatted);
          } catch(e) {
            clearTimeout(timer);
            sock.end();
            cleanup();
            reject(new Error('Erreur génération code: ' + e.message));
          }
        }

        // ── ÉTAPE 2 : Quand le user entre le code → WhatsApp connecté ──
        if (connection === 'open' && !sessionSent) {
          sessionSent = true;
          console.log('[PAIR] Connexion établie pour ' + phone + ' — envoi session...');

          try {
            await delay(3000);
            await saveCreds();

            // Lire tous les fichiers de session
            const files = await fs.readdir(sessionDir);
            const sessionData = {};
            for (const file of files) {
              try {
                const content = await fs.readFile(path.join(sessionDir, file), 'utf8');
                sessionData[file] = content;
              } catch(e) {}
            }

            // Encoder en base64
            const sessionString = Buffer.from(JSON.stringify(sessionData)).toString('base64');

            // Envoyer la session par WhatsApp
            await sock.sendMessage(phone + '@s.whatsapp.net', {
              text: `╭━━━━━━━━━━━━━━━━━━━━━━╮\n┃   🤖 *CYBERTOJI XMD*   ┃\n╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n✅ *Connexion réussie !*\n\n🔐 *Ta SESSION STRING :*\n\n${sessionString}\n\n━━━━━━━━━━━━━━━━━━━━━━\n📌 *Comment l'utiliser :*\n1️⃣ Va sur ton hébergeur\n2️⃣ Dans *Variables* ajoute :\n   *SESSION_ID* = la session\n3️⃣ Redémarre ton bot ✅\n━━━━━━━━━━━━━━━━━━━━━━\n\n_© CYBERTOJI XMD 2026_`
            });

            console.log('[PAIR] Session envoyée à ' + phone);
            await delay(2000);
            sock.end();
            cleanup();

          } catch(e) {
            console.error('[PAIR] Erreur envoi session:', e.message);
            sock.end();
            cleanup();
          }
        }

        // ── Déconnexion ──
        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            sock.end();
            cleanup();
          }
        }
      });

    } catch(e) {
      clearTimeout(timer);
      cleanup();
      reject(e);
    }
  });
}
