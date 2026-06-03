import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
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
const FORZAR_LIMPIEZA = false;

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

// Datos de la panadería
const NEGOCIO = {
    nombre: "Panadería Delicias",
    direccion: "Angel Ibarcena Reynoso D1, Cerro Colorado 04014",
    referencia: "A una cuadra de la entrada a Urb. Buganvillas",
    maps: "https://maps.app.goo.gl/vJZ96jEq58RU4iqe7",
    telefono: "999555333",
    titularYape: "James Baca",
    horario: "Todos los días de 7am a 8pm"
};

// Costo de delivery por zona
const COSTO_DELIVERY = {
    "cerro colorado": 3.00,
    "cerca": 3.00,
    "alrededores": 5.00,
    "lejos": 8.00,
    "default": 5.00
};

// Variedades de pan
const VARIEDADES_PANES = [
    "Pan de Molde", "Pan de Tres Puntas", "Pan Integral",
    "Pan de Yema", "Pan Carioco", "Pan Lulo",
    "Pan de Aceituna", "Pan Baguette", "Pan Ciabatta",
    "Pan Francés", "Pan Especial"
];

// Almacenar datos de conversación por cliente
const conversaciones = new Map();
const chatHistories = new Map();
const MAX_HISTORY = 20;

// Variable global para guardar el QR temporalmente
let currentQR = null;

// ============= SERVIDOR WEB =============
const app = express();

// Dashboard principal
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>PanBot - ${NEGOCIO.nombre}</title>
            <meta charset="UTF-8">
            <meta http-equiv="refresh" content="5">
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
            <div class="qr-container" id="qrContainer">
                <p>📱 Escanea este QR con WhatsApp:</p>
                <img id="qrImg" class="qr-img" src="/qr-image" alt="Cargando QR...">
                <p>⏱️ El QR se actualiza automáticamente si expira</p>
            </div>
            <p><a href="/qr-image" target="_blank">🔗 Abrir QR en nueva pestaña</a></p>
        </body>
        </html>
    `);
});

// Endpoint para obtener la imagen del QR
app.get('/qr-image', (req, res) => {
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

// Endpoint para obtener el QR en texto (alternativa)
app.get('/qr-text', (req, res) => {
    if (currentQR) {
        res.send(`
            <html>
            <body style="text-align:center; padding:50px;">
                <h2>📱 Código QR para WhatsApp</h2>
                <p>Si la imagen no funciona, copia este texto en un generador QR externo:</p>
                <textarea rows="5" cols="50">${currentQR}</textarea>
                <p><a href="https://www.the-qrcode-generator.com/" target="_blank">Abrir generador QR</a></p>
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

// ============= FUNCIONES DE UTILIDAD =============
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
✅ *Transferencia:* Consultar por WhatsApp

🎁 *Promoción:* 3 panes por S/1.00

🚚 *Delivery:* Consulta costo según tu zona`;
}

function detectarCantidadYPrecio(mensaje) {
    const numeros = mensaje.match(/\d+/g);
    if (!numeros) return null;
    
    let cantidad = parseInt(numeros[0]);
    if (isNaN(cantidad) || cantidad <= 0) return null;
    
    const precioTotal = (cantidad / 3).toFixed(2);
    const esPedidoGrande = cantidad >= 30;
    
    return {
        cantidad: cantidad,
        precio: parseFloat(precioTotal),
        precioFormateado: `S/ ${precioTotal}`,
        esPedidoGrande: esPedidoGrande
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
            content: `Eres "PanBot", asistente de "${NEGOCIO.nombre}".

INFORMACIÓN DEL NEGOCIO:
- Dirección: ${NEGOCIO.direccion}
- Referencia: ${NEGOCIO.referencia}
- Horario: ${NEGOCIO.horario}
- Teléfono: ${NEGOCIO.telefono}
- Yape: ${NEGOCIO.telefono} (${NEGOCIO.titularYape})

PRECIOS:
- 3 panes por S/1.00 (cualquier variedad)
- Precio unitario: S/0.34

VARIEDADES DE PAN:
${VARIEDADES_PANES.map(p => `- ${p}`).join('\n')}

DELIVERY:
- Preguntar la dirección del cliente
- Calcular costo según zona (Cerro Colorado: S/3.00)
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

// ============= WHATSAPP CON BAILEYS =============
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

async function startBot() {
    try {
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
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('\n📱 NUEVO QR GENERADO');
                console.log('🌐 Para escanearlo, abre:');
                console.log(`   http://localhost:${PORT}/qr-image`);
                console.log(`   https://bot-panaderia.onrender.com/qr-image`);
                console.log('⏱️ El QR expira en 20 segundos. Si no alcanzas, se generará otro.\n');
                
                // Generar imagen QR y guardarla
                try {
                    const qrImageBuffer = await qrcode.toBuffer(qr, { type: 'png', margin: 2, width: 400 });
                    currentQR = qrImageBuffer;
                    console.log('✅ QR guardado en memoria. Visita /qr-image para verlo');
                } catch (err) {
                    console.error('Error generando imagen QR:', err);
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
                console.log('🤖 Bot con DeepSeek AI activo');
                console.log(`🥖 ${NEGOCIO.nombre} - 3 panes por S/1.00`);
                console.log('🚚 Delivery disponible\n');
                reconnectAttempts = 0;
                currentQR = null; // Limpiar QR ya que ya está conectado
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
                
                // Detectar ubicación del NEGOCIO
                if (esPreguntaUbicacion(messageText)) {
                    await sock.sendMessage(from, { text: generarRespuestaUbicacion() });
                    return;
                }
                
                // Detectar preguntas de pago
                if (esPreguntaPagos(messageText)) {
                    await sock.sendMessage(from, { text: generarRespuestaPagos() });
                    return;
                }
                
                // Detectar pedidos con cantidades
                const pedidoInfo = detectarCantidadYPrecio(messageText);
                if (pedidoInfo && (messageText.toLowerCase().includes('pan') || messageText.toLowerCase().includes('quiero') || messageText.toLowerCase().includes('dame') || messageText.toLowerCase().includes('delivery'))) {
                    console.log(`🧮 Pedido detectado: ${pedidoInfo.cantidad} panes = ${pedidoInfo.precioFormateado}`);
                    
                    conversaciones.set(from, {
                        pedido: pedidoInfo,
                        estado: 'esperando_direccion',
                        cantidad: pedidoInfo.cantidad,
                        precioPanes: pedidoInfo.precio
                    });
                    
                    let respuesta = `🥖 *Pedido: ${pedidoInfo.cantidad} panes*\n`;
                    respuesta += `💰 *Subtotal:* ${pedidoInfo.precioFormateado} (${pedidoInfo.cantidad} ÷ 3)\n\n`;
                    respuesta += `📋 *Variedades:* ${VARIEDADES_PANES.slice(0, 5).join(', ')} y más.\n\n`;
                    respuesta += `🚚 *Para delivery, necesito saber:*\n`;
                    respuesta += `📍 ¿Cuál es tu dirección de envío?\n\n`;
                    respuesta += `📍 *Para recoger en tienda:* ${NEGOCIO.direccion}\n`;
                    respuesta += `💳 *Pago:* Yape al ${NEGOCIO.telefono} o efectivo`;
                    
                    await sock.sendMessage(from, { text: respuesta });
                    return;
                }
                
                // Manejar direcciones de envío
                const conversacion = conversaciones.get(from);
                if (conversacion && conversacion.estado === 'esperando_direccion') {
                    const direccionCliente = messageText.trim();
                    if (direccionCliente.length > 5) {
                        const costoDelivery = calcularCostoDelivery(direccionCliente);
                        const totalFinal = conversacion.precioPanes + costoDelivery;
                        
                        let respuesta = `✅ *Dirección recibida:*\n${direccionCliente}\n\n`;
                        respuesta += `🚚 *Costo de delivery:* S/ ${costoDelivery.toFixed(2)}\n`;
                        respuesta += `🍞 *Panes:* ${conversacion.cantidad} = S/ ${conversacion.precioPanes.toFixed(2)}\n`;
                        respuesta += `💰 *TOTAL A PAGAR:* S/ ${totalFinal.toFixed(2)}\n\n`;
                        respuesta += `📞 *Confirmamos tu pedido?*\n`;
                        respuesta += `Responde "Confirmo" para enviarlo.\n\n`;
                        respuesta += `💳 *Pago:* Yape al ${NEGOCIO.telefono} (${NEGOCIO.titularYape}) o efectivo al recibir.`;
                        
                        conversacion.estado = 'esperando_confirmacion';
                        conversacion.direccion = direccionCliente;
                        conversacion.costoDelivery = costoDelivery;
                        conversacion.total = totalFinal;
                        conversaciones.set(from, conversacion);
                        
                        await sock.sendMessage(from, { text: respuesta });
                        return;
                    } else {
                        await sock.sendMessage(from, { text: "📍 Por favor, escribí tu dirección completa para poder enviarte el pedido (calle, número, zona)." });
                        return;
                    }
                }
                
                // Manejar confirmación de pedido
                if (conversacion && conversacion.estado === 'esperando_confirmacion' && 
                    (messageText.toLowerCase().includes('confirmo') || messageText.toLowerCase().includes('si') || messageText.toLowerCase().includes('acepto'))) {
                    
                    let respuesta = `🎉 *¡PEDIDO CONFIRMADO!* 🎉\n\n`;
                    respuesta += `📦 *Detalles:*\n`;
                    respuesta += `🍞 ${conversacion.cantidad} panes (variados)\n`;
                    respuesta += `📍 Envío a: ${conversacion.direccion}\n`;
                    respuesta += `🚚 Costo delivery: S/ ${conversacion.costoDelivery.toFixed(2)}\n`;
                    respuesta += `💰 Total: S/ ${conversacion.total.toFixed(2)}\n\n`;
                    respuesta += `⏱️ *Tiempo de entrega:* 30-45 minutos\n`;
                    respuesta += `💳 *Pago:* Yape al ${NEGOCIO.telefono} o efectivo al recibir\n\n`;
                    respuesta += `🥖 ¡Gracias por tu pedido! 🥖`;
                    
                    conversaciones.delete(from);
                    await sock.sendMessage(from, { text: respuesta });
                    return;
                }
                
                // Si el cliente dice "recoger en tienda"
                if (messageText.toLowerCase().includes('recoger') || messageText.toLowerCase().includes('tienda') || messageText.toLowerCase().includes('local')) {
                    const respuesta = `📍 *Recojo en tienda:*\n${NEGOCIO.direccion}\n\n🕐 Horario: ${NEGOCIO.horario}\n\n💳 Paga con Yape al ${NEGOCIO.telefono} o efectivo al llegar.\n\n🥖 ¡Te esperamos!`;
                    await sock.sendMessage(from, { text: respuesta });
                    return;
                }
                
                // Respuesta normal con IA
                await sock.sendMessage(from, { text: '🫘 *PanBot está pensando...*' });
                const respuesta = await getDeepSeekResponse(messageText, from);
                await sock.sendMessage(from, { text: respuesta });
                
            } catch (error) {
                console.error('❌ Error:', error);
                if (m?.messages[0]?.key?.remoteJid) {
                    await sock.sendMessage(m.messages[0].key.remoteJid, { 
                        text: 'Lo siento, hubo un error. Intentá de nuevo. 🥨' 
                    });
                }
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
const KEEP_ALIVE_INTERVAL = 14 * 60 * 1000;

setInterval(() => {
    console.log("💓 [Keep-Alive] Ping automático");
    fetch(`http://localhost:${PORT}/health`).catch(() => {});
}, KEEP_ALIVE_INTERVAL);

// ============= INICIAR =============
console.log('\n🚀 Iniciando PanBot...');
console.log(`🥖 ${NEGOCIO.nombre}`);
console.log('🚚 Delivery incluido');
console.log(`\n📱 Para escanear el QR, abre:`);
console.log(`   http://localhost:${PORT}/qr-image`);
console.log(`   https://bot-panaderia.onrender.com/qr-image\n`);

startBot();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));