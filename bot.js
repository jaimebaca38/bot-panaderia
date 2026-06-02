const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

// ============= CONFIGURACIÓN =============
const PORT = process.env.PORT || 10000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// Historial de conversaciones (recuerda contexto)
const chatHistories = new Map();
const MAX_HISTORY = 20;

// ============= SERVIDOR WEB =============
const app = express();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/api', (req, res) => {
    res.json({
        status: 'running',
        timestamp: Date.now()
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
});

// ============= FUNCIÓN PARA HABLAR CON DEEPSEEK =============
async function getDeepSeekResponse(userMessage, chatId) {
    try {
        // Obtener o crear historial para este chat
        if (!chatHistories.has(chatId)) {
            chatHistories.set(chatId, []);
        }
        
        let history = chatHistories.get(chatId);
        
        // Agregar mensaje del usuario al historial
        history.push({ role: "user", content: userMessage });
        
        // Mantener solo los últimos mensajes
        if (history.length > MAX_HISTORY) {
            history = history.slice(-MAX_HISTORY);
        }
        
        // Mensaje del sistema (personaliza para tu panadería)
        const systemMessage = {
            role: "system",
            content: `Eres "PanBot", el asistente virtual de "Panadería El Buen Pan". 
            
            INFORMACIÓN DE LA PANADERÍA:
            - Horarios: Lunes a Sábado 8am a 8pm, Domingos 9am a 1pm
            - Dirección: Av. Principal 123 (a media cuadra de la plaza)
            - Teléfono: 11-1234-5678
            
            PRODUCTOS Y PRECIOS:
            - Pan francés: $200 c/u | $2000 la docena
            - Pan integral: $500 el kg
            - Facturas (pastelitos): $150 c/u | $1500 la docena
            - Medialunas: $100 c/u (dulces o saladas)
            - Tortas: desde $5000 (encargo con 24hs de anticipación)
            - Bizcochos: $300 el kg
            
            PROMOCIONES:
            - Martes de medialunas: 2x1
            - Jueves de facturas: 10% off
            - Sábados: Pan integral 15% off
            
            INSTRUCCIONES:
            - Responde en español, AMABLE y CONCISO
            - Usa emojis ocasionalmente 🥖🍞🥐
            - Si te preguntan por precios, dá los actualizados
            - Si es un pedido, indica que pueden pasar a retirar
            - Si no sabes algo, ofrece pasar el contacto de la panadería`
        };
        
        const messages = [systemMessage, ...history];
        
        console.log(`🤖 Consultando a DeepSeek...`);
        
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
            console.error('Error de DeepSeek:', data);
            return "Lo siento, estoy teniendo problemas técnicos. Intentá de nuevo en unos momentos 🥖";
        }
        
        const botReply = data.choices[0].message.content;
        
        // Guardar respuesta en historial
        history.push({ role: "assistant", content: botReply });
        chatHistories.set(chatId, history);
        
        return botReply;
        
    } catch (error) {
        console.error("Error:", error);
        return "Lo siento, hubo un error. Por favor, intentá de nuevo. 🍞";
    }
}

// ============= CONFIGURACIÓN DE WHATSAPP =============
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './auth_data'
    }),
    puppeteer: {
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Generar QR
client.on('qr', (qr) => {
    console.log('📱 ESCANEA ESTE QR CON WHATSAPP:');
    qrcode.generate(qr, { small: true });
});

// Cuando el bot está listo
client.on('ready', () => {
    console.log('✅ ¡BOT CONECTADO A WHATSAPP!');
    console.log('🤖 Bot inteligente con DeepSeek activo');
});

// Manejar mensajes
client.on('message', async (message) => {
    // Ignorar mensajes de grupos
    if (message.from.includes('@g.us')) return;
    
    // Ignorar mensajes propios
    if (message.fromMe) return;
    
    const mensaje = message.body;
    const chatId = message.from;
    
    console.log(`📩 Mensaje: ${mensaje.substring(0, 50)}`);
    
    try {
        // Mostrar que el bot está escribiendo
        await message.reply('🫘 *PanBot está pensando...*');
        
        // Obtener respuesta de DeepSeek
        const respuesta = await getDeepSeekResponse(mensaje, chatId);
        
        // Enviar respuesta
        await client.sendMessage(chatId, respuesta);
        
    } catch (error) {
        console.error('Error:', error);
        await client.sendMessage(chatId, 'Lo siento, hubo un error. Intentá de nuevo. 🥨');
    }
});

// Inicializar el bot
client.initialize();

console.log('🚀 Iniciando bot de WhatsApp + DeepSeek...');