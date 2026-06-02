const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// ============= CONFIGURACIÓN =============
const PORT = process.env.PORT || 10000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// Historial de conversaciones
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
                <p>Bot conectado a WhatsApp</p>
                <p>🤖 Usando DeepSeek AI</p>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

const server = app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
});

// ============= FUNCIÓN PARA DEEPSEEK =============
async function getDeepSeekResponse(userMessage, chatId) {
    try {
        if (!DEEPSEEK_API_KEY) {
            return "Lo siento, la API no está configurada. 🥖";
        }
        
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
            content: `Eres "PanBot", el asistente virtual de "Panadería El Buen Pan". 
            
            INFORMACIÓN:
            - Horarios: Lunes a Sábado 8am a 8pm, Domingos 9am a 1pm
            - Dirección: Av. Principal 123
            - Teléfono: 11-1234-5678
            
            PRODUCTOS Y PRECIOS:
            - Pan francés: $200 c/u | $2000 la docena
            - Pan integral: $500 el kg
            - Facturas: $150 c/u | $1500 la docena
            - Medialunas: $100 c/u
            - Tortas: desde $5000 (encargo 24hs)
            
            PROMOCIONES:
            - Martes: Medialunas 2x1
            - Jueves: Facturas 10% off
            - Sábados: Pan integral 15% off
            
            Responde en español, AMABLE y CONCISO. Usa emojis ocasionalmente 🥖`
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
        
        if (!response.ok) {
            console.error('Error DeepSeek:', data);
            return "Lo siento, estoy teniendo problemas técnicos. 🥖";
        }
        
        const botReply = data.choices[0].message.content;
        history.push({ role: "assistant", content: botReply });
        chatHistories.set(chatId, history);
        
        return botReply;
        
    } catch (error) {
        console.error("Error:", error);
        return "Lo siento, hubo un error. Intentá de nuevo. 🍞";
    }
}

// ============= CONFIGURACIÓN DE WHATSAPP CON BAILEYS =============
const authFolder = './auth_data';
if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder);
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['PanBot', 'Chrome', '120.0.0'],
        syncFullHistory: false
    });
    
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📱 ESCANEA ESTE QR CON WHATSAPP:');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada, reconectando:', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ ¡BOT CONECTADO A WHATSAPP!');
            console.log('🤖 Bot con DeepSeek activo');
        }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        const from = msg.key.remoteJid;
        if (from.includes('@g.us')) return; // Ignorar grupos
        
        const messageText = msg.message.conversation || 
                           msg.message.extendedTextMessage?.text || 
                           '';
        
        if (!messageText) return;
        
        console.log(`📩 Mensaje: ${messageText.substring(0, 50)}`);
        
        try {
            await sock.sendMessage(from, { text: '🫘 *PanBot está pensando...*' });
            const respuesta = await getDeepSeekResponse(messageText, from);
            await sock.sendMessage(from, { text: respuesta });
        } catch (error) {
            console.error('Error:', error);
            await sock.sendMessage(from, { text: 'Lo siento, hubo un error. Intentá de nuevo. 🥨' });
        }
    });
}

startBot();
console.log('🚀 Iniciando bot de WhatsApp + DeepSeek con Baileys...');