const Category = require("../models/Category");
const asyncHandler = require("express-async-handler");

const createCategory = asyncHandler(async (req, res) => {
  const { name, description, isActive } = req.body;
  if (!name || !description) {
    res.status(400);
    throw new Error("ERROR! Name or Description is missing!");
  }
  // check for the category if exsists
  const isAvail = await Category.findOne({ name });
  if (isAvail) {
    res.status(400);
    throw new Error("ERROR! can't create this category, Already exsists");
  }
  // create it
  const newCategory = await Category.create({
    name,
    description,
    isActive,
  });
  res.status(201).json({
    status: "Success",
    message: "Category Created!",
    category: newCategory,
  });
});

const getOneCategory = asyncHandler(async (req, res) => {});

const getAllCategories = asyncHandler(async (req, res) => {});

const updateCategory = asyncHandler(async (req, res) => {});

const deleteCategory = asyncHandler(async (req, res) => {});

const getProductByCategory = asyncHandler(async (req, res) => {});

module.exports = {
  createCategory,
  getOneCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  getProductByCategory,
};
