import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

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

// Datos de la panadería (NO confundir con dirección del cliente)
const NEGOCIO = {
    nombre: "Panadería Delicias",
    direccion: "Angel Ibarcena Reynoso D1, Cerro Colorado 04014",
    referencia: "A una cuadra de la entrada a Urb. Buganvillas",
    maps: "https://maps.app.goo.gl/vJZ96jEq58RU4iqe7",
    telefono: "999555333",
    titularYape: "James Baca",
    horario: "Todos los días de 7am a 8pm"
};

// Costo de delivery por zona (ejemplo)
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

// Almacenar datos de conversación por cliente (dirección, pedido, etc.)
const conversaciones = new Map();

const chatHistories = new Map();
const MAX_HISTORY = 20;

// ============= SERVIDOR WEB =============
const app = express();

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>PanBot - ${NEGOCIO.nombre}</title>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial; text-align: center; padding: 50px; background: #f5e6d3; }
                h1 { color: #8B4513; }
                .status { padding: 20px; background: white; border-radius: 10px; display: inline-block; }
                .online { color: green; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>🥖 PanBot - ${NEGOCIO.nombre}</h1>
            <div class="status">
                <p>Estado: <span class="online">✅ ONLINE</span></p>
                <p>🤖 Usando DeepSeek AI</p>
                <p>🥖 3 panes por S/1.00 | 🚚 Delivery</p>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => res.status(200).send('OK'));

app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
});

// ============= FUNCIONES DE UTILIDAD =============
function esPreguntaUbicacion(mensaje) {
    const palabrasClave = ['dirección', 'ubicación', 'dónde están', 'cómo llegar', 'maps', 'dónde queda', 'en qué calle', 'ubicame', 'llegar', 'como te encuentro', 'donde te encuentro', 'ubicacion', 'mapa', 'referencia', 'buganvillas'];
    const mensajeLower = mensaje.toLowerCase();
    return palabrasClave.some(palabra => mensajeLower.includes(palabra));
}

function esPreguntaPagos(mensaje) {
    const palabrasClave = ['pago', 'pagar', 'yape', 'efectivo', 'transferencia', 'tarjeta', 'costo', 'precio', 'cuánto', 'valor'];
    const mensajeLower = mensaje.toLowerCase();
    return palabrasClave.some(palabra => mensajeLower.includes(palabra));
}

function esPreguntaDelivery(mensaje) {
    const palabrasClave = ['delivery', 'envío', 'enviar', 'traer', 'llevar a casa', 'domicilio', 'reparto', 'mandar'];
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

function extraerDireccion(mensaje) {
    // Intentar extraer una dirección del mensaje
    // Esto es básico; el usuario puede escribir la dirección directamente
    const palabras = mensaje.split(' ');
    if (palabras.length > 3) {
        return mensaje.trim();
    }
    return null;
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
async function getDeepSeekResponse(userMessage, chatId, contextoPedido = null) {
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

INFORMACIÓN DEL NEGOCIO (NO ES DIRECCIÓN DEL CLIENTE):
- Dirección del negocio: ${NEGOCIO.direccion}
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
- El cliente debe dar SU dirección (no la del negocio)
- Después de recibir la dirección, calculás el costo según la zona
- Ejemplo de zonas: Cerro Colorado (S/3.00), alrededores (S/5.00)

REGLAS IMPORTANTES:
1. NUNCA confundas la dirección del negocio con la dirección del cliente
2. Si el cliente pide delivery, preguntale: "¿Cuál es tu dirección para el envío?"
3. Cuando el cliente dé su dirección, confirmá el costo de delivery
4. El total final = (cantidad de panes / 3) + costo de delivery
5. Despedite siempre amablemente

EJEMPLO DE CONVERSACIÓN:
Cliente: "Quiero delivery de 30 panes"
Tú: "¡Perfecto! 30 panes son S/10.00. ¿Cuál es tu dirección para el envío?"

Cliente: "Vivo en Cerro Colorado, calle Los Pinos 123"
Tú: "Gracias. El delivery a Cerro Colorado cuesta S/3.00. Total a pagar: S/13.00 (S/10.00 de panes + S/3.00 de envío). ¿Confirmas el pedido?"

Cliente: "Confirmo"
Tú: "¡Listo! Tu pedido llegará en 30-45 min. Puedes pagar con Yape al ${NEGOCIO.telefono} o efectivo al recibir. 🥖"
`
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
        
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('\n📱 ESCANEA ESTE QR CON WHATSAPP:\n');
                qrcode.generate(qr, { small: false });
                console.log('\n⏱️ El QR expira rápido. Escanéalo en los próximos 20 segundos.\n');
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
                
                // 1. Detectar ubicación del NEGOCIO
                if (esPreguntaUbicacion(messageText)) {
                    console.log(`📍 Respondiendo ubicación del negocio`);
                    await sock.sendMessage(from, { text: generarRespuestaUbicacion() });
                    return;
                }
                
                // 2. Detectar preguntas de pago
                if (esPreguntaPagos(messageText)) {
                    console.log(`💰 Respondiendo métodos de pago`);
                    await sock.sendMessage(from, { text: generarRespuestaPagos() });
                    return;
                }
                
                // 3. Detectar pedidos con cantidades
                const pedidoInfo = detectarCantidadYPrecio(messageText);
                if (pedidoInfo && (messageText.toLowerCase().includes('pan') || messageText.toLowerCase().includes('quiero') || messageText.toLowerCase().includes('dame') || messageText.toLowerCase().includes('delivery'))) {
                    console.log(`🧮 Pedido detectado: ${pedidoInfo.cantidad} panes = ${pedidoInfo.precioFormateado}`);
                    
                    // Guardar el pedido en la conversación
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
                
                // 4. Manejar direcciones de envío (si el bot está esperando una dirección)
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
                        
                        // Actualizar estado
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
                
                // 5. Manejar confirmación de pedido
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
                    respuesta += `📞 *Cualquier consulta:* ${NEGOCIO.telefono}\n\n`;
                    respuesta += `🥖 ¡Gracias por tu pedido! 🥖`;
                    
                    // Limpiar conversación después de confirmar
                    conversaciones.delete(from);
                    
                    await sock.sendMessage(from, { text: respuesta });
                    return;
                }
                
                // 6. Si el cliente dice "recoger en tienda" o similar
                if (messageText.toLowerCase().includes('recoger') || messageText.toLowerCase().includes('tienda') || messageText.toLowerCase().includes('local')) {
                    const respuesta = `📍 *Recojo en tienda:*\n${NEGOCIO.direccion}\n\n🕐 Horario: ${NEGOCIO.horario}\n\n💳 Paga con Yape al ${NEGOCIO.telefono} o efectivo al llegar.\n\n🥖 ¡Te esperamos!`;
                    await sock.sendMessage(from, { text: respuesta });
                    return;
                }
                
                // 7. Respuesta normal con IA
                await sock.sendMessage(from, { text: '🫘 *PanBot está pensando...*' });
                const respuesta = await getDeepSeekResponse(messageText, from, conversacion);
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
console.log('🚚 Delivery incluido\n');

startBot();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));