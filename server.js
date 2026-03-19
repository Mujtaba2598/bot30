const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Halal Trading Bot on Supabase' });
});

// IP DETECTION ENDPOINT
app.get('/api/my-ip', async (req, res) => {
    try {
        const response = await axios.get('https://api.ipify.org');
        const ip = response.data;
        res.json({ 
            success: true, 
            ip: ip,
            message: 'Your server IP address'
        });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Database (in-memory for active sessions)
const activeSessions = {};

// Win streak tracker
const winStreaks = {};

// Rate limit tracker
const rateLimit = {
    lastRequestTime: 0,
    requestCount: 0,
    bannedUntil: 0,
    warningCount: 0
};

// AI Trading Engine
class AITradingEngine {
    constructor() {
        this.performance = { totalTrades: 0, successfulTrades: 0, totalProfit: 0 };
    }

    analyzeMarket(symbol, marketData, sessionId) {
        const { price = 0, volume24h = 0, priceChange24h = 0, high24h = 0, low24h = 0 } = marketData;
        
        const volumeRatio = volume24h / 1000000;
        const pricePosition = high24h > low24h ? (price - low24h) / (high24h - low24h) : 0.5;
        
        let confidence = 0.7;
        
        if (volumeRatio > 1.3) confidence += 0.15;
        if (volumeRatio > 1.8) confidence += 0.2;
        if (priceChange24h > 3) confidence += 0.2;
        if (priceChange24h > 7) confidence += 0.25;
        if (pricePosition < 0.35) confidence += 0.15;
        if (pricePosition > 0.65) confidence += 0.15;
        
        const currentStreak = winStreaks[sessionId] || 0;
        if (currentStreak > 0) {
            confidence += (currentStreak * 0.05);
        }
        
        confidence = Math.min(confidence, 0.98);
        
        const action = (pricePosition < 0.35 && priceChange24h > -3 && volumeRatio > 1.1) ? 'BUY' :
                      (pricePosition > 0.65 && priceChange24h > 3 && volumeRatio > 1.1) ? 'SELL' : 
                      (Math.random() > 0.2 ? 'BUY' : 'SELL');
        
        return { symbol, price, confidence, action };
    }

    calculatePositionSize(initialInvestment, currentProfit, targetProfit, timeElapsed, timeLimit, confidence, sessionId) {
        const timeRemaining = Math.max(0.1, (timeLimit - timeElapsed) / timeLimit);
        const remainingProfit = Math.max(1, targetProfit - currentProfit);
        
        let baseSize = Math.max(10, initialInvestment * 0.25);
        const timePressure = 1.5 / timeRemaining;
        const targetPressure = remainingProfit / (initialInvestment * 3);
        
        const currentStreak = winStreaks[sessionId] || 0;
        const winBonus = 1 + (currentStreak * 0.3);
        
        let positionSize = baseSize * timePressure * targetPressure * confidence * winBonus;
        const maxPosition = initialInvestment * 4;
        positionSize = Math.min(positionSize, maxPosition);
        positionSize = Math.max(positionSize, 10);
        
        return positionSize;
    }
}

// FIXED Binance API with Time Sync
class BinanceAPI {
    static baseUrl = 'https://api.binance.com';
    static testnetUrl = 'https://testnet.binance.vision';
    static dataUrl = 'https://data.binance.com';
    
    static async signRequest(queryString, secret) {
        return crypto
            .createHmac('sha256', secret)
            .update(queryString)
            .digest('hex');
    }

    static async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static async getServerTime() {
        try {
            const response = await axios.get(`${this.dataUrl}/api/v3/time`, { timeout: 5000 });
            return response.data.serverTime;
        } catch (error) {
            console.log('⚠️ Could not fetch server time, using local time');
            return Date.now();
        }
    }

    static validateApiKey(apiKey) {
        if (!apiKey || apiKey.length < 10) {
            return { valid: false, reason: 'API key too short' };
        }
        if (apiKey.includes('\n') || apiKey.includes('\r') || apiKey.includes(' ')) {
            return { valid: false, reason: 'API key contains line breaks or spaces' };
        }
        return { valid: true };
    }

    static async makeRequest(endpoint, method, apiKey, secret, params = {}, useTestnet = false) {
        try {
            const keyValidation = this.validateApiKey(apiKey);
            if (!keyValidation.valid) {
                throw new Error(`Invalid API key format: ${keyValidation.reason}`);
            }

            if (rateLimit.bannedUntil > Date.now()) {
                const minutesLeft = Math.ceil((rateLimit.bannedUntil - Date.now()) / 60000);
                throw new Error(`⚠️ IP BANNED for ${minutesLeft} more minutes. Please wait.`);
            }

            const timeSinceLastRequest = Date.now() - rateLimit.lastRequestTime;
            if (timeSinceLastRequest < 2000) {
                await this.delay(2000 - timeSinceLastRequest);
            }

            const serverTime = await this.getServerTime();
            const timestamp = serverTime;
            
            const queryParams = { ...params, timestamp };
            const queryString = Object.keys(queryParams)
                .map(key => `${key}=${queryParams[key]}`)
                .join('&');
            
            const signature = await this.signRequest(queryString, secret);
            
            // Try multiple endpoints in order
            const baseUrls = useTestnet ? [this.testnetUrl] : [this.baseUrl, 'https://api1.binance.com', 'https://api2.binance.com', 'https://api3.binance.com'];
            
            let lastError = null;
            for (const baseUrl of baseUrls) {
                try {
                    const url = `${baseUrl}${endpoint}?${queryString}&signature=${signature}`;
                    const response = await axios({
                        method,
                        url,
                        headers: { 'X-MBX-APIKEY': apiKey.trim() },
                        timeout: 10000
                    });
                    
                    rateLimit.lastRequestTime = Date.now();
                    rateLimit.requestCount++;
                    
                    const usedWeight = response.headers['x-mbx-used-weight-1m'];
                    if (usedWeight) {
                        const weight = parseInt(usedWeight);
                        console.log(`📊 Rate limit weight: ${weight}/1200`);
                        
                        if (weight > 1000) {
                            rateLimit.warningCount++;
                            if (rateLimit.warningCount >= 3) {
                                await this.delay(60000);
                                rateLimit.warningCount = 0;
                            }
                        } else {
                            rateLimit.warningCount = 0;
                        }
                    }
                    
                    return response.data;
                } catch (err) {
                    lastError = err;
                    console.log(`⚠️ Endpoint ${baseUrl} failed, trying next...`);
                }
            }
            
            throw lastError || new Error('All endpoints failed');
            
        } catch (error) {
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data;
                
                console.error('🔴 Binance API Error Details:', {
                    status: status,
                    code: data.code,
                    message: data.msg,
                    endpoint: endpoint
                });
                
                if (data.code === -1021) {
                    throw new Error('Timestamp error - server time synced, please retry');
                }
                
                if (status === 429) {
                    rateLimit.warningCount++;
                    await this.delay(60000);
                    throw new Error('Rate limit exceeded. Please slow down.');
                }
                
                if (status === 418) {
                    const banTimeMatch = data.msg?.match(/\d+/);
                    if (banTimeMatch) {
                        rateLimit.bannedUntil = parseInt(banTimeMatch[0]);
                    }
                    throw new Error(`IP BANNED: ${data.msg || 'Too many requests'}`);
                }
                
                if (status === 451) {
                    throw new Error(`LOCATION RESTRICTED: ${data.msg || 'Service unavailable in your region'}`);
                }
                
                if (data.code === -2014 || data.code === -2015) {
                    throw new Error('Invalid API key format or permissions');
                }
                
                if (data.msg) {
                    throw new Error(`Binance Error ${data.code}: ${data.msg}`);
                }
            }
            
            throw error;
        }
    }

    static async getAccountBalance(apiKey, secret, useTestnet = false) {
        try {
            const data = await this.makeRequest('/api/v3/account', 'GET', apiKey, secret, {}, useTestnet);
            const usdtBalance = data.balances.find(b => b.asset === 'USDT');
            return {
                success: true,
                free: parseFloat(usdtBalance?.free || 0),
                locked: parseFloat(usdtBalance?.locked || 0),
                total: parseFloat(usdtBalance?.free || 0) + parseFloat(usdtBalance?.locked || 0)
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async getTicker(symbol, useTestnet = false) {
        try {
            const baseUrl = useTestnet ? this.testnetUrl : this.dataUrl;
            const response = await axios.get(`${baseUrl}/api/v3/ticker/24hr?symbol=${symbol}`, { timeout: 5000 });
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async placeMarketOrder(apiKey, secret, symbol, side, quoteOrderQty, useTestnet = false) {
        try {
            const orderData = await this.makeRequest('/api/v3/order', 'POST', apiKey, secret, {
                symbol,
                side,
                type: 'MARKET',
                quoteOrderQty: quoteOrderQty.toFixed(2)
            }, useTestnet);
            
            let avgPrice = 0;
            let totalQty = 0;
            if (orderData.fills && orderData.fills.length > 0) {
                let totalValue = 0;
                orderData.fills.forEach(fill => {
                    totalValue += parseFloat(fill.price) * parseFloat(fill.qty);
                    totalQty += parseFloat(fill.qty);
                });
                avgPrice = totalValue / totalQty;
            }
            
            return {
                success: true,
                orderId: orderData.orderId,
                executedQty: parseFloat(orderData.executedQty),
                price: avgPrice || parseFloat(orderData.fills?.[0]?.price || 0),
                data: orderData
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    static async verifyApiKey(apiKey, secret, useTestnet = false) {
        try {
            const keyValidation = this.validateApiKey(apiKey);
            if (!keyValidation.valid) {
                return { 
                    success: false, 
                    error: `Invalid format: ${keyValidation.reason}` 
                };
            }

            const data = await this.makeRequest('/api/v3/account', 'GET', apiKey, secret, {}, useTestnet);
            return {
                success: true,
                permissions: data.permissions,
                canTrade: data.canTrade,
                canWithdraw: data.canWithdraw,
                canDeposit: data.canDeposit
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

const aiEngine = new AITradingEngine();

// API Routes
app.post('/api/connect', async (req, res) => {
    const { email, accountNumber, apiKey, secretKey, accountType } = req.body;
    const useTestnet = accountType === 'testnet';
    
    if (!apiKey || !secretKey) {
        return res.status(400).json({
            success: false,
            message: 'API key and secret are required'
        });
    }
    
    const cleanApiKey = apiKey.trim().replace(/[\n\r]/g, '');
    const cleanSecretKey = secretKey.trim().replace(/[\n\r]/g, '');
    
    try {
        const verification = await BinanceAPI.verifyApiKey(cleanApiKey, cleanSecretKey, useTestnet);
        
        if (!verification.success) {
            return res.status(401).json({
                success: false,
                message: `API verification failed: ${verification.error}`
            });
        }
        
        if (!verification.canTrade && !useTestnet) {
            return res.status(403).json({
                success: false,
                message: 'API key does not have trading permission enabled. Please enable "Spot & Margin Trading".'
            });
        }
        
        const balance = await BinanceAPI.getAccountBalance(cleanApiKey, cleanSecretKey, useTestnet);
        
        // Create session in Supabase
        const sessionId = 'session_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
        
        const { data: sessionData, error: sessionError } = await supabase
            .from('sessions')
            .insert([{
                session_id: sessionId,
                email: email,
                account_number: accountNumber,
                created_at: new Date().toISOString(),
                is_active: true,
                balance: balance.success ? balance.total : (useTestnet ? 10000 : 0),
                use_testnet: useTestnet
            }])
            .select();
        
        if (sessionError) {
            console.error('Supabase session error:', sessionError);
        }
        
        activeSessions[sessionId] = {
            id: sessionId,
            email,
            accountNumber,
            apiKey: cleanApiKey,
            secretKey: cleanSecretKey,
            balance: balance.success ? balance.total : (useTestnet ? 10000 : 0),
            useTestnet
        };
        
        winStreaks[sessionId] = 0;
        
        const message = useTestnet 
            ? '✅ Connected to Binance Testnet! (Practice Mode)'
            : `✅ Connected to REAL Binance! Balance: $${balance.success ? balance.total.toFixed(2) : '0'} USDT`;
        
        res.json({ 
            success: true, 
            sessionId,
            balance: balance.success ? balance.total : (useTestnet ? 10000 : 0),
            message
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Connection failed: ' + error.message
        });
    }
});

app.post('/api/startTrading', async (req, res) => {
    const { sessionId, initialInvestment, targetProfit, timeLimit, riskLevel, tradingPairs } = req.body;
    
    const session = activeSessions[sessionId];
    if (!session) {
        return res.status(401).json({
            success: false,
            message: 'Invalid session'
        });
    }
    
    if (!session.useTestnet) {
        const balanceCheck = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey, false);
        if (!balanceCheck.success || balanceCheck.free < initialInvestment) {
            return res.status(400).json({
                success: false,
                message: `Insufficient balance. You have $${balanceCheck.free?.toFixed(2) || 0} USDT, need $${initialInvestment}`
            });
        }
    }
    
    const botId = 'bot_' + Date.now();
    activeSessions[sessionId].activeBot = botId;
    
    const tradeSession = {
        id: botId,
        sessionId,
        initialInvestment: parseFloat(initialInvestment) || 10,
        targetProfit: parseFloat(targetProfit) || 100,
        timeLimit: parseFloat(timeLimit) || 1,
        riskLevel: riskLevel || 'aggressive',
        tradingPairs: tradingPairs || ['BTCUSDT', 'ETHUSDT'],
        startedAt: new Date().toISOString(),
        isRunning: true,
        currentProfit: 0,
        trades: [],
        lastTradeTime: Date.now()
    };
    
    // Store in Supabase
    const { error } = await supabase
        .from('trading_sessions')
        .insert([tradeSession]);
    
    if (error) {
        console.error('Supabase insert error:', error);
    }
    
    winStreaks[sessionId] = 0;
    
    res.json({ 
        success: true, 
        botId, 
        message: `🔥 TRADING ACTIVE! Target: $${parseFloat(targetProfit).toLocaleString()}`,
        mode: session.useTestnet ? 'Testnet (Practice)' : 'Real Money'
    });
});

app.post('/api/stopTrading', (req, res) => {
    const { sessionId } = req.body;
    const session = activeSessions[sessionId];
    if (session?.activeBot) {
        session.activeBot = null;
    }
    res.json({ success: true, message: 'Trading stopped' });
});

// SAFE POLLING: 60 seconds minimum
app.post('/api/tradingUpdate', async (req, res) => {
    const { sessionId } = req.body;
    
    const session = activeSessions[sessionId];
    if (!session?.activeBot) {
        return res.json({ success: true, currentProfit: 0, newTrades: [] });
    }
    
    // Get trade session from Supabase
    const { data: tradeData, error: fetchError } = await supabase
        .from('trading_sessions')
        .select('*')
        .eq('id', session.activeBot)
        .single();
    
    if (fetchError || !tradeData) {
        return res.json({ success: true, currentProfit: 0, newTrades: [] });
    }
    
    const newTrades = [];
    const now = Date.now();
    
    const timeElapsed = (now - new Date(tradeData.startedAt).getTime()) / (1000 * 60 * 60);
    const timeRemaining = Math.max(0, tradeData.timeLimit - timeElapsed);
    
    const timeSinceLastTrade = (now - (tradeData.lastTradeTime || 0)) / 1000;
    
    if (timeRemaining > 0 && timeSinceLastTrade >= 60) {
        const symbol = tradeData.tradingPairs[Math.floor(Math.random() * tradeData.tradingPairs.length)] || 'BTCUSDT';
        
        const tickerData = await BinanceAPI.getTicker(symbol, session.useTestnet);
        
        if (tickerData.success) {
            const marketPrice = parseFloat(tickerData.data.lastPrice);
            const marketData = {
                price: marketPrice,
                volume24h: parseFloat(tickerData.data.volume),
                priceChange24h: parseFloat(tickerData.data.priceChangePercent),
                high24h: parseFloat(tickerData.data.highPrice),
                low24h: parseFloat(tickerData.data.lowPrice)
            };
            
            const signal = aiEngine.analyzeMarket(symbol, marketData, sessionId);
            
            if (signal.action !== 'HOLD') {
                const positionSize = aiEngine.calculatePositionSize(
                    tradeData.initialInvestment,
                    tradeData.currentProfit || 0,
                    tradeData.targetProfit,
                    timeElapsed,
                    tradeData.timeLimit,
                    signal.confidence,
                    sessionId
                );
                
                const orderResult = await BinanceAPI.placeMarketOrder(
                    session.apiKey,
                    session.secretKey,
                    symbol,
                    signal.action,
                    positionSize,
                    session.useTestnet
                );
                
                if (orderResult.success) {
                    const currentTicker = await BinanceAPI.getTicker(symbol, session.useTestnet);
                    const currentPrice = currentTicker.success ? parseFloat(currentTicker.data.lastPrice) : marketPrice;
                    const entryPrice = orderResult.price || marketPrice;
                    
                    let profit = 0;
                    if (signal.action === 'BUY') {
                        profit = (currentPrice - entryPrice) * orderResult.executedQty;
                    } else {
                        profit = (entryPrice - currentPrice) * orderResult.executedQty;
                    }
                    
                    if (profit > 0) {
                        winStreaks[sessionId] = (winStreaks[sessionId] || 0) + 1;
                    } else {
                        winStreaks[sessionId] = 0;
                    }
                    
                    const newProfit = (tradeData.currentProfit || 0) + profit;
                    
                    // Update in Supabase
                    await supabase
                        .from('trading_sessions')
                        .update({ 
                            currentProfit: newProfit,
                            lastTradeTime: now
                        })
                        .eq('id', session.activeBot);
                    
                    const tradeRecord = {
                        symbol: symbol,
                        side: signal.action,
                        quantity: orderResult.executedQty.toFixed(6),
                        price: entryPrice.toFixed(2),
                        profit: profit,
                        size: '$' + positionSize.toFixed(2),
                        confidence: (signal.confidence * 100).toFixed(0) + '%',
                        winStreak: winStreaks[sessionId],
                        timestamp: new Date().toISOString(),
                        session_id: sessionId,
                        bot_id: session.activeBot
                    };
                    
                    // Store trade in Supabase
                    await supabase
                        .from('trades')
                        .insert([tradeRecord]);
                    
                    newTrades.push(tradeRecord);
                    
                    if (newProfit >= tradeData.targetProfit) {
                        await supabase
                            .from('trading_sessions')
                            .update({ targetReached: true, isRunning: false })
                            .eq('id', session.activeBot);
                        session.activeBot = null;
                    }
                    
                    console.log(`📊 Trade: ${signal.action} $${positionSize.toFixed(2)} ${symbol} - Profit: $${profit.toFixed(2)}`);
                }
            }
        }
    }
    
    if (timeElapsed >= tradeData.timeLimit) {
        await supabase
            .from('trading_sessions')
            .update({ timeExceeded: true, isRunning: false })
            .eq('id', session.activeBot);
        session.activeBot = null;
    }
    
    let balance = { free: session.useTestnet ? 10000 : 0 };
    if (!session.useTestnet) {
        const balanceData = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey, false);
        if (balanceData.success) {
            balance = balanceData;
        }
    }
    
    // Get updated trade data
    const { data: updatedTrade } = await supabase
        .from('trading_sessions')
        .select('*')
        .eq('id', session.activeBot)
        .single();
    
    res.json({ 
        success: true, 
        currentProfit: updatedTrade?.currentProfit || 0,
        timeRemaining: timeRemaining.toFixed(2),
        targetReached: updatedTrade?.targetReached || false,
        timeExceeded: updatedTrade?.timeExceeded || false,
        newTrades: newTrades,
        balance: balance.free,
        winStreak: winStreaks[sessionId] || 0
    });
});

app.post('/api/balance', async (req, res) => {
    const { sessionId } = req.body;
    
    const session = activeSessions[sessionId];
    if (!session) {
        return res.status(401).json({ success: false, message: 'Invalid session' });
    }
    
    const balance = await BinanceAPI.getAccountBalance(session.apiKey, session.secretKey, session.useTestnet);
    
    res.json({
        success: balance.success,
        balance: balance.success ? balance.free : 0,
        error: balance.error
    });
});

// Get trade history
app.post('/api/trades', async (req, res) => {
    const { sessionId } = req.body;
    
    const { data: trades, error } = await supabase
        .from('trades')
        .select('*')
        .eq('session_id', sessionId)
        .order('timestamp', { ascending: false })
        .limit(50);
    
    if (error) {
        return res.json({ success: false, trades: [] });
    }
    
    res.json({ success: true, trades });
});

// Serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('🌙 HALAL AI TRADING BOT - SUPABASE DEPLOYMENT');
    console.log('='.repeat(60));
    console.log(`✅ Server running on port: ${PORT}`);
    console.log(`✅ Supabase integrated for data storage`);
    console.log(`✅ Time sync and rate limit protection active`);
    console.log(`✅ SAFE MODE: 60 seconds between trades`);
    console.log('='.repeat(60) + '\n');
});
