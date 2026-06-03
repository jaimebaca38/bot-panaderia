import pkg from '@whiskeysockets/baileys';
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = pkg;
import qrcode from 'qrcode';
import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// ============= CONFIGURACIÓN =============
const authFolder = './auth_data';
const PORT = process.env.PORT || 10000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// Datos del negocio
const NEGOCIO = {
    nombre: "Panadería Delicias",
    direccion: "Angel Ibarcena Reynoso D1, Cerro Colorado 04014",
    referencia: "A una cuadra de la entrada a Urb. Buganvillas",
    maps: "https://maps.app.goo.gl/vJZ96jEq58RU4iqe7",
    telefono: "999555333",
    titularYape: "James Baca",
    horario: "Todos los días de 7am a 8pm"
};

const VARIEDADES_PANES = [
    "Pan de Molde", "Pan de Tres Puntas", "Pan Integral",
    "Pan de Yema", "Pan Carioco", "Pan Lulo",
    "Pan de Aceituna", "Pan Baguette", "Pan Ciabatta",
    "Pan Francés", "Pan Especial"
];

const conversaciones = new Map();
const chatHistories = new Map();
const MAX_HISTORY = 20;

let currentQR = null;
let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// ============= SERVIDOR WEB =============
const app = express();

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>PanBot - ${NEGOCIO.nombre}</title>
            <meta charset="UTF-8">
            <meta http-equiv="refresh" content="10">
            <style>
                body { font-family: Arial; text-align: center; padding: 50px; background: #f5e6d3; }
                h1 { color: #8B4513; }
                .status { padding: 20px; background: white; border-radius: 10px; display: inline-block; }
                .online { color: green; font-weight: bold; }
                .qr-container { margin-top: 30px; padding: 20px; background: white; border-radius: 10px; display: inline-block; }
                .qr-img { max-width: 300px; border: 1px solid #ddd; }
            </style>
        </head>
        <body>
            <h1>🥖 PanBot - ${NEGOCIO.nombre}</h1>
            <div class="status">
                <p>Estado: <span class="online">✅ ONLINE</span></p>
                <p>🥖 3 panes por S/1.00 | 🚚 Delivery</p>
            </div>
            <div class="qr-container">
                <p>📱 Escanea este QR con WhatsApp:</p>
                <img id="qrImg" class="qr-img" src="/qr-image" alt="Cargando QR...">
            </div>
            <p><a href="/qr-image" target="_blank">🔗 Abrir QR en nueva pestaña</a></p>
        </body>
        </html>
    `);
});

app.get('/qr-image', async (req, res) => {
    if (currentQR) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(currentQR);
    } else {
        res.send("🔄 Esperando QR... Recarga la página en unos segundos.");
    }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
});

// ============= FUNCIONES DE RESPUESTA =============
function esPreguntaUbicacion(mensaje) {
    const palabrasClave = ['dirección', 'ubicación', 'dónde están', 'cómo llegar', 'maps', 'dónde queda', 'ubicacion', 'mapa', 'referencia', 'buganvillas'];
    return palabrasClave.some(palabra => mensaje.toLowerCase().includes(palabra));
}

function esPreguntaPagos(mensaje) {
    const palabrasClave = ['pago', 'pagar', 'yape', 'efectivo', 'precio', 'cuánto', 'costo'];
    return palabrasClave.some(palabra => mensaje.toLowerCase().includes(palabra));
}

function generarRespuestaUbicacion() {
    return `📍 *Dirección:*\n${NEGOCIO.direccion}\n\nReferencia: ${NEGOCIO.referencia}\n\n🗺️ Google Maps: ${NEGOCIO.maps}\n\n📞 Teléfono: ${NEGOCIO.telefono}\n\n🕐 Horario: ${NEGOCIO.horario}`;
}

function generarRespuestaPagos() {
    return `💵 *Métodos de pago:*\n\n✅ Yape: ${NEGOCIO.telefono} (${NEGOCIO.titularYape})\n✅ Efectivo en tienda\n\n🎁 Promoción: 3 panes por S/1.00`;
}

function detectarCantidad(mensaje) {
    const numeros = mensaje.match(/\d+/g);
    if (!numeros) return null;
    const cantidad = parseInt(numeros[0]);
    if (isNaN(cantidad) || cantidad <= 0) return null;
    const precioTotal = (cantidad / 3).toFixed(2);
    return { cantidad, precio: parseFloat(precioTotal), precioFormateado: `S/ ${precioTotal}` };
}

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
            content: `Eres "PanBot" de "${NEGOCIO.nombre}". Precio: 3 panes por S/1.00. Variedades: ${VARIEDADES_PANES.join(', ')}. Dirección: ${NEGOCIO.direccion}. Horario: ${NEGOCIO.horario}. Yape: ${NEGOCIO.telefono}. Responde amable, en español, con emojis 🥖`
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

// ============= LÓGICA PRINCIPAL DE WHATSAPP =============
async function startBot() {
    try {
        console.log('🔄 Inicializando sesión...');
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        sock = makeWASocket({
            auth: state,
            browser: ['PanBot', 'Chrome', '120.0.0'],
            syncFullHistory: false,
            printQRInTerminal: false,
            keepAliveIntervalMs: 30000,
        });
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            // --- Manejo del QR ---
            if (qr) {
                console.log('📱 Nuevo QR generado');
                try {
                    const qrImageBuffer = await qrcode.toBuffer(qr, { type: 'png', margin: 2, width: 400 });
                    currentQR = qrImageBuffer;
                    console.log('✅ QR listo en /qr-image');
                } catch (err) {
                    console.error('Error generando QR:', err);
                }
                reconnectAttempts = 0;
            }
            
            // --- Manejo de cierre de conexión ---
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`❌ Conexión cerrada. Código: ${statusCode}`);
                
                // Código 515: ¡Requiere reinicio completo!
                if (statusCode === 515) {
                    console.log('🔄 Código 515 detectado: Reiniciando la conexión automáticamente...');
                    
                    // CRÍTICO: Esperar 5 segundos antes de reintentar para asegurar que los datos se guarden
                    setTimeout(() => {
                        startBot();
                    }, 5000);
                    return;
                }
                
                // Código 401 o 405: Sesión corrupta o inválida
                if (statusCode === 401 || statusCode === 405) {
                    console.log('🗑️ Error de autenticación. Eliminando sesión corrupta...');
                    if (fs.existsSync(authFolder)) {
                        fs.rmSync(authFolder, { recursive: true, force: true });
                    }
                    console.log('✅ Sesión eliminada. Reiniciando...');
                    setTimeout(() => startBot(), 3000);
                    return;
                }
                
                // Reconexión genérica con backoff
                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    const delay = Math.min(5000 * reconnectAttempts, 30000);
                    console.log(`🔄 Reintento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} en ${delay/1000}s...`);
                    setTimeout(() => startBot(), delay);
                } else {
                    console.log('❌ Máximos reintentos alcanzados. Por favor, reinicia manualmente.');
                }
            } 
            
            // --- Conexión exitosa ---
            else if (connection === 'open') {
                console.log('\n✅ ¡BOT CONECTADO A WHATSAPP!');
                console.log(`🥖 ${NEGOCIO.nombre} - 3 panes por S/1.00`);
                console.log('🚚 Delivery disponible\n');
                reconnectAttempts = 0;
                currentQR = null; // QR ya no es necesario
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
                if (from?.includes('@g.us')) return;
                
                let messageText = msg.message.conversation || 
                                 msg.message.extendedTextMessage?.text || '';
                
                if (!messageText || messageText.trim().length === 0) return;
                
                console.log(`📩 Mensaje: ${messageText.substring(0, 50)}`);
                
                // Respuestas directas (sin depender de DeepSeek para estas)
                if (esPreguntaUbicacion(messageText)) {
                    await sock.sendMessage(from, { text: generarRespuestaUbicacion() });
                    return;
                }
                
                if (esPreguntaPagos(messageText)) {
                    await sock.sendMessage(from, { text: generarRespuestaPagos() });
                    return;
                }
                
                const pedido = detectarCantidad(messageText);
                if (pedido && messageText.toLowerCase().includes('pan')) {
                    let respuesta = `🥖 *${pedido.cantidad} panes* = ${pedido.precioFormateado}\n`;
                    respuesta += `📋 Variedades: ${VARIEDADES_PANES.slice(0, 5).join(', ')}\n\n`;
                    respuesta += `📍 Retiro: ${NEGOCIO.direccion}\n`;
                    respuesta += `🚚 Delivery: Envíame tu dirección para calcular costo`;
                    await sock.sendMessage(from, { text: respuesta });
                    return;
                }
                
                // Respuesta con IA
                await sock.sendMessage(from, { text: '🫘 *PanBot está pensando...*' });
                const respuesta = await getDeepSeekResponse(messageText, from);
                await sock.sendMessage(from, { text: respuesta });
                
            } catch (error) {
                console.error('❌ Error en mensaje:', error);
            }
        });
        
        sock.ev.on('error', (error) => {
            console.error('❌ Error en socket:', error);
        });
        
    } catch (error) {
        console.error('❌ Error iniciando bot:', error);
        setTimeout(() => startBot(), 10000);
    }
}

// ============= KEEP ALIVE =============
setInterval(() => {
    fetch(`http://localhost:${PORT}/health`).catch(() => {});
}, 14 * 60 * 1000);

// ============= INICIAR =============
console.log('\n🚀 Iniciando PanBot...');
console.log(`🥖 ${NEGOCIO.nombre}`);
console.log(`📱 QR: https://bot-panaderia.onrender.com/qr-image\n`);

startBot();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));