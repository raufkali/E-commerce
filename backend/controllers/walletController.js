const asyncHandler = require("express-async-handler");
const Wallet = require("../models/Wallet");
const User = require("../models/User");
const stripe = require("../config/stripe");

// Helper function to add transaction
const addTransaction = async (wallet, transactionData) => {
  const transaction = {
    sender: transactionData.sender || "system",
    receiver: transactionData.receiver || wallet.user.toString(),
    type: transactionData.type,
    amount: transactionData.amount,
    status: transactionData.status || "pending",
    description: transactionData.description,
    reference: transactionData.reference,
    stripePaymentIntentId: transactionData.stripePaymentIntentId,
    stripePayoutId: transactionData.stripePayoutId,
  };

  wallet.transactions.push(transaction);
  wallet.lastTransactionAt = new Date();
  return transaction;
};

// @desc    Get current user's wallet
// @route   GET /api/wallet/me
// @access  Private
const getMyWallet = asyncHandler(async (req, res) => {
  let wallet = await Wallet.findOne({ user: req.user.id });

  if (!wallet) {
    // Create wallet if it doesn't exist
    wallet = await Wallet.create({
      user: req.user.id,
      role: req.user.role,
    });
  }

  res.json({
    success: true,
    wallet: {
      id: wallet._id,
      lockedBalance: wallet.lockedBalance,
      availableBalance: wallet.availableBalance,
      pendingWithdrawal: wallet.pendingWithdrawal,
      totalEarned: wallet.totalEarned,
      totalWithdrawn: wallet.totalWithdrawn,
      totalSpent: wallet.totalSpent,
      currency: wallet.currency,
      bankAccountLast4: wallet.bankAccountLast4,
      bankAccountName: wallet.bankAccountName,
      lastTransactionAt: wallet.lastTransactionAt,
      lastWithdrawalAt: wallet.lastWithdrawalAt,
    },
  });
});

// @desc    Get wallet balance
// @route   GET /api/wallet/balance
// @access  Private
const getBalance = asyncHandler(async (req, res) => {
  const wallet = await Wallet.findOne({ user: req.user.id });

  if (!wallet) {
    return res.json({
      success: true,
      balances: {
        locked: 0,
        available: 0,
        pending: 0,
        total: 0,
      },
      currency: "usd",
    });
  }

  res.json({
    success: true,
    balances: {
      locked: wallet.lockedBalance,
      available: wallet.availableBalance,
      pending: wallet.pendingWithdrawal,
      total: wallet.lockedBalance + wallet.availableBalance,
    },
    currency: wallet.currency,
  });
});

// @desc    Get transaction history
// @route   GET /api/wallet/transactions
// @access  Private
const getTransactions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, type } = req.query;

  const wallet = await Wallet.findOne({ user: req.user.id });

  if (!wallet) {
    return res.json({
      success: true,
      transactions: [],
      pagination: {
        total: 0,
        page: parseInt(page),
        pages: 0,
      },
    });
  }

  // Filter transactions
  let transactions = [...wallet.transactions].reverse(); // Latest first

  if (type) {
    transactions = transactions.filter((t) => t.type === type);
  }

  // Paginate
  const startIndex = (page - 1) * limit;
  const paginatedTransactions = transactions.slice(
    startIndex,
    startIndex + limit,
  );

  res.json({
    success: true,
    transactions: paginatedTransactions,
    pagination: {
      total: transactions.length,
      page: parseInt(page),
      pages: Math.ceil(transactions.length / limit),
    },
  });
});

// @desc    Add/update bank account for withdrawals
// @route   POST /api/wallet/bank-account
// @access  Private (Seller only)
const addBankAccount = asyncHandler(async (req, res) => {
  const { accountHolderName, routingNumber, accountNumber, bankName } =
    req.body;

  if (!accountHolderName || !routingNumber || !accountNumber) {
    res.status(400);
    throw new Error("Please provide all bank account details");
  }

  let wallet = await Wallet.findOne({ user: req.user.id });

  if (!wallet) {
    wallet = await Wallet.create({
      user: req.user.id,
      role: "seller",
    });
  }

  wallet.bankAccountLast4 = accountNumber.slice(-4);
  wallet.bankAccountName = accountHolderName;

  await wallet.save();

  // Add transaction record
  await addTransaction(wallet, {
    sender: "system",
    receiver: req.user.id,
    type: "received",
    amount: 0,
    status: "completed",
    description: `Bank account added: ${bankName || "Bank"} ending in ${accountNumber.slice(-4)}`,
  });

  await wallet.save();

  res.json({
    success: true,
    message: "Bank account added successfully",
    bankAccountLast4: wallet.bankAccountLast4,
    bankAccountName: wallet.bankAccountName,
  });
});

// @desc    Withdraw funds to bank account
// @route   POST /api/wallet/withdraw
// @access  Private (Seller only)
const withdrawToBank = asyncHandler(async (req, res) => {
  const { amount } = req.body;

  if (!amount || amount <= 0) {
    res.status(400);
    throw new Error("Please provide a valid amount");
  }

  const wallet = await Wallet.findOne({ user: req.user.id });

  if (!wallet) {
    res.status(404);
    throw new Error("Wallet not found");
  }

  // Check if seller has enough available balance
  if (wallet.availableBalance < amount) {
    res.status(400);
    throw new Error("Insufficient available balance");
  }

  // Check if bank account is set up
  if (!wallet.bankAccountLast4) {
    res.status(400);
    throw new Error("Please add a bank account first");
  }

  // Update wallet balances
  wallet.availableBalance -= amount;
  wallet.pendingWithdrawal += amount;
  wallet.lastWithdrawalAt = new Date();

  // Add transaction record
  await addTransaction(wallet, {
    sender: req.user.id,
    receiver: "bank",
    type: "withdrawal",
    amount: -amount,
    status: "pending",
    description: `Withdrawal request to bank account ending in ${wallet.bankAccountLast4}`,
  });

  await wallet.save();

  res.json({
    success: true,
    message: "Withdrawal request submitted successfully",
    transaction: wallet.transactions[wallet.transactions.length - 1],
    newBalance: {
      available: wallet.availableBalance,
      pending: wallet.pendingWithdrawal,
      locked: wallet.lockedBalance,
    },
  });
});

// @desc    Get withdrawal history
// @route   GET /api/wallet/withdrawals
// @access  Private (Seller only)
const getWithdrawalHistory = asyncHandler(async (req, res) => {
  const wallet = await Wallet.findOne({ user: req.user.id });

  if (!wallet) {
    return res.json({
      success: true,
      withdrawals: [],
    });
  }

  const withdrawals = wallet.transactions
    .filter((t) => t.type === "withdrawal")
    .reverse();

  res.json({
    success: true,
    withdrawals,
  });
});

// @desc    Update withdrawal settings
// @route   PUT /api/wallet/settings
// @access  Private (Seller only)
const updateWithdrawalSettings = asyncHandler(async (req, res) => {
  const { autoWithdrawal, autoWithdrawalThreshold } = req.body;

  const wallet = await Wallet.findOne({ user: req.user.id });

  if (!wallet) {
    res.status(404);
    throw new Error("Wallet not found");
  }

  if (autoWithdrawal !== undefined) {
    wallet.autoWithdrawal = autoWithdrawal;
  }

  if (autoWithdrawalThreshold) {
    wallet.autoWithdrawalThreshold = autoWithdrawalThreshold;
  }

  await wallet.save();

  res.json({
    success: true,
    message: "Withdrawal settings updated",
    settings: {
      autoWithdrawal: wallet.autoWithdrawal,
      autoWithdrawalThreshold: wallet.autoWithdrawalThreshold,
    },
  });
});

// ============================================
// ADMIN FUNCTIONS
// ============================================

// @desc    Get all wallets (admin)
// @route   GET /api/wallet/admin/all
// @access  Private (Admin only)
const adminGetAllWallets = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role } = req.query;

  const query = {};
  if (role) query.role = role;

  const wallets = await Wallet.find(query)
    .populate("user", "fullname email role")
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Wallet.countDocuments(query);

  res.json({
    success: true,
    wallets,
    pagination: {
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
    },
  });
});

// @desc    Adjust wallet balance (admin)
// @route   POST /api/wallet/admin/adjust
// @access  Private (Admin only)
const adminAdjustBalance = asyncHandler(async (req, res) => {
  const { userId, amount, type, reason } = req.body;

  if (!userId || !amount || !type || !reason) {
    res.status(400);
    throw new Error("Please provide all required fields");
  }

  const wallet = await Wallet.findOne({ user: userId });

  if (!wallet) {
    res.status(404);
    throw new Error("Wallet not found");
  }

  let transactionType;
  let description;

  // Adjust balance based on type
  switch (type) {
    case "credit":
      wallet.availableBalance += amount;
      wallet.totalEarned += amount;
      transactionType = "received";
      description = `Admin credited: ${reason}`;
      break;

    case "debit":
      if (wallet.availableBalance < amount) {
        res.status(400);
        throw new Error("Insufficient available balance");
      }
      wallet.availableBalance -= amount;
      transactionType = "send";
      description = `Admin debited: ${reason}`;
      break;

    case "lock":
      if (wallet.availableBalance < amount) {
        res.status(400);
        throw new Error("Insufficient available balance");
      }
      wallet.availableBalance -= amount;
      wallet.lockedBalance += amount;
      transactionType = "send";
      description = `Admin locked funds: ${reason}`;
      break;

    case "unlock":
      if (wallet.lockedBalance < amount) {
        res.status(400);
        throw new Error("Insufficient locked balance");
      }
      wallet.lockedBalance -= amount;
      wallet.availableBalance += amount;
      transactionType = "received";
      description = `Admin unlocked funds: ${reason}`;
      break;

    default:
      res.status(400);
      throw new Error("Invalid adjustment type");
  }

  // Add transaction record
  await addTransaction(wallet, {
    sender:
      type === "credit" || type === "unlock" ? "admin" : wallet.user.toString(),
    receiver:
      type === "debit" || type === "lock" ? "admin" : wallet.user.toString(),
    type: transactionType,
    amount: type === "debit" || type === "lock" ? -amount : amount,
    status: "completed",
    description: description,
    reference: `admin-${Date.now()}`,
  });

  await wallet.save();

  res.json({
    success: true,
    message: "Wallet balance adjusted successfully",
    wallet: {
      lockedBalance: wallet.lockedBalance,
      availableBalance: wallet.availableBalance,
      pendingWithdrawal: wallet.pendingWithdrawal,
    },
  });
});

// @desc    Freeze/unfreeze wallet (admin)
// @route   PUT /api/wallet/admin/freeze/:userId
// @access  Private (Admin only)
const adminFreezeWallet = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { freeze } = req.body;

  const wallet = await Wallet.findOne({ user: userId });

  if (!wallet) {
    res.status(404);
    throw new Error("Wallet not found");
  }

  // Add frozen field if not exists
  if (!wallet.isFrozen) {
    wallet.isFrozen = freeze;
  } else {
    wallet.isFrozen = freeze;
  }

  // Add transaction record
  await addTransaction(wallet, {
    sender: "admin",
    receiver: wallet.user.toString(),
    type: "send",
    amount: 0,
    status: "completed",
    description: freeze ? "Wallet frozen by admin" : "Wallet unfrozen by admin",
    reference: `admin-${Date.now()}`,
  });

  await wallet.save();

  res.json({
    success: true,
    message: freeze ? "Wallet frozen" : "Wallet unfrozen",
    isFrozen: wallet.isFrozen,
  });
});

module.exports = {
  getMyWallet,
  getBalance,
  getTransactions,
  withdrawToBank,
  getWithdrawalHistory,
  addBankAccount,
  updateWithdrawalSettings,
  adminGetAllWallets,
  adminAdjustBalance,
  adminFreezeWallet,
};
