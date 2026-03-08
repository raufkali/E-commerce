const Wallet = require("../models/Wallet");

// Lock funds when order is created (escrow)
const lockFundsForOrder = async (userId, amount, orderId) => {
  const wallet = await Wallet.findOne({ user: userId });

  if (!wallet) {
    throw new Error("Wallet not found");
  }

  if (!wallet.hasSufficientBalance(amount, "available")) {
    throw new Error("Insufficient balance");
  }

  wallet.availableBalance -= amount;
  wallet.lockedBalance += amount;

  await wallet.addTransaction({
    type: "debit",
    amount: -amount,
    status: "locked",
    description: `Funds locked for order #${orderId}`,
    reference: orderId,
  });

  await wallet.save();

  return wallet;
};

// Release funds to seller (when buyer confirms)
const releaseFundsToSeller = async (sellerId, amount, orderId) => {
  const wallet = await Wallet.findOne({ user: sellerId });

  if (!wallet) {
    throw new Error("Seller wallet not found");
  }

  wallet.availableBalance += amount;
  wallet.totalEarned += amount;

  await wallet.addTransaction({
    type: "credit",
    amount: amount,
    status: "available",
    description: `Funds released from escrow for order #${orderId}`,
    reference: orderId,
  });

  await wallet.save();

  return wallet;
};

// Refund to buyer (when order cancelled)
const refundToBuyer = async (buyerId, amount, orderId) => {
  const wallet = await Wallet.findOne({ user: buyerId });

  if (!wallet) {
    throw new Error("Buyer wallet not found");
  }

  wallet.availableBalance += amount;

  await wallet.addTransaction({
    type: "credit",
    amount: amount,
    status: "available",
    description: `Refund for cancelled order #${orderId}`,
    reference: orderId,
  });

  await wallet.save();

  return wallet;
};

module.exports = {
  lockFundsForOrder,
  releaseFundsToSeller,
  refundToBuyer,
};
