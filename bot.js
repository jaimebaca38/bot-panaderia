import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// ============= LIMPIAR SESIÓN =============
const authFolder = './auth_data';
const FORZAR_LIMPIEZA = true;  // Cambiar a true solo si hay problemas de conexión

if (FORZAR_LIMPIEZA && fs.existsSync(authFolder)) {
    console.log('🗑️ LIMPIANDO SESIÓN CORRUPTA...');
    fs.rmSync(authFolder, { recursive: true, force: true });
    console.log('✅ Sesión eliminada');
}
if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder, { recursive: true });
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
                .info { margin-top: 20px; color: #666; }
            </style>
        </head>
        <body>
            <h1>🥖 PanBot - Panadería El Buen Pan</h1>
            <div class="status">
                <p>Estado: <span class="online">✅ ONLINE</span></p>
                <p>🤖 Usando DeepSeek AI</p>
                <p>📱 WhatsApp conectado</p>
            </div>
            <div class="info">
                <p>Envía un mensaje a este número para probar el bot</p>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/api/stats', (req, res) => {
    res.json({
        status: 'running',
        conversations: chatHistories.size,
        uptime: process.uptime(),
        timestamp: Date.now()
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
});

// ============= FUNCIÓN DEEPSEEK CORREGIDA =============
async function getDeepSeekResponse(userMessage, chatId) {
    try {
        // Verificar API key
        if (!DEEPSEEK_API_KEY) {
            console.error('❌ DEEPSEEK_API_KEY no está configurada');
            return "🔧 Lo siento, la API no está configurada correctamente. Contacta al administrador. 🥖";
        }
        
        console.log(`🤖 Enviando a DeepSeek: "${userMessage.substring(0, 50)}..."`);
        
        // Inicializar historial si no existe
        if (!chatHistories.has(chatId)) {
            chatHistories.set(chatId, []);
        }
        
        let history = chatHistories.get(chatId);
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
- Responde siempre en menos de 500 caracteres`
        };
        
        const messages = [systemMessage, ...history];
        
        console.log(`📤 Enviando ${messages.length} mensajes a DeepSeek API`);
        
        // Llamada a la API de DeepSeek
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
        
        // Verificar respuesta
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ DeepSeek API error ${response.status}: ${errorText}`);
            
            if (response.status === 401) {
                return "🔑 La clave de API de DeepSeek no es válida. Por favor, contacta al administrador.";
            } else if (response.status === 429) {
                return "📊 Demasiadas solicitudes. Espera un momento y vuelve a intentar. 🥖";
            } else if (response.status === 500) {
                return "⚠️ El servidor de DeepSeek tiene problemas. Intentá de nuevo en unos minutos. 🍞";
            } else {
                return `Lo siento, la API de DeepSeek tiene problemas (${response.status}). Intentá de nuevo en unos momentos. 🥨`;
            }
        }
        
        const data = await response.json();
        
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('❌ Respuesta inesperada de DeepSeek:', data);
            return "Recibí una respuesta inesperada de la IA. Intentá de nuevo. 🥨";
        }
        
        const botReply = data.choices[0].message.content;
        
        // Guardar respuesta en historial
        history.push({ role: "assistant", content: botReply });
        chatHistories.set(chatId, history);
        
        console.log(`✅ Respuesta de DeepSeek: "${botReply.substring(0, 50)}..."`);
        
        return botReply;
        
    } catch (error) {
        console.error("❌ Error en DeepSeek:", error.message);
        return "Lo siento, hubo un error de conexión con la IA. Intentá de nuevo en unos momentos. 🍞";
    }
}

// ============= WHATSAPP CON BAILEYS =============
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

async function startBot() {
    try {
        // Obtener la última versión de WhatsApp Web
        const { version } = await fetchLatestBaileysVersion();
        console.log(`📱 Usando versión de WhatsApp: ${version}`);
        
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        const sock = makeWASocket({
            auth: state,
            version: version,
            browser: ['PanBot', 'Chrome', '120.0.0'],
            syncFullHistory: false,
            printQRInTerminal: false,
            keepAliveIntervalMs: 30000,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
        });
        
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('\n📱 ESCANEA ESTE QR CON WHATSAPP:');
                console.log('⚠️  IMPORTANTE: Ajusta el zoom de tu cámara o aléjala/acércala hasta que lo detecte.\n');
                
                // Generar QR en tamaño grande
                qrcode.generate(qr, { small: false });
                
                // Mostrar enlace alternativo por si el QR no se ve bien
                console.log('\n🔗 SI EL QR NO FUNCIONA, USA ESTE ENLACE:');
                console.log(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`);
                
                console.log('\n⏱️  El QR expira en 20 segundos. Si no alcanzas, espera a que se genere uno nuevo.\n');
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
                } else {
                    console.log('❌ Máximos reintentos alcanzados. Verifica tu conexión a internet.');
                }
            } else if (connection === 'open') {
                console.log('\n✅ ¡BOT CONECTADO A WHATSAPP!');
                console.log('🤖 Bot con DeepSeek AI activo');
                console.log('🎉 El bot ya está listo para responder mensajes\n');
                reconnectAttempts = 0;
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg.message || msg.key.fromMe) return;
                
                const from = msg.key.remoteJid;
                if (from?.includes('@g.us')) {
                    console.log('👥 Mensaje de grupo ignorado');
                    return;
                }
                
                let messageText = msg.message.conversation || 
                                 msg.message.extendedTextMessage?.text || '';
                
                if (!messageText || messageText.trim().length === 0) return;
                
                console.log(`\n📩 Mensaje de ${from}: ${messageText.substring(0, 50)}`);
                
                // Enviar indicador de escritura
                await sock.sendMessage(from, { text: '🫘 *PanBot está pensando...*' });
                
                // Obtener respuesta de DeepSeek
                const respuesta = await getDeepSeekResponse(messageText, from);
                
                // Limitar respuesta a 2000 caracteres (límite de WhatsApp)
                const respuestaFinal = respuesta.length > 2000 ? respuesta.substring(0, 1997) + '...' : respuesta;
                
                // Enviar respuesta
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
        
        sock.ev.on('error', (error) => {
            console.error('❌ Error en socket:', error);
        });
        
    } catch (error) {
        console.error('❌ Error iniciando bot:', error);
        console.log('🔄 Reiniciando el bot en 10 segundos...');
        setTimeout(() => startBot(), 10000);
    }
}

// ============= INICIAR EL BOT =============
console.log('\n🚀 Iniciando PanBot con DeepSeek...');
console.log(`📅 Versión de Node: ${process.version}`);
console.log(`🔧 Entorno: ${process.env.NODE_ENV === 'production' ? 'PRODUCCIÓN (Render)' : 'DESARROLLO (Local)'}`);
console.log('📱 Conectando con WhatsApp...\n');

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