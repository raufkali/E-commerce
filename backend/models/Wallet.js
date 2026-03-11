const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    sender: {
      type: String,
      required: true,
    },
    receiver: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["send", "received", "refund", "withdrawal"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
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
      type: String,
    },
    stripePaymentIntentId: String,
    stripePayoutId: String,
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
      enum: ["user", "seller", "admin"],
      default: "user",
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
    stripeAccountId: String,
    stripeAccountStatus: {
      type: String,
      enum: ["pending", "verified", "rejected"],
      default: "pending",
    },
    bankAccountLast4: String,
    bankAccountName: String,
    lastTransactionAt: Date,
    lastWithdrawalAt: Date,
    transactions: [transactionSchema],
  },
  { timestamps: true },
);

module.exports = mongoose.model("Wallet", walletSchema);
