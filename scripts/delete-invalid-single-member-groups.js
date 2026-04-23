import { config as envConfig } from "dotenv";
import mongoose from "mongoose";
import chatModel from "../models/chat.models.js";

envConfig({ path: "./.env" });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not defined in environment variables.");
  process.exit(1);
}

const main = async () => {
  await mongoose.connect(MONGODB_URI, { dbName: "StealthyNote" });

  const invalidFilter = {
    groupChat: true,
    members: { $size: 1 },
  };

  const toDeleteCount = await chatModel.countDocuments(invalidFilter);

  if (toDeleteCount === 0) {
    console.log("No invalid group chats found (groupChat=true with one member).");
    await mongoose.disconnect();
    return;
  }

  const result = await chatModel.deleteMany(invalidFilter);

  console.log(`Deleted invalid single-member group chats: ${result.deletedCount}`);

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Failed to delete invalid single-member group chats:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
