const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      enum: ["credit", "debit", "refund", "withdrawal", "fee"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "usd",
    },
    status: {
      type: String,
      enum: ["pending", "locked", "available", "completed", "failed"],
      default: "pending",
    },
    description: {
      type: String,
      required: true,
    },
    reference: {
      type: String, // Order ID, Payment Intent ID, etc.
    },
    stripePaymentIntentId: String,
    stripePayoutId: String,
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
    balance: {
      type: Number, // Running balance after this transaction
    },
  },
  { timestamps: true },
);

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    role: {
      type: String,
      enum: ["buyer", "seller", "both"],
      default: "buyer",
    },
    // Balances
    lockedBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    availableBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    pendingWithdrawal: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalEarned: {
      type: Number,
      default: 0,
    },
    totalWithdrawn: {
      type: Number,
      default: 0,
    },
    totalSpent: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: "usd",
    },
    // Stripe Connect info (for sellers)
    stripeAccountId: String,
    stripeAccountStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    bankAccountLast4: String,
    bankAccountName: String,
    // Settings
    autoWithdrawal: {
      type: Boolean,
      default: false,
    },
    autoWithdrawalThreshold: {
      type: Number,
      default: 100, // Auto withdraw when balance reaches $100
    },
    // Timestamps
    lastTransactionAt: Date,
    lastWithdrawalAt: Date,
    // Transactions history
    transactions: [transactionSchema],
  },
  { timestamps: true },
);

// Indexes for better query performance
walletSchema.index({ user: 1 });
walletSchema.index({ "transactions.transactionId": 1 });
walletSchema.index({ "transactions.createdAt": -1 });

// Method to add transaction
walletSchema.methods.addTransaction = async function (transactionData) {
  const transaction = {
    transactionId: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    ...transactionData,
    balance: this.availableBalance + this.lockedBalance,
  };

  this.transactions.push(transaction);
  this.lastTransactionAt = new Date();

  return transaction;
};

// Method to check if user has sufficient balance
walletSchema.methods.hasSufficientBalance = function (
  amount,
  type = "available",
) {
  if (type === "available") {
    return this.availableBalance >= amount;
  } else if (type === "locked") {
    return this.lockedBalance >= amount;
  }
  return false;
};

// Static method to get or create wallet
walletSchema.statics.getOrCreateWallet = async function (
  userId,
  role = "buyer",
) {
  let wallet = await this.findOne({ user: userId });

  if (!wallet) {
    wallet = await this.create({
      user: userId,
      role: role,
    });
  }

  return wallet;
};

module.exports = mongoose.model("Wallet", walletSchema);
