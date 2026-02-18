const Order = require("../models/Order");
const asyncHandler = require("express-async-handler");

const createOrder = asyncHandler(async (req, res) => {});

const getMyOrders = asyncHandler(async (req, res) => {});

const getOrderById = asyncHandler(async (req, res) => {});

const getAllOrders = asyncHandler(async (req, res) => {});

const updateOrderStatus = asyncHandler(async (req, res) => {});

const cancelOrder = asyncHandler(async (req, res) => {});

const getSellerOrders = asyncHandler(async (req, res) => {});

module.exports = {
  createOrder,
  getMyOrders,
  updateOrderStatus,
  cancelOrder,
  getOrderById,
  getAllOrders,
  getSellerOrders,
};
