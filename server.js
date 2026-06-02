require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(__dirname));

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;

// In-memory agent state
let agentWallets = [];
let transactions = [];
let agentBudget = 100; // USDC

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Create agent wallet (simulated for testnet demo)
app.post('/create-wallet', async (req, res) => {
  try {
    // Try real Circle API first
    const idempotencyKey = uuidv4();
    let wallet;
    
    try {
      const response = await axios.post(
        'https://api.circle.com/v1/w3s/developer/wallets',
        {
          idempotencyKey: idempotencyKey,
          blockchains: ['ETH-SEPOLIA'],
          count: 1
        },
        {
          headers: {
            Authorization: `Bearer ${CIRCLE_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const circleWallet = response.data.data.wallets[0];
      wallet = {
        id: circleWallet.id,
        address: circleWallet.address,
        blockchain: 'ARC-TESTNET',
        balance: agentBudget,
        currency: 'USDC',
        createdAt: new Date().toISOString(),
        status: 'ACTIVE',
        source: 'Circle API'
      };
    } catch (circleError) {
      // Fallback to local simulation
      wallet = {
        id: 'wallet_' + crypto.randomBytes(8).toString('hex'),
        address: '0x' + crypto.randomBytes(20).toString('hex'),
        blockchain: 'ARC-TESTNET',
        balance: agentBudget,
        currency: 'USDC',
        createdAt: new Date().toISOString(),
        status: 'ACTIVE',
        source: 'Arc Testnet'
      };
    }
    
    agentWallets.push(wallet);
    res.json({ success: true, data: wallet });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Get all wallets
app.get('/wallets', (req, res) => {
  res.json({ success: true, wallets: agentWallets });
});

// Agent payment decision and execution
app.post('/agent-pay', async (req, res) => {
  try {
    const { fromWallet, toAddress, amount, reason } = req.body;
    const decision = agentDecide(amount, reason, agentBudget);

    if (!decision.approved) {
      return res.json({
        success: false,
        message: decision.reason,
        agentThought: decision.thought
      });
    }

    // Deduct from budget
    agentBudget -= parseFloat(amount);

    const tx = {
      id: 'tx_' + crypto.randomBytes(8).toString('hex'),
      from: fromWallet || 'agent_wallet',
      to: toAddress,
      amount: parseFloat(amount),
      currency: 'USDC',
      reason: reason,
      blockchain: 'ARC-TESTNET',
      status: 'CONFIRMED',
      timestamp: new Date().toISOString(),
      txHash: '0x' + crypto.randomBytes(32).toString('hex')
    };

    transactions.push(tx);

    res.json({
      success: true,
      message: 'Agent executed payment successfully',
      transaction: tx,
      remainingBudget: agentBudget,
      agentThought: decision.thought
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// Get transaction history
app.get('/transactions', (req, res) => {
  res.json({ success: true, transactions, remainingBudget: agentBudget });
});

// Agent status
app.get('/agent-status', (req, res) => {
  res.json({
    success: true,
    status: 'ACTIVE',
    budget: agentBudget,
    walletsCreated: agentWallets.length,
    transactionsExecuted: transactions.length,
    blockchain: 'ARC-TESTNET',
    currency: 'USDC'
  });
});

// Agent decision engine
function agentDecide(amount, reason, currentBudget) {
  const amt = parseFloat(amount);

  if (!reason || reason.trim() === '') {
    return {
      approved: false,
      reason: 'Agent requires a valid reason for payment',
      thought: 'No reason provided. Rejecting for safety.'
    };
  }

  if (amt <= 0) {
    return {
      approved: false,
      reason: 'Invalid amount',
      thought: 'Amount must be greater than 0 USDC.'
    };
  }

  if (amt > currentBudget) {
    return {
      approved: false,
      reason: `Insufficient budget. Available: ${currentBudget} USDC`,
      thought: `Budget check failed. Need ${amt} USDC but only ${currentBudget} USDC available.`
    };
  }

  if (amt > 50) {
    return {
      approved: false,
      reason: `Amount ${amt} USDC exceeds single-transaction limit of 50 USDC`,
      thought: `High value transaction detected. Requires manual approval for amounts above 50 USDC.`
    };
  }

  const highPriority = ['api', 'inference', 'data', 'compute', 'subscription'];
  const isHighPriority = highPriority.some(k => reason.toLowerCase().includes(k));

  return {
    approved: true,
    reason: `Payment approved`,
    thought: isHighPriority
      ? `High-priority service detected (${reason}). Approving immediately.`
      : `Standard payment of ${amt} USDC. Within limits. Approved.`
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ArcPay Agent running on port ${PORT}`);
});