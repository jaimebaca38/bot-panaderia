import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode';
import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============= LIMPIAR SESIÓN =============
const authFolder = './auth_data';
const FORZAR_LIMPIEZA = true;  // Temporal: cambiar a false después de escanear QR

if (FORZAR_LIMPIEZA && fs.existsSync(authFolder)) {
    console.log('🗑️ LIMPIANDO SESIÓN CORRUPTA...');
    fs.rmSync(authFolder, { recursive: true, force: true });
    console.log('✅ Sesión eliminada');
}
if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder, { recursive: true });
}

// ============= CONFIGURACIÓN DEL NEGOCIO =============
const PORT = process.env.PORT || 10000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

const NEGOCIO = {
    nombre: "Panadería Delicias",
    direccion: "Angel Ibarcena Reynoso D1, Cerro Colorado 04014",
    referencia: "A una cuadra de la entrada a Urb. Buganvillas",
    maps: "https://maps.app.goo.gl/vJZ96jEq58RU4iqe7",
    telefono: "999555333",
    titularYape: "James Baca",
    horario: "Todos los días de 7am a 8pm"
};

const COSTO_DELIVERY = {
    "cerro colorado": 3.00,
    "cerca": 3.00,
    "alrededores": 5.00,
    "lejos": 8.00,
    "default": 5.00
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
                <p>🤖 Usando DeepSeek AI</p>
                <p>🥖 3 panes por S/1.00 | 🚚 Delivery</p>
            </div>
            <div class="qr-container">
                <p>📱 Escanea este QR con WhatsApp:</p>
                <img id="qrImg" class="qr-img" src="/qr-image" alt="Cargando QR...">
                <p>⏱️ Si no ves el QR, recarga la página</p>
            </div>
            <p><a href="/qr-image" target="_blank">🔗 Abrir QR en nueva pestaña</a></p>
            <p><a href="/qr-text" target="_blank">📝 Ver QR como texto</a></p>
        </body>
        </html>
    `);
});

app.get('/qr-image', async (req, res) => {
    if (currentQR) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(currentQR);
    } else {
        res.send(`
            <html>
            <body style="text-align:center; padding:50px;">
                <h2>🔄 Esperando QR...</h2>
                <p>El bot está iniciando. Espera unos segundos y recarga la página.</p>
                <meta http-equiv="refresh" content="5">
            </body>
            </html>
        `);
    }
});

app.get('/qr-text', (req, res) => {
    if (currentQR) {
        res.send(`
            <html>
            <body style="text-align:center; padding:50px;">
                <h2>📱 Código QR en texto</h2>
                <textarea rows="3" cols="60">${currentQR}</textarea>
                <p>Copia este texto en <a href="https://www.the-qrcode-generator.com/" target="_blank">generador QR</a></p>
            </body>
            </html>
        `);
    } else {
        res.send("Esperando QR...");
    }
});

app.get('/health', (req, res) => res.status(200).send('OK'));

app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`📱 QR visible en: http://localhost:${PORT}/qr-image`);
});

// ============= FUNCIONES =============
function esPreguntaUbicacion(mensaje) {
    const palabrasClave = ['dirección', 'ubicación', 'dónde están', 'cómo llegar', 'maps', 'dónde queda', 'en qué calle', 'ubicame', 'llegar', 'donde te encuentro', 'ubicacion', 'mapa', 'referencia', 'buganvillas'];
    const mensajeLower = mensaje.toLowerCase();
    return palabrasClave.some(palabra => mensajeLower.includes(palabra));
}

function esPreguntaPagos(mensaje) {
    const palabrasClave = ['pago', 'pagar', 'yape', 'efectivo', 'transferencia', 'tarjeta', 'costo', 'precio', 'cuánto', 'valor'];
    const mensajeLower = mensaje.toLowerCase();
    return palabrasClave.some(palabra => mensajeLower.includes(palabra));
}

function generarRespuestaUbicacion() {
    return `📍 *Dirección del negocio:*

🏠 ${NEGOCIO.nombre}
${NEGOCIO.direccion}
Referencia: ${NEGOCIO.referencia}

🗺️ Google Maps: ${NEGOCIO.maps}

📞 Teléfono: ${NEGOCIO.telefono}

🕐 Horario: ${NEGOCIO.horario}

🍞 ¡Te esperamos! 🥖`;
}

function generarRespuestaPagos() {
    return `💵 *Métodos de pago:*

✅ *Yape:* ${NEGOCIO.telefono} (${NEGOCIO.titularYape})
✅ *Efectivo:* En nuestra tienda

🎁 *Promoción:* 3 panes por S/1.00

🚚 *Delivery:* Consulta costo según tu zona`;
}

function detectarCantidadYPrecio(mensaje) {
    const numeros = mensaje.match(/\d+/g);
    if (!numeros) return null;
    
    let cantidad = parseInt(numeros[0]);
    if (isNaN(cantidad) || cantidad <= 0) return null;
    
    const precioTotal = (cantidad / 3).toFixed(2);
    
    return {
        cantidad: cantidad,
        precio: parseFloat(precioTotal),
        precioFormateado: `S/ ${precioTotal}`
    };
}

function calcularCostoDelivery(zona) {
    const zonaLower = zona.toLowerCase();
    for (const [key, costo] of Object.entries(COSTO_DELIVERY)) {
        if (zonaLower.includes(key)) {
            return costo;
        }
    }
    return COSTO_DELIVERY.default;
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
            content: `Eres "PanBot", asistente de "${NEGOCIO.nombre}".

INFORMACIÓN DEL NEGOCIO:
- Dirección: ${NEGOCIO.direccion}
- Referencia: ${NEGOCIO.referencia}
- Horario: ${NEGOCIO.horario}
- Teléfono: ${NEGOCIO.telefono}
- Yape: ${NEGOCIO.telefono} (${NEGOCIO.titularYape})

PRECIOS:
- 3 panes por S/1.00 (cualquier variedad)

VARIEDADES DE PAN:
${VARIEDADES_PANES.map(p => `- ${p}`).join('\n')}

DELIVERY:
- Preguntar la dirección del cliente
- Calcular costo según zona
- Total = (panes/3) + delivery

Responde SIEMPRE en español, amable, con emojis 🥖`
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
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('\n📱 NUEVO QR GENERADO');
                console.log('🌐 Para escanearlo, abre:');
                console.log(`   https://bot-panaderia.onrender.com/qr-image`);
                console.log('⏱️ El QR expira en 20 segundos.\n');
                
                try {
                    const qrImageBuffer = await qrcode.toBuffer(qr, { type: 'png', margin: 2, width: 400 });
                    currentQR = qrImageBuffer;
                    console.log('✅ QR guardado en memoria');
                } catch (err) {
                    console.error('Error generando QR:', err);
                }
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
                console.log(`🥖 ${NEGOCIO.nombre} - 3 panes por S/1.00`);
                console.log('🚚 Delivery disponible\n');
                reconnectAttempts = 0;
                currentQR = null;
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
                
                if (!messageText || messageText.trim().length === 0) return;
                
                console.log(`\n📩 Mensaje: ${messageText.substring(0, 50)}`);
                
                if (esPreguntaUbicacion(messageText)) {
                    await sock.sendMessage(from, { text: generarRespuestaUbicacion() });
                    return;
                }
                
                if (esPreguntaPagos(messageText)) {
                    await sock.sendMessage(from, { text: generarRespuestaPagos() });
                    return;
                }
                
                const pedidoInfo = detectarCantidadYPrecio(messageText);
                if (pedidoInfo && (messageText.toLowerCase().includes('pan') || messageText.toLowerCase().includes('quiero') || messageText.toLowerCase().includes('dame'))) {
                    console.log(`🧮 Pedido: ${pedidoInfo.cantidad} panes = ${pedidoInfo.precioFormateado}`);
                    
                    conversaciones.set(from, {
                        estado: 'esperando_direccion',
                        cantidad: pedidoInfo.cantidad,
                        precioPanes: pedidoInfo.precio
                    });
                    
                    let respuesta = `🥖 *Pedido: ${pedidoInfo.cantidad} panes*\n`;
                    respuesta += `💰 *Subtotal:* ${pedidoInfo.precioFormateado} (${pedidoInfo.cantidad} ÷ 3)\n\n`;
                    respuesta += `🚚 *¿Quieres delivery o lo pasas a recoger?*\n`;
                    respuesta += `📍 *Para recoger:* ${NEGOCIO.direccion}\n`;
                    respuesta += `🚚 *Para delivery:* Envíame tu dirección`;
                    
                    await sock.sendMessage(from, { text: respuesta });
                    return;
                }
                
                const conversacion = conversaciones.get(from);
                if (conversacion && conversacion.estado === 'esperando_direccion' && messageText.length > 10) {
                    const costoDelivery = calcularCostoDelivery(messageText);
                    const totalFinal = conversacion.precioPanes + costoDelivery;
                    
                    let respuesta = `✅ *Dirección recibida*\n\n`;
                    respuesta += `🚚 *Costo delivery:* S/ ${costoDelivery.toFixed(2)}\n`;
                    respuesta += `🍞 *Panes:* S/ ${conversacion.precioPanes.toFixed(2)}\n`;
                    respuesta += `💰 *TOTAL:* S/ ${totalFinal.toFixed(2)}\n\n`;
                    respuesta += `📞 *Confirma tu pedido?* (responde "Confirmo")\n`;
                    respuesta += `💳 *Pago:* Yape al ${NEGOCIO.telefono} o efectivo`;
                    
                    conversacion.estado = 'esperando_confirmacion';
                    conversacion.total = totalFinal;
                    conversaciones.set(from, conversacion);
                    
                    await sock.sendMessage(from, { text: respuesta });
                    return;
                }
                
                if (conversacion && conversacion.estado === 'esperando_confirmacion' && 
                    (messageText.toLowerCase().includes('confirmo') || messageText.toLowerCase().includes('si'))) {
                    
                    let respuesta = `🎉 *¡PEDIDO CONFIRMADO!* 🎉\n\n`;
                    respuesta += `📦 *Detalles:*\n`;
                    respuesta += `🍞 ${conversacion.cantidad} panes\n`;
                    respuesta += `💰 Total: S/ ${conversacion.total.toFixed(2)}\n\n`;
                    respuesta += `⏱️ *Entrega:* 30-45 min\n`;
                    respuesta += `💳 *Pago:* Yape al ${NEGOCIO.telefono}\n\n`;
                    respuesta += `🥖 ¡Gracias por tu pedido! 🥖`;
                    
                    conversaciones.delete(from);
                    await sock.sendMessage(from, { text: respuesta });
                    return;
                }
                
                await sock.sendMessage(from, { text: '🫘 *PanBot está pensando...*' });
                const respuesta = await getDeepSeekResponse(messageText, from);
                await sock.sendMessage(from, { text: respuesta });
                
            } catch (error) {
                console.error('❌ Error:', error);
            }
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
console.log(`📱 QR visible en: https://bot-panaderia.onrender.com/qr-image\n`);

startBot();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));