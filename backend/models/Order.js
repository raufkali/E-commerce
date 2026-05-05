const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    shippingFee: { type: Number, default: 0 },

    orderStatus: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "disputed", // ← new: seller rejected refund, awaiting admin
      ],
      default: "pending",
    },

    escrowStatus: {
      type: String,
      enum: ["held", "released", "refunded"],
      default: "held",
    },

    // Auto-release: set when seller marks item as "shipped"
    // 10 days after shipping → auto-release if buyer hasn't acted
    autoReleaseAt: { type: Date, default: null },

    // Dispute fields
    disputeStatus: {
      type: String,
      enum: [
        "none",
        "open", // buyer opened dispute
        "approved", // seller approved refund
        "rejected", // seller rejected, escalated to admin
        "resolved_refund", // admin ruled: refund buyer
        "resolved_release", // admin ruled: release to seller
      ],
      default: "none",
    },
    disputeReason: { type: String, default: "" },
    sellerDisputeNotes: { type: String, default: "" },
    adminNotes: { type: String, default: "" },
    disputeOpenedAt: { type: Date },
    disputeExpiresAt: { type: Date }, // seller must respond within this time
    disputeResolvedAt: { type: Date },

    cancelledAt: Date,
    deliveredAt: Date,
  },
  { _id: false },
);

const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    postalCode: { type: String },
    country: { type: String, default: "Pakistan" },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    orderItems: [orderItemSchema],
    shippingAddress: shippingAddressSchema,

    paymentMethod: {
      type: String,
      required: true,
      enum: ["stripe"],
      default: "stripe",
    },

    stripePaymentIntentId: { type: String, sparse: true },
    stripeClientSecret: { type: String },

    paymentStatus: {
      type: String,
      enum: [
        "pending",
        "requires_payment_method",
        "requires_capture",
        "partial_captured",
        "captured",
        "paid",
        "failed",
        "refunded",
        "partial_refunded",
      ],
      default: "pending",
    },

    escrowStatus: {
      type: String,
      enum: ["held", "partial_released", "released", "refunded"],
      default: "held",
    },

    orderStatus: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      default: "pending",
    },

    itemsPrice: { type: Number, required: true, default: 0 },
    shippingPrice: { type: Number, required: true, default: 0 },
    taxPrice: { type: Number, required: true, default: 0 },
    totalPrice: { type: Number, required: true, default: 0 },

    isPaid: { type: Boolean, default: false },
    paidAt: Date,
    isDelivered: { type: Boolean, default: false },
    isCancelled: { type: Boolean, default: false },
    deliveredAt: Date,
    refundedAt: Date,
    releasedAt: Date,
  },
  { timestamps: true },
);

orderSchema.methods.allItemsDelivered = function () {
  return this.orderItems.every((item) => item.orderStatus === "delivered");
};

orderSchema.methods.hasItemsInEscrow = function () {
  return this.orderItems.some((item) => item.escrowStatus === "held");
};

orderSchema.methods.getCapturedAmount = function () {
  return this.orderItems
    .filter((item) => item.orderStatus === "delivered")
    .reduce(
      (sum, item) => sum + item.price * item.quantity + (item.shippingFee || 0),
      0,
    );
};

module.exports = mongoose.model("Order", orderSchema);
