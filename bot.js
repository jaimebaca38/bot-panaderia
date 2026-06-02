const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
require('dotenv').config();

// ============= LIMPIAR SESIÓN =============
const authFolder = './auth_data';
const FORZAR_LIMPIEZA = true;  // Cambiar a false después de escanear QR

if (FORZAR_LIMPIEZA && fs.existsSync(authFolder)) {
    console.log('🗑️ LIMPIANDO SESIÓN...');
    fs.rmSync(authFolder, { recursive: true, force: true });
    fs.mkdirSync(authFolder, { recursive: true });
    console.log('✅ Sesión limpiada');
}

// ============= CONFIGURACIÓN =============
const PORT = process.env.PORT || 10000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

const chatHistories = new Map();
const MAX_HISTORY = 20;

// ============= SERVIDOR WEB =============
const app = express();

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>PanBot - Panadería El Buen Pan</title>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial; text-align: center; padding: 50px; background: #f5e6d3; }
                h1 { color: #8B4513; }
                .status { padding: 20px; background: white; border-radius: 10px; display: inline-block; }
                .online { color: green; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>🥖 PanBot - Panadería El Buen Pan</h1>
            <div class="status">
                <p>Estado: <span class="online">✅ ONLINE</span></p>
                <p>🤖 Usando DeepSeek AI</p>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => res.status(200).send('OK'));

app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
});

// ============= FUNCIÓN DEEPSEEK =============
async function getDeepSeekResponse(userMessage, chatId) {
    try {
        if (!DEEPSEEK_API_KEY) return "🔧 API no configurada.";
        
        if (!chatHistories.has(chatId)) {
            chatHistories.set(chatId, []);
        }
        
        let history = chatHistories.get(chatId);
        history.push({ role: "user", content: userMessage });
        
        if (history.length > MAX_HISTORY) {
            history = history.slice(-MAX_HISTORY);
        }
        
        const systemMessage = {
            role: "system",
            content: `Eres "PanBot" de "Panadería El Buen Pan". Horarios: Lun-Sáb 8am-8pm, Dom 9am-1pm. Dirección: Av. Principal 123. Tel: 11-1234-5678. Productos: Pan francés $200 c/u o $2000 docena, Pan integral $500/kg, Facturas $150 c/u o $1500 docena, Medialunas $100, Tortas desde $5000. Promos: Martes medialunas 2x1, Jueves facturas 10% off, Sábados pan integral 15% off. Responde AMABLE, CONCISO, en español, con emojis.`
        };
        
        const messages = [systemMessage, ...history];
        
        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: messages,
                temperature: 0.7,
                max_tokens: 500
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) throw new Error('DeepSeek API error');
        
        const botReply = data.choices[0].message.content;
        history.push({ role: "assistant", content: botReply });
        chatHistories.set(chatId, history);
        
        return botReply;
        
    } catch (error) {
        console.error("Error DeepSeek:", error);
        return "Lo siento, hubo un error. Intentá de nuevo. 🍞";
    }
}

// ============= WHATSAPP =============
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        const sock = makeWASocket({
            auth: state,
            browser: ['PanBot', 'Chrome', '120.0.0'],
            syncFullHistory: false,
            printQRInTerminal: false,
            keepAliveIntervalMs: 30000,
        });
        
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('\n📱 ESCANEA ESTE QR CON WHATSAPP:\n');
                qrcode.generate(qr, { small: true });
                console.log('\n⚠️ Escanéalo rápido. Expira en 20 segundos.\n');
                reconnectAttempts = 0;
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`❌ Conexión cerrada. Código: ${statusCode}`);
                
                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    const delay = Math.min(5000 * reconnectAttempts, 30000);
                    console.log(`🔄 Reintento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} en ${delay/1000}s...`);
                    setTimeout(() => startBot(), delay);
                }
            } else if (connection === 'open') {
                console.log('\n✅ ¡BOT CONECTADO A WHATSAPP!');
                console.log('🤖 Bot con DeepSeek AI activo\n');
                reconnectAttempts = 0;
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.message || msg.key.fromMe) return;
                
                const from = msg.key.remoteJid;
                if (from?.includes('@g.us')) return;
                
                let messageText = msg.message.conversation || 
                                 msg.message.extendedTextMessage?.text || '';
                
                if (!messageText) return;
                
                console.log(`📩 Mensaje: ${messageText.substring(0, 50)}`);
                
                await sock.sendMessage(from, { text: '🫘 *PanBot está pensando...*' });
                const respuesta = await getDeepSeekResponse(messageText, from);
                await sock.sendMessage(from, { text: respuesta });
                
            } catch (error) {
                console.error('Error:', error);
            }
        });
        
    } catch (error) {
        console.error('❌ Error:', error);
        setTimeout(() => startBot(), 10000);
    }
}

console.log('🚀 Iniciando PanBot con Node.js 20...');
startBot();