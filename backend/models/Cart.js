const mongoose = require("mongoose");

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,

      ref: "User",

      required: true,
    },

    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,

          ref: "Product",

          required: true,
        },

        quantity: {
          type: Number,

          required: true,

          min: 1,
        },

        price: {
          type: Number,

          required: true,
        },

        subtotal: {
          type: Number,

          default: 0,
        },
      },
    ],

    totalPrice: {
      type: Number,

      default: 0,
    },
  },
  { timestamps: true },
);

cartSchema.pre("save", function (next) {
  let total = 0;

  this.items.forEach((item) => {
    total += item.price * item.quantity;
  });

  this.totalPrice = total;

  next();
});

module.exports = mongoose.model("Cart", cartSchema);
