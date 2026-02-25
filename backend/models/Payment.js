const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    gateway: {
      type: String,
      required: true,
    },

    transactionId: {
      type: String,
    },

    paymentStatus: {
      type: String,

      enum: ["pending", "success", "failed", "cancelled"],

      default: "pending",
    },

    gatewayResponse: {
      type: Object,
    },

    paidAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model("Payment", paymentSchema);
