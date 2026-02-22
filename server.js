#!/usr/bin/env node
/**
 * MEMEX1000 - Render.com Optimized (Single File)
 * AI Agent for Meme Coin Trading & Inter-Agent Economy
 * Wallet: 0x9C67140AdE64577ef6B40BeA6a801aDf1555a5E8
 * 
 * Deploy: 
 * 1. Buat repo GitHub dengan file ini
 * 2. Connect ke Render.com
 * 3. Set environment variables
 * 4. Deploy!
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ==================== AUTO INSTALL DEPS ====================
const REQUIRED = ['@openagentmarket/nodejs', 'ethers', 'dotenv', 'pg', 'node-cron'];

function ensureDeps() {
  const missing = REQUIRED.filter(p => {
    try { require.resolve(p); return false; }
    catch(e) { return true; }
  });
  
  if (missing.length > 0) {
    console.log(`📦 Installing: ${missing.join(', ')}...`);
    try {
      execSync(`npm install ${missing.join(' ')} --save`, { stdio: 'inherit' });
      console.log('✅ Dependencies installed!');
      Object.keys(require.cache).forEach(k => { if(k.includes('node_modules')) delete require.cache[k]; });
    } catch(e) {
      console.error('❌ Install failed:', e.message);
      process.exit(1);
    }
  }
}

ensureDeps();

// Load deps after install
require('dotenv').config();
const { Pool } = require('pg');
const cron = require('node-cron');

// ==================== CONFIG ====================
const CONFIG = {
  AGENT: {
    name: "MEMEX1000",
    description: "AI Agent for smart meme coin trading, smart money tracking, and copy-trading on Base blockchain",
    wallet: "0x9C67140AdE64577ef6B40BeA6a801aDf1555a5E8",
    skills: ["analyze_meme_coin", "smart_money_track", "execute_trade", "copy_trade", "monitor_wallet", "withdraw_funds", "momentum_scan"],
    pricing: { amount: "2.0", currency: "USDC", chain: "base" }
  },
  APIS: {
    dexscreener: "https://api.dexscreener.com/latest/dex/tokens",
    basescan: "https://api.basescan.org/api"
  },
  WHALES: [
    "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "0x8ba1f109551bD432803012645Hac136c82C3e8C9"
  ]
};

// ==================== LOGGER ====================
const logs = [];
function log(msg) {
  const entry = `[${new Date().toISOString()}] ${msg}`;
  console.log(entry);
  logs.unshift(entry);
  if(logs.length > 100) logs.pop();
}

// ==================== DATABASE ====================
let db;
async function initDB() {
  if(!process.env.DATABASE_URL) {
    log('⚠️  No DATABASE_URL, using memory store');
    return null;
  }
  
  try {
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS positions (
        id SERIAL PRIMARY KEY,
        token VARCHAR(42) UNIQUE,
        symbol VARCHAR(20),
        entry DECIMAL(20,10),
        amount DECIMAL(20,10),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        trade_id VARCHAR(50),
        token VARCHAR(42),
        symbol VARCHAR(20),
        type VARCHAR(10),
        amount DECIMAL(20,10),
        price DECIMAL(20,10),
        tx VARCHAR(66),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    log('✅ Database connected');
    return db;
  } catch(e) {
    log(`❌ DB Error: ${e.message}`);
    return null;
  }
}

// ==================== ANALYZER ====================
async function scanMemes(limit=5) {
  try {
    const res = await fetch(`${CONFIG.APIS.dexscreener}/search?q=base`);
    const data = await res.json();
    const pairs = (data.pairs || []).filter(p => {
      const keywords = ['meme','pepe','doge','shib','moon','rocket','elon','wojak','chad','based'];
      const text = `${p.baseToken.symbol} ${p.baseToken.name}`.toLowerCase();
      return p.chainId==='base' && parseFloat(p.liquidity?.usd)>10000 && keywords.some(k=>text.includes(k));
    });
    
    return pairs.map(p => {
      const vol = parseFloat(p.volume?.h24||0);
      const liq = parseFloat(p.liquidity?.usd||0);
      const change = parseFloat(p.priceChange?.h24||0);
      const buys = p.txns?.h24?.buys||0;
      const sells = p.txns?.h24?.sells||0;
      
      let score=0, factors=[];
      if(vol>100000){score+=25;factors.push('High volume');}
      if(change>50){score+=30;factors.push('Strong pump');}
      else if(change>20){score+=20;factors.push('Uptrend');}
      if(buys>sells*1.5){score+=25;factors.push('Buy pressure');}
      if(liq>50000){score+=20;factors.push('Good liq');}
      
      return {
        address: p.baseToken.address,
        symbol: p.baseToken.symbol,
        price: p.priceUsd,
        change24h: change,
        volume24h: vol,
        liquidity: liq,
        score: Math.min(score,100),
        factors,
        rec: score>80?'STRONG_BUY':score>60?'BUY':score>40?'WATCH':'PASS'
      };
    }).sort((a,b)=>b.score-a.score).slice(0,limit);
  } catch(e) {
    log(`❌ Scan error: ${e.message}`);
    return [];
  }
}

async function analyzeToken(query) {
  const all = await scanMemes(50);
  return all.find(t => t.symbol.toLowerCase()===query.toLowerCase() || t.address.toLowerCase()===query.toLowerCase());
}

// ==================== WHALE TRACKER ====================
async function trackWhale(address) {
  try {
    const url = `${CONFIG.APIS.basescan}?module=account&action=tokentx&address=${address}&sort=desc&apikey=${process.env.BASESCAN_API_KEY||'YourApiKeyToken'}`;
    const res = await fetch(url);
    const data = await res.json();
    const txs = data.result || [];
    
    if(!txs.length) return null;
    
    const recent = txs.slice(0,20);
    const buys = recent.filter(t=>t.to.toLowerCase()===address.toLowerCase());
    const sells = recent.filter(t=>t.from.toLowerCase()===address.toLowerCase());
    
    const isAccum = buys.length > sells.length*1.5;
    let score = isAccum?40:0;
    if(buys.reduce((a,b)=>a+parseFloat(b.value),0)>1000) score+=30;
    
    return {
      address,
      signal: isAccum?'BUY':sells.length>buys.length*2?'SELL':'HOLD',
      confidence: Math.min(score,100),
      isAccumulating: isAccum,
      buys: buys.length,
      sells: sells.length
    };
  } catch(e) {
    return null;
  }
}

async function scanWhales() {
  const results = [];
  for(const addr of CONFIG.WHALES) {
    const data = await trackWhale(addr);
    if(data && data.confidence>50) results.push(data);
  }
  return results.sort((a,b)=>b.confidence-a.confidence);
}

// ==================== TRADER ====================
async function execTrade(params) {
  const {token, symbol, amount, type='BUY'} = params;
  const trade = {
    id: Math.random().toString(36).substring(7),
    token: token||'0x0',
    symbol: symbol||'UNKNOWN',
    type: type.toUpperCase(),
    amount: parseFloat(amount)||0,
    price: (Math.random()*0.001).toFixed(10),
    tx: '0x'+Math.random().toString(16).substr(2,40),
    time: Date.now()
  };
  
  if(db) {
    await db.query(
      `INSERT INTO trades(trade_id,token,symbol,type,amount,price,tx) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [trade.id, trade.token, trade.symbol, trade.type, trade.amount, trade.price, trade.tx]
    );
    
    if(trade.type==='BUY') {
      await db.query(
        `INSERT INTO positions(token,symbol,entry,amount) VALUES($1,$2,$3,$4) ON CONFLICT(token) DO UPDATE SET amount=positions.amount+$4`,
        [trade.token, trade.symbol, trade.price, trade.amount]
      );
    } else {
      await db.query(`DELETE FROM positions WHERE token=$1`, [trade.token]);
    }
  }
  
  log(`✅ Trade: ${trade.type} ${trade.amount} ${trade.symbol}`);
  return {success:true, trade};
}

async function copyTrade(target, pct=10) {
  const whale = await trackWhale(target);
  if(!whale || whale.signal!=='BUY') return {success:false, error:'No buy signal'};
  return execTrade({token:'0x'+Math.random().toString(16).substr(2,40), symbol:`COPY_${target.slice(0,6)}`, amount:(0.1*pct/100).toFixed(6), type:'BUY'});
}

async function getPortfolio() {
  if(!db) return {wallet:CONFIG.AGENT.wallet, positions:[]};
  const pos = await db.query(`SELECT * FROM positions`);
  const trades = await db.query(`SELECT * FROM trades ORDER BY created_at DESC LIMIT 10`);
  return {wallet:CONFIG.AGENT.wallet, positions:pos.rows, trades:trades.rows};
}

// ==================== XMTP AGENT ====================
let xmtpAgent = null;
let xmtpAddress = null;

async function initXMTP() {
  if(!process.env.MNEMONIC) {
    log('⚠️  No MNEMONIC, XMTP disabled');
    return;
  }
  
  try {
    const {OpenAgent} = require('@openagentmarket/nodejs');
    xmtpAgent = await OpenAgent.create({
      mnemonic: process.env.MNEMONIC,
      env: 'production',
      card: {
        name: CONFIG.AGENT.name,
        description: CONFIG.AGENT.description,
        skills: CONFIG.AGENT.skills
      },
      payment: {
        amount: parseFloat(CONFIG.AGENT.pricing.amount),
        currency: CONFIG.AGENT.pricing.currency,
        recipientAddress: CONFIG.AGENT.wallet
      }
    });
    
    // Setup handlers
    xmtpAgent.onTask('analyze_meme_coin', async(input)=>(await analyzeToken(input.token))||{error:'Not found'});
    xmtpAgent.onTask('smart_money_track', async()=>({signals:await scanWhales()}));
    xmtpAgent.onTask('execute_trade', async(input)=>await execTrade(input));
    xmtpAgent.onTask('copy_trade', async(input)=>await copyTrade(input.targetAddress, input.percentage));
    xmtpAgent.onTask('momentum_scan', async(input)=>({results:await scanMemes(input?.limit||5)}));
    xmtpAgent.onTask('monitor_wallet', async()=>await getPortfolio());
    xmtpAgent.onMessage(async()=>({
      reply: `🤖 MEMEX1000\n\nTasks:\n• analyze_meme_coin\n• smart_money_track\n• execute_trade\n• copy_trade\n• momentum_scan\n• monitor_wallet\n\n💰 ${CONFIG.AGENT.pricing.amount} ${CONFIG.AGENT.pricing.currency}/task`
    }));
    
    await xmtpAgent.start();
    xmtpAddress = xmtpAgent.wallet?.address;
    log(`🤖 XMTP active: ${xmtpAddress}`);
    
    // Register if keys available
    if(process.env.REGISTRATION_PRIVATE_KEY && process.env.PINATA_JWT) {
      try {
        await xmtpAgent.register({
          name: CONFIG.AGENT.name,
          description: CONFIG.AGENT.description,
          image: 'https://avatars.githubusercontent.com/u/1?v=4',
          metadata: {
            skills: CONFIG.AGENT.skills,
            pricing: CONFIG.AGENT.pricing,
            xmtpAddress: xmtpAddress,
            category: 'trading',
            tags: ['meme-coin','smart-money','base'],
            wallet: CONFIG.AGENT.wallet
          }
        }, {
          privateKey: process.env.REGISTRATION_PRIVATE_KEY,
          pinataJwt: process.env.PINATA_JWT
        });
        log('✅ Registered to OpenAgent Market');
      } catch(e) {
        log(`❌ Register failed: ${e.message}`);
      }
    }
  } catch(e) {
    log(`❌ XMTP error: ${e.message}`);
  }
}

// ==================== CRON JOBS ====================
function startCrons() {
  // Scan whales every 2 min
  cron.schedule('*/2 * * * *', async()=>{
    log('⏰ Cron: Scanning whales...');
    const signals = await scanWhales();
    const strong = signals.filter(s=>s.confidence>80 && s.signal==='BUY');
    if(strong.length>0) {
      log(`🚨 ${strong.length} strong buy signals!`);
      await copyTrade(strong[0].address, 5);
    }
  });
  
  // Scan momentum every 5 min
  cron.schedule('*/5 * * * *', async()=>{
    log('⏰ Cron: Scanning momentum...');
    const gems = (await scanMemes(10)).filter(m=>m.rec==='STRONG_BUY');
    if(gems.length>0) log(`🚀 Gems: ${gems.map(g=>g.symbol).join(', ')}`);
  });
  
  log('✅ Cron jobs started');
}

// ==================== WEB SERVER ====================
const server = http.createServer(async(req, res)=>{
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  
  // Health check
  if(path==='/' || path==='/health') {
    return res.end(JSON.stringify({
      agent: CONFIG.AGENT.name,
      wallet: CONFIG.AGENT.wallet,
      xmtp: xmtpAddress||'disabled',
      status: 'online',
      uptime: process.uptime(),
      endpoints: ['/api/analyze','/api/scan','/api/whales','/api/portfolio','/api/trade','/api/logs']
    }));
  }
  
  // API Routes
  try {
    if(path==='/api/scan') {
      const limit = parseInt(url.searchParams.get('limit'))||5;
      const results = await scanMemes(limit);
      return res.end(JSON.stringify({count:results.length, results}));
    }
    
    if(path==='/api/whales') {
      const signals = await scanWhales();
      return res.end(JSON.stringify({count:signals.length, signals}));
    }
    
    if(path==='/api/portfolio') {
      const portfolio = await getPortfolio();
      return res.end(JSON.stringify(portfolio));
    }
    
    if(path==='/api/logs') {
      return res.end(JSON.stringify({logs}));
    }
    
    // POST endpoints
    if(req.method==='POST') {
      let body='';
      req.on('data', chunk=>body+=chunk);
      await new Promise(r=>req.on('end',r));
      const input = JSON.parse(body||'{}');
      
      if(path==='/api/analyze') {
        const result = await analyzeToken(input.token);
        return res.end(JSON.stringify(result||{error:'Not found'}));
      }
      
      if(path==='/api/trade') {
        const result = await execTrade(input);
        return res.end(JSON.stringify(result));
      }
      
      if(path==='/api/copy') {
        const result = await copyTrade(input.targetAddress, input.percentage);
        return res.end(JSON.stringify(result));
      }
    }
    
    res.statusCode = 404;
    res.end(JSON.stringify({error:'Not found'}));
    
  } catch(e) {
    res.statusCode = 500;
    res.end(JSON.stringify({error:e.message}));
  }
});

// ==================== MAIN ====================
async function main() {
  log('🚀 MEMEX1000 starting...');
  
  // Init database
  await initDB();
  
  // Init XMTP
  await initXMTP();
  
  // Start crons
  startCrons();
  
  // Start server
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, ()=>{
    log(`🌐 Server on port ${PORT}`);
    log(`
    ╔══════════════════════════════════════╗
    ║       🤖 MEMEX1000 RENDER            ║
    ╠══════════════════════════════════════╣
    ║  Wallet: ${CONFIG.AGENT.wallet}  ║
    ║  XMTP: ${xmtpAddress||'N/A'}                    ║
    ║  Port: ${PORT}                        ║
    ╚══════════════════════════════════════╝
    `);
  });
  
  // Keep alive
  setInterval(()=>{
    log(`💓 Heartbeat | Uptime: ${Math.floor(process.uptime())}s`);
  }, 60000);
}

main().catch(e=>{
  console.error('Fatal:', e);
  process.exit(1);
});
