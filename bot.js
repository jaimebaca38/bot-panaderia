import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import express from 'express';
import fetch from 'node-fetch';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// ============= LIMPIAR SESIÓN =============
const authFolder = './auth_data';
const FORZAR_LIMPIEZA = false;  // Cambiar a true solo si hay problemas

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

// Configuración de la panadería
const GOOGLE_MAPS_URL = 'https://maps.app.goo.gl/vJZ96jEq58RU4iqe7';
const UBICACION = {
    direccion: 'Angel Ibarcena Reynoso D1, Cerro Colorado 04014',
    referencia: 'A una cuadra de la entrada a Urb. Buganvillas',
    maps: GOOGLE_MAPS_URL
};
const TELEFONO = '999555333';
const NOMBRE_TITULAR = 'James Baca';

const chatHistories = new Map();
const MAX_HISTORY = 20;

// ============= SERVIDOR WEB =============
const app = express();

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>PanBot - Panadería Delicias</title>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial; text-align: center; padding: 50px; background: #f5e6d3; }
                h1 { color: #8B4513; }
                .status { padding: 20px; background: white; border-radius: 10px; display: inline-block; }
                .online { color: green; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>🥖 PanBot - Panadería Delicias</h1>
            <div class="status">
                <p>Estado: <span class="online">✅ ONLINE</span></p>
                <p>🤖 Usando DeepSeek AI</p>
                <p>🥖 Panes artesanales | 🎂 Tortas temáticas | 🚚 Delivery</p>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => res.status(200).send('OK'));

app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
});

// ============= MANEJO DE UBICACIÓN =============
function esPreguntaUbicacion(mensaje) {
    const palabrasClave = [
        'dirección', 'ubicación', 'dónde están', 'cómo llegar', 
        'maps', 'google maps', 'dónde queda', 'en qué calle',
        'ubicame', 'llegar', 'como te encuentro', 'donde te encuentro',
        'direccion', 'ubicacion', 'mapa', 'referencia', 'buganvillas'
    ];
    const mensajeLower = mensaje.toLowerCase();
    return palabrasClave.some(palabra => mensajeLower.includes(palabra));
}

function esPreguntaPagos(mensaje) {
    const palabrasClave = ['pago', 'pagar', 'yape', 'efectivo', 'transferencia', 'tarjeta', 'costo', 'precio', 'cuánto', 'valor'];
    const mensajeLower = mensaje.toLowerCase();
    return palabrasClave.some(palabra => mensajeLower.includes(palabra));
}

function generarRespuestaUbicacion() {
    return `📍 ¡Claro! Te comparto nuestra ubicación:

🏠 *Panadería Delicias*
${UBICACION.direccion}
Referencia: ${UBICACION.referencia}

🗺️ *Google Maps:* 
${UBICACION.maps}

🚗 *Cómo llegar:*
- Estamos a una cuadra de la entrada a Urb. Buganvillas
- Frente al parque principal del sector

📞 Si te perdés, llamanos o escríbenos al *${TELEFONO}*

🍞 ¡Te esperamos con los mejores panes! 🥖`;
}

function generarRespuestaPagos() {
    return `💵 *Métodos de pago disponibles:*

✅ *Yape:* ${TELEFONO} - Nombre: ${NOMBRE_TITULAR}
✅ *Efectivo:* En nuestra tienda física
✅ *Transferencia bancaria:* Consultar por WhatsApp

🎁 *Promociones especiales:*
- Pago con Yape: 5% de descuento en tu primera compra
- Efectivo: Sin recargo

🚚 *Delivery:* Consulta disponibilidad según tu zona

📅 *Horario:* Todos los días de 7am a 8pm

¡Elegí el método que más te convenga! 💰`;
}

// ============= FUNCIÓN DEEPSEEK =============
async function getDeepSeekResponse(userMessage, chatId) {
    try {
        if (!DEEPSEEK_API_KEY) return "🔧 API no configurada. Contacta al administrador.";
        
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
            content: `Eres "PanBot", el asistente virtual de "Panadería Delicias". 

🎯 INFORMACIÓN IMPORTANTE:
- MONEDA: SOLES (S/.)
- PRECIO ESPECIAL: 3 panes por S/ 1.00 (oferta básica)
- DELIVERY: Consultar disponibilidad por zona
- HORARIO: Todos los días de 7am a 8pm

🥖 LISTA DE PANES (todos aplican 3x S/1.00):
- Pan de Molde
- Pan de Tres Puntas
- Pan Integral
- Pan de Yema
- Pan Carioco
- Pan Lulo
- Pan de Aceituna
- Pan Baguette
- Pan Ciabatta
- Pan Francés
- Pan Especial

🎂 TORTAS (encargos con 48hrs de anticipación):
- Tortas de Cumpleaños: Desde S/ 45.00 (1kg)
- Tortas Temáticas: Desde S/ 60.00 (diseños personalizados)
- Sabores: Vainilla, Chocolate, Lúcuma, Tres leches, Frutos rojos
- Rellenos: Manjar, Crema pastelera, Frutas, Chocolate

💵 MÉTODOS DE PAGO:
- YAPE: ${TELEFONO} (${NOMBRE_TITULAR})
- Efectivo: En tienda
- Transferencia: Consultar

📍 UBICACIÓN:
- Dirección: ${UBICACION.direccion}
- Referencia: ${UBICACION.referencia}

🚚 DELIVERY:
- Zonas cercanas: Consultar disponibilidad
- Costo: Según zona (preguntar)
- Tiempo: 30-45 min aprox

INSTRUCCIONES IMPORTANTES:
- Responde SIEMPRE en español
- Sé amable, cálido y usa emojis ocasionalmente 🥖🍞🎂
- Si preguntan precios, menciona la oferta de "3 panes por S/1.00"
- Para pedidos grandes, pregunta cantidad y tipo de pan
- Para tortas, pregunta con cuánta anticipación necesitan (mínimo 48hrs)
- Ofrece delivery cuando corresponda
- Si preguntan por Yape, da el número ${TELEFONO}
- Siempre despídete con un mensaje amable

EJEMPLO DE RESPUESTA:
"¡Hola! 🥖 En Panadería Delicias tenemos una oferta especial: 3 panes por solo S/1.00. Tenemos pan de molde, integral, baguette, ciabatta, entre otros. ¿Cuántos panes necesitas? También hacemos tortas temáticas con 48hrs de anticipación. ¡Te esperamos! 🎂"
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
                console.log('\n🔗 Si no funciona, usa: https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(qr));
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
                console.log('🥖 Panadería Delicias - 3 panes por S/1.00');
                console.log('🎂 Tortas temáticas disponibles\n');
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
                
                // Detectar ubicación
                if (esPreguntaUbicacion(messageText)) {
                    console.log(`📍 Respondiendo ubicación`);
                    await sock.sendMessage(from, { text: generarRespuestaUbicacion() });
                    return;
                }
                
                // Detectar preguntas de pago
                if (esPreguntaPagos(messageText)) {
                    console.log(`💰 Respondiendo métodos de pago`);
                    await sock.sendMessage(from, { text: generarRespuestaPagos() });
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
                        text: 'Lo siento, hubo un error. Intentá de nuevo en unos momentos. 🥨' 
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

// ============= INICIAR EL BOT =============
console.log('\n🚀 Iniciando PanBot - Panadería Delicias...');
console.log(`📅 Versión de Node: ${process.version}`);
console.log('🥖 Oferta especial: 3 panes por S/1.00');
console.log('🎂 Tortas temáticas con 48hrs de anticipación\n');

startBot();

process.on('SIGINT', async () => {
    console.log('\n🛑 Apagando el bot...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Apagando el bot...');
    process.exit(0);
});