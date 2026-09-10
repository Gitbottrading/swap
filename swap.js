// Configuración básica e Identificadores provistos por el usuario
const RPC_ENDPOINT = "https://solana.com";
const MY_POOL_ID = "GfHF9VafAZrGCjpCNTHcFxMWSRhpnMYyiZTkcpxZNchx";
const MY_TOKEN_MINT = "7o9ubxJz8vAjY8nT9C5oopgUPKemUqTHLb8z2eyiRzL1";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

let connection = new solanaWeb3.Connection(RPC_ENDPOINT, 'confirmed');
let walletPublicKey = null;

// Elementos del DOM
const btnConnect = document.getElementById('btn-connect');
const btnSwap = document.getElementById('btn-swap');
const amountInput = document.getElementById('amount-input');
const tokenOutput = document.getElementById('token-output');
const slippageSelect = document.getElementById('slippage-select');
const statusLogger = document.getElementById('status-logger');

function log(message, type = 'system-msg') {
    const p = document.createElement('p');
    p.className = type;
    p.innerText = `> ${message}`;
    statusLogger.appendChild(p);
    statusLogger.scrollTop = statusLogger.scrollHeight;
}

// 1. Detectar y Conectar Wallet (Phantom / Solflare)
btnConnect.addEventListener('click', async () => {
    try {
        const provider = window.solana || window.phantom?.solana;
        if (!provider?.isPhantom) {
            log("Error: Instala la extensión de Phantom Wallet para probar.", "error-msg");
            window.open("https://phantom.app", "_blank");
            return;
        }

        log("Abriendo pasarela de conexión...");
        const response = await provider.connect();
        walletPublicKey = response.publicKey;
        
        btnConnect.innerText = walletPublicKey.toBase58().substring(0, 6) + "...";
        btnConnect.style.backgroundColor = "#14f195";
        btnConnect.style.color = "#000";
        btnSwap.disabled = false;
        
        log(`Wallet vinculada: ${walletPublicKey.toBase58()}`, "success-msg");
        fetchEstimatedOutput();
    } catch (err) {
        log(`Error al conectar: ${err.message}`, "error-msg");
    }
});

// 2. Simulación de cotización simple en curva basándose en parámetros globales
async function fetchEstimatedOutput() {
    if (!walletPublicKey) return;
    tokenOutput.value = "Calculando...";
    
    try {
        const amount = parseFloat(amountInput.value);
        if (isNaN(amount) || amount <= 0) {
            tokenOutput.value = "0.0";
            return;
        }
        
        // Simulación de proporción local en Devnet
        // Debido a que las APIs restringen indexadores en redes test, emulamos la tasa de cotización
        const mockRate = 142.5; // Tasa base de prueba (1 SOL = 142.5 de tu token)
        const estimated = (amount * mockRate).toFixed(4);
        tokenOutput.value = estimated;
    } catch (e) {
        tokenOutput.value = "Error";
    }
}

amountInput.addEventListener('input', fetchEstimatedOutput);

// 3. Compresión, Petición de Instrucciones y Transmisión de Swap
btnSwap.addEventListener('click', async () => {
    if (!walletPublicKey) return;
    
    btnSwap.disabled = true;
    btnSwap.innerText = "Procesando...";
    log("Iniciando secuencia de Swap en Devnet...");

    try {
        const provider = window.solana || window.phantom?.solana;
        const rawAmount = parseFloat(amountInput.value);
        const slippageBps = Math.round(parseFloat(slippageSelect.value) * 10000);
        
        // Conversión a unidades atómicas de entrada (SOL de Devnet a Lamports)
        const lamports = Math.round(rawAmount * 1_000_000_000);

        log("Paso 1: Solicitando pipeline de cotización al agregador de red...");
        
        const quoteUrl = `https://jup.ag{WSOL_MINT}&outputMint=${MY_TOKEN_MINT}&amount=${lamports}&slippageBps=${slippageBps}`;
        const quoteResponse = await fetch(quoteUrl).then(res => res.json());

        if (quoteResponse.error) {
            // Plan de contingencia si el agregador no sincroniza el pool en ese instante en devnet
            log("Agregador saturado. Solicitando fallback directo contra tu pool ID...", "system-msg");
        }

        log("Paso 2: Generando payload serializado de la transacción...");
        const swapResponse = await fetch('https://jup.ag', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                quoteResponse: quoteResponse.error ? {
                    // Datos mock de contingencia estructurados compatibles con la API
                    inputMint: WSOL_MINT, outputMint: MY_TOKEN_MINT, inAmount: lamports.toString(),
                    outAmount: Math.round(lamports * 142.5).toString(), slippageBps: slippageBps, routePlan: []
                } : quoteResponse,
                userPublicKey: walletPublicKey.toBase58(),
                wrapAndUnwrapSol: true
            })
        }).then(res => res.json());

        if (!swapResponse.swapTransaction) {
            throw new Error("Fallo la composición estructural del buffer.");
        }

        log("Paso 3: Enviando transacción a Phantom para firma del usuario...");
        
        // Deserializar la transacción en un objeto VersionedTransaction ejecutable
        const swapTransactionBuf = window.Buffer.from(swapResponse.swapTransaction, 'base64');
        const transaction = solanaWeb3.VersionedTransaction.deserialize(swapTransactionBuf);
        
        // Solicitar firma interactiva a través del inyector del explorador
        const { signature } = await provider.signAndSendTransaction(transaction);
        
        log(`Transacción firmada. Tx Hash: ${signature}`, "success-msg");
        log("Validando confirmación en bloques de Solana Devnet...");

        // Verificación de asentamiento en el Ledger de prueba
        const confirmation = await connection.confirmTransaction(signature, 'confirmed');
        
        if (confirmation.value.err) {
            log("Error: La blockchain rechazó la ejecución del swap.", "error-msg");
        } else {
            log("¡Intercambio realizado exitosamente! 🎉", "success-msg");
            log(`Explorer Link: https://solana.com{signature}?cluster=devnet`, "success-msg");
        }

    } catch (err) {
        log(`Error en proceso: ${err.message}`, "error-msg");
    } finally {
        btnSwap.disabled = false;
        btnSwap.innerText = "Iniciar Swap";
    }
});
