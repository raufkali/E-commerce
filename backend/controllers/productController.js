const Product = require("../models/Product");

const getAllProducts = async (req, res) => {
  try {
    const products = await Product.find();
    res.status(200).json({
      message: "Success! Get All Products",
      products,
    });
  } catch (error) {
    res.status(400).json({
      message: "ERROR! while getting products",
      error: error.message,
    });
  }
};
const createProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      category,
      discount,
      stock,
      images,
      isActive,
    } = req.body;
    //   validation
    if (!name || !description || price == null || !category) {
      return res.status(400).json({ message: "ERROR! invalid Arguments" });
    }
    if (!req.user) {
      return res
        .status(401)
        .json({ message: "Unauthorized! Can't create product" });
    }
    const sellerId = req.user.id;
    //   checking for the same product
    const exsisted = await Product.findOne({ name, sellerId, category });
    if (exsisted) {
      return res
        .status(409)
        .json({ message: "ERROR! Product Already Exsists" });
    }
    const newProduct = await Product.create({
      name: name.toLowerCase(),
      description,
      price,
      category,
      discount,
      stock,
      images: images || [],
      sellerId,
    });
    res.status(201).json({
      message: "Success! Product Created",
      body: {
        newProduct,
      },
    });
  } catch (error) {
    res.status(400).json({
      message: "ERROR! while creating product",
      error: error.message,
    });
  }
};
const getOneProduct = async (req, res) => {};
const updateProduct = async (req, res) => {};
const deleteProduct = async (req, res) => {};

module.exports = {
  getAllProducts,
  createProduct,
  deleteProduct,
  getOneProduct,
  updateProduct,
};
