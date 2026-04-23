import { config as envConfig } from "dotenv";
import mongoose from "mongoose";
import chatModel from "../models/chat.models.js";
import messageModel from "../models/message.models.js";
import userModel from "../models/user.models.js";

envConfig({ path: "./.env" });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not defined in environment variables.");
  process.exit(1);
}

const TARGET_USERNAMES = [
  "amank736836",
  "chitkara",
  "chitkara893",
  "amankumar123",
  "demo",
];

const main = async () => {
  await mongoose.connect(MONGODB_URI, { dbName: "StealthyNote" });

  const users = await userModel
    .find({ username: { $in: TARGET_USERNAMES } }, "_id username")
    .lean();

  if (users.length === 0) {
    console.log("No target users found.");
    await mongoose.disconnect();
    return;
  }

  const summary = [];
  let totalDeleted = 0;

  for (const user of users) {
    const chat = await chatModel.findById(user._id).select("_id name members groupChat").lean();

    if (!chat) {
      summary.push({ username: user.username, chatFound: false, deleted: 0 });
      continue;
    }

    const deleteFilter = { chat: chat._id };
    const toDeleteCount = await messageModel.countDocuments(deleteFilter);

    if (toDeleteCount > 0) {
      const result = await messageModel.deleteMany(deleteFilter);
      totalDeleted += result.deletedCount;
      summary.push({
        username: user.username,
        chatFound: true,
        chatId: String(chat._id),
        deleted: result.deletedCount,
      });
    } else {
      summary.push({
        username: user.username,
        chatFound: true,
        chatId: String(chat._id),
        deleted: 0,
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  console.log(`TOTAL_DELETED=${totalDeleted}`);

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Failed to delete messages for top users:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
