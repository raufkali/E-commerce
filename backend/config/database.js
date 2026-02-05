const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const connect = await mongoose.connect(
      "mongodb://127.0.0.1:27017/E-commerce",
    );
    console.log("MONGODB Connected Successfully!");
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

module.exports = connectDB;
