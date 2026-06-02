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
                .info { margin-top: 20px; color: #666; }
            </style>
        </head>
        <body>
            <h1>🥖 PanBot - Panadería El Buen Pan</h1>
            <div class="status">
                <p>Estado: <span class="online">✅ ONLINE</span></p>
                <p>Bot conectado a WhatsApp</p>
                <p>🤖 Usando DeepSeek AI</p>
            </div>
            <div class="info">
                <p>Envía un mensaje a este número para probar el bot</p>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.get('/api', (req, res) => {
    res.json({
        status: 'running',
        timestamp: Date.now(),
        conversations: chatHistories.size
    });
});

const server = app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

// Mantener servidor activo
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;

// ============= FUNCIÓN PARA DEEPSEEK =============
async function getDeepSeekResponse(userMessage, chatId) {
    try {
        if (!DEEPSEEK_API_KEY) {
            console.error('❌ DEEPSEEK_API_KEY no configurada');
            return "Lo siento, la API no está configurada correctamente. 🥖";
        }
        
        // Obtener o crear historial para este chat
        if (!chatHistories.has(chatId)) {
            chatHistories.set(chatId, []);
        }
        
        let history = chatHistories.get(chatId);
        
        // Agregar mensaje del usuario
        history.push({ role: "user", content: userMessage });
        
        // Mantener solo los últimos mensajes
        if (history.length > MAX_HISTORY) {
            history = history.slice(-MAX_HISTORY);
        }
        
        // Mensaje del sistema (personalizado para la panadería)
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
            - Si te preguntan por precios, da los actualizados
            - Si es un pedido, indica que pueden pasar a retirar
            - Si no sabes algo, ofrece pasar el contacto de la panadería
            - Responde siempre en menos de 500 caracteres si es posible`
        };
        
        const messages = [systemMessage, ...history];
        
        console.log(`🤖 Consultando a DeepSeek para ${chatId}...`);
        
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
        console.error("Error en DeepSeek:", error);
        return "Lo siento, hubo un error. Por favor, intentá de nuevo. 🍞";
    }
}

// ============= CONFIGURACIÓN DE WHATSAPP CON BAILEYS =============
const authFolder = './auth_data';

// Crear carpeta de autenticación si no existe
if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder, { recursive: true });
}

async function startBot() {
    try {
        // Cargar estado de autenticación
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        // Crear conexión de WhatsApp
        const sock = makeWASocket({
            auth: state,
            browser: ['PanBot', 'Chrome', '120.0.0'],
            syncFullHistory: false,
            printQRInTerminal: false, // Deshabilitado para manejo manual
            patchMessageBeforeSending: (message) => {
                const requiresPatch = !!(
                    message.buttonsMessage ||
                    message.templateMessage ||
                    message.listMessage
                );
                if (requiresPatch) {
                    message = {
                        viewOnceMessage: {
                            message: {
                                messageContextInfo: {
                                    deviceListMetadataVersion: 2,
                                    deviceListMetadata: {},
                                },
                                ...message,
                            },
                        },
                    };
                }
                return message;
            },
        });
        
        // Manejar eventos de conexión (incluyendo QR)
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            // Mostrar QR cuando llegue
            if (qr) {
                console.log('\n📱 ESCANEA ESTE QR CON WHATSAPP:');
                console.log('⚠️  El QR expira en 20 segundos. Escanéalo rápido.\n');
                qrcode.generate(qr, { small: true });
                console.log('\n🔄 Si no funciona, espera 10 segundos y aparecerá un nuevo QR\n');
            }
            
            // Manejar estado de conexión
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log('❌ Conexión cerrada. Código:', statusCode);
                
                if (shouldReconnect) {
                    console.log('🔄 Intentando reconectar en 5 segundos...');
                    setTimeout(() => {
                        startBot();
                    }, 5000);
                } else {
                    console.log('🔒 Sesión cerrada. Elimina la carpeta auth_data y reinicia.');
                }
            } else if (connection === 'open') {
                console.log('\n✅ ¡BOT CONECTADO A WHATSAPP!');
                console.log('🤖 Bot con DeepSeek AI activo');
                console.log(`📊 Memoria RAM usada: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
                console.log('🎉 El bot ya está listo para responder mensajes\n');
            }
        });
        
        // Guardar credenciales cuando se actualicen
        sock.ev.on('creds.update', saveCreds);
        
        // Manejar mensajes entrantes
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.message || msg.key.fromMe) return;
                
                const from = msg.key.remoteJid;
                
                // Ignorar mensajes de grupos
                if (from && from.includes('@g.us')) {
                    console.log('👥 Mensaje de grupo ignorado');
                    return;
                }
                
                // Obtener texto del mensaje
                let messageText = '';
                if (msg.message.conversation) {
                    messageText = msg.message.conversation;
                } else if (msg.message.extendedTextMessage?.text) {
                    messageText = msg.message.extendedTextMessage.text;
                } else {
                    return; // Ignorar mensajes sin texto (imágenes, stickers, etc.)
                }
                
                if (!messageText || messageText.trim().length === 0) return;
                
                console.log(`\n📩 Mensaje de ${from}: ${messageText.substring(0, 50)}`);
                
                // Enviar indicador de escritura
                await sock.sendMessage(from, { text: '🫘 *PanBot está pensando...*' });
                
                // Obtener respuesta de DeepSeek
                const respuesta = await getDeepSeekResponse(messageText, from);
                
                // Enviar respuesta (limitada a 2000 caracteres por WhatsApp)
                const respuestaFinal = respuesta.length > 2000 ? respuesta.substring(0, 1997) + '...' : respuesta;
                await sock.sendMessage(from, { text: respuestaFinal });
                
                console.log(`✅ Respuesta enviada a ${from}`);
                
            } catch (error) {
                console.error('❌ Error al procesar mensaje:', error);
                if (m?.messages[0]?.key?.remoteJid) {
                    await sock.sendMessage(m.messages[0].key.remoteJid, { 
                        text: 'Lo siento, hubo un error al procesar tu mensaje. Intentá de nuevo en unos momentos. 🥨' 
                    });
                }
            }
        });
        
        // Manejar errores de conexión
        sock.ev.on('error', (error) => {
            console.error('❌ Error en la conexión:', error);
        });
        
    } catch (error) {
        console.error('❌ Error al iniciar el bot:', error);
        console.log('🔄 Reiniciando el bot en 10 segundos...');
        setTimeout(() => {
            startBot();
        }, 10000);
    }
}

// ============= INICIAR EL BOT =============
console.log('🚀 Iniciando bot de WhatsApp + DeepSeek con Baileys...');
console.log(`🔧 Entorno: ${process.env.NODE_ENV === 'production' ? 'PRODUCCIÓN (Render)' : 'DESARROLLO (Local)'}`);
console.log('📱 Esperando conexión con WhatsApp...\n');

startBot();

// Manejar cierre graceful
process.on('SIGINT', async () => {
    console.log('\n🛑 Apagando el bot...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Apagando el bot...');
    process.exit(0);
});