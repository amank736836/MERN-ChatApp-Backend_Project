import { config as envConfig } from "dotenv";
import mongoose from "mongoose";
import chatModel from "../models/chat.models.js";
import messageModel from "../models/message.models.js";

envConfig({ path: "./.env" });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error("MONGODB_URI is not defined in environment variables.");
  process.exit(1);
}

const main = async () => {
  await mongoose.connect(MONGODB_URI, { dbName: "StealthyNote" });

  const inboxChats = await chatModel.find({
    groupChat: false,
    members: { $size: 1 },
  }).select("_id").lean();

  if (inboxChats.length === 0) {
    console.log("No single-member inbox chats found.");
    await mongoose.disconnect();
    return;
  }

  const inboxChatIds = inboxChats.map((chat) => chat._id);

  // Delete anonymous asks only:
  // - in single-member inbox chats
  // - marked anonymous OR missing anonymous flag from old records
  // - not owner replies (replyTo.content should be empty/missing)
  const deleteFilter = {
    chat: { $in: inboxChatIds },
    $and: [
      {
        $or: [
          { isAnonymous: true },
          { isAnonymous: { $exists: false } },
        ],
      },
      {
        $or: [
          { "replyTo.content": { $exists: false } },
          { "replyTo.content": "" },
          { "replyTo.content": null },
        ],
      },
    ],
  };

  const toDeleteCount = await messageModel.countDocuments(deleteFilter);

  if (toDeleteCount === 0) {
    console.log("No legacy anonymous messages found to delete.");
    await mongoose.disconnect();
    return;
  }

  const result = await messageModel.deleteMany(deleteFilter);

  console.log(`Deleted legacy anonymous messages: ${result.deletedCount}`);

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Failed to delete legacy anonymous messages:", error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore disconnect errors
  }
  process.exit(1);
});
