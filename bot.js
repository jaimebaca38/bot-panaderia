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

// Detectar entorno de producción (Render) o desarrollo (local)
const isProduction = process.env.NODE_ENV === 'production';

// Historial de conversaciones (recuerda contexto)
const chatHistories = new Map();
const MAX_HISTORY = 20;

// ============= SERVIDOR WEB =============
const app = express();

// Ruta para el dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// API de estado
app.get('/api', (req, res) => {
    res.json({
        status: 'running',
        timestamp: Date.now(),
        environment: isProduction ? 'production' : 'development',
        whatsapp: client ? (client.info ? 'connected' : 'connecting') : 'not_initialized'
    });
});

// Health check para Render (evita que duerman el servicio)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

const server = app.listen(PORT, () => {
    console.log(`🌐 Dashboard: http://localhost:${PORT}`);
});

// Mantener el servidor activo para Render
server.keepAliveTimeout = 120000; // 2 minutos
server.headersTimeout = 120000; // 2 minutos

// ============= FUNCIÓN PARA HABLAR CON DEEPSEEK =============
async function getDeepSeekResponse(userMessage, chatId) {
    try {
        // Verificar API key
        if (!DEEPSEEK_API_KEY) {
            console.error('❌ DEEPSEEK_API_KEY no configurada');
            return "Lo siento, la configuración de la API no está completa. Por favor, contacta al administrador. 🥖";
        }
        
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
            - Si no sabes algo, ofrece pasar el contacto de la panadería
            - Responde siempre en menos de 400 caracteres si es posible`
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
        console.error("Error en DeepSeek:", error);
        return "Lo siento, hubo un error. Por favor, intentá de nuevo. 🍞";
    }
}

// ============= CONFIGURACIÓN DE WHATSAPP (VERSIÓN UNIVERSAL) =============
// Esta configuración funciona en Windows y Linux/Render
const client = new Client({
    authStrategy: new LocalAuth({
        // En producción usa el disco persistente de Render, en local usa carpeta normal
        dataPath: isProduction ? '/app/auth_data' : './auth_data'
    }),
    puppeteer: {
        headless: true,
        args: isProduction ? [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process'  // Ayuda en entornos con recursos limitados
        ] : [
            '--no-sandbox'  // Solo este es suficiente en Windows
        ]
    }
});

// Generar QR
client.on('qr', (qr) => {
    console.log('📱 ESCANEA ESTE QR CON WHATSAPP:');
    qrcode.generate(qr, { small: true });
    console.log('🔄 El QR se actualizará automáticamente si expira');
});

// Cuando el bot está listo
client.on('ready', () => {
    console.log('✅ ¡BOT CONECTADO A WHATSAPP!');
    console.log('🤖 Bot inteligente con DeepSeek activo');
    console.log(`📊 Estadísticas: ${chatHistories.size} conversaciones activas`);
});

// Manejar mensajes
client.on('message', async (message) => {
    // Ignorar mensajes de grupos
    if (message.from.includes('@g.us')) return;
    
    // Ignorar mensajes propios
    if (message.fromMe) return;
    
    // Ignorar mensajes vacíos o muy cortos
    if (!message.body || message.body.trim().length === 0) return;
    
    const mensaje = message.body.trim();
    const chatId = message.from;
    
    console.log(`📩 Mensaje de ${chatId}: ${mensaje.substring(0, 50)}`);
    
    try {
        // Mostrar que el bot está escribiendo
        await message.reply('🫘 *PanBot está pensando...*');
        
        // Obtener respuesta de DeepSeek
        const respuesta = await getDeepSeekResponse(mensaje, chatId);
        
        // Enviar respuesta (con límite de caracteres para WhatsApp)
        const respuestaFinal = respuesta.length > 2000 ? respuesta.substring(0, 1997) + '...' : respuesta;
        await client.sendMessage(chatId, respuestaFinal);
        
        console.log(`✅ Respuesta enviada a ${chatId}`);
        
    } catch (error) {
        console.error('Error al procesar mensaje:', error);
        await client.sendMessage(chatId, 'Lo siento, hubo un error. Intentá de nuevo en unos momentos. 🥨');
    }
});

// Manejar desconexión
client.on('disconnected', (reason) => {
    console.log('⚠️ Bot desconectado de WhatsApp:', reason);
    console.log('🔄 Intentando reconectar en 5 segundos...');
    setTimeout(() => {
        client.initialize();
    }, 5000);
});

// Manejar errores de autenticación
client.on('auth_failure', (msg) => {
    console.error('❌ Fallo de autenticación:', msg);
    console.log('🔄 Eliminando sesión antigua...');
    // En producción no podemos eliminar archivos fácilmente, pero podemos intentar reiniciar
    if (!isProduction) {
        console.log('⚠️ En local, elimina la carpeta ./auth_data manualmente y reinicia');
    }
});

// Inicializar el bot con manejo de errores
console.log('🚀 Iniciando bot de WhatsApp + DeepSeek...');
console.log(`🔧 Entorno: ${isProduction ? 'PRODUCCIÓN (Render)' : 'DESARROLLO (Local)'}`);

client.initialize().catch(error => {
    console.error('❌ Error al inicializar el bot:', error);
    process.exit(1);
});